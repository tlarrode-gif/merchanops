import { describe, expect, it } from "vitest";
import {
  AppPermissionKey,
  AppSession,
  AppUser,
  canAccessModule,
  canManageCampaigns,
  canViewFinancials,
  defaultPermissions,
  esResponsableDeZona,
  isAdminSession,
  isDelegacionSession,
  isZoneManagerSession,
  normalizeUser,
  roleLabels,
  sessionProvinceLabel,
  sessionRoleLabel,
  userCanSeeProvince,
  userToSession
} from "@/lib/access-control";

function sesion(row: Partial<AppUser>): AppSession {
  return userToSession(normalizeUser({ username: "prueba", display_name: "Prueba", ...row }));
}

const delegacion = () => sesion({ id: "u_del", username: "trade_sur", display_name: "TRADE SUR", role: "delegacion", provinces: ["Malaga", "Murcia"] });
const gestora = () => sesion({ id: "u_gestora", username: "gestora1", display_name: "Gestora", role: "manager", provinces: ["Barcelona"] });
const admin = () => sesion({ id: "u_admin", username: "admin", display_name: "Admin", role: "admin" });

describe("normalizeUser y el rol delegacion", () => {
  it("conserva el rol en vez de degradarlo a gestor", () => {
    // Antes de v11.5 cualquier rol no listado caía en "manager" Y saveInternalUsers
    // reescribía esa degradación en la base: una delegación se convertía en gestora.
    expect(normalizeUser({ username: "x", role: "delegacion" }).role).toBe("delegacion");
  });

  it("recibe la misma matriz de permisos que un gestor", () => {
    const del = normalizeUser({ username: "x", role: "delegacion" });
    expect(del.permissions).toEqual({ ...defaultPermissions, usuarios: false });
  });

  it("respeta los módulos que le quite administración, pero nunca le da 'usuarios'", () => {
    const del = normalizeUser({ username: "x", role: "delegacion", permissions: { ...defaultPermissions, pagos: false, usuarios: true } });
    expect(del.permissions.pagos).toBe(false);
    expect(del.permissions.usuarios).toBe(false);
  });

  it("un rol desconocido sigue degradando a 'manager'", () => {
    expect(normalizeUser({ username: "raro", role: "supervisor" as AppUser["role"] }).role).toBe("manager");
  });

  it("conserva sus provincias: su alcance es provincial como el de un gestor", () => {
    expect(normalizeUser({ username: "x", role: "delegacion", provinces: ["Malaga", "Murcia"] }).provinces).toEqual(["Malaga", "Murcia"]);
  });
});

describe("helpers de sesión", () => {
  it("distingue delegación de gestor y de administración", () => {
    expect(isDelegacionSession(delegacion())).toBe(true);
    expect(isDelegacionSession(gestora())).toBe(false);
    expect(isAdminSession(delegacion())).toBe(false);
  });

  it("delegación y gestor son las dos caras del responsable de zona", () => {
    expect(isZoneManagerSession(delegacion())).toBe(true);
    expect(isZoneManagerSession(gestora())).toBe(true);
    expect(isZoneManagerSession(admin())).toBe(false);
    expect(esResponsableDeZona({ role: "delegacion" })).toBe(true);
    expect(esResponsableDeZona({ role: "almacen" })).toBe(false);
  });

  it("tiene etiqueta propia en la interfaz", () => {
    expect(roleLabels.delegacion).toBe("Delegación");
    expect(sessionRoleLabel(delegacion())).toBe("Delegación");
  });

  it("su ámbito se muestra por provincias, no como nacional", () => {
    expect(sessionProvinceLabel(delegacion())).toBe("Malaga, Murcia");
  });
});

describe("alcance de una delegación", () => {
  it("ve sus provincias y solo esas", () => {
    expect(userCanSeeProvince(delegacion(), "Malaga")).toBe(true);
    expect(userCanSeeProvince(delegacion(), "Murcia")).toBe(true);
    expect(userCanSeeProvince(delegacion(), "Barcelona")).toBe(false);
  });

  it("entra en los mismos módulos que un gestor", () => {
    const modulos: AppPermissionKey[] = ["servicios", "isdin", "calendario", "pagos", "logistica", "rrhh"];
    for (const modulo of modulos) expect(canAccessModule(delegacion(), modulo)).toBe(true);
  });

  it("no entra en Usuarios y permisos", () => {
    expect(canAccessModule(delegacion(), "usuarios")).toBe(false);
  });

  it("no puede crear ni editar campañas, ni ver el presupuesto del cliente", () => {
    // Es un gestor subcontratado, no administración: la estructura de la campaña
    // y sus números financieros siguen siendo de la casa.
    expect(canManageCampaigns(delegacion())).toBe(false);
    expect(canViewFinancials(delegacion())).toBe(false);
  });

  it("una delegación desactivada no accede a nada", () => {
    const inactiva = sesion({ id: "u_del", role: "delegacion", provinces: ["Malaga"], active: false });
    expect(canAccessModule(inactiva, "servicios")).toBe(false);
    expect(userCanSeeProvince(inactiva, "Malaga")).toBe(false);
  });
});

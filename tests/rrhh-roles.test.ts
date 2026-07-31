/**
 * El rol `rrhh` en la capa de control de acceso.
 *
 * Aquí se fija la frontera del módulo de RR.HH. tal y como la describe
 * docs/ROADMAP_RRHH.md (decisión D5), y son tres cosas distintas que es fácil
 * confundir:
 *
 *  1. El ROL `rrhh` es EXCLUYENTE: solo ve su módulo. Ni panel, ni pagos, ni
 *     logística. Si alguien añade un permiso a `rrhhPermissions`, esto se pone
 *     rojo.
 *  2. El PERMISO `rrhh` lo tienen TAMBIÉN las gestoras (defaultPermissions),
 *     porque son ellas las que solicitan. Las filas ya guardadas en app_users no
 *     traen la clave en su jsonb: la herencia del valor por defecto es lo único
 *     que hace que el módulo no nazca vacío, así que se prueba explícitamente.
 *  3. `canManageRrhh` es el ROL, jamás el permiso. Es el espejo exacto de
 *     merchan_is_rrhh() en la base: si aquí se relajara a "tiene el permiso",
 *     cualquier gestora tramitaría altas y mantendría el catálogo de cadenas.
 *
 * `lib/access-control.ts` importa `lib/supabase`, pero ese módulo no tiene
 * efectos al importarse: sin las variables NEXT_PUBLIC_SUPABASE_* (que estos
 * tests no definen) `isSupabaseConfigured` es false y no se crea cliente
 * alguno. Nada de lo que se prueba aquí toca la red, así que basta con un
 * import estático; el vi.stubEnv + import dinámico de tests/degraded-mode.test.ts
 * solo hace falta cuando el test necesita el camino CON Supabase configurado.
 */
import { describe, expect, it } from "vitest";
import {
  AppPermissionKey,
  AppSession,
  AppUser,
  almacenPermissions,
  canAccessModule,
  canManageRrhh,
  defaultPermissions,
  isAdminSession,
  normalizeUser,
  rrhhPermissions,
  sessionProvinceLabel,
  userToSession
} from "@/lib/access-control";

function sesion(row: Partial<AppUser>): AppSession {
  return userToSession(normalizeUser({ username: "prueba", display_name: "Prueba", ...row }));
}

const sesionRrhh = () => sesion({ id: "u_rrhh", username: "rrhh1", display_name: "RRHH", role: "rrhh" });
const sesionAdmin = () => sesion({ id: "u_admin", username: "admin", display_name: "Admin", role: "admin" });
const sesionGestora = () => sesion({ id: "u_gestora", username: "gestora1", display_name: "Gestora", role: "manager", provinces: ["Barcelona"] });
const sesionAlmacen = () => sesion({ id: "u_almacen", username: "almacen1", display_name: "Almacén", role: "almacen" });

describe("normalizeUser y el rol rrhh", () => {
  it("un usuario con role 'rrhh' conserva el rol y recibe exactamente rrhhPermissions", () => {
    const user = normalizeUser({ username: "rrhh1", role: "rrhh" });
    expect(user.role).toBe("rrhh");
    expect(user.permissions).toEqual(rrhhPermissions);
  });

  it("el perfil de RR.HH. solo tiene 'rrhh' en true: ni un módulo más", () => {
    const user = normalizeUser({ username: "rrhh1", role: "rrhh" });
    const enTrue = Object.entries(user.permissions).filter(([, valor]) => valor).map(([clave]) => clave);
    expect(enTrue).toEqual(["rrhh"]);
  });

  it("los permisos del jsonb NO ensanchan al rol rrhh (la matriz del rol manda)", () => {
    // Una fila con permisos heredados de cuando era gestora no puede colar pagos ni logística.
    const user = normalizeUser({
      username: "rrhh1",
      role: "rrhh",
      permissions: { ...defaultPermissions, pagos: true, logistica: true, usuarios: true } as Record<AppPermissionKey, boolean>
    });
    expect(user.permissions).toEqual(rrhhPermissions);
  });

  it("un rol desconocido sigue degradando a 'manager'", () => {
    const user = normalizeUser({ username: "raro", role: "supervisor" as AppUser["role"] });
    expect(user.role).toBe("manager");
  });

  it("una gestora SIN la clave rrhh en su jsonb acaba con rrhh en true (herencia de defaultPermissions)", () => {
    // Así están las filas guardadas antes de que el módulo existiera: el jsonb no
    // tiene la clave. Sin esta herencia el módulo nacería sin solicitantes.
    const permisosLegados = { servicios: true, isdin: true, calendario: true, pagos: true, logistica: true } as unknown as Record<AppPermissionKey, boolean>;
    const user = normalizeUser({ username: "gestora1", role: "manager", permissions: permisosLegados });
    expect(user.permissions.rrhh).toBe(true);
    expect(user.permissions.usuarios).toBe(false);
  });

  it("una gestora con rrhh desactivado a mano se respeta (el defecto no pisa la decisión del admin)", () => {
    const user = normalizeUser({ username: "gestora2", role: "manager", permissions: { ...defaultPermissions, rrhh: false } });
    expect(user.permissions.rrhh).toBe(false);
  });
});

describe("canAccessModule con la sesión de RR.HH.", () => {
  it("entra en su módulo", () => {
    expect(canAccessModule(sesionRrhh(), "rrhh")).toBe(true);
  });

  it.each<AppPermissionKey>(["pagos", "servicios", "logistica", "isdin", "calendario"])(
    "no entra en %s",
    modulo => {
      expect(canAccessModule(sesionRrhh(), modulo)).toBe(false);
    }
  );

  it("tampoco entra en usuarios", () => {
    expect(canAccessModule(sesionRrhh(), "usuarios")).toBe(false);
  });

  it("una gestora sí entra en el módulo de RR.HH. (es quien solicita)", () => {
    expect(canAccessModule(sesionGestora(), "rrhh")).toBe(true);
  });

  it("un usuario de RR.HH. inactivo no entra ni a su propio módulo", () => {
    expect(canAccessModule(sesion({ username: "rrhh1", role: "rrhh", active: false }), "rrhh")).toBe(false);
  });
});

describe("canManageRrhh: quién TRAMITA (espejo de merchan_is_rrhh en la base)", () => {
  it("administración tramita", () => {
    expect(canManageRrhh(sesionAdmin())).toBe(true);
  });

  it("el perfil de RR.HH. tramita", () => {
    expect(canManageRrhh(sesionRrhh())).toBe(true);
  });

  it("una gestora NO tramita, aunque tenga el permiso rrhh", () => {
    const gestora = sesionGestora();
    expect(gestora.permissions.rrhh).toBe(true);
    expect(canManageRrhh(gestora)).toBe(false);
  });

  it("almacén no tramita", () => {
    expect(canManageRrhh(sesionAlmacen())).toBe(false);
  });

  it("un usuario de RR.HH. desactivado no tramita", () => {
    expect(canManageRrhh(sesion({ username: "rrhh1", role: "rrhh", active: false }))).toBe(false);
  });

  it("sin sesión no tramita nadie", () => {
    expect(canManageRrhh(null)).toBe(false);
    expect(canManageRrhh(undefined)).toBe(false);
  });
});

describe("el perfil de RR.HH. no es administración", () => {
  it("isAdminSession es false para la sesión de RR.HH.", () => {
    expect(isAdminSession(sesionRrhh())).toBe(false);
  });
});

describe("ámbito territorial", () => {
  it("RR.HH. es nacional: no se le asignan provincias", () => {
    const sesionDeRrhh = sesionRrhh();
    expect(sesionDeRrhh.provinces).toEqual([]);
    expect(sessionProvinceLabel(sesionDeRrhh)).toBe("Ámbito nacional");
  });

  it("la etiqueta de una gestora sigue siendo su lista de provincias", () => {
    expect(sessionProvinceLabel(sesionGestora())).toBe("Barcelona");
  });
});

describe("almacén no toca RR.HH.", () => {
  it("almacenPermissions.rrhh es false", () => {
    expect(almacenPermissions.rrhh).toBe(false);
  });
});

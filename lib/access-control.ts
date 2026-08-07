import { isSupabaseConfigured, supabase } from "@/lib/supabase";
import { normalizeProvince } from "@/lib/provinces";
import { clearProvinceView, isProvinceViewActive, matchesProvinceView } from "@/lib/shell/province-view";
import { hashPassword, isHashedPassword, randomPassword, verifyPassword } from "@/lib/password";
import { checkLoginAllowed, clearLoginAttempts, recordLoginFailure } from "@/lib/rate-limit";
import { sanitizeIdentifier } from "@/lib/sanitize";

export type AppPermissionKey = "servicios" | "isdin" | "calendario" | "pagos" | "logistica" | "rrhh" | "usuarios";
/**
 * `delegacion` (v11.5) es un GESTOR SUBCONTRATADO: mismo alcance provincial y la
 * misma matriz de permisos que un gestor de la casa, pero identificable como
 * externo para poder decir «en estas provincias manda la delegación, no nuestro
 * gestor». Ver `esResponsableDeZona`.
 */
export type AppRole = "admin" | "manager" | "delegacion" | "almacen" | "rrhh";

export type AppUser = {
  id: string;
  username: string;
  password: string;
  display_name: string;
  role: AppRole;
  active: boolean;
  provinces: string[];
  permissions: Record<AppPermissionKey, boolean>;
  created_at?: string | null;
  updated_at?: string | null;
};

export type AppSession = Pick<AppUser, "id" | "username" | "display_name" | "role" | "active" | "provinces" | "permissions">;

// C1: columnas que el navegador puede leer de app_users. El hash de contraseña
// JAMÁS vuelve a salir de la base: el login se verifica en el servidor
// (rpc merchan_auth_bootstrap) y el perfil llega por rpc merchan_auth_whoami.
const APP_USER_COLUMNS = "id,username,display_name,role,active,provinces,permissions,auth_user_id,created_at,updated_at";

const usersLocalKey = "merchanops_internal_users_v1";
const sessionLocalKey = "merchanops_internal_session_v1";
export const merchanopsSessionChangeEvent = "merchanops-session-change";

// Los gestores entran en RR.HH. para pedir las altas y los accesos a centro, así
// que `rrhh` nace en true igual que el resto de módulos operativos: las filas ya
// guardadas no traen la clave en su jsonb y el spread de normalizeUser les aplica
// este valor por defecto.
export const defaultPermissions: Record<AppPermissionKey, boolean> = {
  servicios: true,
  isdin: true,
  calendario: true,
  pagos: true,
  logistica: true,
  rrhh: true,
  usuarios: false
};

export const adminPermissions: Record<AppPermissionKey, boolean> = {
  servicios: true,
  isdin: true,
  calendario: true,
  pagos: true,
  logistica: true,
  rrhh: true,
  usuarios: true
};

export function uid(prefix = "usr") {
  const random = typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : String(Date.now() + Math.random());
  return `${prefix}_${random}`;
}

// Almacén (picking móvil de MerchanLOGS): sin módulos de OPS ni provincias.
export const almacenPermissions: Record<AppPermissionKey, boolean> = {
  servicios: false,
  isdin: false,
  calendario: false,
  pagos: false,
  logistica: false,
  rrhh: false,
  usuarios: false
};

// RR.HH.: perfil dedicado que SOLO ve su módulo (altas laborales y accesos a
// centro). Ni panel, ni servicios, ni pagos. Su ámbito es nacional: no se le
// asignan provincias, así que toda policy que filtre por provincia necesita una
// rama explícita para este rol (lección del rol `almacen`, v9_9_ola4).
export const rrhhPermissions: Record<AppPermissionKey, boolean> = {
  servicios: false,
  isdin: false,
  calendario: false,
  pagos: false,
  logistica: false,
  rrhh: true,
  usuarios: false
};

/** Roles válidos. Cualquier valor fuera de esta lista se degrada a "manager". */
const knownRoles: AppRole[] = ["admin", "manager", "delegacion", "almacen", "rrhh"];

export function normalizeUser(row: Partial<AppUser>): AppUser {
  // Cualquier rol desconocido cae en "manager": si un rol nuevo no se añade AQUÍ,
  // el usuario se degrada en silencio a gestor y saveInternalUsers reescribe esa
  // degradación en la base.
  const role: AppRole = knownRoles.includes(row.role as AppRole) ? (row.role as AppRole) : "manager";
  const permissions = role === "admin"
    ? adminPermissions
    : role === "almacen"
      ? almacenPermissions
      : role === "rrhh"
        ? rrhhPermissions
        // Delegación comparte matriz con gestor: sustituye al gestor en su zona,
        // así que necesita exactamente sus mismos módulos.
        : { ...defaultPermissions, ...(row.permissions || {}), usuarios: false };
  return {
    id: row.id || uid(),
    username: sanitizeIdentifier(row.username),
    password: String(row.password || ""),
    display_name: sanitizeIdentifier(row.display_name || row.username),
    role,
    active: row.active !== false,
    provinces: Array.from(new Set((row.provinces || []).map(normalizeProvince).filter(Boolean))),
    permissions
  };
}

/**
 * Usuarios de fábrica para una instalación NUEVA (base vacía). Sin contraseñas
 * hardcodeadas en el repositorio: la del admin sale de la variable de entorno
 * NEXT_PUBLIC_INITIAL_ADMIN_PASSWORD; si no está definida, se genera una
 * aleatoria y se muestra UNA vez por consola para completar la instalación.
 * Los gestores nacen inactivos y con contraseña aleatoria (el admin la fija
 * al activarlos desde Usuarios y permisos).
 */
export function defaultAppUsers(): AppUser[] {
  let adminPassword = String(process.env.NEXT_PUBLIC_INITIAL_ADMIN_PASSWORD || "").trim();
  if (!adminPassword) {
    adminPassword = randomPassword();
    if (typeof console !== "undefined") {
      console.warn(`[MerchanOps] Instalación nueva sin NEXT_PUBLIC_INITIAL_ADMIN_PASSWORD. Contraseña inicial de "admin" (guárdala y cámbiala): ${adminPassword}`);
    }
  }
  return [
    normalizeUser({ id: "admin", username: "admin", password: adminPassword, display_name: "Administracion", role: "admin", permissions: adminPermissions }),
    normalizeUser({ id: "gestor_1", username: "gestor1", password: randomPassword(), display_name: "Gestor 1", role: "manager", active: false }),
    normalizeUser({ id: "gestor_2", username: "gestor2", password: randomPassword(), display_name: "Gestor 2", role: "manager", active: false }),
    normalizeUser({ id: "gestor_3", username: "gestor3", password: randomPassword(), display_name: "Gestor 3", role: "manager", active: false }),
    normalizeUser({ id: "gestor_4", username: "gestor4", password: randomPassword(), display_name: "Gestor 4", role: "manager", active: false })
  ];
}

function userForDb(user: AppUser, includePassword: boolean) {
  const row: Record<string, unknown> = {
    id: user.id,
    username: user.username,
    display_name: user.display_name,
    role: user.role,
    active: user.active,
    provinces: user.provinces,
    permissions: user.permissions,
    updated_at: new Date().toISOString()
  };
  // Solo se escribe la columna password cuando hay una contraseña nueva; un
  // upsert sin la columna conserva el hash existente en la base.
  if (includePassword) row.password = user.password;
  return row;
}

// Con Supabase configurado, la base de datos es LA fuente de verdad de usuarios.
// Nunca se vuelve a la lista sembrada por defecto si la consulta falla: hacerlo
// permitía que un guardado posterior sobrescribiera en la base los usuarios
// reales con los de fábrica (así se perdieron provincias asignadas una vez).
export async function loadInternalUsers() {
  if (isSupabaseConfigured && supabase) {
    const { data, error } = await supabase.from("app_users").select(APP_USER_COLUMNS).order("display_name");
    if (!error && data) {
      if (data.length) {
        const users = data.map(row => normalizeUser(row as Partial<AppUser>));
        saveLocalUsers(users);
        return users;
      }
      // Base vacía de verdad (instalación nueva): sembrar una única vez.
      // Las contraseñas se hashean SIEMPRE antes de tocar la base.
      const seeded = await hashUserPasswords(defaultAppUsers());
      await supabase.from("app_users").upsert(seeded.map(user => userForDb(user, true)), { ignoreDuplicates: true, onConflict: "id" });
      return seeded;
    }
    // Error transitorio: usar la última copia local solo para mostrar, jamás sembrar.
    try {
      const cached = JSON.parse(localStorage.getItem(usersLocalKey) || "[]");
      if (Array.isArray(cached) && cached.length) return cached.map(row => normalizeUser(row));
    } catch {}
    return [];
  }
  try {
    const local = JSON.parse(localStorage.getItem(usersLocalKey) || "[]");
    if (Array.isArray(local) && local.length) return local.map(row => normalizeUser(row));
  } catch {}
  const seeded = defaultAppUsers();
  saveLocalUsers(seeded);
  return seeded;
}

/** Hashea las contraseñas que sigan en claro (nuevas o legadas) antes de persistir. */
async function hashUserPasswords(users: AppUser[]): Promise<AppUser[]> {
  return Promise.all(
    users.map(async user => {
      if (!user.password || isHashedPassword(user.password)) return user;
      return { ...user, password: await hashPassword(user.password) };
    })
  );
}

export async function saveInternalUsers(users: AppUser[]) {
  if (!users.length) throw new Error("La lista de usuarios está vacía; no se guarda para evitar borrar los existentes.");
  const normalized = await hashUserPasswords(users.map(normalizeUser));
  saveLocalUsers(isSupabaseConfigured ? normalized.map(user => ({ ...user, password: "" })) : normalized);
  if (isSupabaseConfigured && supabase) {
    // v9_3 dejó la columna password ilegible por REST y es NOT NULL, así que el
    // upsert masivo es imposible (ON CONFLICT necesita leerla y las filas sin
    // contraseña violan NOT NULL). Se escribe POR USUARIO: UPDATE si existe
    // (password solo si se ha fijado una nueva) e INSERT si es nuevo (con
    // contraseña obligatoria). Cualquier fallo se lanza: jamás éxito silencioso.
    const { data: existingRows, error: readError } = await supabase.from("app_users").select("id");
    if (readError) throw new Error(`No se pudo leer la lista de usuarios: ${readError.message}`);
    const existing = new Set((existingRows ?? []).map(row => String((row as { id: string }).id)));
    for (const user of normalized) {
      if (existing.has(user.id)) {
        const { error } = await supabase.from("app_users").update(userForDb(user, Boolean(user.password))).eq("id", user.id);
        if (error) throw new Error(`No se pudo actualizar "${user.username}": ${error.message}`);
      } else {
        if (!user.password) throw new Error(`El usuario nuevo "${user.username}" necesita una contraseña.`);
        const { error } = await supabase.from("app_users").insert(userForDb(user, true));
        if (error) throw new Error(`No se pudo crear "${user.username}": ${error.message}`);
      }
    }
  }
  return normalized;
}

function saveLocalUsers(users: AppUser[]) {
  if (typeof localStorage !== "undefined") localStorage.setItem(usersLocalKey, JSON.stringify(users));
}

function notifySessionChange() {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(merchanopsSessionChangeEvent));
}

export function userToSession(user: AppUser): AppSession {
  return {
    id: user.id,
    username: user.username,
    display_name: user.display_name,
    role: user.role,
    active: user.active,
    provinces: user.provinces,
    permissions: user.permissions
  };
}

/**
 * Login real (C1). Con Supabase configurado:
 *  1. rpc merchan_auth_bootstrap verifica la contraseña EN EL SERVIDOR (PBKDF2
 *     contra app_users, rate limiting de servidor) y crea/sincroniza el usuario
 *     en Supabase Auth manteniendo usuario y contraseña de siempre;
 *  2. supabase.auth.signInWithPassword obtiene la sesión JWT real (necesaria
 *     cuando se active RLS);
 *  3. rpc merchan_auth_whoami devuelve el perfil SIN hash de contraseña.
 * Sin Supabase (modo local/demo) se mantiene la verificación local con rate
 * limiting de cliente.
 */
export async function loginAppUser(username: string, password: string) {
  const scope = username.trim().toLowerCase();
  const limit = checkLoginAllowed(scope);
  if (!limit.allowed) {
    throw new Error(`Demasiados intentos fallidos. Vuelve a intentarlo en ${limit.retryInMinutes} minuto(s).`);
  }
  if (isSupabaseConfigured && supabase) {
    const { data, error } = await supabase.rpc("merchan_auth_bootstrap", { p_username: username, p_password: password });
    if (error) throw new Error(`No se ha podido iniciar sesión: ${error.message}`);
    const result = (data ?? {}) as { email?: string; error?: string };
    if (result.error || !result.email) {
      recordLoginFailure(scope);
      if (String(result.error || "").startsWith("Demasiados intentos")) throw new Error(result.error);
      return null;
    }
    const { error: authError } = await supabase.auth.signInWithPassword({ email: result.email, password });
    if (authError) throw new Error(`No se ha podido iniciar sesión: ${authError.message}`);
    const { data: profile, error: profileError } = await supabase.rpc("merchan_auth_whoami");
    if (profileError || !profile) {
      await supabase.auth.signOut();
      throw new Error("Sesión creada pero no se pudo cargar el perfil. Vuelve a intentarlo.");
    }
    clearLoginAttempts(scope);
    const session = userToSession(normalizeUser(profile as Partial<AppUser>));
    saveCurrentAppSession(session);
    return session;
  }
  const users = await loadInternalUsers();
  const candidate = users.find(user => user.active && user.username.toLowerCase() === scope);
  const valid = candidate ? await verifyPassword(password, candidate.password) : false;
  if (!candidate || !valid) {
    recordLoginFailure(scope);
    return null;
  }
  clearLoginAttempts(scope);
  if (!isHashedPassword(candidate.password)) {
    try {
      await saveInternalUsers(users.map(user => (user.id === candidate.id ? { ...user, password } : user)));
    } catch {
      // Si el upgrade falla (p.ej. sin red), el login sigue siendo válido; se reintentará en el próximo acceso.
    }
  }
  const session = userToSession(candidate);
  saveCurrentAppSession(session);
  return session;
}

export function getCurrentAppSession(): AppSession | null {
  if (typeof localStorage === "undefined") return null;
  try {
    const raw = localStorage.getItem(sessionLocalKey);
    return raw ? JSON.parse(raw) as AppSession : null;
  } catch {
    return null;
  }
}

export function saveCurrentAppSession(session: AppSession | null) {
  if (typeof localStorage === "undefined") return;
  if (session) localStorage.setItem(sessionLocalKey, JSON.stringify(session));
  else localStorage.removeItem(sessionLocalKey);
  notifySessionChange();
}

export function logoutAppUser() {
  if (isSupabaseConfigured && supabase) void supabase.auth.signOut().catch(() => undefined);
  // El filtro de provincia de la topbar es de la persona, no del navegador:
  // la siguiente sesión empieza viendo todo su alcance.
  clearProvinceView();
  saveCurrentAppSession(null);
}

/**
 * C1: coherencia entre la sesión de UI (localStorage) y la sesión real de
 * Supabase Auth. Si hay sesión local pero el JWT no existe (caducado, borrado,
 * sesión anterior a la migración), se cierra la sesión local para forzar un
 * login real. Devuelve false cuando ha tenido que cerrarla.
 */
export async function ensureAuthSession(): Promise<boolean> {
  if (!isSupabaseConfigured || !supabase) return true;
  if (!getCurrentAppSession()) return true;
  const { data } = await supabase.auth.getSession();
  if (data.session) return true;
  saveCurrentAppSession(null);
  return false;
}

export function isAdminSession(session?: AppSession | null) {
  return session?.role === "admin";
}

/** Perfil dedicado de RR.HH.: solo ve su módulo, pero lo ve entero y de toda España. */
export function isRrhhSession(session?: AppSession | null) {
  return session?.role === "rrhh";
}

/**
 * v11.5 · Delegación: gestor SUBCONTRATADO de una zona. Ve y hace lo mismo que un
 * gestor de la casa dentro de sus provincias; lo único que cambia es que en las
 * campañas «por delegaciones» es ella —y no el gestor interno— quien recibe los
 * puntos de esas provincias.
 */
export function isDelegacionSession(session?: AppSession | null) {
  return session?.role === "delegacion";
}

/**
 * Quien gestiona una ZONA: el gestor de la casa o la delegación subcontratada.
 * Es el perfil que reparte los puntos entre TRABAJADORES; administración solo
 * reparte entre responsables de zona y nunca toca instaladores.
 */
export function isZoneManagerSession(session?: AppSession | null) {
  return session?.role === "manager" || session?.role === "delegacion";
}

/** Espejo de lo anterior sobre una ficha de usuario (no sobre la sesión). */
export function esResponsableDeZona(user: Pick<AppUser, "role">) {
  return user.role === "manager" || user.role === "delegacion";
}

/**
 * Quien TRAMITA en RR.HH.: rellena el número de A3, cambia el estado de una
 * solicitud, concede o deniega un acceso y mantiene el catálogo de cadenas.
 * Los gestores entran al módulo (canAccessModule(session, "rrhh")) pero solo
 * para SOLICITAR; el espejo de esta función en la base es merchan_is_rrhh().
 */
export function canManageRrhh(session?: AppSession | null) {
  return Boolean(session?.active) && (isAdminSession(session) || isRrhhSession(session));
}

export const roleLabels: Record<AppRole, string> = {
  admin: "Administración",
  manager: "Gestor",
  delegacion: "Delegación",
  almacen: "Almacén",
  rrhh: "RR.HH."
};

export function sessionRoleLabel(session?: AppSession | null) {
  return session ? roleLabels[session.role] || "Gestor" : "Sin sesión";
}

// Capacidades sensibles por rol. Los gestores nunca ven datos financieros del cliente
// (presupuesto, facturación, margen) ni tocan la estructura de campañas; su visión
// operativa se limita además a sus provincias asignadas.
export function canViewFinancials(session?: AppSession | null) {
  return Boolean(session?.active) && isAdminSession(session);
}

export function canManageCampaigns(session?: AppSession | null) {
  return Boolean(session?.active) && isAdminSession(session);
}

export function canDeleteCampaigns(session?: AppSession | null) {
  return Boolean(session?.active) && isAdminSession(session);
}

export function canAccessModule(session: AppSession | null | undefined, module: AppPermissionKey) {
  if (!session || !session.active) return false;
  if (isAdminSession(session)) return true;
  return Boolean(session.permissions?.[module]);
}

export function userCanSeeProvince(session: AppSession | null | undefined, province?: string | null) {
  if (!session || !session.active) return false;
  if (isAdminSession(session)) return true;
  const normalized = normalizeProvince(province);
  return !!normalized && session.provinces.map(normalizeProvince).includes(normalized);
}

/**
 * Filtro de VISTA por provincia. Aplica dos recortes en este orden:
 *   1. el alcance del rol (un gestor solo ve sus provincias);
 *   2. la provincia elegida en el selector de la topbar, si hay alguna.
 * El segundo nunca amplía el primero, así que un gestor no puede mirar fuera
 * de su alcance eligiendo otra provincia en el selector.
 */
export function filterBySessionProvince<T extends { province?: string | null; points?: Array<{ province?: string | null }> }>(rows: T[], session: AppSession | null | undefined) {
  if (!session || !session.active) return [];
  const inScope = isAdminSession(session)
    ? rows
    : rows.filter(row => userCanSeeProvince(session, row.province) || row.points?.some(point => userCanSeeProvince(session, point.province)));
  if (!isProvinceViewActive()) return inScope;
  return inScope.filter(row => matchesProvinceView(row.province) || row.points?.some(point => matchesProvinceView(point.province)));
}

export function sessionProvinceLabel(session?: AppSession | null) {
  if (!session) return "Sin sesion";
  if (isAdminSession(session)) return "Todas las provincias";
  // RR.HH. tramita altas y accesos de toda España: no se le asignan provincias.
  if (isRrhhSession(session)) return "Ámbito nacional";
  return session.provinces.length ? session.provinces.join(", ") : "Sin provincias asignadas";
}

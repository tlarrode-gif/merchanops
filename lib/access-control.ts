import { isSupabaseConfigured, supabase } from "@/lib/supabase";
import { normalizeProvince } from "@/lib/provinces";
import { hashPassword, isHashedPassword, randomPassword, verifyPassword } from "@/lib/password";
import { checkLoginAllowed, clearLoginAttempts, recordLoginFailure } from "@/lib/rate-limit";
import { sanitizeIdentifier } from "@/lib/sanitize";

export type AppPermissionKey = "servicios" | "isdin" | "calendario" | "pagos" | "logistica" | "usuarios";
export type AppRole = "admin" | "manager" | "almacen";

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

export const defaultPermissions: Record<AppPermissionKey, boolean> = {
  servicios: true,
  isdin: true,
  calendario: true,
  pagos: true,
  logistica: true,
  usuarios: false
};

export const adminPermissions: Record<AppPermissionKey, boolean> = {
  servicios: true,
  isdin: true,
  calendario: true,
  pagos: true,
  logistica: true,
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
  usuarios: false
};

export function normalizeUser(row: Partial<AppUser>): AppUser {
  const role = row.role === "admin" ? "admin" : row.role === "almacen" ? "almacen" : "manager";
  const permissions = role === "admin" ? adminPermissions : role === "almacen" ? almacenPermissions : { ...defaultPermissions, ...(row.permissions || {}), usuarios: false };
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
    // Dos lotes con columnas homogéneas: solo los usuarios con contraseña nueva
    // escriben la columna password (el resto conserva su hash en la base).
    const withPassword = normalized.filter(user => user.password);
    const withoutPassword = normalized.filter(user => !user.password);
    if (withPassword.length) {
      const { error } = await supabase.from("app_users").upsert(withPassword.map(user => userForDb(user, true)));
      if (error) throw error;
    }
    if (withoutPassword.length) {
      const { error } = await supabase.from("app_users").upsert(withoutPassword.map(user => userForDb(user, false)));
      if (error) throw error;
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

// Capacidades sensibles por rol. Los gestores nunca ven datos financieros del cliente
// (presupuesto, facturación, margen) ni tocan la estructura de campañas; su visión
// operativa se limita además a sus provincias asignadas.
export function canViewFinancials(session?: AppSession | null) {
  return Boolean(session?.active) && isAdminSession(session);
}

export function canViewGlobalDashboards(session?: AppSession | null) {
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

export function filterBySessionProvince<T extends { province?: string | null; points?: Array<{ province?: string | null }> }>(rows: T[], session: AppSession | null | undefined) {
  if (!session || !session.active) return [];
  if (isAdminSession(session)) return rows;
  return rows.filter(row => userCanSeeProvince(session, row.province) || row.points?.some(point => userCanSeeProvince(session, point.province)));
}

export function sessionProvinceLabel(session?: AppSession | null) {
  if (!session) return "Sin sesion";
  if (isAdminSession(session)) return "Todas las provincias";
  return session.provinces.length ? session.provinces.join(", ") : "Sin provincias asignadas";
}

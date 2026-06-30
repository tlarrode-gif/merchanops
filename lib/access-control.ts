import { isSupabaseConfigured, supabase } from "@/lib/supabase";
import { normalizeProvince } from "@/lib/provinces";

export type AppPermissionKey = "servicios" | "isdin" | "calendario" | "pagos" | "logistica" | "usuarios";
export type AppRole = "admin" | "manager";

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

const usersLocalKey = "merchanops_internal_users_v1";
const sessionLocalKey = "merchanops_internal_session_v1";

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

export function normalizeUser(row: Partial<AppUser>): AppUser {
  const role = row.role === "admin" ? "admin" : "manager";
  const permissions = role === "admin" ? adminPermissions : { ...defaultPermissions, ...(row.permissions || {}), usuarios: false };
  return {
    id: row.id || uid(),
    username: String(row.username || "").trim(),
    password: String(row.password || ""),
    display_name: String(row.display_name || row.username || "").trim(),
    role,
    active: row.active !== false,
    provinces: Array.from(new Set((row.provinces || []).map(normalizeProvince).filter(Boolean))),
    permissions
  };
}

export function defaultAppUsers(): AppUser[] {
  return [
    normalizeUser({ id: "admin", username: "admin", password: "admin123", display_name: "Administracion", role: "admin", permissions: adminPermissions }),
    normalizeUser({ id: "gestor_1", username: "gestor1", password: "gestor123", display_name: "Gestor 1", role: "manager", active: false }),
    normalizeUser({ id: "gestor_2", username: "gestor2", password: "gestor123", display_name: "Gestor 2", role: "manager", active: false }),
    normalizeUser({ id: "gestor_3", username: "gestor3", password: "gestor123", display_name: "Gestor 3", role: "manager", active: false }),
    normalizeUser({ id: "gestor_4", username: "gestor4", password: "gestor123", display_name: "Gestor 4", role: "manager", active: false })
  ];
}

function userForDb(user: AppUser) {
  return {
    id: user.id,
    username: user.username,
    password: user.password,
    display_name: user.display_name,
    role: user.role,
    active: user.active,
    provinces: user.provinces,
    permissions: user.permissions,
    updated_at: new Date().toISOString()
  };
}

export async function loadInternalUsers() {
  if (isSupabaseConfigured && supabase) {
    const { data, error } = await supabase.from("app_users").select("*").order("display_name");
    if (!error && data && data.length) return data.map(row => normalizeUser(row as Partial<AppUser>));
  }
  try {
    const local = JSON.parse(localStorage.getItem(usersLocalKey) || "[]");
    if (Array.isArray(local) && local.length) return local.map(row => normalizeUser(row));
  } catch {}
  const seeded = defaultAppUsers();
  saveLocalUsers(seeded);
  return seeded;
}

export async function saveInternalUsers(users: AppUser[]) {
  const normalized = users.map(normalizeUser);
  saveLocalUsers(normalized);
  if (isSupabaseConfigured && supabase) {
    const { error } = await supabase.from("app_users").upsert(normalized.map(userForDb));
    if (error) throw error;
  }
  return normalized;
}

function saveLocalUsers(users: AppUser[]) {
  if (typeof localStorage !== "undefined") localStorage.setItem(usersLocalKey, JSON.stringify(users));
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

export async function loginAppUser(username: string, password: string) {
  const users = await loadInternalUsers();
  const found = users.find(user => user.active && user.username.toLowerCase() === username.trim().toLowerCase() && user.password === password);
  if (!found) return null;
  const session = userToSession(found);
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
}

export function logoutAppUser() {
  saveCurrentAppSession(null);
}

export function isAdminSession(session?: AppSession | null) {
  return session?.role === "admin";
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
  if (!session || isAdminSession(session)) return rows;
  return rows.filter(row => userCanSeeProvince(session, row.province) || row.points?.some(point => userCanSeeProvince(session, point.province)));
}

export function sessionProvinceLabel(session?: AppSession | null) {
  if (!session) return "Sin sesion";
  if (isAdminSession(session)) return "Todas las provincias";
  return session.provinces.length ? session.provinces.join(", ") : "Sin provincias asignadas";
}

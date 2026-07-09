/**
 * Rate limiting de intentos de login: máximo 5 intentos fallidos por usuario
 * en una ventana de 15 minutos.
 *
 * MerchanOps no tiene API routes (toda la lógica corre en el navegador contra
 * Supabase), así que este limitador se aplica en el propio flujo de login del
 * cliente y persiste en localStorage. Frena fuerza bruta casual y da feedback
 * de bloqueo al usuario; NO es un control de servidor y un atacante con la
 * anon key puede saltárselo (ver docs/SECURITY_AUDIT.md — la mitigación real
 * es Supabase Auth, que trae rate limiting de servidor de serie).
 */

const STORAGE_KEY = "merchanops_login_attempts_v1";

export const MAX_ATTEMPTS = 5;
export const WINDOW_MS = 15 * 60 * 1000;

type AttemptRecord = { count: number; firstAt: number };
type AttemptStore = Record<string, AttemptRecord>;

function loadStore(): AttemptStore {
  if (typeof localStorage === "undefined") return {};
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}") as AttemptStore;
  } catch {
    return {};
  }
}

function saveStore(store: AttemptStore) {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
}

function normalizeScope(scope: string): string {
  return scope.trim().toLowerCase() || "_";
}

/** Comprueba si el ámbito (p.ej. username) puede intentar otra vez. */
export function checkLoginAllowed(scope: string): { allowed: boolean; remaining: number; retryInMinutes: number } {
  const store = loadStore();
  const record = store[normalizeScope(scope)];
  const now = Date.now();
  if (!record || now - record.firstAt >= WINDOW_MS) {
    return { allowed: true, remaining: MAX_ATTEMPTS, retryInMinutes: 0 };
  }
  const remaining = Math.max(0, MAX_ATTEMPTS - record.count);
  const retryInMinutes = Math.ceil((record.firstAt + WINDOW_MS - now) / 60_000);
  return { allowed: remaining > 0, remaining, retryInMinutes };
}

/** Registra un intento fallido dentro de la ventana. */
export function recordLoginFailure(scope: string) {
  const store = loadStore();
  const key = normalizeScope(scope);
  const now = Date.now();
  const record = store[key];
  if (!record || now - record.firstAt >= WINDOW_MS) {
    store[key] = { count: 1, firstAt: now };
  } else {
    record.count += 1;
  }
  saveStore(store);
}

/** Limpia los intentos del ámbito (tras login correcto). */
export function clearLoginAttempts(scope: string) {
  const store = loadStore();
  delete store[normalizeScope(scope)];
  saveStore(store);
}

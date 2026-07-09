/**
 * Hashing de contraseñas en cliente con WebCrypto (PBKDF2-SHA256 + salt).
 *
 * Contexto: la autenticación de MerchanOps es interna y se resuelve en el
 * navegador contra la tabla app_users. Históricamente las contraseñas se
 * guardaban en TEXTO PLANO; este módulo las sustituye por un hash PBKDF2 con
 * salt aleatorio por usuario, con migración transparente: si el valor
 * almacenado es plano (legado), el login lo verifica y lo re-guarda hasheado.
 *
 * Formato almacenado: "pbkdf2:<iteraciones>:<salt_hex>:<hash_hex>"
 *
 * Límite conocido (ver docs/SECURITY_AUDIT.md): mientras el login sea 100%
 * cliente, el navegador descarga los hashes para compararlos; el hashing
 * protege las credenciales en reposo (DB/localStorage) pero no sustituye a una
 * autenticación de servidor (Supabase Auth).
 */

const PREFIX = "pbkdf2";
const ITERATIONS = 150_000;
const KEY_BITS = 256;

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes).map(b => b.toString(16).padStart(2, "0")).join("");
}

function fromHex(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

async function derive(plain: string, salt: Uint8Array, iterations: number): Promise<string> {
  const material = await crypto.subtle.importKey("raw", new TextEncoder().encode(plain), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: salt as BufferSource, iterations },
    material,
    KEY_BITS
  );
  return toHex(new Uint8Array(bits));
}

export function isHashedPassword(stored: string | null | undefined): boolean {
  return typeof stored === "string" && stored.startsWith(`${PREFIX}:`);
}

export async function hashPassword(plain: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await derive(plain, salt, ITERATIONS);
  return `${PREFIX}:${ITERATIONS}:${toHex(salt)}:${hash}`;
}

/** Verifica contra hash PBKDF2 o, si el valor almacenado es legado (plano), por igualdad. */
export async function verifyPassword(plain: string, stored: string | null | undefined): Promise<boolean> {
  if (!stored || !plain) return false;
  if (!isHashedPassword(stored)) return stored === plain;
  const [, iterationsRaw, saltHex, expected] = stored.split(":");
  const iterations = Number(iterationsRaw);
  if (!iterations || !saltHex || !expected) return false;
  const actual = await derive(plain, fromHex(saltHex), iterations);
  return actual === expected;
}

/** Contraseña aleatoria legible para altas iniciales (no se almacena en claro en el código). */
export function randomPassword(length = 16): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(bytes).map(b => alphabet[b % alphabet.length]).join("");
}

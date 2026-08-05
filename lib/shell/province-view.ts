import { normalizeProvince } from "@/lib/provinces";

/**
 * Provincia activa en la topbar (el selector «Todas las provincias»).
 *
 * Es un filtro de VISTA, nunca de permiso: acota lo que se está mirando dentro
 * de lo que la sesión ya puede ver. El alcance real por rol sigue viviendo en
 * access-control (userCanSeeProvince), que esta capa no toca — si lo tocara,
 * elegir una provincia bloquearía altas y ediciones legítimas en el resto, que
 * es exactamente lo que no debe pasar.
 *
 * Se guarda en localStorage para que la elección sobreviva a la navegación y a
 * un refresco, y se cachea en memoria porque filterBySessionProvince la
 * consulta en cada render de lista.
 */

const storageKey = "merchanops_province_view_v1";
export const provinceViewChangeEvent = "merchanops-province-view-change";

/** "" = todas las provincias del alcance de la sesión. */
let cached: string | null = null;

function read(): string {
  if (cached !== null) return cached;
  if (typeof localStorage === "undefined") return "";
  try {
    cached = normalizeProvince(localStorage.getItem(storageKey) || "");
  } catch {
    cached = "";
  }
  return cached;
}

export function getProvinceView(): string {
  return read();
}

export function setProvinceView(province: string) {
  const next = normalizeProvince(province || "");
  if (next === read()) return;
  cached = next;
  if (typeof localStorage !== "undefined") {
    try {
      if (next) localStorage.setItem(storageKey, next);
      else localStorage.removeItem(storageKey);
    } catch {
      // Modo privado o cuota llena: el filtro sigue vivo en memoria.
    }
  }
  if (typeof window !== "undefined") window.dispatchEvent(new Event(provinceViewChangeEvent));
}

/** Al cerrar sesión el filtro se olvida: la siguiente sesión empieza limpia. */
export function clearProvinceView() {
  setProvinceView("");
}

export function isProvinceViewActive() {
  return read() !== "";
}

/**
 * ¿Esta fila entra en la vista actual?
 *
 * Sin filtro activo todo entra. Con filtro activo entra solo lo de esa
 * provincia; una fila sin provincia queda fuera, igual que ya ocurre hoy con
 * el alcance por rol (userCanSeeProvince devuelve false para provincia vacía),
 * así que el comportamiento es el mismo que la app ya tenía.
 */
export function matchesProvinceView(province?: string | null) {
  const active = read();
  if (!active) return true;
  return normalizeProvince(province) === active;
}

/**
 * Acota una lista de provincias (la de la sesión) a la vista activa. Sirve
 * para las consultas que filtran en la base con .in("province", ...): así el
 * filtro no se queda solo en el cliente.
 */
export function narrowProvincesToView(provinces: string[]): string[] {
  const active = read();
  if (!active) return provinces;
  const inScope = provinces.some(p => normalizeProvince(p) === active);
  return inScope || provinces.length === 0 ? [active] : provinces;
}

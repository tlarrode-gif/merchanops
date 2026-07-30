import { normalizeProvince } from "@/lib/provinces";

// Reparto de personas por zona en Grandes Campañas. Lógica pura (sin Supabase) para
// poder probarla: la usan «Sugerir gestor» (administración reparte los puntos entre
// gestores) y «Sugerir trabajador» (el gestor reparte sus puntos entre instaladores).
//
// Las dos capas son distintas a propósito:
//   - GESTOR: usuario interno (app_users, rol manager) con VARIAS provincias.
//   - TRABAJADOR / INSTALADOR: ficha de la tabla workers, con UNA provincia.

export type CandidatoGestor = { id: string; display_name?: string | null; provinces?: string[] | null; role?: string | null; active?: boolean | null };
export type CandidatoTrabajador = { id: string; name: string; province?: string | null };

export type PuntoAsignable = {
  id: string;
  provincia?: string | null;
  gestor_id?: string | null;
  instalador_id?: string | null;
  instalador_nombre?: string | null;
  direccion?: string | null;
  direccion_envio?: string | null;
  estado?: string | null;
};

/** Comparación de provincias tolerante a acentos y grafías ("Almería" = "Almeria"). */
export function mismaProvincia(a?: string | null, b?: string | null) {
  const fold = (value?: string | null) =>
    normalizeProvince(String(value ?? "")).trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const left = fold(a);
  const right = fold(b);
  return Boolean(left) && left === right;
}

export type Sugerencia = { punto_id: string; persona_id: string; persona_nombre: string; provincia: string | null };

export type ResultadoSugerencia = {
  sugerencias: Sugerencia[];
  /** Provincias de los puntos sin ningún candidato: nadie cubre la zona. */
  provinciasSinCandidato: string[];
  /** Provincias con más de un candidato: el reparto automático es discutible y conviene revisarlo. */
  provinciasConVarios: string[];
  /** Puntos que se han dejado como estaban (ya tenían persona o no hay candidato). */
  sinTocar: number;
};

type Candidato = { id: string; nombre: string; cubre: (provincia?: string | null) => boolean };

// Reparto común: por cada punto sin asignar se eligen los candidatos que cubren su
// provincia y gana el de menor carga (contando lo que ya tenía más lo repartido en esta
// misma pasada), con el nombre como desempate para que el resultado sea estable.
function repartir(puntos: PuntoAsignable[], candidatos: Candidato[], asignadoDe: (punto: PuntoAsignable) => string | null | undefined): ResultadoSugerencia {
  const carga = new Map<string, number>();
  candidatos.forEach(candidato => carga.set(candidato.id, 0));
  for (const punto of puntos) {
    const actual = asignadoDe(punto);
    if (actual && carga.has(actual)) carga.set(actual, (carga.get(actual) || 0) + 1);
  }

  const sugerencias: Sugerencia[] = [];
  const sinCandidato = new Set<string>();
  const conVarios = new Set<string>();
  let sinTocar = 0;

  for (const punto of puntos) {
    const elegibles = candidatos.filter(candidato => candidato.cubre(punto.provincia));
    if (elegibles.length > 1 && punto.provincia) conVarios.add(punto.provincia);
    if (asignadoDe(punto)) { sinTocar += 1; continue; }
    if (!elegibles.length) {
      if (punto.provincia) sinCandidato.add(punto.provincia);
      sinTocar += 1;
      continue;
    }
    const elegido = elegibles
      .slice()
      .sort((a, b) => (carga.get(a.id) || 0) - (carga.get(b.id) || 0) || a.nombre.localeCompare(b.nombre, "es"))[0];
    carga.set(elegido.id, (carga.get(elegido.id) || 0) + 1);
    sugerencias.push({ punto_id: punto.id, persona_id: elegido.id, persona_nombre: elegido.nombre, provincia: punto.provincia || null });
  }

  return {
    sugerencias,
    provinciasSinCandidato: Array.from(sinCandidato).sort((a, b) => a.localeCompare(b, "es")),
    provinciasConVarios: Array.from(conVarios).sort((a, b) => a.localeCompare(b, "es")),
    sinTocar
  };
}

/**
 * Administración: propone un GESTOR para cada punto según la provincia del punto.
 * Asignar el gestor es lo que le da acceso al punto (ver sessionCanSeePunto), así que
 * esto es «otorgar visibilidad», no un simple adorno del equipo de campaña.
 */
export function sugerirGestoresPorPunto(puntos: PuntoAsignable[], gestores: CandidatoGestor[]): ResultadoSugerencia {
  const candidatos: Candidato[] = gestores
    .filter(gestor => gestor.active !== false && (gestor.provinces || []).length > 0)
    .map(gestor => ({
      id: gestor.id,
      nombre: gestor.display_name || gestor.id,
      cubre: (provincia?: string | null) => (gestor.provinces || []).some(propia => mismaProvincia(propia, provincia))
    }));
  return repartir(puntos, candidatos, punto => punto.gestor_id);
}

/**
 * Gestor: propone un TRABAJADOR (instalador) para cada punto de su zona. Un worker tiene
 * una sola provincia, así que la coincidencia es directa; los puntos de provincias sin
 * trabajador se quedan vacíos a propósito en vez de caer en cualquiera.
 */
export function sugerirTrabajadoresPorPunto(puntos: PuntoAsignable[], workers: CandidatoTrabajador[]): ResultadoSugerencia {
  const candidatos: Candidato[] = workers.map(worker => ({
    id: worker.id,
    nombre: worker.name,
    cubre: (provincia?: string | null) => mismaProvincia(worker.province, provincia)
  }));
  return repartir(puntos, candidatos, punto => punto.instalador_id);
}

/** Trabajadores que pueden cubrir una provincia (para el desplegable del punto). */
export function trabajadoresDeProvincia(workers: CandidatoTrabajador[], provincia?: string | null): CandidatoTrabajador[] {
  if (!provincia) return [];
  return workers.filter(worker => mismaProvincia(worker.province, provincia));
}

/** Provincias que tienen más de un trabajador: son las que el gestor debe decidir a mano. */
export function provinciasConVariosTrabajadores(workers: CandidatoTrabajador[]): string[] {
  const porProvincia = new Map<string, string[]>();
  for (const worker of workers) {
    const provincia = normalizeProvince(worker.province || "");
    if (!provincia) continue;
    porProvincia.set(provincia, [...(porProvincia.get(provincia) || []), worker.name]);
  }
  return Array.from(porProvincia.entries())
    .filter(([, nombres]) => nombres.length > 1)
    .map(([provincia]) => provincia)
    .sort((a, b) => a.localeCompare(b, "es"));
}

// ---------------------------------------------------------------------------
// Agrupación de la solicitud de material
// ---------------------------------------------------------------------------

export type GrupoMaterial = {
  /** Clave estable del grupo: instalador + dirección de envío efectiva. */
  key: string;
  instalador_id: string | null;
  instalador_nombre: string | null;
  direccion_envio: string | null;
  puntos: PuntoAsignable[];
};

/**
 * Una solicitud a Logística solo puede tener UN destinatario y UNA dirección
 * (logistics_requests.installer_id / delivery_address son columnas únicas por cabecera).
 * Por eso los puntos se agrupan por trabajador + dirección antes de pedir material: así
 * Almacén recibe una solicitud por destinatario real en lugar de una sola con el nombre
 * del primer trabajador que apareciera.
 */
export function agruparPuntosParaMaterial(puntos: PuntoAsignable[]): GrupoMaterial[] {
  const grupos = new Map<string, GrupoMaterial>();
  for (const punto of puntos) {
    const instaladorId = punto.instalador_id || null;
    // La dirección efectiva es la misma que aplica la RPC: envío del trabajador y, si no
    // hay, la dirección del propio punto.
    const direccion = (punto.direccion_envio || "").trim() || (punto.direccion || "").trim() || "";
    const key = `${instaladorId || "sin-instalador"}||${direccion.toLowerCase()}`;
    const grupo = grupos.get(key);
    if (grupo) { grupo.puntos.push(punto); continue; }
    grupos.set(key, {
      key,
      instalador_id: instaladorId,
      instalador_nombre: punto.instalador_nombre || null,
      direccion_envio: direccion || null,
      puntos: [punto]
    });
  }
  // Los grupos con trabajador primero, y dentro por nombre, para que el resumen sea legible.
  return Array.from(grupos.values()).sort((a, b) => {
    if (!a.instalador_id !== !b.instalador_id) return a.instalador_id ? -1 : 1;
    return (a.instalador_nombre || "").localeCompare(b.instalador_nombre || "", "es") || a.key.localeCompare(b.key);
  });
}

/**
 * Reparto en el momento de importar: los puntos aún no existen en base, así que el gestor
 * se resuelve en memoria sobre las filas del Excel y se guarda ya con cada punto. Así la
 * campaña nace con las zonas repartidas y cada gestor ve sus puntos desde el primer momento.
 */
export function asignarGestoresAPuntosNuevos<T extends { provincia?: string | null; gestor_id?: string | null; gestor_nombre?: string | null }>(
  puntos: T[],
  gestores: CandidatoGestor[]
): { puntos: T[]; asignados: number; provinciasSinGestor: string[] } {
  const conIndice = puntos.map((punto, index) => ({ id: String(index), provincia: punto.provincia, gestor_id: punto.gestor_id }));
  const propuesta = sugerirGestoresPorPunto(conIndice, gestores);
  const porIndice = new Map(propuesta.sugerencias.map(sugerencia => [Number(sugerencia.punto_id), sugerencia]));
  return {
    puntos: puntos.map((punto, index) => {
      const sugerencia = porIndice.get(index);
      return sugerencia ? { ...punto, gestor_id: sugerencia.persona_id, gestor_nombre: sugerencia.persona_nombre } : punto;
    }),
    asignados: propuesta.sugerencias.length,
    provinciasSinGestor: propuesta.provinciasSinCandidato
  };
}

/** Provincias distintas presentes en un conjunto de filas importadas. */
export function provinciasDeLosPuntos(puntos: Array<{ provincia?: string | null }>): string[] {
  const set = new Set<string>();
  for (const punto of puntos) {
    const provincia = normalizeProvince(punto.provincia || "");
    if (provincia) set.add(provincia);
  }
  return Array.from(set).sort((a, b) => a.localeCompare(b, "es"));
}

/** Trabajadores con puntos en la campaña (para el panel de direcciones de envío). */
export function trabajadoresConPuntos(puntos: PuntoAsignable[]): Array<{ id: string; nombre: string; puntos: number; sinDireccion: number }> {
  const map = new Map<string, { id: string; nombre: string; puntos: number; sinDireccion: number }>();
  for (const punto of puntos) {
    if (!punto.instalador_id) continue;
    const actual = map.get(punto.instalador_id) || { id: punto.instalador_id, nombre: punto.instalador_nombre || punto.instalador_id, puntos: 0, sinDireccion: 0 };
    actual.puntos += 1;
    if (!String(punto.direccion_envio || "").trim()) actual.sinDireccion += 1;
    map.set(punto.instalador_id, actual);
  }
  return Array.from(map.values()).sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));
}

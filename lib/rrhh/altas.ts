/**
 * MerchanOps · RR.HH. — lógica pura de ALTAS LABORALES.
 *
 * Este módulo es el "texto gris" del diseño: todo lo que el sistema CALCULA al
 * marcar unos trabajos pendientes (rango, imputaciones por CECO, si hace falta
 * alta nueva, si ya está cubierto o si hay que ampliar un alta existente).
 * Nadie teclea nada de esto: se recalcula siempre a partir de rrhh_altas.
 *
 * REGLAS DE LA CASA
 *  - Funciones puras: sin Supabase, sin React, sin `Date.now()` implícito. La
 *    única puerta a "hoy" es `hoyISO(ahora = new Date())`, y recibe la fecha por
 *    parámetro para que las pruebas no dependan del reloj.
 *  - Los tipos NO se redefinen aquí: vienen de `@/lib/rrhh/tipos`, que es la
 *    fuente de verdad compartida con la base (CHECK de v10_5/v10_6) y la UI.
 *  - Las fechas se manejan siempre como texto ISO `YYYY-MM-DD`. Comparar cadenas
 *    ISO es comparar fechas, y así no aparece ningún desfase de zona horaria por
 *    construir `Date` intermedios.
 *
 * DECISIONES QUE CONVIENE CONOCER (documentadas porque son opinables)
 *  - Una "imputación" es un CECO distinto dentro de la selección, no un trabajo.
 *    Por eso el texto del diseño cuadra siempre: «2 imputaciones a 3005, 3136».
 *    Dos trabajos del mismo CECO son UNA imputación a ese CECO.
 *  - `fecha_fin = null` en un alta significa alta abierta: cubre siempre por la
 *    derecha. Una `fecha_fin` presente pero ilegible se trata igual que `null`
 *    (no hay fecha de fin utilizable).
 *  - Un alta con `fecha_inicio` ilegible no se puede situar en el calendario, así
 *    que no cubre ni solapa: se ignora en el cálculo.
 */

import {
  AltaLaboral,
  EstadoSolicitudAlta,
  ResolucionAlta,
  TrabajoPendiente,
  estadosSolicitudAltaConMotivo,
  transicionesSolicitudAlta
} from "@/lib/rrhh/tipos";

/** Rango de trabajo cerrado por los dos extremos, en ISO `YYYY-MM-DD`. */
export type Rango = { inicio: string; fin: string };

/** Un CECO de la selección con los trabajos que se le imputan. */
export type ImputacionCeco = { ceco: string; trabajos: TrabajoPendiente[] };

/** Qué dice el sistema sobre la cobertura del rango seleccionado. */
export type ResultadoCobertura = {
  resolucion: ResolucionAlta;
  /** El alta implicada ('cubierta' y 'solape'); null en 'alta_nueva'. */
  alta: AltaLaboral | null;
  /** Solo en 'solape': hasta qué día hay que ampliar el alta. */
  ampliarHasta: string | null;
};

/** Cómo pinta la UI el texto calculado. */
export type TonoResolucion = "neutro" | "aviso" | "vacio";

export type TextoResolucion = {
  texto: string;
  tono: TonoResolucion;
  resolucion: ResolucionAlta | null;
  alta: AltaLaboral | null;
  ampliarHasta: string | null;
};

/** Etiqueta del grupo de trabajos que no traen CECO. */
export const CECO_SIN_ASIGNAR = "Sin CECO";

/** Estados de alta que NO cuentan para calcular cobertura. */
const ESTADOS_ALTA_DESCARTADOS = ["anulada", "baja"] as const;

const MILISEGUNDOS_POR_DIA = 86400000;

/** Zona en la que se cuentan los días laborales de MerchanOps. */
const ZONA_HORARIA = "Europe/Madrid";

/**
 * Única puerta a "hoy" de todo el módulo. Recibe el instante por parámetro para
 * que las pruebas (y cualquier cálculo reproducible) no dependan del reloj.
 *
 * Devuelve el día CIVIL en España, no el día UTC. La diferencia no es teórica:
 * en horario de verano España va dos horas por delante de UTC, así que entre las
 * 00:00 y las 02:00 `toISOString()` todavía devuelve la fecha de AYER. Con eso,
 * a las 00:30 del 1 de agosto un plazo que vencía el 31 de julio se habría
 * pintado como «pedir antes del 31/07» en vez de «plazo vencido», que es
 * justamente el aviso que esta pantalla existe para dar. La base ya lo hace bien
 * (`now() at time zone 'Europe/Madrid'`, v10_7:360); esto pone al cliente de
 * acuerdo con ella en vez de dejar que se contradigan.
 */
export function hoyISO(ahora: Date = new Date()): string {
  if (!(ahora instanceof Date) || Number.isNaN(ahora.getTime())) return "";
  // "en-CA" formatea como YYYY-MM-DD, que es exactamente el ISO que usa el módulo.
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: ZONA_HORARIA,
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }).format(ahora);
  } catch {
    // Entorno sin datos de zonas horarias: mejor la fecha UTC que ninguna.
    return normalizaFecha(ahora) ?? "";
  }
}

/**
 * Recorta un ISO o un timestamp a `YYYY-MM-DD`. Devuelve null si no hay una
 * fecha real detrás (texto vacío, basura, o un día que no existe como 2026-02-30).
 * Un `Date` se lee en UTC, que es como viajan las fechas de Supabase.
 */
export function normalizaFecha(valor: unknown): string | null {
  if (valor === null || valor === undefined) return null;

  if (valor instanceof Date) {
    const tiempo = valor.getTime();
    if (Number.isNaN(tiempo)) return null;
    return valor.toISOString().slice(0, 10);
  }

  const texto = String(valor).trim();
  if (!texto) return null;

  const encaje = /^(\d{4})-(\d{2})-(\d{2})/.exec(texto);
  if (!encaje) return null;

  const anio = Number(encaje[1]);
  const mes = Number(encaje[2]);
  const dia = Number(encaje[3]);
  if (mes < 1 || mes > 12 || dia < 1 || dia > 31) return null;

  // Roundtrip en UTC: descarta 31 de abril, 29 de febrero de un año no bisiesto, etc.
  const fecha = new Date(Date.UTC(anio, mes - 1, dia));
  if (fecha.getUTCFullYear() !== anio || fecha.getUTCMonth() !== mes - 1 || fecha.getUTCDate() !== dia) return null;

  return `${encaje[1]}-${encaje[2]}-${encaje[3]}`;
}

/** «2026-07-28» → «28/07» (el formato corto del diseño). "" si no hay fecha legible. */
export function formateaFechaCorta(iso: unknown): string {
  const fecha = normalizaFecha(iso);
  if (!fecha) return "";
  return `${fecha.slice(8, 10)}/${fecha.slice(5, 7)}`;
}

/** Días naturales entre dos fechas ISO (b - a). 0 si alguna no es legible. */
export function diasEntreFechas(a: unknown, b: unknown): number {
  const desde = normalizaFecha(a);
  const hasta = normalizaFecha(b);
  if (!desde || !hasta) return 0;
  return Math.round((Date.parse(`${hasta}T00:00:00Z`) - Date.parse(`${desde}T00:00:00Z`)) / MILISEGUNDOS_POR_DIA);
}

/**
 * Rango que abarcan los trabajos marcados: min(fecha_inicio) → max(fecha_fin).
 * Las fechas ilegibles se ignoran campo a campo. Si no queda ningún inicio o
 * ningún fin utilizable devuelve null (no hay nada que calcular).
 */
export function rangoDeTrabajos(trabajos: TrabajoPendiente[]): Rango | null {
  if (!Array.isArray(trabajos) || trabajos.length === 0) return null;

  let inicio: string | null = null;
  let fin: string | null = null;

  for (const trabajo of trabajos) {
    const desde = normalizaFecha(trabajo?.fecha_inicio);
    const hasta = normalizaFecha(trabajo?.fecha_fin);
    if (desde && (inicio === null || desde < inicio)) inicio = desde;
    if (hasta && (fin === null || hasta > fin)) fin = hasta;
  }

  if (!inicio || !fin) return null;
  // Dato incoherente (fin anterior al inicio): el rango se cierra en el inicio en
  // vez de devolver un intervalo imposible que rompería los cálculos de solape.
  return { inicio, fin: fin < inicio ? inicio : fin };
}

/**
 * Agrupa los trabajos por CECO, en orden ascendente de CECO. Los trabajos sin
 * CECO caen en un grupo «Sin CECO» que siempre va al final: es un aviso visible,
 * no un dato que se mezcle con los códigos reales.
 */
export function imputacionesPorCeco(trabajos: TrabajoPendiente[]): ImputacionCeco[] {
  const grupos = new Map<string, TrabajoPendiente[]>();

  for (const trabajo of Array.isArray(trabajos) ? trabajos : []) {
    if (!trabajo) continue;
    const ceco = String(trabajo.ceco ?? "").trim() || CECO_SIN_ASIGNAR;
    const actual = grupos.get(ceco);
    if (actual) actual.push(trabajo);
    else grupos.set(ceco, [trabajo]);
  }

  return Array.from(grupos.entries())
    .map(([ceco, lista]) => ({ ceco, trabajos: lista }))
    .sort((a, b) => {
      if (a.ceco === CECO_SIN_ASIGNAR) return b.ceco === CECO_SIN_ASIGNAR ? 0 : 1;
      if (b.ceco === CECO_SIN_ASIGNAR) return -1;
      return a.ceco.localeCompare(b.ceco, "es", { numeric: true, sensitivity: "base" });
    });
}

/** Altas que cuentan para calcular cobertura: fuera las anuladas y las de baja. */
export function altasVigentes(altas: AltaLaboral[]): AltaLaboral[] {
  if (!Array.isArray(altas)) return [];
  return altas.filter(alta => Boolean(alta) && !ESTADOS_ALTA_DESCARTADOS.includes(alta.estado as (typeof ESTADOS_ALTA_DESCARTADOS)[number]));
}

/** Rango del alta, con `fin: null` cuando el alta está abierta. null si no se puede situar. */
function rangoDeAlta(alta: AltaLaboral | null | undefined): { inicio: string; fin: string | null } | null {
  if (!alta) return null;
  const inicio = normalizaFecha(alta.fecha_inicio);
  if (!inicio) return null;
  return { inicio, fin: normalizaFecha(alta.fecha_fin) };
}

function normalizaRango(rango: Rango | null | undefined): Rango | null {
  if (!rango) return null;
  const inicio = normalizaFecha(rango.inicio);
  const fin = normalizaFecha(rango.fin);
  if (!inicio || !fin) return null;
  return { inicio, fin: fin < inicio ? inicio : fin };
}

/** El alta tapa el rango entero: empieza antes (o el mismo día) y acaba después (o el mismo día). */
export function cubreRango(alta: AltaLaboral, rango: Rango): boolean {
  const laAlta = rangoDeAlta(alta);
  const elRango = normalizaRango(rango);
  if (!laAlta || !elRango) return false;
  return laAlta.inicio <= elRango.inicio && (laAlta.fin === null || laAlta.fin >= elRango.fin);
}

/** Hay días en común pero el alta NO tapa el rango entero. Un alta contigua (acaba la víspera) no solapa. */
export function solapaRango(alta: AltaLaboral, rango: Rango): boolean {
  const laAlta = rangoDeAlta(alta);
  const elRango = normalizaRango(rango);
  if (!laAlta || !elRango) return false;
  const hayInterseccion = laAlta.inicio <= elRango.fin && (laAlta.fin === null || laAlta.fin >= elRango.inicio);
  return hayInterseccion && !cubreRango(alta, elRango);
}

/** Días del rango que ya están cubiertos por el alta. 0 si no se tocan. */
export function interseccionDias(alta: AltaLaboral, rango: Rango): number {
  const laAlta = rangoDeAlta(alta);
  const elRango = normalizaRango(rango);
  if (!laAlta || !elRango) return 0;
  const desde = laAlta.inicio > elRango.inicio ? laAlta.inicio : elRango.inicio;
  const hasta = laAlta.fin === null || laAlta.fin > elRango.fin ? elRango.fin : laAlta.fin;
  if (desde > hasta) return 0;
  return diasEntreFechas(desde, hasta) + 1;
}

/**
 * El cálculo central: ¿hace falta alta nueva, ya está cubierto, o hay que ampliar?
 *  - Si alguna alta vigente cubre el rango → 'cubierta' (gana la indefinida; a
 *    igualdad, la de fecha_inicio más temprana).
 *  - Si no, si alguna solapa → 'solape' con la de mayor intersección.
 *  - Si no → 'alta_nueva'.
 * El desempate final es por número de alta / id para que el resultado sea estable
 * pase lo que pase con el orden en que lleguen las filas de la base.
 */
export function resolverCobertura(rango: Rango, altas: AltaLaboral[]): ResultadoCobertura {
  const elRango = normalizaRango(rango);
  if (!elRango) return { resolucion: "alta_nueva", alta: null, ampliarHasta: null };

  const vigentes = altasVigentes(altas);

  const cubren = vigentes.filter(alta => cubreRango(alta, elRango));
  if (cubren.length > 0) {
    const elegida = cubren.slice().sort((a, b) => {
      const indefinida = Number(b.tipo === "indefinido") - Number(a.tipo === "indefinido");
      if (indefinida !== 0) return indefinida;
      const inicioA = normalizaFecha(a.fecha_inicio) ?? "";
      const inicioB = normalizaFecha(b.fecha_inicio) ?? "";
      if (inicioA !== inicioB) return inicioA < inicioB ? -1 : 1;
      return desempate(a, b);
    })[0];
    return { resolucion: "cubierta", alta: elegida, ampliarHasta: null };
  }

  const solapan = vigentes.filter(alta => solapaRango(alta, elRango));
  if (solapan.length > 0) {
    const elegida = solapan.slice().sort((a, b) => {
      const dias = interseccionDias(b, elRango) - interseccionDias(a, elRango);
      if (dias !== 0) return dias;
      const inicioA = normalizaFecha(a.fecha_inicio) ?? "";
      const inicioB = normalizaFecha(b.fecha_inicio) ?? "";
      if (inicioA !== inicioB) return inicioA < inicioB ? -1 : 1;
      return desempate(a, b);
    })[0];
    return { resolucion: "solape", alta: elegida, ampliarHasta: elRango.fin };
  }

  return { resolucion: "alta_nueva", alta: null, ampliarHasta: null };
}

function desempate(a: AltaLaboral, b: AltaLaboral): number {
  const claveA = `${a.numero_alta ?? ""}·${a.id ?? ""}`;
  const claveB = `${b.numero_alta ?? ""}·${b.id ?? ""}`;
  return claveA.localeCompare(claveB, "es", { numeric: true });
}

/**
 * Estado que el sistema PROPONE para la solicitud. RR.HH. puede cambiarlo después
 * (la columna "Estado" del diseño la rellena RR.HH.), pero la propuesta sale de aquí.
 */
export function estadoSugerido(resolucion: ResolucionAlta, alta?: AltaLaboral | null): EstadoSolicitudAlta {
  if (resolucion === "solape") return "se_solapa";
  if (resolucion === "cubierta") return alta?.tipo === "indefinido" ? "ya_alta_indefinida" : "solo_imputacion";
  return "pendiente";
}

/** «3005, 3136» a partir de las imputaciones. */
function listaCecos(imputaciones: ImputacionCeco[]): string {
  return imputaciones.map(grupo => grupo.ceco).join(", ");
}

/** «1 imputación a 3210» / «2 imputaciones a 3005, 3136». */
function fraseImputaciones(imputaciones: ImputacionCeco[]): string {
  const total = imputaciones.length;
  const palabra = total === 1 ? "imputación" : "imputaciones";
  return `${total} ${palabra} a ${listaCecos(imputaciones)}`;
}

/** Cómo se nombra el alta en el texto: con su número si RR.HH. ya lo tecleó. */
function nombraAlta(alta: AltaLaboral | null, conNumero: (numero: string) => string, sinNumero: string): string {
  const numero = String(alta?.numero_alta ?? "").trim();
  return numero ? conNumero(numero) : sinNumero;
}

/**
 * El texto gris del diseño, literal. Es lo único que lee la pantalla de altas:
 *
 *   «Alta nueva del 28/07 al 31/07 · 2 imputaciones a 3005, 3136»
 *   «Cubierto por el alta 18832 · no hace falta alta nueva · 1 imputación a 3210»
 *   «Se solapa con el alta 18832 (20/07 → 29/07) · ampliar hasta el 31/07»
 *
 * Sin selección devuelve el texto de invitación con tono 'vacio'. Si hay trabajos
 * marcados pero ninguno trae fechas legibles no se finge que no hay selección: se
 * avisa, porque ahí falta un dato que alguien tiene que arreglar.
 */
export function textoResolucion(trabajos: TrabajoPendiente[], altas: AltaLaboral[]): TextoResolucion {
  const seleccion = Array.isArray(trabajos) ? trabajos.filter(Boolean) : [];

  if (seleccion.length === 0) {
    return { texto: "Selecciona trabajos para calcular el alta", tono: "vacio", resolucion: null, alta: null, ampliarHasta: null };
  }

  const rango = rangoDeTrabajos(seleccion);
  if (!rango) {
    return { texto: "Los trabajos seleccionados no tienen fechas válidas", tono: "aviso", resolucion: null, alta: null, ampliarHasta: null };
  }

  const imputaciones = imputacionesPorCeco(seleccion);
  const cobertura = resolverCobertura(rango, altas);

  if (cobertura.resolucion === "cubierta") {
    const cabecera = nombraAlta(cobertura.alta, numero => `Cubierto por el alta ${numero}`, "Cubierto por un alta vigente");
    return {
      texto: `${cabecera} · no hace falta alta nueva · ${fraseImputaciones(imputaciones)}`,
      tono: "neutro",
      resolucion: "cubierta",
      alta: cobertura.alta,
      ampliarHasta: null
    };
  }

  if (cobertura.resolucion === "solape") {
    const cabecera = nombraAlta(cobertura.alta, numero => `Se solapa con el alta ${numero}`, "Se solapa con un alta vigente");
    const desde = formateaFechaCorta(cobertura.alta?.fecha_inicio);
    const hasta = formateaFechaCorta(cobertura.alta?.fecha_fin) || "abierta";
    return {
      texto: `${cabecera} (${desde} → ${hasta}) · ampliar hasta el ${formateaFechaCorta(cobertura.ampliarHasta)}`,
      tono: "aviso",
      resolucion: "solape",
      alta: cobertura.alta,
      ampliarHasta: cobertura.ampliarHasta
    };
  }

  return {
    texto: `Alta nueva del ${formateaFechaCorta(rango.inicio)} al ${formateaFechaCorta(rango.fin)} · ${fraseImputaciones(imputaciones)}`,
    tono: "neutro",
    resolucion: "alta_nueva",
    alta: null,
    ampliarHasta: null
  };
}

/** Espejo del trigger guardián de la base: la UI propone, la base decide. */
export function puedeTransicionar(desde: EstadoSolicitudAlta, hacia: EstadoSolicitudAlta): boolean {
  const permitidas = transicionesSolicitudAlta[desde];
  return Array.isArray(permitidas) && permitidas.includes(hacia);
}

/** Nada se cierra en negativo sin explicación escrita. */
export function exigeMotivo(estado: EstadoSolicitudAlta): boolean {
  return estadosSolicitudAltaConMotivo.includes(estado);
}

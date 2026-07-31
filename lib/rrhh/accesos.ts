/**
 * MerchanOps · RR.HH. — lógica pura de ACCESOS A CENTRO.
 *
 * Es el "texto gris" de la pantalla de accesos: el gestor elige trabajador,
 * cadena y fecha de trabajo, marca chips de centros, y el SISTEMA calcula cuántas
 * solicitudes salen de ahí y hasta cuándo hay plazo para pedirlas. Nadie teclea
 * ninguna de estas frases: se recalculan siempre a partir del catálogo de cadenas.
 *
 *   «Alcampo tramita por centro · 3 centros → 3 accesos · pedir antes del 29/07»
 *   «Media Markt tramita por cadena · 4 centros → 1 acceso · pedir antes del 31/07»
 *   «El Corte Inglés · plazo vencido el 25/07»
 *
 * REGLAS DE LA CASA
 *  - Funciones puras: sin Supabase, sin React, sin reloj implícito. La única
 *    puerta a "hoy" es el parámetro `hoy`, con `hoyISO()` como valor por defecto,
 *    para que las pruebas no dependan de cuándo se ejecuten.
 *  - Los tipos NO se redefinen aquí: vienen de `@/lib/rrhh/tipos`, fuente de
 *    verdad compartida con los CHECK de la base y con la UI.
 *  - Las utilidades de fecha se reutilizan de `@/lib/rrhh/altas` (`normalizaFecha`,
 *    `formateaFechaCorta`, `hoyISO`): una sola forma de leer y pintar fechas en
 *    todo el módulo de RR.HH.
 *
 * DECISIONES QUE CONVIENE CONOCER (documentadas porque son opinables)
 *  - D4: los accesos son PUNTUALES (trabajador + centro + fecha de trabajo). Aquí
 *    no hay vigencias ni acreditaciones que caduquen.
 *  - `lead_time_dias = 0` NO significa "sin fecha límite": significa que el plazo
 *    es el propio día de trabajo. Es lo que dice el diseño de Media Markt
 *    (trabajo el 31/07, «pedir antes del 31/07»).
 *  - El día límite ESTÁ en plazo. Solo se considera fuera de plazo cuando el
 *    límite ya ha quedado atrás (`fecha_limite < hoy`).
 *  - Un lead time negativo o ilegible se trata como 0: una cadena no puede exigir
 *    menos que ninguna antelación, y un dato roto no debe adelantar el plazo.
 *  - En modo "centro", dos chips del mismo centro son UN acceso: se deduplica por
 *    id para no mandar solicitudes repetidas a la cadena.
 */

import {
  Cadena,
  Centro,
  EstadoSolicitudAcceso,
  SolicitudAcceso,
  estadosSolicitudAccesoConMotivo,
  transicionesSolicitudAcceso
} from "@/lib/rrhh/tipos";
import { formateaFechaCorta, hoyISO, normalizaFecha } from "@/lib/rrhh/altas";

/**
 * Un acceso que habrá que solicitar. `centro_id: null` = "toda la cadena"
 * (modo_tramite 'cadena'), tal y como lo guarda rrhh_solicitudes_acceso.
 */
export type AccesoNecesario = {
  centro_id: string | null;
  centro_nombre: string | null;
};

/** Situación de la solicitud respecto al plazo que exige la cadena. */
export type EstadoDePlazo = "en_plazo" | "fuera_de_plazo";

/** Cómo pinta la UI el texto calculado. */
export type TonoAcceso = "neutro" | "aviso" | "error" | "vacio";

export type TextoAcceso = {
  texto: string;
  tono: TonoAcceso;
};

/** Lo mínimo que hace falta para decidir si un acceso concedido se quedó sin usar. */
export type SolicitudAccesoConsumible = Pick<SolicitudAcceso, "fecha_trabajo" | "concedido_at" | "consumido_at">;

const MILISEGUNDOS_POR_DIA = 86400000;

/** Días de antelación utilizables: entero, nunca negativo, 0 si el dato viene roto. */
function normalizaLeadTime(dias: unknown): number {
  const numero = Number(dias);
  if (!Number.isFinite(numero) || numero <= 0) return 0;
  return Math.round(numero);
}

/**
 * Cuántas solicitudes de acceso salen de la selección de chips y con qué centro.
 *  - modo 'centro': una por centro marcado, en el orden en que llegaron.
 *  - modo 'cadena': UNA sola, sin centro ("toda la cadena").
 *  - sin centros marcados: ninguna.
 */
export function accesosNecesarios(cadena: Cadena, centrosSeleccionados: Centro[]): AccesoNecesario[] {
  const centros = (Array.isArray(centrosSeleccionados) ? centrosSeleccionados : []).filter(Boolean);
  if (centros.length === 0) return [];

  if (cadena?.modo_tramite === "cadena") {
    return [{ centro_id: null, centro_nombre: null }];
  }

  const vistos = new Set<string>();
  const accesos: AccesoNecesario[] = [];

  for (const centro of centros) {
    const id = String(centro.id ?? "").trim();
    // Sin id no hay forma de identificar el centro en la solicitud: se ignora.
    if (!id || vistos.has(id)) continue;
    vistos.add(id);
    accesos.push({ centro_id: id, centro_nombre: centro.nombre ?? null });
  }

  return accesos;
}

/**
 * Último día en el que la cadena acepta la solicitud: fecha de trabajo menos el
 * lead time. Aritmética en UTC para que el resultado no dependa del huso horario
 * de quien lo calcule. null si la fecha de trabajo no es legible.
 */
export function fechaLimiteSolicitud(fechaTrabajo: string, leadTimeDias: number): string | null {
  const trabajo = normalizaFecha(fechaTrabajo);
  if (!trabajo) return null;

  const dias = normalizaLeadTime(leadTimeDias);
  if (dias === 0) return trabajo;

  const limite = new Date(Date.parse(`${trabajo}T00:00:00Z`) - dias * MILISEGUNDOS_POR_DIA);
  return limite.toISOString().slice(0, 10);
}

/**
 * ¿Llegamos a tiempo? El propio día límite SÍ está en plazo: solo se está fuera
 * cuando el límite ya pasó. Sin límite calculable no hay plazo que incumplir.
 */
export function estadoDePlazo(fechaLimite: string | null, hoy: string = hoyISO()): EstadoDePlazo {
  const limite = normalizaFecha(fechaLimite);
  const dia = normalizaFecha(hoy);
  if (!limite || !dia) return "en_plazo";
  return limite < dia ? "fuera_de_plazo" : "en_plazo";
}

/**
 * Estado con el que nace la solicitud. 'fuera_de_plazo' es un estado real de la
 * base (no un adorno): RR.HH. lo ve en la cola y decide si aun así lo pide.
 */
export function estadoInicialAcceso(
  fechaTrabajo: string,
  leadTimeDias: number,
  hoy: string = hoyISO()
): EstadoSolicitudAcceso {
  const limite = fechaLimiteSolicitud(fechaTrabajo, leadTimeDias);
  return estadoDePlazo(limite, hoy) === "fuera_de_plazo" ? "fuera_de_plazo" : "pendiente";
}

/**
 * Acceso concedido que se quedó sin usar: la cadena lo dio, el día de trabajo ya
 * pasó y nadie lo consumió. Es el aviso que evita quemar cupo de la cadena.
 */
export function esConcedidoNoConsumido(solicitud: SolicitudAccesoConsumible, hoy: string = hoyISO()): boolean {
  if (!solicitud) return false;
  if (solicitud.concedido_at === null || solicitud.concedido_at === undefined) return false;
  if (solicitud.consumido_at !== null && solicitud.consumido_at !== undefined) return false;

  const trabajo = normalizaFecha(solicitud.fecha_trabajo);
  const dia = normalizaFecha(hoy);
  if (!trabajo || !dia) return false;

  return trabajo < dia;
}

/** «1 centro» / «3 centros». */
function fraseCentros(total: number): string {
  return `${total} ${total === 1 ? "centro" : "centros"}`;
}

/** «1 acceso» / «3 accesos». */
function fraseAccesos(total: number): string {
  return `${total} ${total === 1 ? "acceso" : "accesos"}`;
}

/**
 * El texto gris del diseño, literal. Es lo único que lee la pantalla de accesos:
 *
 *   «Alcampo tramita por centro · 3 centros → 3 accesos · pedir antes del 29/07»
 *   «Media Markt tramita por cadena · 4 centros → 1 acceso · pedir antes del 31/07»
 *   «El Corte Inglés · plazo vencido el 25/07»
 *
 * Sin cadena o sin centros marcados invita a marcar (tono 'vacio'): sin cadena no
 * hay chips que marcar, así que ambas situaciones son la misma para el gestor.
 */
export function textoSolicitudAcceso(
  cadena: Cadena,
  centrosSeleccionados: Centro[],
  fechaTrabajo: string,
  hoy: string = hoyISO()
): TextoAcceso {
  const centros = (Array.isArray(centrosSeleccionados) ? centrosSeleccionados : []).filter(Boolean);

  if (!cadena || centros.length === 0) {
    return { texto: "Selecciona centros para calcular la solicitud", tono: "vacio" };
  }

  const trabajo = normalizaFecha(fechaTrabajo);
  if (!trabajo) {
    return { texto: "Indica la fecha de trabajo", tono: "vacio" };
  }

  const limite = fechaLimiteSolicitud(trabajo, cadena.lead_time_dias);
  const nombre = String(cadena.nombre ?? "").trim();

  if (estadoDePlazo(limite, hoy) === "fuera_de_plazo") {
    return { texto: `${nombre} · plazo vencido el ${formateaFechaCorta(limite)}`, tono: "error" };
  }

  const accesos = accesosNecesarios(cadena, centros);
  const modo = cadena.modo_tramite === "cadena" ? "cadena" : "centro";

  return {
    texto:
      `${nombre} tramita por ${modo} · ${fraseCentros(centros.length)} → ` +
      `${fraseAccesos(accesos.length)} · pedir antes del ${formateaFechaCorta(limite)}`,
    tono: "neutro"
  };
}

/** Espejo del trigger guardián de la base: la UI propone, la base decide. */
export function puedeTransicionarAcceso(desde: EstadoSolicitudAcceso, hacia: EstadoSolicitudAcceso): boolean {
  const permitidas = transicionesSolicitudAcceso[desde];
  return Array.isArray(permitidas) && permitidas.includes(hacia);
}

/** Nada se cierra en negativo sin explicación escrita. */
export function exigeMotivoAcceso(estado: EstadoSolicitudAcceso): boolean {
  return estadosSolicitudAccesoConMotivo.includes(estado);
}

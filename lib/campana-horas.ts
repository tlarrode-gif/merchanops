/**
 * MerchanOps · Grandes Campañas — horas trabajadas y kilometraje (v11.5).
 *
 * POR QUÉ EXISTE ESTE MÓDULO
 * Hay campañas que no se pagan por punto sino POR HORAS: el trabajador reporta a
 * qué hora entró y a qué hora salió, y administración configura el precio de la
 * hora. Ese dato llega por dos caminos que no se parecen en nada —tecleado en la
 * ficha del punto, o volcado desde el Excel del reporte del cliente— y el Excel
 * puede traer la hora de cinco maneras distintas (texto "8:30", texto "08:30:00",
 * un `Date` de SheetJS, o la fracción de día 0,354166… con la que Excel guarda las
 * horas de verdad). Interpretar eso a ojo dentro del parser era garantía de que
 * alguien acabara cobrando 0 horas por un turno de ocho.
 *
 * REGLAS DE LA CASA
 *  - Todo aquí es PURO: sin Supabase, sin React y sin reloj. Se prueba en
 *    tests/campanas-horas.test.ts.
 *  - Un dato que no se entiende NO se convierte en 0: devuelve null y quien
 *    llama decide (en pagos eso significa obligación BLOQUEADA, no gratis).
 *  - Una salida anterior a la entrada NO se interpreta como turno de noche. Es
 *    tan probable que sea un turno nocturno real como que sea una celda mal
 *    tecleada, y adivinar en un cálculo de nómina es exactamente lo que no se
 *    puede hacer. Se devuelve el motivo y el pago queda bloqueado.
 */

/** Redondeo a 2 decimales sin arrastrar el ruido binario de la coma flotante. */
function redondear2(valor: number) {
  return Math.round(valor * 100) / 100;
}

/**
 * Minutos desde medianoche de una hora que puede llegar como:
 *   - texto "8", "8:30", "08:30:00", "8.30" o "8,30" (con coma decimal española);
 *   - número: fracción de día de Excel (0,354166… = 08:30);
 *   - Date (SheetJS con cellDates, o una hora ya normalizada).
 * Devuelve null si no se reconoce o si cae fuera del día.
 */
export function minutosDeHora(valor: unknown): number | null {
  if (valor === null || valor === undefined || valor === "") return null;

  if (valor instanceof Date) {
    if (Number.isNaN(valor.getTime())) return null;
    return valor.getHours() * 60 + valor.getMinutes();
  }

  if (typeof valor === "number") {
    // Un negativo se rechaza ANTES de nada: `Math.floor` redondea hacia -infinito,
    // así que la parte fraccionaria de -0,5 sale 0,5 y "menos media hora" habría
    // acabado leyéndose como las 12:00.
    if (!Number.isFinite(valor) || valor < 0) return null;
    // Excel guarda las horas como fracción de día. Un serial completo de fecha y
    // hora (45.000,354) trae la parte entera de la fecha: se descarta.
    const fraccion = valor - Math.floor(valor);
    // Un entero puro (8) es "las 8", no "0 días": Excel nunca guarda 8 para las 8:00,
    // pero una celda de texto convertida a número sí llega así.
    if (fraccion === 0 && valor <= 24) return Math.round(valor * 60);
    return Math.round(fraccion * 24 * 60);
  }

  const texto = String(valor).trim();
  if (!texto) return null;

  // "8:30", "08:30:00", "8h30", "8 h 30"
  const conSeparador = texto.match(/^(\d{1,2})\s*[:hH.,]\s*(\d{1,2})(?:\s*[:.]\s*(\d{1,2}))?$/);
  if (conSeparador) {
    const horas = Number(conSeparador[1]);
    const minutos = Number(conSeparador[2]);
    // "8.30" con separador decimal es ambiguo: aquí se lee SIEMPRE como 8 h 30 min,
    // que es como lo escribe quien rellena un parte de horas. 8,5 (media hora en
    // decimal) llegaría como "8,50" y daría 8 h 50: por eso la ficha del punto usa
    // campos de tipo `time` y esta ruta es solo para el Excel.
    if (horas > 24 || minutos > 59) return null;
    const total = horas * 60 + minutos;
    return total > 24 * 60 ? null : total;
  }

  // "8" o "18" a secas: la hora en punto.
  const soloHoras = texto.match(/^(\d{1,2})$/);
  if (soloHoras) {
    const horas = Number(soloHoras[1]);
    return horas <= 24 ? horas * 60 : null;
  }

  return null;
}

/** Formatea minutos como "HH:MM", el formato que entiende la columna `time`. */
export function horaDesdeMinutos(minutos: number | null | undefined): string | null {
  if (minutos === null || minutos === undefined || !Number.isFinite(minutos)) return null;
  if (minutos < 0 || minutos > 24 * 60) return null;
  const horas = Math.floor(minutos / 60);
  const resto = Math.round(minutos % 60);
  return `${String(horas).padStart(2, "0")}:${String(resto).padStart(2, "0")}`;
}

/** Normaliza cualquier entrada de hora al "HH:MM" que se guarda en la base. */
export function normalizarHora(valor: unknown): string | null {
  return horaDesdeMinutos(minutosDeHora(valor));
}

export type CalculoHoras =
  | { horas: number; error?: undefined }
  | { horas: null; error: "sin_datos" | "hora_no_reconocida" | "salida_anterior_a_entrada" };

/**
 * Horas trabajadas entre una entrada y una salida, con dos decimales.
 * `sin_datos` = falta alguna de las dos (no es un error del usuario: simplemente
 * todavía no se ha reportado). Los otros dos SÍ son datos que hay que corregir.
 */
export function horasEntreMarcas(entrada: unknown, salida: unknown): CalculoHoras {
  const hayEntrada = entrada !== null && entrada !== undefined && String(entrada).trim() !== "";
  const haySalida = salida !== null && salida !== undefined && String(salida).trim() !== "";
  if (!hayEntrada || !haySalida) return { horas: null, error: "sin_datos" };

  const desde = minutosDeHora(entrada);
  const hasta = minutosDeHora(salida);
  if (desde === null || hasta === null) return { horas: null, error: "hora_no_reconocida" };
  if (hasta < desde) return { horas: null, error: "salida_anterior_a_entrada" };

  return { horas: redondear2((hasta - desde) / 60) };
}

/** Número no negativo (horas o kilómetros) o null. Nunca convierte basura en 0. */
export function numeroReportado(valor: unknown): number | null {
  if (valor === null || valor === undefined || valor === "") return null;
  if (typeof valor === "number") return Number.isFinite(valor) && valor >= 0 ? redondear2(valor) : null;
  const texto = String(valor).trim();
  if (!texto) return null;
  // Igual que el parser de importes: se quitan las unidades, el separador de
  // millares y se acepta la coma decimal española.
  const limpio = texto
    .replace(/(km|kms|kilometros|kilómetros|h|hrs|horas)\.?$/i, "")
    .replace(/\s/g, "")
    .replace(/\.(?=\d{3}(\D|$))/g, "")
    .replace(",", ".");
  const numero = Number(limpio);
  return Number.isFinite(numero) && numero >= 0 ? redondear2(numero) : null;
}

export type PuntoHoras = {
  hora_entrada?: string | null;
  hora_salida?: string | null;
  horas_trabajadas?: number | null;
};

/**
 * Horas que se PAGAN de un punto. Prioriza el cálculo entrada→salida sobre el
 * total importado: si un reporte trae las tres cosas y no cuadran, manda el par
 * de marcas horarias, que es el dato primario. Cuando solo hay total importado
 * (informes que ya vienen sumados) se usa ese.
 */
export function horasDelPunto(punto: PuntoHoras): CalculoHoras {
  const calculado = horasEntreMarcas(punto.hora_entrada, punto.hora_salida);
  if (calculado.horas !== null) return calculado;
  if (calculado.error !== "sin_datos") return calculado;
  const total = numeroReportado(punto.horas_trabajadas);
  return total === null ? { horas: null, error: "sin_datos" } : { horas: total };
}

export const erroresHorasLabels: Record<NonNullable<CalculoHoras["error"]>, string> = {
  sin_datos: "faltan la hora de entrada y la de salida",
  hora_no_reconocida: "la hora de entrada o la de salida no se entiende",
  salida_anterior_a_entrada: "la hora de salida es anterior a la de entrada"
};

/** Configuración de pago de la campaña que necesita el cálculo de un punto. */
export type ConfigPagoCampana = {
  pago_por_horas?: boolean | null;
  tarifa_hora?: number | null;
  pago_kilometraje?: boolean | null;
  tarifa_km?: number | null;
};

export type PuntoValorable = PuntoHoras & { importe?: number | null; kilometros?: number | null };

/**
 * Lo que vale un punto para el trabajador, en euros: importe del punto o
 * `horas × tarifa` según el modo de la campaña, más el kilometraje si se paga.
 *
 * Es un cálculo de PRESENTACIÓN (KPIs, resúmenes, informes). El dinero que se
 * liquida sale del motor de pagos (`computeCampanaPuntoObligations`), que además
 * bloquea lo que aquí simplemente suma 0 por falta de datos. Los dos usan las
 * mismas reglas a propósito, y `tests/campanas-horas.test.ts` comprueba que no se
 * separan: un KPI que dijera una cifra y Pagos otra es peor que no tener KPI.
 */
export function valorPuntoEur(punto: PuntoValorable, campana: ConfigPagoCampana = {}): number {
  const trabajo = campana.pago_por_horas
    ? (horasDelPunto(punto).horas || 0) * Number(campana.tarifa_hora || 0)
    : Number(punto.importe || 0);
  const kilometraje = campana.pago_kilometraje
    ? Number(punto.kilometros || 0) * Number(campana.tarifa_km || 0)
    : 0;
  return redondear2(trabajo + kilometraje);
}

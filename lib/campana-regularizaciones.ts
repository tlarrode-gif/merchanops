/**
 * MerchanOps · Grandes Campañas — regularizaciones (v11.2).
 *
 * POR QUÉ EXISTE ESTE MÓDULO
 * Toda campaña deja pagos fuera del circuito: el desplazamiento extra, la hora
 * de más, el material repuesto, la revisita. Hoy se arregla por WhatsApp y
 * administración se entera cuando el trabajador reclama, sin saber ya si aquello
 * era refacturable al cliente.
 *
 * CÓMO FUNCIONA
 * El gestor PROPONE; administración APRUEBA o RECHAZA con motivo. La aprobación
 * crea la línea en `payment_obligations` dentro de la misma transacción (lo hace
 * el RPC, no este módulo). Aquí vive la validación previa —para dar un error
 * decente antes de ir a la base— y los cálculos de la pantalla.
 *
 * REGLAS DE LA CASA
 *  - Importes SIEMPRE en céntimos enteros, como el ledger. La conversión desde
 *    lo que teclea una persona es la parte delicada y por eso está aislada en
 *    `eurosACentimos`, con pruebas.
 *  - Las validaciones de aquí están DUPLICADAS en el RPC a propósito: estas dan
 *    buenos mensajes, las de la base son la defensa.
 */

import { supabase } from "@/lib/supabase";

export type ConceptoTipo =
  | "desplazamiento_extra"
  | "hora_adicional"
  | "material_repuesto"
  | "revisita"
  | "error_tarifa"
  | "otro";

export type EstadoRegularizacion = "propuesta" | "aprobada" | "rechazada";

export const conceptoTipos: ConceptoTipo[] = [
  "desplazamiento_extra",
  "hora_adicional",
  "material_repuesto",
  "revisita",
  "error_tarifa",
  "otro"
];

export const conceptoLabels: Record<ConceptoTipo, string> = {
  desplazamiento_extra: "Desplazamiento extra",
  hora_adicional: "Hora adicional",
  material_repuesto: "Material repuesto",
  revisita: "Revisita",
  error_tarifa: "Error de tarifa",
  otro: "Otro"
};

/**
 * Pista para administración. `error_tarifa` no es un extra: es una tarifa mal
 * puesta, y si se repite hay que corregir la campaña, no seguir regularizando.
 */
export const conceptoAyuda: Record<ConceptoTipo, string> = {
  desplazamiento_extra: "Un viaje que no estaba previsto en el precio del punto.",
  hora_adicional: "Tiempo trabajado por encima de lo pactado.",
  material_repuesto: "Material que hubo que reponer o volver a llevar.",
  revisita: "Una segunda visita al mismo punto.",
  error_tarifa: "El precio del punto estaba mal. Si se repite, corrige la tarifa de la campaña en vez de regularizar una por una.",
  otro: "Cualquier otro concepto. Explícalo bien: es lo que leerá administración para facturarlo."
};

export const estadoLabels: Record<EstadoRegularizacion, string> = {
  propuesta: "Pendiente de aprobar",
  aprobada: "Aprobada",
  rechazada: "Rechazada"
};

export type Regularizacion = {
  id: string;
  campana_id: string;
  punto_id?: string | null;
  concepto_tipo: ConceptoTipo;
  concepto: string;
  importe_cents: number;
  fecha: string;
  mes_contable: string;
  trabajador_id?: string | null;
  trabajador_nombre?: string | null;
  refacturable?: boolean | null;
  estado: EstadoRegularizacion;
  motivo_resolucion?: string | null;
  obligation_key?: string | null;
  solicitada_por?: string | null;
  solicitada_por_nombre?: string | null;
  solicitada_at: string;
  resuelta_por_nombre?: string | null;
  resuelta_at?: string | null;
  // De la vista v_campana_regularizaciones
  campana_nombre?: string | null;
  punto_nombre?: string | null;
  provincia?: string | null;
};

/**
 * Convierte lo que teclea una persona a céntimos enteros. Acepta coma o punto
 * decimal y el símbolo del euro; rechaza lo que no sea un número.
 * Devuelve null cuando no hay forma de interpretarlo.
 */
export function eurosACentimos(entrada: string | number | null | undefined): number | null {
  if (entrada === null || entrada === undefined || entrada === "") return null;
  if (typeof entrada === "number") {
    return Number.isFinite(entrada) ? Math.round(entrada * 100) : null;
  }
  const sinAdornos = String(entrada).replace(/€|\s/g, "");
  let limpio: string;
  if (sinAdornos.includes(",")) {
    // Con coma presente no hay duda: la coma es el decimal y el punto agrupa millares.
    limpio = sinAdornos.replace(/\./g, "").replace(",", ".");
  } else if (/^-?[1-9]\d{0,2}(\.\d{3})+$/.test(sinAdornos)) {
    // Solo se trata el punto como separador de millares cuando el número está
    // AGRUPADO de verdad («1.250», «12.500»). Sin esta condición «0.125» se leía
    // como 125 € en vez de 0,13 €, que es un error de tres órdenes de magnitud
    // en un campo que crea líneas de pago.
    limpio = sinAdornos.replace(/\./g, "");
  } else {
    limpio = sinAdornos;
  }
  if (!/^-?\d+(\.\d+)?$/.test(limpio)) return null;
  const numero = Number(limpio);
  if (!Number.isFinite(numero)) return null;
  return Math.round(numero * 100);
}

export function centimosAEuros(cents: number): string {
  return new Intl.NumberFormat("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(cents || 0) / 100) + " €";
}

export type BorradorRegularizacion = {
  campanaId: string;
  puntoId?: string | null;
  conceptoTipo: ConceptoTipo;
  concepto: string;
  importe: string;
  fecha: string;
  trabajadorId?: string | null;
  trabajadorNombre?: string | null;
};

/**
 * Motivo por el que una propuesta no se puede enviar, o null si se puede.
 * `mesesCerrados` es la lista de meses contables cerrados (v7.4): contra uno de
 * ellos no se regulariza, y es mejor decirlo aquí que después de escribirlo todo.
 */
export function validarRegularizacion(borrador: BorradorRegularizacion, mesesCerrados: string[] = []): string | null {
  if (!borrador.campanaId) return "Falta la campaña.";
  if (!String(borrador.concepto || "").trim()) {
    return "Explica en el concepto qué se está regularizando: es lo que administración va a leer para facturarlo.";
  }
  if (!borrador.fecha) return "Indica la fecha: de ella sale el mes contable.";
  const cents = eurosACentimos(borrador.importe);
  if (cents === null) return "El importe no es un número válido.";
  if (cents === 0) return "El importe no puede ser cero.";
  const mes = mesContableDe(borrador.fecha);
  if (mesesCerrados.includes(mes)) {
    return `El mes contable ${mes} está cerrado: no admite regularizaciones. Usa una fecha del mes abierto en curso.`;
  }
  return null;
}

/** Mes contable 'YYYY-MM' de una fecha ISO. Comparar texto ISO es comparar fechas. */
export function mesContableDe(fechaIso: string): string {
  return String(fechaIso || "").slice(0, 7);
}

export type ResumenRegularizaciones = {
  pendientes: number;
  importePendiente: number;
  aprobadas: number;
  importeAprobado: number;
  rechazadas: number;
  /** De lo aprobado, cuánto se puede pasar al cliente y cuánto se come la empresa. */
  refacturable: number;
  asumido: number;
  porConcepto: Array<{ tipo: ConceptoTipo; cuantas: number; importe: number }>;
};

export function resumirRegularizaciones(filas: Regularizacion[]): ResumenRegularizaciones {
  const resumen: ResumenRegularizaciones = {
    pendientes: 0,
    importePendiente: 0,
    aprobadas: 0,
    importeAprobado: 0,
    rechazadas: 0,
    refacturable: 0,
    asumido: 0,
    porConcepto: []
  };
  const porConcepto = new Map<ConceptoTipo, { cuantas: number; importe: number }>();
  for (const fila of filas) {
    const importe = Number(fila.importe_cents || 0);
    if (fila.estado === "propuesta") {
      resumen.pendientes += 1;
      resumen.importePendiente += importe;
    } else if (fila.estado === "aprobada") {
      resumen.aprobadas += 1;
      resumen.importeAprobado += importe;
      if (fila.refacturable) resumen.refacturable += importe;
      else resumen.asumido += importe;
    } else {
      resumen.rechazadas += 1;
    }
    // Las rechazadas no cuentan en el desglose: no son gasto de la campaña.
    if (fila.estado === "rechazada") continue;
    const actual = porConcepto.get(fila.concepto_tipo) || { cuantas: 0, importe: 0 };
    actual.cuantas += 1;
    actual.importe += importe;
    porConcepto.set(fila.concepto_tipo, actual);
  }
  resumen.porConcepto = Array.from(porConcepto.entries())
    .map(([tipo, valores]) => ({ tipo, ...valores }))
    .sort((a, b) => b.importe - a.importe);
  return resumen;
}

/**
 * Aviso cuando un concepto se repite tanto que deja de ser una excepción. Un 40 %
 * de 'error_tarifa' no es un extra: es una tarifa mal puesta.
 */
export function avisoConceptoRepetido(resumen: ResumenRegularizaciones): string | null {
  const total = resumen.porConcepto.reduce((suma, fila) => suma + fila.cuantas, 0);
  if (total < 5) return null;
  const dominante = resumen.porConcepto.reduce((mayor, fila) => (fila.cuantas > mayor.cuantas ? fila : mayor));
  const porcentaje = Math.round((dominante.cuantas / total) * 100);
  if (porcentaje < 40) return null;
  if (dominante.tipo === "error_tarifa") {
    return `El ${porcentaje} % de las regularizaciones son por error de tarifa. Eso no es un extra: revisa el precio de los puntos de la campaña.`;
  }
  return `El ${porcentaje} % de las regularizaciones son «${conceptoLabels[dominante.tipo]}». Puede que ese coste tenga que estar en el precio del punto, no en un extra.`;
}

type Result<T> = { data: T; error?: string };

export async function fetchRegularizaciones(campanaId: string): Promise<Result<Regularizacion[]>> {
  if (!supabase) return { data: [], error: "Supabase no está configurado." };
  const { data, error } = await supabase
    .from("v_campana_regularizaciones")
    .select("*")
    .eq("campana_id", campanaId)
    .order("solicitada_at", { ascending: false });
  if (error) return { data: [], error: error.message };
  return { data: (data || []) as Regularizacion[] };
}

/**
 * Meses contables cerrados (v7.4). Se consultan para avisar ANTES de teclear.
 *
 * Devuelve el error en vez de tragárselo: `economic_month_closures` solo la lee
 * quien tiene el permiso 'pagos', y sin distinguir «no hay meses cerrados» de «no
 * he podido leerlos» la pantalla dejaba escribir toda la regularización para que
 * el RPC la rechazara al final.
 */
export async function fetchMesesCerrados(): Promise<Result<string[]>> {
  if (!supabase) return { data: [], error: "Supabase no está configurado." };
  const { data, error } = await supabase.from("economic_month_closures").select("mes_contable");
  if (error) return { data: [], error: error.message };
  return { data: ((data || []) as Array<{ mes_contable: string }>).map(fila => fila.mes_contable) };
}

export async function solicitarRegularizacion(borrador: BorradorRegularizacion, mesesCerrados: string[] = []): Promise<Result<Regularizacion | null>> {
  if (!supabase) return { data: null, error: "Supabase no está configurado." };
  const motivo = validarRegularizacion(borrador, mesesCerrados);
  if (motivo) return { data: null, error: motivo };
  const { data, error } = await supabase.rpc("merchan_gc_regularizacion_solicitar", {
    p_datos: {
      campana_id: borrador.campanaId,
      punto_id: borrador.puntoId || null,
      concepto_tipo: borrador.conceptoTipo,
      concepto: borrador.concepto.trim(),
      importe_cents: eurosACentimos(borrador.importe),
      fecha: borrador.fecha,
      trabajador_id: borrador.trabajadorId || null,
      trabajador_nombre: borrador.trabajadorNombre || null
    }
  });
  if (error) return { data: null, error: error.message };
  return { data: data as Regularizacion };
}

/**
 * Motivo por el que una resolución no se puede enviar, o null si se puede.
 * Función pura y exportada para poder probarla: es la que impide que una
 * decisión de dinero se tome por descuido.
 */
export function validarResolucion(
  estado: "aprobada" | "rechazada",
  opciones: { motivo?: string | null; refacturable?: boolean | null }
): string | null {
  if (estado === "rechazada" && !String(opciones.motivo || "").trim()) {
    return "Rechazar una regularización exige motivo: lo va a leer quien la propuso.";
  }
  // typeof y no `=== null`: con `undefined`, un Boolean() convertiría un
  // «no lo he decidido» en «no se refactura», que es una decisión de dinero
  // tomada por una coerción en vez de por administración.
  if (estado === "aprobada" && typeof opciones.refacturable !== "boolean") {
    return "Di si es refacturable al cliente o lo asume la empresa antes de aprobar.";
  }
  return null;
}

export async function resolverRegularizacion(
  id: string,
  estado: "aprobada" | "rechazada",
  opciones: { motivo?: string | null; refacturable?: boolean | null }
): Promise<Result<Regularizacion | null>> {
  const motivo = validarResolucion(estado, opciones);
  if (motivo) return { data: null, error: motivo };
  if (!supabase) return { data: null, error: "Supabase no está configurado." };
  const { data, error } = await supabase.rpc("merchan_gc_regularizacion_resolver", {
    p_id: id,
    p_estado: estado,
    p_motivo: opciones.motivo?.trim() || null,
    // Sin Boolean(): si faltara, llega null y la excepción del RPC hace de red.
    p_refacturable: estado === "aprobada" ? opciones.refacturable ?? null : null
  });
  if (error) return { data: null, error: error.message };
  return { data: data as Regularizacion };
}

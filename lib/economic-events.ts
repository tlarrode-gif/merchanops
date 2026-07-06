import { AppSession, isAdminSession } from "@/lib/access-control";
import { IsdinBillingAdjustment, IsdinBillingLine, ISDIN_CECO, ISDIN_CLIENT } from "@/lib/isdin-billing";
import { PaymentLine, dateOnly, fingerprint } from "@/lib/payment-ledger";
import { normalizeProvince, provinceScopeValues } from "@/lib/provinces";
import { supabase } from "@/lib/supabase";

// Fase 3: eventos económicos. Registro único e idempotente de pagos a
// trabajadores, facturación a cliente y extras. Un evento nunca se edita ni se
// borra: se compensa con un reverso (importe opuesto) que se contabiliza en el
// mes en que se emite. El mes contable queda fijado al crear el evento.

export type EconomicEventTipo = "pago_trabajador" | "facturacion_cliente" | "extra";
export type EconomicEventOrigen = "servicio" | "gran_campana" | "isdin" | "manual";
export type EconomicEventEstado = "activo" | "revertido" | "reverso";

export type EconomicEvent = {
  id: string;
  fingerprint: string;
  tipo: EconomicEventTipo;
  origen: EconomicEventOrigen;
  source_id?: string | null;
  source_line_id?: string | null;
  fecha_evento: string;
  mes_contable: string;
  worker_id?: string | null;
  worker_name?: string | null;
  client?: string | null;
  ceco?: string | null;
  campana?: string | null;
  provincia?: string | null;
  concepto: string;
  importe: number;
  estado: EconomicEventEstado;
  reverso_de?: string | null;
  motivo_reverso?: string | null;
  created_by_user_id?: string | null;
  created_by_user_name?: string | null;
  payload?: Record<string, unknown>;
  created_at?: string | null;
};

export type EconomicEventInput = Omit<EconomicEvent, "id" | "created_at">;

export const economicTipoLabels: Record<EconomicEventTipo, string> = {
  pago_trabajador: "Pago trabajador",
  facturacion_cliente: "Facturación cliente",
  extra: "Extra / regularización"
};

export const economicOrigenLabels: Record<EconomicEventOrigen, string> = {
  servicio: "Servicios",
  gran_campana: "Grandes Campañas",
  isdin: "ISDIN",
  manual: "Manual"
};

export function mesContable(date?: string | null) {
  const value = dateOnly(date) || new Date().toISOString().slice(0, 10);
  return value.slice(0, 7);
}

function hoy() {
  return new Date().toISOString().slice(0, 10);
}

type AnyRow = Record<string, any>;

// --- Generación de eventos desde los cambios de estado registrados en origen ---

// Pagos a trabajador desde las líneas de pago calculadas (Servicios + módulo
// clásico de grandes campañas). El fingerprint de la línea ya incorpora
// origen, entidad, estado, fecha e importe: si el estado del origen cambia,
// nace un evento nuevo en lugar de duplicarse el anterior.
export function pagoEventsFromPaymentLines(lines: PaymentLine[]): EconomicEventInput[] {
  return lines.map(line => ({
    fingerprint: fingerprint(["evt", "pago", line.fingerprint]),
    tipo: "pago_trabajador" as const,
    origen: line.origin,
    source_id: line.source_id,
    source_line_id: line.source_line_id || null,
    fecha_evento: line.payment_date,
    mes_contable: mesContable(line.payment_date),
    worker_id: line.worker_id || null,
    worker_name: line.worker_name || null,
    client: line.client,
    ceco: line.ceco || null,
    campana: line.campaign || null,
    provincia: line.province || null,
    concepto: line.concept,
    importe: Number(line.amount || 0),
    estado: "activo" as const,
    payload: { ...(line.payload || {}), origen_estado: line.status || null }
  }));
}

// Pagos a trabajador del módulo nuevo de Grandes Campañas: cada punto
// completado con importe y gestor genera un evento.
export function pagoEventsFromCampanaPuntos(puntos: AnyRow[], campanas: AnyRow[]): EconomicEventInput[] {
  const porCampana = new Map(campanas.map(campana => [campana.id, campana]));
  return puntos
    .filter(punto => punto.estado === "completado" && Number(punto.importe || 0) > 0)
    .map(punto => {
      const campana = porCampana.get(punto.campana_id) || {};
      const fecha = dateOnly(punto.fecha_visita) || dateOnly(punto.updated_at) || hoy();
      return {
        fingerprint: fingerprint(["evt", "pago", "gc_punto", punto.id, "completado", fecha, Number(punto.importe || 0)]),
        tipo: "pago_trabajador" as const,
        origen: "gran_campana" as const,
        source_id: String(punto.campana_id || ""),
        source_line_id: String(punto.id),
        fecha_evento: fecha,
        mes_contable: mesContable(fecha),
        worker_id: punto.gestor_id || null,
        worker_name: punto.gestor_nombre || "Sin gestor",
        client: campana.cliente_marca || "Gran campaña",
        ceco: null,
        campana: campana.nombre || null,
        provincia: punto.provincia || null,
        concepto: "Gran campaña - punto completado",
        importe: Number(punto.importe || 0),
        estado: "activo" as const,
        payload: { punto: punto.nombre_comercial || "", codigo: punto.codigo || "" }
      };
    });
}

// Facturación al cliente desde las líneas de facturación ISDIN + regularizaciones.
export function facturacionEventsFromIsdin(lines: IsdinBillingLine[], adjustments: IsdinBillingAdjustment[]): EconomicEventInput[] {
  const eventos: EconomicEventInput[] = lines
    .filter(line => Number(line.total || 0) !== 0)
    .map(line => ({
      fingerprint: fingerprint(["evt", "fact", "isdin", line.vin, line.concept, line.date, line.total]),
      tipo: "facturacion_cliente" as const,
      origen: "isdin" as const,
      source_id: String(line.row.id || line.vin),
      source_line_id: null,
      fecha_evento: line.date || hoy(),
      mes_contable: mesContable(line.date),
      worker_id: null,
      worker_name: null,
      client: ISDIN_CLIENT,
      ceco: ISDIN_CECO,
      campana: line.camp || null,
      provincia: line.prov || null,
      concepto: `${line.concept} · ${line.farmacia}`,
      importe: Number(line.total || 0),
      estado: "activo" as const,
      payload: { vin: line.vin, semana: line.week, tarifa: line.tarifa, extra: line.extra }
    }));
  for (const adj of adjustments) {
    if (!Number(adj.amount || 0)) continue;
    eventos.push({
      fingerprint: fingerprint(["evt", "fact", "isdin_adj", adj.id]),
      tipo: "facturacion_cliente",
      origen: "isdin",
      source_id: String(adj.id),
      source_line_id: null,
      fecha_evento: dateOnly(adj.billing_date) || hoy(),
      mes_contable: mesContable(adj.billing_date),
      worker_id: null,
      worker_name: null,
      client: ISDIN_CLIENT,
      ceco: ISDIN_CECO,
      campana: null,
      provincia: null,
      concepto: `Regularización · ${adj.concept}`,
      importe: Number(adj.amount || 0),
      estado: "activo",
      payload: { semana: adj.billing_week || null }
    });
  }
  return eventos;
}

// --- Persistencia ---

type Result<T> = { data: T; error: string | null };

// Idempotente: los fingerprints ya registrados se ignoran, nunca se sobreescriben
// (un evento contabilizado es inmutable). Devuelve cuántos eventos nuevos entraron.
export async function syncEconomicEvents(eventos: EconomicEventInput[], actor?: AppSession | null): Promise<Result<number>> {
  if (!supabase) return { data: 0, error: "Supabase no está configurado." };
  if (!eventos.length) return { data: 0, error: null };
  const { data: existentes, error: readError } = await supabase
    .from("economic_events")
    .select("fingerprint")
    .in("fingerprint", eventos.map(evento => evento.fingerprint));
  if (readError) return { data: 0, error: readError.message };
  const conocidos = new Set((existentes || []).map(row => row.fingerprint as string));
  const nuevos = eventos
    .filter(evento => !conocidos.has(evento.fingerprint))
    .map(evento => ({
      ...evento,
      payload: evento.payload || {},
      created_by_user_id: actor?.id || null,
      created_by_user_name: actor?.display_name || null
    }));
  if (!nuevos.length) return { data: 0, error: null };
  const { error } = await supabase.from("economic_events").upsert(nuevos, { onConflict: "fingerprint", ignoreDuplicates: true });
  if (error) return { data: 0, error: error.message };
  return { data: nuevos.length, error: null };
}

export type EconomicEventFilters = {
  mes?: string;
  tipo?: EconomicEventTipo | "";
  origen?: EconomicEventOrigen | "";
  worker?: string;
  provincia?: string;
  incluirReversos?: boolean;
};

// Lectura con permisos aplicados: un gestor solo ve pagos a trabajador de sus
// provincias; la facturación al cliente y los extras son solo de administración.
export async function fetchEconomicEvents(filters: EconomicEventFilters, session: AppSession | null): Promise<Result<EconomicEvent[]>> {
  if (!supabase) return { data: [], error: "Supabase no está configurado." };
  let query = supabase.from("economic_events").select("*").order("fecha_evento", { ascending: false }).order("created_at", { ascending: false }).limit(1000);
  if (filters.mes) query = query.eq("mes_contable", filters.mes);
  if (filters.tipo) query = query.eq("tipo", filters.tipo);
  if (filters.origen) query = query.eq("origen", filters.origen);
  if (filters.worker) query = query.or(`worker_id.eq.${filters.worker},worker_name.eq.${filters.worker}`);
  if (!isAdminSession(session)) {
    query = query.eq("tipo", "pago_trabajador");
    const provincias = provinceScopeValues(session?.provinces || []);
    if (provincias.length) query = query.in("provincia", provincias);
    else return { data: [], error: null };
  }
  const { data, error } = await query;
  if (error) return { data: [], error: error.message };
  let eventos = (data || []) as EconomicEvent[];
  if (filters.provincia) eventos = eventos.filter(evento => normalizeProvince(evento.provincia) === normalizeProvince(filters.provincia));
  return { data: eventos, error: null };
}

// Reverso contable: el original queda marcado 'revertido' y nace un evento
// espejo con importe opuesto, contabilizado en el mes actual.
export async function revertEconomicEvent(evento: EconomicEvent, motivo: string, actor: AppSession | null): Promise<Result<boolean>> {
  if (!supabase) return { data: false, error: "Supabase no está configurado." };
  if (evento.estado !== "activo") return { data: false, error: "Solo se pueden revertir eventos activos." };
  const fecha = hoy();
  const { error: insertError } = await supabase.from("economic_events").insert({
    fingerprint: fingerprint(["evt", "reverso", evento.fingerprint]),
    tipo: evento.tipo,
    origen: evento.origen,
    source_id: evento.source_id || null,
    source_line_id: evento.source_line_id || null,
    fecha_evento: fecha,
    mes_contable: mesContable(fecha),
    worker_id: evento.worker_id || null,
    worker_name: evento.worker_name || null,
    client: evento.client || null,
    ceco: evento.ceco || null,
    campana: evento.campana || null,
    provincia: evento.provincia || null,
    concepto: `Reverso · ${evento.concepto}`,
    importe: -Number(evento.importe || 0),
    estado: "reverso",
    reverso_de: evento.id,
    motivo_reverso: motivo || null,
    created_by_user_id: actor?.id || null,
    created_by_user_name: actor?.display_name || null,
    payload: { original_fingerprint: evento.fingerprint }
  });
  if (insertError) {
    const duplicado = insertError.code === "23505" || /duplicate|unique/i.test(insertError.message);
    return { data: false, error: duplicado ? "Este evento ya tiene un reverso registrado." : insertError.message };
  }
  const { error: updateError } = await supabase.from("economic_events").update({ estado: "revertido", motivo_reverso: motivo || null }).eq("id", evento.id);
  if (updateError) return { data: false, error: `Reverso creado, pero no se pudo marcar el original: ${updateError.message}` };
  return { data: true, error: null };
}

// Evento extra manual (ajustes puntuales de administración).
export async function addExtraEvent(input: { fecha: string; concepto: string; importe: number; tipo: EconomicEventTipo; worker_name?: string | null; client?: string | null; campana?: string | null; provincia?: string | null }, actor: AppSession | null): Promise<Result<boolean>> {
  if (!supabase) return { data: false, error: "Supabase no está configurado." };
  if (!input.concepto.trim()) return { data: false, error: "El concepto es obligatorio." };
  if (!Number(input.importe)) return { data: false, error: "El importe no puede ser cero." };
  const fecha = dateOnly(input.fecha) || hoy();
  const { error } = await supabase.from("economic_events").insert({
    fingerprint: fingerprint(["evt", "manual", actor?.id || "anon", Date.now(), Math.random()]),
    tipo: input.tipo,
    origen: "manual",
    fecha_evento: fecha,
    mes_contable: mesContable(fecha),
    worker_name: input.worker_name || null,
    client: input.client || null,
    campana: input.campana || null,
    provincia: input.provincia || null,
    concepto: input.concepto.trim(),
    importe: Number(input.importe),
    estado: "activo",
    created_by_user_id: actor?.id || null,
    created_by_user_name: actor?.display_name || null,
    payload: {}
  });
  if (error) return { data: false, error: error.message };
  return { data: true, error: null };
}

// Neto contable: se suman todos los eventos; un original revertido (+X) y su
// reverso (-X) se anulan entre sí, así el neto refleja solo lo vigente.
export function summarizeEconomicEvents(eventos: EconomicEvent[]) {
  const suma = (list: EconomicEvent[]) => list.reduce((total, evento) => total + Number(evento.importe || 0), 0);
  return {
    total: eventos.length,
    pagos: suma(eventos.filter(evento => evento.tipo === "pago_trabajador")),
    facturacion: suma(eventos.filter(evento => evento.tipo === "facturacion_cliente")),
    extras: suma(eventos.filter(evento => evento.tipo === "extra")),
    reversos: eventos.filter(evento => evento.estado === "reverso").length
  };
}

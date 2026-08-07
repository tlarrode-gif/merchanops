import { AppSession, isAdminSession, userCanSeeProvince } from "@/lib/access-control";
import { valorPuntoEur } from "@/lib/campana-horas";
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
// 'revision': pago retenido (sin beneficiario claro u otra anomalía); fuera del
// neto y de los exports hasta que administración lo resuelva.
export type EconomicEventEstado = "activo" | "revertido" | "reverso" | "revision";

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

// Identidad estable de una línea económica, independiente de estado/fecha/importe.
// Es la clave de la reconciliación: puede existir COMO MÁXIMO un evento vigente
// (activo o en revisión) por clave. En facturación un mismo vinilo genera varias
// líneas en paralelo (incidencia inicial, instalación, revisitas), así que ahí el
// concepto forma parte de la identidad; en pagos no (el concepto cambia con el
// estado y precisamente queremos que esa transición sustituya al evento anterior).
export function claveDeLinea(evento: Pick<EconomicEvent, "tipo" | "origen" | "source_id" | "source_line_id" | "concepto">) {
  const base = ["linea", evento.tipo, evento.origen, evento.source_id || "", evento.source_line_id || ""];
  if (evento.tipo === "facturacion_cliente") base.push(evento.concepto);
  return fingerprint(base);
}

// Pagos a trabajador desde las líneas de pago calculadas (Servicios + módulo
// clásico de grandes campañas). El fingerprint incorpora también el beneficiario:
// si cambia el estado, la fecha, el importe o el trabajador, nace un fingerprint
// nuevo y la reconciliación de syncEconomicEvents revierte el evento anterior.
export function pagoEventsFromPaymentLines(lines: PaymentLine[]): EconomicEventInput[] {
  return lines.map(line => ({
    fingerprint: fingerprint(["evt", "pago", line.fingerprint, line.worker_id || line.worker_name || ""]),
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

// Pagos a trabajador del módulo nuevo de Grandes Campañas: cada punto completado
// que valga dinero genera un evento. El beneficiario es el INSTALADOR del punto;
// si aún no tiene, se usa el gestor como respaldo (y sin ninguno queda en revisión).
//
// v11.5 · Lo que vale el punto lo decide la CAMPAÑA (importe del punto, u horas ×
// tarifa, más kilometraje). Filtrar por `importe > 0` dejaba fuera todos los
// puntos de una campaña por horas: el Historial económico se quedaba en blanco
// justo en las campañas donde el cálculo es menos evidente.
export function pagoEventsFromCampanaPuntos(puntos: AnyRow[], campanas: AnyRow[]): EconomicEventInput[] {
  const porCampana = new Map(campanas.map(campana => [campana.id, campana]));
  return puntos
    .filter(punto => punto.estado === "completado" && valorPuntoEur(punto, porCampana.get(punto.campana_id) || {}) > 0)
    .map(punto => {
      const campana = porCampana.get(punto.campana_id) || {};
      const fecha = dateOnly(punto.fecha_visita) || dateOnly(punto.updated_at) || hoy();
      const beneficiarioId = punto.instalador_id || punto.gestor_id || null;
      const beneficiarioNombre = punto.instalador_nombre || punto.gestor_nombre || "Sin instalador";
      const importe = valorPuntoEur(punto, campana);
      return {
        fingerprint: fingerprint(["evt", "pago", "gc_punto", punto.id, "completado", fecha, importe, beneficiarioId || beneficiarioNombre || ""]),
        tipo: "pago_trabajador" as const,
        origen: "gran_campana" as const,
        source_id: String(punto.campana_id || ""),
        source_line_id: String(punto.id),
        fecha_evento: fecha,
        mes_contable: mesContable(fecha),
        worker_id: beneficiarioId,
        worker_name: beneficiarioNombre,
        client: campana.cliente_marca || "Gran campaña",
        ceco: null,
        campana: campana.nombre || null,
        provincia: punto.provincia || null,
        concepto: campana.pago_por_horas ? "Gran campaña - horas trabajadas" : "Gran campaña - punto completado",
        importe,
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
    // v8_5 (A7): las regularizaciones anuladas no generan facturación.
    if (adj.annulled_at) continue;
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

export type SyncResumen = { nuevos: number; sustituidos: number; retenidos: number; omitidos: number };

function sinBeneficiario(evento: EconomicEventInput) {
  if (evento.tipo !== "pago_trabajador") return false;
  if (evento.worker_id) return false;
  const nombre = String(evento.worker_name || "").trim().toLowerCase();
  return !nombre || nombre === "sin gestor" || nombre === "sin instalador" || nombre === "sin trabajador";
}

// --- Cierre de mes contable ---

export async function fetchMesesCerrados(): Promise<Result<string[]>> {
  if (!supabase) return { data: [], error: "Supabase no está configurado." };
  const { data, error } = await supabase.from("economic_month_closures").select("mes_contable");
  if (error) return { data: [], error: error.message };
  return { data: (data || []).map(row => row.mes_contable as string), error: null };
}

export async function cerrarMes(mes: string, actor: AppSession | null): Promise<Result<boolean>> {
  if (!isAdminSession(actor)) return { data: false, error: "Solo administración puede cerrar meses." };
  if (!supabase) return { data: false, error: "Supabase no está configurado." };
  if (!/^\d{4}-\d{2}$/.test(mes)) return { data: false, error: "Mes no válido." };
  const { error } = await supabase.from("economic_month_closures").upsert({
    mes_contable: mes,
    closed_at: new Date().toISOString(),
    closed_by_user_id: actor?.id || null,
    closed_by_user_name: actor?.display_name || null
  });
  if (error) return { data: false, error: error.message };
  return { data: true, error: null };
}

export async function reabrirMes(mes: string, actor: AppSession | null): Promise<Result<boolean>> {
  if (!isAdminSession(actor)) return { data: false, error: "Solo administración puede reabrir meses." };
  if (!supabase) return { data: false, error: "Supabase no está configurado." };
  const { error } = await supabase.from("economic_month_closures").delete().eq("mes_contable", mes);
  if (error) return { data: false, error: error.message };
  return { data: true, error: null };
}

// Sincronización idempotente CON reconciliación (auditoría C1):
//  1. Los fingerprints ya registrados se ignoran (nada cambió en el origen).
//  2. Si un evento nuevo comparte clave de línea con un evento vigente pero con
//     fingerprint distinto (cambió estado, fecha, importe o beneficiario en el
//     origen), el evento antiguo se revierte automáticamente y entra el nuevo:
//     nunca hay dos eventos vigentes para la misma línea.
//  3. Pagos sin beneficiario entran en estado 'revision' (fuera de neto y export).
//  4. Eventos cuyo mes contable esté cerrado se contabilizan en el mes actual,
//     guardando el mes de origen en payload.mes_origen. Lo cerrado no se toca.
export async function syncEconomicEvents(eventos: EconomicEventInput[], actor?: AppSession | null): Promise<Result<SyncResumen>> {
  const vacio: SyncResumen = { nuevos: 0, sustituidos: 0, retenidos: 0, omitidos: 0 };
  if (!supabase) return { data: vacio, error: "Supabase no está configurado." };

  // Una gestora cierra el pago de SUS campañas y servicios sin depender de
  // administración: sincroniza los pagos a trabajador de sus provincias. La
  // facturación al cliente y los extras siguen siendo solo de administración,
  // igual que en la lectura (fetchEconomicEvents). La base lo vuelve a
  // comprobar por RLS (v9_11), así que esto es el filtro amable, no la defensa:
  // un evento fuera de su alcance sería rechazado por la política igualmente.
  let omitidos = 0;
  if (!isAdminSession(actor)) {
    if (!actor?.active) return { data: vacio, error: "Sesión no válida." };
    if (!actor.permissions?.pagos) return { data: vacio, error: "No tienes permiso de pagos para sincronizar." };
    if (!(actor.provinces || []).length) return { data: vacio, error: "No tienes provincias asignadas." };
    const total = eventos.length;
    eventos = eventos.filter(evento => evento.tipo === "pago_trabajador" && userCanSeeProvince(actor, evento.provincia));
    omitidos = total - eventos.length;
  }

  if (!eventos.length) return { data: { ...vacio, omitidos }, error: null };

  const [existentesR, cerradosR] = await Promise.all([
    supabase.from("economic_events").select("fingerprint").in("fingerprint", eventos.map(evento => evento.fingerprint)),
    fetchMesesCerrados()
  ]);
  if (existentesR.error) return { data: vacio, error: existentesR.error.message };
  if (cerradosR.error) return { data: vacio, error: cerradosR.error };
  const conocidos = new Set((existentesR.data || []).map(row => row.fingerprint as string));
  const cerrados = new Set(cerradosR.data);
  const mesActual = mesContable();
  if (cerrados.has(mesActual)) return { data: vacio, error: `El mes actual (${mesActual}) está cerrado; reábrelo para sincronizar.` };

  const candidatos = eventos.filter(evento => !conocidos.has(evento.fingerprint));
  if (!candidatos.length) return { data: { ...vacio, omitidos }, error: null };

  // Eventos vigentes de las mismas líneas, para reconciliar.
  const sourceIds = Array.from(new Set(candidatos.map(evento => evento.source_id).filter(Boolean))) as string[];
  const { data: vigentesData, error: vigentesError } = await supabase
    .from("economic_events")
    .select("*")
    .in("estado", ["activo", "revision"])
    .in("source_id", sourceIds);
  if (vigentesError) return { data: vacio, error: vigentesError.message };
  const vigentesPorClave = new Map<string, EconomicEvent>();
  for (const vigente of (vigentesData || []) as EconomicEvent[]) vigentesPorClave.set(claveDeLinea(vigente), vigente);

  const resumen: SyncResumen = { nuevos: 0, sustituidos: 0, retenidos: 0, omitidos };
  for (const candidato of candidatos) {
    const retenido = sinBeneficiario(candidato);
    const mesCerrado = cerrados.has(candidato.mes_contable);
    const fila = {
      ...candidato,
      estado: retenido ? "revision" as const : "activo" as const,
      mes_contable: mesCerrado ? mesActual : candidato.mes_contable,
      payload: { ...(candidato.payload || {}), ...(mesCerrado ? { mes_origen: candidato.mes_contable } : {}) },
      created_by_user_id: actor?.id || null,
      created_by_user_name: actor?.display_name || null
    };

    const anterior = vigentesPorClave.get(claveDeLinea(candidato));
    if (anterior) {
      const sustituido = await sustituirEvento(anterior, fila, actor || null, cerrados, mesActual);
      if (sustituido.error) return { data: resumen, error: sustituido.error };
      resumen.sustituidos += 1;
      vigentesPorClave.delete(claveDeLinea(candidato));
    } else {
      const { error } = await supabase.from("economic_events").upsert(fila, { onConflict: "fingerprint", ignoreDuplicates: true });
      if (error) return { data: resumen, error: error.message };
      resumen.nuevos += 1;
    }
    if (retenido) resumen.retenidos += 1;
  }
  return { data: resumen, error: null };
}

// Reverso del evento anterior + alta del nuevo, dejando rastro cruzado. El reverso
// se contabiliza siempre en un mes abierto (el actual).
async function sustituirEvento(anterior: EconomicEvent, nuevo: Record<string, unknown>, actor: AppSession | null, cerrados: Set<string>, mesActual: string): Promise<Result<boolean>> {
  if (!supabase) return { data: false, error: "Supabase no está configurado." };
  // Un evento en revisión nunca llegó a contar: se marca revertido sin reverso espejo.
  if (anterior.estado === "activo") {
    const { error: reversoError } = await supabase.from("economic_events").insert({
      fingerprint: fingerprint(["evt", "reverso", anterior.fingerprint]),
      tipo: anterior.tipo,
      origen: anterior.origen,
      source_id: anterior.source_id || null,
      source_line_id: anterior.source_line_id || null,
      fecha_evento: hoy(),
      mes_contable: mesActual,
      worker_id: anterior.worker_id || null,
      worker_name: anterior.worker_name || null,
      client: anterior.client || null,
      ceco: anterior.ceco || null,
      campana: anterior.campana || null,
      provincia: anterior.provincia || null,
      concepto: `Reverso · ${anterior.concepto}`,
      importe: -Number(anterior.importe || 0),
      estado: "reverso",
      reverso_de: anterior.id,
      motivo_reverso: "Sustituido: el origen cambió tras la sincronización.",
      created_by_user_id: actor?.id || null,
      created_by_user_name: actor?.display_name || null,
      payload: { original_fingerprint: anterior.fingerprint, sustitucion_automatica: true }
    });
    if (reversoError && reversoError.code !== "23505" && !/duplicate|unique/i.test(reversoError.message)) return { data: false, error: reversoError.message };
  }
  const { error: marcaError } = await supabase.from("economic_events")
    .update({ estado: "revertido", motivo_reverso: "Sustituido: el origen cambió tras la sincronización." })
    .eq("id", anterior.id);
  if (marcaError) return { data: false, error: marcaError.message };
  const { error: altaError } = await supabase.from("economic_events").upsert(nuevo, { onConflict: "fingerprint", ignoreDuplicates: true });
  if (altaError) return { data: false, error: altaError.message };
  return { data: true, error: null };
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
  if (!isAdminSession(session)) {
    query = query.eq("tipo", "pago_trabajador");
    const provincias = provinceScopeValues(session?.provinces || []);
    if (provincias.length) query = query.in("provincia", provincias);
    else return { data: [], error: null };
  }
  const { data, error } = await query;
  if (error) return { data: [], error: error.message };
  let eventos = (data || []) as EconomicEvent[];
  // El filtro de trabajador se aplica en cliente: el valor viene de un texto libre
  // (id o nombre) y no debe interpolarse jamás en un `.or` de PostgREST.
  if (filters.worker) eventos = eventos.filter(evento => evento.worker_id === filters.worker || evento.worker_name === filters.worker);
  if (filters.provincia) eventos = eventos.filter(evento => normalizeProvince(evento.provincia) === normalizeProvince(filters.provincia));
  return { data: eventos, error: null };
}

// Reverso contable: el original queda marcado 'revertido' y nace un evento
// espejo con importe opuesto, contabilizado en el mes actual.
export async function revertEconomicEvent(evento: EconomicEvent, motivo: string, actor: AppSession | null): Promise<Result<boolean>> {
  if (!supabase) return { data: false, error: "Supabase no está configurado." };
  if (!isAdminSession(actor)) return { data: false, error: "Solo administración puede revertir eventos." };
  // Un evento retenido en revisión nunca contó en el neto: se marca revertido sin espejo.
  if (evento.estado === "revision") {
    const { error } = await supabase.from("economic_events").update({ estado: "revertido", motivo_reverso: motivo || "Descartado desde revisión." }).eq("id", evento.id);
    if (error) return { data: false, error: error.message };
    return { data: true, error: null };
  }
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
  if (!isAdminSession(actor)) return { data: false, error: "Solo administración puede crear eventos manuales." };
  if (!input.concepto.trim()) return { data: false, error: "El concepto es obligatorio." };
  if (!Number(input.importe)) return { data: false, error: "El importe no puede ser cero." };
  const fecha = dateOnly(input.fecha) || hoy();
  const cerrados = await fetchMesesCerrados();
  if (cerrados.error) return { data: false, error: cerrados.error };
  if (cerrados.data.includes(mesContable(fecha))) return { data: false, error: `El mes ${mesContable(fecha)} está cerrado; usa una fecha de un mes abierto.` };
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

export const economicEstadoLabels: Record<EconomicEventEstado, string> = {
  activo: "Activo",
  revertido: "Revertido",
  reverso: "Reverso",
  revision: "En revisión"
};

// Neto contable: se suman todos los eventos contabilizados; un original revertido
// (+X) y su reverso (-X) se anulan entre sí, así el neto refleja solo lo vigente.
// Los eventos 'revision' NO cuentan en el neto (nunca llegaron a contabilizarse).
export function summarizeEconomicEvents(eventos: EconomicEvent[]) {
  const contables = eventos.filter(evento => evento.estado !== "revision");
  const suma = (list: EconomicEvent[]) => list.reduce((total, evento) => total + Number(evento.importe || 0), 0);
  return {
    total: eventos.length,
    pagos: suma(contables.filter(evento => evento.tipo === "pago_trabajador")),
    facturacion: suma(contables.filter(evento => evento.tipo === "facturacion_cliente")),
    extras: suma(contables.filter(evento => evento.tipo === "extra")),
    reversos: eventos.filter(evento => evento.estado === "reverso").length,
    enRevision: eventos.filter(evento => evento.estado === "revision").length
  };
}

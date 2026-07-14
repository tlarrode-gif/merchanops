import { AppSession, AppUser, canDeleteCampaigns, canManageCampaigns, isAdminSession, userCanSeeProvince } from "@/lib/access-control";
import { copyCampanaColumnas } from "@/lib/campana-columnas";
import { normalizeProvince, provinceScopeValues } from "@/lib/provinces";
import { isSupabaseConfigured, supabase } from "@/lib/supabase";
import { csvSafeCell } from "@/lib/sanitize";

export type CampanaEstado = "borrador" | "planificada" | "activa" | "pausada" | "completada" | "cancelada" | "archivada";
export type PuntoEstado = "pendiente" | "completado" | "incidencia" | "cancelado";
export type IncidenciaEstado = "abierta" | "en_gestion" | "resuelta";

export type Campana = {
  id: string;
  nombre: string;
  cliente_marca?: string | null;
  descripcion?: string | null;
  estado: CampanaEstado;
  fecha_inicio?: string | null;
  fecha_fin?: string | null;
  provincias: string[];
  presupuesto?: number | null;
  // Feature 2: la campana pide a los gestores la direccion de envio del trabajador.
  solicitar_direccion_envio?: boolean | null;
  created_by?: string | null;
  created_by_name?: string | null;
  archived_at?: string | null;
  duplicada_de?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
};

export type CampanaListadoRow = Campana & {
  total_puntos: number;
  completados: number;
  pendientes: number;
  asignados: number;
  incidencias_abiertas: number;
  coste_ejecutado: number;
  importe_total: number;
  dias_restantes: number | null;
  gestores_nombres: string[];
  gestores_ids: string[];
};

export type CampanaKpis = {
  campana_id: string;
  total_puntos: number;
  completados: number;
  pendientes: number;
  asignados: number;
  incidencias_abiertas: number;
  coste_ejecutado: number;
  importe_total: number;
  dias_restantes: number | null;
};

export type PuntoVenta = {
  id: string;
  campana_id: string;
  gestor_id?: string | null;
  gestor_nombre?: string | null;
  // Instalador (workers): quien ejecuta el punto y cobra. El gestor coordina.
  instalador_id?: string | null;
  instalador_nombre?: string | null;
  codigo?: string | null;
  nombre_comercial: string;
  direccion?: string | null;
  // Feature 2: direccion de envio del trabajador elegida para este punto.
  // Es el destino logistico preferente (prioridad sobre `direccion`).
  direccion_envio?: string | null;
  direccion_envio_id?: string | null;
  provincia?: string | null;
  tipo?: string | null;
  estado: PuntoEstado;
  fecha_visita?: string | null;
  importe?: number | null;
  notas?: string | null;
  datos_extra?: Record<string, unknown> | null;
  created_at?: string | null;
  updated_at?: string | null;
};

export type IncidenciaCampana = {
  id: string;
  punto_id?: string | null;
  campana_id?: string | null;
  gestor_id?: string | null;
  gestor_nombre?: string | null;
  descripcion?: string | null;
  estado: IncidenciaEstado;
  resolved_at?: string | null;
  created_at?: string | null;
};

export type CampanaGestor = {
  id: string;
  campana_id: string;
  gestor_id?: string | null;
  gestor_nombre?: string | null;
  provincia?: string | null;
  assigned_at?: string | null;
};

export const campanaEstados: CampanaEstado[] = ["borrador", "planificada", "activa", "pausada", "completada", "cancelada", "archivada"];
export const campanaEstadoLabels: Record<CampanaEstado, string> = {
  borrador: "Borrador",
  planificada: "Planificada",
  activa: "Activa",
  pausada: "Pausada",
  completada: "Completada",
  cancelada: "Cancelada",
  archivada: "Archivada"
};
export const puntoEstados: PuntoEstado[] = ["pendiente", "completado", "incidencia", "cancelado"];
export const puntoEstadoLabels: Record<PuntoEstado, string> = {
  pendiente: "Pendiente",
  completado: "Completado",
  incidencia: "Incidencia",
  cancelado: "Cancelado"
};
export const incidenciaEstadoLabels: Record<IncidenciaEstado, string> = {
  abierta: "Abierta",
  en_gestion: "En gestión",
  resuelta: "Resuelta"
};

export function eur(value: number | null | undefined) {
  return new Intl.NumberFormat("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(value || 0)) + " €";
}

export function eurCompact(value: number | null | undefined) {
  const n = Number(value || 0);
  if (Math.abs(n) >= 1000) return `${new Intl.NumberFormat("es-ES", { maximumFractionDigits: 1 }).format(n / 1000)}k€`;
  return eur(n);
}

export function dateOnly(value?: string | null) {
  return value ? String(value).slice(0, 10) : "";
}

export function formatDate(value?: string | null) {
  const d = dateOnly(value);
  if (!d) return "—";
  const [y, m, day] = d.split("-");
  return `${day}/${m}/${y}`;
}

export function initials(name?: string | null) {
  const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  return (parts[0][0] + (parts[1]?.[0] || "")).toUpperCase();
}

const avatarPalette = ["#8b1a2f", "#1a1a2e", "#b9aa83", "#0f766e", "#7c3aed", "#b45309", "#1d4ed8", "#be185d"];
export function avatarColor(name?: string | null) {
  const text = String(name || "");
  let hash = 0;
  for (let i = 0; i < text.length; i++) hash = (hash * 31 + text.charCodeAt(i)) >>> 0;
  return avatarPalette[hash % avatarPalette.length];
}

export function diasRestantesLabel(fechaFin?: string | null, diasRestantes?: number | null) {
  if (!fechaFin) return "—";
  const dias = diasRestantes ?? Math.ceil((new Date(`${dateOnly(fechaFin)}T00:00:00`).getTime() - Date.now()) / 86400000);
  return dias < 0 ? "Finalizada" : String(dias);
}

// Visibilidad: admin ve todo; el gestor ve campañas de sus provincias o donde está asignado.
export function sessionCanSeeCampana(session: AppSession | null | undefined, campana: Pick<CampanaListadoRow, "provincias" | "gestores_ids">) {
  if (!session?.active) return false;
  if (isAdminSession(session)) return true;
  if ((campana.gestores_ids || []).includes(session.id)) return true;
  return (campana.provincias || []).some(provincia => userCanSeeProvince(session, provincia));
}

export function sessionCanSeePunto(session: AppSession | null | undefined, punto: Pick<PuntoVenta, "provincia" | "gestor_id">) {
  if (!session?.active) return false;
  if (isAdminSession(session)) return true;
  if (punto.gestor_id === session.id) return true;
  return userCanSeeProvince(session, punto.provincia);
}

type QueryError = { message: string };
type Result<T> = { data: T; error?: string };

export async function fetchCampanasListado(session: AppSession | null): Promise<Result<CampanaListadoRow[]>> {
  if (!isSupabaseConfigured || !supabase) return { data: [], error: "Supabase no está configurado." };
  const { data, error } = await supabase.from("v_campanas_listado").select("*").order("created_at", { ascending: false });
  if (error) return { data: [], error: error.message };
  const rows = ((data || []) as CampanaListadoRow[]).map(row => ({
    ...row,
    provincias: row.provincias || [],
    gestores_nombres: row.gestores_nombres || [],
    gestores_ids: row.gestores_ids || []
  }));
  const visibles = rows.filter(row => sessionCanSeeCampana(session, row));
  if (isAdminSession(session) || !visibles.length) return { data: visibles };
  return { data: await scopeListadoKpis(visibles, session) };
}

// La vista v_campanas_listado agrega KPIs globales de cada campaña. Un gestor solo debe
// ver los números de sus provincias, así que se recalculan aquí con los puntos a los que
// realmente tiene acceso (y el presupuesto se elimina de la fila).
async function scopeListadoKpis(rows: CampanaListadoRow[], session: AppSession | null): Promise<CampanaListadoRow[]> {
  if (!supabase) return rows;
  const ids = rows.map(row => row.id);
  const [puntosResult, incidenciasResult] = await Promise.all([
    supabase.from("puntos_venta_campana").select("id,campana_id,provincia,gestor_id,gestor_nombre,estado,importe").in("campana_id", ids),
    supabase.from("incidencias_campana").select("id,campana_id,punto_id,estado").in("campana_id", ids).neq("estado", "resuelta")
  ]);
  if (puntosResult.error) return rows.map(row => ({ ...row, presupuesto: null }));
  const puntos = (puntosResult.data || []) as Array<Pick<PuntoVenta, "id" | "campana_id" | "provincia" | "gestor_id" | "gestor_nombre" | "estado" | "importe">>;
  const visibles = puntos.filter(punto => sessionCanSeePunto(session, punto));
  const puntoIds = new Set(visibles.map(punto => punto.id));
  const incidencias = (incidenciasResult.data || []) as Array<{ campana_id: string | null; punto_id: string | null }>;
  return rows.map(row => {
    const propios = visibles.filter(punto => punto.campana_id === row.id);
    return {
      ...row,
      presupuesto: null,
      total_puntos: propios.length,
      completados: propios.filter(punto => punto.estado === "completado").length,
      pendientes: propios.filter(punto => punto.estado === "pendiente").length,
      asignados: propios.filter(punto => punto.gestor_id || punto.gestor_nombre).length,
      importe_total: propios.reduce((sum, punto) => sum + Number(punto.importe || 0), 0),
      coste_ejecutado: propios.filter(punto => punto.estado === "completado").reduce((sum, punto) => sum + Number(punto.importe || 0), 0),
      incidencias_abiertas: incidencias.filter(incidencia => incidencia.campana_id === row.id && incidencia.punto_id && puntoIds.has(incidencia.punto_id)).length
    };
  });
}

// KPIs de detalle calculados sobre los puntos visibles para la sesión (visión provincial del gestor).
export function kpisDesdePuntos(campanaId: string, puntos: PuntoVenta[], incidencias: IncidenciaCampana[], fechaFin?: string | null): CampanaKpis {
  const puntoIds = new Set(puntos.map(punto => punto.id));
  return {
    campana_id: campanaId,
    total_puntos: puntos.length,
    completados: puntos.filter(punto => punto.estado === "completado").length,
    pendientes: puntos.filter(punto => punto.estado === "pendiente").length,
    asignados: puntos.filter(punto => punto.gestor_id || punto.gestor_nombre).length,
    incidencias_abiertas: incidencias.filter(incidencia => incidencia.estado !== "resuelta" && incidencia.punto_id && puntoIds.has(incidencia.punto_id)).length,
    coste_ejecutado: puntos.filter(punto => punto.estado === "completado").reduce((sum, punto) => sum + Number(punto.importe || 0), 0),
    importe_total: puntos.reduce((sum, punto) => sum + Number(punto.importe || 0), 0),
    dias_restantes: fechaFin ? Math.ceil((new Date(`${dateOnly(fechaFin)}T00:00:00`).getTime() - Date.now()) / 86400000) : null
  };
}

export async function fetchCampana(id: string): Promise<Result<Campana | null>> {
  if (!supabase) return { data: null, error: "Supabase no está configurado." };
  const { data, error } = await supabase.from("grandes_campanas").select("*").eq("id", id).maybeSingle();
  if (error) return { data: null, error: error.message };
  return { data: (data as Campana) || null };
}

export async function fetchCampanaKpis(id: string): Promise<Result<CampanaKpis | null>> {
  if (!supabase) return { data: null, error: "Supabase no está configurado." };
  const { data, error } = await supabase.from("v_campana_kpis").select("*").eq("campana_id", id).maybeSingle();
  if (error) return { data: null, error: error.message };
  return { data: (data as CampanaKpis) || null };
}

export async function fetchPuntos(campanaId: string): Promise<Result<PuntoVenta[]>> {
  if (!supabase) return { data: [], error: "Supabase no está configurado." };
  const { data, error } = await supabase.from("puntos_venta_campana").select("*").eq("campana_id", campanaId).order("created_at", { ascending: true });
  if (error) return { data: [], error: error.message };
  return { data: (data || []) as PuntoVenta[] };
}

export async function fetchIncidencias(campanaId: string): Promise<Result<IncidenciaCampana[]>> {
  if (!supabase) return { data: [], error: "Supabase no está configurado." };
  const { data, error } = await supabase.from("incidencias_campana").select("*").eq("campana_id", campanaId).order("created_at", { ascending: false });
  if (error) return { data: [], error: error.message };
  return { data: (data || []) as IncidenciaCampana[] };
}

export async function fetchGestoresCampana(campanaId: string): Promise<Result<CampanaGestor[]>> {
  if (!supabase) return { data: [], error: "Supabase no está configurado." };
  const { data, error } = await supabase.from("campana_gestores").select("*").eq("campana_id", campanaId).order("assigned_at", { ascending: true });
  if (error) return { data: [], error: error.message };
  return { data: (data || []) as CampanaGestor[] };
}

export type CampanaInput = {
  nombre: string;
  cliente_marca?: string | null;
  descripcion?: string | null;
  estado: CampanaEstado;
  fecha_inicio?: string | null;
  fecha_fin?: string | null;
  provincias: string[];
  presupuesto?: number | null;
  solicitar_direccion_envio?: boolean | null;
};

export async function insertCampana(input: CampanaInput, session: AppSession | null): Promise<Result<Campana | null>> {
  if (!supabase) return { data: null, error: "Supabase no está configurado." };
  const { data, error } = await supabase.from("grandes_campanas").insert({
    ...input,
    fecha_inicio: input.fecha_inicio || null,
    fecha_fin: input.fecha_fin || null,
    presupuesto: input.presupuesto ?? null,
    created_by: session?.id || null,
    created_by_name: session?.display_name || null
  }).select().single();
  if (error) return { data: null, error: error.message };
  return { data: data as Campana };
}

export async function updateCampana(id: string, patch: Partial<CampanaInput>): Promise<Result<boolean>> {
  if (!supabase) return { data: false, error: "Supabase no está configurado." };
  const { error } = await supabase.from("grandes_campanas").update({ ...patch, updated_at: new Date().toISOString() }).eq("id", id);
  if (error) return { data: false, error: error.message };
  return { data: true };
}

export async function saveGestoresCampana(campanaId: string, gestores: Array<Pick<AppUser, "id" | "display_name" | "provinces">>): Promise<Result<boolean>> {
  if (!supabase) return { data: false, error: "Supabase no está configurado." };
  const { error: deleteError } = await supabase.from("campana_gestores").delete().eq("campana_id", campanaId);
  if (deleteError) return { data: false, error: deleteError.message };
  if (!gestores.length) return { data: true };
  const rows = gestores.map(gestor => ({
    campana_id: campanaId,
    gestor_id: gestor.id,
    gestor_nombre: gestor.display_name,
    provincia: gestor.provinces?.[0] || null
  }));
  const { error } = await supabase.from("campana_gestores").insert(rows);
  if (error) return { data: false, error: error.message };
  return { data: true };
}

export type CampanaImpacto = { puntos: number; incidencias: number; gestores: number; importe_total: number };

export async function fetchCampanaImpacto(id: string): Promise<Result<CampanaImpacto>> {
  const empty: CampanaImpacto = { puntos: 0, incidencias: 0, gestores: 0, importe_total: 0 };
  if (!supabase) return { data: empty, error: "Supabase no está configurado." };
  const [puntosResult, incidenciasResult, gestoresResult] = await Promise.all([
    supabase.from("puntos_venta_campana").select("importe", { count: "exact" }).eq("campana_id", id),
    supabase.from("incidencias_campana").select("id", { count: "exact", head: true }).eq("campana_id", id),
    supabase.from("campana_gestores").select("id", { count: "exact", head: true }).eq("campana_id", id)
  ]);
  const error = puntosResult.error || incidenciasResult.error || gestoresResult.error;
  if (error) return { data: empty, error: error.message };
  return {
    data: {
      puntos: puntosResult.count || 0,
      incidencias: incidenciasResult.count || 0,
      gestores: gestoresResult.count || 0,
      importe_total: (puntosResult.data || []).reduce((sum, row) => sum + Number((row as { importe?: number | null }).importe || 0), 0)
    }
  };
}

export async function archiveCampana(id: string, session: AppSession | null): Promise<Result<boolean>> {
  if (!canManageCampaigns(session)) return { data: false, error: "Solo un administrador puede archivar campañas." };
  return updateCampanaInterno(id, { estado: "archivada", archived_at: new Date().toISOString() });
}

export async function restoreCampana(id: string, session: AppSession | null): Promise<Result<boolean>> {
  if (!canManageCampaigns(session)) return { data: false, error: "Solo un administrador puede restaurar campañas." };
  return updateCampanaInterno(id, { estado: "pausada", archived_at: null });
}

// Borrado definitivo: solo admin. Las FK con on delete cascade eliminan puntos,
// incidencias y gestores de la campaña, sin dejar datos huérfanos.
export async function deleteCampana(id: string, session: AppSession | null): Promise<Result<boolean>> {
  if (!canDeleteCampaigns(session)) return { data: false, error: "Solo un administrador puede borrar campañas." };
  if (!supabase) return { data: false, error: "Supabase no está configurado." };
  const { error } = await supabase.from("grandes_campanas").delete().eq("id", id);
  if (error) return { data: false, error: error.message };
  return { data: true };
}

async function updateCampanaInterno(id: string, patch: Record<string, unknown>): Promise<Result<boolean>> {
  if (!supabase) return { data: false, error: "Supabase no está configurado." };
  const { error } = await supabase.from("grandes_campanas").update({ ...patch, updated_at: new Date().toISOString() }).eq("id", id);
  if (error) return { data: false, error: error.message };
  return { data: true };
}

export type DuplicarOpciones = {
  nombre: string;
  cliente_marca?: string | null;
  fecha_inicio?: string | null;
  fecha_fin?: string | null;
  copiarPuntos: boolean;
  copiarEquipo: boolean;
  copiarAsignaciones: boolean;
  copiarImportes: boolean;
};

// Duplicar nunca arrastra incidencias ni avances: los puntos copiados nacen en
// "pendiente" y sin fecha de visita. Pagos/facturación tampoco se copian (no existen
// aún como entidad propia de campaña; se generarán desde eventos en la fase económica).
export async function duplicateCampana(id: string, opciones: DuplicarOpciones, session: AppSession | null): Promise<Result<Campana | null>> {
  if (!canManageCampaigns(session)) return { data: null, error: "Solo un administrador puede duplicar campañas." };
  if (!supabase) return { data: null, error: "Supabase no está configurado." };
  const original = await fetchCampana(id);
  if (original.error || !original.data) return { data: null, error: original.error || "Campaña original no encontrada." };
  const creada = await insertCampana({
    nombre: opciones.nombre.trim(),
    cliente_marca: opciones.cliente_marca ?? original.data.cliente_marca,
    descripcion: original.data.descripcion,
    estado: "borrador",
    fecha_inicio: opciones.fecha_inicio || null,
    fecha_fin: opciones.fecha_fin || null,
    provincias: original.data.provincias || [],
    presupuesto: original.data.presupuesto ?? null
  }, session);
  if (creada.error || !creada.data) return { data: null, error: creada.error || "No se pudo crear la copia." };
  const nuevaId = creada.data.id;
  await updateCampanaInterno(nuevaId, { duplicada_de: id });
  // El esquema de columnas siempre acompaña a la copia (define cómo se leen los datos extra).
  await copyCampanaColumnas(id, nuevaId);

  if (opciones.copiarEquipo) {
    const gestores = await fetchGestoresCampana(id);
    if (gestores.data.length) {
      await supabase.from("campana_gestores").insert(gestores.data.map(gestor => ({
        campana_id: nuevaId,
        gestor_id: gestor.gestor_id,
        gestor_nombre: gestor.gestor_nombre,
        provincia: gestor.provincia
      })));
    }
  }

  if (opciones.copiarPuntos) {
    const puntos = await fetchPuntos(id);
    if (puntos.error) return { data: creada.data, error: `Campaña duplicada, pero los puntos no se pudieron leer: ${puntos.error}` };
    const filas: PuntoInput[] = puntos.data.map(punto => ({
      codigo: punto.codigo,
      nombre_comercial: punto.nombre_comercial,
      direccion: punto.direccion,
      provincia: punto.provincia,
      tipo: punto.tipo,
      estado: "pendiente",
      fecha_visita: null,
      importe: opciones.copiarImportes ? punto.importe : null,
      gestor_id: opciones.copiarAsignaciones ? punto.gestor_id : null,
      gestor_nombre: opciones.copiarAsignaciones ? punto.gestor_nombre : null,
      notas: null,
      datos_extra: punto.datos_extra || {}
    }));
    for (let index = 0; index < filas.length; index += 500) {
      const lote = await insertPuntosBatch(nuevaId, filas.slice(index, index + 500));
      if (lote.error) return { data: creada.data, error: `Campaña duplicada, pero la copia de puntos se interrumpió: ${lote.error}` };
    }
  }
  return { data: creada.data };
}

export type PuntoInput = Omit<PuntoVenta, "id" | "campana_id" | "created_at" | "updated_at">;

// Campañas en las que ya no se puede tocar la operativa (auditoría C2): lo
// completado/cancelado/archivado es histórico y sus pagos pueden estar liquidados.
const estadosCampanaCerrada: CampanaEstado[] = ["completada", "cancelada", "archivada"];

export async function assertCampanaEditable(campanaId: string): Promise<string | null> {
  if (!supabase) return "Supabase no está configurado.";
  const { data, error } = await supabase.from("grandes_campanas").select("estado").eq("id", campanaId).maybeSingle();
  if (error) return error.message;
  if (!data) return "Campaña no encontrada.";
  const estado = (data as { estado: CampanaEstado }).estado;
  if (estadosCampanaCerrada.includes(estado)) return `La campaña está ${campanaEstadoLabels[estado].toLowerCase()}: sus puntos son de solo lectura. Restáurala o reábrela para editar.`;
  return null;
}

async function campanaIdDePunto(puntoId: string): Promise<{ campanaId: string | null; error?: string }> {
  if (!supabase) return { campanaId: null, error: "Supabase no está configurado." };
  const { data, error } = await supabase.from("puntos_venta_campana").select("campana_id").eq("id", puntoId).maybeSingle();
  if (error) return { campanaId: null, error: error.message };
  return { campanaId: (data as { campana_id?: string } | null)?.campana_id || null };
}

// Alta por lotes con controles de la auditoría:
//  * importes negativos rechazados (P-7);
//  * deduplicación por código dentro del lote y contra la campaña (C5): reimportar
//    el mismo archivo no duplica puntos; devuelve cuántos se omitieron.
export async function insertPuntosBatch(campanaId: string, puntos: PuntoInput[]): Promise<Result<number> & { omitidos?: number }> {
  if (!supabase) return { data: 0, error: "Supabase no está configurado." };
  if (!puntos.length) return { data: 0 };
  const bloqueada = await assertCampanaEditable(campanaId);
  if (bloqueada) return { data: 0, error: bloqueada };
  const negativos = puntos.filter(punto => Number(punto.importe ?? 0) < 0);
  if (negativos.length) return { data: 0, error: `${negativos.length} punto(s) tienen importe negativo; corrígelos antes de importar.` };

  const codigos = Array.from(new Set(puntos.map(punto => (punto.codigo || "").trim()).filter(Boolean)));
  const existentes = new Set<string>();
  for (let index = 0; index < codigos.length; index += 500) {
    const { data, error } = await supabase.from("puntos_venta_campana").select("codigo").eq("campana_id", campanaId).in("codigo", codigos.slice(index, index + 500));
    if (error) return { data: 0, error: error.message };
    (data || []).forEach(row => existentes.add(String((row as { codigo?: string }).codigo || "").trim()));
  }
  const vistosEnLote = new Set<string>();
  const rows: Array<Record<string, unknown>> = [];
  let omitidos = 0;
  for (const punto of puntos) {
    const codigo = (punto.codigo || "").trim();
    if (codigo && (existentes.has(codigo) || vistosEnLote.has(codigo))) { omitidos += 1; continue; }
    if (codigo) vistosEnLote.add(codigo);
    rows.push({
      ...punto,
      campana_id: campanaId,
      fecha_visita: punto.fecha_visita || null,
      importe: punto.importe ?? null,
      datos_extra: punto.datos_extra || {}
    });
  }
  if (!rows.length) return { data: 0, omitidos };
  const { error } = await supabase.from("puntos_venta_campana").insert(rows);
  if (error) return { data: 0, omitidos, error: error.message };
  return { data: rows.length, omitidos };
}

// Campos internos que una actualización por Excel puede tocar en un punto existente.
// NO se incluyen gestor_id/instalador ni datos_extra: la actualización de progreso
// (estado, fecha, importe, notas) no debe pisar la asignación ni los datos originales.
const camposActualizablesPunto: (keyof PuntoInput)[] = ["nombre_comercial", "direccion", "provincia", "tipo", "estado", "fecha_visita", "importe", "notas"];

export type ActualizacionMasiva = { actualizados: number; sinCambios: number; noEncontrados: number; nuevos: number };

// Actualización masiva por CÓDIGO (auditoría / petición de operaciones):
// se sube un Excel con avances y se emparejan filas con puntos existentes por su
// código. Solo se sobrescriben celdas con valor (una celda vacía no borra el dato
// existente), así una re-subida de reporte actualiza el estado sin perder el resto
// de la línea. Filas cuyo código no exista pueden insertarse como nuevas (opcional).
export async function updatePuntosPorCodigo(
  campanaId: string,
  filas: PuntoInput[],
  opciones: { insertarNuevos: boolean }
): Promise<Result<ActualizacionMasiva> & { detalle?: ActualizacionMasiva }> {
  const vacio: ActualizacionMasiva = { actualizados: 0, sinCambios: 0, noEncontrados: 0, nuevos: 0 };
  if (!supabase) return { data: vacio, error: "Supabase no está configurado." };
  const bloqueada = await assertCampanaEditable(campanaId);
  if (bloqueada) return { data: vacio, error: bloqueada };
  const negativos = filas.filter(fila => Number(fila.importe ?? 0) < 0);
  if (negativos.length) return { data: vacio, error: `${negativos.length} fila(s) con importe negativo; corrígelas antes de actualizar.` };

  const { data: existentesData, error: readError } = await supabase
    .from("puntos_venta_campana")
    .select("id,codigo,nombre_comercial,direccion,provincia,tipo,estado,fecha_visita,importe,notas")
    .eq("campana_id", campanaId);
  if (readError) return { data: vacio, error: readError.message };
  const porCodigo = new Map<string, Record<string, unknown>>();
  for (const punto of (existentesData || []) as Array<Record<string, unknown>>) {
    const codigo = String(punto.codigo || "").trim();
    if (codigo) porCodigo.set(codigo, punto);
  }

  const resumen: ActualizacionMasiva = { actualizados: 0, sinCambios: 0, noEncontrados: 0, nuevos: 0 };
  const nuevos: PuntoInput[] = [];
  for (const fila of filas) {
    const codigo = String(fila.codigo || "").trim();
    const existente = codigo ? porCodigo.get(codigo) : undefined;
    if (!existente) { resumen.noEncontrados += 1; if (opciones.insertarNuevos && codigo) nuevos.push(fila); continue; }
    const patch: Record<string, unknown> = {};
    for (const campo of camposActualizablesPunto) {
      const valor = (fila as Record<string, unknown>)[campo];
      const actual = existente[campo];
      if (campo === "importe") { if (valor != null && Number(valor) !== Number(actual ?? 0)) patch.importe = valor; continue; }
      const texto = String(valor ?? "").trim();
      if (texto === "") continue; // celda vacía no borra
      if (texto !== String(actual ?? "").trim()) patch[campo] = campo === "fecha_visita" ? (dateOnly(texto) || valor) : valor;
    }
    if (!Object.keys(patch).length) { resumen.sinCambios += 1; continue; }
    patch.updated_at = new Date().toISOString();
    const { error } = await supabase.from("puntos_venta_campana").update(patch).eq("id", existente.id);
    if (error) return { data: resumen, error: `Actualizados ${resumen.actualizados} antes de un error: ${error.message}` };
    resumen.actualizados += 1;
  }
  if (nuevos.length) {
    const insertResult = await insertPuntosBatch(campanaId, nuevos);
    if (insertResult.error) return { data: resumen, error: `Actualización correcta, pero los nuevos fallaron: ${insertResult.error}` };
    resumen.nuevos = insertResult.data;
  }
  return { data: resumen, detalle: resumen };
}

export type AsignacionMasiva = { asignados: number; omitidos: number };

// Asignación en bloque. El ámbito se verifica aquí (no solo en la UI): un gestor solo
// puede tocar puntos de sus provincias o ya asignados a él; los demás se omiten.
export async function bulkAssignPuntos(
  ids: string[],
  gestor: { id: string | null; nombre: string | null } | null,
  session: AppSession | null
): Promise<Result<AsignacionMasiva>> {
  if (!supabase) return { data: { asignados: 0, omitidos: 0 }, error: "Supabase no está configurado." };
  if (!session?.active) return { data: { asignados: 0, omitidos: 0 }, error: "Sesión no válida." };
  if (!ids.length) return { data: { asignados: 0, omitidos: 0 } };
  const { data, error } = await supabase.from("puntos_venta_campana").select("id,provincia,gestor_id,campana_id").in("id", ids);
  if (error) return { data: { asignados: 0, omitidos: 0 }, error: error.message };
  const campanas = Array.from(new Set(((data || []) as Array<{ campana_id?: string }>).map(row => row.campana_id).filter(Boolean))) as string[];
  for (const campanaId of campanas) {
    const bloqueada = await assertCampanaEditable(campanaId);
    if (bloqueada) return { data: { asignados: 0, omitidos: 0 }, error: bloqueada };
  }
  const permitidos = ((data || []) as Array<Pick<PuntoVenta, "id" | "provincia" | "gestor_id">>)
    .filter(punto => sessionCanSeePunto(session, punto))
    .map(punto => punto.id);
  const omitidos = ids.length - permitidos.length;
  if (!permitidos.length) return { data: { asignados: 0, omitidos }, error: "Ninguno de los puntos seleccionados está dentro de tu ámbito." };
  const patch = {
    gestor_id: gestor?.id || null,
    gestor_nombre: gestor?.nombre || null,
    updated_at: new Date().toISOString()
  };
  for (let index = 0; index < permitidos.length; index += 200) {
    const { error: updateError } = await supabase.from("puntos_venta_campana").update(patch).in("id", permitidos.slice(index, index + 200));
    if (updateError) return { data: { asignados: index, omitidos }, error: updateError.message };
  }
  return { data: { asignados: permitidos.length, omitidos } };
}

export async function updatePunto(id: string, patch: Partial<PuntoVenta>): Promise<Result<boolean>> {
  if (!supabase) return { data: false, error: "Supabase no está configurado." };
  if (patch.importe !== undefined && Number(patch.importe ?? 0) < 0) return { data: false, error: "El importe no puede ser negativo." };
  const punto = await campanaIdDePunto(id);
  if (punto.error) return { data: false, error: punto.error };
  if (punto.campanaId) {
    const bloqueada = await assertCampanaEditable(punto.campanaId);
    if (bloqueada) return { data: false, error: bloqueada };
  }
  const { error } = await supabase.from("puntos_venta_campana").update({ ...patch, updated_at: new Date().toISOString() }).eq("id", id);
  if (error) return { data: false, error: error.message };
  return { data: true };
}

// Feature 2: fija la direccion de envio (snapshot + referencia) en todos los puntos
// de un instalador dentro de una campana, para no teclearla punto a punto.
export async function bulkSetDireccionEnvio(campanaId: string, instaladorId: string, direccionEnvio: string | null, direccionEnvioId: string | null): Promise<Result<number>> {
  if (!supabase) return { data: 0, error: "Supabase no está configurado." };
  const bloqueada = await assertCampanaEditable(campanaId);
  if (bloqueada) return { data: 0, error: bloqueada };
  const { data, error } = await supabase.from("puntos_venta_campana")
    .update({ direccion_envio: direccionEnvio || null, direccion_envio_id: direccionEnvioId || null, updated_at: new Date().toISOString() })
    .eq("campana_id", campanaId).eq("instalador_id", instaladorId).select("id");
  if (error) return { data: 0, error: error.message };
  return { data: (data || []).length };
}

export async function deletePunto(id: string): Promise<Result<boolean>> {
  if (!supabase) return { data: false, error: "Supabase no está configurado." };
  const punto = await campanaIdDePunto(id);
  if (punto.error) return { data: false, error: punto.error };
  if (punto.campanaId) {
    const bloqueada = await assertCampanaEditable(punto.campanaId);
    if (bloqueada) return { data: false, error: bloqueada };
  }
  const { error } = await supabase.from("puntos_venta_campana").delete().eq("id", id);
  if (error) return { data: false, error: error.message };
  return { data: true };
}

export async function insertIncidencia(input: { punto_id: string; campana_id: string; descripcion: string; session: AppSession | null }): Promise<Result<IncidenciaCampana | null>> {
  if (!supabase) return { data: null, error: "Supabase no está configurado." };
  const { data, error } = await supabase.from("incidencias_campana").insert({
    punto_id: input.punto_id,
    campana_id: input.campana_id,
    descripcion: input.descripcion,
    estado: "abierta",
    gestor_id: input.session?.id || null,
    gestor_nombre: input.session?.display_name || null
  }).select().single();
  if (error) return { data: null, error: error.message };
  return { data: data as IncidenciaCampana };
}

export async function setIncidenciaEstado(id: string, estado: IncidenciaEstado): Promise<Result<boolean>> {
  if (!supabase) return { data: false, error: "Supabase no está configurado." };
  const patch: Record<string, unknown> = { estado };
  if (estado === "resuelta") patch.resolved_at = new Date().toISOString();
  const { error } = await supabase.from("incidencias_campana").update(patch).eq("id", id);
  if (error) return { data: false, error: error.message };
  return { data: true };
}

// Puente con Logística: al completar un punto se cierra cualquier necesidad de material
// abierta con origen en ese punto (source_type "campaign") y se deja traza en sync_logs,
// que es el registro que consume la pantalla Logística → Sincronización.
export async function syncPuntoCompletadoConLogistica(punto: PuntoVenta, campana: Pick<Campana, "id" | "nombre"> | null, session: AppSession | null): Promise<string> {
  if (!supabase) return "";
  const now = new Date().toISOString();
  const { error: reqError } = await supabase
    .from("logistics_material_requirements")
    .update({ status: "consumida", updated_at: now })
    .eq("source_type", "campaign")
    .eq("source_id", punto.id)
    .not("status", "in", "(entregada,consumida,cancelada)");
  const { error: logError } = await supabase.from("sync_logs").insert({
    id: typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : String(Date.now()),
    evento: "gran_campana.punto_completado",
    origen_modulo: "gran_campanas",
    destino_modulo: "logistica",
    entidad_id: punto.id,
    usuario_id: session?.id || null,
    payload: {
      campana_id: campana?.id || punto.campana_id,
      campana: campana?.nombre || null,
      punto: punto.nombre_comercial,
      provincia: punto.provincia || null,
      importe: punto.importe ?? null
    },
    resultado: reqError ? "error" : "ok",
    error_message: reqError?.message || null,
    created_at: now
  });
  return reqError?.message || logError?.message || "";
}

export function filterPuntosBySession(puntos: PuntoVenta[], session: AppSession | null) {
  if (isAdminSession(session)) return puntos;
  return puntos.filter(punto => sessionCanSeePunto(session, punto));
}

export function provinciasParaSesion(session: AppSession | null) {
  if (isAdminSession(session)) return null;
  return provinceScopeValues(session?.provinces || []);
}

export function normalizeProvincia(value?: string | null) {
  return normalizeProvince(value);
}

export type CampanaExportRow = Record<string, string | number>;

// El presupuesto solo se incluye en exportaciones de administrador.
export function campanaCsvRows(rows: CampanaListadoRow[], incluirFinancieros = true): CampanaExportRow[] {
  return rows.map(row => ({
    Nombre: row.nombre,
    Cliente: row.cliente_marca || "",
    Estado: campanaEstadoLabels[row.estado] || row.estado,
    Provincias: (row.provincias || []).join(", "),
    Gestores: (row.gestores_nombres || []).join(", "),
    Puntos: row.total_puntos,
    Asignados: row.asignados,
    Incidencias: row.incidencias_abiertas,
    ...(incluirFinancieros ? { Presupuesto: Number(row.presupuesto || 0) } : {}),
    "Importe puntos": Number(row.importe_total || 0),
    Inicio: dateOnly(row.fecha_inicio),
    Fin: dateOnly(row.fecha_fin)
  }));
}

export function puntosCsvRows(puntos: PuntoVenta[]): CampanaExportRow[] {
  return puntos.map(punto => ({
    Codigo: punto.codigo || "",
    "Nombre comercial": punto.nombre_comercial,
    Direccion: punto.direccion || "",
    "Direccion envio": punto.direccion_envio || "",
    Provincia: punto.provincia || "",
    Tipo: punto.tipo || "",
    Gestor: punto.gestor_nombre || "",
    Instalador: punto.instalador_nombre || "",
    Estado: puntoEstadoLabels[punto.estado] || punto.estado,
    "Fecha visita": dateOnly(punto.fecha_visita),
    Importe: Number(punto.importe || 0),
    Notas: punto.notas || ""
  }));
}

export function downloadCsv(filename: string, rows: CampanaExportRow[]) {
  if (!rows.length) return;
  const headers = Object.keys(rows[0]);
  const escape = (value: unknown) => {
    const text = csvSafeCell(value);
    return text.includes(";") || text.includes("\n") || text.includes('"') ? `"${text.replace(/"/g, '""')}"` : text;
  };
  const csv = [headers.join(";"), ...rows.map(row => headers.map(h => escape(row[h])).join(";"))].join("\n");
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export async function downloadXlsx(filename: string, rows: CampanaExportRow[]) {
  if (!rows.length) return;
  const XLSX = await import("xlsx");
  const sheet = XLSX.utils.json_to_sheet(rows);
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, "Datos");
  XLSX.writeFile(book, filename);
}

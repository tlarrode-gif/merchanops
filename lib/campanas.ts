import { AppSession, AppUser, isAdminSession, userCanSeeProvince } from "@/lib/access-control";
import { normalizeProvince, provinceScopeValues } from "@/lib/provinces";
import { isSupabaseConfigured, supabase } from "@/lib/supabase";

export type CampanaEstado = "borrador" | "planificada" | "activa" | "pausada" | "completada" | "cancelada";
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
  created_by?: string | null;
  created_by_name?: string | null;
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
  codigo?: string | null;
  nombre_comercial: string;
  direccion?: string | null;
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

export const campanaEstados: CampanaEstado[] = ["borrador", "planificada", "activa", "pausada", "completada", "cancelada"];
export const campanaEstadoLabels: Record<CampanaEstado, string> = {
  borrador: "Borrador",
  planificada: "Planificada",
  activa: "Activa",
  pausada: "Pausada",
  completada: "Completada",
  cancelada: "Cancelada"
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
  return { data: rows.filter(row => sessionCanSeeCampana(session, row)) };
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

export type PuntoInput = Omit<PuntoVenta, "id" | "campana_id" | "created_at" | "updated_at">;

export async function insertPuntosBatch(campanaId: string, puntos: PuntoInput[]): Promise<Result<number>> {
  if (!supabase) return { data: 0, error: "Supabase no está configurado." };
  if (!puntos.length) return { data: 0 };
  const rows = puntos.map(punto => ({
    ...punto,
    campana_id: campanaId,
    fecha_visita: punto.fecha_visita || null,
    importe: punto.importe ?? null,
    datos_extra: punto.datos_extra || {}
  }));
  const { error } = await supabase.from("puntos_venta_campana").insert(rows);
  if (error) return { data: 0, error: error.message };
  return { data: rows.length };
}

export async function updatePunto(id: string, patch: Partial<PuntoVenta>): Promise<Result<boolean>> {
  if (!supabase) return { data: false, error: "Supabase no está configurado." };
  const { error } = await supabase.from("puntos_venta_campana").update({ ...patch, updated_at: new Date().toISOString() }).eq("id", id);
  if (error) return { data: false, error: error.message };
  return { data: true };
}

export async function deletePunto(id: string): Promise<Result<boolean>> {
  if (!supabase) return { data: false, error: "Supabase no está configurado." };
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

export function campanaCsvRows(rows: CampanaListadoRow[]): CampanaExportRow[] {
  return rows.map(row => ({
    Nombre: row.nombre,
    Cliente: row.cliente_marca || "",
    Estado: campanaEstadoLabels[row.estado] || row.estado,
    Provincias: (row.provincias || []).join(", "),
    Gestores: (row.gestores_nombres || []).join(", "),
    Puntos: row.total_puntos,
    Asignados: row.asignados,
    Incidencias: row.incidencias_abiertas,
    Presupuesto: Number(row.presupuesto || 0),
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
    Provincia: punto.provincia || "",
    Tipo: punto.tipo || "",
    Gestor: punto.gestor_nombre || "",
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
    const text = String(value ?? "");
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

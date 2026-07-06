import { supabase } from "@/lib/supabase";

// Fase 2: esquema dinámico de columnas por campaña. Las cabeceras del archivo
// importado se registran en campana_columnas con nombre visible, tipo,
// visibilidad por rol y mapeo opcional a campo interno. Los valores de las
// columnas extra siguen viviendo en puntos_venta_campana.datos_extra, por lo
// que las campañas sin esquema (anteriores a v7.2) funcionan igual que antes.

export type ColumnaTipo = "texto" | "numero" | "fecha" | "booleano";

export type CampanaColumna = {
  id?: string;
  campana_id?: string;
  nombre_original: string;
  nombre_visible: string;
  tipo: ColumnaTipo;
  campo_interno: string | null; // null = dato extra (se guarda en datos_extra)
  visible_gestor: boolean;
  obligatoria: boolean;
  orden: number;
  valor_defecto: string | null;
};

// Marca de UI para descartar una columna del archivo: no se guarda en BD ni en datos_extra.
export const CAMPO_IGNORAR = "__ignorar__";

export const columnaTipos: ColumnaTipo[] = ["texto", "numero", "fecha", "booleano"];
export const columnaTipoLabels: Record<ColumnaTipo, string> = {
  texto: "Texto",
  numero: "Número",
  fecha: "Fecha",
  booleano: "Sí/No"
};

// Campos internos de puntos_venta_campana a los que puede mapearse una columna del archivo.
export const camposInternos: Array<{ value: string; label: string }> = [
  { value: "codigo", label: "Código" },
  { value: "nombre_comercial", label: "Nombre comercial" },
  { value: "direccion", label: "Dirección" },
  { value: "provincia", label: "Provincia" },
  { value: "tipo", label: "Tipo" },
  { value: "estado", label: "Estado" },
  { value: "fecha_visita", label: "Fecha visita" },
  { value: "importe", label: "Importe" },
  { value: "gestor_nombre", label: "Gestor" },
  { value: "notas", label: "Notas" }
];

const tipoPorCampoInterno: Record<string, ColumnaTipo> = {
  importe: "numero",
  fecha_visita: "fecha"
};

type Result<T> = { data: T; error?: string };

export async function fetchCampanaColumnas(campanaId: string): Promise<Result<CampanaColumna[]>> {
  if (!supabase) return { data: [] };
  const { data, error } = await supabase.from("campana_columnas").select("*").eq("campana_id", campanaId).order("orden");
  if (error) return { data: [], error: error.message };
  return { data: (data || []) as CampanaColumna[] };
}

// Reemplaza el esquema completo de la campaña (borrar + insertar). Las columnas
// marcadas como ignoradas no se persisten.
export async function saveCampanaColumnas(campanaId: string, columnas: CampanaColumna[]): Promise<Result<boolean>> {
  if (!supabase) return { data: false, error: "Supabase no está configurado." };
  const filas = columnas
    .filter(col => col.campo_interno !== CAMPO_IGNORAR)
    .map((col, index) => ({
      campana_id: campanaId,
      nombre_original: col.nombre_original,
      nombre_visible: col.nombre_visible.trim() || col.nombre_original,
      tipo: col.tipo,
      campo_interno: col.campo_interno,
      visible_gestor: col.visible_gestor,
      obligatoria: col.obligatoria,
      orden: index,
      valor_defecto: col.valor_defecto?.trim() || null
    }));
  const borrado = await supabase.from("campana_columnas").delete().eq("campana_id", campanaId);
  if (borrado.error) return { data: false, error: borrado.error.message };
  if (!filas.length) return { data: true };
  const { error } = await supabase.from("campana_columnas").insert(filas);
  if (error) return { data: false, error: error.message };
  return { data: true };
}

export async function copyCampanaColumnas(origenId: string, destinoId: string): Promise<Result<boolean>> {
  const origen = await fetchCampanaColumnas(origenId);
  if (origen.error) return { data: false, error: origen.error };
  if (!origen.data.length) return { data: true };
  return saveCampanaColumnas(destinoId, origen.data);
}

// Esquema inicial a partir de las cabeceras del archivo y del mapeo automático del parser.
export function columnasDesdeImportacion(headers: string[], mapping: Array<string | null>): CampanaColumna[] {
  return headers
    .map((header, index) => ({ header: header.trim(), campo: mapping[index] }))
    .filter(item => item.header)
    .map((item, index) => ({
      nombre_original: item.header,
      nombre_visible: item.header,
      tipo: (item.campo && tipoPorCampoInterno[item.campo]) || "texto",
      campo_interno: item.campo,
      visible_gestor: true,
      obligatoria: item.campo === "nombre_comercial",
      orden: index,
      valor_defecto: null
    }));
}

// Columnas extra (datos_extra) visibles para el rol de la sesión, en su orden.
export function columnasExtraVisibles(columnas: CampanaColumna[], isAdmin: boolean): CampanaColumna[] {
  return columnas
    .filter(col => !col.campo_interno && col.campo_interno !== CAMPO_IGNORAR)
    .filter(col => isAdmin || col.visible_gestor)
    .sort((a, b) => a.orden - b.orden);
}

export function formatearValorColumna(value: unknown, tipo: ColumnaTipo): string {
  if (value === null || value === undefined || value === "") return "—";
  if (tipo === "numero") {
    const parsed = Number(String(value).replace(",", "."));
    return Number.isFinite(parsed) ? parsed.toLocaleString("es-ES") : String(value);
  }
  if (tipo === "fecha") {
    const date = new Date(String(value));
    return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleDateString("es-ES", { day: "2-digit", month: "2-digit", year: "numeric" });
  }
  if (tipo === "booleano") {
    const raw = String(value).trim().toLowerCase();
    if (["si", "sí", "true", "1", "x", "yes"].includes(raw)) return "Sí";
    if (["no", "false", "0", ""].includes(raw)) return "No";
    return String(value);
  }
  return String(value);
}

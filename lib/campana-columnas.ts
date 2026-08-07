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

// v10.2 · Columnas que TODA campaña tiene, vengan o no en el Excel de administración:
//   - Instalador y Dirección de envío las rellena el GESTOR desde su sesión.
//   - Picking la rellena ALMACÉN al cerrar el picking (aquí es de solo lectura).
// Se llaman «fijas» porque no se pueden borrar ni remapear en «Configurar columnas».
export const CAMPO_INSTALADOR = "instalador_nombre";
export const CAMPO_DIRECCION_ENVIO = "direccion_envio";
export const CAMPO_PICKING = "picking_cerrado_at";

export type CampoFijo = { campo: string; label: string; tipo: ColumnaTipo; rellena: "gestor" | "almacen"; ayuda: string; alias: string[] };

export const camposFijos: CampoFijo[] = [
  {
    campo: CAMPO_INSTALADOR,
    label: "Instalador",
    tipo: "texto",
    rellena: "gestor",
    ayuda: "Lo asigna el gestor de la zona desde su sesión.",
    alias: ["instalador", "trabajador", "instalador/trabajador", "montador", "operario", "instalador asignado"]
  },
  {
    campo: CAMPO_DIRECCION_ENVIO,
    label: "Dirección de envío",
    tipo: "texto",
    rellena: "gestor",
    ayuda: "La indica el gestor: destino del material del trabajador.",
    alias: ["direccion envio", "direccion de envio", "envio", "direccion entrega", "entrega", "direccion de entrega"]
  },
  {
    campo: CAMPO_PICKING,
    label: "Picking",
    tipo: "fecha",
    rellena: "almacen",
    ayuda: "Fecha que devuelve Almacén al cerrar el picking. No se edita desde aquí.",
    alias: ["picking", "fecha picking", "picking cerrado", "fecha de picking"]
  }
];

const camposFijosPorCampo = new Map(camposFijos.map(fijo => [fijo.campo, fijo]));

export function campoFijoDe(campoInterno?: string | null): CampoFijo | undefined {
  return campoInterno ? camposFijosPorCampo.get(campoInterno) : undefined;
}

export function esColumnaFija(columna: Pick<CampanaColumna, "campo_interno">) {
  return Boolean(campoFijoDe(columna.campo_interno));
}

/**
 * Campos cuyo VALOR nunca se importa del Excel aunque exista una columna con ese nombre:
 * los rellena el gestor o Almacén, así que un dato del archivo solo generaría confusión.
 * La columna sí se conserva en el esquema para que se vea en la tabla de puntos.
 */
export const camposNoImportables = new Set<string>(camposFijos.map(fijo => fijo.campo));

function foldNombre(value: unknown) {
  return String(value ?? "").trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

/** Campos internos mapeados en más de una columna: la última pisaría a las anteriores. */
export function camposInternosDuplicados(columnas: CampanaColumna[]): Array<{ campo: string; label: string; columnas: string[] }> {
  const porCampo = new Map<string, string[]>();
  for (const columna of columnas) {
    const campo = columna.campo_interno;
    if (!campo || campo === CAMPO_IGNORAR) continue;
    porCampo.set(campo, [...(porCampo.get(campo) || []), columna.nombre_original]);
  }
  return Array.from(porCampo.entries())
    .filter(([, nombres]) => nombres.length > 1)
    .map(([campo, nombres]) => ({ campo, label: etiquetaCampoInterno(campo), columnas: nombres }));
}

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
  { value: "fecha_visita", label: "Fecha instalación" },
  { value: "importe", label: "Importe" },
  // v11.5 · Reporte del turno y del desplazamiento (campañas por horas).
  { value: "hora_entrada", label: "Hora de entrada" },
  { value: "hora_salida", label: "Hora de salida" },
  { value: "horas_trabajadas", label: "Horas trabajadas" },
  { value: "kilometros", label: "Kilometraje" },
  { value: "gestor_nombre", label: "Gestor" },
  { value: "instalador_nombre", label: "Instalador (lo pone el gestor)" },
  { value: "direccion_envio", label: "Dirección de envío (la pone el gestor)" },
  { value: "picking_cerrado_at", label: "Picking (lo devuelve Almacén)" },
  { value: "notas", label: "Notas" }
];

export function etiquetaCampoInterno(campo: string) {
  return camposInternos.find(item => item.value === campo)?.label || campo;
}

const tipoPorCampoInterno: Record<string, ColumnaTipo> = {
  importe: "numero",
  fecha_visita: "fecha",
  picking_cerrado_at: "fecha",
  horas_trabajadas: "numero",
  kilometros: "numero"
  // hora_entrada / hora_salida quedan como "texto" a propósito: no son fechas y
  // el formateador de números convertiría "08:30" en un valor sin sentido.
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
// Al final se garantizan las tres columnas fijas (Instalador, Dirección de envío, Picking):
// si el Excel ya trae una columna equivalente se reutiliza esa —para no duplicarla— y si no,
// se añade vacía. Así una campaña recién subida ya tiene dónde trabajar el gestor y dónde
// devolver Almacén la fecha de picking.
export function columnasDesdeImportacion(headers: string[], mapping: Array<string | null>): CampanaColumna[] {
  const delArchivo: CampanaColumna[] = headers
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
  return conColumnasFijas(delArchivo);
}

/**
 * Añade (o normaliza) las columnas fijas de campaña sobre un esquema cualquiera.
 * Idempotente: aplicarla dos veces no duplica nada.
 */
export function conColumnasFijas(columnas: CampanaColumna[]): CampanaColumna[] {
  const resultado = columnas.map(col => ({ ...col }));
  for (const fijo of camposFijos) {
    // 1) ¿Ya hay una columna mapeada a este campo fijo?
    let existente = resultado.find(col => col.campo_interno === fijo.campo);
    // 2) ¿Hay una columna del archivo que se llame como el campo fijo y esté sin mapear?
    if (!existente) {
      existente = resultado.find(col =>
        (!col.campo_interno || col.campo_interno === CAMPO_IGNORAR)
        && (fijo.alias.some(alias => foldNombre(alias) === foldNombre(col.nombre_original)) || foldNombre(fijo.label) === foldNombre(col.nombre_original))
      );
    }
    if (existente) {
      existente.campo_interno = fijo.campo;
      existente.tipo = fijo.tipo;
      existente.nombre_visible = existente.nombre_visible?.trim() || fijo.label;
      existente.obligatoria = false;
      continue;
    }
    resultado.push({
      nombre_original: fijo.label,
      nombre_visible: fijo.label,
      tipo: fijo.tipo,
      campo_interno: fijo.campo,
      visible_gestor: true,
      obligatoria: false,
      orden: resultado.length,
      valor_defecto: null
    });
  }
  return resultado.map((col, index) => ({ ...col, orden: index }));
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

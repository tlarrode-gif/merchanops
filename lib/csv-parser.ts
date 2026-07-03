import { spanishProvinces, normalizeProvince } from "@/lib/provinces";
import { PuntoEstado, PuntoInput } from "@/lib/campanas";

export const MAX_IMPORT_ROWS = 50000;
export const MAX_FILE_BYTES = 10 * 1024 * 1024;

export type ParsedRow = {
  index: number;
  data: PuntoInput;
  errors: string[];
  warnings: string[];
};

export type ParseResult = {
  rows: ParsedRow[];
  headers: string[];
  unmappedColumns: string[];
  fileError?: string;
};

// Variantes aceptadas por columna (comparación sin acentos ni mayúsculas).
const columnVariants: Record<string, string[]> = {
  codigo: ["codigo", "id", "cod", "code", "referencia", "ref", "codigo punto", "id punto"],
  nombre_comercial: ["nombre", "nombre comercial", "nombre_comercial", "name", "punto", "punto de venta", "farmacia", "establecimiento", "comercio", "pdv"],
  direccion: ["direccion", "address", "calle", "domicilio", "direccion completa"],
  provincia: ["provincia", "province", "prov"],
  tipo: ["tipo", "type", "categoria", "canal", "segmento"],
  estado: ["estado", "status"],
  fecha_visita: ["fecha visita", "fecha_visita", "fecha", "visita", "fecha de visita", "date", "fecha prevista"],
  importe: ["importe", "precio", "fee", "amount", "coste", "costo", "tarifa", "pago", "presupuesto punto"],
  gestor_nombre: ["gestor", "manager", "responsable", "instalador", "operativo"],
  notas: ["notas", "notes", "observaciones", "comentarios", "nota"]
};

const estadoVariants: Record<string, PuntoEstado> = {
  pendiente: "pendiente",
  pending: "pendiente",
  completado: "completado",
  completo: "completado",
  finalizado: "completado",
  ok: "completado",
  done: "completado",
  incidencia: "incidencia",
  incidence: "incidencia",
  error: "incidencia",
  cancelado: "cancelado",
  anulado: "cancelado",
  cancelled: "cancelado"
};

function fold(value: unknown) {
  return String(value ?? "").trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
}

function mapHeader(header: string): string | null {
  const key = fold(header);
  if (!key) return null;
  for (const [field, variants] of Object.entries(columnVariants)) {
    if (variants.some(variant => fold(variant) === key)) return field;
  }
  return null;
}

const knownProvinces = new Set(spanishProvinces.map(p => fold(p)));

function parseImporte(value: unknown): { value: number | null; error?: string } {
  const raw = String(value ?? "").trim();
  if (!raw) return { value: null };
  const cleaned = raw.replace(/€|\s/g, "").replace(/\.(?=\d{3}(\D|$))/g, "").replace(",", ".");
  const parsed = Number(cleaned);
  if (!Number.isFinite(parsed)) return { value: null, error: `Importe no numérico: "${raw}"` };
  return { value: parsed };
}

function excelSerialToIso(serial: number) {
  const ms = Math.round((serial - 25569) * 86400000);
  const date = new Date(ms);
  return Number.isNaN(date.getTime()) ? "" : date.toISOString().slice(0, 10);
}

function parseFecha(value: unknown): { value: string | null; error?: string } {
  if (value === null || value === undefined || value === "") return { value: null };
  if (typeof value === "number" && value > 20000 && value < 80000) {
    const iso = excelSerialToIso(value);
    return iso ? { value: iso } : { value: null, error: `Fecha no reconocida: "${value}"` };
  }
  const raw = String(value).trim();
  if (!raw) return { value: null };
  const isoMatch = raw.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (isoMatch) return { value: `${isoMatch[1]}-${isoMatch[2].padStart(2, "0")}-${isoMatch[3].padStart(2, "0")}` };
  const esMatch = raw.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})$/);
  if (esMatch) {
    const year = esMatch[3].length === 2 ? `20${esMatch[3]}` : esMatch[3];
    const month = Number(esMatch[2]);
    const day = Number(esMatch[1]);
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      return { value: `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}` };
    }
  }
  return { value: null, error: `Formato de fecha incorrecto: "${raw}"` };
}

// Parser CSV con soporte de comillas y detección de separador (; , o tabulador).
function parseCsvText(text: string): string[][] {
  const firstLine = text.slice(0, text.indexOf("\n") === -1 ? text.length : text.indexOf("\n"));
  const delimiter = [";", ",", "\t"].map(d => ({ d, n: firstLine.split(d).length })).sort((a, b) => b.n - a.n)[0].d;
  const rows: string[][] = [];
  let current: string[] = [];
  let field = "";
  let inQuotes = false;
  const source = text.replace(/^﻿/, "");
  for (let i = 0; i < source.length; i++) {
    const char = source[i];
    if (inQuotes) {
      if (char === '"') {
        if (source[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += char;
    } else if (char === '"') {
      inQuotes = true;
    } else if (char === delimiter) {
      current.push(field); field = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && source[i + 1] === "\n") i++;
      current.push(field); field = "";
      if (current.some(cell => cell.trim() !== "")) rows.push(current);
      current = [];
    } else field += char;
  }
  current.push(field);
  if (current.some(cell => cell.trim() !== "")) rows.push(current);
  return rows;
}

async function fileToMatrix(file: File): Promise<{ matrix: unknown[][]; error?: string }> {
  const name = file.name.toLowerCase();
  if (file.size > MAX_FILE_BYTES) return { matrix: [], error: "El archivo supera el máximo de 10MB." };
  if (name.endsWith(".csv") || name.endsWith(".txt")) {
    const text = await file.text();
    return { matrix: parseCsvText(text) };
  }
  if (name.endsWith(".xls") || name.endsWith(".xlsx")) {
    const XLSX = await import("xlsx");
    const buffer = await file.arrayBuffer();
    const workbook = XLSX.read(buffer, { type: "array", cellDates: false });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    if (!sheet) return { matrix: [], error: "El archivo Excel no contiene hojas." };
    const matrix = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: "" }) as unknown[][];
    return { matrix };
  }
  return { matrix: [], error: "Formato no soportado. Sube un archivo CSV, XLS o XLSX." };
}

export async function parseImportFile(file: File): Promise<ParseResult> {
  const { matrix, error } = await fileToMatrix(file);
  if (error) return { rows: [], headers: [], unmappedColumns: [], fileError: error };
  if (!matrix.length) return { rows: [], headers: [], unmappedColumns: [], fileError: "El archivo está vacío." };

  const headers = (matrix[0] || []).map(cell => String(cell ?? "").trim());
  const mapping = headers.map(mapHeader);
  if (!mapping.includes("nombre_comercial")) {
    return { rows: [], headers, unmappedColumns: [], fileError: "No se ha encontrado ninguna columna de nombre del punto (acepta: Nombre, Nombre Comercial, Punto, Farmacia...)." };
  }

  const bodyRows = matrix.slice(1).filter(row => (row || []).some(cell => String(cell ?? "").trim() !== ""));
  if (bodyRows.length > MAX_IMPORT_ROWS) {
    return { rows: [], headers, unmappedColumns: [], fileError: `El archivo tiene ${bodyRows.length.toLocaleString("es-ES")} filas y el máximo permitido es ${MAX_IMPORT_ROWS.toLocaleString("es-ES")}. Divide el archivo e importa por partes.` };
  }

  const unmappedColumns = headers.filter((_, i) => mapping[i] === null && headers[i]);
  const rows: ParsedRow[] = bodyRows.map((raw, index) => {
    const errors: string[] = [];
    const warnings: string[] = [];
    const record: Record<string, unknown> = {};
    const extra: Record<string, unknown> = {};
    headers.forEach((header, col) => {
      const value = raw[col];
      const field = mapping[col];
      if (field) record[field] = value;
      else if (header && String(value ?? "").trim() !== "") extra[header] = value;
    });

    const nombre = String(record.nombre_comercial ?? "").trim();
    if (!nombre) errors.push("Falta el nombre comercial (campo obligatorio).");

    const provinciaRaw = String(record.provincia ?? "").trim();
    let provincia: string | null = null;
    if (provinciaRaw) {
      provincia = normalizeProvince(provinciaRaw);
      if (!knownProvinces.has(fold(provincia))) {
        warnings.push(`Provincia no reconocida: "${provinciaRaw}"`);
        provincia = provinciaRaw;
      }
    }

    const importeParsed = parseImporte(record.importe);
    if (importeParsed.error) errors.push(importeParsed.error);

    const fechaParsed = parseFecha(record.fecha_visita);
    if (fechaParsed.error) warnings.push(fechaParsed.error);

    const estadoRaw = fold(record.estado);
    const estado: PuntoEstado = estadoVariants[estadoRaw] || "pendiente";
    if (estadoRaw && !estadoVariants[estadoRaw]) warnings.push(`Estado no reconocido ("${String(record.estado)}"), se importará como Pendiente.`);

    if (!String(record.direccion ?? "").trim() && nombre) warnings.push("Dirección vacía.");

    const data: PuntoInput = {
      codigo: String(record.codigo ?? "").trim() || null,
      nombre_comercial: nombre || "(sin nombre)",
      direccion: String(record.direccion ?? "").trim() || null,
      provincia,
      tipo: String(record.tipo ?? "").trim() || null,
      estado,
      fecha_visita: fechaParsed.value,
      importe: importeParsed.value,
      gestor_id: null,
      gestor_nombre: String(record.gestor_nombre ?? "").trim() || null,
      notas: String(record.notas ?? "").trim() || null,
      datos_extra: Object.keys(extra).length ? extra : {}
    };
    return { index: index + 2, data, errors, warnings };
  });

  return { rows, headers, unmappedColumns };
}

export function buildTemplateCsv() {
  const headers = ["codigo", "nombre_comercial", "direccion", "provincia", "tipo", "fecha_visita", "importe", "gestor", "notas"];
  const sample = ["PV-001", "Farmacia Sol", "Calle Mayor 1, Madrid", "Madrid", "Retail A", "15/06/2026", "34,00", "", "Escaparate principal"];
  return "﻿" + headers.join(";") + "\n" + sample.join(";") + "\n";
}

export function summarizeParse(rows: ParsedRow[]) {
  const withErrors = rows.filter(row => row.errors.length);
  const withWarnings = rows.filter(row => !row.errors.length && row.warnings.length);
  return {
    total: rows.length,
    ok: rows.length - withErrors.length,
    errores: withErrors.length,
    avisos: withWarnings.length,
    mensajes: [
      ...withErrors.flatMap(row => row.errors.map(err => ({ fila: row.index, tipo: "error" as const, texto: err }))),
      ...rows.flatMap(row => row.warnings.map(warn => ({ fila: row.index, tipo: "aviso" as const, texto: warn })))
    ]
  };
}

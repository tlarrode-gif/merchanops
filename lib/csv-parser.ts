import { spanishProvinces, normalizeProvince } from "@/lib/provinces";
import { PuntoEstado, PuntoInput } from "@/lib/campanas";
import { CAMPO_IGNORAR, CampanaColumna } from "@/lib/campana-columnas";

export const MAX_IMPORT_ROWS = 50000;
export const MAX_FILE_BYTES = 25 * 1024 * 1024;
export const MAX_FILE_MB = Math.round(MAX_FILE_BYTES / (1024 * 1024));

// Extensiones aceptadas. Las de hoja de cálculo las lee SheetJS; las de texto se
// parsean como CSV con detección de separador. Si la extensión no dice nada
// (archivo sin extensión, renombrado, descargado con nombre raro) se decide por
// la firma binaria del archivo, así que la lista es una ayuda, no un muro.
export const SPREADSHEET_EXTENSIONS = [".xlsx", ".xlsm", ".xltx", ".xlsb", ".xls", ".ods", ".fods"];
export const TEXT_EXTENSIONS = [".csv", ".tsv", ".tab", ".txt"];
export const ACCEPTED_EXTENSIONS = [...TEXT_EXTENSIONS, ...SPREADSHEET_EXTENSIONS];
// Atributo accept del <input type="file">: solo extensiones. Los tipos MIME de
// Excel/CSV varían por sistema operativo (y Windows manda "application/vnd.ms-excel"
// para algunos .csv), por lo que mezclarlos en la lista escondía archivos válidos
// en el diálogo de selección.
export const FILE_ACCEPT_ATTR = ACCEPTED_EXTENSIONS.join(",");

// Filas iniciales en las que se busca la cabecera (informes con títulos, logos o
// filas en blanco encima de la tabla real).
const HEADER_SCAN_ROWS = 30;

export type ParsedRow = {
  index: number;
  data: PuntoInput;
  errors: string[];
  warnings: string[];
};

export type ParseResult = {
  rows: ParsedRow[];
  headers: string[];
  // Campo interno detectado por cabecera (null = dato extra), alineado con headers.
  mapping: Array<string | null>;
  unmappedColumns: string[];
  fileError?: string;
  // Hoja usada y hojas disponibles (solo en archivos Excel/ODS).
  sheetName?: string;
  sheetNames?: string[];
  // Fila (1-based, tal y como se ve en Excel) donde se han detectado las cabeceras.
  headerRow?: number;
  // true = no se ha reconocido ninguna columna de nombre del punto. El archivo se
  // parsea igual para que el usuario pueda asignarla en «Configurar columnas»,
  // pero no se puede importar hasta que lo haga.
  needsNameColumn?: boolean;
};

// Variantes aceptadas por columna (comparación sin acentos ni mayúsculas).
const columnVariants: Record<string, string[]> = {
  codigo: ["codigo", "id", "cod", "code", "referencia", "ref", "codigo punto", "id punto", "codigo centro", "cod centro", "id centro", "codigo cliente", "cod cliente", "codigo pdv", "codigo farmacia", "num", "numero"],
  nombre_comercial: ["nombre", "nombre comercial", "nombre_comercial", "name", "punto", "punto de venta", "punto venta", "farmacia", "establecimiento", "comercio", "pdv", "centro", "nombre centro", "nombre del centro", "nombre del punto", "nombre pdv", "nombre farmacia", "razon social", "cliente", "tienda", "local", "sucursal", "denominacion"],
  direccion: ["direccion", "address", "calle", "domicilio", "direccion completa", "direccion punto", "dir", "calle y numero", "domicilio social"],
  provincia: ["provincia", "province", "prov", "provincia punto"],
  tipo: ["tipo", "type", "categoria", "canal", "segmento"],
  estado: ["estado", "status", "situacion"],
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

// Separador más frecuente fuera de comillas en las primeras líneas con contenido.
// Mirar solo la primera línea fallaba con cabeceras entrecomilladas que contienen
// comas ("Dirección, número") o con archivos cuyo primer registro es un título.
function detectDelimiter(text: string): string {
  const candidates = [";", ",", "\t", "|"];
  const counts = new Map(candidates.map(d => [d, 0]));
  let lines = 0;
  let inQuotes = false;
  let lineHasContent = false;
  for (let i = 0; i < text.length && lines < 5; i++) {
    const char = text[i];
    if (char === '"') { inQuotes = !inQuotes; lineHasContent = true; continue; }
    if (inQuotes) continue;
    if (char === "\n" || char === "\r") {
      if (lineHasContent) lines += 1;
      lineHasContent = false;
      continue;
    }
    if (counts.has(char)) counts.set(char, (counts.get(char) || 0) + 1);
    if (char.trim()) lineHasContent = true;
  }
  const best = candidates
    .map(d => ({ d, n: counts.get(d) || 0 }))
    .sort((a, b) => b.n - a.n)[0];
  return best.n > 0 ? best.d : ";";
}

// Parser CSV con soporte de comillas y detección de separador (; , tab o |).
function parseCsvText(text: string): string[][] {
  const delimiter = detectDelimiter(text);
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

function rowHasContent(row: unknown[] | undefined) {
  return (row || []).some(cell => String(cell ?? "").trim() !== "");
}

// Cabecera = fila con más celdas reconocibles (por el mapeo automático o por el
// esquema guardado de la campaña) entre las primeras filas. Así se ignoran los
// títulos, logos y filas en blanco que casi todos los informes traen encima de la
// tabla. Si ninguna fila puntúa, se usa la primera con contenido.
function detectHeaderRow(matrix: unknown[][], known: (header: string) => boolean): number {
  const limit = Math.min(matrix.length, HEADER_SCAN_ROWS);
  let best = -1;
  let bestScore = 0;
  let firstWithContent = -1;
  for (let index = 0; index < limit; index++) {
    const raw = (matrix[index] || []) as unknown[];
    const cells = raw.map(cell => String(cell ?? "").trim());
    const nonEmpty = cells.filter(Boolean);
    if (!nonEmpty.length) continue;
    const primera = firstWithContent === -1;
    if (primera) firstWithContent = index;
    // Una fila con números no es una cabecera: es un registro de datos.
    if (!primera && raw.some(cell => typeof cell === "number")) continue;
    const reconocidas = nonEmpty.filter(cell => known(cell)).length;
    const conNombre = nonEmpty.some(cell => mapHeader(cell) === "nombre_comercial");
    // Para desplazar la cabecera por debajo de la primera fila con contenido hace
    // falta una señal clara: varias columnas reconocidas, o una tabla estrecha en la
    // que TODAS las celdas son cabeceras conocidas. Así una fila de datos con una
    // celda que coincide con un alias ("Farmacia", "Centro"...) no la suplanta.
    if (!primera && reconocidas < 2 && !(conNombre && reconocidas === nonEmpty.length)) continue;
    const score = reconocidas + (conNombre ? 10 : 0);
    if (score > bestScore) { bestScore = score; best = index; }
  }
  if (best >= 0) return best;
  return firstWithContent === -1 ? 0 : firstWithContent;
}

// Elige la hoja con datos: la primera cuya cabecera detectada tenga columna de
// nombre; si no hay ninguna, la primera hoja con contenido. Los libros con una
// portada, instrucciones o una hoja vacía delante ya no bloquean la importación.
function pickSheet(
  workbook: { SheetNames: string[]; Sheets: Record<string, unknown> },
  toMatrix: (sheet: unknown) => unknown[][],
  known: (header: string) => boolean
): { sheetName: string; matrix: unknown[][] } | null {
  let fallback: { sheetName: string; matrix: unknown[][] } | null = null;
  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) continue;
    const matrix = toMatrix(sheet);
    if (!matrix.some(rowHasContent)) continue;
    if (!fallback) fallback = { sheetName, matrix };
    const headerRow = detectHeaderRow(matrix, known);
    const headers = (matrix[headerRow] || []).map(cell => String(cell ?? "").trim());
    if (headers.some(header => mapHeader(header) === "nombre_comercial")) return { sheetName, matrix };
  }
  return fallback;
}

function extensionOf(name: string) {
  const lower = name.toLowerCase();
  const dot = lower.lastIndexOf(".");
  return dot === -1 ? "" : lower.slice(dot);
}

// Firma binaria: ZIP (xlsx/xlsm/xlsb/ods) u OLE2 (xls clásico). Permite aceptar
// archivos con extensión ausente, rara o equivocada en lugar de rechazarlos.
async function sniffBinary(file: File): Promise<"zip" | "ole" | null> {
  const head = new Uint8Array(await file.slice(0, 8).arrayBuffer());
  if (head[0] === 0x50 && head[1] === 0x4b) return "zip";
  const ole = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
  if (ole.every((byte, index) => head[index] === byte)) return "ole";
  return null;
}

type MatrixResult = { matrix: unknown[][]; sheetName?: string; sheetNames?: string[]; error?: string };

async function spreadsheetToMatrix(file: File, known: (header: string) => boolean): Promise<MatrixResult> {
  const XLSX = await import("xlsx");
  const buffer = await file.arrayBuffer();
  let workbook;
  try {
    workbook = XLSX.read(buffer, { type: "array", cellDates: false });
  } catch (error) {
    return { matrix: [], error: `No se ha podido abrir el archivo como hoja de cálculo (${error instanceof Error ? error.message : "formato no reconocido"}). Si lo has descargado de otra herramienta, ábrelo en Excel y guárdalo como .xlsx o .csv.` };
  }
  const sheetNames = workbook.SheetNames || [];
  if (!sheetNames.length) return { matrix: [], error: "El archivo no contiene ninguna hoja.", sheetNames };
  const elegida = pickSheet(
    workbook as unknown as { SheetNames: string[]; Sheets: Record<string, unknown> },
    sheet => XLSX.utils.sheet_to_json(sheet as never, { header: 1, raw: true, defval: "" }) as unknown[][],
    known
  );
  if (!elegida) {
    return { matrix: [], sheetNames, error: `Todas las hojas del archivo están vacías (${sheetNames.join(", ")}).` };
  }
  return { matrix: elegida.matrix, sheetName: elegida.sheetName, sheetNames };
}

async function fileToMatrix(file: File, known: (header: string) => boolean): Promise<MatrixResult> {
  if (!file.size) return { matrix: [], error: "El archivo está vacío (0 bytes)." };
  if (file.size > MAX_FILE_BYTES) {
    const mb = (file.size / (1024 * 1024)).toFixed(1);
    return { matrix: [], error: `El archivo pesa ${mb}MB y el máximo es ${MAX_FILE_MB}MB. Divídelo o guárdalo como .csv (pesa mucho menos que un .xlsx con formato).` };
  }
  const extension = extensionOf(file.name);
  if (SPREADSHEET_EXTENSIONS.includes(extension)) return spreadsheetToMatrix(file, known);
  if (TEXT_EXTENSIONS.includes(extension)) return { matrix: parseCsvText(await file.text()) };

  // Extensión desconocida: decidir por el contenido antes de rechazar.
  const firma = await sniffBinary(file);
  if (firma) return spreadsheetToMatrix(file, known);
  const text = await file.text();
  // Un binario leído como texto llega lleno de caracteres de control.
  const sospechoso = text.slice(0, 2048).replace(/[\t\r\n]/g, "").match(/[\u0000-\u0008\u000e-\u001f]/g);
  if (sospechoso && sospechoso.length > 5) {
    return { matrix: [], error: `No se reconoce el formato de «${file.name}». Sube un archivo CSV, XLS, XLSX, XLSM o ODS.` };
  }
  return { matrix: parseCsvText(text) };
}

// Con `esquema` (configuración de columnas editada por el usuario) el mapeo del
// archivo se decide por columna: campo interno, dato extra, ignorada, obligatoria,
// valor por defecto y tipo. Sin esquema se aplica el mapeo automático de siempre.
export async function parseImportFile(file: File, esquema?: CampanaColumna[] | null): Promise<ParseResult> {
  const configPorHeader = new Map((esquema || []).map(col => [fold(col.nombre_original), col]));
  const headerConocida = (header: string) => Boolean(configPorHeader.get(fold(header)) || mapHeader(header));

  const { matrix, error, sheetName, sheetNames } = await fileToMatrix(file, headerConocida);
  const contexto = { sheetName, sheetNames };
  if (error) return { rows: [], headers: [], mapping: [], unmappedColumns: [], fileError: error, ...contexto };
  if (!matrix.some(rowHasContent)) return { rows: [], headers: [], mapping: [], unmappedColumns: [], fileError: "El archivo no tiene ninguna fila con datos.", ...contexto };

  const headerIndex = detectHeaderRow(matrix, headerConocida);
  const headers = (matrix[headerIndex] || []).map(cell => String(cell ?? "").trim());
  const base = { ...contexto, headerRow: headerIndex + 1 };
  if (!headers.some(Boolean)) {
    return { rows: [], headers, mapping: [], unmappedColumns: [], fileError: "No se han encontrado cabeceras de columna en el archivo.", ...base };
  }
  const mapping = headers.map(header => {
    const config = configPorHeader.get(fold(header));
    return config ? config.campo_interno : mapHeader(header);
  });
  // Sin columna de nombre el archivo NO se rechaza: se parsea igual y la UI pide
  // asignar la columna en «Configurar columnas». Antes esto era un error de
  // archivo y dejaba al usuario sin ninguna forma de arreglarlo.
  const needsNameColumn = !mapping.includes("nombre_comercial");

  const bodyRows: Array<{ raw: unknown[]; fila: number }> = [];
  for (let index = headerIndex + 1; index < matrix.length; index++) {
    const raw = (matrix[index] || []) as unknown[];
    if (rowHasContent(raw)) bodyRows.push({ raw, fila: index + 1 });
  }
  if (bodyRows.length > MAX_IMPORT_ROWS) {
    return { rows: [], headers, mapping, unmappedColumns: [], fileError: `El archivo tiene ${bodyRows.length.toLocaleString("es-ES")} filas y el máximo permitido es ${MAX_IMPORT_ROWS.toLocaleString("es-ES")}. Divide el archivo e importa por partes.`, ...base };
  }
  if (!bodyRows.length) {
    return { rows: [], headers, mapping, unmappedColumns: [], fileError: `Se han detectado las cabeceras en la fila ${headerIndex + 1} pero no hay ninguna fila de datos debajo.`, ...base };
  }

  const unmappedColumns = headers.filter((_, i) => mapping[i] === null && headers[i]);
  const rows: ParsedRow[] = bodyRows.map(({ raw, fila }) => {
    const errors: string[] = [];
    const warnings: string[] = [];
    const record: Record<string, unknown> = {};
    const extra: Record<string, unknown> = {};
    headers.forEach((header, col) => {
      const value = raw[col];
      const field = mapping[col];
      if (field === CAMPO_IGNORAR) return;
      if (field) { record[field] = value; return; }
      if (!header) return;
      const config = configPorHeader.get(fold(header));
      let final: unknown = value;
      if (String(final ?? "").trim() === "" && config?.valor_defecto) final = config.valor_defecto;
      if (String(final ?? "").trim() === "") {
        if (config?.obligatoria) errors.push(`Falta valor en la columna obligatoria «${config.nombre_visible}».`);
        return;
      }
      if (config?.tipo === "numero") {
        const parsed = parseImporte(final);
        if (parsed.error) warnings.push(`Columna «${config.nombre_visible}»: valor no numérico "${String(final)}".`);
        else final = parsed.value;
      } else if (config?.tipo === "fecha") {
        const parsed = parseFecha(final);
        if (parsed.error) warnings.push(`Columna «${config.nombre_visible}»: ${parsed.error}`);
        else if (parsed.value) final = parsed.value;
      }
      extra[header] = final;
    });

    // Valores por defecto del esquema también para campos internos vacíos.
    for (const config of Array.from(configPorHeader.values())) {
      const campo = config.campo_interno;
      if (!campo || campo === CAMPO_IGNORAR || !config.valor_defecto) continue;
      if (String(record[campo] ?? "").trim() === "") record[campo] = config.valor_defecto;
    }

    const nombre = String(record.nombre_comercial ?? "").trim();
    // Si el archivo no trae columna de nombre no se marca fila a fila: el aviso es
    // del archivo completo (needsNameColumn) y se resuelve mapeando la columna.
    if (!nombre && !needsNameColumn) errors.push("Falta el nombre comercial (campo obligatorio).");

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
      // Sin nombre se deja vacío a propósito: la fila queda marcada con error y no
      // se importa, y en la actualización por código un nombre vacío no pisa el
      // nombre existente del punto.
      nombre_comercial: nombre,
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
    return { index: fila, data, errors, warnings };
  });

  return { rows, headers, mapping, unmappedColumns, needsNameColumn, ...base };
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

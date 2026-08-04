/**
 * MerchanOps · Grandes Campañas — contenedor de documentos (v11.1).
 *
 * POR QUÉ EXISTE ESTE MÓDULO
 * El briefing, el planograma y las instrucciones de montaje viajaban por
 * WhatsApp. Cuando entra un instalador a mitad de campaña nadie sabe cuál es la
 * versión buena del planograma, y cuando el cliente reclama un montaje nadie
 * puede demostrar qué instrucciones se dieron.
 *
 * CÓMO FUNCIONA
 * El fichero va al bucket PRIVADO `campana-documentos`, con la ruta
 * `<campana_id>/<punto_id|campana>/<sello>-<nombre>`. La primera carpeta es
 * siempre la campaña porque de ahí cuelga el ámbito de las policies de Storage.
 * La ficha (nombre, versión, visibilidad) vive en `campana_documentos`, y el
 * enlace de descarga es una URL firmada de duración corta: el bucket no es
 * público y no debe serlo nunca.
 *
 * REGLAS DE LA CASA
 *  - Validación y nombres de ruta son funciones PURAS y se prueban en
 *    tests/campanas-documentos.test.ts. Las que hablan con Supabase, no.
 *  - Los límites (25 MB, lista de tipos) están DUPLICADOS a propósito: aquí para
 *    dar un mensaje decente antes de subir 25 MB por una red móvil, y en la base
 *    (CHECK de v11_1) porque la validación del navegador no es una defensa.
 */

import { supabase } from "@/lib/supabase";
import { AppSession, isAdminSession } from "@/lib/access-control";

export const BUCKET_DOCUMENTOS = "campana-documentos";

/** Mismo tope que el importador de Excel: 25 MB. */
export const MAX_DOC_BYTES = 25 * 1024 * 1024;
export const MAX_DOC_MB = Math.round(MAX_DOC_BYTES / (1024 * 1024));

export type CategoriaDocumento =
  | "briefing"
  | "planograma"
  | "instrucciones"
  | "tarifas"
  | "reporte"
  | "excel_origen"
  | "otro";

export const categorias: CategoriaDocumento[] = ["briefing", "planograma", "instrucciones", "tarifas", "reporte", "excel_origen", "otro"];

export const categoriaLabels: Record<CategoriaDocumento, string> = {
  briefing: "Briefing del cliente",
  planograma: "Planograma",
  instrucciones: "Instrucciones de montaje",
  tarifas: "Tarifas",
  reporte: "Reporte",
  excel_origen: "Excel original",
  otro: "Otro"
};

/**
 * Tipos aceptados. Debe coincidir con el CHECK `campana_documentos_mime_permitido`
 * de v11_1: si aquí entra algo que allí no, la subida se hace y el alta falla
 * después, dejando un fichero huérfano en el bucket.
 */
export const mimesPermitidos = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-excel",
  "application/vnd.oasis.opendocument.spreadsheet",
  "text/csv",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/zip"
]);

/** Extensiones por si el navegador no manda un MIME reconocible (pasa con .heic y .csv). */
const extensionAMime: Record<string, string> = {
  pdf: "application/pdf",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  heic: "image/heic",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  xls: "application/vnd.ms-excel",
  ods: "application/vnd.oasis.opendocument.spreadsheet",
  csv: "text/csv",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  doc: "application/msword",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  zip: "application/zip"
};

export const DOC_ACCEPT_ATTR = Object.keys(extensionAMime).map(ext => `.${ext}`).join(",");

export type Documento = {
  id: string;
  campana_id: string;
  punto_id?: string | null;
  nombre: string;
  descripcion?: string | null;
  categoria: CategoriaDocumento;
  storage_path: string;
  mime: string;
  tamano_bytes: number;
  version: number;
  sustituye_a?: string | null;
  vigente: boolean;
  visible_instalador: boolean;
  visible_gestor: boolean;
  subido_por?: string | null;
  subido_por_nombre?: string | null;
  created_at: string;
  deleted_at?: string | null;
  deleted_por_nombre?: string | null;
};

export function extensionDe(nombre: string): string {
  const partes = String(nombre || "").toLowerCase().split(".");
  return partes.length > 1 ? partes[partes.length - 1] : "";
}

/**
 * MIME final del archivo: el que declara el navegador si lo reconocemos, y si no
 * el que deduce la extensión. Devuelve "" cuando no hay forma de saberlo, que es
 * lo que hace saltar la validación.
 */
export function mimeDeArchivo(nombre: string, mimeDeclarado?: string | null): string {
  const declarado = String(mimeDeclarado || "").toLowerCase();
  if (mimesPermitidos.has(declarado)) return declarado;
  return extensionAMime[extensionDe(nombre)] || "";
}

/** Deja el nombre en algo que sobreviva a una URL sin perder legibilidad. */
export function nombreSeguroArchivo(nombre: string): string {
  const limpio = String(nombre || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-zA-Z0-9.\-_]+/g, "-")
    .replace(/-+/g, "-")
    // Un símbolo pegado al punto de la extensión deja «informe-.pdf»: se limpia.
    .replace(/-*\.-*/g, ".")
    .replace(/^[-.]+|[-.]+$/g, "")
    .toLowerCase();
  return limpio.slice(0, 80) || "documento";
}

/**
 * Ruta dentro del bucket. La PRIMERA carpeta es siempre el id de la campaña
 * porque las policies de Storage sacan de ahí el ámbito (`storage.foldername`).
 * El sello se recibe por parámetro para que las pruebas no dependan del reloj.
 */
export function rutaDocumento(campanaId: string, puntoId: string | null, nombreArchivo: string, sello: string): string {
  const carpeta = puntoId ? `punto-${puntoId}` : "campana";
  return `${campanaId}/${carpeta}/${sello}-${nombreSeguroArchivo(nombreArchivo)}`;
}

export type ArchivoValidable = { name: string; size: number; type?: string };

/** Devuelve el motivo por el que un archivo no se puede subir, o null si se puede. */
export function validarArchivo(archivo: ArchivoValidable): string | null {
  if (!archivo || !archivo.name) return "No se ha seleccionado ningún archivo.";
  if (!archivo.size) return "El archivo está vacío.";
  if (archivo.size > MAX_DOC_BYTES) {
    return `El archivo ocupa ${formatearTamano(archivo.size)} y el tope son ${MAX_DOC_MB} MB.`;
  }
  const mime = mimeDeArchivo(archivo.name, archivo.type);
  if (!mime) {
    return `No se admite este tipo de archivo (${extensionDe(archivo.name) || "sin extensión"}). Se aceptan PDF, imágenes, Excel/CSV, Word, PowerPoint y ZIP.`;
  }
  return null;
}

export function formatearTamano(bytes: number): string {
  const n = Number(bytes || 0);
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export type DocumentosAgrupados = {
  campana: Documento[];
  porPunto: Array<{ puntoId: string; documentos: Documento[] }>;
};

/**
 * Separa los documentos de campaña de los de punto (D2 de la migración). Solo
 * entran los vigentes y no borrados: el histórico se pide aparte.
 */
export function agruparDocumentos(documentos: Documento[]): DocumentosAgrupados {
  const vivos = documentos.filter(doc => doc.vigente && !doc.deleted_at);
  const campana = vivos.filter(doc => !doc.punto_id);
  const mapa = new Map<string, Documento[]>();
  for (const doc of vivos) {
    if (!doc.punto_id) continue;
    const lista = mapa.get(doc.punto_id);
    if (lista) lista.push(doc);
    else mapa.set(doc.punto_id, [doc]);
  }
  return {
    campana,
    porPunto: Array.from(mapa.entries()).map(([puntoId, docs]) => ({ puntoId, documentos: docs }))
  };
}

/**
 * Cadena de versiones de un documento, de la más nueva a la más vieja. Sigue
 * `sustituye_a` hacia atrás; corta si detecta un ciclo para no colgarse con
 * datos corruptos.
 */
export function historialVersiones(documentos: Documento[], documentoId: string): Documento[] {
  const porId = new Map(documentos.map(doc => [doc.id, doc]));
  const cadena: Documento[] = [];
  const vistos = new Set<string>();
  let actual = porId.get(documentoId);
  while (actual && !vistos.has(actual.id)) {
    vistos.add(actual.id);
    cadena.push(actual);
    actual = actual.sustituye_a ? porId.get(actual.sustituye_a) : undefined;
  }
  return cadena;
}

/** Quién puede retirar un documento: administración o quien lo subió. */
export function puedeBorrar(session: AppSession | null, documento: Pick<Documento, "subido_por">): boolean {
  if (!session?.active) return false;
  if (isAdminSession(session)) return true;
  return Boolean(documento.subido_por && documento.subido_por === session.id);
}

type Result<T> = { data: T; error?: string };

export async function fetchDocumentos(campanaId: string, incluirHistorico = false): Promise<Result<Documento[]>> {
  if (!supabase) return { data: [], error: "Supabase no está configurado." };
  let query = supabase
    .from("campana_documentos")
    .select("*")
    .eq("campana_id", campanaId)
    .order("created_at", { ascending: false });
  if (!incluirHistorico) query = query.is("deleted_at", null);
  const { data, error } = await query;
  if (error) return { data: [], error: error.message };
  return { data: (data || []) as Documento[] };
}

export type SubidaDocumento = {
  campanaId: string;
  puntoId?: string | null;
  archivo: File;
  nombre?: string;
  descripcion?: string | null;
  categoria?: CategoriaDocumento;
  visibleInstalador?: boolean;
  sustituyeA?: string | null;
};

/**
 * Sube el fichero y da de alta su ficha. Si el alta falla se BORRA el fichero
 * recién subido: dejarlo sería un huérfano que ocupa espacio y que nadie puede
 * encontrar desde la aplicación.
 */
export async function subirDocumento(subida: SubidaDocumento): Promise<Result<Documento | null>> {
  if (!supabase) return { data: null, error: "Supabase no está configurado." };
  const motivo = validarArchivo(subida.archivo);
  if (motivo) return { data: null, error: motivo };

  const mime = mimeDeArchivo(subida.archivo.name, subida.archivo.type);
  const sello = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
  const ruta = rutaDocumento(subida.campanaId, subida.puntoId || null, subida.archivo.name, sello);

  const { error: subidaError } = await supabase.storage
    .from(BUCKET_DOCUMENTOS)
    .upload(ruta, subida.archivo, { contentType: mime, upsert: false });
  if (subidaError) return { data: null, error: `No se pudo subir el archivo: ${subidaError.message}` };

  const { data, error } = await supabase.rpc("merchan_gc_documento_publicar", {
    p_doc: {
      campana_id: subida.campanaId,
      punto_id: subida.puntoId || null,
      nombre: (subida.nombre || subida.archivo.name).trim(),
      descripcion: subida.descripcion || null,
      categoria: subida.categoria || "otro",
      storage_path: ruta,
      mime,
      tamano_bytes: subida.archivo.size,
      visible_instalador: Boolean(subida.visibleInstalador),
      sustituye_a: subida.sustituyeA || null
    }
  });

  if (error) {
    // Sin ficha el fichero es invisible para la aplicación: se retira.
    await supabase.storage.from(BUCKET_DOCUMENTOS).remove([ruta]);
    return { data: null, error: `El archivo no se registró: ${error.message}` };
  }
  return { data: data as Documento };
}

/** URL firmada de descarga. Corta a propósito: el bucket es privado. */
export async function urlDescarga(storagePath: string, segundos = 300): Promise<Result<string>> {
  if (!supabase) return { data: "", error: "Supabase no está configurado." };
  const { data, error } = await supabase.storage.from(BUCKET_DOCUMENTOS).createSignedUrl(storagePath, segundos);
  if (error) return { data: "", error: error.message };
  return { data: data?.signedUrl || "" };
}

/** Borrado lógico (D5): la ficha se conserva, el enlace deja de ofrecerse. */
export async function retirarDocumento(documentoId: string, session: AppSession | null): Promise<Result<boolean>> {
  if (!supabase) return { data: false, error: "Supabase no está configurado." };
  const { error } = await supabase
    .from("campana_documentos")
    .update({
      deleted_at: new Date().toISOString(),
      deleted_por_nombre: session?.display_name || "Operaciones",
      vigente: false
    })
    .eq("id", documentoId);
  if (error) return { data: false, error: error.message };
  return { data: true };
}

export async function cambiarVisibilidadInstalador(documentoId: string, visible: boolean): Promise<Result<boolean>> {
  if (!supabase) return { data: false, error: "Supabase no está configurado." };
  const { error } = await supabase.from("campana_documentos").update({ visible_instalador: visible }).eq("id", documentoId);
  if (error) return { data: false, error: error.message };
  return { data: true };
}

/**
 * Importación CSV unificada de pagos (fase 3).
 *
 * Flujo en dos pasos:
 *  1) `previewIsdinImport(text)` — valida por fila SIN tocar la base:
 *     columnas obligatorias, estados, importes (un importe inválido es un
 *     error de fila, jamás un 0 silencioso) y duplicados dentro del archivo.
 *     No se inventan nombres, fechas ni estados.
 *  2) `confirmImport(...)` — llama al RPC atómico `confirm_import_run`:
 *     registra la ejecución (usuario, archivo, hash SHA-256, filas, errores),
 *     y sincroniza las obligaciones con el ledger EN LA MISMA TRANSACCIÓN.
 *     Si algo falla, no queda nada aplicado a medias. Reimportar el mismo
 *     archivo devuelve 'duplicada' sin re-aplicar.
 *
 * Huella por fila: identidad natural (origen + VIN), estable ante cambios de
 * importe/fecha — la idempotencia de contenido la aporta el ledger.
 */

import { supabase } from "@/lib/supabase";
import { computeIsdinObligations } from "@/lib/payments/engine";
import { LedgerError, toRpcPayload } from "@/lib/payments/ledger";
import { MoneyError, centsToEuros, parseEurToCents } from "@/lib/payments/money";
import { IsdinVinylInput, ObligationDraft } from "@/lib/payments/types";

export const ISDIN_IMPORT_STATUSES = [
  "Nuevo",
  "Finalizado",
  "Resuelto - Pendiente colocador",
  "Incidencia",
  "Incidencia llamada",
  "Cancelado"
] as const;

export interface ImportRowPreview {
  rowIndex: number;
  fingerprint: string;
  status: "aplicada" | "rechazada";
  errors: string[];
  /** Payload minimizado (identidad + finanzas; sin teléfonos ni comentarios). */
  payload: Record<string, string | number | boolean | null>;
  /** Entrada del motor si la fila es válida. */
  vinyl: IsdinVinylInput | null;
}

export interface ImportPreview {
  source: "isdin_vinyls";
  fileHash: string;
  rows: ImportRowPreview[];
  validCount: number;
  rejectedCount: number;
  obligations: ObligationDraft[];
}

export async function sha256Hex(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

const clean = (value: string | undefined) => String(value ?? "").trim();

function parseIntStrict(raw: string, field: string, errors: string[]): number {
  if (!raw) return 0;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0) {
    errors.push(`${field} inválido: "${raw}" (entero >= 0)`);
    return 0;
  }
  return value;
}

/**
 * Previsualiza un CSV ISDIN (formato ; con las columnas de la plantilla:
 * farmacia;VIN;estado;comentarios;tipo;campaña;alto;ancho;pago_base;semana;
 * calle;número;ciudad;CP;provincia;instalador;obs;andamio;revisitas;teléfono).
 */
export async function previewIsdinImport(text: string): Promise<ImportPreview> {
  const fileHash = await sha256Hex(text);
  const lines = text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .filter((l) => !l.toLowerCase().startsWith("nombre farmacia;"));

  const seenVins = new Set<string>();
  const rows: ImportRowPreview[] = [];
  const obligations: ObligationDraft[] = [];

  for (let i = 0; i < lines.length; i++) {
    const cols = lines[i].split(";");
    const [pharmacy, vin, statusRaw, , , , , , basePaymentRaw] = cols;
    const revisitRaw = cols[18];
    const errors: string[] = [];

    const vinClean = clean(vin);
    const status = clean(statusRaw);

    if (!vinClean) errors.push("Falta el VIN (columna 2): identificador obligatorio");
    if (!clean(pharmacy)) errors.push("Falta el nombre de farmacia (columna 1)");
    if (!status) errors.push("Falta el estado (columna 3): no se asume 'Nuevo' en registros financieros");
    else if (!ISDIN_IMPORT_STATUSES.includes(status as (typeof ISDIN_IMPORT_STATUSES)[number])) {
      errors.push(`Estado desconocido: "${status}"`);
    }
    if (vinClean && seenVins.has(vinClean)) errors.push(`VIN duplicado dentro del archivo: ${vinClean}`);
    if (vinClean) seenVins.add(vinClean);

    let basePaymentEur: number | null = null;
    const baseRaw = clean(basePaymentRaw);
    if (baseRaw) {
      try {
        basePaymentEur = centsToEuros(parseEurToCents(baseRaw));
      } catch (e) {
        if (e instanceof MoneyError) errors.push(`Pago base inválido: "${baseRaw}" — la fila se rechaza (no se convierte en 0)`);
        else throw e;
      }
    } else if (status === "Finalizado") {
      errors.push("Un registro Finalizado requiere pago base (importe original)");
    }

    const revisitCount = parseIntStrict(clean(revisitRaw), "Revisitas", errors);

    const fingerprint = await sha256Hex(`isdin_vinyls|${vinClean.toLowerCase()}`);
    const valid = errors.length === 0;

    const vinyl: IsdinVinylInput | null = valid
      ? {
          vin: vinClean,
          status,
          basePaymentEur,
          revisitCount,
          // El CSV trae semanas, no fechas de evento: las obligaciones nacen
          // bloqueadas por missing_event_date hasta que exista la fecha real.
          incidentPaymentWeek: ["Incidencia", "Resuelto - Pendiente colocador", "Cancelado"].includes(status) ? clean(cols[9]) || null : null,
          incidentPaymentDate: null,
          installationPaymentDate: null,
          incidentOpenedAt: null,
          incidentResolvedAt: null,
          statusChangedAt: null,
          installerId: null,
          installerName: clean(cols[15]) || null
        }
      : null;

    if (vinyl) obligations.push(...computeIsdinObligations(vinyl).obligations);

    rows.push({
      rowIndex: i + 1,
      fingerprint,
      status: valid ? "aplicada" : "rechazada",
      errors,
      payload: {
        vin: vinClean || null,
        estado: status || null,
        pago_base: basePaymentEur,
        revisitas: revisitCount
      },
      vinyl
    });
  }

  return {
    source: "isdin_vinyls",
    fileHash,
    rows,
    validCount: rows.filter((r) => r.status === "aplicada").length,
    rejectedCount: rows.filter((r) => r.status === "rechazada").length,
    obligations
  };
}

export interface ConfirmImportResult {
  status: "confirmada" | "duplicada";
  runId: string;
  totalRows?: number;
  validRows?: number;
  rejectedRows?: number;
  sync?: { inserted: number; updated: number; unchanged: number; divergences: unknown[] };
  message?: string;
}

/** Confirma la importación previsualizada. Atómico: o entra todo, o nada. */
export async function confirmImport(
  preview: ImportPreview,
  fileName: string,
  actor: string,
  correlationId?: string
): Promise<ConfirmImportResult> {
  if (!supabase) {
    throw new LedgerError("Supabase no está disponible: la importación no puede confirmarse (modo solo lectura).", "transient");
  }
  const { data, error } = await supabase.rpc("confirm_import_run", {
    p_source: preview.source,
    p_file_name: fileName,
    p_file_hash: preview.fileHash,
    p_rows: preview.rows.map(({ rowIndex, fingerprint, status, errors, payload }) => ({ rowIndex, fingerprint, status, errors, payload })),
    p_obligations: preview.obligations.map(toRpcPayload),
    p_actor: actor,
    p_correlation_id: correlationId ?? null
  });
  if (error) throw new LedgerError(error.message, /duplicad/i.test(error.message) ? "validation" : "permanent");
  return data as ConfirmImportResult;
}

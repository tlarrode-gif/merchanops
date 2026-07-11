/**
 * Cliente del ledger persistente de obligaciones (fase 2).
 *
 * Toda escritura pasa por las funciones RPC de PostgreSQL
 * (supabase/v8_0_payment_obligations.sql), que ejecutan en transacción y
 * aplican las guardas: idempotencia por clave estable, estados
 * calculado→revisado→cerrado/anulado, líneas cerradas intocables, borrado
 * físico prohibido y auditoría inmutable. El cliente NUNCA escribe la tabla
 * directamente ni envía el estado completo para sobrescribir.
 */

import { supabase } from "@/lib/supabase";
import { ObligationDraft, ObligationStatus } from "@/lib/payments/types";

export class LedgerError extends Error {
  constructor(
    message: string,
    public readonly kind: "validation" | "concurrency" | "transient" | "permanent"
  ) {
    super(message);
    this.name = "LedgerError";
  }
}

function classify(message: string): LedgerError {
  if (/conflicto de concurrencia/i.test(message)) return new LedgerError(message, "concurrency");
  if (/transición|inmutable|requiere|no encontrada|no se borran/i.test(message)) return new LedgerError(message, "validation");
  if (/fetch|network|timeout|connection/i.test(message)) return new LedgerError(message, "transient");
  return new LedgerError(message, "permanent");
}

function requireClient() {
  if (!supabase) {
    throw new LedgerError("Supabase no está configurado: el ledger de pagos requiere conexión (modo degradado).", "transient");
  }
  return supabase;
}

/** Convierte una obligación del motor al payload jsonb del RPC. */
export function toRpcPayload(draft: ObligationDraft) {
  return {
    key: draft.key,
    origin: draft.origin,
    sourceId: draft.sourceId,
    type: draft.type,
    kind: draft.kind,
    amountCents: draft.amountCents,
    eventDate: draft.eventDate,
    workerId: draft.workerId,
    workerName: draft.workerName,
    concept: draft.concept,
    payable: draft.payable,
    blockedReasons: draft.blockedReasons
  };
}

export interface SyncResult {
  inserted: number;
  updated: number;
  unchanged: number;
  divergences: Array<{ key: string; reason: string; ledgerAmountCents: number; engineAmountCents: number }>;
}

/**
 * Sincroniza las obligaciones calculadas por el motor con el ledger.
 * Idempotente: reimportar/recalcular lo mismo no duplica ni reabre nada;
 * las diferencias sobre líneas revisadas/cerradas vuelven como divergencias
 * de conciliación (para ajuste o anulación explícita, jamás automática).
 */
export async function syncObligations(
  drafts: ObligationDraft[],
  actor: string,
  correlationId?: string,
  scope?: { origin: string; sourceIds: string[] }
): Promise<SyncResult> {
  const client = requireClient();
  const { data, error } = await client.rpc("sync_payment_obligations", {
    p_obligations: drafts.map(toRpcPayload),
    p_actor: actor,
    p_correlation_id: correlationId ?? null,
    // Ámbito del recálculo: las obligaciones activas del ámbito que ya no
    // aparecen en el payload vuelven como divergencia 'missing_in_recalc'
    // (ej. bajar revisit_count) para anulación explícita, jamás automática.
    p_scope_origin: scope?.origin ?? null,
    p_scope_source_ids: scope?.sourceIds ?? null
  });
  if (error) throw classify(error.message);
  return data as SyncResult;
}

/** Cambia el estado validando transición y versión (control optimista). */
export async function changeObligationStatus(
  key: string,
  to: ObligationStatus,
  actor: string,
  reason?: string,
  expectedVersion?: number
): Promise<void> {
  const client = requireClient();
  const { error } = await client.rpc("change_payment_obligation_status", {
    p_key: key,
    p_to: to,
    p_actor: actor,
    p_reason: reason ?? null,
    p_expected_version: expectedVersion ?? null
  });
  if (error) throw classify(error.message);
}

/** Ajuste o anulación enlazado a la obligación original (motivo obligatorio). */
export async function createAdjustment(
  originalKey: string,
  amountCents: number,
  actor: string,
  reason: string,
  kind: "ajuste" | "anulacion" = "ajuste"
): Promise<void> {
  if (!Number.isInteger(amountCents)) throw new LedgerError("El ajuste debe ir en céntimos enteros.", "validation");
  if (!reason.trim()) throw new LedgerError("Un ajuste requiere motivo.", "validation");
  const client = requireClient();
  const { error } = await client.rpc("create_payment_adjustment", {
    p_original_key: originalKey,
    p_amount_cents: amountCents,
    p_actor: actor,
    p_reason: reason,
    p_kind: kind
  });
  if (error) throw classify(error.message);
}

export interface LedgerRow {
  id: string;
  obligation_key: string;
  origin: string;
  source_id: string;
  type: string;
  kind: string;
  amount_cents: number;
  currency: string;
  event_date: string | null;
  period: string | null;
  worker_id: string | null;
  worker_name: string | null;
  concept: string;
  status: ObligationStatus;
  payable: boolean;
  blocked_reasons: string[];
  version: number;
  created_at: string;
  updated_at: string;
}

export async function listObligations(filters?: {
  origin?: string;
  period?: string;
  status?: ObligationStatus;
  workerId?: string;
}): Promise<LedgerRow[]> {
  const client = requireClient();
  let query = client.from("payment_obligations").select("*").order("created_at", { ascending: false });
  if (filters?.origin) query = query.eq("origin", filters.origin);
  if (filters?.period) query = query.eq("period", filters.period);
  if (filters?.status) query = query.eq("status", filters.status);
  if (filters?.workerId) query = query.eq("worker_id", filters.workerId);
  const { data, error } = await query;
  if (error) throw classify(error.message);
  return (data ?? []) as LedgerRow[];
}

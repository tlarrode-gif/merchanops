/**
 * Conciliación histórica de pagos ISDIN (fase 7).
 *
 * Compara lo que EXISTE en el ledger con lo que DEBERÍA existir según el
 * motor único, sin cambiar jamás la tarifa histórica (8,56 €):
 *  - revisitas omitidas (finalizados/incidencias que cobraron 1 sola visita);
 *  - "Resuelto - Pendiente colocador" con el importe original ya cobrado;
 *  - obligaciones faltantes a crear.
 *
 * `dryRun=true` (por defecto) SOLO genera el informe. `apply` usa
 * `sync_payment_obligations`, que por diseño crea únicamente lo que falta,
 * jamás toca líneas revisadas/cerradas (devuelve divergencias) ni duplica
 * líneas ya pagadas. Cada corrección queda trazada en la auditoría inmutable
 * del ledger con el correlation id de la conciliación.
 */

import { computeIsdinObligations } from "@/lib/payments/engine";
import { LedgerRow, SyncResult, listObligations, syncObligations } from "@/lib/payments/ledger";
import { IsdinVinylInput, ObligationDraft } from "@/lib/payments/types";

export interface ReconcileFinding {
  vin: string;
  kind: "missing_failed_visit" | "missing_installation" | "resuelto_con_original_cobrado" | "amount_divergence";
  detail: string;
  obligationKey?: string;
}

export interface ReconcileReport {
  analyzedVinyls: number;
  expectedObligations: number;
  existingObligations: number;
  missing: ObligationDraft[];
  findings: ReconcileFinding[];
  dryRun: boolean;
  applied?: SyncResult;
}

/** Informe puro (testeable) a partir de vinilos y filas del ledger. */
export function buildReconcileReport(vinyls: IsdinVinylInput[], ledger: LedgerRow[]): Omit<ReconcileReport, "dryRun" | "applied"> {
  const byKey = new Map(ledger.map((row) => [row.obligation_key, row]));
  const missing: ObligationDraft[] = [];
  const findings: ReconcileFinding[] = [];
  let expected = 0;

  for (const vinyl of vinyls) {
    const { obligations } = computeIsdinObligations(vinyl);
    expected += obligations.length;
    for (const draft of obligations) {
      const existing = byKey.get(draft.key);
      if (!existing) {
        missing.push(draft);
        findings.push({
          vin: vinyl.vin,
          kind: draft.type === "failed_visit" ? "missing_failed_visit" : "missing_installation",
          detail: `Falta la obligación ${draft.key} (${(draft.amountCents / 100).toFixed(2)} €)`,
          obligationKey: draft.key
        });
      } else if (existing.amount_cents !== draft.amountCents && existing.status !== "anulado") {
        findings.push({
          vin: vinyl.vin,
          kind: "amount_divergence",
          detail: `${draft.key}: ledger ${(existing.amount_cents / 100).toFixed(2)} € vs esperado ${(draft.amountCents / 100).toFixed(2)} € (estado ${existing.status}; corregir vía ajuste/anulación, nunca edición)` ,
          obligationKey: draft.key
        });
      }
    }

    // "Resuelto - Pendiente colocador" con el original ya en el ledger: cobro
    // prematuro histórico (el motor nunca genera installation en ese estado).
    if (vinyl.status === "Resuelto - Pendiente colocador") {
      const installation = byKey.get(`isdin:${vinyl.vin}:installation`);
      if (installation && installation.status !== "anulado") {
        findings.push({
          vin: vinyl.vin,
          kind: "resuelto_con_original_cobrado",
          detail: `VIN ${vinyl.vin} está pendiente de colocador pero el ledger tiene la instalación (${(installation.amount_cents / 100).toFixed(2)} €, estado ${installation.status}): requiere anulación con motivo.`,
          obligationKey: installation.obligation_key
        });
      }
    }
  }

  return {
    analyzedVinyls: vinyls.length,
    expectedObligations: expected,
    existingObligations: ledger.length,
    missing,
    findings
  };
}

/** Ejecuta la conciliación contra el ledger real. dryRun=true no escribe nada. */
export async function reconcileIsdin(
  vinyls: IsdinVinylInput[],
  actor: string,
  options: { dryRun?: boolean } = {}
): Promise<ReconcileReport> {
  const dryRun = options.dryRun !== false;
  const ledger = await listObligations({ origin: "isdin" });
  const report = buildReconcileReport(vinyls, ledger);

  if (dryRun || report.missing.length === 0) {
    return { ...report, dryRun };
  }

  // apply: el RPC solo inserta lo que falta; lo revisado/cerrado es intocable.
  const applied = await syncObligations(report.missing, actor, `reconcile:${new Date().toISOString().slice(0, 10)}`);
  return { ...report, dryRun: false, applied };
}

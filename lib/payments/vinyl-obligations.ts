/**
 * Volcado de obligaciones de pago al editar un vinilo ISDIN.
 *
 * POR QUÉ EXISTE ESTE MÓDULO
 * Hasta ahora las obligaciones de pago solo nacían en la importación de XLSX, y
 * además `confirm_import_run` recibía únicamente las de los VIN **nuevos**
 * (`app/grandes-campanas/isdin/page.tsx`: «Registro contable atómico: solo
 * obligaciones de VIN nuevos»). Consecuencia: en cuanto un VIN existía, ningún
 * cambio de estado posterior volvía a generar ni actualizar su obligación. Un
 * vinilo que pasaba a `Finalizado` después de su importación se quedaba sin
 * pago, en silencio. `lib/payments/reconcile.ts` resolvía justo eso, pero no
 * estaba conectado a ninguna pantalla.
 *
 * QUIÉN PUEDE EJECUTARLO
 * Cualquiera que pueda editar el vinilo, **sin exigir rol de administrador**:
 * los gestores son responsables de su zona y validan sus propios pagos. No hace
 * falta relajar nada en base — `sync_payment_obligations` es SECURITY INVOKER y
 * la policy `pagos_scope` de `payment_obligations` ya admite a cualquier usuario
 * con permiso `pagos` sobre vinilos existentes. El control real sigue estando en
 * la RLS, no en la UI.
 *
 * IDEMPOTENTE: el RPC solo crea lo que falta. Nunca toca líneas revisadas,
 * cerradas o pagadas, ni duplica: las divergencias se devuelven para revisión
 * manual, jamás se resuelven solas.
 */

import { computeIsdinObligations } from "@/lib/payments/engine";
import { SyncResult, syncObligations } from "@/lib/payments/ledger";
import { IsdinVinylInput } from "@/lib/payments/types";

/** Fila de `isdin_vinyls` tal como la devuelve Supabase. */
type VinylRow = Record<string, unknown>;

function text(value: unknown): string | null {
  const clean = String(value ?? "").trim();
  return clean ? clean : null;
}

function numberOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Traduce una fila de `isdin_vinyls` a la entrada del motor único de pagos. */
export function vinylRowToEngineInput(row: VinylRow): IsdinVinylInput {
  return {
    vin: String(row.vinyl ?? "").trim(),
    status: String(row.status ?? "Nuevo"),
    basePaymentEur: numberOrNull(row.base_payment),
    revisitCount: numberOrNull(row.revisit_count),
    incidentPaymentWeek: text(row.incident_payment_week),
    incidentPaymentDate: text(row.incident_payment_date),
    installationPaymentDate: text(row.installation_payment_date),
    incidentOpenedAt: text(row.incident_opened_at),
    incidentResolvedAt: text(row.incident_resolved_at),
    statusChangedAt: text(row.status_changed_at),
    installerId: text(row.installer_id),
    installerName: text(row.installer_name)
  };
}

/**
 * Recalcula y vuelca las obligaciones de los vinilos indicados.
 *
 * Se envía el conjunto COMPLETO de obligaciones esperadas de esos VIN (no solo
 * las que faltan) para que el ámbito del RPC cuadre y no marque como
 * `missing_in_recalc` una obligación que sigue siendo válida.
 *
 * Devuelve `null` si no hay nada que volcar. Lanza si el volcado falla: quien
 * llama decide si eso bloquea la operación o solo avisa.
 */
export async function syncVinylObligations(rows: VinylRow[], actor: string): Promise<SyncResult | null> {
  const inputs = rows.map(vinylRowToEngineInput).filter(input => input.vin);
  if (!inputs.length) return null;

  const drafts = inputs.flatMap(input => computeIsdinObligations(input).obligations);
  if (!drafts.length) return null;

  return syncObligations(drafts, actor, `vinilo:${new Date().toISOString().slice(0, 10)}`, {
    origin: "isdin",
    sourceIds: inputs.map(input => input.vin)
  });
}

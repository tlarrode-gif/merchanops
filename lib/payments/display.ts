/**
 * Importes para PRESENTACIÓN, derivados del motor único.
 *
 * POR QUÉ EXISTE (M-03)
 * El mismo cálculo estaba implementado tres veces con reglas distintas:
 *  - `app/page.tsx` (pestaña Pagos y Panel): euros en coma flotante, y un
 *    importe ausente se convertía en 0 y se sumaba al total como si fuera dato.
 *  - `lib/payment-ledger.ts`: euros en coma flotante, mismo problema.
 *  - `lib/payments/engine.ts`: céntimos enteros y bloqueo explícito.
 * Resultado: la pestaña Pagos podía mostrar un total que el ledger consideraba
 * impagable, sin avisar de nada.
 *
 * Este módulo es la ÚNICA vía por la que la interfaz obtiene importes: delega
 * en `computeServiceObligations` y solo traduce céntimos a euros al final. La
 * aritmética ocurre siempre en enteros.
 *
 * SOBRE EL BLOQUEO
 * El motor marca como bloqueada tanto la obligación de un servicio sin fecha de
 * validación (`not_payable_status`, `missing_validated_at`) como la de un
 * importe inválido. Para PINTAR una cifra solo importa lo segundo: un servicio
 * aún no validado tiene un importe perfectamente calculable, simplemente no se
 * paga todavía. Por eso `amountIssue` distingue ambos casos y la UI únicamente
 * avisa cuando el problema es el importe.
 */

import { computeServiceObligations, servicePointPayCents } from "@/lib/payments/engine";
import { centsToEuros } from "@/lib/payments/money";
import { BlockReason, ServiceInput, ServicePointInput } from "@/lib/payments/types";

type Row = Record<string, any>;

/** Motivos de bloqueo que hablan del IMPORTE, no de si toca pagar todavía. */
const AMOUNT_BLOCKERS: BlockReason[] = ["invalid_amount", "missing_original_fee"];

function str(value: unknown) {
  return value == null ? "" : String(value);
}
function strOrNull(value: unknown) {
  const clean = str(value).trim();
  return clean ? clean : null;
}
/**
 * OJO: un valor no numérico devuelve `NaN`, NO `null`. Es deliberado. `null`
 * acabaría absorbido por el `?? 0` del motor y se convertiría en un 0 silencioso;
 * `NaN` llega hasta `eurosToCents`, que lo rechaza y bloquea la obligación. Hay
 * un test que lo vigila (`tests/payments-lines.test.ts`, «importe inválido en un
 * punto bloquea la línea con issue»).
 */
function numOrNull(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  return Number(value);
}

/** Fila de `points` → entrada del motor. */
export function pointRowToInput(point: Row): ServicePointInput {
  return {
    id: str(point.id),
    feeEur: numOrNull(point.fee),
    originalFeeEur: numOrNull(point.original_fee),
    incidentFeeEur: numOrNull(point.incident_fee),
    // La columna `status` es la legada; `point_status` manda cuando existe.
    pointStatus: str(point.point_status || point.status || "Pendiente"),
    incidentStatus: strOrNull(point.incident_status),
    incidentResolvedAt: strOrNull(point.incident_resolved_at)
  };
}

/** Fila de `services` + sus puntos → entrada del motor. */
export function serviceRowToInput(service: Row, points: Row[]): ServiceInput {
  return {
    id: str(service.id),
    status: str(service.status),
    paymentType: (str(service.payment_type) || "Puntos") as ServiceInput["paymentType"],
    validatedAt: strOrNull(service.validated_at),
    hourlyRateEur: numOrNull(service.hourly_rate),
    hoursWorked: numOrNull(service.hours_worked),
    workerId: strOrNull(service.worker_id),
    workerName: strOrNull(service.worker_name),
    points: points.map(pointRowToInput)
  };
}

/** Céntimos que se pagan por un punto, según el motor. */
export function pointPayCents(point: Row): number {
  return servicePointPayCents(pointRowToInput(point), [], str(point.service_id)).cents;
}

/** Lo mismo en euros, para pintar. */
export function pointPayEur(point: Row): number {
  return centsToEuros(pointPayCents(point));
}

export interface ServiceTotals {
  pointsEur: number;
  hoursEur: number;
  totalEur: number;
  /** true si algún importe es inválido o falta (NO si simplemente no toca pagar aún). */
  amountIssue: boolean;
}

/** Totales de un servicio, calculados en céntimos y devueltos en euros. */
export function serviceTotalsEur(service: Row, points: Row[]): ServiceTotals {
  const { obligations } = computeServiceObligations(serviceRowToInput(service, points));
  const byType = (type: string) => obligations.find(o => o.type === type);
  const pointsCents = byType("points")?.amountCents ?? 0;
  const hoursCents = byType("hours")?.amountCents ?? 0;
  const amountIssue = obligations.some(o => o.blockedReasons.some(reason => AMOUNT_BLOCKERS.includes(reason)));
  return {
    pointsEur: centsToEuros(pointsCents),
    hoursEur: centsToEuros(hoursCents),
    totalEur: centsToEuros(pointsCents + hoursCents),
    amountIssue
  };
}

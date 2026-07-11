/**
 * Tipos estrictos del dominio de pagos. Prohibido `Record<string, any>` en la
 * lógica financiera: los adaptadores de entrada convierten filas crudas a
 * estos tipos ANTES de calcular.
 */

export type ObligationOrigin = "servicio" | "gran_campana" | "isdin";

export type ObligationType = "installation" | "failed_visit" | "points" | "hours" | "adjustment" | "reversal";

export type ObligationKind = "pago" | "ajuste" | "anulacion";

/** Estados del ciclo de vida de una obligación (fase 2 los persiste con CHECK). */
export type ObligationStatus = "calculado" | "revisado" | "cerrado" | "anulado";

export const OBLIGATION_TRANSITIONS: Record<ObligationStatus, ObligationStatus[]> = {
  calculado: ["revisado", "anulado"],
  revisado: ["cerrado", "calculado", "anulado"],
  cerrado: ["anulado"], // jamás vuelve a calculado; correcciones via ajuste/anulación
  anulado: []
};

export type BlockReason =
  | "missing_event_date"
  | "missing_validated_at"
  | "not_payable_status"
  | "missing_worker"
  | "invalid_amount"
  | "missing_original_fee"
  | "preventive_call";

/**
 * Obligación calculada por el motor. La CLAVE es la identidad estable e
 * inmutable: NUNCA incluye importe, fecha ni estado (valores mutables).
 */
export interface ObligationDraft {
  /** Clave idempotente estable, ej. `isdin:VIN-123:failed_visit:2`. */
  key: string;
  origin: ObligationOrigin;
  /** Id de la entidad origen (servicio, punto, vinilo). */
  sourceId: string;
  type: ObligationType;
  kind: ObligationKind;
  /** Importe en céntimos de EUR (entero, >= 0 para kind "pago"). */
  amountCents: number;
  currency: "EUR";
  /** Fecha real del evento (YYYY-MM-DD) o null si falta: BLOQUEA, no se inventa. */
  eventDate: string | null;
  /** Periodo YYYY-MM derivado de eventDate (null si falta la fecha). */
  period: string | null;
  workerId: string | null;
  workerName: string | null;
  concept: string;
  /** true si puede liquidarse; false si hay motivos de bloqueo. */
  payable: boolean;
  blockedReasons: BlockReason[];
}

export interface EngineIssue {
  severity: "critico" | "alto" | "medio";
  origin: ObligationOrigin;
  entityId: string;
  description: string;
}

export interface EngineResult {
  obligations: ObligationDraft[];
  issues: EngineIssue[];
}

export interface PaymentsSummary {
  totalCents: number;
  payableCents: number;
  blockedCents: number;
  byOrigin: Record<string, number>;
  byWorker: Record<string, number>;
  byPeriod: Record<string, number>;
}

// ---------------------------------------------------------------------------
// Entradas tipadas
// ---------------------------------------------------------------------------

export type IsdinVinylStatus =
  | "Nuevo"
  | "Incidencia llamada"
  | "Incidencia"
  | "Resuelto - Pendiente colocador"
  | "Finalizado"
  | "Cancelado";

export interface IsdinVinylInput {
  vin: string;
  status: IsdinVinylStatus | string;
  /** Importe original del servicio (euros). */
  basePaymentEur: number | null;
  /** Nº total de visitas fallidas pagables. */
  revisitCount: number | null;
  /** Semana de la 1ª visita fallida (su existencia = hubo visita real). */
  incidentPaymentWeek: string | null;
  incidentPaymentDate: string | null;
  installationPaymentDate: string | null;
  incidentOpenedAt: string | null;
  incidentResolvedAt: string | null;
  statusChangedAt: string | null;
  installerId: string | null;
  installerName: string | null;
}

export type ServicePaymentType = "Puntos" | "Horas" | "Mixto";

export interface ServicePointInput {
  id: string;
  feeEur: number | null;
  originalFeeEur: number | null;
  incidentFeeEur: number | null;
  pointStatus: string;
  incidentStatus: string | null;
  incidentResolvedAt: string | null;
}

export interface ServiceInput {
  id: string;
  status: string;
  paymentType: ServicePaymentType;
  validatedAt: string | null;
  hourlyRateEur: number | null;
  hoursWorked: number | null;
  workerId: string | null;
  workerName: string | null;
  points: ServicePointInput[];
}

export interface BigCampaignPointInput {
  id: string;
  campaignId: string;
  pointStatus: string;
  feeEur: number | null;
  originalFeeEur: number | null;
  incidentFeeEur: number | null;
  incidentStatus: string | null;
  incidentResolvedAt: string | null;
  validatedAt: string | null;
  finishedAt: string | null;
  workerId: string | null;
  workerName: string | null;
}

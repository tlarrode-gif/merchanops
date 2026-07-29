/**
 * Motor ÚNICO de dominio de pagos.
 *
 * Todas las vistas, exportaciones y (en fase 2) el ledger persistente deben
 * calcular a través de este módulo. Reglas de negocio de la auditoría:
 *
 * ISDIN (tarifa por visita fallida = 8,56 €, constante única):
 * - `Incidencia` y `Resuelto - Pendiente colocador`: se paga SOLO
 *   `visitas_fallidas × 8,56`. NO se paga el importe original todavía.
 * - `Finalizado`: `importe original + visitas_fallidas × 8,56`. Finalizar no
 *   reduce las visitas pagables.
 * - `Incidencia llamada` (preventiva) y `Nuevo`: 0 €.
 * - `Cancelado`: visitas fallidas solo si hubo visita real
 *   (existe `incident_payment_week`); una cancelación en frío no paga.
 * - Normalización documentada: un estado de visita fallida implica al menos
 *   1 visita real aunque `revisit_count` venga a 0 (dato histórico incompleto).
 *   Reducir el contador NO elimina obligaciones ya emitidas: eso se gestiona
 *   con anulaciones explícitas (fase 2) y se señala como issue.
 *
 * Fechas: si falta la fecha real del evento la obligación queda BLOQUEADA
 * (`missing_event_date`). Jamás se sustituye por la fecha actual.
 *
 * Identidad: la clave idempotente NUNCA contiene importe, fecha o estado.
 */

import { FAILED_VISIT_FEE_CENTS } from "@/lib/payments/constants";
import { MoneyError, eurosToCents } from "@/lib/payments/money";
import {
  BigCampaignPointInput,
  BlockReason,
  EngineIssue,
  EngineResult,
  IsdinVinylInput,
  ObligationDraft,
  PaymentsSummary,
  ServiceInput
} from "@/lib/payments/types";

const dateOnly = (value: string | null | undefined): string | null => (value ? String(value).slice(0, 10) : null);
const periodOf = (date: string | null): string | null => (date ? date.slice(0, 7) : null);

function draft(
  base: Omit<ObligationDraft, "payable" | "blockedReasons" | "period" | "currency" | "kind"> & {
    kind?: ObligationDraft["kind"];
    blockedReasons?: BlockReason[];
  }
): ObligationDraft {
  const blocked = [...(base.blockedReasons ?? [])];
  if (!base.eventDate) blocked.push("missing_event_date");
  return {
    ...base,
    kind: base.kind ?? "pago",
    currency: "EUR",
    period: periodOf(base.eventDate),
    blockedReasons: blocked,
    payable: blocked.length === 0
  };
}

/** Convierte euros a céntimos capturando importes inválidos como bloqueo. */
function centsOrBlock(
  euros: number | null | undefined,
  blocked: BlockReason[],
  reason: BlockReason = "invalid_amount"
): number {
  if (euros == null) {
    blocked.push(reason);
    return 0;
  }
  try {
    const cents = eurosToCents(euros);
    if (cents < 0) {
      blocked.push("invalid_amount");
      return 0;
    }
    return cents;
  } catch (error) {
    if (error instanceof MoneyError) {
      blocked.push("invalid_amount");
      return 0;
    }
    throw error;
  }
}

// ---------------------------------------------------------------------------
// ISDIN
// ---------------------------------------------------------------------------

const ISDIN_FAILED_VISIT_STATUSES = ["Incidencia", "Resuelto - Pendiente colocador"];

/** Nº de visitas fallidas pagables efectivas de un vinilo. */
export function isdinPayableFailedVisits(v: IsdinVinylInput): number {
  const declared = Math.max(0, Math.floor(Number(v.revisitCount ?? 0)));
  const status = String(v.status || "");
  if (status === "Nuevo" || status === "Incidencia llamada") return 0;
  const hadRealVisit = Boolean(v.incidentPaymentWeek) || Boolean(v.incidentOpenedAt);
  if (status === "Cancelado") return hadRealVisit ? Math.max(1, declared) : 0;
  if (ISDIN_FAILED_VISIT_STATUSES.includes(status)) return Math.max(1, declared);
  if (status === "Finalizado") {
    // Finalizar no reduce visitas: si hubo incidencia, al menos 1.
    return hadRealVisit ? Math.max(1, declared) : declared;
  }
  return declared;
}

export function computeIsdinObligations(v: IsdinVinylInput): EngineResult {
  const issues: EngineIssue[] = [];
  const obligations: ObligationDraft[] = [];
  const status = String(v.status || "Nuevo");
  const vin = v.vin;

  if (status === "Nuevo") return { obligations, issues };
  if (status === "Incidencia llamada") {
    // Preventiva: nunca genera pago de visita fallida.
    return { obligations, issues };
  }

  const visits = isdinPayableFailedVisits(v);
  const visitDate = dateOnly(v.incidentPaymentDate) ?? dateOnly(v.incidentOpenedAt);
  for (let n = 1; n <= visits; n++) {
    obligations.push(
      draft({
        key: `isdin:${vin}:failed_visit:${n}`,
        origin: "isdin",
        sourceId: vin,
        type: "failed_visit",
        amountCents: FAILED_VISIT_FEE_CENTS,
        eventDate: visitDate,
        workerId: v.installerId,
        workerName: v.installerName,
        concept: `Visita fallida ${n} · VIN ${vin}`
      })
    );
  }

  if (status === "Finalizado") {
    const blocked: BlockReason[] = [];
    const amountCents = centsOrBlock(v.basePaymentEur, blocked, "missing_original_fee");
    obligations.push(
      draft({
        key: `isdin:${vin}:installation`,
        origin: "isdin",
        sourceId: vin,
        type: "installation",
        amountCents,
        eventDate: dateOnly(v.installationPaymentDate) ?? dateOnly(v.incidentResolvedAt) ?? dateOnly(v.statusChangedAt),
        workerId: v.installerId,
        workerName: v.installerName,
        concept: `Instalación · VIN ${vin}`,
        blockedReasons: blocked
      })
    );
  }

  // Señales de conciliación
  const declared = Math.max(0, Math.floor(Number(v.revisitCount ?? 0)));
  if (ISDIN_FAILED_VISIT_STATUSES.includes(status) && declared === 0) {
    issues.push({
      severity: "medio",
      origin: "isdin",
      entityId: vin,
      description: `VIN ${vin} en "${status}" con revisit_count=0: se asume 1 visita real (normalización documentada).`
    });
  }
  if (status === "Resuelto - Pendiente colocador" && (v.basePaymentEur ?? 0) > 0) {
    issues.push({
      severity: "alto",
      origin: "isdin",
      entityId: vin,
      description: `VIN ${vin} pendiente de colocador: el importe original (${v.basePaymentEur} €) NO debe pagarse hasta Finalizado.`
    });
  }

  return { obligations, issues };
}

/** Total previsto (euros) de un vinilo según las reglas: para UI/exports. */
export function isdinExpectedTotalEur(v: IsdinVinylInput): number {
  const { obligations } = computeIsdinObligations(v);
  return obligations.reduce((sum, o) => sum + o.amountCents, 0) / 100;
}

// ---------------------------------------------------------------------------
// Servicios
// ---------------------------------------------------------------------------

const PAYABLE_SERVICE_STATUSES = ["Validado", "Pagado"];

export function servicePointPayCents(
  point: ServiceInput["points"][number],
  issues: EngineIssue[],
  serviceId: string
): { cents: number; blocked: BlockReason[] } {
  const status = point.pointStatus || "Pendiente";
  const failed = status === "Incidencia" || status === "Pospuesto";
  const resolved = point.incidentStatus === "Resuelta" || Boolean(point.incidentResolvedAt);
  const blocked: BlockReason[] = [];
  const incidentCents = point.incidentFeeEur != null ? centsOrBlock(point.incidentFeeEur, blocked) : FAILED_VISIT_FEE_CENTS;
  if (status === "Pendiente recepción post-incidencia") return { cents: 0, blocked };
  if (failed && !resolved) return { cents: incidentCents, blocked };
  if (resolved) {
    if (point.originalFeeEur == null) {
      issues.push({
        severity: "medio",
        origin: "servicio",
        entityId: `${serviceId}:${point.id}`,
        description: `Punto ${point.id} resuelto sin original_fee guardado.`
      });
    }
    return { cents: centsOrBlock(point.originalFeeEur ?? point.feeEur, blocked) + incidentCents, blocked };
  }
  return { cents: centsOrBlock(point.feeEur ?? 0, blocked), blocked };
}

export function computeServiceObligations(service: ServiceInput): EngineResult {
  const issues: EngineIssue[] = [];
  const obligations: ObligationDraft[] = [];
  const blocked: BlockReason[] = [];

  if (!PAYABLE_SERVICE_STATUSES.includes(service.status)) {
    blocked.push("not_payable_status");
  }
  const eventDate = dateOnly(service.validatedAt);
  if (!eventDate && PAYABLE_SERVICE_STATUSES.includes(service.status)) {
    // Regla: sin fecha de validación NO entra en pagos; no se inventa fecha.
    blocked.push("missing_validated_at");
    issues.push({
      severity: "alto",
      origin: "servicio",
      entityId: service.id,
      description: `Servicio ${service.id} validado/pagado sin validated_at: bloqueado hasta informar la fecha.`
    });
  }

  const wantsPoints = service.paymentType === "Puntos" || service.paymentType === "Mixto";
  const wantsHours = service.paymentType === "Horas" || service.paymentType === "Mixto";

  if (wantsPoints) {
    // Un importe inválido en CUALQUIER punto bloquea la obligación completa:
    // jamás se convierte en 0 silencioso dentro de un total pagable.
    const pointBlocked: BlockReason[] = [];
    const amountCents = service.points.reduce((sum, p) => {
      const result = servicePointPayCents(p, issues, service.id);
      pointBlocked.push(...result.blocked);
      return sum + result.cents;
    }, 0);
    if (pointBlocked.length) {
      issues.push({
        severity: "alto",
        origin: "servicio",
        entityId: service.id,
        description: `Servicio ${service.id}: importes inválidos en puntos — obligación bloqueada, no se paga un total incompleto.`
      });
    }
    if (amountCents > 0 || service.points.length > 0) {
      obligations.push(
        draft({
          key: `servicio:${service.id}:points`,
          origin: "servicio",
          sourceId: service.id,
          type: "points",
          amountCents,
          eventDate,
          workerId: service.workerId,
          workerName: service.workerName,
          concept: "Servicio por puntos",
          blockedReasons: [...blocked, ...pointBlocked]
        })
      );
    }
  }
  if (wantsHours) {
    const amountBlocked: BlockReason[] = [...blocked];
    const rate = centsOrBlock(service.hourlyRateEur ?? 0, amountBlocked);
    const hours = Number(service.hoursWorked ?? 0);
    const amountCents = Number.isFinite(hours) && hours >= 0 ? Math.round(rate * hours) : (amountBlocked.push("invalid_amount"), 0);
    obligations.push(
      draft({
        key: `servicio:${service.id}:hours`,
        origin: "servicio",
        sourceId: service.id,
        type: "hours",
        amountCents,
        eventDate,
        workerId: service.workerId,
        workerName: service.workerName,
        concept: "Servicio por horas",
        blockedReasons: amountBlocked
      })
    );
  }

  return { obligations, issues };
}

// ---------------------------------------------------------------------------
// Grandes campañas
// ---------------------------------------------------------------------------

export function computeBigCampaignPointObligations(point: BigCampaignPointInput): EngineResult {
  const issues: EngineIssue[] = [];
  const obligations: ObligationDraft[] = [];
  const status = point.pointStatus || "Pendiente";
  const failedActive = ["Incidencia", "Pospuesto"].includes(status) && point.incidentStatus !== "Resuelta" && !point.incidentResolvedAt;
  const resolved = point.incidentStatus === "Resuelta" || Boolean(point.incidentResolvedAt);
  const hadIncident = failedActive || resolved;
  const eventDate = dateOnly(point.validatedAt) ?? dateOnly(point.finishedAt) ?? dateOnly(point.incidentResolvedAt);

  if (status === "Pendiente recepción post-incidencia") return { obligations, issues };

  // Visita fallida: separada del pago original.
  if (hadIncident) {
    const blocked: BlockReason[] = [];
    const amountCents = point.incidentFeeEur != null ? centsOrBlock(point.incidentFeeEur, blocked) : FAILED_VISIT_FEE_CENTS;
    obligations.push(
      draft({
        key: `gran_campana:${point.id}:failed_visit:1`,
        origin: "gran_campana",
        sourceId: point.id,
        type: "failed_visit",
        amountCents,
        eventDate: eventDate ?? dateOnly(point.finishedAt),
        workerId: point.workerId,
        workerName: point.workerName,
        concept: "Gran campaña · visita fallida",
        blockedReasons: blocked
      })
    );
  }

  // Pago original: solo Finalizado o incidencia resuelta.
  if (status === "Finalizado" || resolved) {
    const blocked: BlockReason[] = [];
    const amountCents = centsOrBlock(resolved ? point.originalFeeEur ?? point.feeEur : point.feeEur, blocked, "missing_original_fee");
    if (!point.workerId && !point.workerName) blocked.push("missing_worker");
    obligations.push(
      draft({
        key: `gran_campana:${point.id}:installation`,
        origin: "gran_campana",
        sourceId: point.id,
        type: "installation",
        amountCents,
        eventDate,
        workerId: point.workerId,
        workerName: point.workerName,
        concept: "Gran campaña · punto finalizado",
        blockedReasons: blocked
      })
    );
  }

  return { obligations, issues };
}

// ---------------------------------------------------------------------------
// Agregación
// ---------------------------------------------------------------------------

export function summarize(obligations: ObligationDraft[]): PaymentsSummary {
  const summary: PaymentsSummary = {
    totalCents: 0,
    payableCents: 0,
    blockedCents: 0,
    byOrigin: {},
    byWorker: {},
    byPeriod: {}
  };
  for (const o of obligations) {
    summary.totalCents += o.amountCents;
    if (o.payable) summary.payableCents += o.amountCents;
    else summary.blockedCents += o.amountCents;
    summary.byOrigin[o.origin] = (summary.byOrigin[o.origin] ?? 0) + o.amountCents;
    const worker = o.workerName ?? "Sin trabajador";
    summary.byWorker[worker] = (summary.byWorker[worker] ?? 0) + o.amountCents;
    if (o.period) summary.byPeriod[o.period] = (summary.byPeriod[o.period] ?? 0) + o.amountCents;
  }
  return summary;
}

/**
 * Puente motor único → líneas de pago del Historial económico (fix C3).
 *
 * Sustituye a buildServicePaymentLines/buildBigCampaignPaymentLines de
 * lib/payment-ledger (congelados como @deprecated). Diferencias clave:
 *  - fingerprint = clave estable de la obligación (SIN fecha ni importe):
 *    una corrección ACTUALIZA el mismo evento económico en vez de crear uno
 *    paralelo divergente;
 *  - importes calculados en céntimos por el motor (redondeo documentado);
 *  - fecha ausente => la línea NO entra en pagos (issue explícita), jamás se
 *    sustituye por la fecha actual;
 *  - importes inválidos bloquean (issue), jamás 0 silencioso.
 */

import {
  computeBigCampaignPointObligations,
  computeServiceObligations
} from "@/lib/payments/engine";
import { PaymentIssue, PaymentLine } from "@/lib/payment-ledger";
import { BigCampaignPointInput, ObligationDraft, ServiceInput } from "@/lib/payments/types";

type Row = Record<string, unknown>;
const str = (v: unknown) => (v == null ? "" : String(v));
const strOrNull = (v: unknown) => (v == null || v === "" ? null : String(v));
const numOrNull = (v: unknown) => (v == null || v === "" ? null : Number(v));

function serviceToInput(service: Row, points: Row[]): ServiceInput {
  return {
    id: str(service.id),
    status: str(service.status),
    paymentType: (str(service.payment_type) || "Puntos") as ServiceInput["paymentType"],
    validatedAt: strOrNull(service.validated_at),
    hourlyRateEur: numOrNull(service.hourly_rate),
    hoursWorked: numOrNull(service.hours_worked),
    workerId: strOrNull(service.worker_id),
    workerName: strOrNull(service.worker_name),
    points: points.map((p) => ({
      id: str(p.id),
      feeEur: numOrNull(p.fee),
      originalFeeEur: numOrNull(p.original_fee),
      incidentFeeEur: numOrNull(p.incident_fee),
      pointStatus: str(p.point_status || p.status || "Pendiente"),
      incidentStatus: strOrNull(p.incident_status),
      incidentResolvedAt: strOrNull(p.incident_resolved_at)
    }))
  };
}

function bigPointToInput(point: Row): BigCampaignPointInput {
  return {
    id: str(point.id),
    campaignId: str(point.big_campaign_id),
    pointStatus: str(point.point_status || point.status || "Pendiente"),
    feeEur: numOrNull(point.fee),
    originalFeeEur: numOrNull(point.original_fee),
    incidentFeeEur: numOrNull(point.incident_fee),
    incidentStatus: strOrNull(point.incident_status),
    incidentResolvedAt: strOrNull(point.incident_resolved_at),
    validatedAt: strOrNull(point.validated_at),
    finishedAt: strOrNull(point.finished_at),
    workerId: strOrNull(point.worker_id),
    workerName: strOrNull(point.worker_name)
  };
}

function toPaymentLine(o: ObligationDraft, meta: Partial<PaymentLine>): PaymentLine {
  return {
    id: o.key,
    origin: o.origin as PaymentLine["origin"],
    source_id: o.sourceId,
    source_line_id: null,
    payment_date: o.eventDate ?? "",
    period: o.period ?? "",
    worker_id: o.workerId,
    worker_name: o.workerName ?? "Sin trabajador",
    client_id: meta.client_id ?? null,
    client: meta.client ?? "",
    ceco: meta.ceco ?? null,
    campaign: meta.campaign ?? null,
    province: meta.province ?? null,
    concept: o.concept,
    amount: o.amountCents / 100,
    status: meta.status ?? null,
    // Identidad ESTABLE: la clave de la obligación, sin fecha ni importe.
    fingerprint: o.key,
    payload: { blockedReasons: o.blockedReasons }
  };
}

export interface EngineLinesResult {
  lines: PaymentLine[];
  issues: PaymentIssue[];
}

/** Líneas de pago de servicios y grandes campañas calculadas por el motor. */
export function buildEnginePaymentLines(
  services: Row[],
  points: Row[],
  bigCampaigns: Row[],
  bigPoints: Row[]
): EngineLinesResult {
  const lines: PaymentLine[] = [];
  const issues: PaymentIssue[] = [];

  for (const service of services) {
    const servicePoints = points.filter((p) => str(p.service_id) === str(service.id));
    const { obligations, issues: engineIssues } = computeServiceObligations(serviceToInput(service, servicePoints));
    for (const issue of engineIssues) {
      issues.push({ severity: issue.severity, origin: "servicio", entity: issue.entityId, description: issue.description, action: "Revisar antes de liquidar." });
    }
    for (const o of obligations) {
      if (!o.payable) {
        if (!o.blockedReasons.includes("not_payable_status")) {
          issues.push({
            severity: "alto",
            origin: "servicio",
            entity: o.sourceId,
            description: `${o.concept} (${str(service.client)}) bloqueada: ${o.blockedReasons.join(", ")} — no entra en pagos.`,
            action: "Corregir datos (fecha de validación/importes) para incluirla."
          });
        }
        continue;
      }
      if (o.amountCents === 0) continue;
      lines.push(toPaymentLine(o, {
        client_id: strOrNull(service.client_id),
        client: str(service.client) || "Servicio",
        ceco: strOrNull(service.ceco),
        campaign: strOrNull(service.campaign),
        province: strOrNull(service.province),
        status: strOrNull(service.status)
      }));
    }
  }

  const byCampaign = new Map(bigCampaigns.map((c) => [str(c.id), c]));
  for (const point of bigPoints) {
    const campaign = byCampaign.get(str(point.big_campaign_id)) ?? {};
    const { obligations, issues: engineIssues } = computeBigCampaignPointObligations(bigPointToInput(point));
    for (const issue of engineIssues) {
      issues.push({ severity: issue.severity, origin: "gran_campana", entity: issue.entityId, description: issue.description, action: "Revisar antes de liquidar." });
    }
    for (const o of obligations) {
      if (!o.payable) {
        issues.push({
          severity: "alto",
          origin: "gran_campana",
          entity: o.sourceId,
          description: `${o.concept} (punto ${str((point as Row).name) || o.sourceId}) bloqueada: ${o.blockedReasons.join(", ")} — no entra en pagos.`,
          action: "Informar fecha real/instalador/importe para incluirla."
        });
        continue;
      }
      if (o.amountCents === 0) continue;
      lines.push(toPaymentLine(o, {
        client_id: strOrNull((campaign as Row).client_id),
        client: str((campaign as Row).client) || "Gran campaña",
        ceco: strOrNull((campaign as Row).ceco),
        campaign: strOrNull((campaign as Row).name),
        province: strOrNull(point.province) ?? strOrNull((campaign as Row).province),
        status: strOrNull(point.point_status)
      }));
    }
  }

  return { lines, issues };
}

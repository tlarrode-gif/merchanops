export const INCIDENT_FEE = 8.56;

export type PaymentOrigin = "servicio" | "gran_campana" | "isdin";
export type PaymentSeverity = "critico" | "alto" | "medio" | "bajo";

export type PaymentLine = {
  id: string;
  origin: PaymentOrigin;
  source_id: string;
  source_line_id?: string | null;
  payment_date: string;
  period: string;
  worker_id?: string | null;
  worker_name?: string | null;
  client_id?: string | null;
  client: string;
  ceco?: string | null;
  campaign?: string | null;
  province?: string | null;
  concept: string;
  amount: number;
  status?: string | null;
  fingerprint: string;
  payload?: Record<string, unknown>;
};

export type PaymentIssue = {
  severity: PaymentSeverity;
  origin: PaymentOrigin | "sistema";
  entity: string;
  description: string;
  action: string;
};

type AnyRow = Record<string, any>;

export function dateOnly(value?: string | null) {
  return value ? String(value).slice(0, 10) : "";
}

export function paymentPeriod(date?: string | null) {
  const value = dateOnly(date) || new Date().toISOString().slice(0, 10);
  return value.slice(0, 7);
}

function number(value: unknown) {
  return Number(value || 0);
}

function pointStatus(point: AnyRow) {
  return point.point_status || point.status || "Pendiente";
}

function isFailedVisitStatus(status: string) {
  return status === "Incidencia" || status === "Pospuesto";
}

function isPostIncidentPending(point: AnyRow) {
  return pointStatus(point) === "Pendiente recepción post-incidencia";
}

function isIncidentActive(point: AnyRow) {
  const status = pointStatus(point);
  return isFailedVisitStatus(status) && point.incident_status !== "Resuelta" && !point.incident_resolved_at;
}

function isIncidentResolved(point: AnyRow) {
  return point.incident_status === "Resuelta" || Boolean(point.incident_resolved_at);
}

function pointOriginal(point: AnyRow) {
  return number(point.original_fee ?? point.fee);
}

function pointIncident(point: AnyRow) {
  return number(point.incident_fee || INCIDENT_FEE);
}

function pointPay(point: AnyRow) {
  if (isPostIncidentPending(point)) return 0;
  if (isIncidentActive(point)) return pointIncident(point);
  if (isIncidentResolved(point)) return pointOriginal(point) + pointIncident(point);
  return number(point.fee);
}

function servicePaymentDate(service: AnyRow) {
  return dateOnly(service.validated_at) || dateOnly(service.resolved_at) || dateOnly(service.deadline) || dateOnly(service.start_date) || new Date().toISOString().slice(0, 10);
}

export function servicePointTotal(service: AnyRow, points: AnyRow[]) {
  return points.reduce((sum, point) => sum + pointPay(point), 0);
}

export function serviceHourTotal(service: AnyRow) {
  return number(service.hourly_rate) * number(service.hours_worked);
}

export function serviceTotal(service: AnyRow, points: AnyRow[]) {
  if (service.payment_type === "Horas") return serviceHourTotal(service);
  if (service.payment_type === "Mixto") return servicePointTotal(service, points) + serviceHourTotal(service);
  return servicePointTotal(service, points);
}

export function fingerprint(parts: Array<string | number | null | undefined>) {
  return parts.map(part => String(part ?? "")).join("|").toLowerCase();
}

export function buildServicePaymentLines(services: AnyRow[], points: AnyRow[]) {
  return services.flatMap(service => {
    if (service.status !== "Validado" && service.status !== "Pagado") return [];
    const servicePoints = points.filter(point => point.service_id === service.id);
    const date = servicePaymentDate(service);
    const amount = serviceTotal(service, servicePoints);
    if (!amount) return [];
    const line: PaymentLine = {
      id: `servicio:${service.id}`,
      origin: "servicio",
      source_id: String(service.id),
      payment_date: date,
      period: paymentPeriod(date),
      worker_id: service.worker_id || null,
      worker_name: service.worker_name || "Sin trabajador",
      client_id: service.client_id || null,
      client: service.client || "Servicio",
      ceco: service.ceco || null,
      campaign: service.campaign || null,
      province: service.province || null,
      concept: service.payment_type === "Horas" ? "Servicio por horas" : service.payment_type === "Mixto" ? "Servicio mixto" : "Servicio por puntos",
      amount,
      status: service.status || null,
      fingerprint: fingerprint(["servicio", service.id, date, amount]),
      payload: { payment_type: service.payment_type || "Puntos", points: servicePoints.length }
    };
    return [line];
  });
}

export function buildBigCampaignPaymentLines(campaigns: AnyRow[], points: AnyRow[]) {
  const byCampaign = new Map(campaigns.map(campaign => [campaign.id, campaign]));
  return points.flatMap(point => {
    const campaign = byCampaign.get(point.big_campaign_id) || {};
    const status = pointStatus(point);
    const incidentResolved = isIncidentResolved(point);
    if (!["Finalizado", "Incidencia", "Pospuesto"].includes(status) && !incidentResolved) return [];
    if (isPostIncidentPending(point)) return [];
    const active = isIncidentActive(point);
    const amount = active ? pointIncident(point) : incidentResolved ? pointOriginal(point) + pointIncident(point) : number(point.fee);
    if (!amount) return [];
    const date = dateOnly(point.validated_at || point.finished_at || point.incident_resolved_at || point.reported_at || campaign.deadline || campaign.start_date) || new Date().toISOString().slice(0, 10);
    const concept = active ? `Gran campaña - ${status.toLowerCase()}` : "Gran campaña - punto finalizado";
    const line: PaymentLine = {
      id: `gran_campana:${point.id}`,
      origin: "gran_campana",
      source_id: String(point.big_campaign_id || campaign.id || ""),
      source_line_id: String(point.id),
      payment_date: date,
      period: paymentPeriod(date),
      worker_id: point.worker_id || null,
      worker_name: point.worker_name || "Sin instalador",
      client_id: campaign.client_id || null,
      client: campaign.client || "Gran campaña",
      ceco: campaign.ceco || null,
      campaign: campaign.name || null,
      province: point.province || campaign.province || null,
      concept,
      amount,
      status,
      fingerprint: fingerprint(["gran_campana", point.id, status, date, amount]),
      payload: { point_name: point.name || "", report_code: point.report_code || "" }
    };
    return [line];
  });
}

export function auditServices(services: AnyRow[], points: AnyRow[]) {
  const issues: PaymentIssue[] = [];
  for (const service of services) {
    const servicePoints = points.filter(point => point.service_id === service.id);
    if ((service.status === "Validado" || service.status === "Pagado") && !service.validated_at) {
      issues.push({ severity: "alto", origin: "servicio", entity: String(service.id), description: `${service.client || "Servicio"} · ${service.campaign || ""} está validado/pagado sin fecha de validación.`, action: "Añadir validated_at para que entre en el periodo correcto." });
    }
    if ((service.status === "Validado" || service.status === "Pagado") && service.payment_type !== "Horas" && !servicePoints.length) {
      issues.push({ severity: "alto", origin: "servicio", entity: String(service.id), description: `${service.client || "Servicio"} · ${service.campaign || ""} no tiene puntos asociados.`, action: "Revisar la carga de puntos antes de pagar." });
    }
    for (const point of servicePoints) {
      const status = pointStatus(point);
      if (isFailedVisitStatus(status) && !point.original_fee) {
        issues.push({ severity: "medio", origin: "servicio", entity: String(point.id), description: `Punto ${point.name || point.id} en ${status} sin importe original guardado.`, action: "Guardar original_fee para evitar cálculos incorrectos al resolver." });
      }
      if (status === "Finalizado" && point.incident_status === "Abierta") {
        issues.push({ severity: "alto", origin: "servicio", entity: String(point.id), description: `Punto ${point.name || point.id} finalizado con incidencia abierta.`, action: "Resolver la incidencia o revisar el pago calculado." });
      }
    }
  }
  return issues;
}

export function auditBigCampaigns(campaigns: AnyRow[], points: AnyRow[]) {
  const issues: PaymentIssue[] = [];
  const byCampaign = new Map(campaigns.map(campaign => [campaign.id, campaign]));
  for (const point of points) {
    const campaign = byCampaign.get(point.big_campaign_id);
    const status = pointStatus(point);
    if (!campaign) {
      issues.push({ severity: "critico", origin: "gran_campana", entity: String(point.id), description: `Punto de gran campaña ${point.name || point.id} sin campaña asociada.`, action: "Revisar big_campaign_id antes de liquidar." });
    }
    if (status === "Finalizado" && !point.finished_at && !point.validated_at) {
      issues.push({ severity: "medio", origin: "gran_campana", entity: String(point.id), description: `Punto ${point.name || point.id} finalizado sin fecha de finalización.`, action: "Guardar finished_at/validated_at para cerrar el periodo correcto." });
    }
    if (["Finalizado", "Incidencia", "Pospuesto"].includes(status) && !point.worker_id && !point.worker_name) {
      issues.push({ severity: "alto", origin: "gran_campana", entity: String(point.id), description: `Punto ${point.name || point.id} pagable sin instalador asignado.`, action: "Asignar instalador antes de exportar pagos." });
    }
  }
  return issues;
}

export function auditIsdinPreventiveCalls(vinyls: AnyRow[]) {
  const issues: PaymentIssue[] = [];
  const preventiveStatuses = ["Incidencia en llamada", "Pospuesto en llamada", "Cancelado en llamada", "No contesta", "Requiere revisión operaciones"];
  for (const vinyl of vinyls) {
    const callStatus = vinyl.call_status || "";
    if (preventiveStatuses.includes(callStatus) && number(vinyl.payment_total) > 0 && vinyl.status === "Incidencia llamada") {
      issues.push({ severity: "critico", origin: "isdin", entity: String(vinyl.vinyl || vinyl.id), description: `VIN ${vinyl.vinyl || ""} tiene estado preventivo de llamada y pago previsto activo.`, action: "Confirmar que no se ha convertido una llamada preventiva en visita fallida." });
    }
    if ((vinyl.call_alert || vinyl.requires_operations_review) && !callStatus) {
      issues.push({ severity: "medio", origin: "isdin", entity: String(vinyl.vinyl || vinyl.id), description: `VIN ${vinyl.vinyl || ""} tiene alerta Backoffice sin estado de llamada espejo.`, action: "Reabrir/guardar la llamada para regenerar el espejo en Vinilos." });
    }
  }
  return issues;
}

export function summarizePayments(lines: PaymentLine[]) {
  return {
    total: lines.reduce((sum, line) => sum + number(line.amount), 0),
    count: lines.length,
    byOrigin: lines.reduce<Record<string, number>>((acc, line) => {
      acc[line.origin] = (acc[line.origin] || 0) + number(line.amount);
      return acc;
    }, {}),
    byWorker: lines.reduce<Record<string, number>>((acc, line) => {
      const key = line.worker_name || "Sin trabajador";
      acc[key] = (acc[key] || 0) + number(line.amount);
      return acc;
    }, {})
  };
}

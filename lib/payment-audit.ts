export const INCIDENT_FEE = 8.56;

export type AuditPoint = {
  id: string;
  fee?: number | null;
  original_fee?: number | null;
  incident_fee?: number | null;
  point_status?: string | null;
  status?: string | null;
  incident_status?: string | null;
  incident_resolved_at?: string | null;
};

export type AuditService = {
  id: string;
  status?: string | null;
  validated_at?: string | null;
  resolved_at?: string | null;
  deadline?: string | null;
  start_date?: string | null;
  payment_type?: string | null;
  hourly_rate?: number | null;
  hours_worked?: number | null;
  points?: AuditPoint[];
};

export function dateOnly(value?: string | null) {
  return value ? String(value).slice(0, 10) : "";
}

export function isValidated(service: AuditService) {
  return service.status === "Validado" || service.status === "Pagado";
}

export function effectivePaymentDate(service: AuditService) {
  return dateOnly(service.validated_at) || dateOnly(service.resolved_at) || dateOnly(service.deadline) || dateOnly(service.start_date) || new Date().toISOString().slice(0, 10);
}

export function pointStatus(point: AuditPoint) {
  return point.point_status || point.status || "Pendiente";
}

export function isFailedVisitStatus(status: string) {
  return ["Incidencia", "Pospuesto", "Pendiente recepción post-incidencia"].includes(status);
}

export function isIncidentActive(point: AuditPoint) {
  return isFailedVisitStatus(pointStatus(point)) && point.incident_status !== "Resuelta" && !point.incident_resolved_at;
}

export function isIncidentResolved(point: AuditPoint) {
  return point.incident_status === "Resuelta" || !!point.incident_resolved_at;
}

export function pointOriginal(point: AuditPoint) {
  return Number(point.original_fee ?? point.fee ?? 0);
}

export function pointIncident(point: AuditPoint) {
  return Number(point.incident_fee || INCIDENT_FEE);
}

export function pointPay(point: AuditPoint) {
  if (isIncidentActive(point)) return pointIncident(point);
  if (isIncidentResolved(point)) return pointOriginal(point) + pointIncident(point);
  return Number(point.fee || 0);
}

export function pointTotal(service: AuditService) {
  return (service.points || []).reduce((sum, point) => sum + pointPay(point), 0);
}

export function hourTotal(service: AuditService) {
  return Number(service.hourly_rate || 0) * Number(service.hours_worked || 0);
}

export function serviceTotal(service: AuditService) {
  if (service.payment_type === "Horas") return hourTotal(service);
  if (service.payment_type === "Mixto") return pointTotal(service) + hourTotal(service);
  return pointTotal(service);
}

export function shouldAppearInPayments(service: AuditService, from?: string, to?: string) {
  if (!isValidated(service)) return false;
  const d = effectivePaymentDate(service);
  if (from && d < from) return false;
  if (to && d > to) return false;
  return true;
}

export function auditService(service: AuditService) {
  const issues: string[] = [];
  if (isValidated(service) && !service.validated_at) issues.push("Servicio validado/pagado sin validated_at: puede quedar fuera de pagos filtrados por fecha.");
  for (const point of service.points || []) {
    const st = pointStatus(point);
    if (isFailedVisitStatus(st) && !point.original_fee) issues.push(`Punto ${point.id} en ${st} sin original_fee: puede calcular mal la resolución.`);
    if (st === "Finalizado" && point.incident_status === "Abierta") issues.push(`Punto ${point.id} finalizado con incidencia abierta: puede quedarse pagando solo visita fallida.`);
  }
  return issues;
}

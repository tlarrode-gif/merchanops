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
  CampanaPuntoInput,
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
// Grandes campañas (módulo actual: grandes_campanas / puntos_venta_campana)
// ---------------------------------------------------------------------------

/**
 * v10.3 · Obligaciones de un punto del módulo ACTUAL de Grandes Campañas.
 *
 * `computeBigCampaignPointObligations` (arriba) trabaja sobre las tablas legadas
 * big_campaigns/big_campaign_points, que están vacías, y con sus estados en texto
 * («Finalizado», «Pospuesto»...). Este es su equivalente para el modelo vivo, y no
 * es un simple renombrado: aquí una incidencia resuelta devuelve el punto a
 * `pendiente`, así que resolver la incidencia NO puede generar por sí sola el pago
 * de la instalación —solo lo genera el estado `completado`—.
 *
 * Reglas:
 *  - `completado`  → obligación de instalación por el importe del punto, o por
 *                    `horas × tarifa` si la campaña se paga POR HORAS (v11.5).
 *  - incidencia    → una obligación de visita fallida por cada incidencia registrada,
 *                    con la tarifa única de FAILED_VISIT_FEE_CENTS (8,56 €).
 *  - kilometraje   → obligación PROPIA (v11.5) cuando la campaña lo paga y el punto
 *                    trae kilómetros reportados. Va aparte del pago del trabajo
 *                    porque se revisa, se bloquea y se liquida por separado.
 *  - `cancelado` y `pendiente` sin incidencias → nada.
 *
 * Nada se descarta en silencio: si falta el importe, la tarifa, las horas, la fecha
 * de instalación o el trabajador, la obligación se crea igualmente pero BLOQUEADA
 * (`payable = false`) con su motivo, para que aparezca en Pagos y en Avisos en lugar
 * de desaparecer.
 */
export function computeCampanaPuntoObligations(punto: CampanaPuntoInput): EngineResult {
  const issues: EngineIssue[] = [];
  const obligations: ObligationDraft[] = [];
  const estado = String(punto.estado || "pendiente").toLowerCase();

  // Un punto cancelado no genera pago ni por la instalación ni por el desplazamiento.
  if (estado === "cancelado") return { obligations, issues };

  // Visita fallida: el trabajador se desplazó y no pudo instalar. Una por incidencia
  // registrada, con clave estable por incidencia para que dos viajes sean dos pagos.
  for (const incidencia of punto.incidencias ?? []) {
    if (!incidencia.id) continue;
    obligations.push(
      draft({
        key: `gran_campana:${punto.id}:failed_visit:${incidencia.id}`,
        origin: "gran_campana",
        sourceId: punto.id,
        type: "failed_visit",
        amountCents: FAILED_VISIT_FEE_CENTS,
        eventDate: dateOnly(incidencia.fecha),
        workerId: punto.workerId,
        workerName: punto.workerName,
        concept: "Gran campaña · visita fallida",
        blockedReasons: punto.workerId || punto.workerName ? [] : (["missing_worker"] as BlockReason[])
      })
    );
  }

  const eventDate = dateOnly(punto.fechaInstalacion);
  const sinTrabajador: BlockReason[] = punto.workerId || punto.workerName ? [] : ["missing_worker"];

  if (estado === "completado") {
    const blocked: BlockReason[] = [...sinTrabajador];
    // Dos formas de pagar el mismo trabajo, nunca las dos a la vez: la campaña por
    // horas paga el turno y la campaña por punto paga el importe del punto. La
    // CLAVE es distinta (`hours` vs `installation`) para que cambiar el modo de una
    // campaña ya volcada no reescriba en silencio una línea con otro concepto: la
    // vieja vuelve como divergencia y alguien decide qué hacer con ella.
    const amountCents = punto.pagoPorHoras
      ? importeHorasCents(punto, blocked)
      : centsOrBlock(punto.importeEur, blocked);
    obligations.push(
      draft({
        key: `gran_campana:${punto.id}:${punto.pagoPorHoras ? "hours" : "installation"}`,
        origin: "gran_campana",
        sourceId: punto.id,
        type: punto.pagoPorHoras ? "hours" : "installation",
        amountCents,
        // Sin fecha de instalación `draft` bloquea con missing_event_date: nunca se
        // sustituye por la fecha de hoy, que falsearía el mes contable.
        eventDate,
        workerId: punto.workerId,
        workerName: punto.workerName,
        concept: punto.pagoPorHoras
          ? `Gran campaña · ${formatearHoras(punto.horas)} h de trabajo`
          : "Gran campaña · punto completado",
        blockedReasons: blocked
      })
    );
  }

  // Kilometraje: se paga lo REPORTADO, esté el punto completado o con incidencia
  // (el desplazamiento se hizo igual). Solo se emite si hay kilómetros: sin ellos
  // no hay nada que reclamar y una línea a 0 € solo ensucia Pagos.
  const kilometros = Number(punto.kilometros ?? 0);
  if (punto.pagoKilometraje && kilometros > 0) {
    const blocked: BlockReason[] = [...sinTrabajador];
    obligations.push(
      draft({
        key: `gran_campana:${punto.id}:mileage`,
        origin: "gran_campana",
        sourceId: punto.id,
        type: "mileage",
        amountCents: totalPorTarifa(punto.tarifaKmEur, kilometros, blocked, "missing_km_rate"),
        eventDate,
        workerId: punto.workerId,
        workerName: punto.workerName,
        concept: `Gran campaña · kilometraje (${kilometros.toLocaleString("es-ES")} km)`,
        blockedReasons: blocked
      })
    );
  }

  return { obligations, issues };
}

/**
 * Total en céntimos de `tarifa × cantidad`, redondeado UNA sola vez al final.
 *
 * No se convierte la tarifa a céntimos antes de multiplicar: `tarifa_km` tiene
 * cuatro decimales precisamente porque 0,265 €/km es una tarifa real, y pasarla
 * primero por `eurosToCents` la subiría a 0,27 € y cobraría de más en cada
 * kilómetro (33 km serían 8,91 € en vez de 8,75 €).
 */
function totalPorTarifa(tarifaEur: number | null | undefined, cantidad: number, blocked: BlockReason[], motivoSinTarifa: BlockReason): number {
  if (tarifaEur == null) {
    blocked.push(motivoSinTarifa);
    return 0;
  }
  if (!Number.isFinite(tarifaEur) || tarifaEur < 0 || !Number.isFinite(cantidad) || cantidad < 0) {
    blocked.push("invalid_amount");
    return 0;
  }
  return eurosToCents(tarifaEur * cantidad);
}

/** Importe en céntimos de un turno: horas × tarifa, con los motivos de bloqueo. */
function importeHorasCents(punto: CampanaPuntoInput, blocked: BlockReason[]): number {
  // Un reporte incoherente (salida antes que entrada, hora ilegible) NO se
  // aproxima ni se ignora: bloquea con su propio motivo para que se corrija.
  if (punto.horasError && punto.horasError !== "sin_datos") {
    blocked.push("invalid_hours");
    // La falta de tarifa se sigue señalando: son dos cosas que corregir, no una.
    if (punto.tarifaHoraEur == null) blocked.push("missing_hourly_rate");
    return 0;
  }
  const horas = Number(punto.horas ?? NaN);
  if (!Number.isFinite(horas) || horas < 0) {
    blocked.push("missing_hours");
    if (punto.tarifaHoraEur == null) blocked.push("missing_hourly_rate");
    return 0;
  }
  return totalPorTarifa(punto.tarifaHoraEur, horas, blocked, "missing_hourly_rate");
}

function formatearHoras(horas: number | null | undefined) {
  const numero = Number(horas ?? 0);
  return Number.isFinite(numero) ? numero.toLocaleString("es-ES", { maximumFractionDigits: 2 }) : "0";
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

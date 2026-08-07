/**
 * Volcado de obligaciones de pago de los puntos de una GRAN CAMPAÑA (v10.3).
 *
 * POR QUÉ EXISTE ESTE MÓDULO
 * Grandes Campañas no llegaba a la pantalla de Pagos. Lo único que había era un
 * evento del Historial económico (`pagoEventsFromCampanaPuntos`) que:
 *   - solo se generaba al ABRIR la pantalla de Historial económico, nunca al
 *     completar el punto, y
 *   - exigía `importe > 0`, así que un punto completado sin importe desaparecía
 *     sin dejar rastro ni aviso.
 * Y el camino del motor hacia `payment_obligations` estaba enchufado a las tablas
 * legadas big_campaigns/big_campaign_points, vacías desde la migración a
 * grandes_campanas/puntos_venta_campana. Resultado: 0 obligaciones de origen
 * `gran_campana` y ningún gestor podía pagar nada.
 *
 * QUIÉN PUEDE EJECUTARLO
 * Cualquiera que pueda editar el punto, sin exigir rol de administrador: el gestor
 * es responsable de los pagos de su zona, igual que en ISDIN. `sync_payment_obligations`
 * es SECURITY INVOKER y la policy `pagos_scope` de `payment_obligations` decide el
 * ámbito real; esta capa es comodidad, no la defensa.
 *
 * IDEMPOTENTE: el RPC solo crea lo que falta y nunca toca líneas revisadas, cerradas
 * o anuladas. Las diferencias sobre líneas ya revisadas vuelven como divergencias
 * para resolución manual, jamás automática.
 */

import { horasDelPunto } from "@/lib/campana-horas";
import { computeCampanaPuntoObligations } from "@/lib/payments/engine";
import { SyncResult, syncObligations } from "@/lib/payments/ledger";
import { CampanaPuntoInput, ObligationDraft } from "@/lib/payments/types";

type Row = Record<string, unknown>;

/**
 * Configuración de pago de la campaña (v11.5). Se pasa desde la pantalla porque
 * es de la CAMPAÑA, no del punto: la tarifa vive en `grandes_campanas` y todos
 * los puntos de la misma campaña comparten modo y precios.
 *
 * Sin configuración se comporta como antes de v11.5: pago por el importe del
 * punto y sin kilometraje. Eso mantiene intactas las campañas ya volcadas.
 */
export type CampanaPagoConfig = {
  pago_por_horas?: boolean | null;
  tarifa_hora?: number | null;
  pago_kilometraje?: boolean | null;
  tarifa_km?: number | null;
};

const text = (value: unknown): string | null => {
  const clean = String(value ?? "").trim();
  return clean ? clean : null;
};

const numberOrNull = (value: unknown): number | null => {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

/** Incidencia de un punto tal como la devuelve `incidencias_campana`. */
export type IncidenciaRow = { id?: unknown; punto_id?: unknown; estado?: unknown; created_at?: unknown; resolved_at?: unknown };

/**
 * Traduce un punto de `puntos_venta_campana` (más sus incidencias) a la entrada
 * del motor único de pagos.
 */
export function puntoRowToEngineInput(punto: Row, incidencias: IncidenciaRow[] = [], campana: CampanaPagoConfig = {}): CampanaPuntoInput {
  const puntoId = String(punto.id ?? "");
  // Las horas que se pagan se resuelven AQUÍ, en el adaptador, y no en el motor:
  // el motor trabaja con números limpios y no tiene que saber que un Excel puede
  // traer la hora como fracción de día.
  const horas = horasDelPunto({
    hora_entrada: text(punto.hora_entrada),
    hora_salida: text(punto.hora_salida),
    horas_trabajadas: numberOrNull(punto.horas_trabajadas)
  });
  return {
    id: puntoId,
    campaignId: String(punto.campana_id ?? ""),
    estado: String(punto.estado ?? "pendiente"),
    importeEur: numberOrNull(punto.importe),
    fechaInstalacion: text(punto.fecha_visita),
    pagoPorHoras: Boolean(campana.pago_por_horas),
    tarifaHoraEur: numberOrNull(campana.tarifa_hora),
    pagoKilometraje: Boolean(campana.pago_kilometraje),
    tarifaKmEur: numberOrNull(campana.tarifa_km),
    horas: horas.horas,
    horasError: horas.error ?? null,
    kilometros: numberOrNull(punto.kilometros),
    // El beneficiario es el INSTALADOR. El gestor coordina, no cobra el punto: si no
    // hay instalador la obligación se crea bloqueada con `missing_worker` en lugar de
    // pagarle al gestor por error.
    workerId: text(punto.instalador_id),
    workerName: text(punto.instalador_nombre),
    incidencias: incidencias
      .filter(incidencia => String(incidencia.punto_id ?? "") === puntoId && incidencia.id)
      .map(incidencia => ({
        id: String(incidencia.id),
        estado: String(incidencia.estado ?? "abierta"),
        fecha: text(incidencia.resolved_at) || text(incidencia.created_at)
      }))
  };
}

export type CampanaObligationsResult = { sync: SyncResult | null; drafts: ObligationDraft[] };

/**
 * Recalcula y vuelca las obligaciones de los puntos indicados.
 *
 * Se envía el conjunto COMPLETO de obligaciones esperadas de esos puntos (no solo las
 * que faltan) para que el ámbito del RPC cuadre y no marque como `missing_in_recalc`
 * una obligación que sigue siendo válida.
 *
 * Devuelve `sync: null` cuando no hay nada que volcar (ningún punto completado ni con
 * incidencias). Lanza si el volcado falla: quien llama decide si eso bloquea.
 */
export async function syncCampanaObligations(
  puntos: Row[],
  incidencias: IncidenciaRow[],
  actor: string,
  correlationId?: string,
  campana: CampanaPagoConfig = {}
): Promise<CampanaObligationsResult> {
  const inputs = puntos.map(punto => puntoRowToEngineInput(punto, incidencias, campana)).filter(input => input.id);
  if (!inputs.length) return { sync: null, drafts: [] };

  const drafts = inputs.flatMap(input => computeCampanaPuntoObligations(input).obligations);
  if (!drafts.length) return { sync: null, drafts: [] };

  const sync = await syncObligations(drafts, actor, correlationId ?? `gran_campana:${inputs[0].campaignId}`, {
    origin: "gran_campana",
    sourceIds: inputs.map(input => input.id)
  });
  return { sync, drafts };
}

/** Resumen legible del volcado para el aviso de la pantalla. */
export function resumenVolcado(result: CampanaObligationsResult): string {
  if (!result.sync) return "No hay puntos completados ni incidencias que generen pago todavía.";
  const bloqueadas = result.drafts.filter(draft => !draft.payable);
  const partes = [
    result.sync.inserted ? `${result.sync.inserted} nuevas` : "",
    result.sync.updated ? `${result.sync.updated} actualizadas` : "",
    result.sync.unchanged ? `${result.sync.unchanged} sin cambios` : ""
  ].filter(Boolean);
  const base = partes.length ? `Pagos volcados: ${partes.join(", ")}.` : "Todo al día: no faltaba ninguna obligación de pago.";
  const aviso = bloqueadas.length
    ? ` ${bloqueadas.length} línea(s) quedan BLOQUEADAS y nadie las cobrará hasta corregirlas: ${motivosLegibles(bloqueadas)}.`
    : "";
  const divergencias = result.sync.divergences?.length
    ? ` ${result.sync.divergences.length} divergencia(s) sobre líneas ya revisadas o cerradas: revísalas en Pagos.`
    : "";
  return base + aviso + divergencias;
}

const MOTIVO_LABEL: Record<string, string> = {
  missing_event_date: "falta la fecha de instalación",
  missing_worker: "falta el trabajador",
  invalid_amount: "falta el importe o no es válido",
  missing_original_fee: "falta el importe",
  missing_validated_at: "falta la validación",
  not_payable_status: "el estado no permite pago",
  preventive_call: "bloqueo preventivo",
  missing_hours: "faltan las horas trabajadas",
  invalid_hours: "las horas reportadas no cuadran (revisa entrada y salida)",
  missing_hourly_rate: "falta la tarifa por hora de la campaña",
  missing_km_rate: "falta la tarifa por kilómetro de la campaña"
};

function motivosLegibles(drafts: ObligationDraft[]): string {
  const cuenta = new Map<string, number>();
  for (const draft of drafts) {
    for (const motivo of draft.blockedReasons) {
      cuenta.set(motivo, (cuenta.get(motivo) || 0) + 1);
    }
  }
  return Array.from(cuenta.entries())
    .sort((a, b) => b[1] - a[1])
    .map(([motivo, total]) => `${MOTIVO_LABEL[motivo] || motivo} (${total})`)
    .join(", ");
}

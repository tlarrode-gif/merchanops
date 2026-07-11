/**
 * Cliente del patrón inbox/outbox (fase 5).
 *
 * Consumo efectivamente-una-vez: `processOutbox` reclama eventos con
 * `outbox_claim` (SKIP LOCKED: dos consumidores no reclaman el mismo evento),
 * valida tipo/versión/payload, ejecuta el handler y solo entonces llama a
 * `outbox_complete` (que escribe el inbox y marca completado en la misma
 * transacción). Un evento repetido vuelve como `alreadyProcessed` y el
 * handler NO debe re-crear incidencias/solicitudes/reservas existentes.
 * Los fallos van a `outbox_fail`: backoff exponencial y dead-letter al
 * agotar los intentos. Jamás se marca completado antes de aplicar efectos.
 *
 * Consumidores activos (v8_6): la publicación se hace por TRIGGER en la base
 * (logistics_requests/shipments/incidents/stock, misma transacción que el
 * dato) y el consumidor 'db-notifier' corre en pg_cron cada minuto generando
 * logistics_notifications idempotentes (efectos + inbox + completado en una
 * sola transacción). Este cliente TS queda para futuros consumidores de app;
 * sus handlers DEBEN ser idempotentes porque aquí efectos e inbox no
 * comparten transacción.
 */

import { supabase } from "@/lib/supabase";

export interface OutboxEvent {
  id: string;
  event_id: string;
  event_type: string;
  schema_version: number;
  source_app: string;
  aggregate_type: string;
  aggregate_id: string;
  payload: Record<string, unknown>;
  status: string;
  attempts: number;
  max_attempts: number;
  last_error: string | null;
  created_at: string;
}

export type OutboxHandler = (event: OutboxEvent) => Promise<Record<string, unknown> | void>;

export interface OutboxHandlerSpec {
  /** Versión de esquema soportada; otras versiones se envían a fallo. */
  schemaVersion: number;
  handle: OutboxHandler;
}

export async function publishEvent(
  eventId: string,
  eventType: string,
  sourceApp: "merchanops" | "merchanlogs",
  aggregateType: string,
  aggregateId: string,
  payload: Record<string, unknown> = {},
  schemaVersion = 1
): Promise<{ published: boolean }> {
  if (!supabase) throw new Error("Supabase no disponible: no se puede publicar (modo solo lectura).");
  const { data, error } = await supabase.rpc("outbox_publish", {
    p_event_id: eventId,
    p_event_type: eventType,
    p_source_app: sourceApp,
    p_aggregate_type: aggregateType,
    p_aggregate_id: aggregateId,
    p_payload: payload,
    p_schema_version: schemaVersion
  });
  if (error) throw new Error(error.message);
  return { published: Boolean((data as { published?: boolean })?.published) };
}

export interface ProcessResult {
  claimed: number;
  completed: number;
  duplicates: number;
  failed: number;
  errors: Array<{ eventId: string; error: string }>;
}

/**
 * Procesa un lote de eventos pendientes. `consumer` identifica a la app
 * consumidora (ej. "merchanops-web"); el inbox es por consumidor.
 */
export async function processOutbox(
  consumer: string,
  handlers: Record<string, OutboxHandlerSpec>,
  limit = 10
): Promise<ProcessResult> {
  if (!supabase) throw new Error("Supabase no disponible: consumo de eventos pausado (modo solo lectura).");
  const result: ProcessResult = { claimed: 0, completed: 0, duplicates: 0, failed: 0, errors: [] };

  const { data: events, error } = await supabase.rpc("outbox_claim", { p_consumer: consumer, p_limit: limit });
  if (error) throw new Error(error.message);
  const claimed = (events ?? []) as OutboxEvent[];
  result.claimed = claimed.length;

  for (const event of claimed) {
    try {
      // Efectivamente-una-vez: si el inbox ya registró este evento para este
      // consumidor (ej. caída entre efectos e inbox en un intento anterior no
      // aplica aquí porque el inbox se escribe tras efectos, pero un reintento
      // tras completar sí), NO se repiten los efectos.
      const { data: seen } = await supabase
        .from("inbox_processed")
        .select("event_id")
        .eq("event_id", event.event_id)
        .eq("consumer", consumer)
        .maybeSingle();
      if (seen) {
        await supabase.rpc("outbox_complete", { p_event_id: event.event_id, p_consumer: consumer, p_result: {} });
        result.duplicates += 1;
        continue;
      }
      const spec = handlers[event.event_type];
      if (!spec) throw new Error(`Sin handler para el tipo de evento "${event.event_type}"`);
      if (event.schema_version !== spec.schemaVersion) {
        throw new Error(`Versión de esquema no soportada: evento v${event.schema_version}, handler v${spec.schemaVersion}`);
      }
      if (!event.payload || typeof event.payload !== "object") {
        throw new Error("Payload inválido");
      }

      const effects = (await spec.handle(event)) ?? {};
      const { data: done, error: completeError } = await supabase.rpc("outbox_complete", {
        p_event_id: event.event_id,
        p_consumer: consumer,
        p_result: effects
      });
      if (completeError) throw new Error(completeError.message);
      if ((done as { alreadyProcessed?: boolean })?.alreadyProcessed) result.duplicates += 1;
      else result.completed += 1;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      result.failed += 1;
      result.errors.push({ eventId: event.event_id, error: message });
      await supabase.rpc("outbox_fail", { p_event_id: event.event_id, p_error: message });
    }
  }
  return result;
}

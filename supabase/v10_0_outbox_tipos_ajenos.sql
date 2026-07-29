-- v10_0 — M-08: el notificador interno deja de marcar como fallidos los eventos
-- que sencillamente no son asunto suyo.
--
-- QUÉ PASABA
-- Conviven DOS familias de nombres de evento en el outbox:
--   · `logistics_*.*`  (request.created, shipment.created, incident.created,
--                       stock.below_minimum, request.rejected) → las maneja
--                       `outbox_process_db_notifier` y generan notificación.
--   · `logistics.*`    (picking_shipped, delivery_confirmed, request_rejected)
--                       publicadas en v8_3_outbox.sql:172,204,251 → NADIE las
--                       consume: ni OPS ni MerchanLOGS (verificado en el repo de
--                       LOGS: cero referencias a outbox en código y en docs).
--
-- La rama `else` del notificador mandaba a reintentos y dead-letter cualquier
-- tipo desconocido. Esa decisión es CORRECTA y se conserva —un evento que nadie
-- atiende debe ser visible, nunca descartarse en silencio—, pero convertía en
-- falsa alarma algo que no es un fallo: `logistics.picking_shipped` agotó sus 8
-- intentos el 2026-07-12 y lleva desde entonces en dead-letter. `logistics.
-- delivery_confirmed` y `logistics.request_rejected` harían exactamente lo mismo
-- en cuanto se confirme una entrega o se rechace una petición.
--
-- QUÉ SE HACE
-- Se declaran esos tres tipos como AJENOS a este consumidor: se completan para
-- `db-notifier` con una marca explícita en `inbox_processed.result`, sin generar
-- notificación. Los tipos realmente desconocidos siguen yendo a dead-letter.
--
-- Se toca SOLO el consumidor. Las funciones que publican
-- (`logistics_ship_picking`, `logistics_confirm_delivery`,
-- `logistics_reject_request`) son comandos transaccionales de los que depende
-- MerchanLOGS y no se modifican.
--
-- LIMITACIÓN CONOCIDA, A DECIDIR EN MERCHAN CORE
-- `outbox_complete` pone `status='completado'` en la FILA del evento, mientras
-- que `inbox_processed` es por consumidor. Es decir: el outbox es de un solo
-- consumidor en la práctica, aunque su inbox esté preparado para varios. Si
-- algún día MerchanLOGS quiere consumir la familia `logistics.*`, habrá que
-- pasar el estado a por-consumidor ANTES; con el diseño actual, que db-notifier
-- las complete impide que otro las reciba. Queda anotado en la auditoría.

create or replace function public.outbox_process_db_notifier(p_limit integer default 20)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  ev public.outbox_events%rowtype;
  v_completed int := 0;
  v_failed int := 0;
  v_skipped int := 0;
  v_type text;
  v_priority text;
  v_href text;
  v_entity text;
  v_message text;
  -- Familia publicada por v8_3_outbox.sql que este consumidor no atiende.
  v_foreign text[] := array[
    'logistics.picking_shipped',
    'logistics.delivery_confirmed',
    'logistics.request_rejected'
  ];
begin
  for ev in select * from public.outbox_claim('db-notifier', p_limit) loop
    begin
      -- Efectivamente-una-vez: inbox por consumidor (misma transacción que los efectos).
      if exists (select 1 from public.inbox_processed where event_id = ev.event_id and consumer = 'db-notifier') then
        perform public.outbox_complete(ev.event_id, 'db-notifier', '{}'::jsonb);
        continue;
      end if;

      -- Tipo conocido pero ajeno a este consumidor: no es un fallo suyo.
      if ev.event_type = any (v_foreign) then
        perform public.outbox_complete(
          ev.event_id, 'db-notifier',
          jsonb_build_object('skipped', true, 'reason', 'tipo ajeno a db-notifier'));
        v_skipped := v_skipped + 1;
        continue;
      end if;

      if ev.event_type = 'logistics_request.created' then
        v_type := 'request_received'; v_entity := 'request'; v_href := '/peticiones';
        v_priority := case when ev.payload->>'priority' in ('urgente', 'critica', 'alta') then 'alta' else 'media' end;
        v_message := 'Nueva petición de material ' || coalesce(ev.payload->>'code', ev.aggregate_id) || ' pendiente de revisar';
      elsif ev.event_type = 'logistics_request.rejected' then
        v_type := 'request_rejected'; v_entity := 'request'; v_href := '/peticiones'; v_priority := 'alta';
        v_message := 'Petición ' || coalesce(ev.payload->>'code', ev.aggregate_id) || ' rechazada'
                     || coalesce(': ' || nullif(ev.payload->>'motivo', ''), '');
      elsif ev.event_type = 'logistics_shipment.created' then
        v_type := 'shipment_created'; v_entity := 'shipment'; v_href := '/envios'; v_priority := 'media';
        v_message := 'Nuevo envío creado' || coalesce(' (' || nullif(ev.payload->>'transportista', '') || ')', '');
      elsif ev.event_type = 'logistics_incident.created' then
        v_type := 'incident_created'; v_entity := 'incident'; v_href := '/incidencias'; v_priority := 'alta';
        v_message := 'Incidencia logística ' || coalesce(ev.payload->>'codigo', ev.aggregate_id)
                     || coalesce(' (' || nullif(ev.payload->>'tipo', '') || ')', '');
      elsif ev.event_type = 'logistics_stock.below_minimum' then
        v_type := 'stock_low'; v_entity := 'material'; v_href := '/materiales'; v_priority := 'critica';
        v_message := 'Stock bajo mínimo: ' || coalesce(nullif(ev.payload->>'nombre', ''), ev.payload->>'sku', ev.aggregate_id)
                     || ' (' || coalesce(ev.payload->>'disponible', '?') || ' / mínimo ' || coalesce(ev.payload->>'minimo', '?') || ')';
      else
        -- Tipo DESCONOCIDO: a reintentos/dead-letter para que sea VISIBLE,
        -- nunca descartado en silencio. Se conserva a propósito.
        perform public.outbox_fail(ev.event_id, 'Sin handler para el tipo ' || ev.event_type);
        v_failed := v_failed + 1;
        continue;
      end if;

      insert into public.logistics_notifications (type, priority, entity_type, entity_id, href, message, event_id)
      values (v_type, v_priority, v_entity, ev.aggregate_id, v_href, v_message, ev.event_id)
      on conflict (event_id) where event_id is not null do nothing;

      perform public.outbox_complete(ev.event_id, 'db-notifier', jsonb_build_object('notification', v_type));
      v_completed := v_completed + 1;
    exception when others then
      perform public.outbox_fail(ev.event_id, sqlerrm);
      v_failed := v_failed + 1;
    end;
  end loop;
  return jsonb_build_object('completed', v_completed, 'failed', v_failed, 'skipped', v_skipped);
end $function$;

-- Reencola el evento atascado: dead_letter es terminal, así que no se recupera
-- solo. Con el consumidor ya corregido, el cron lo completará como ajeno en el
-- próximo minuto en vez de volver a fallar.
update public.outbox_events
   set status = 'pendiente', attempts = 0, next_attempt_at = now(), last_error = null
 where status = 'dead_letter'
   and event_type in ('logistics.picking_shipped', 'logistics.delivery_confirmed', 'logistics.request_rejected');

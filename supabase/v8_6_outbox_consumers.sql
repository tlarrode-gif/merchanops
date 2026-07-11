-- v8_6 (A6): el outbox deja de estar huérfano.
-- APLICADA al proyecto dptmswhwmqimijpfyndn el 2026-07-11 (junto con v8_6b).
--
-- PUBLICACIÓN por trigger (misma transacción que el dato: si el INSERT/UPDATE
-- hace commit, el evento existe; si hace rollback, no) y CONSUMO dentro de la
-- base con pg_cron (cada minuto): efectos + inbox + completado comparten
-- transacción, por lo que este consumidor es exactamente-una-vez de verdad.
-- event_id determinista => reintentos y dobles disparos no duplican eventos ni
-- notificaciones.
--
-- Eventos publicados:
--   logistics_request.created    (INSERT en logistics_requests)
--   logistics_request.rejected   (status -> 'rechazada')
--   logistics_shipment.created   (INSERT en logistics_shipments)
--   logistics_incident.created   (INSERT en logistics_incidents)
--   logistics_stock.below_minimum (disponible cruza stock_minimo; máx. 1/día/material)
--
-- Consumidor 'db-notifier': genera logistics_notifications idempotentes
-- (unique parcial sobre event_id). Tipos desconocidos van a reintentos y
-- dead-letter (visibles), nunca se descartan en silencio.
--
-- Verificación en vivo (transacción revertida): publicación transaccional,
-- sin duplicados al cruzar el mínimo dos veces, notificaciones creadas,
-- reproceso sin duplicar efectos, rechazo notificado, tipo desconocido a
-- error/dead_letter. cron.job_run_details confirma ejecuciones 'succeeded'.

-- 1) Idempotencia del efecto: una notificación por evento.
alter table logistics_notifications add column if not exists event_id text;
create unique index if not exists uq_logistics_notifications_event
  on logistics_notifications(event_id) where event_id is not null;

-- 2) Publicadores (triggers).
create or replace function outbox_publish_logistics()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  if tg_table_name = 'logistics_requests' then
    if tg_op = 'INSERT' then
      perform public.outbox_publish(
        'req:' || new.id || ':created', 'logistics_request.created',
        coalesce(new.source_system, 'merchanops'), 'logistics_request', new.id::text,
        jsonb_build_object('code', new.code, 'priority', new.priority, 'status', new.status,
                           'source_type', new.source_type, 'service_id', new.service_id));
    elsif tg_op = 'UPDATE' and new.status = 'rechazada' and old.status is distinct from 'rechazada' then
      perform public.outbox_publish(
        'req:' || new.id || ':rejected', 'logistics_request.rejected',
        'merchanlogs', 'logistics_request', new.id::text,
        jsonb_build_object('code', new.code, 'motivo', new.rejection_reason));
    end if;
  elsif tg_table_name = 'logistics_shipments' and tg_op = 'INSERT' then
    perform public.outbox_publish(
      'ship:' || new.id || ':created', 'logistics_shipment.created',
      'merchanlogs', 'logistics_shipment', new.id::text,
      jsonb_build_object('picking_id', new.picking_id, 'transportista', new.transportista, 'estado', new.estado));
  elsif tg_table_name = 'logistics_incidents' and tg_op = 'INSERT' then
    perform public.outbox_publish(
      'inc:' || new.id || ':created', 'logistics_incident.created',
      'merchanlogs', 'logistics_incident', new.id::text,
      jsonb_build_object('codigo', new.codigo, 'tipo', new.tipo, 'estado', new.estado));
  end if;
  return new;
end $$;

drop trigger if exists trg_outbox_logistics_requests on logistics_requests;
create trigger trg_outbox_logistics_requests
  after insert or update on logistics_requests
  for each row execute function outbox_publish_logistics();
drop trigger if exists trg_outbox_logistics_shipments on logistics_shipments;
create trigger trg_outbox_logistics_shipments
  after insert on logistics_shipments
  for each row execute function outbox_publish_logistics();
drop trigger if exists trg_outbox_logistics_incidents on logistics_incidents;
create trigger trg_outbox_logistics_incidents
  after insert on logistics_incidents
  for each row execute function outbox_publish_logistics();

-- Stock por debajo del mínimo: solo al CRUZAR el umbral (no en cada update) y
-- como máximo un evento por material y día (event_id determinista con fecha).
-- Nota: logistics_stock.disponible es columna GENERADA, siempre presente.
create or replace function outbox_publish_stock_low()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
declare
  v_min numeric;
  v_sku text;
  v_nombre text;
  v_old numeric := coalesce(old.disponible, old.cantidad_fisica - old.cantidad_reservada);
  v_new numeric := coalesce(new.disponible, new.cantidad_fisica - new.cantidad_reservada);
begin
  select stock_minimo, sku, nombre into v_min, v_sku, v_nombre
    from public.logistics_materials where id = new.material_id;
  if v_min is null or v_min <= 0 then return new; end if;
  if v_new < v_min and coalesce(v_old, v_min) >= v_min then
    perform public.outbox_publish(
      'stock:' || new.material_id || ':below:' || to_char(now() at time zone 'utc', 'YYYYMMDD'),
      'logistics_stock.below_minimum', 'merchanlogs', 'logistics_stock', new.material_id::text,
      jsonb_build_object('sku', v_sku, 'nombre', v_nombre, 'disponible', v_new, 'minimo', v_min));
  end if;
  return new;
end $$;

drop trigger if exists trg_outbox_stock_low on logistics_stock;
create trigger trg_outbox_stock_low
  after update on logistics_stock
  for each row execute function outbox_publish_stock_low();

-- 3) Consumidor en la base: notificaciones idempotentes.
create or replace function outbox_process_db_notifier(p_limit integer default 20)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  ev public.outbox_events%rowtype;
  v_completed int := 0;
  v_failed int := 0;
  v_type text;
  v_priority text;
  v_href text;
  v_entity text;
  v_message text;
begin
  for ev in select * from public.outbox_claim('db-notifier', p_limit) loop
    begin
      -- Efectivamente-una-vez: inbox por consumidor (misma transacción que los efectos).
      if exists (select 1 from public.inbox_processed where event_id = ev.event_id and consumer = 'db-notifier') then
        perform public.outbox_complete(ev.event_id, 'db-notifier', '{}'::jsonb);
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
        -- Tipo desconocido: a reintentos/dead-letter para que sea VISIBLE, nunca descartado en silencio.
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
  return jsonb_build_object('completed', v_completed, 'failed', v_failed);
end $$;
revoke all on function outbox_process_db_notifier(integer) from public, anon;
grant execute on function outbox_process_db_notifier(integer) to authenticated;

-- 4) Latido: pg_cron procesa el outbox cada minuto.
create extension if not exists pg_cron;
do $$
begin
  perform cron.unschedule('outbox-db-notifier');
exception when others then null;
end $$;
select cron.schedule('outbox-db-notifier', '* * * * *', 'select public.outbox_process_db_notifier();');

-- v8_6b: las funciones del outbox (v8_3) usan nombres sin cualificar; al ser
-- invocadas desde funciones con search_path vacío (los triggers de arriba)
-- fallaban con "relation outbox_events does not exist".
alter function outbox_publish(text, text, text, text, text, jsonb, integer) set search_path = public;
alter function outbox_claim(text, integer) set search_path = public;
alter function outbox_complete(text, text, jsonb) set search_path = public;
alter function outbox_fail(text, text) set search_path = public;

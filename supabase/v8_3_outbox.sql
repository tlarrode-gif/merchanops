-- v8_3: Patrón inbox/outbox durable entre MerchanOPS y MerchanLOGS (fase 5).
--
-- outbox_events: cola durable de eventos de dominio. Los comandos SQL de la
-- fase 4 publican su evento EN LA MISMA transacción que el cambio de dominio.
-- inbox_processed: registro de eventos procesados por consumidor —
-- procesamiento efectivamente-una-vez (un evento repetido se reconoce como
-- duplicado y NO vuelve a crear incidencias/solicitudes/reservas/pickings).

create table if not exists outbox_events (
  id uuid primary key default gen_random_uuid(),
  event_id text not null unique,
  event_type text not null,
  schema_version integer not null default 1,
  source_app text not null check (source_app in ('merchanops', 'merchanlogs', 'sistema')),
  aggregate_type text not null,
  aggregate_id text not null,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'pendiente' check (status in ('pendiente', 'procesando', 'completado', 'error', 'dead_letter')),
  attempts integer not null default 0,
  max_attempts integer not null default 8,
  next_attempt_at timestamptz not null default now(),
  last_error text,
  claimed_by text,
  claimed_at timestamptz,
  processed_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists outbox_events_pending_idx on outbox_events (status, next_attempt_at);

create table if not exists inbox_processed (
  event_id text not null,
  consumer text not null,
  result jsonb not null default '{}'::jsonb,
  processed_at timestamptz not null default now(),
  primary key (event_id, consumer)
);

-- ---------------------------------------------------------------------------
-- Publicar (idempotente por event_id)
-- ---------------------------------------------------------------------------

create or replace function outbox_publish(
  p_event_id text,
  p_event_type text,
  p_source_app text,
  p_aggregate_type text,
  p_aggregate_id text,
  p_payload jsonb default '{}'::jsonb,
  p_schema_version integer default 1
) returns jsonb as $$
declare
  inserted uuid;
begin
  insert into outbox_events (event_id, event_type, schema_version, source_app, aggregate_type, aggregate_id, payload)
  values (p_event_id, p_event_type, p_schema_version, p_source_app, p_aggregate_type, p_aggregate_id, coalesce(p_payload, '{}'::jsonb))
  on conflict (event_id) do nothing
  returning id into inserted;
  return jsonb_build_object('eventId', p_event_id, 'published', inserted is not null);
end $$ language plpgsql;

-- ---------------------------------------------------------------------------
-- Reclamar eventos de forma segura (SKIP LOCKED: sin doble reclamo)
-- ---------------------------------------------------------------------------

create or replace function outbox_claim(
  p_consumer text,
  p_limit integer default 10
) returns setof outbox_events as $$
begin
  return query
  update outbox_events o
     set status = 'procesando',
         claimed_by = p_consumer,
         claimed_at = now(),
         attempts = o.attempts + 1
   where o.id in (
     select id from outbox_events
      where status in ('pendiente', 'error')
        and next_attempt_at <= now()
      order by created_at
      limit greatest(1, p_limit)
      for update skip locked
   )
  returning o.*;
end $$ language plpgsql;

-- ---------------------------------------------------------------------------
-- Completar: inbox + estado, misma transacción. Duplicado reconocido.
-- ---------------------------------------------------------------------------

create or replace function outbox_complete(
  p_event_id text,
  p_consumer text,
  p_result jsonb default '{}'::jsonb
) returns jsonb as $$
declare
  already boolean := false;
begin
  insert into inbox_processed (event_id, consumer, result)
  values (p_event_id, p_consumer, coalesce(p_result, '{}'::jsonb))
  on conflict (event_id, consumer) do nothing;
  if not found then
    already := true; -- ya procesado por este consumidor: no repetir efectos
  end if;

  update outbox_events
     set status = 'completado', processed_at = now(), last_error = null
   where event_id = p_event_id;

  return jsonb_build_object('eventId', p_event_id, 'alreadyProcessed', already);
end $$ language plpgsql;

-- ---------------------------------------------------------------------------
-- Fallar con backoff exponencial y dead-letter
-- ---------------------------------------------------------------------------

create or replace function outbox_fail(
  p_event_id text,
  p_error text
) returns jsonb as $$
declare
  ev outbox_events%rowtype;
  new_status text;
begin
  select * into ev from outbox_events where event_id = p_event_id for update;
  if not found then
    raise exception 'Evento % no encontrado en outbox', p_event_id;
  end if;

  if ev.attempts >= ev.max_attempts then
    new_status := 'dead_letter';
  else
    new_status := 'error';
  end if;

  update outbox_events
     set status = new_status,
         last_error = left(coalesce(p_error, 'error desconocido'), 2000),
         next_attempt_at = now() + (interval '30 seconds' * power(2, least(ev.attempts, 10)))
   where event_id = p_event_id;

  return jsonb_build_object('eventId', p_event_id, 'status', new_status, 'attempts', ev.attempts);
end $$ language plpgsql;

-- ---------------------------------------------------------------------------
-- Los comandos de la fase 4 publican su evento EN LA MISMA transacción.
-- (Se re-crean con la publicación integrada; misma lógica + outbox_publish.)
-- ---------------------------------------------------------------------------

create or replace function logistics_confirm_delivery(
  p_shipment_id uuid,
  p_actor text default null
) returns jsonb as $$
declare
  updated_id uuid;
begin
  update logistics_shipments
     set estado = 'entregado', fecha_real_entrega = current_date
   where id = p_shipment_id and estado <> 'entregado'
  returning id into updated_id;

  if updated_id is null then
    if exists (select 1 from logistics_shipments where id = p_shipment_id) then
      raise exception 'La entrega del envío % ya estaba confirmada: no se confirma dos veces.', p_shipment_id;
    end if;
    raise exception 'Envío % no encontrado.', p_shipment_id;
  end if;

  perform outbox_publish(
    'delivery:' || p_shipment_id::text,
    'logistics.delivery_confirmed', 'sistema', 'shipment', p_shipment_id::text,
    jsonb_build_object('actor', p_actor)
  );
  return jsonb_build_object('shipmentId', p_shipment_id, 'estado', 'entregado');
end $$ language plpgsql;

create or replace function logistics_ship_picking(
  p_picking_id uuid,
  p_transportista text default null,
  p_actor text default null
) returns jsonb as $$
declare
  picking_row logistics_pickings%rowtype;
  shipment_id uuid;
begin
  select * into picking_row from logistics_pickings where id = p_picking_id for update;
  if not found then raise exception 'Picking % no encontrado', p_picking_id; end if;
  if picking_row.estado not in ('preparado', 'revisado') then
    raise exception 'No se puede generar envío: el picking % está "%" (debe estar preparado).', picking_row.codigo, picking_row.estado;
  end if;
  if picking_row.envio_id is not null then
    raise exception 'El picking % ya tiene envío asociado.', picking_row.codigo;
  end if;

  insert into logistics_shipments (estado, transportista, fecha_salida, picking_id)
  values ('preparado', p_transportista, current_date, p_picking_id)
  returning id into shipment_id;

  update logistics_pickings set estado = 'enviado', envio_id = shipment_id where id = p_picking_id;

  perform outbox_publish(
    'ship:' || p_picking_id::text,
    'logistics.picking_shipped', 'sistema', 'picking', p_picking_id::text,
    jsonb_build_object('shipmentId', shipment_id, 'transportista', p_transportista, 'actor', p_actor)
  );
  return jsonb_build_object('shipmentId', shipment_id, 'pickingId', p_picking_id);
end $$ language plpgsql;

create or replace function logistics_reject_request(
  p_request_id uuid,
  p_reason text,
  p_actor text default null
) returns jsonb as $$
declare
  request_row logistics_requests%rowtype;
  picking_row logistics_pickings%rowtype;
  line record;
  released jsonb := '[]'::jsonb;
begin
  if coalesce(p_reason, '') = '' then
    raise exception 'Rechazar una solicitud requiere motivo.';
  end if;
  select * into request_row from logistics_requests where id = p_request_id for update;
  if not found then raise exception 'Solicitud % no encontrada', p_request_id; end if;
  if request_row.status in ('entregada', 'cerrada', 'cancelada', 'rechazada') then
    raise exception 'La solicitud % está "%": no admite rechazo.', request_row.code, request_row.status;
  end if;

  for picking_row in
    select * from logistics_pickings where source_request_id = p_request_id and estado in ('pendiente', 'en_preparacion') for update
  loop
    for line in
      select material_id, sum(cantidad_esperada) as expected
        from logistics_picking_lines
       where picking_id = picking_row.id and material_id is not null and estado in ('pendiente', 'listo')
       group by material_id
    loop
      perform logistics_release_reservation(line.material_id, line.expected, 'Rechazo solicitud ' || request_row.code, p_actor);
      released := released || jsonb_build_object('materialId', line.material_id, 'released', line.expected);
    end loop;
    update logistics_pickings set estado = 'cerrado' where id = picking_row.id;
  end loop;

  update logistics_requests
     set status = 'rechazada', logistics_comment = coalesce(logistics_comment || ' · ', '') || 'Rechazada: ' || p_reason, updated_at = now()
   where id = p_request_id;

  perform outbox_publish(
    'reject:' || p_request_id::text,
    'logistics.request_rejected', 'sistema', 'request', p_request_id::text,
    jsonb_build_object('reason', p_reason, 'released', released, 'actor', p_actor)
  );
  return jsonb_build_object('requestId', p_request_id, 'status', 'rechazada', 'released', released);
end $$ language plpgsql;

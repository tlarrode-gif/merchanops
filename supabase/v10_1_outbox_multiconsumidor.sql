-- v10_1 — P-15: el outbox pasa a ser multi-consumidor DE VERDAD.
--
-- EL PROBLEMA
-- `inbox_processed` está diseñada por consumidor (PK event_id + consumer), pero
-- `outbox_complete` ponía `status='completado'` en la FILA del evento en cuanto
-- CUALQUIER consumidor lo procesaba. Y `outbox_claim` solo reclama eventos en
-- `pendiente`/`error`. Resultado: el primer consumidor que termina cierra el
-- evento para todos los demás.
--
-- Hoy no se nota porque solo hay un consumidor (`db-notifier`, vía cron cada
-- minuto). Pero es una trampa puesta justo en el camino de Merchan Core: el día
-- que MerchanLOGS se registre como segundo consumidor, empezaría a perder
-- eventos en silencio, sin error y sin dead-letter. Exactamente la clase de
-- fallo que esta auditoría ha ido encontrando una y otra vez.
--
-- LA SOLUCIÓN
-- Un registro explícito de consumidores. Un evento solo se da por `completado`
-- cuando TODOS los consumidores habilitados lo han procesado.
--
-- CERO CAMBIO DE COMPORTAMIENTO HOY: con un único consumidor registrado
-- (`db-notifier`), «todos lo han procesado» equivale a «lo ha procesado él», que
-- es lo que ocurría antes. Verificado tras aplicar.
--
-- De paso se corrige un defecto latente de `outbox_claim`: reclamaba eventos que
-- ese mismo consumidor ya había procesado, gastando un intento cada vez. Con un
-- solo consumidor nunca se dio (el evento pasaba a `completado` al instante),
-- pero con dos habría agotado `max_attempts` y dejado eventos atascados en
-- `pendiente`, invisibles. Ahora un consumidor nunca reclama lo que ya hizo.

-- ---------------------------------------------------------------------------
-- 1. Registro de consumidores
-- ---------------------------------------------------------------------------
create table if not exists public.outbox_consumers (
  consumer    text primary key,
  descripcion text,
  enabled     boolean not null default true,
  created_at  timestamptz not null default now()
);

comment on table public.outbox_consumers is
  'Consumidores del outbox. Un evento solo se marca completado cuando TODOS los '
  'habilitados lo han procesado. Registrar un consumidor nuevo ANTES de que '
  'empiece a consumir; si se registra y no consume, los eventos se quedan '
  'pendientes a propósito (visible) en vez de perderse en silencio.';

insert into public.outbox_consumers (consumer, descripcion)
values ('db-notifier', 'Notificador interno de OPS (cron outbox-db-notifier, cada minuto)')
on conflict (consumer) do nothing;

alter table public.outbox_consumers enable row level security;

drop policy if exists outbox_consumers_read on public.outbox_consumers;
create policy outbox_consumers_read on public.outbox_consumers
  for select to authenticated using ((select public.merchan_can_logistics()));

drop policy if exists outbox_consumers_admin on public.outbox_consumers;
create policy outbox_consumers_admin on public.outbox_consumers
  for all to authenticated
  using ((select public.merchan_is_admin()))
  with check ((select public.merchan_is_admin()));

-- ---------------------------------------------------------------------------
-- 2. `outbox_claim`: no reclamar lo que este consumidor ya procesó
-- ---------------------------------------------------------------------------
create or replace function public.outbox_claim(p_consumer text, p_limit integer default 10)
returns setof public.outbox_events
language plpgsql
set search_path to 'public'
as $function$
begin
  return query
  update outbox_events o
     set status = 'procesando',
         claimed_by = p_consumer,
         claimed_at = now(),
         attempts = o.attempts + 1
   where o.id in (
     select id from outbox_events e
      where (
              (e.status in ('pendiente', 'error') and e.next_attempt_at <= now())
           or (e.status = 'procesando' and e.claimed_at < now() - interval '10 minutes')
            )
        and e.attempts < e.max_attempts
        -- P-15: este consumidor ya lo hizo; que espere a los demás sin gastar intentos.
        and not exists (
          select 1 from inbox_processed ip
           where ip.event_id = e.event_id and ip.consumer = p_consumer
        )
      order by e.created_at
      limit greatest(1, p_limit)
      for update skip locked
   )
  returning o.*;
end $function$;

-- ---------------------------------------------------------------------------
-- 3. `outbox_complete`: completar solo cuando TODOS han procesado
-- ---------------------------------------------------------------------------
create or replace function public.outbox_complete(p_event_id text, p_consumer text, p_result jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
set search_path to 'public'
as $function$
declare
  already boolean := false;
  pendientes int;
begin
  insert into inbox_processed (event_id, consumer, result)
  values (p_event_id, p_consumer, coalesce(p_result, '{}'::jsonb))
  on conflict (event_id, consumer) do nothing;
  if not found then
    already := true;
  end if;

  -- ¿Queda algún consumidor habilitado que todavía no lo haya procesado?
  select count(*) into pendientes
    from outbox_consumers c
   where c.enabled
     and not exists (
       select 1 from inbox_processed ip
        where ip.event_id = p_event_id and ip.consumer = c.consumer
     );

  if pendientes = 0 then
    update outbox_events
       set status = 'completado', processed_at = now(), last_error = null
     where event_id = p_event_id;
  else
    -- Sigue vivo para los que faltan. Se devuelve a la cola sin gastar intento
    -- extra: `outbox_claim` ya no se lo dará a quien lo tenga hecho.
    update outbox_events
       set status = 'pendiente', claimed_by = null, claimed_at = null, last_error = null
     where event_id = p_event_id
       and status = 'procesando';
  end if;

  return jsonb_build_object(
    'eventId', p_event_id,
    'alreadyProcessed', already,
    'consumidoresPendientes', pendientes
  );
end $function$;

-- v10_8 · Los eventos de RR.HH. dejan de morir en dead-letter antes de nacer.
-- PENDIENTE DE APLICAR al proyecto dptmswhwmqimijpfyndn.
--
-- ============================================================================
-- PROBLEMA
-- ============================================================================
-- v10_6 y v10_7 publican cuatro tipos de evento nuevos en el outbox:
--   rrhh_alta.solicitada · rrhh_alta.resuelta
--   rrhh_acceso.solicitado · rrhh_acceso.resuelto
--
-- El único consumidor registrado es `db-notifier` (cron cada minuto), y su rama
-- `else` manda a reintentos y dead-letter cualquier tipo que no reconoce. Esa
-- decisión es CORRECTA y se conserva: un evento que nadie atiende debe ser
-- visible, nunca descartarse en silencio.
--
-- Pero aquí no es un fallo: `db-notifier` genera notificaciones de LOGÍSTICA
-- (logistics_notifications: peticiones, envíos, incidencias, stock bajo). Los
-- eventos de RR.HH. no son asunto suyo. Sin este arreglo, la PRIMERA solicitud
-- de alta que alguien tramite empezaría a fallar cada minuto, agotaría sus 8
-- intentos con retroceso exponencial y acabaría en dead-letter, exactamente
-- como le pasó a `logistics.picking_shipped` el 2026-07-12 (ver v10_0). Y con
-- ella todas las demás: una falsa alarma permanente en la cola.
--
-- ============================================================================
-- QUÉ SE HACE
-- ============================================================================
-- Se declaran las dos familias `rrhh_alta.*` y `rrhh_acceso.*` como AJENAS a
-- este consumidor. Se completan para `db-notifier` con una marca explícita en
-- `inbox_processed.result`, sin generar notificación.
--
-- Se declaran POR PREFIJO (v_foreign_like) y no una a una: el módulo de RR.HH.
-- va a publicar más tipos (bajas, ampliaciones, sincronización con A3), y no
-- tiene sentido que cada uno de ellos exija otra migración para no romper la
-- cola. Los tipos realmente desconocidos —los que no empiezan por `rrhh_alta.`
-- ni por `rrhh_acceso.`— siguen yendo a dead-letter.
--
-- El resto de la función es COPIA LITERAL de v10_0: no se toca ni un handler.
--
-- ============================================================================
-- POR QUÉ NO SE REGISTRA 'a3-adapter' EN outbox_consumers
-- ============================================================================
-- Sería lo natural: los eventos de RR.HH. existen precisamente para que algún
-- día un adaptador los lleve a A3 (decisión D6: hoy manual, mañana API).
--
-- Pero v10_1 dejó el outbox como multi-consumidor de verdad: un evento solo se
-- marca `completado` cuando TODOS los consumidores habilitados lo han
-- procesado, y el propio comentario de `outbox_consumers` lo dice sin rodeos —
-- «registrar un consumidor nuevo ANTES de que empiece a consumir; si se
-- registra y no consume, los eventos se quedan pendientes a propósito».
--
-- El adaptador de A3 NO EXISTE. Registrarlo hoy dejaría TODOS los eventos del
-- outbox —también los de logística, que sí funcionan— en `pendiente` para
-- siempre, esperando a un consumidor que nunca va a reclamarlos. Sería cambiar
-- un problema visible (dead-letter, que al menos se ve y avisa) por uno
-- invisible (una cola que crece sin que nadie note nada).
--
-- CUANDO EL ADAPTADOR EXISTA, y no antes, hay que hacer DOS cosas en el mismo
-- despliegue:
--   1) insert into public.outbox_consumers (consumer, descripcion)
--      values ('a3-adapter', 'Adaptador de A3 (altas y bajas laborales)');
--   2) quitar 'rrhh_alta.%' de v_foreign_like en esta función, para que
--      db-notifier deje de completarlos como ajenos... o mejor: DEJARLO, porque
--      "ajeno a db-notifier" seguirá siendo verdad; `inbox_processed` es por
--      consumidor, así que db-notifier los marca como suyos y el adaptador los
--      sigue reclamando por su cuenta. Es justo el escenario para el que se
--      escribió v10_1.
--
-- ============================================================================
-- VERIFICACIÓN (tras aplicar)
-- ============================================================================
--   -- publicar un evento de RR.HH. de prueba y procesar el outbox a mano
--   select public.outbox_publish('rrhh_alta:prueba:solicitada','rrhh_alta.solicitada',
--          'merchanops','rrhh_solicitud_alta','prueba','{}'::jsonb);
--   select public.outbox_process_db_notifier();      -- {"skipped": 1, ...}
--   select status, attempts from outbox_events where event_id = 'rrhh_alta:prueba:solicitada';
--                                                    -- completado, 1 intento
--   select result from inbox_processed where event_id = 'rrhh_alta:prueba:solicitada';
--                                                    -- {"skipped": true, ...}
--   -- un tipo de verdad desconocido SIGUE yendo a error/dead-letter
--   select public.outbox_publish('x:1','tipo.inventado','sistema','x','1','{}'::jsonb);
--   select public.outbox_process_db_notifier();      -- {"failed": 1, ...}
--   -- y que no se ha registrado ningún consumidor nuevo
--   select consumer, enabled from outbox_consumers;  -- solo db-notifier
--
-- ROLLBACK: volver a ejecutar supabase/v10_0_outbox_tipos_ajenos.sql
-- (recrea la función sin las familias de RR.HH.; a partir de ahí los eventos
-- de RR.HH. volverían a ir a dead-letter).

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
  -- v10_8: familias de RR.HH. (v10_6 y v10_7). Por PREFIJO, para que añadir un
  -- tipo nuevo al módulo no obligue a otra migración para no romper la cola.
  -- db-notifier solo genera logistics_notifications: RR.HH. no es asunto suyo.
  v_foreign_like text[] := array[
    'rrhh_alta.%',
    'rrhh_acceso.%'
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
      if ev.event_type = any (v_foreign) or ev.event_type like any (v_foreign_like) then
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

revoke all on function public.outbox_process_db_notifier(integer) from public, anon;
grant execute on function public.outbox_process_db_notifier(integer) to authenticated, service_role;

comment on function public.outbox_process_db_notifier(integer) is
  'Consumidor "db-notifier" del outbox: convierte eventos de logística en logistics_notifications idempotentes. Las familias logistics.* (v8_3), rrhh_alta.* y rrhh_acceso.* se completan como AJENAS sin notificar; los tipos realmente desconocidos van a reintentos y dead-letter para que sean visibles.';

-- ---------------------------------------------------------------------------
-- Red de seguridad
-- ---------------------------------------------------------------------------
-- Si entre la aplicación de v10_6/v10_7 y la de este fichero alguien llegó a
-- tramitar una solicitud, sus eventos se habrán ido acumulando intentos o
-- habrán caído a dead-letter, que es un estado TERMINAL: no se recupera solo.
-- Se reencolan aquí. Con el consumidor ya corregido, el cron los completará
-- como ajenos en el próximo minuto en vez de volver a fallar.
update public.outbox_events
   set status = 'pendiente', attempts = 0, next_attempt_at = now(), last_error = null
 where status in ('dead_letter', 'error')
   and (event_type like 'rrhh_alta.%' or event_type like 'rrhh_acceso.%');

-- NO se registra ningún consumidor nuevo. Ver el bloque de la cabecera:
-- registrar 'a3-adapter' antes de que el adaptador exista dejaría TODA la cola
-- (también la de logística) pendiente para siempre.

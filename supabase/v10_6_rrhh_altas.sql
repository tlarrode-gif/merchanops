-- v10_6 · Altas laborales: solicitudes, altas reales de A3 y su bitácora.
-- PENDIENTE DE APLICAR al proyecto dptmswhwmqimijpfyndn.
--
-- ============================================================================
-- PROBLEMA
-- ============================================================================
-- Hoy el alta de un trabajador se pide por WhatsApp y se resuelve de memoria.
-- Nadie sabe, mirando una pantalla, si el trabajador que empieza el lunes ya
-- está de alta, si su alta cubre las fechas o si hay que ampliarla. Y cuando
-- alguien lo sabe, lo sabe una sola persona.
--
-- El diseño exige que TODO lo que se pueda deducir lo deduzca el sistema (el
-- "texto gris"): "Alta nueva del 28/07 al 31/07 · 2 imputaciones a 3005, 3136",
-- "Cubierto por el alta 18832 · no hace falta alta nueva", "Se solapa con el
-- alta 18832 (20/07 → 29/07) · ampliar hasta el 31/07". Para deducirlo hay que
-- tener las altas REALES de A3 en una tabla contra la que comparar.
--
-- ============================================================================
-- DECISIONES (tomadas por el usuario, ver docs/ROADMAP_RRHH.md)
-- ============================================================================
-- D1  El trabajo pendiente de alta se enlaza de forma POLIMÓRFICA
--     (origen_tipo: 'campana' | 'campana_punto' | 'servicio'). No hay tabla de
--     "trabajos": la verdad de la asignación vive en grandes_campanas,
--     puntos_venta_campana y services, y aquí solo se guarda la referencia.
--
-- D2  MERCHANOPS NO GUARDA DATOS PERSONALES. Ni DNI, ni NIE, ni NAF, ni IBAN,
--     ni fecha de nacimiento, ni domicilio. Todo eso vive SOLO en A3. De A3 se
--     guarda lo mínimo para operar: número de alta, tipo de contrato, fechas,
--     CECO, horas/día y estado. Por eso NO existe ninguna tabla
--     rrhh_datos_laborales, y no debe crearse.
--
-- D3  El CECO y las horas/día vienen de la gran campaña (v10_5), se heredan en
--     cada línea de la solicitud y son editables línea a línea: una misma alta
--     puede imputar a dos CECOs distintos ("2 imputaciones a 3005, 3136").
--
-- D6  A3 es MANUAL desde el día uno. Las columnas a3_* son un espejo preparado
--     para la API futura: hoy las rellena una persona (a3_canal = 'manual') y
--     el día que exista el adaptador las rellenará él (a3_canal = 'api') sin
--     cambiar el esquema.
--
-- ============================================================================
-- QUIÉN PUEDE QUÉ
-- ============================================================================
--   La GESTORA   solicita. Solo a través de merchan_rrhh_solicitar_alta: las
--                tablas no tienen policy de INSERT para nadie, así que el RPC
--                (SECURITY DEFINER) es la única puerta y valida permisos por
--                dentro. Después ve SUS solicitudes y nada más.
--   RR.HH.       resuelve: teclea el número de A3, cambia el estado, crea el
--                alta real. Ve todas las solicitudes y todas las altas.
--   Cualquiera con el módulo lee rrhh_altas: sin eso la pantalla no puede
--                calcular la cobertura y el "texto gris" quedaría en blanco.
--
-- ============================================================================
-- VERIFICACIÓN (tras aplicar)
-- ============================================================================
--   select public.merchan_next_rrhh_code('alta');    -- ALT-AAMMDD-001
--   select public.merchan_next_rrhh_code('acceso');  -- ACC-AAMMDD-001
--   select public.merchan_next_rrhh_code('otra');    -- error en castellano
--   -- con sesión de gestora: crea y ve la suya, pero no la de otra
--   select public.merchan_rrhh_solicitar_alta(jsonb_build_object(
--     'worker_id', (select id from workers limit 1),
--     'resolucion_sistema', 'alta_nueva',
--     'lineas', jsonb_build_array(jsonb_build_object(
--       'origen_tipo','campana','origen_id','demo','campana','Demo',
--       'ceco','3005','fecha_inicio','2026-07-28','fecha_fin','2026-07-31'))));
--   update rrhh_solicitudes_alta set estado = 'tramitada';  -- 0 filas (gestora)
--   -- con sesión de RR.HH.: transiciones y motivo obligatorio
--   update rrhh_solicitudes_alta set estado = 'baja_pendiente' where estado = 'pendiente';
--     -- error: transición no permitida
--   update rrhh_solicitudes_alta set estado = 'rechazada' where estado = 'pendiente';
--     -- error: hace falta motivo
--   delete from rrhh_solicitudes_alta;      -- error: no se borra, se cancela
--   update rrhh_eventos set motivo = 'x';   -- error: bitácora inmutable
--
-- ROLLBACK (en este orden; v10_7 debe revertirse antes si está aplicada):
--   drop function if exists public.merchan_rrhh_registrar_alta(jsonb);
--   drop function if exists public.merchan_rrhh_resolver_alta(jsonb);
--   drop function if exists public.merchan_rrhh_solicitar_alta(jsonb);
--   drop table if exists public.rrhh_solicitud_alta_lineas;
--   drop table if exists public.rrhh_solicitudes_alta;
--   drop table if exists public.rrhh_altas;
--   drop table if exists public.rrhh_eventos;
--   drop table if exists public.rrhh_code_counters;
--   drop function if exists public.merchan_next_rrhh_code(text);
--   drop function if exists public.merchan_rrhh_guard_solicitud_alta();
--   drop function if exists public.merchan_rrhh_guard_alta();
--   drop function if exists public.merchan_rrhh_evento_solicitud_alta();
--   drop function if exists public.merchan_rrhh_evento_alta();
--   drop function if exists public.merchan_rrhh_eventos_inmutables();

-- ===========================================================================
-- 1. CONTADOR DE CÓDIGOS
-- ===========================================================================
-- Mismo patrón que v10_3: el contador vive en su propia tabla y NO se deduce de
-- las solicitudes. Si se deduce (max(codigo)+1), vaciar la tabla reutiliza
-- códigos ya publicados y el UNIQUE acaba reventando el alta. Ya pasó con
-- LOG-2026-NNNN; no se repite.
create table if not exists public.rrhh_code_counters (
  scope text primary key,
  last_number integer not null default 0,
  updated_at timestamptz not null default now()
);

comment on table public.rrhh_code_counters is
  'Contador de códigos de RR.HH. por tipo y día (scope = ALT-260731 / ACC-260731). Vive aparte de las solicitudes para que borrarlas no reutilice códigos.';
comment on column public.rrhh_code_counters.scope is 'Prefijo + fecha en hora de Madrid: ALT-260731 o ACC-260731.';
comment on column public.rrhh_code_counters.last_number is 'Último ordinal entregado dentro del scope. Lo reserva de forma atómica merchan_next_rrhh_code.';
comment on column public.rrhh_code_counters.updated_at is 'Última reserva de número en este scope.';

alter table public.rrhh_code_counters enable row level security;
-- Sin políticas A PROPÓSITO: la única mano que toca esta tabla es
-- merchan_next_rrhh_code (SECURITY DEFINER). Con RLS activada y cero policies,
-- nadie más puede leerla ni escribirla, ni siquiera para saber cuántas
-- solicitudes se han creado hoy.
revoke all on table public.rrhh_code_counters from anon, authenticated;

create or replace function public.merchan_next_rrhh_code(p_tipo text)
returns text
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_prefijo text;
  v_scope text;
  v_n integer;
begin
  v_prefijo := case lower(btrim(coalesce(p_tipo, '')))
    when 'alta' then 'ALT'
    when 'acceso' then 'ACC'
    else null
  end;
  if v_prefijo is null then
    raise exception 'Tipo de código de RR.HH. desconocido: "%". Los válidos son "alta" (ALT-AAMMDD-NNN) y "acceso" (ACC-AAMMDD-NNN).',
      coalesce(nullif(p_tipo, ''), '(vacío)');
  end if;

  -- Hora de Madrid: una solicitud de las 00:30 debe llevar la fecha de HOY, no
  -- la de ayer (UTC iría un día por detrás durante el horario de verano).
  v_scope := v_prefijo || '-' || to_char(now() at time zone 'Europe/Madrid', 'YYMMDD');

  -- El upsert reserva el número de forma atómica: dos solicitudes simultáneas
  -- del mismo tipo y día no pueden llevarse el mismo código.
  insert into public.rrhh_code_counters as c (scope, last_number)
  values (v_scope, 1)
  on conflict (scope) do update set last_number = c.last_number + 1, updated_at = now()
  returning c.last_number into v_n;

  -- lpad a 3 NO trunca: pasado el 999 del día el código crece a 4 dígitos.
  return v_scope || '-' || lpad(v_n::text, 3, '0');
end $function$;

-- Sin EXECUTE para authenticated, igual que merchan_next_request_code (v10_3:103).
-- Solo la llaman las RPC SECURITY DEFINER de este mismo fichero, que no
-- necesitan que el permiso lo tenga quien las invoca. Publicarla sería regalar
-- el contador: cualquier autenticado —incluido "almacen", que ni ve el módulo—
-- sabría cuántas solicitudes lleva RR.HH. hoy y, de paso, quemaría ordinales.
revoke all on function public.merchan_next_rrhh_code(text) from public, anon, authenticated;
grant execute on function public.merchan_next_rrhh_code(text) to service_role;

comment on function public.merchan_next_rrhh_code(text) is
  'Código de RR.HH. con formato ALT-AAMMDD-NNN (p_tipo = "alta") o ACC-AAMMDD-NNN (p_tipo = "acceso"). Fecha en hora de Madrid; contador en tabla propia, así que borrar solicitudes no reutiliza códigos.';

-- ---------------------------------------------------------------------------
-- 1.b ¿Puede quien solicita pedir algo PARA ESTE TRABAJADOR?
-- ---------------------------------------------------------------------------
-- Las RPC de solicitud son SECURITY DEFINER: leen workers saltándose la RLS,
-- así que sin esta comprobación una gestora de Barcelona podía pedir el alta de
-- un trabajador de Madrid (bastaba con sacar su worker_id de rrhh_altas, que sí
-- ve) y de paso llevarse su nombre congelado en worker_nombre. RR.HH. y
-- administración tramitan para toda España; la gestora, solo dentro de sus
-- provincias. Un trabajador sin provincia queda visible para todos, igual que
-- en province_scope_all.
create or replace function public.merchan_rrhh_worker_en_ambito(p_worker uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select public.merchan_is_admin()
      or public.merchan_is_rrhh()
      or exists (
           select 1
             from public.workers w
            where w.id = p_worker
              and (w.province is null
                   or public.merchan_norm_province(w.province)
                      = any ((public.merchan_province_scope())::text[])));
$function$;

revoke all on function public.merchan_rrhh_worker_en_ambito(uuid) from public, anon;
grant execute on function public.merchan_rrhh_worker_en_ambito(uuid) to authenticated, service_role;

comment on function public.merchan_rrhh_worker_en_ambito(uuid) is
  'true si quien llama puede solicitar altas o accesos para ese trabajador: admin y rol rrhh siempre; la gestora solo dentro de sus provincias. Se comprueba dentro de las RPC porque son SECURITY DEFINER y no pasan por RLS.';

-- ===========================================================================
-- 2. BITÁCORA DEL MÓDULO (append-only)
-- ===========================================================================
create table if not exists public.rrhh_eventos (
  id uuid primary key default gen_random_uuid(),
  entidad text not null check (entidad in ('alta', 'acceso', 'catalogo')),
  entidad_id uuid,
  evento text not null,
  estado_anterior text,
  estado_nuevo text,
  motivo text,
  actor_id text,
  actor_nombre text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

comment on table public.rrhh_eventos is
  'Bitácora append-only del módulo de RR.HH.: quién cambió qué, cuándo y por qué. La escriben triggers; nadie la edita ni la borra. Es la respuesta a "¿quién dijo que este trabajador ya estaba de alta?".';
comment on column public.rrhh_eventos.entidad is '"alta" (solicitudes y altas laborales), "acceso" (solicitudes de acceso a centro) o "catalogo" (cadenas y centros).';
comment on column public.rrhh_eventos.entidad_id is 'Id de la fila afectada. Sin FK a propósito: el evento sobrevive aunque la fila desaparezca.';
comment on column public.rrhh_eventos.evento is 'Nombre del hecho, p. ej. solicitud.creada, solicitud.estado, alta.creada, alta.modificada.';
comment on column public.rrhh_eventos.estado_anterior is 'Estado antes del cambio. NULL en las creaciones.';
comment on column public.rrhh_eventos.estado_nuevo is 'Estado después del cambio.';
comment on column public.rrhh_eventos.motivo is 'Motivo escrito por la persona. Obligatorio en los cierres en negativo (rechazada, cancelada).';
comment on column public.rrhh_eventos.actor_id is 'app_users.id de quien provocó el cambio. Sin FK: la bitácora no puede depender de que el usuario siga existiendo.';
comment on column public.rrhh_eventos.actor_nombre is 'Nombre visible del actor en el momento del hecho (usuario interno, no el trabajador).';
comment on column public.rrhh_eventos.payload is 'Detalle del hecho. Solo identificadores y estados: nunca datos personales del trabajador.';
comment on column public.rrhh_eventos.created_at is 'Momento del hecho.';

create index if not exists idx_rrhh_eventos_entidad on public.rrhh_eventos (entidad, entidad_id, created_at desc);
create index if not exists idx_rrhh_eventos_created on public.rrhh_eventos (created_at desc);

alter table public.rrhh_eventos enable row level security;
-- v9_2 dejó a anon con CERO privilegios sobre tablas y esa línea no se cruza:
-- las tablas nuevas nacen abiertas a anon por los privilegios por defecto de
-- Supabase, así que hay que revocarlo explícitamente en cada una.
revoke all on table public.rrhh_eventos from anon;
-- Solo SELECT para authenticated: los INSERT los hacen triggers SECURITY
-- DEFINER, que no necesitan este grant, y así ni siquiera hay que confiar en
-- que no exista una policy de escritura.
grant select on public.rrhh_eventos to authenticated;
grant select, insert on public.rrhh_eventos to service_role;

-- Función de TRIGGER: sin grant de EXECUTE (v9_9/v9_10: los triggers no
-- consultan EXECUTE y concederlo solo las publica como RPC sin motivo).
create or replace function public.merchan_rrhh_eventos_inmutables()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  raise exception 'La bitácora de RR.HH. es inmutable: no se puede hacer % sobre rrhh_eventos. Si un dato está mal, corrige la fila de origen y quedará un evento nuevo.', tg_op;
end $function$;

revoke all on function public.merchan_rrhh_eventos_inmutables() from public, anon, authenticated;

comment on function public.merchan_rrhh_eventos_inmutables() is
  'Trigger que prohíbe UPDATE y DELETE sobre rrhh_eventos. La bitácora solo crece.';

drop trigger if exists trg_rrhh_eventos_inmutables on public.rrhh_eventos;
create trigger trg_rrhh_eventos_inmutables
  before update or delete on public.rrhh_eventos
  for each row execute function public.merchan_rrhh_eventos_inmutables();

-- Solo admin y RR.HH. leen la bitácora: contiene los motivos de los rechazos.
drop policy if exists rrhh_eventos_read on public.rrhh_eventos;
create policy rrhh_eventos_read on public.rrhh_eventos
  for select to authenticated
  using ((select public.merchan_is_admin()) or (select public.merchan_is_rrhh()));
-- Sin policy de escritura para nadie: las filas las ponen los triggers
-- (SECURITY DEFINER, propietario de la tabla, así que no pasan por RLS).

-- ===========================================================================
-- 3. ALTAS LABORALES REALES (el espejo de A3)
-- ===========================================================================
create table if not exists public.rrhh_altas (
  id uuid primary key default gen_random_uuid(),
  worker_id uuid not null references public.workers(id) on delete cascade,
  numero_alta text,
  tipo text not null default 'temporal' check (tipo in ('temporal', 'indefinido', 'fijo_discontinuo')),
  fecha_inicio date not null,
  fecha_fin date,
  ceco text,
  horas_dia numeric,
  estado text not null default 'vigente' check (estado in ('vigente', 'ampliada', 'baja_pendiente', 'baja', 'anulada')),
  origen text not null default 'manual' check (origen in ('manual', 'solicitud', 'import')),
  created_at timestamptz not null default now(),
  created_by text references public.app_users(id) on delete set null,
  created_by_nombre text,
  updated_at timestamptz not null default now(),
  version integer not null default 1,
  constraint rrhh_altas_fechas_coherentes check (fecha_fin is null or fecha_fin >= fecha_inicio)
);

comment on table public.rrhh_altas is
  'Altas laborales REALES, tal y como están en A3. Es la tabla contra la que se calcula la cobertura de un trabajo ("cubierto", "se solapa", "alta nueva"). NO contiene datos personales: solo número de alta, tipo de contrato, fechas, CECO, horas/día y estado (decisión D2).';
comment on column public.rrhh_altas.worker_id is 'Trabajador de MerchanOps. ON DELETE CASCADE: si el trabajador desaparece del sistema, su espejo de altas deja de tener sentido (en la práctica el borrado lo bloquea antes rrhh_solicitudes_alta.worker_id, que no cascadea).';
comment on column public.rrhh_altas.numero_alta is 'El "18832" del diseño: número que devuelve A3. NULL mientras RR.HH. no lo haya tecleado.';
comment on column public.rrhh_altas.tipo is 'Tipo de contrato. Espejo de TipoAlta en lib/rrhh/tipos.ts.';
comment on column public.rrhh_altas.fecha_inicio is 'Primer día cubierto por el alta.';
comment on column public.rrhh_altas.fecha_fin is 'Último día cubierto. NULL = alta abierta (indefinida o sin fecha de fin conocida).';
comment on column public.rrhh_altas.ceco is 'Centro de coste al que se imputa el alta.';
comment on column public.rrhh_altas.horas_dia is 'Horas por día contratadas.';
comment on column public.rrhh_altas.estado is 'Espejo de EstadoAlta en lib/rrhh/tipos.ts: vigente, ampliada, baja_pendiente, baja, anulada.';
comment on column public.rrhh_altas.origen is '"manual" = la tecleó RR.HH.; "solicitud" = nació de resolver una solicitud; "import" = vino de una carga masiva.';
comment on column public.rrhh_altas.created_by is 'app_users.id de quien la registró.';
comment on column public.rrhh_altas.created_by_nombre is 'Nombre visible de quien la registró, congelado en el momento del alta.';
comment on column public.rrhh_altas.version is 'Contador optimista: sube en cada UPDATE (trigger merchan_rrhh_guard_alta). Quien leyó una versión anterior lo detecta al comparar.';

create index if not exists idx_rrhh_altas_worker on public.rrhh_altas (worker_id, fecha_inicio desc);
create index if not exists idx_rrhh_altas_estado on public.rrhh_altas (estado);
create index if not exists idx_rrhh_altas_numero on public.rrhh_altas (numero_alta) where numero_alta is not null;
create index if not exists idx_rrhh_altas_rango on public.rrhh_altas (worker_id, fecha_inicio, fecha_fin);

alter table public.rrhh_altas enable row level security;
revoke all on table public.rrhh_altas from anon;
grant select, insert, update, delete on public.rrhh_altas to authenticated, service_role;

-- Lectura: cualquiera que entre al módulo. Aquí SÍ es correcto usar
-- merchan_can_rrhh() (incluye a las gestoras) porque es una tabla del propio
-- módulo: sin poder leer las altas, la pantalla no puede calcular el texto gris
-- y la gestora tendría que preguntar por WhatsApp, que es justo lo que se
-- quiere eliminar. Ver el aviso largo de v10_4 sobre este helper.
drop policy if exists rrhh_altas_read on public.rrhh_altas;
create policy rrhh_altas_read on public.rrhh_altas
  for select to authenticated
  using ((select public.merchan_can_rrhh()));

-- Escritura: solo quien tramita. El ROL, no el permiso.
drop policy if exists rrhh_altas_write on public.rrhh_altas;
create policy rrhh_altas_write on public.rrhh_altas
  for all to authenticated
  using ((select public.merchan_is_admin()) or (select public.merchan_is_rrhh()))
  with check ((select public.merchan_is_admin()) or (select public.merchan_is_rrhh()));

create or replace function public.merchan_rrhh_guard_alta()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if new.worker_id is distinct from old.worker_id then
    raise exception 'Un alta no cambia de trabajador. Anula el alta % y registra otra.', coalesce(old.numero_alta, old.id::text);
  end if;
  new.created_at := old.created_at;
  new.version := old.version + 1;
  new.updated_at := now();
  return new;
end $function$;

revoke all on function public.merchan_rrhh_guard_alta() from public, anon, authenticated;

comment on function public.merchan_rrhh_guard_alta() is
  'Trigger BEFORE UPDATE de rrhh_altas: el trabajador y la fecha de creación son inmutables, y la versión sube en cada cambio (bloqueo optimista).';

drop trigger if exists trg_rrhh_altas_guard on public.rrhh_altas;
create trigger trg_rrhh_altas_guard
  before update on public.rrhh_altas
  for each row execute function public.merchan_rrhh_guard_alta();

create or replace function public.merchan_rrhh_evento_alta()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if tg_op = 'INSERT' then
    insert into public.rrhh_eventos (entidad, entidad_id, evento, estado_anterior, estado_nuevo, actor_id, actor_nombre, payload)
    values ('alta', new.id, 'alta.creada', null, new.estado, new.created_by, new.created_by_nombre,
            jsonb_build_object('worker_id', new.worker_id, 'numero_alta', new.numero_alta,
                               'tipo', new.tipo, 'origen', new.origen,
                               'fecha_inicio', new.fecha_inicio, 'fecha_fin', new.fecha_fin));
  elsif new is distinct from old then
    insert into public.rrhh_eventos (entidad, entidad_id, evento, estado_anterior, estado_nuevo, actor_id, actor_nombre, payload)
    values ('alta', new.id, 'alta.modificada', old.estado, new.estado, public.merchan_my_app_user_id(),
            (select u.display_name from public.app_users u where u.id = public.merchan_my_app_user_id()),
            jsonb_build_object('worker_id', new.worker_id, 'numero_alta', new.numero_alta,
                               'fecha_inicio', new.fecha_inicio, 'fecha_fin', new.fecha_fin,
                               'version', new.version));
  end if;
  return null;
end $function$;

revoke all on function public.merchan_rrhh_evento_alta() from public, anon, authenticated;

comment on function public.merchan_rrhh_evento_alta() is
  'Trigger AFTER de rrhh_altas que deja el rastro en rrhh_eventos. SECURITY DEFINER para poder escribir en una tabla que no tiene policy de INSERT.';

drop trigger if exists trg_rrhh_altas_evento on public.rrhh_altas;
create trigger trg_rrhh_altas_evento
  after insert or update on public.rrhh_altas
  for each row execute function public.merchan_rrhh_evento_alta();

-- ===========================================================================
-- 4. SOLICITUDES DE ALTA
-- ===========================================================================
create table if not exists public.rrhh_solicitudes_alta (
  id uuid primary key default gen_random_uuid(),
  codigo text not null unique,
  worker_id uuid not null references public.workers(id),
  worker_nombre text,
  fecha_inicio date,
  fecha_fin date,
  horas_dia numeric,
  resolucion_sistema text check (resolucion_sistema in ('alta_nueva', 'cubierta', 'solape')),
  resolucion_detalle text,
  alta_referencia_id uuid references public.rrhh_altas(id) on delete set null,
  alta_referencia_numero text,
  estado text not null default 'pendiente' check (estado in (
    'pendiente', 'se_solapa', 'ya_alta_indefinida', 'solo_imputacion',
    'tramitada', 'alta_online', 'baja_pendiente', 'rechazada', 'cancelada')),
  a3_numero text,
  a3_canal text not null default 'manual' check (a3_canal in ('manual', 'api')),
  a3_estado text,
  a3_last_sync_at timestamptz,
  a3_sync_event_id text,
  a3_last_error text,
  alta_id uuid references public.rrhh_altas(id) on delete set null,
  solicitada_por text references public.app_users(id) on delete set null,
  solicitada_por_nombre text,
  motivo text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1
);

comment on table public.rrhh_solicitudes_alta is
  'Cabecera de una solicitud de alta: el "Tramitar" de la pantalla de Altas laborales. La crea la gestora (solo vía merchan_rrhh_solicitar_alta) y la resuelve RR.HH. Los estados y sus transiciones son el espejo exacto de transicionesSolicitudAlta en lib/rrhh/tipos.ts.';
comment on column public.rrhh_solicitudes_alta.codigo is 'ALT-AAMMDD-NNN. Inmutable. Es el "Sol." de la tabla "Cola de altas".';
comment on column public.rrhh_solicitudes_alta.worker_id is 'Trabajador. Sin ON DELETE: una solicitud es un registro de lo que se pidió, así que impide borrar al trabajador mientras exista.';
comment on column public.rrhh_solicitudes_alta.worker_nombre is 'Nombre del trabajador congelado en el momento de solicitar, para que la cola siga siendo legible si cambia la ficha.';
comment on column public.rrhh_solicitudes_alta.fecha_inicio is 'Primer día del periodo solicitado. Si no se envía, lo calcula el RPC como el mínimo de las líneas.';
comment on column public.rrhh_solicitudes_alta.fecha_fin is 'Último día del periodo solicitado. Si no se envía, lo calcula el RPC como el máximo de las líneas.';
comment on column public.rrhh_solicitudes_alta.horas_dia is 'Horas/día del periodo solicitado.';
comment on column public.rrhh_solicitudes_alta.resolucion_sistema is
  'Lo que CALCULÓ el sistema al marcar los trabajos: alta_nueva, cubierta o solape. Espejo de ResolucionAlta. Nunca lo teclea nadie.';
comment on column public.rrhh_solicitudes_alta.resolucion_detalle is
  'El "texto gris" literal que vio la gestora al tramitar ("Se solapa con el alta 18832 (20/07 → 29/07) · ampliar hasta el 31/07"). Se guarda para poder auditar qué se le enseñó, aunque las altas cambien después.';
comment on column public.rrhh_solicitudes_alta.alta_referencia_id is 'Alta contra la que se calculó la cobertura o el solape.';
comment on column public.rrhh_solicitudes_alta.alta_referencia_numero is 'Número de esa alta congelado ("18832"), para que el texto siga teniendo sentido si el alta se anula.';
comment on column public.rrhh_solicitudes_alta.estado is 'Columna "Estado" del diseño: la rellena RR.HH. Las transiciones las impone merchan_rrhh_guard_solicitud_alta.';
comment on column public.rrhh_solicitudes_alta.a3_numero is 'Columna "A3" del diseño: la teclea RR.HH. (decisión D6, integración manual desde el día uno).';
comment on column public.rrhh_solicitudes_alta.a3_canal is 'Por dónde viajó a A3: "manual" hoy, "api" el día que exista el adaptador. El esquema no cambiará entonces.';
comment on column public.rrhh_solicitudes_alta.a3_estado is 'Estado que devuelve A3, tal cual. Texto libre a propósito: no se modela un vocabulario ajeno que todavía no se conoce.';
comment on column public.rrhh_solicitudes_alta.a3_last_sync_at is 'Última vez que se sincronizó con A3 (a mano o por API).';
comment on column public.rrhh_solicitudes_alta.a3_sync_event_id is 'Identificador del evento de sincronización, para casar con el outbox cuando exista el adaptador.';
comment on column public.rrhh_solicitudes_alta.a3_last_error is 'Último error devuelto por A3. Visible, nunca silencioso.';
comment on column public.rrhh_solicitudes_alta.alta_id is 'Alta real creada al resolver esta solicitud, si se creó alguna.';
comment on column public.rrhh_solicitudes_alta.solicitada_por is 'app_users.id de la gestora. Es la clave de la RLS: cada gestora ve SUS solicitudes.';
comment on column public.rrhh_solicitudes_alta.solicitada_por_nombre is 'Columna "Gestora" de la cola, congelada.';
comment on column public.rrhh_solicitudes_alta.motivo is 'Obligatorio para dejar la solicitud en "rechazada" o "cancelada": nada se cierra en negativo sin explicación.';
comment on column public.rrhh_solicitudes_alta.version is 'Contador optimista: sube en cada UPDATE. Los RPC comparan contra él para detectar ediciones simultáneas.';

create index if not exists idx_rrhh_sol_alta_worker on public.rrhh_solicitudes_alta (worker_id);
create index if not exists idx_rrhh_sol_alta_estado on public.rrhh_solicitudes_alta (estado);
create index if not exists idx_rrhh_sol_alta_solicitante on public.rrhh_solicitudes_alta (solicitada_por);
create index if not exists idx_rrhh_sol_alta_created on public.rrhh_solicitudes_alta (created_at desc);
create index if not exists idx_rrhh_sol_alta_alta on public.rrhh_solicitudes_alta (alta_id) where alta_id is not null;

create table if not exists public.rrhh_solicitud_alta_lineas (
  id uuid primary key default gen_random_uuid(),
  solicitud_id uuid not null references public.rrhh_solicitudes_alta(id) on delete cascade,
  origen_tipo text not null check (origen_tipo in ('campana', 'campana_punto', 'servicio')),
  origen_id text not null,
  campana text,
  ceco text,
  fecha_inicio date,
  fecha_fin date,
  horas_dia numeric,
  unique (solicitud_id, origen_tipo, origen_id)
);

comment on table public.rrhh_solicitud_alta_lineas is
  'Cada imputación de una solicitud de alta: es el "2 imputaciones a 3005, 3136" del texto gris. El UNIQUE impide marcar dos veces el mismo trabajo en la misma solicitud.';
comment on column public.rrhh_solicitud_alta_lineas.origen_tipo is 'Enlace polimórfico (decisión D1): "campana" (gran campaña), "campana_punto" (punto de campaña) o "servicio". Espejo de OrigenTrabajoTipo.';
comment on column public.rrhh_solicitud_alta_lineas.origen_id is 'Id de la fila de origen, como texto porque las tres tablas no comparten tipo de clave. Sin FK: el enlace es polimórfico y el trabajo original puede archivarse.';
comment on column public.rrhh_solicitud_alta_lineas.campana is 'Nombre de la campaña o del servicio, congelado para que la cola se lea sin ir a buscarlo.';
comment on column public.rrhh_solicitud_alta_lineas.ceco is 'CECO al que imputa esta línea. Se hereda de grandes_campanas.ceco (v10_5) y es editable por línea (decisión D3).';
comment on column public.rrhh_solicitud_alta_lineas.fecha_inicio is 'Primer día de este trabajo concreto.';
comment on column public.rrhh_solicitud_alta_lineas.fecha_fin is 'Último día de este trabajo concreto.';
comment on column public.rrhh_solicitud_alta_lineas.horas_dia is 'Horas/día de este trabajo. Se hereda de la campaña y es editable por línea.';

create index if not exists idx_rrhh_sol_alta_lineas_sol on public.rrhh_solicitud_alta_lineas (solicitud_id);
create index if not exists idx_rrhh_sol_alta_lineas_origen on public.rrhh_solicitud_alta_lineas (origen_tipo, origen_id);

alter table public.rrhh_solicitudes_alta enable row level security;
alter table public.rrhh_solicitud_alta_lineas enable row level security;
revoke all on table public.rrhh_solicitudes_alta from anon;
revoke all on table public.rrhh_solicitud_alta_lineas from anon;
grant select, insert, update, delete on public.rrhh_solicitudes_alta to authenticated, service_role;
grant select, insert, update, delete on public.rrhh_solicitud_alta_lineas to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4.1 Guardián de transiciones, motivo y versión
-- ---------------------------------------------------------------------------
-- Copia literal de `transicionesSolicitudAlta` (lib/rrhh/tipos.ts). Si allí se
-- añade un estado o una transición, hay que tocarlo también AQUÍ: la UI
-- propone, la base decide.
create or replace function public.merchan_rrhh_guard_solicitud_alta()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_permitidas text[];
begin
  if tg_op = 'DELETE' then
    raise exception 'Una solicitud de alta no se borra: déjala en "cancelada" con motivo. Solicitud %.', old.codigo;
  end if;

  if new.codigo is distinct from old.codigo then
    raise exception 'El código de una solicitud de alta es inmutable (%). No se renumera lo que ya se ha dicho por teléfono.', old.codigo;
  end if;
  if new.worker_id is distinct from old.worker_id then
    raise exception 'La solicitud % no puede cambiar de trabajador. Cancélala con motivo y crea otra.', old.codigo;
  end if;
  new.created_at := old.created_at;
  new.solicitada_por := old.solicitada_por;

  if new.estado is distinct from old.estado then
    v_permitidas := case old.estado
      when 'pendiente'          then array['tramitada', 'alta_online', 'se_solapa', 'ya_alta_indefinida', 'solo_imputacion', 'rechazada', 'cancelada']
      when 'se_solapa'          then array['tramitada', 'alta_online', 'solo_imputacion', 'rechazada', 'cancelada']
      when 'ya_alta_indefinida' then array['solo_imputacion', 'tramitada', 'rechazada', 'cancelada']
      when 'solo_imputacion'    then array['tramitada', 'rechazada', 'cancelada']
      when 'tramitada'          then array['baja_pendiente', 'cancelada']
      when 'alta_online'        then array['tramitada', 'baja_pendiente', 'cancelada']
      when 'baja_pendiente'     then array['tramitada', 'cancelada']
      else array[]::text[]
    end;

    if not (new.estado = any (v_permitidas)) then
      raise exception 'Transición no permitida en la solicitud %: de "%" a "%". Desde "%" solo se puede pasar a: %.',
        old.codigo, old.estado, new.estado, old.estado,
        coalesce(nullif(array_to_string(v_permitidas, ', '), ''), 'ningún estado (es final)');
    end if;

    if new.estado in ('rechazada', 'cancelada') and coalesce(btrim(new.motivo), '') = '' then
      raise exception 'Para dejar la solicitud % en "%" hace falta un motivo escrito: nada se cierra en negativo sin explicación.',
        old.codigo, new.estado;
    end if;
  end if;

  -- Bloqueo optimista: la versión sube SIEMPRE, en cualquier UPDATE. Quien haya
  -- leído una versión anterior lo detecta al comparar en el RPC.
  new.version := old.version + 1;
  new.updated_at := now();
  return new;
end $function$;

revoke all on function public.merchan_rrhh_guard_solicitud_alta() from public, anon, authenticated;

comment on function public.merchan_rrhh_guard_solicitud_alta() is
  'Trigger BEFORE UPDATE OR DELETE de rrhh_solicitudes_alta: impone las transiciones de transicionesSolicitudAlta (lib/rrhh/tipos.ts), exige motivo en "rechazada" y "cancelada", prohíbe el borrado y sube la versión (bloqueo optimista).';

drop trigger if exists trg_rrhh_sol_alta_guard on public.rrhh_solicitudes_alta;
create trigger trg_rrhh_sol_alta_guard
  before update or delete on public.rrhh_solicitudes_alta
  for each row execute function public.merchan_rrhh_guard_solicitud_alta();

create or replace function public.merchan_rrhh_evento_solicitud_alta()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if tg_op = 'INSERT' then
    insert into public.rrhh_eventos (entidad, entidad_id, evento, estado_anterior, estado_nuevo, motivo, actor_id, actor_nombre, payload)
    values ('alta', new.id, 'solicitud.creada', null, new.estado, new.motivo, new.solicitada_por, new.solicitada_por_nombre,
            jsonb_build_object('codigo', new.codigo, 'worker_id', new.worker_id,
                               'resolucion_sistema', new.resolucion_sistema,
                               'fecha_inicio', new.fecha_inicio, 'fecha_fin', new.fecha_fin));
  elsif new.estado is distinct from old.estado
     or new.a3_numero is distinct from old.a3_numero
     or new.alta_id is distinct from old.alta_id then
    insert into public.rrhh_eventos (entidad, entidad_id, evento, estado_anterior, estado_nuevo, motivo, actor_id, actor_nombre, payload)
    values ('alta', new.id,
            case when new.estado is distinct from old.estado then 'solicitud.estado' else 'solicitud.a3' end,
            old.estado, new.estado, new.motivo, public.merchan_my_app_user_id(),
            (select u.display_name from public.app_users u where u.id = public.merchan_my_app_user_id()),
            jsonb_build_object('codigo', new.codigo, 'a3_numero', new.a3_numero,
                               'a3_canal', new.a3_canal, 'alta_id', new.alta_id,
                               'version', new.version));
  end if;
  return null;
end $function$;

revoke all on function public.merchan_rrhh_evento_solicitud_alta() from public, anon, authenticated;

comment on function public.merchan_rrhh_evento_solicitud_alta() is
  'Trigger AFTER de rrhh_solicitudes_alta que deja el rastro en rrhh_eventos (creación, cambio de estado y cambio de A3).';

drop trigger if exists trg_rrhh_sol_alta_evento on public.rrhh_solicitudes_alta;
create trigger trg_rrhh_sol_alta_evento
  after insert or update on public.rrhh_solicitudes_alta
  for each row execute function public.merchan_rrhh_evento_solicitud_alta();

-- ---------------------------------------------------------------------------
-- 4.2 RLS
-- ---------------------------------------------------------------------------
-- SELECT: administración, RR.HH. y la gestora que la pidió. Nadie más ve las
-- solicitudes de los trabajadores de otra.
drop policy if exists rrhh_sol_alta_read on public.rrhh_solicitudes_alta;
create policy rrhh_sol_alta_read on public.rrhh_solicitudes_alta
  for select to authenticated
  using (
    (select public.merchan_is_admin())
    or (select public.merchan_is_rrhh())
    or solicitada_por = (select public.merchan_my_app_user_id())
  );

-- UPDATE: solo quien tramita. Cambiar el estado, teclear el número de A3 o
-- enlazar el alta real NO es cosa de la gestora, aunque la solicitud sea suya.
drop policy if exists rrhh_sol_alta_write on public.rrhh_solicitudes_alta;
create policy rrhh_sol_alta_write on public.rrhh_solicitudes_alta
  for update to authenticated
  using ((select public.merchan_is_admin()) or (select public.merchan_is_rrhh()))
  with check ((select public.merchan_is_admin()) or (select public.merchan_is_rrhh()));

-- SIN policy de INSERT para NADIE, ni siquiera para admin: la única puerta es
-- merchan_rrhh_solicitar_alta, que es SECURITY DEFINER (y por tanto no pasa por
-- RLS), valida permisos por dentro y garantiza que la cabecera nunca nazca sin
-- código, sin líneas o sin solicitante. Un INSERT directo por REST se saltaría
-- las tres cosas.
-- SIN policy de DELETE: el guardián lo prohíbe igualmente, con un mensaje que
-- explica qué hacer en su lugar.

drop policy if exists rrhh_sol_alta_lineas_read on public.rrhh_solicitud_alta_lineas;
create policy rrhh_sol_alta_lineas_read on public.rrhh_solicitud_alta_lineas
  for select to authenticated
  using (
    (select public.merchan_is_admin())
    or (select public.merchan_is_rrhh())
    or exists (
      select 1 from public.rrhh_solicitudes_alta s
       where s.id = rrhh_solicitud_alta_lineas.solicitud_id
         and s.solicitada_por = (select public.merchan_my_app_user_id())
    )
  );

drop policy if exists rrhh_sol_alta_lineas_write on public.rrhh_solicitud_alta_lineas;
create policy rrhh_sol_alta_lineas_write on public.rrhh_solicitud_alta_lineas
  for all to authenticated
  using ((select public.merchan_is_admin()) or (select public.merchan_is_rrhh()))
  with check ((select public.merchan_is_admin()) or (select public.merchan_is_rrhh()));

-- ---------------------------------------------------------------------------
-- 4.3 Qué trabajos están YA pedidos (para no ofrecerlos dos veces)
-- ---------------------------------------------------------------------------
-- La pantalla necesita saber qué orígenes tienen ya una solicitud VIVA para no
-- volver a ofrecerlos. Consultar rrhh_solicitud_alta_lineas directamente no
-- sirve por dos motivos, y los dos dan el mismo fallo silencioso:
--   1. La policy de lectura solo enseña a la gestora SUS líneas, así que no vería
--      lo que ya pidió una compañera y el mismo punto se solicitaría dos veces.
--   2. Una solicitud rechazada o cancelada dejaría el trabajo escondido PARA
--      SIEMPRE: las líneas no se borran nunca (el guardián prohíbe el DELETE),
--      así que el trabajo nunca volvería a la lista de pendientes aunque siga
--      asignado y sin alta.
-- Esta función, SECURITY DEFINER, contesta las dos cosas bien: mira todas las
-- solicitudes del trabajador y descuenta las que murieron.
create or replace function public.merchan_rrhh_origenes_solicitados(p_worker uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $function$
declare
  v_out jsonb;
begin
  if not public.merchan_can_rrhh() then
    raise exception 'No tienes acceso al módulo de RR.HH.'
      using errcode = '42501';
  end if;

  select coalesce(jsonb_agg(distinct l.origen_tipo || ':' || l.origen_id), '[]'::jsonb)
    into v_out
    from public.rrhh_solicitud_alta_lineas l
    join public.rrhh_solicitudes_alta s on s.id = l.solicitud_id
   where s.worker_id = p_worker
     and s.estado not in ('rechazada', 'cancelada');

  return v_out;
end $function$;

revoke all on function public.merchan_rrhh_origenes_solicitados(uuid) from public, anon;
grant execute on function public.merchan_rrhh_origenes_solicitados(uuid) to authenticated, service_role;

comment on function public.merchan_rrhh_origenes_solicitados(uuid) is
  'Devuelve ["origen_tipo:origen_id", ...] de los trabajos de ese trabajador que ya tienen una solicitud de alta viva (ni rechazada ni cancelada). SECURITY DEFINER a propósito: la gestora no ve las solicitudes ajenas, pero tampoco debe volver a pedir lo que otra ya pidió.';

-- ===========================================================================
-- 5. RPC · SOLICITAR
-- ===========================================================================
-- Payload esperado:
-- {
--   "worker_id": "uuid",                        (obligatorio)
--   "worker_nombre": "texto",                   (opcional: si falta, de workers)
--   "fecha_inicio": "2026-07-28",               (opcional: mínimo de las líneas)
--   "fecha_fin": "2026-07-31",                  (opcional: máximo de las líneas)
--   "horas_dia": 6,                             (opcional)
--   "resolucion_sistema": "alta_nueva|cubierta|solape",
--   "resolucion_detalle": "texto gris literal",
--   "alta_referencia_id": "uuid",               (opcional)
--   "alta_referencia_numero": "18832",          (opcional)
--   "estado": "pendiente|se_solapa|ya_alta_indefinida",  (opcional)
--   "motivo": "texto",                          (opcional)
--   "lineas": [ { "origen_tipo": "campana|campana_punto|servicio",
--                 "origen_id": "...", "campana": "...", "ceco": "3005",
--                 "fecha_inicio": "...", "fecha_fin": "...", "horas_dia": 6 } ]
-- }
-- Devuelve {"solicitud_id": uuid, "codigo": "ALT-260731-001", "estado": ...,
--           "lineas": n, "fecha_inicio": ..., "fecha_fin": ...}.
create or replace function public.merchan_rrhh_solicitar_alta(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_actor text;
  v_actor_nombre text;
  v_worker uuid;
  v_worker_nombre text;
  v_lineas jsonb;
  v_linea jsonb;
  v_resolucion text;
  v_estado text;
  v_codigo text;
  v_id uuid;
  v_fi date;
  v_ff date;
  v_horas numeric;
  v_n integer := 0;
  v_ins integer;
begin
  -- La RPC es SECURITY DEFINER, así que no pasa por RLS: el permiso se
  -- comprueba AQUÍ o no se comprueba en ninguna parte.
  if not public.merchan_can_rrhh() then
    raise exception 'No tienes acceso al módulo de RR.HH.: no puedes solicitar altas.'
      using errcode = '42501';
  end if;

  v_worker := nullif(btrim(p_payload ->> 'worker_id'), '')::uuid;
  if v_worker is null then
    raise exception 'Falta el trabajador (worker_id) en la solicitud de alta.';
  end if;
  select w.name into v_worker_nombre from public.workers w where w.id = v_worker;
  if v_worker_nombre is null then
    raise exception 'El trabajador % no existe en MerchanOps.', v_worker;
  end if;
  if not public.merchan_rrhh_worker_en_ambito(v_worker) then
    raise exception 'Ese trabajador no está en tus provincias: no puedes solicitar su alta. Pídeselo a RR.HH. o a administración.'
      using errcode = '42501';
  end if;

  v_lineas := coalesce(p_payload -> 'lineas', '[]'::jsonb);
  if jsonb_typeof(v_lineas) <> 'array' or jsonb_array_length(v_lineas) = 0 then
    raise exception 'Una solicitud de alta necesita al menos un trabajo marcado (campo "lineas").';
  end if;

  -- El periodo se deduce de los trabajos marcados salvo que venga dicho.
  select min(nullif(btrim(l.item ->> 'fecha_inicio'), '')::date),
         max(nullif(btrim(l.item ->> 'fecha_fin'), '')::date),
         max(nullif(btrim(l.item ->> 'horas_dia'), '')::numeric)
    into v_fi, v_ff, v_horas
    from jsonb_array_elements(v_lineas) as l(item);

  v_fi := coalesce(nullif(btrim(p_payload ->> 'fecha_inicio'), '')::date, v_fi);
  v_ff := coalesce(nullif(btrim(p_payload ->> 'fecha_fin'), '')::date, v_ff);
  v_horas := coalesce(nullif(btrim(p_payload ->> 'horas_dia'), '')::numeric, v_horas);

  if v_fi is not null and v_ff is not null and v_ff < v_fi then
    raise exception 'El periodo solicitado está del revés: la fecha de fin (%) es anterior a la de inicio (%).', v_ff, v_fi;
  end if;

  v_resolucion := nullif(btrim(p_payload ->> 'resolucion_sistema'), '');
  if v_resolucion is not null and v_resolucion not in ('alta_nueva', 'cubierta', 'solape') then
    raise exception 'resolucion_sistema inválida: "%". Los valores son alta_nueva, cubierta y solape.', v_resolucion;
  end if;

  -- Estado inicial: lo PROPONE el sistema a partir de la resolución, nunca lo
  -- elige quien solicita. Una cobertura se desdobla en dos estados distintos
  -- porque en la cola significan cosas distintas: si el alta que cubre el
  -- periodo es INDEFINIDA la fila es "Ya de alta indef."; si es temporal o fija
  -- discontinua, el trabajo solo necesita la imputación al CECO ("Solo
  -- imputación"). Es la misma tabla que aplica estadoSugerido() en
  -- lib/rrhh/altas.ts: si aquí y allí no dicen lo mismo, la cola miente.
  v_estado := nullif(btrim(p_payload ->> 'estado'), '');
  if v_estado is null then
    v_estado := case
      when v_resolucion = 'solape' then 'se_solapa'
      when v_resolucion = 'cubierta' then
        case
          when (select a.tipo from public.rrhh_altas a
                 where a.id = nullif(btrim(p_payload ->> 'alta_referencia_id'), '')::uuid) = 'indefinido'
            then 'ya_alta_indefinida'
          else 'solo_imputacion'
        end
      else 'pendiente'
    end;
  elsif v_estado not in ('pendiente', 'se_solapa', 'ya_alta_indefinida', 'solo_imputacion') then
    raise exception 'Una solicitud nace en "pendiente", "se_solapa", "ya_alta_indefinida" o "solo_imputacion" (lo propone el sistema según la resolución). "%" es una decisión de RR.HH. y se aplica después con merchan_rrhh_resolver_alta.', v_estado;
  end if;

  v_actor := public.merchan_my_app_user_id();
  select u.display_name into v_actor_nombre from public.app_users u where u.id = v_actor;
  v_actor_nombre := coalesce(nullif(btrim(p_payload ->> 'solicitada_por_nombre'), ''), v_actor_nombre);

  v_codigo := public.merchan_next_rrhh_code('alta');

  insert into public.rrhh_solicitudes_alta (
    codigo, worker_id, worker_nombre, fecha_inicio, fecha_fin, horas_dia,
    resolucion_sistema, resolucion_detalle, alta_referencia_id, alta_referencia_numero,
    estado, solicitada_por, solicitada_por_nombre, motivo
  ) values (
    v_codigo, v_worker,
    coalesce(nullif(btrim(p_payload ->> 'worker_nombre'), ''), v_worker_nombre),
    v_fi, v_ff, v_horas,
    v_resolucion,
    nullif(btrim(p_payload ->> 'resolucion_detalle'), ''),
    nullif(btrim(p_payload ->> 'alta_referencia_id'), '')::uuid,
    nullif(btrim(p_payload ->> 'alta_referencia_numero'), ''),
    v_estado, v_actor, v_actor_nombre,
    nullif(btrim(p_payload ->> 'motivo'), '')
  ) returning id into v_id;

  for v_linea in select l.item from jsonb_array_elements(v_lineas) as l(item)
  loop
    if coalesce(btrim(v_linea ->> 'origen_tipo'), '') not in ('campana', 'campana_punto', 'servicio') then
      raise exception 'origen_tipo inválido en una línea de la solicitud %: "%". Los valores son campana, campana_punto y servicio.',
        v_codigo, coalesce(nullif(btrim(v_linea ->> 'origen_tipo'), ''), '(vacío)');
    end if;
    if coalesce(btrim(v_linea ->> 'origen_id'), '') = '' then
      raise exception 'Falta origen_id en una línea de la solicitud %: no se puede imputar a un trabajo sin identificar.', v_codigo;
    end if;

    insert into public.rrhh_solicitud_alta_lineas (
      solicitud_id, origen_tipo, origen_id, campana, ceco, fecha_inicio, fecha_fin, horas_dia
    ) values (
      v_id,
      btrim(v_linea ->> 'origen_tipo'),
      btrim(v_linea ->> 'origen_id'),
      nullif(btrim(v_linea ->> 'campana'), ''),
      nullif(btrim(v_linea ->> 'ceco'), ''),
      nullif(btrim(v_linea ->> 'fecha_inicio'), '')::date,
      nullif(btrim(v_linea ->> 'fecha_fin'), '')::date,
      nullif(btrim(v_linea ->> 'horas_dia'), '')::numeric
    )
    on conflict (solicitud_id, origen_tipo, origen_id) do nothing;

    get diagnostics v_ins = row_count;
    v_n := v_n + v_ins;
  end loop;

  if v_n = 0 then
    raise exception 'La solicitud % se quedó sin líneas: todos los trabajos marcados estaban repetidos.', v_codigo;
  end if;

  -- Outbox: SOLO identificadores. Ni el nombre del trabajador, ni el de la
  -- gestora, ni ningún dato personal: el evento puede acabar en un sistema
  -- ajeno (el futuro adaptador de A3) y lo que no se publica no se filtra.
  perform public.outbox_publish(
    'rrhh_alta:' || v_id::text || ':solicitada',
    'rrhh_alta.solicitada',
    'merchanops',
    'rrhh_solicitud_alta',
    v_id::text,
    jsonb_build_object(
      'solicitud_id', v_id,
      'codigo', v_codigo,
      'worker_id', v_worker,
      'estado', v_estado,
      'resolucion_sistema', v_resolucion,
      'lineas', v_n
    )
  );

  return jsonb_build_object(
    'solicitud_id', v_id,
    'codigo', v_codigo,
    'estado', v_estado,
    'lineas', v_n,
    'fecha_inicio', v_fi,
    'fecha_fin', v_ff
  );
end $function$;

revoke all on function public.merchan_rrhh_solicitar_alta(jsonb) from public, anon;
grant execute on function public.merchan_rrhh_solicitar_alta(jsonb) to authenticated, service_role;

comment on function public.merchan_rrhh_solicitar_alta(jsonb) is
  'Crea una solicitud de alta con sus líneas y devuelve {solicitud_id, codigo}. Única puerta de entrada: las tablas no tienen policy de INSERT. Valida el permiso del módulo por dentro (merchan_can_rrhh).';

-- ===========================================================================
-- 6. RPC · RESOLVER
-- ===========================================================================
-- Payload esperado:
-- {
--   "solicitud_id": "uuid",        (obligatorio)
--   "version": 3,                  (opcional pero recomendado: bloqueo optimista)
--   "estado": "tramitada|alta_online|...",   (opcional: si falta, no cambia)
--   "motivo": "texto",             (obligatorio para rechazada y cancelada)
--   "a3_numero": "18832",          (opcional)
--   "a3_canal": "manual|api",      (opcional, por defecto el que ya tuviera)
--   "a3_estado": "texto de A3",    (opcional)
--   "a3_last_error": "texto",      (opcional)
--   "a3_sync_event_id": "texto",   (opcional)
--   "crear_alta": true,            (opcional: crea el alta real de A3)
--   "alta": { "numero_alta": "18832", "tipo": "temporal",
--             "fecha_inicio": "...", "fecha_fin": "...",
--             "ceco": "3005", "horas_dia": 6 },
--   "a3_empleado_codigo": "E-1234" (opcional: sella workers.a3_empleado_codigo)
-- }
create or replace function public.merchan_rrhh_resolver_alta(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_sol public.rrhh_solicitudes_alta%rowtype;
  v_id uuid;
  v_estado text;
  v_motivo text;
  v_version integer;
  v_alta uuid;
  v_alta_fi date;
  v_alta_ff date;
  v_alta_ceco text;
  v_alta_tipo text;
  v_actor text;
  v_actor_nombre text;
  v_nueva_version integer;
  v_a3 text;
begin
  if not (public.merchan_is_admin() or public.merchan_is_rrhh()) then
    raise exception 'Solo RR.HH. o administración pueden resolver una solicitud de alta. La gestora solicita; RR.HH. tramita.'
      using errcode = '42501';
  end if;

  v_id := nullif(btrim(p_payload ->> 'solicitud_id'), '')::uuid;
  if v_id is null then
    raise exception 'Falta solicitud_id: no se sabe qué solicitud hay que resolver.';
  end if;

  select * into v_sol from public.rrhh_solicitudes_alta where id = v_id for update;
  if not found then
    raise exception 'Solicitud de alta % no encontrada.', v_id;
  end if;

  v_version := nullif(btrim(p_payload ->> 'version'), '')::integer;
  if v_version is not null and v_version <> v_sol.version then
    raise exception 'Conflicto de concurrencia: la solicitud % cambió desde tu lectura (versión en base %, tú traías la %). Recarga la cola y vuelve a intentarlo.',
      v_sol.codigo, v_sol.version, v_version;
  end if;

  v_estado := coalesce(nullif(btrim(p_payload ->> 'estado'), ''), v_sol.estado);
  v_motivo := coalesce(nullif(btrim(p_payload ->> 'motivo'), ''), v_sol.motivo);
  -- "a3_numero" ausente = no se toca. "a3_numero": null o "" = BORRARLO. Con un
  -- coalesce a secas, quien tecleó mal el número no podía dejarlo en blanco: la
  -- pantalla decía "guardado" y la base conservaba el valor viejo.
  if p_payload ? 'a3_numero' then
    v_a3 := nullif(btrim(p_payload ->> 'a3_numero'), '');
  else
    v_a3 := v_sol.a3_numero;
  end if;

  if v_estado in ('rechazada', 'cancelada') and coalesce(btrim(v_motivo), '') = '' then
    raise exception 'Dejar la solicitud % en "%" exige un motivo escrito.', v_sol.codigo, v_estado;
  end if;

  v_actor := public.merchan_my_app_user_id();
  select u.display_name into v_actor_nombre from public.app_users u where u.id = v_actor;

  -- ¿Hay que crear el alta REAL? Solo si se pide expresamente y la solicitud no
  -- tiene ya una: crear dos altas para el mismo periodo es exactamente el error
  -- que este módulo existe para evitar.
  v_alta := v_sol.alta_id;
  if coalesce((p_payload ->> 'crear_alta')::boolean, false) and v_alta is null then
    v_alta_fi := coalesce(nullif(btrim(p_payload #>> '{alta,fecha_inicio}'), '')::date, v_sol.fecha_inicio);
    v_alta_ff := coalesce(nullif(btrim(p_payload #>> '{alta,fecha_fin}'), '')::date, v_sol.fecha_fin);
    if v_alta_fi is null then
      raise exception 'No se puede crear el alta de la solicitud %: no hay fecha de inicio ni en la solicitud ni en el payload.', v_sol.codigo;
    end if;

    v_alta_tipo := coalesce(nullif(btrim(p_payload #>> '{alta,tipo}'), ''), 'temporal');
    if v_alta_tipo not in ('temporal', 'indefinido', 'fijo_discontinuo') then
      raise exception 'Tipo de contrato inválido: "%". Los valores son temporal, indefinido y fijo_discontinuo.', v_alta_tipo;
    end if;

    -- CECO: el que digan, y si no el de la primera línea de la solicitud.
    v_alta_ceco := nullif(btrim(p_payload #>> '{alta,ceco}'), '');
    if v_alta_ceco is null then
      select l.ceco into v_alta_ceco
        from public.rrhh_solicitud_alta_lineas l
       where l.solicitud_id = v_sol.id and l.ceco is not null
       order by l.fecha_inicio nulls last
       limit 1;
    end if;

    insert into public.rrhh_altas (
      worker_id, numero_alta, tipo, fecha_inicio, fecha_fin, ceco, horas_dia,
      estado, origen, created_by, created_by_nombre
    ) values (
      v_sol.worker_id,
      coalesce(nullif(btrim(p_payload #>> '{alta,numero_alta}'), ''), v_a3),
      v_alta_tipo, v_alta_fi, v_alta_ff, v_alta_ceco,
      coalesce(nullif(btrim(p_payload #>> '{alta,horas_dia}'), '')::numeric, v_sol.horas_dia),
      'vigente', 'solicitud', v_actor, v_actor_nombre
    ) returning id into v_alta;
  end if;

  -- El código de empleado de A3 es lo ÚNICO de A3 que se guarda en workers.
  -- Se sella desde aquí (y no con una policy de UPDATE sobre workers) para que
  -- RR.HH. no pueda tocar de paso el nombre, el teléfono ni la provincia.
  if nullif(btrim(p_payload ->> 'a3_empleado_codigo'), '') is not null then
    update public.workers
       set a3_empleado_codigo = btrim(p_payload ->> 'a3_empleado_codigo')
     where id = v_sol.worker_id;
  end if;

  update public.rrhh_solicitudes_alta set
    estado = v_estado,
    motivo = v_motivo,
    a3_numero = v_a3,
    a3_canal = coalesce(nullif(btrim(p_payload ->> 'a3_canal'), ''), a3_canal),
    a3_estado = coalesce(nullif(btrim(p_payload ->> 'a3_estado'), ''), a3_estado),
    a3_sync_event_id = coalesce(nullif(btrim(p_payload ->> 'a3_sync_event_id'), ''), a3_sync_event_id),
    -- a3_last_error NO usa coalesce a propósito: resolver de nuevo LIMPIA el
    -- error anterior. Un error de A3 de hace tres días colgando de una
    -- solicitud ya tramitada solo sirve para asustar.
    a3_last_error = nullif(btrim(p_payload ->> 'a3_last_error'), ''),
    a3_last_sync_at = case
      when nullif(btrim(p_payload ->> 'a3_numero'), '') is not null
        or nullif(btrim(p_payload ->> 'a3_estado'), '') is not null
      then now() else a3_last_sync_at end,
    alta_id = v_alta
  where id = v_id
  returning version into v_nueva_version;

  perform public.outbox_publish(
    'rrhh_alta:' || v_id::text || ':resuelta:' || v_nueva_version::text,
    'rrhh_alta.resuelta',
    'merchanops',
    'rrhh_solicitud_alta',
    v_id::text,
    jsonb_build_object(
      'solicitud_id', v_id,
      'codigo', v_sol.codigo,
      'worker_id', v_sol.worker_id,
      'estado_anterior', v_sol.estado,
      'estado', v_estado,
      'alta_id', v_alta,
      'a3_canal', coalesce(nullif(btrim(p_payload ->> 'a3_canal'), ''), v_sol.a3_canal),
      'version', v_nueva_version
    )
  );

  return jsonb_build_object(
    'solicitud_id', v_id,
    'codigo', v_sol.codigo,
    'estado', v_estado,
    'alta_id', v_alta,
    'version', v_nueva_version
  );
end $function$;

revoke all on function public.merchan_rrhh_resolver_alta(jsonb) from public, anon;
grant execute on function public.merchan_rrhh_resolver_alta(jsonb) to authenticated, service_role;

comment on function public.merchan_rrhh_resolver_alta(jsonb) is
  'Resuelve una solicitud de alta: cambia el estado, teclea el número de A3 y, si se pide, crea el alta real. Exige motivo al rechazar o cancelar y admite bloqueo optimista por "version". Solo admin o rol rrhh.';

-- ===========================================================================
-- 7. RPC · REGISTRAR UN ALTA REAL A MANO
-- ===========================================================================
-- Decisión D6: A3 es manual desde el día uno. RR.HH. teclea aquí las altas que
-- ya existen en A3 (y las ampliaciones: "ampliar hasta el 31/07"), y a partir
-- de ellas el sistema calcula la cobertura de los trabajos.
-- Payload esperado:
-- {
--   "alta_id": "uuid",             (opcional: si viene, AMPLÍA/corrige esa alta)
--   "version": 2,                  (opcional: bloqueo optimista al ampliar)
--   "worker_id": "uuid",           (obligatorio al crear)
--   "numero_alta": "18832",
--   "tipo": "temporal|indefinido|fijo_discontinuo",
--   "fecha_inicio": "2026-07-20",  (obligatoria al crear)
--   "fecha_fin": "2026-07-31",     (null = alta abierta)
--   "ceco": "3210", "horas_dia": 6,
--   "estado": "vigente|ampliada|baja_pendiente|baja|anulada",
--   "origen": "manual|solicitud|import",
--   "a3_empleado_codigo": "E-1234" (opcional: sella workers.a3_empleado_codigo)
-- }
create or replace function public.merchan_rrhh_registrar_alta(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_alta public.rrhh_altas%rowtype;
  v_id uuid;
  v_worker uuid;
  v_tipo text;
  v_estado text;
  v_origen text;
  v_fi date;
  v_ff date;
  v_actor text;
  v_actor_nombre text;
  v_version integer;
  v_nueva_version integer;
begin
  if not (public.merchan_is_admin() or public.merchan_is_rrhh()) then
    raise exception 'Solo RR.HH. o administración pueden registrar un alta laboral.'
      using errcode = '42501';
  end if;

  v_actor := public.merchan_my_app_user_id();
  select u.display_name into v_actor_nombre from public.app_users u where u.id = v_actor;

  v_id := nullif(btrim(p_payload ->> 'alta_id'), '')::uuid;
  v_fi := nullif(btrim(p_payload ->> 'fecha_inicio'), '')::date;
  v_ff := nullif(btrim(p_payload ->> 'fecha_fin'), '')::date;
  v_tipo := nullif(btrim(p_payload ->> 'tipo'), '');
  v_estado := nullif(btrim(p_payload ->> 'estado'), '');
  v_origen := nullif(btrim(p_payload ->> 'origen'), '');

  if v_tipo is not null and v_tipo not in ('temporal', 'indefinido', 'fijo_discontinuo') then
    raise exception 'Tipo de contrato inválido: "%". Los valores son temporal, indefinido y fijo_discontinuo.', v_tipo;
  end if;
  if v_estado is not null and v_estado not in ('vigente', 'ampliada', 'baja_pendiente', 'baja', 'anulada') then
    raise exception 'Estado de alta inválido: "%". Los valores son vigente, ampliada, baja_pendiente, baja y anulada.', v_estado;
  end if;
  if v_origen is not null and v_origen not in ('manual', 'solicitud', 'import') then
    raise exception 'Origen de alta inválido: "%". Los valores son manual, solicitud e import.', v_origen;
  end if;

  if v_id is null then
    -- Alta nueva
    v_worker := nullif(btrim(p_payload ->> 'worker_id'), '')::uuid;
    if v_worker is null then
      raise exception 'Falta el trabajador (worker_id) del alta.';
    end if;
    if not exists (select 1 from public.workers w where w.id = v_worker) then
      raise exception 'El trabajador % no existe en MerchanOps.', v_worker;
    end if;
    if v_fi is null then
      raise exception 'Un alta necesita fecha de inicio.';
    end if;
    if v_ff is not null and v_ff < v_fi then
      raise exception 'El alta está del revés: la fecha de fin (%) es anterior a la de inicio (%).', v_ff, v_fi;
    end if;

    insert into public.rrhh_altas (
      worker_id, numero_alta, tipo, fecha_inicio, fecha_fin, ceco, horas_dia,
      estado, origen, created_by, created_by_nombre
    ) values (
      v_worker,
      nullif(btrim(p_payload ->> 'numero_alta'), ''),
      coalesce(v_tipo, 'temporal'), v_fi, v_ff,
      nullif(btrim(p_payload ->> 'ceco'), ''),
      nullif(btrim(p_payload ->> 'horas_dia'), '')::numeric,
      coalesce(v_estado, 'vigente'), coalesce(v_origen, 'manual'),
      v_actor, v_actor_nombre
    ) returning * into v_alta;

    v_id := v_alta.id;
    v_nueva_version := v_alta.version;
  else
    -- Ampliación o corrección de un alta existente ("ampliar hasta el 31/07").
    select * into v_alta from public.rrhh_altas where id = v_id for update;
    if not found then
      raise exception 'Alta % no encontrada.', v_id;
    end if;

    v_version := nullif(btrim(p_payload ->> 'version'), '')::integer;
    if v_version is not null and v_version <> v_alta.version then
      raise exception 'Conflicto de concurrencia: el alta % cambió desde tu lectura (versión en base %, tú traías la %). Recarga y vuelve a intentarlo.',
        coalesce(v_alta.numero_alta, v_alta.id::text), v_alta.version, v_version;
    end if;
    if v_alta.estado = 'anulada' then
      raise exception 'El alta % está anulada: no admite cambios.', coalesce(v_alta.numero_alta, v_alta.id::text);
    end if;

    v_fi := coalesce(v_fi, v_alta.fecha_inicio);
    if p_payload ? 'fecha_fin' then
      -- "fecha_fin": null significa explícitamente "alta abierta".
      v_ff := nullif(btrim(p_payload ->> 'fecha_fin'), '')::date;
    else
      v_ff := v_alta.fecha_fin;
    end if;
    -- "ampliar": true = extender, nunca recortar. Sin esto, tramitar un trabajo
    -- que solapa por la izquierda con un alta más larga le recortaba la
    -- cobertura por detrás sin avisar (alta del 20/07 al 15/08 + trabajo hasta
    -- el 31/07 dejaba el alta terminando el 31/07). Acortar un alta sigue
    -- siendo posible: basta con NO mandar la bandera, que es corregir a mano.
    if coalesce((p_payload ->> 'ampliar')::boolean, false)
       and v_alta.fecha_fin is not null and v_ff is not null and v_ff < v_alta.fecha_fin then
      v_ff := v_alta.fecha_fin;
    end if;

    if v_ff is not null and v_ff < v_fi then
      raise exception 'El alta está del revés: la fecha de fin (%) es anterior a la de inicio (%).', v_ff, v_fi;
    end if;

    update public.rrhh_altas set
      numero_alta = coalesce(nullif(btrim(p_payload ->> 'numero_alta'), ''), numero_alta),
      tipo = coalesce(v_tipo, tipo),
      fecha_inicio = v_fi,
      fecha_fin = v_ff,
      ceco = coalesce(nullif(btrim(p_payload ->> 'ceco'), ''), ceco),
      horas_dia = coalesce(nullif(btrim(p_payload ->> 'horas_dia'), '')::numeric, horas_dia),
      estado = coalesce(v_estado, estado),
      origen = coalesce(v_origen, origen)
    where id = v_id
    returning version into v_nueva_version;
  end if;

  if nullif(btrim(p_payload ->> 'a3_empleado_codigo'), '') is not null then
    update public.workers
       set a3_empleado_codigo = btrim(p_payload ->> 'a3_empleado_codigo')
     where id = coalesce(v_worker, v_alta.worker_id);
  end if;

  return jsonb_build_object(
    'alta_id', v_id,
    'numero_alta', coalesce(nullif(btrim(p_payload ->> 'numero_alta'), ''), v_alta.numero_alta),
    'version', v_nueva_version
  );
end $function$;

revoke all on function public.merchan_rrhh_registrar_alta(jsonb) from public, anon;
grant execute on function public.merchan_rrhh_registrar_alta(jsonb) to authenticated, service_role;

comment on function public.merchan_rrhh_registrar_alta(jsonb) is
  'Registra a mano un alta real de A3 (decisión D6) o amplía una existente si se pasa alta_id. Devuelve {alta_id, numero_alta, version}. Solo admin o rol rrhh.';

-- v10_7 · Accesos a centro: solicitudes puntuales, con el plazo calculado por el sistema.
-- PENDIENTE DE APLICAR al proyecto dptmswhwmqimijpfyndn.
--
-- ============================================================================
-- PROBLEMA
-- ============================================================================
-- Cada cadena tiene sus reglas para dejar entrar a un trabajador, y hoy esas
-- reglas viven en la cabeza de quien lleva más tiempo. El resultado conocido es
-- llegar al centro el día del trabajo y que no te dejen pasar porque el acceso
-- había que pedirlo con cuatro días.
--
-- El diseño exige que el sistema lo diga solo, en gris, antes de pulsar nada:
--   "Alcampo tramita por centro · 3 centros → 3 accesos · pedir antes del 29/07"
--   "Media Markt tramita por cadena · 4 centros → 1 acceso · pedir antes del 31/07"
--   "El Corte Inglés · plazo vencido el 25/07"   (en rojo)
--
-- ============================================================================
-- DECISIONES
-- ============================================================================
-- D4  Los accesos son PUNTUALES: trabajador + centro + FECHA DE TRABAJO. No hay
--     acreditaciones con vigencia, ni "tarjetas" que caducan. Una solicitud
--     sirve para un día concreto y se archiva.
--
-- El modo de trámite manda sobre cuántas filas se crean, y lo dice el catálogo
-- (v10_5), no la persona:
--   cadenas.modo_tramite = 'centro' → UNA solicitud POR CENTRO marcado.
--   cadenas.modo_tramite = 'cadena' → UNA sola solicitud con centro_id NULL,
--                                     que en pantalla se lee "toda la cadena".
--
-- El plazo también: fecha_limite = fecha_trabajo - cadenas.lead_time_dias. Si
-- esa fecha ya pasó, la solicitud NACE en 'fuera_de_plazo' en vez de en
-- 'pendiente'. Nace, no se rechaza: el trabajo hay que hacerlo igual y alguien
-- tiene que llamar a la cadena. Lo que no puede es nacer aparentando estar bien.
--
-- ============================================================================
-- SOBRE EL UNIQUE: POR QUÉ ES PARCIAL
-- ============================================================================
-- El índice impide duplicar (worker_id, cadena_id, centro_id, fecha_trabajo):
-- pedir dos veces el mismo acceso satura a la cadena y confunde a todos.
--
-- Pero se deja FUERA a las solicitudes 'denegado' y 'cancelado'. En
-- transicionesSolicitudAcceso (lib/rrhh/tipos.ts) esos dos estados son FINALES:
-- con un índice total, un acceso denegado por un error de la cadena bloquearía
-- para siempre la posibilidad de volver a pedirlo para ese día, y no habría
-- salida (denegado no transita a ningún sitio). Con el índice parcial, lo
-- muerto no estorba y lo vivo sigue sin poder duplicarse.
--
-- El centro NULL ("toda la cadena") se normaliza con COALESCE a un UUID de
-- ceros dentro del índice: en un UNIQUE los NULL son distintos entre sí, así
-- que sin ese COALESCE se podrían crear diez solicitudes idénticas de cadena.
--
-- ============================================================================
-- VERIFICACIÓN (tras aplicar)
-- ============================================================================
--   -- catálogo de prueba
--   insert into cadenas (nombre, modo_tramite, lead_time_dias) values ('Prueba centro','centro',2);
--   insert into centros (cadena_id, nombre) select id, 'C1' from cadenas where nombre='Prueba centro';
--   insert into centros (cadena_id, nombre) select id, 'C2' from cadenas where nombre='Prueba centro';
--   -- 2 centros -> 2 accesos, fecha_limite = fecha_trabajo - 2
--   select public.merchan_rrhh_solicitar_acceso(jsonb_build_object(
--     'worker_id', (select id from workers limit 1),
--     'cadena_id', (select id from cadenas where nombre='Prueba centro'),
--     'fecha_trabajo', (current_date + 10)::text,
--     'centros', (select jsonb_agg(id) from centros where nombre in ('C1','C2'))));
--   -- repetir la MISMA llamada -> 0 creadas, 2 omitidas (no duplica)
--   -- con fecha_trabajo = current_date -> estado 'fuera_de_plazo'
--   -- modo 'cadena' -> 1 sola fila con centro_id NULL
--   update rrhh_solicitudes_acceso set estado='concedido' where estado='denegado'; -- error
--   update rrhh_solicitudes_acceso set estado='denegado';  -- error: falta motivo
--
-- ROLLBACK:
--   drop function if exists public.merchan_rrhh_resolver_acceso(jsonb);
--   drop function if exists public.merchan_rrhh_solicitar_acceso(jsonb);
--   drop table if exists public.rrhh_solicitudes_acceso;
--   drop function if exists public.merchan_rrhh_guard_solicitud_acceso();
--   drop function if exists public.merchan_rrhh_evento_solicitud_acceso();

-- ===========================================================================
-- 1. TABLA
-- ===========================================================================
create table if not exists public.rrhh_solicitudes_acceso (
  id uuid primary key default gen_random_uuid(),
  codigo text not null unique,
  worker_id uuid not null references public.workers(id),
  worker_nombre text,
  cadena_id uuid not null references public.cadenas(id) on delete restrict,
  cadena_nombre text,
  centro_id uuid references public.centros(id) on delete set null,
  centro_nombre text,
  fecha_trabajo date not null,
  fecha_limite date,
  origen_tipo text check (origen_tipo is null or origen_tipo in ('campana', 'campana_punto', 'servicio')),
  origen_id text,
  trabajo text,
  estado text not null default 'pendiente' check (estado in (
    'solicitado', 'pendiente', 'fuera_de_plazo', 'concedido',
    'concedido_no_consumido', 'denegado', 'cancelado')),
  solicitada_por text references public.app_users(id) on delete set null,
  solicitada_por_nombre text,
  concedido_at timestamptz,
  consumido_at timestamptz,
  motivo text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  version integer not null default 1
);

comment on table public.rrhh_solicitudes_acceso is
  'Solicitudes PUNTUALES de acceso a centro (decisión D4: trabajador + centro + fecha de trabajo; no hay acreditaciones con vigencia). Cuántas filas se crean y con qué plazo lo decide cadenas.modo_tramite y cadenas.lead_time_dias, no la persona.';
comment on column public.rrhh_solicitudes_acceso.codigo is 'ACC-AAMMDD-NNN. Inmutable. Es el "Sol." de la tabla de accesos.';
comment on column public.rrhh_solicitudes_acceso.worker_id is 'Trabajador que tiene que entrar. Sin ON DELETE: la solicitud es un registro de lo que se pidió.';
comment on column public.rrhh_solicitudes_acceso.worker_nombre is 'Nombre del trabajador congelado al solicitar, para que la tabla se lea sin ir a buscarlo.';
comment on column public.rrhh_solicitudes_acceso.cadena_id is 'Cadena a la que se pide el acceso. ON DELETE RESTRICT: borrar una cadena con accesos dejaría el histórico sin sentido; se desactiva.';
comment on column public.rrhh_solicitudes_acceso.cadena_nombre is 'Nombre de la cadena congelado.';
comment on column public.rrhh_solicitudes_acceso.centro_id is
  'Centro concreto, o NULL cuando la cadena tramita por cadena: NULL se lee en pantalla como "toda la cadena". ON DELETE SET NULL para que retirar un centro del catálogo no borre el histórico (el nombre queda en centro_nombre).';
comment on column public.rrhh_solicitudes_acceso.centro_nombre is 'Nombre del centro congelado; sobrevive aunque el centro se borre del catálogo.';
comment on column public.rrhh_solicitudes_acceso.fecha_trabajo is 'Día en que el trabajador tiene que entrar. Es la fecha que manda: el acceso vale para ese día.';
comment on column public.rrhh_solicitudes_acceso.fecha_limite is
  'Último día para pedirlo: fecha_trabajo - cadenas.lead_time_dias. Lo calcula el sistema al crear la solicitud y se congela: si mañana la cadena cambia su plazo, no reescribe la historia.';
comment on column public.rrhh_solicitudes_acceso.origen_tipo is 'Enlace polimórfico con el trabajo que motiva el acceso: campana, campana_punto o servicio. NULL si se pide suelto.';
comment on column public.rrhh_solicitudes_acceso.origen_id is 'Id de la fila de origen, como texto. Sin FK: el enlace es polimórfico.';
comment on column public.rrhh_solicitudes_acceso.trabajo is 'Descripción legible del trabajo ("Campaña Navidad · montaje"), congelada. Es la columna "Trabajo" del diseño.';
comment on column public.rrhh_solicitudes_acceso.estado is 'Espejo de EstadoSolicitudAcceso. Las transiciones las impone merchan_rrhh_guard_solicitud_acceso.';
comment on column public.rrhh_solicitudes_acceso.solicitada_por is 'app_users.id de la gestora. Es la clave de la RLS: cada gestora ve SUS solicitudes.';
comment on column public.rrhh_solicitudes_acceso.solicitada_por_nombre is 'Columna "Gestora" de la tabla, congelada.';
comment on column public.rrhh_solicitudes_acceso.concedido_at is 'Momento en que la cadena concedió el acceso.';
comment on column public.rrhh_solicitudes_acceso.consumido_at is 'Momento en que el acceso se usó de verdad. NULL en un acceso concedido y no consumido: es lo que distingue "concedido" de "concedido_no_consumido".';
comment on column public.rrhh_solicitudes_acceso.motivo is 'Obligatorio para dejar la solicitud en "denegado" o "cancelado".';
comment on column public.rrhh_solicitudes_acceso.version is 'Contador optimista: sube en cada UPDATE. Los RPC comparan contra él.';

create index if not exists idx_rrhh_acceso_worker on public.rrhh_solicitudes_acceso (worker_id, fecha_trabajo desc);
create index if not exists idx_rrhh_acceso_cadena on public.rrhh_solicitudes_acceso (cadena_id);
create index if not exists idx_rrhh_acceso_centro on public.rrhh_solicitudes_acceso (centro_id) where centro_id is not null;
create index if not exists idx_rrhh_acceso_estado on public.rrhh_solicitudes_acceso (estado);
create index if not exists idx_rrhh_acceso_solicitante on public.rrhh_solicitudes_acceso (solicitada_por);
create index if not exists idx_rrhh_acceso_fecha on public.rrhh_solicitudes_acceso (fecha_trabajo);
create index if not exists idx_rrhh_acceso_limite on public.rrhh_solicitudes_acceso (fecha_limite) where estado in ('pendiente', 'solicitado', 'fuera_de_plazo');

-- Ver el bloque "SOBRE EL UNIQUE" de la cabecera: parcial (deja fuera lo ya
-- muerto) y con COALESCE para que "toda la cadena" no se pueda duplicar.
create unique index if not exists uq_rrhh_acceso_sin_duplicados
  on public.rrhh_solicitudes_acceso (
    worker_id, cadena_id,
    (coalesce(centro_id, '00000000-0000-0000-0000-000000000000'::uuid)),
    fecha_trabajo
  )
  where estado not in ('denegado', 'cancelado');

alter table public.rrhh_solicitudes_acceso enable row level security;
revoke all on table public.rrhh_solicitudes_acceso from anon;
grant select, insert, update, delete on public.rrhh_solicitudes_acceso to authenticated, service_role;

-- ===========================================================================
-- 2. GUARDIÁN DE TRANSICIONES, MOTIVO Y VERSIÓN
-- ===========================================================================
-- Copia literal de `transicionesSolicitudAcceso` (lib/rrhh/tipos.ts).
create or replace function public.merchan_rrhh_guard_solicitud_acceso()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_permitidas text[];
begin
  if tg_op = 'DELETE' then
    raise exception 'Una solicitud de acceso no se borra: déjala en "cancelado" con motivo. Solicitud %.', old.codigo;
  end if;

  if new.codigo is distinct from old.codigo then
    raise exception 'El código de una solicitud de acceso es inmutable (%).', old.codigo;
  end if;
  if new.worker_id is distinct from old.worker_id
     or new.cadena_id is distinct from old.cadena_id
     or new.fecha_trabajo is distinct from old.fecha_trabajo then
    raise exception 'La solicitud % no puede cambiar de trabajador, de cadena ni de fecha de trabajo: sería otra solicitud. Cancélala con motivo y pide la nueva.', old.codigo;
  end if;
  new.created_at := old.created_at;
  new.solicitada_por := old.solicitada_por;

  if new.estado is distinct from old.estado then
    v_permitidas := case old.estado
      when 'pendiente'              then array['solicitado', 'concedido', 'denegado', 'cancelado']
      when 'solicitado'             then array['concedido', 'denegado', 'cancelado']
      when 'fuera_de_plazo'         then array['solicitado', 'concedido', 'denegado', 'cancelado']
      when 'concedido'              then array['concedido_no_consumido', 'cancelado']
      when 'concedido_no_consumido' then array['concedido', 'cancelado']
      else array[]::text[]
    end;

    if not (new.estado = any (v_permitidas)) then
      raise exception 'Transición no permitida en el acceso %: de "%" a "%". Desde "%" solo se puede pasar a: %.',
        old.codigo, old.estado, new.estado, old.estado,
        coalesce(nullif(array_to_string(v_permitidas, ', '), ''), 'ningún estado (es final)');
    end if;

    if new.estado in ('denegado', 'cancelado') and coalesce(btrim(new.motivo), '') = '' then
      raise exception 'Para dejar el acceso % en "%" hace falta un motivo escrito: nada se cierra en negativo sin explicación.',
        old.codigo, new.estado;
    end if;

    if new.estado = 'concedido' and new.concedido_at is null then
      new.concedido_at := now();
    end if;
  end if;

  new.version := old.version + 1;
  new.updated_at := now();
  return new;
end $function$;

revoke all on function public.merchan_rrhh_guard_solicitud_acceso() from public, anon, authenticated;

comment on function public.merchan_rrhh_guard_solicitud_acceso() is
  'Trigger BEFORE UPDATE OR DELETE de rrhh_solicitudes_acceso: impone las transiciones de transicionesSolicitudAcceso (lib/rrhh/tipos.ts), exige motivo en "denegado" y "cancelado", prohíbe el borrado, sella concedido_at y sube la versión.';

drop trigger if exists trg_rrhh_acceso_guard on public.rrhh_solicitudes_acceso;
create trigger trg_rrhh_acceso_guard
  before update or delete on public.rrhh_solicitudes_acceso
  for each row execute function public.merchan_rrhh_guard_solicitud_acceso();

create or replace function public.merchan_rrhh_evento_solicitud_acceso()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  if tg_op = 'INSERT' then
    insert into public.rrhh_eventos (entidad, entidad_id, evento, estado_anterior, estado_nuevo, motivo, actor_id, actor_nombre, payload)
    values ('acceso', new.id, 'acceso.solicitado', null, new.estado, new.motivo, new.solicitada_por, new.solicitada_por_nombre,
            jsonb_build_object('codigo', new.codigo, 'worker_id', new.worker_id,
                               'cadena_id', new.cadena_id, 'centro_id', new.centro_id,
                               'fecha_trabajo', new.fecha_trabajo, 'fecha_limite', new.fecha_limite));
  elsif new.estado is distinct from old.estado then
    insert into public.rrhh_eventos (entidad, entidad_id, evento, estado_anterior, estado_nuevo, motivo, actor_id, actor_nombre, payload)
    values ('acceso', new.id, 'acceso.estado', old.estado, new.estado, new.motivo, public.merchan_my_app_user_id(),
            (select u.display_name from public.app_users u where u.id = public.merchan_my_app_user_id()),
            jsonb_build_object('codigo', new.codigo, 'cadena_id', new.cadena_id,
                               'centro_id', new.centro_id, 'version', new.version));
  end if;
  return null;
end $function$;

revoke all on function public.merchan_rrhh_evento_solicitud_acceso() from public, anon, authenticated;

comment on function public.merchan_rrhh_evento_solicitud_acceso() is
  'Trigger AFTER de rrhh_solicitudes_acceso que deja el rastro en rrhh_eventos.';

drop trigger if exists trg_rrhh_acceso_evento on public.rrhh_solicitudes_acceso;
create trigger trg_rrhh_acceso_evento
  after insert or update on public.rrhh_solicitudes_acceso
  for each row execute function public.merchan_rrhh_evento_solicitud_acceso();

-- ===========================================================================
-- 3. RLS · mismo criterio que las altas (v10_6)
-- ===========================================================================
drop policy if exists rrhh_acceso_read on public.rrhh_solicitudes_acceso;
create policy rrhh_acceso_read on public.rrhh_solicitudes_acceso
  for select to authenticated
  using (
    (select public.merchan_is_admin())
    or (select public.merchan_is_rrhh())
    or solicitada_por = (select public.merchan_my_app_user_id())
  );

drop policy if exists rrhh_acceso_write on public.rrhh_solicitudes_acceso;
create policy rrhh_acceso_write on public.rrhh_solicitudes_acceso
  for update to authenticated
  using ((select public.merchan_is_admin()) or (select public.merchan_is_rrhh()))
  with check ((select public.merchan_is_admin()) or (select public.merchan_is_rrhh()));

-- Sin policy de INSERT ni de DELETE, igual que las altas: la única puerta es
-- merchan_rrhh_solicitar_acceso, que es quien sabe expandir por modo de trámite
-- y calcular el plazo. Un INSERT directo por REST crearía una fila con el
-- número de accesos y la fecha límite que le diera la gana a quien lo mandara.

-- ===========================================================================
-- 4. RPC · SOLICITAR (expande según el modo de trámite)
-- ===========================================================================
-- Payload esperado:
-- {
--   "worker_id": "uuid",            (obligatorio)
--   "worker_nombre": "texto",       (opcional: si falta, de workers)
--   "cadena_id": "uuid",            (obligatorio)
--   "fecha_trabajo": "2026-08-05",  (obligatoria)
--   "centros": ["uuid", "uuid"],    (los chips marcados; se ignoran si la
--                                    cadena tramita por cadena)
--   "origen_tipo": "campana|campana_punto|servicio",  (opcional)
--   "origen_id": "...", "trabajo": "texto"            (opcional)
-- }
-- Devuelve:
-- { "creadas": [{"id":..., "codigo":"ACC-260731-001", "centro_id":...}],
--   "omitidas": [{"centro_id":..., "motivo":"ya existe una solicitud viva"}],
--   "modo_tramite": "centro", "lead_time_dias": 4,
--   "fecha_limite": "2026-08-01", "estado": "pendiente" }
create or replace function public.merchan_rrhh_solicitar_acceso(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_cad public.cadenas%rowtype;
  v_worker uuid;
  v_worker_nombre text;
  v_fecha date;
  v_limite date;
  v_estado text;
  v_centros uuid[];
  v_centro uuid;
  v_centro_nombre text;
  v_codigo text;
  v_id uuid;
  v_actor text;
  v_actor_nombre text;
  v_creadas jsonb := '[]'::jsonb;
  v_omitidas jsonb := '[]'::jsonb;
begin
  if not public.merchan_can_rrhh() then
    raise exception 'No tienes acceso al módulo de RR.HH.: no puedes solicitar accesos.'
      using errcode = '42501';
  end if;

  v_worker := nullif(btrim(p_payload ->> 'worker_id'), '')::uuid;
  if v_worker is null then
    raise exception 'Falta el trabajador (worker_id) en la solicitud de acceso.';
  end if;
  select w.name into v_worker_nombre from public.workers w where w.id = v_worker;
  if v_worker_nombre is null then
    raise exception 'El trabajador % no existe en MerchanOps.', v_worker;
  end if;
  -- Misma frontera que en las altas (v10_6): la RPC es SECURITY DEFINER y lee
  -- workers sin pasar por RLS, así que el ámbito provincial se comprueba aquí.
  if not public.merchan_rrhh_worker_en_ambito(v_worker) then
    raise exception 'Ese trabajador no está en tus provincias: no puedes solicitar su acceso a centro. Pídeselo a RR.HH. o a administración.'
      using errcode = '42501';
  end if;
  v_worker_nombre := coalesce(nullif(btrim(p_payload ->> 'worker_nombre'), ''), v_worker_nombre);

  select * into v_cad from public.cadenas
   where id = nullif(btrim(p_payload ->> 'cadena_id'), '')::uuid;
  if not found then
    raise exception 'La cadena % no existe en el catálogo. RR.HH. tiene que darla de alta en "Cadenas y centros" antes de poder pedir accesos.',
      coalesce(nullif(btrim(p_payload ->> 'cadena_id'), ''), '(vacía)');
  end if;
  if not v_cad.activa then
    raise exception 'La cadena "%" está desactivada en el catálogo: no se le piden accesos.', v_cad.nombre;
  end if;

  v_fecha := nullif(btrim(p_payload ->> 'fecha_trabajo'), '')::date;
  if v_fecha is null then
    raise exception 'Falta la fecha de trabajo: un acceso es puntual (decisión D4) y sin día no se puede pedir.';
  end if;

  -- El plazo lo calcula el sistema, siempre. Nadie lo teclea.
  v_limite := v_fecha - v_cad.lead_time_dias;
  -- "Hoy" en hora de Madrid: a las 00:30 el plazo de hoy sigue vivo.
  v_estado := case
    when v_limite < (now() at time zone 'Europe/Madrid')::date then 'fuera_de_plazo'
    else 'pendiente'
  end;

  -- Cuántas solicitudes se crean lo dice el catálogo, no la persona.
  if v_cad.modo_tramite = 'cadena' then
    -- UNA sola, con centro_id NULL: "toda la cadena".
    v_centros := array[null::uuid];
  else
    select array_agg(t.x::uuid)
      into v_centros
      from jsonb_array_elements_text(coalesce(p_payload -> 'centros', '[]'::jsonb)) as t(x)
     where nullif(btrim(t.x), '') is not null;

    if v_centros is null or cardinality(v_centros) = 0 then
      raise exception 'La cadena "%" tramita POR CENTRO: hay que marcar al menos un centro.', v_cad.nombre;
    end if;
  end if;

  v_actor := public.merchan_my_app_user_id();
  select u.display_name into v_actor_nombre from public.app_users u where u.id = v_actor;

  foreach v_centro in array v_centros
  loop
    v_centro_nombre := null;
    if v_centro is not null then
      select c.nombre into v_centro_nombre
        from public.centros c
       where c.id = v_centro and c.cadena_id = v_cad.id;
      if v_centro_nombre is null then
        raise exception 'El centro % no existe o no pertenece a la cadena "%". Revisa el catálogo.', v_centro, v_cad.nombre;
      end if;
    end if;

    -- ¿Ya hay una solicitud VIVA para este mismo trabajador, cadena, centro y
    -- día? No se duplica: se informa y se sigue con los demás centros.
    if exists (
      select 1 from public.rrhh_solicitudes_acceso s
       where s.worker_id = v_worker
         and s.cadena_id = v_cad.id
         and coalesce(s.centro_id, '00000000-0000-0000-0000-000000000000'::uuid)
             = coalesce(v_centro, '00000000-0000-0000-0000-000000000000'::uuid)
         and s.fecha_trabajo = v_fecha
         and s.estado not in ('denegado', 'cancelado')
    ) then
      v_omitidas := v_omitidas || jsonb_build_object(
        'centro_id', v_centro,
        'motivo', 'ya existe una solicitud viva para ese trabajador, centro y día');
      continue;
    end if;

    v_codigo := public.merchan_next_rrhh_code('acceso');

    begin
      insert into public.rrhh_solicitudes_acceso (
        codigo, worker_id, worker_nombre, cadena_id, cadena_nombre,
        centro_id, centro_nombre, fecha_trabajo, fecha_limite,
        origen_tipo, origen_id, trabajo, estado,
        solicitada_por, solicitada_por_nombre
      ) values (
        v_codigo, v_worker, v_worker_nombre, v_cad.id, v_cad.nombre,
        v_centro, v_centro_nombre, v_fecha, v_limite,
        nullif(btrim(p_payload ->> 'origen_tipo'), ''),
        nullif(btrim(p_payload ->> 'origen_id'), ''),
        nullif(btrim(p_payload ->> 'trabajo'), ''),
        v_estado, v_actor, v_actor_nombre
      ) returning id into v_id;
    exception when unique_violation then
      -- Carrera con otra sesión que pidió lo mismo a la vez: el índice único
      -- parcial la ha parado. No es un error del usuario.
      v_omitidas := v_omitidas || jsonb_build_object(
        'centro_id', v_centro,
        'motivo', 'otra solicitud idéntica se creó a la vez');
      continue;
    end;

    -- Outbox: SOLO identificadores. Ni el nombre del trabajador ni el de la
    -- gestora salen de MerchanOps.
    perform public.outbox_publish(
      'rrhh_acceso:' || v_id::text || ':solicitado',
      'rrhh_acceso.solicitado',
      'merchanops',
      'rrhh_solicitud_acceso',
      v_id::text,
      jsonb_build_object(
        'acceso_id', v_id,
        'codigo', v_codigo,
        'worker_id', v_worker,
        'cadena_id', v_cad.id,
        'centro_id', v_centro,
        'fecha_trabajo', v_fecha,
        'fecha_limite', v_limite,
        'estado', v_estado
      )
    );

    v_creadas := v_creadas || jsonb_build_object('id', v_id, 'codigo', v_codigo, 'centro_id', v_centro);
  end loop;

  return jsonb_build_object(
    'creadas', v_creadas,
    'omitidas', v_omitidas,
    'modo_tramite', v_cad.modo_tramite,
    'lead_time_dias', v_cad.lead_time_dias,
    'fecha_limite', v_limite,
    'estado', v_estado
  );
end $function$;

revoke all on function public.merchan_rrhh_solicitar_acceso(jsonb) from public, anon;
grant execute on function public.merchan_rrhh_solicitar_acceso(jsonb) to authenticated, service_role;

comment on function public.merchan_rrhh_solicitar_acceso(jsonb) is
  'Crea las solicitudes de acceso expandiendo según cadenas.modo_tramite ("centro" = una por centro; "cadena" = una sola con centro_id NULL), calcula fecha_limite = fecha_trabajo - lead_time_dias y nace en "fuera_de_plazo" si ese día ya pasó. Devuelve {creadas:[{id,codigo}], omitidas, ...}.';

-- ===========================================================================
-- 5. RPC · RESOLVER
-- ===========================================================================
-- Payload esperado:
-- {
--   "acceso_id": "uuid",        (obligatorio)
--   "version": 2,               (opcional pero recomendado: bloqueo optimista)
--   "estado": "solicitado|concedido|concedido_no_consumido|denegado|cancelado",
--   "motivo": "texto",          (obligatorio para denegado y cancelado)
--   "consumido": true           (opcional: sella consumido_at = ahora)
-- }
create or replace function public.merchan_rrhh_resolver_acceso(p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_acc public.rrhh_solicitudes_acceso%rowtype;
  v_id uuid;
  v_estado text;
  v_motivo text;
  v_version integer;
  v_nueva_version integer;
  v_consumido timestamptz;
begin
  if not (public.merchan_is_admin() or public.merchan_is_rrhh()) then
    raise exception 'Solo RR.HH. o administración pueden conceder, denegar o cancelar un acceso.'
      using errcode = '42501';
  end if;

  v_id := nullif(btrim(p_payload ->> 'acceso_id'), '')::uuid;
  if v_id is null then
    raise exception 'Falta acceso_id: no se sabe qué solicitud de acceso hay que resolver.';
  end if;

  select * into v_acc from public.rrhh_solicitudes_acceso where id = v_id for update;
  if not found then
    raise exception 'Solicitud de acceso % no encontrada.', v_id;
  end if;

  v_version := nullif(btrim(p_payload ->> 'version'), '')::integer;
  if v_version is not null and v_version <> v_acc.version then
    raise exception 'Conflicto de concurrencia: el acceso % cambió desde tu lectura (versión en base %, tú traías la %). Recarga la tabla y vuelve a intentarlo.',
      v_acc.codigo, v_acc.version, v_version;
  end if;

  v_estado := coalesce(nullif(btrim(p_payload ->> 'estado'), ''), v_acc.estado);
  v_motivo := coalesce(nullif(btrim(p_payload ->> 'motivo'), ''), v_acc.motivo);

  if v_estado in ('denegado', 'cancelado') and coalesce(btrim(v_motivo), '') = '' then
    raise exception 'Dejar el acceso % en "%" exige un motivo escrito.', v_acc.codigo, v_estado;
  end if;

  v_consumido := case
    when coalesce((p_payload ->> 'consumido')::boolean, false) then coalesce(v_acc.consumido_at, now())
    else v_acc.consumido_at
  end;

  update public.rrhh_solicitudes_acceso set
    estado = v_estado,
    motivo = v_motivo,
    consumido_at = v_consumido
  where id = v_id
  returning version into v_nueva_version;

  perform public.outbox_publish(
    'rrhh_acceso:' || v_id::text || ':resuelto:' || v_nueva_version::text,
    'rrhh_acceso.resuelto',
    'merchanops',
    'rrhh_solicitud_acceso',
    v_id::text,
    jsonb_build_object(
      'acceso_id', v_id,
      'codigo', v_acc.codigo,
      'worker_id', v_acc.worker_id,
      'cadena_id', v_acc.cadena_id,
      'centro_id', v_acc.centro_id,
      'estado_anterior', v_acc.estado,
      'estado', v_estado,
      'version', v_nueva_version
    )
  );

  return jsonb_build_object(
    'acceso_id', v_id,
    'codigo', v_acc.codigo,
    'estado', v_estado,
    'version', v_nueva_version
  );
end $function$;

revoke all on function public.merchan_rrhh_resolver_acceso(jsonb) from public, anon;
grant execute on function public.merchan_rrhh_resolver_acceso(jsonb) to authenticated, service_role;

comment on function public.merchan_rrhh_resolver_acceso(jsonb) is
  'Concede, deniega, cancela o marca como no consumida una solicitud de acceso. Exige motivo en negativo y admite bloqueo optimista por "version". Solo admin o rol rrhh.';

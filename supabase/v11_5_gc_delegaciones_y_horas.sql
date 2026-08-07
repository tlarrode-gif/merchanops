-- v11_5 · Grandes Campañas: rol DELEGACIÓN, campañas por delegaciones y pago por
-- horas con kilometraje.
--
-- ============================================================================
-- PROBLEMA
-- ============================================================================
-- 1. Hay servicios SUBCONTRATADOS: en algunas provincias no gestiona el gestor de
--    la casa sino una empresa externa. Hoy solo existen los roles admin, manager,
--    almacen y rrhh, así que a esa empresa había que darla de alta como `manager`
--    y quedaba indistinguible de la plantilla propia: ni se podía decir «esta
--    campaña la llevan las delegaciones» ni auditar quién es externo.
--
-- 2. La subcontrata NO es por empresa sino POR CAMPAÑA: «no siempre son todas a la
--    vez». Hace falta activar el modo delegación campaña a campaña y elegir qué
--    delegaciones entran; las provincias de las delegaciones NO elegidas siguen
--    siendo de los gestores, exactamente como hasta ahora.
--
-- 3. Hay campañas que se pagan POR HORAS, no por punto. Hoy `puntos_venta_campana`
--    solo tiene `importe`, así que la hora de entrada, la de salida y el
--    kilometraje reportado no tenían dónde vivir y el motor de pagos no podía
--    calcular nada distinto de «importe del punto».
--
-- ============================================================================
-- DECISIONES
-- ============================================================================
-- a) `delegacion` entra en el CHECK de `app_users.role`. NO se le da ninguna rama
--    nueva de RLS a propósito: su alcance es EXACTAMENTE el de un gestor
--    (provincias de `app_users.provinces`), y todas las policies operativas
--    filtran por `merchan_province_scope()`, que no mira el rol. Es decir, una
--    delegación ve lo mismo que vería un gestor con esas provincias, ni más ni
--    menos. Lo contrario —una rama propia— es justo el error que documentaron
--    v9_11 (almacén) y v10_4 (RR.HH.).
--
-- b) `campana_delegaciones` es una tabla aparte de `campana_gestores` y no una
--    columna de esta. Motivo: el equipo de gestores de una campaña y las
--    delegaciones que la cubren son dos listas con significados distintos —una es
--    «quién puede trabajarla», la otra «en qué zonas manda un externo»— y
--    mezclarlas obligaría a mirar el rol del usuario en cada consulta para saber
--    qué significa cada fila. Sus policies son copia literal de las de
--    `campana_gestores`: lectura por provincia o por ser la persona asignada,
--    escritura solo administración.
--
-- c) Las tarifas (hora y kilómetro) viven en la CAMPAÑA, no en el punto: las
--    configura administración una vez y valen para toda la campaña. Los datos
--    reportados (entrada, salida, kilómetros) viven en el PUNTO, que es la unidad
--    que se importa y se actualiza desde el Excel del reporte.
--
-- d) `horas_trabajadas` es una columna GUARDADA, no un cálculo al vuelo, porque el
--    Excel del cliente a veces trae las horas ya sumadas y sin entrada/salida. La
--    aplicación la deriva de entrada/salida cuando ambas existen (lib/campana-horas.ts)
--    y respeta el valor importado cuando no. Un turno que cruza la medianoche NO se
--    adivina: se bloquea el pago y se avisa, porque «entrada 22:00 / salida 06:00»
--    es tan probable que sea un turno de noche como que sea una celda mal tecleada.
--
-- e) `payment_obligations.type` admite `mileage`. El kilometraje es una obligación
--    PROPIA y no una suma dentro de la de horas: se aprueba, se bloquea y se
--    liquida por separado, y en la nómina del trabajador es un concepto distinto.
--
-- ============================================================================
-- VERIFICACIÓN (tras aplicar)
-- ============================================================================
--   -- el rol existe
--   insert into app_users (id, username, password, display_name, role)
--     values ('tmp_del', 'tmp_del', 'x', 'Tmp', 'delegacion');   -- esperado: OK
--   delete from app_users where id = 'tmp_del';
--   -- las columnas nuevas existen y son nulas en lo ya guardado
--   select count(*) from grandes_campanas where delegaciones_activas is null;  -- 0
--   select count(*) from puntos_venta_campana where kilometros is not null;    -- 0
--   -- el tipo nuevo de obligación se acepta
--   select 'mileage' = any (enum_range_text) from (select array['installation','failed_visit','points','hours','mileage','adjustment','reversal'] as enum_range_text) t;
--   -- una gestora NO puede escribir delegaciones (con su sesión):
--   insert into campana_delegaciones (campana_id, delegacion_id) values (...);  -- esperado: 42501
--
-- ROLLBACK:
--   drop table if exists public.campana_delegaciones;
--   alter table public.grandes_campanas
--     drop column if exists delegaciones_activas,
--     drop column if exists pago_por_horas,
--     drop column if exists tarifa_hora,
--     drop column if exists pago_kilometraje,
--     drop column if exists tarifa_km;
--   alter table public.puntos_venta_campana
--     drop column if exists hora_entrada,
--     drop column if exists hora_salida,
--     drop column if exists horas_trabajadas,
--     drop column if exists kilometros;
--   alter table public.payment_obligations drop constraint if exists payment_obligations_type_check;
--   alter table public.payment_obligations add constraint payment_obligations_type_check
--     check (type = any (array['installation','failed_visit','points','hours','adjustment','reversal']));
--   alter table public.app_users drop constraint if exists app_users_role_check;
--   alter table public.app_users add constraint app_users_role_check
--     check (role = any (array['admin','manager','almacen','rrhh']));
--   (el rollback del CHECK falla si ya existe algún usuario con role='delegacion',
--    y el de payment_obligations si ya hay obligaciones de tipo 'mileage')

-- ---------------------------------------------------------------------------
-- 1. El rol delegación existe
-- ---------------------------------------------------------------------------
alter table public.app_users drop constraint if exists app_users_role_check;
alter table public.app_users add constraint app_users_role_check
  check (role = any (array['admin'::text, 'manager'::text, 'delegacion'::text, 'almacen'::text, 'rrhh'::text]));

comment on column public.app_users.role is
  'admin | manager | delegacion | almacen | rrhh. `delegacion` es un gestor SUBCONTRATADO: mismo alcance provincial y misma matriz de permisos que `manager` (por eso no tiene ni una sola rama propia de RLS); lo único que cambia es que en las campañas con delegaciones_activas es él quien recibe los puntos de sus provincias en lugar del gestor interno.';

-- Backfill del permiso 'rrhh' también para el rol nuevo: normalizeUser() lo hereda
-- de defaultPermissions en el cliente, así que sin esto la interfaz enseñaría el
-- módulo y merchan_can_rrhh() —que lee el jsonb real— lo negaría (lección de v10_4).
update public.app_users
   set permissions = coalesce(permissions, '{}'::jsonb) || jsonb_build_object('rrhh', true)
 where role = 'delegacion'
   and not (coalesce(permissions, '{}'::jsonb) ? 'rrhh');

-- ---------------------------------------------------------------------------
-- 2. Campaña por delegaciones
-- ---------------------------------------------------------------------------
alter table public.grandes_campanas
  add column if not exists delegaciones_activas boolean not null default false;

comment on column public.grandes_campanas.delegaciones_activas is
  'true = campaña gestionada por delegaciones. Las provincias cubiertas por alguna delegación de campana_delegaciones pasan a esa delegación; el RESTO sigue siendo de los gestores, igual que antes de v11.5. En false la tabla campana_delegaciones se ignora por completo.';

create table if not exists public.campana_delegaciones (
  id uuid primary key default gen_random_uuid(),
  campana_id uuid not null references public.grandes_campanas(id) on delete cascade,
  delegacion_id text references public.app_users(id) on delete cascade,
  delegacion_nombre text,
  -- Zonas que cubre la delegación EN ESTA campaña. Vacío = todas las suyas
  -- (app_users.provinces). Permite subcontratar solo parte de su territorio.
  provincias text[] not null default '{}',
  assigned_at timestamptz default now(),
  unique (campana_id, delegacion_id)
);

comment on table public.campana_delegaciones is
  'Delegaciones (gestores subcontratados) que cubren una campaña. Solo tiene efecto si grandes_campanas.delegaciones_activas es true. Una provincia sin delegación en esta lista la siguen llevando los gestores.';

create index if not exists idx_campana_delegaciones_campana on public.campana_delegaciones(campana_id);
create index if not exists idx_campana_delegaciones_delegacion on public.campana_delegaciones(delegacion_id);

alter table public.campana_delegaciones enable row level security;

-- Copia literal del par de policies de campana_gestores (v9_11): se lee si la
-- provincia entra en mi ámbito o si la asignada soy yo; escribe solo administración.
drop policy if exists delegaciones_read on public.campana_delegaciones;
create policy delegaciones_read on public.campana_delegaciones for select to authenticated
using (
  (select public.merchan_is_admin())
  or ((select public.merchan_has_profile()) and (
        delegacion_id = (select public.merchan_my_app_user_id())
     or cardinality(provincias) = 0
     or exists (select 1 from unnest(provincias) x
                 where public.merchan_norm_province(x) = any (((select public.merchan_province_scope()))::text[]))
  ))
);

drop policy if exists delegaciones_admin_write on public.campana_delegaciones;
create policy delegaciones_admin_write on public.campana_delegaciones for all to authenticated
using ((select public.merchan_is_admin())) with check ((select public.merchan_is_admin()));

-- Los privilegios por defecto del proyecto ya conceden la tabla entera a
-- `authenticated`; se escriben igualmente para que el fichero valga en una base
-- limpia sin depender de esa configuración. Quien filtra de verdad es la RLS.
grant select, insert, update, delete on public.campana_delegaciones to authenticated;
grant all on public.campana_delegaciones to service_role;

-- ---------------------------------------------------------------------------
-- 3. Pago por horas y kilometraje
-- ---------------------------------------------------------------------------
alter table public.grandes_campanas
  add column if not exists pago_por_horas boolean not null default false,
  add column if not exists tarifa_hora numeric(10,2),
  add column if not exists pago_kilometraje boolean not null default false,
  add column if not exists tarifa_km numeric(10,4);

comment on column public.grandes_campanas.pago_por_horas is
  'true = al trabajador se le paga por HORAS (horas_trabajadas x tarifa_hora), no por el importe del punto. La configura administración; el gestor la ve pero no la cambia.';
comment on column public.grandes_campanas.tarifa_hora is
  'Precio de la hora del trabajador, en euros. Sin tarifa el pago por horas queda BLOQUEADO en Pagos en vez de calcularse a 0.';
comment on column public.grandes_campanas.pago_kilometraje is
  'true = además se paga el kilometraje reportado en cada punto (kilometros x tarifa_km). Es independiente del pago por horas: una campaña por puntos también puede pagar desplazamientos.';
comment on column public.grandes_campanas.tarifa_km is
  'Precio del kilómetro, en euros. Cuatro decimales porque las tarifas legales van a 0,26 €/km y algunas empresas afinan más.';

alter table public.puntos_venta_campana
  add column if not exists hora_entrada time,
  add column if not exists hora_salida time,
  add column if not exists horas_trabajadas numeric(6,2),
  add column if not exists kilometros numeric(10,2);

comment on column public.puntos_venta_campana.hora_entrada is
  'Hora a la que el trabajador entró en el punto. Se rellena a mano o desde el Excel del reporte.';
comment on column public.puntos_venta_campana.hora_salida is
  'Hora a la que el trabajador salió del punto.';
comment on column public.puntos_venta_campana.horas_trabajadas is
  'Horas que se pagan. La aplicación la calcula desde hora_entrada/hora_salida cuando ambas existen; si el Excel trae las horas ya sumadas se guarda tal cual. Un turno con salida anterior a la entrada NO se interpreta como nocturno: se deja sin horas y el pago sale bloqueado.';
comment on column public.puntos_venta_campana.kilometros is
  'Kilometraje reportado del desplazamiento a este punto. Se paga a tarifa_km si la campaña tiene pago_kilometraje.';

-- Ni horas ni kilómetros negativos: un signo perdido en el Excel no puede
-- convertirse en un descuento silencioso en la nómina de nadie.
alter table public.puntos_venta_campana drop constraint if exists pvc_horas_no_negativas;
alter table public.puntos_venta_campana add constraint pvc_horas_no_negativas
  check (horas_trabajadas is null or horas_trabajadas >= 0);
alter table public.puntos_venta_campana drop constraint if exists pvc_km_no_negativos;
alter table public.puntos_venta_campana add constraint pvc_km_no_negativos
  check (kilometros is null or kilometros >= 0);

-- ---------------------------------------------------------------------------
-- 4. El ledger admite el kilometraje como obligación propia
-- ---------------------------------------------------------------------------
alter table public.payment_obligations drop constraint if exists payment_obligations_type_check;
alter table public.payment_obligations add constraint payment_obligations_type_check
  check (type = any (array['installation'::text, 'failed_visit'::text, 'points'::text, 'hours'::text, 'mileage'::text, 'adjustment'::text, 'reversal'::text]));

-- ---------------------------------------------------------------------------
-- 4.b Los KPIs cuentan lo que de verdad se paga
-- ---------------------------------------------------------------------------
-- `v_campana_kpis` sumaba SIEMPRE `puntos_venta_campana.importe`. En una campaña
-- por horas ese importe está vacío, así que el coste ejecutado, el importe total,
-- el margen del informe interno y las tarjetas del listado habrían salido a 0 €
-- con la campaña en marcha. Se recrea con la misma firma de columnas (así
-- `v_campanas_listado`, que la consume, no hay que tocarla) y el valor del punto
-- pasa a depender del modo de la campaña. Es el espejo SQL de valorPuntoEur()
-- en lib/campana-horas.ts.
create or replace view public.v_campana_kpis as
select
  c.id as campana_id,
  count(p.id) as total_puntos,
  count(p.id) filter (where p.estado = 'completado') as completados,
  count(p.id) filter (where p.estado = 'pendiente') as pendientes,
  count(p.id) filter (where p.gestor_id is not null or p.gestor_nombre is not null) as asignados,
  coalesce((select count(*) from public.incidencias_campana i where i.campana_id = c.id and i.estado <> 'resuelta'), 0) as incidencias_abiertas,
  coalesce(sum(
    case when c.pago_por_horas then coalesce(p.horas_trabajadas, 0) * coalesce(c.tarifa_hora, 0)
         else coalesce(p.importe, 0) end
    + case when c.pago_kilometraje then coalesce(p.kilometros, 0) * coalesce(c.tarifa_km, 0) else 0 end
  ) filter (where p.estado = 'completado'), 0) as coste_ejecutado,
  coalesce(sum(
    case when c.pago_por_horas then coalesce(p.horas_trabajadas, 0) * coalesce(c.tarifa_hora, 0)
         else coalesce(p.importe, 0) end
    + case when c.pago_kilometraje then coalesce(p.kilometros, 0) * coalesce(c.tarifa_km, 0) else 0 end
  ), 0) as importe_total,
  case when c.fecha_fin is null then null else (c.fecha_fin - current_date) end as dias_restantes
from public.grandes_campanas c
left join public.puntos_venta_campana p on p.campana_id = c.id
group by c.id;

-- ---------------------------------------------------------------------------
-- 5. La bitácora de puntos vigila también los campos nuevos
-- ---------------------------------------------------------------------------
-- El trigger de v11_0 audita una lista FIJA de columnas. Sin añadir aquí las
-- cuatro nuevas, cambiar las horas o los kilómetros de un punto —que es cambiar
-- lo que se le paga a una persona— no dejaría ni una línea en el Historial.
-- Copia literal de v11_0 con `v_campos` ampliado; no cambia nada más.
create or replace function public.merchan_gc_punto_auditoria()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_perfil public.app_users;
  v_actor_id text;
  v_actor_nombre text;
  v_origen text;
  v_campos text[] := array[
    'estado', 'importe', 'fecha_visita', 'codigo', 'nombre_comercial',
    'direccion', 'provincia', 'tipo', 'gestor_id', 'gestor_nombre',
    'instalador_id', 'instalador_nombre', 'direccion_envio', 'notas',
    'centro_id', 'picking_cerrado_at',
    -- v11_5: lo que se reporta del turno y del desplazamiento.
    'hora_entrada', 'hora_salida', 'horas_trabajadas', 'kilometros'
  ];
  v_campo text;
  v_old jsonb;
  v_new jsonb;
  v_antes text;
  v_despues text;
begin
  -- El actor sale del JWT, jamás del cliente (D4).
  v_perfil := public.merchan_auth_profile();
  v_actor_id := v_perfil.id;
  v_actor_nombre := coalesce(nullif(v_perfil.display_name, ''), 'Sistema');

  if tg_op = 'DELETE' then
    insert into public.campana_punto_eventos
      (punto_id, campana_id, punto_nombre, accion, actor_id, actor_nombre, origen)
    values
      (old.id, old.campana_id, old.nombre_comercial, 'borrado', v_actor_id, v_actor_nombre,
       coalesce(nullif(old.origen_ultimo_cambio, ''), 'desconocido'));
    return old;
  end if;

  v_origen := coalesce(nullif(new.origen_ultimo_cambio, ''), 'desconocido');

  if tg_op = 'INSERT' then
    insert into public.campana_punto_eventos
      (punto_id, campana_id, punto_nombre, accion, actor_id, actor_nombre, origen)
    values
      (new.id, new.campana_id, new.nombre_comercial, 'creado', v_actor_id, v_actor_nombre, v_origen);
    return new;
  end if;

  -- UPDATE: una fila por campo vigilado que cambie (D3). Un UPDATE que solo
  -- toca updated_at no deja rastro, que es justo lo que se quiere.
  v_old := to_jsonb(old);
  v_new := to_jsonb(new);
  foreach v_campo in array v_campos loop
    v_antes := v_old ->> v_campo;
    v_despues := v_new ->> v_campo;
    if v_antes is distinct from v_despues then
      insert into public.campana_punto_eventos
        (punto_id, campana_id, punto_nombre, accion, campo, valor_anterior, valor_nuevo,
         actor_id, actor_nombre, origen)
      values
        (new.id, new.campana_id, new.nombre_comercial, 'actualizado', v_campo, v_antes, v_despues,
         v_actor_id, v_actor_nombre, v_origen);
    end if;
  end loop;

  return new;
end $$;

comment on function public.merchan_gc_punto_auditoria() is
  'Escribe la bitácora de un punto de gran campaña. SECURITY DEFINER porque campana_punto_eventos no tiene policy de INSERT para nadie: el trigger es su única puerta. v11_5 añade horas y kilómetros a los campos vigilados.';

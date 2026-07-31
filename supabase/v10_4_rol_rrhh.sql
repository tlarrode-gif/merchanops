-- v10_4 · El rol `rrhh` existe en la base, y el perfil de RR.HH. deja de ver cero filas.
-- PENDIENTE DE APLICAR al proyecto dptmswhwmqimijpfyndn.
--
-- ============================================================================
-- PROBLEMA
-- ============================================================================
-- 1. `lib/access-control.ts` ya declara el rol 'rrhh' (AppRole), su matriz de
--    permisos (rrhhPermissions), isRrhhSession() y canManageRrhh(). La base NO:
--    `app_users_role_check` solo admite ('admin','manager','almacen'), así que
--    dar de alta a la persona de RR.HH. falla con 23514 antes de poder entrar.
--
-- 2. El perfil de RR.HH. es NACIONAL: trabaja con todas las provincias y no se
--    le asigna ninguna (`provinces = '{}'`). Es exactamente la trampa que
--    documentó v9_9 para el rol `almacen`: las policies operativas solo tienen
--    rama de admin y rama de provincia, y con ámbito vacío `= ANY('{}')` es
--    falso para todo. Sin una rama propia, RR.HH. entraría a su módulo y vería
--    CERO trabajadores, CERO servicios, CERO campañas y CERO puntos: es decir,
--    ningún trabajo pendiente de alta que tramitar. El módulo nacería vacío.
--
-- 3. Para casar un alta con A3 el día que exista la API hace falta guardar el
--    identificador de empleado de A3. Hoy no hay dónde.
--
-- ============================================================================
-- DECISIÓN
-- ============================================================================
-- a) `app_users.role` admite 'rrhh'.
--
-- b) Dos helpers, y la diferencia entre ambos es la clave de seguridad de todo
--    el módulo (ver el comentario largo junto a merchan_can_rrhh):
--      · merchan_is_rrhh()  = ROL dedicado. Es quien TRAMITA.
--      · merchan_can_rrhh() = admin OR rol rrhh OR permiso 'rrhh'. Es quien
--        ENTRA al módulo a solicitar. Como `defaultPermissions.rrhh = true`,
--        eso incluye a TODAS las gestoras.
--
-- c) Rama explícita de `merchan_is_rrhh()` —el ROL, nunca el permiso— para que
--    RR.HH. vea workers, services, points, grandes_campanas y
--    puntos_venta_campana de toda España. Solo LECTURA: RR.HH. no es dueño de
--    ninguna de esas tablas, solo las consulta para construir la lista de
--    trabajos pendientes de alta.
--
-- d) `workers.a3_empleado_codigo`: SOLO el identificador de A3. Ningún dato
--    personal (decisión D2 del usuario, ver docs/ROADMAP_RRHH.md).
--
-- ============================================================================
-- POR QUÉ LA RAMA NUEVA NO VA DENTRO DE `province_scope_all`
-- ============================================================================
-- `province_scope_all` es una policy FOR ALL. En una policy FOR ALL el
-- predicado USING gobierna SELECT, UPDATE **y DELETE**: meter ahí la rama de
-- RR.HH. le daría, de regalo, permiso para BORRAR los 25 trabajadores, los 247
-- servicios, los 1.012 puntos de campaña y las 4 campañas. No es lo que se
-- quiere ni lo que necesita.
--
-- Como las policies permisivas se combinan con OR, una policy adicional
-- `rrhh_perfil_read` FOR SELECT logra exactamente la visibilidad buscada sin
-- abrir un solo camino de escritura. Las `province_scope_all` se reescriben
-- aquí IDÉNTICAS a como están hoy en la base (verificado contra pg_policies
-- antes de escribir este fichero) para que el fichero sea autocontenido y
-- re-aplicable; no cambia una sola regla de acceso de las existentes.
--
-- La excepción es `grandes_campanas`, cuya policy de lectura (`campanas_read`,
-- v9_11) YA está separada de la de escritura: ahí la rama nueva sí va dentro,
-- que es su sitio natural.
--
-- RR.HH. tampoco recibe UPDATE sobre `workers`. El único campo suyo de esa
-- tabla es `a3_empleado_codigo`, y una policy de UPDATE le dejaría reescribir
-- también nombre, teléfono y provincia. Ese campo lo sella el RPC
-- `merchan_rrhh_registrar_alta` (v10_6), que es SECURITY DEFINER y solo toca
-- esa columna.
--
-- ============================================================================
-- VERIFICACIÓN (ejecutar tras aplicar, con la sesión del perfil de RR.HH.)
-- ============================================================================
--   select count(*) from workers;               -- esperado: todos (hoy 25)
--   select count(*) from services;              -- esperado: todos (hoy 247)
--   select count(*) from grandes_campanas;      -- esperado: todas (hoy 4)
--   select count(*) from puntos_venta_campana;  -- esperado: todos (hoy 1.012)
--   delete from workers where false;            -- esperado: 0 filas, sin error
--   update workers set phone = phone;           -- esperado: 0 filas afectadas
-- Y con la sesión de una gestora, que NO debe cambiar nada:
--   select count(*) from puntos_venta_campana;  -- esperado: igual que antes
--
-- ROLLBACK:
--   drop policy if exists rrhh_perfil_read on public.workers;
--   drop policy if exists rrhh_perfil_read on public.services;
--   drop policy if exists rrhh_perfil_read on public.points;
--   drop policy if exists rrhh_perfil_read on public.puntos_venta_campana;
--   -- y volver a ejecutar v9_11_rls_scope_by_province.sql para campanas_read
--   drop function if exists public.merchan_can_rrhh();
--   drop function if exists public.merchan_is_rrhh();
--   alter table public.app_users drop constraint if exists app_users_role_check;
--   alter table public.app_users add constraint app_users_role_check
--     check (role = any (array['admin'::text, 'manager'::text, 'almacen'::text]));
--   alter table public.workers drop column if exists a3_empleado_codigo;
--   (el rollback del CHECK falla si ya existe algún usuario con role='rrhh')

-- ---------------------------------------------------------------------------
-- 1. El rol existe
-- ---------------------------------------------------------------------------
alter table public.app_users drop constraint if exists app_users_role_check;
alter table public.app_users add constraint app_users_role_check
  check (role = any (array['admin'::text, 'manager'::text, 'almacen'::text, 'rrhh'::text]));

-- ---------------------------------------------------------------------------
-- 2. Helpers
-- ---------------------------------------------------------------------------
-- Rol dedicado de RR.HH. Mira el ROL, jamás el permiso: es el espejo exacto de
-- isRrhhSession()/canManageRrhh() de lib/access-control.ts.
create or replace function public.merchan_is_rrhh()
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select coalesce((public.merchan_auth_profile()).role = 'rrhh', false);
$function$;

revoke all on function public.merchan_is_rrhh() from public, anon;
grant execute on function public.merchan_is_rrhh() to authenticated, service_role;

comment on function public.merchan_is_rrhh() is
  'TRUE si el usuario autenticado tiene el ROL dedicado rrhh. Es quien TRAMITA: rellena el número de A3, cambia estados y mantiene el catálogo de cadenas. Espejo de isRrhhSession() en lib/access-control.ts.';

-- ¡¡ATENCIÓN!! ESTE HELPER INCLUYE A TODAS LAS GESTORAS.
--
-- `defaultPermissions.rrhh = true` en lib/access-control.ts: el módulo de RR.HH.
-- nace ABIERTO para los gestores, porque son ellos quienes solicitan las altas y
-- los accesos de sus trabajadores. Por tanto `permissions->>'rrhh'` es true para
-- prácticamente todo el mundo y merchan_can_rrhh() ≈ "tiene perfil".
--
-- CONSECUENCIA, Y ES LA REGLA MÁS IMPORTANTE DE ESTE FICHERO:
-- merchan_can_rrhh() NO SE PUEDE USAR NUNCA COMO RAMA DE ESCAPE EN UNA POLICY
-- CON FILTRO PROVINCIAL DE OTRA TABLA (services, workers, points,
-- grandes_campanas, puntos_venta_campana, isdin_*, payment_*...). Hacerlo
-- anularía el filtro por provincia de v9_11 para todas las gestoras de golpe:
-- es EXACTAMENTE el fallo que v9_11 documentó al intentar usar
-- merchan_can_logistics() como escape para el rol almacén.
--
-- Su único uso legítimo es como PUERTA DEL MÓDULO dentro de las tablas propias
-- de RR.HH. (rrhh_*, cadenas, centros), donde "cualquiera que pueda solicitar"
-- es precisamente el criterio correcto. Para todo lo demás: merchan_is_rrhh().
create or replace function public.merchan_can_rrhh()
returns boolean
language sql
stable
security definer
set search_path = ''
as $function$
  select public.merchan_is_admin()
      or public.merchan_is_rrhh()
      or coalesce(((public.merchan_auth_profile()).permissions ->> 'rrhh')::boolean, false);
$function$;

revoke all on function public.merchan_can_rrhh() from public, anon;
grant execute on function public.merchan_can_rrhh() to authenticated, service_role;

comment on function public.merchan_can_rrhh() is
  'Puerta del MÓDULO de RR.HH.: admin OR rol rrhh OR permiso rrhh. OJO: defaultPermissions.rrhh=true, así que incluye a TODAS las gestoras. Uso exclusivo en las tablas del módulo (rrhh_*, cadenas, centros); jamás como escape en policies con filtro provincial de otras tablas.';

-- ---------------------------------------------------------------------------
-- 2.b Backfill del permiso 'rrhh' en los usuarios que ya existen
-- ---------------------------------------------------------------------------
-- SIN ESTO EL MÓDULO SE ABRE EN LA INTERFAZ Y SE CIERRA EN LA BASE. El cliente
-- calcula los permisos con { ...defaultPermissions, ...(fila.permissions) }
-- (normalizeUser, lib/access-control.ts), así que una gestora dada de alta
-- ANTES de que existiera la clave hereda rrhh=true y ve el menú; pero
-- merchan_can_rrhh() lee el jsonb REAL, donde la clave no está, y le devuelve
-- false: vería la pantalla y cada acción moriría con un 42501.
-- El backfill deja la base diciendo exactamente lo mismo que el cliente.
update public.app_users
   set permissions = coalesce(permissions, '{}'::jsonb) || jsonb_build_object('rrhh', true)
 where role in ('admin', 'manager')
   and not (coalesce(permissions, '{}'::jsonb) ? 'rrhh');

-- Almacén (picking móvil de MerchanLOGS) no entra en RR.HH.: se le fija en
-- false explícitamente para que la clave exista y nadie la herede por descuido.
update public.app_users
   set permissions = coalesce(permissions, '{}'::jsonb) || jsonb_build_object('rrhh', false)
 where role = 'almacen'
   and not (coalesce(permissions, '{}'::jsonb) ? 'rrhh');

-- ---------------------------------------------------------------------------
-- 3. workers: identificador de A3, y NADA más
-- ---------------------------------------------------------------------------
alter table public.workers add column if not exists a3_empleado_codigo text;

comment on column public.workers.a3_empleado_codigo is
  'Identificador del empleado en A3, ÚNICAMENTE para casar el alta el día que exista la API de A3. MerchanOps NO guarda datos personales del trabajador: ni DNI, ni NIE, ni NAF, ni IBAN, ni fecha de nacimiento, ni domicilio. Esos datos viven SOLO en A3 (decisión D2). Si alguna vez hace falta uno de ellos, se consulta a A3; no se copia aquí.';

create index if not exists idx_workers_a3_empleado_codigo
  on public.workers (a3_empleado_codigo) where a3_empleado_codigo is not null;

-- ---------------------------------------------------------------------------
-- 4. Visibilidad del perfil de RR.HH. (SELECT, y solo SELECT)
-- ---------------------------------------------------------------------------
-- 4.1 workers · policy existente recreada IDÉNTICA (v9_8) + policy de lectura nueva.
drop policy if exists province_scope_all on public.workers;
create policy province_scope_all on public.workers
  for all to authenticated
  using (
    (select public.merchan_is_admin())
    or (((select public.merchan_has_profile()) and not (select public.merchan_is_rrhh()))
        and (province is null
             or public.merchan_norm_province(province) = any (((select public.merchan_province_scope()))::text[])))
  )
  with check (
    (select public.merchan_is_admin())
    or (((select public.merchan_has_profile()) and not (select public.merchan_is_rrhh()))
        and (province is null
             or public.merchan_norm_province(province) = any (((select public.merchan_province_scope()))::text[])))
  );

drop policy if exists rrhh_perfil_read on public.workers;
create policy rrhh_perfil_read on public.workers
  for select to authenticated
  using ((select public.merchan_is_rrhh()));

-- 4.2 services · policy existente recreada IDÉNTICA (v9_9) + policy de lectura nueva.
drop policy if exists province_scope_all on public.services;
create policy province_scope_all on public.services
  for all to authenticated
  using (
    (select public.merchan_is_admin())
    or (((select public.merchan_has_profile()) and not (select public.merchan_is_rrhh()))
        and (province is null
             or public.merchan_norm_province(province) = any (((select public.merchan_province_scope()))::text[])))
    or ((select public.merchan_is_almacen())
        and (logistics_request_id is not null
             or exists (select 1 from public.logistics_material_requirements r
                         where r.service_id = services.id::text)))
  )
  with check (
    (select public.merchan_is_admin())
    or (((select public.merchan_has_profile()) and not (select public.merchan_is_rrhh()))
        and (province is null
             or public.merchan_norm_province(province) = any (((select public.merchan_province_scope()))::text[])))
    or ((select public.merchan_is_almacen())
        and (logistics_request_id is not null
             or exists (select 1 from public.logistics_material_requirements r
                         where r.service_id = services.id::text)))
  );

drop policy if exists rrhh_perfil_read on public.services;
create policy rrhh_perfil_read on public.services
  for select to authenticated
  using ((select public.merchan_is_rrhh()));

-- 4.3 points · policy existente recreada IDÉNTICA (v9_8_rls_points_via_service)
--     + policy de lectura nueva.
drop policy if exists province_scope_all on public.points;
create policy province_scope_all on public.points
  for all to authenticated
  using (
    (select public.merchan_is_admin())
    or (
      ((select public.merchan_has_profile()) and not (select public.merchan_is_rrhh()))
      and exists (
        select 1
        from public.services s
        where s.id = points.service_id
          and (
            s.province is null
            or public.merchan_norm_province(s.province) = any (
              ((select public.merchan_province_scope()))::text[]
            )
          )
      )
    )
  )
  with check (
    (select public.merchan_is_admin())
    or (
      ((select public.merchan_has_profile()) and not (select public.merchan_is_rrhh()))
      and exists (
        select 1
        from public.services s
        where s.id = points.service_id
          and (
            s.province is null
            or public.merchan_norm_province(s.province) = any (
              ((select public.merchan_province_scope()))::text[]
            )
          )
      )
    )
  );

drop policy if exists rrhh_perfil_read on public.points;
create policy rrhh_perfil_read on public.points
  for select to authenticated
  using ((select public.merchan_is_rrhh()));

-- 4.4 puntos_venta_campana · policy existente recreada IDÉNTICA (v9_8)
--     + policy de lectura nueva. De aquí sale el CECO y la fecha de cada
--     trabajo pendiente de alta, así que sin esta rama no hay módulo.
drop policy if exists province_scope_all on public.puntos_venta_campana;
create policy province_scope_all on public.puntos_venta_campana
  for all to authenticated
  using (
    (select public.merchan_is_admin())
    or (((select public.merchan_has_profile()) and not (select public.merchan_is_rrhh()))
        and (provincia is null
             or public.merchan_norm_province(provincia) = any (((select public.merchan_province_scope()))::text[])))
  )
  with check (
    (select public.merchan_is_admin())
    or (((select public.merchan_has_profile()) and not (select public.merchan_is_rrhh()))
        and (provincia is null
             or public.merchan_norm_province(provincia) = any (((select public.merchan_province_scope()))::text[])))
  );

drop policy if exists rrhh_perfil_read on public.puntos_venta_campana;
create policy rrhh_perfil_read on public.puntos_venta_campana
  for select to authenticated
  using ((select public.merchan_is_rrhh()));

-- 4.5 grandes_campanas · aquí la rama SÍ va dentro de la policy existente,
--     porque `campanas_read` ya es FOR SELECT: la escritura sigue viviendo en
--     `campanas_admin_write` (solo admin) y no se toca. Copia literal de v9_11
--     con una única línea nueva.
drop policy if exists campanas_read on public.grandes_campanas;
create policy campanas_read on public.grandes_campanas
  for select to authenticated
  using (
    (select public.merchan_is_admin())
    -- El rol almacén no tiene provincias asignadas, así que el filtro lo dejaba
    -- sin ninguna campaña; MerchanLOGS las necesita para etiquetar pickings,
    -- envíos y peticiones. Solo lectura: la escritura sigue siendo de admin.
    or (select public.merchan_is_almacen())
    -- v10_4: el perfil de RR.HH. tampoco tiene provincias y necesita la campaña
    -- entera (nombre, CECO y horas/día) para proponer el alta. Solo lectura.
    or (select public.merchan_is_rrhh())
    or ((select public.merchan_has_profile()) and (
          exists (select 1 from public.puntos_venta_campana p where p.campana_id = grandes_campanas.id)
       or (provincias is not null and cardinality(provincias) > 0
           and exists (select 1 from unnest(provincias) x
                       where public.merchan_norm_province(x) = any (((select public.merchan_province_scope()))::text[])))
       or created_by = (select public.merchan_my_app_user_id())
    ))
  );

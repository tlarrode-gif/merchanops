-- v9_9 — Ola 4: el rol `almacen` puede trabajar, y la lectura de logística
-- pasa a ser por MÓDULO en vez de por «tener perfil».
--
-- CONTEXTO (verificado contra el repo de MerchanLOGS, no supuesto)
-- MerchanLOGS comparte este proyecto Supabase y entra como `authenticated` con
-- los MISMOS `app_users` (services/session.ts: merchan_auth_bootstrap +
-- signInWithPassword). No usa `service_role` en ninguna parte: la RLS es la
-- frontera compartida real. Es co-propietario de escritura de las `logistics_*`
-- y mantiene un «espejo de retorno» hacia OPS por lista blanca de columnas
-- (services/ops-mirror.ts), documentado en su docs/SUPABASE_RECONCILIATION.md.
--
-- EL PROBLEMA
-- Las policies de `services` e `isdin_vinyls` solo tienen rama de admin y rama
-- de provincia. El usuario `almacen` tiene `provinces = '{}'`, y NO hay filas
-- con provincia nula en ninguna de las dos tablas, así que con scope vacío
-- `= ANY('{}')` es falso para todo: **un usuario de almacén ve CERO servicios y
-- CERO vinilos**, y cada escritura del espejo a esas tablas falla. Falla además
-- en silencio, porque el espejo es best-effort por diseño («si falla, la
-- operación principal de LOGS no se rompe»).
--
-- Que hoy no haya saltado se explica porque LOGS se ejerció el 2026-07-12 con
-- actor `admin` (payload del evento outbox ship:e7c23c3d), y el administrador
-- es la primera rama de todas las policies. En cuanto entre un usuario de
-- almacén real —y son los únicos usuarios de LOGS— el espejo deja de funcionar.
--
-- ÁMBITO CONCEDIDO
-- Al almacén NO se le abre la tabla entera: solo las filas que ya han pasado
-- por logística. Medido antes de aplicar:
--   services      →   5 de 254  (2 %)
--   isdin_vinyls  →  78 de 475  (16 %)
--
-- El enlace se toma de las columnas que USA el espejo (`logistics_request_id`),
-- más el respaldo por `logistics_material_requirements`. Se incluyen las dos
-- vías a propósito: 74 filas de `isdin_vinyls` tienen `logistics_request_id`
-- huérfano (no casa con `logistics_requests` ni con `logistics_material_
-- requirements.request_id`), un problema de datos anterior a esta migración que
-- queda reportado aparte. Cubrir ambas vías hace que la policy funcione tanto
-- si esas referencias se limpian como si no.
--
-- POR QUÉ NO SE ACOTA POR PROVINCIA EL RESTO DE LOGÍSTICA
-- Porque el modelo logístico es de almacén, no de territorio: solo 2 de las 20
-- tablas `logistics_*` tienen columna de provincia, y un operario prepara
-- picking para todas las zonas. Acotarlas habría roto justo el trabajo de LOGS.

-- ---------------------------------------------------------------------------
-- 1. `services`: rama de almacén
-- ---------------------------------------------------------------------------
drop policy if exists province_scope_all on public.services;

create policy province_scope_all on public.services
  for all to authenticated
  using (
    (select public.merchan_is_admin())
    or ((select public.merchan_has_profile())
        and (province is null
             or public.merchan_norm_province(province) = any ((select public.merchan_province_scope())::text[])))
    or ((select public.merchan_is_almacen())
        and (logistics_request_id is not null
             or exists (select 1 from public.logistics_material_requirements r
                         where r.service_id = services.id::text)))
  )
  with check (
    (select public.merchan_is_admin())
    or ((select public.merchan_has_profile())
        and (province is null
             or public.merchan_norm_province(province) = any ((select public.merchan_province_scope())::text[])))
    or ((select public.merchan_is_almacen())
        and (logistics_request_id is not null
             or exists (select 1 from public.logistics_material_requirements r
                         where r.service_id = services.id::text)))
  );

-- ---------------------------------------------------------------------------
-- 2. `isdin_vinyls`: rama de almacén
-- ---------------------------------------------------------------------------
drop policy if exists province_scope_all on public.isdin_vinyls;

create policy province_scope_all on public.isdin_vinyls
  for all to authenticated
  using (
    (select public.merchan_is_admin())
    or ((select public.merchan_has_profile())
        and (province is null
             or public.merchan_norm_province(province) = any ((select public.merchan_province_scope())::text[])))
    or ((select public.merchan_is_almacen())
        and (logistics_request_id is not null
             or exists (select 1 from public.logistics_material_requirements r
                         where r.vin = isdin_vinyls.vinyl)))
  )
  with check (
    (select public.merchan_is_admin())
    or ((select public.merchan_has_profile())
        and (province is null
             or public.merchan_norm_province(province) = any ((select public.merchan_province_scope())::text[])))
    or ((select public.merchan_is_almacen())
        and (logistics_request_id is not null
             or exists (select 1 from public.logistics_material_requirements r
                         where r.vin = isdin_vinyls.vinyl)))
  );

-- Índices de apoyo: las ramas nuevas hacen lookup por estas columnas.
create index if not exists idx_services_logistics_request_id on public.services (logistics_request_id);
create index if not exists idx_isdin_vinyls_logistics_request_id on public.isdin_vinyls (logistics_request_id);
create index if not exists idx_lmr_service_id on public.logistics_material_requirements (service_id);
create index if not exists idx_lmr_vin on public.logistics_material_requirements (vin);

-- ---------------------------------------------------------------------------
-- 3. Lectura de logística: por módulo, no por «tener perfil»
-- ---------------------------------------------------------------------------
-- Las 20 tablas de logística se leían con `merchan_has_profile()`: bastaba
-- tener perfil para leer el almacén entero, incluido el log de auditoría, aunque
-- el usuario no tuviera el módulo de logística. Pasa a `merchan_can_logistics()`
-- (= admin OR almacen OR permiso 'logistica'), que es la misma puerta que ya
-- gobierna la ESCRITURA de esas tablas y la que usa la UI.
--
-- Verificado antes de aplicar: los 6 gestores activos tienen `logistica = true`
-- y el usuario de almacén entra por su propia rama, así que HOY no pierde acceso
-- nadie. Solo aprieta para un futuro gestor sin ese permiso, que es lo correcto.
do $$
declare
  t text;
begin
  for t in
    select tablename from pg_policies
     where schemaname = 'public' and policyname = 'logistica_read' and cmd = 'SELECT'
  loop
    execute format('drop policy logistica_read on public.%I', t);
    execute format(
      'create policy logistica_read on public.%I for select to authenticated using ((select public.merchan_can_logistics()))',
      t);
  end loop;
end $$;

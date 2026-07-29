-- v9_8: rendimiento de RLS. Las políticas de v9_3 se reescriben SIN cambiar
-- una sola regla de acceso: solo cambia CUÁNTAS VECES se evalúan.
--
-- El problema (medido en el proyecto dptmswhwmqimijpfyndn el 2026-07-29):
--   Las políticas de v9_3 llaman a merchan_is_admin(), merchan_has_profile(),
--   merchan_has_perm() y merchan_province_scope() directamente en el predicado.
--   Postgres NO cachea funciones STABLE entre filas: las ejecuta UNA VEZ POR
--   FILA. Y cada una de ellas hace por dentro un SELECT sobre app_users
--   (merchan_auth_profile), así que una lectura de 1.012 filas disparaba miles
--   de subconsultas.
--
--   explain analyze select * from puntos_venta_campana  (gestora "Mai"):
--     Seq Scan ... (actual time=1.032..540.423 rows=319)
--     Filter: (merchan_is_admin() OR (merchan_has_profile() AND ...))
--     Execution Time: 540.589 ms      <-- 1.012 filas. Media hora de CPU al día.
--
-- La solución (patrón recomendado por Supabase para RLS): envolver cada llamada
-- en un subselect escalar `(select f())`. Postgres lo convierte en un InitPlan
-- que se evalúa UNA vez por consulta y reutiliza el resultado en todas las filas.
--
--   Misma consulta con las llamadas envueltas:
--     Seq Scan ... (actual time=1.811..6.493 rows=319)
--     Filter: ((InitPlan 1).col1 OR ((InitPlan 2).col1 AND ...))
--     Execution Time: 6.534 ms        <-- 83x más rápido, MISMAS 319 filas.
--
-- Medición previa por tabla (gestora, count(*) con RLS activa):
--   puntos_venta_campana 568 ms · isdin_vinyls 334 ms · isdin_calls 289 ms
--   services 148 ms · payment_obligations 143 ms · points 138 ms
--
-- Las reglas NO cambian: mismo rol, mismo permiso, mismas provincias, mismas
-- columnas. Verificado comparando filas visibles antes/después para admin y
-- para gestora. Este fichero se puede reaplicar sin efectos secundarios.
--
-- ROLLBACK: volver a ejecutar v9_3_rls_role_province.sql (recrea las políticas
-- en su forma original, sin envolver).

-- ============ Tablas operativas con ámbito por provincia =====================
-- Idéntico a v9_3 salvo los `(select ...)` que fuerzan el InitPlan.
-- El cast ::text[] es necesario: sin él, `= any((select ...))` se interpreta
-- como ANY(subconsulta) en vez de ANY(array) y falla con
-- "operator does not exist: text = text[]".
do $$
declare
  t record;
  pred text;
begin
  for t in
    select * from (values
      ('services', 'province'),
      ('points', 'province'),
      ('workers', 'province'),
      ('big_campaign_points', 'province'),
      ('puntos_venta_campana', 'provincia'),
      ('isdin_vinyls', 'province'),
      ('isdin_calls', 'province')
    ) as v(tbl, col)
  loop
    pred := format(
      '(select public.merchan_is_admin()) or ((select public.merchan_has_profile()) and (%I is null or public.merchan_norm_province(%I) = any(((select public.merchan_province_scope()))::text[])))',
      t.col, t.col
    );
    execute format('drop policy if exists province_scope_all on public.%I', t.tbl);
    execute format('create policy province_scope_all on public.%I for all to authenticated using (%s) with check (%s)', t.tbl, pred, pred);
  end loop;
end $$;

-- ============ Tablas de pagos: permiso 'pagos' ===============================
do $$
declare t text;
begin
  foreach t in array array['payment_obligations','payment_obligations_audit','import_runs','import_run_rows','economic_events']
  loop
    if exists (select 1 from pg_tables where schemaname = 'public' and tablename = t) then
      execute format('drop policy if exists pagos_only on public.%I', t);
      execute format('create policy pagos_only on public.%I for all to authenticated using ((select public.merchan_has_perm(''pagos''))) with check ((select public.merchan_has_perm(''pagos'')))', t);
    end if;
  end loop;
end $$;

-- ============ Facturación a cliente ISDIN: solo administración ==============
do $$
declare t text;
begin
  foreach t in array array['isdin_billing_settings','isdin_billing_adjustments','isdin_billing_audit']
  loop
    execute format('drop policy if exists admin_only on public.%I', t);
    execute format('create policy admin_only on public.%I for all to authenticated using ((select public.merchan_is_admin())) with check ((select public.merchan_is_admin()))', t);
  end loop;
end $$;

-- ============ app_users: lectura sin hash, escritura solo admin =============
-- users_read sigue siendo `using (true)`: la protección del hash es por GRANT
-- de columnas (v9_3), no por política, así que no hay nada que envolver.
drop policy if exists users_admin_insert on app_users;
drop policy if exists users_admin_update on app_users;
drop policy if exists users_admin_delete on app_users;
create policy users_admin_insert on app_users for insert to authenticated with check ((select merchan_is_admin()));
create policy users_admin_update on app_users for update to authenticated using ((select merchan_is_admin())) with check ((select merchan_is_admin()));
create policy users_admin_delete on app_users for delete to authenticated using ((select merchan_is_admin()));

-- ============ Índices duplicados (advisor: duplicate_index) ==================
-- Pares idénticos: ocupan disco y encarecen cada INSERT/UPDATE sin aportar nada.
-- Se conserva uno de cada par.
drop index if exists public.idx_big_campaign_points_campaign_id;
drop index if exists public.idx_big_campaign_points_worker_id;
drop index if exists public.uq_logistics_vins_vin_id;

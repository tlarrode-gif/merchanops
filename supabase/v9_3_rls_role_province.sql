-- v9_3: refinado de RLS por rol, permiso y provincia (sobre la base v9_2).
-- APLICADA al proyecto dptmswhwmqimijpfyndn el 2026-07-11.
--
-- La base pasa a aplicar las mismas reglas que la aplicación:
--   - admin: todo.
--   - gestora: solo filas de sus provincias (o sin provincia) en las tablas
--     operativas (services, points, workers, big_campaign_points,
--     puntos_venta_campana, isdin_vinyls, isdin_calls); facturación de cliente
--     ISDIN (isdin_billing_*) vetada; tablas de pagos (payment_obligations,
--     auditoría, importaciones, economic_events) solo con permiso 'pagos';
--     app_users solo lectura y SIN la columna password (bloqueada por GRANT de
--     columnas: ni siquiera el admin puede leer hashes por REST — solo las
--     funciones definer de login/whoami los usan).
--
-- La normalización de provincia replica lib/provinces.ts (minúsculas, sin
-- acentos y alias: Gerona→Girona, Vizcaya→Bizkaia, Guipúzcoa→Gipuzkoa,
-- Orense→Ourense, Araba→Álava, Baleares→Illes Balears, Tenerife→S.C. Tenerife).
-- Filas con provincia NULL siguen visibles para todas (igual que hoy no
-- desaparecen de la app).
--
-- Verificación en vivo (transacción revertida, simulando JWT con
-- request.jwt.claims): gestora de Madrid ve 1 de 2 servicios y no puede editar
-- el de Barcelona (0 filas) pero sí el suyo; facturación y ledger (sin permiso
-- pagos) invisibles; SELECT password => insufficient_privilege; listar
-- usuarios sin hash OK; editar usuarios => 0 filas; admin ve y edita todo.
--
-- Los triggers de auditoría de facturación (v8_5) pasan a SECURITY DEFINER:
-- una gestora que edita columnas de facturación de un vinilo debe poder
-- generar su fila de auditoría aunque no pueda leer/escribir la tabla.

-- ============ Helpers (SECURITY DEFINER, evaluados una vez por consulta) ====
create or replace function merchan_norm_province(p text)
returns text language plpgsql immutable set search_path = '' as $$
declare k text;
begin
  k := lower(btrim(coalesce(p, '')));
  k := translate(k, 'áàäâéèëêíìïîóòöôúùüûñ', 'aaaaeeeeiiiioooouuuun');
  return case k
    when 'araba' then 'alava'
    when 'gerona' then 'girona'
    when 'guipuzcoa' then 'gipuzkoa'
    when 'orense' then 'ourense'
    when 'vizcaya' then 'bizkaia'
    when 'islas baleares' then 'illes balears'
    when 'baleares' then 'illes balears'
    when 'tenerife' then 'santa cruz de tenerife'
    else k
  end;
end $$;

create or replace function merchan_auth_profile()
returns public.app_users language sql stable security definer set search_path = '' as $$
  select u from public.app_users u where u.auth_user_id = auth.uid() and u.active is true limit 1;
$$;

create or replace function merchan_is_admin()
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((public.merchan_auth_profile()).role = 'admin', false);
$$;

create or replace function merchan_has_profile()
returns boolean language sql stable security definer set search_path = '' as $$
  select (public.merchan_auth_profile()).id is not null;
$$;

create or replace function merchan_has_perm(p_perm text)
returns boolean language sql stable security definer set search_path = '' as $$
  select public.merchan_is_admin()
      or coalesce(((public.merchan_auth_profile()).permissions ->> p_perm)::boolean, false);
$$;

-- Provincias normalizadas de la gestora; NULL = admin (sin límite).
create or replace function merchan_province_scope()
returns text[] language sql stable security definer set search_path = '' as $$
  select case
    when public.merchan_is_admin() then null
    else coalesce(
      (select array_agg(public.merchan_norm_province(x)) from unnest(coalesce((public.merchan_auth_profile()).provinces, '{}')) as x),
      '{}'::text[]
    )
  end;
$$;

revoke all on function merchan_auth_profile() from public, anon;
grant execute on function merchan_auth_profile() to authenticated;
revoke all on function merchan_is_admin() from public, anon;
grant execute on function merchan_is_admin() to authenticated;
revoke all on function merchan_has_profile() from public, anon;
grant execute on function merchan_has_profile() to authenticated;
revoke all on function merchan_has_perm(text) from public, anon;
grant execute on function merchan_has_perm(text) to authenticated;
revoke all on function merchan_province_scope() from public, anon;
grant execute on function merchan_province_scope() to authenticated;

-- ============ Tablas operativas con ámbito por provincia =====================
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
      'public.merchan_is_admin() or (public.merchan_has_profile() and (%I is null or public.merchan_norm_province(%I) = any(public.merchan_province_scope())))',
      t.col, t.col
    );
    execute format('drop policy if exists authenticated_all on public.%I', t.tbl);
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
      execute format('drop policy if exists authenticated_all on public.%I', t);
      execute format('drop policy if exists pagos_only on public.%I', t);
      execute format('create policy pagos_only on public.%I for all to authenticated using (public.merchan_has_perm(''pagos'')) with check (public.merchan_has_perm(''pagos''))', t);
    end if;
  end loop;
end $$;

-- ============ Facturación a cliente ISDIN: solo administración ==============
do $$
declare t text;
begin
  foreach t in array array['isdin_billing_settings','isdin_billing_adjustments','isdin_billing_audit']
  loop
    execute format('drop policy if exists authenticated_all on public.%I', t);
    execute format('drop policy if exists admin_only on public.%I', t);
    execute format('create policy admin_only on public.%I for all to authenticated using (public.merchan_is_admin()) with check (public.merchan_is_admin())', t);
  end loop;
end $$;

alter function isdin_billing_adjustments_audit() security definer set search_path = public;
alter function isdin_billing_settings_audit() security definer set search_path = public;
alter function isdin_vinyls_billing_audit() security definer set search_path = public;

-- ============ app_users: lectura sin hash, escritura solo admin =============
drop policy if exists authenticated_all on app_users;
drop policy if exists users_read on app_users;
drop policy if exists users_admin_insert on app_users;
drop policy if exists users_admin_update on app_users;
drop policy if exists users_admin_delete on app_users;
create policy users_read on app_users for select to authenticated using (true);
create policy users_admin_insert on app_users for insert to authenticated with check (merchan_is_admin());
create policy users_admin_update on app_users for update to authenticated using (merchan_is_admin()) with check (merchan_is_admin());
create policy users_admin_delete on app_users for delete to authenticated using (merchan_is_admin());
revoke select on app_users from authenticated;
grant select (id, username, display_name, role, active, provinces, permissions, auth_user_id, created_at, updated_at) on app_users to authenticated;

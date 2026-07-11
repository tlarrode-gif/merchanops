-- v9_2: ACTIVACIÓN de RLS — ⚠️ NO APLICAR hasta confirmar el login en producción ⚠️
--
-- Requisitos previos (v9_1, YA en producción):
--   1. OPS y LOGS inician sesión con Supabase Auth (merchan_auth_bootstrap +
--      signInWithPassword). Confirmar que TODOS los usuarios pueden entrar en
--      ambas apps desplegadas antes de ejecutar este script.
--   2. Aviso a los usuarios: al activarse, cualquier pestaña sin login real
--      dejará de leer/escribir hasta volver a entrar.
--
-- Qué hace: activa RLS en TODAS las tablas de public con una política
-- "solo usuarios autenticados" (mismo comportamiento actual para quien ha hecho
-- login; bloqueo total para la anon key sin sesión). El refinado por rol
-- (gestor vs admin, provincias) queda para una fase posterior sobre esta base.
--
-- Notas:
--   - auth_login_attempts queda sin política: solo la tocan las funciones
--     SECURITY DEFINER (el propietario de la tabla no está sujeto a RLS).
--   - Los RPC existentes (logistics_*, sync_payment_obligations, outbox_*)
--     siguen funcionando para usuarios autenticados.
--   - merchan_auth_bootstrap sigue siendo la única puerta para anon (login).
--
-- ROLLBACK (por tabla): alter table public.<t> disable row level security;
-- ROLLBACK total: repetir el bucle con 'disable row level security'.

do $$
declare
  t record;
begin
  for t in
    select tablename from pg_tables where schemaname = 'public'
  loop
    execute format('alter table public.%I enable row level security', t.tablename);
    if t.tablename <> 'auth_login_attempts' then
      execute format('drop policy if exists authenticated_all on public.%I', t.tablename);
      execute format(
        'create policy authenticated_all on public.%I for all to authenticated using (true) with check (true)',
        t.tablename
      );
    end if;
  end loop;
end $$;

select count(*) as tablas_con_rls
from pg_tables
where schemaname = 'public' and rowsecurity;

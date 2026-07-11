-- v9_2: ACTIVACIÓN de RLS (C1, paso final).
-- APLICADA al proyecto dptmswhwmqimijpfyndn el 2026-07-11, tras confirmar el
-- usuario que el login con Supabase Auth funciona en OPS y LOGS desplegados.
--
-- Qué hace:
--   1. RLS en TODAS las tablas de public (47/47) con política solo-autenticados
--      (auth_login_attempts queda sin política: solo la tocan las funciones
--      SECURITY DEFINER, y el propietario no está sujeto a RLS).
--   2. Revocación total de privilegios del rol anon sobre tablas, vistas y
--      secuencias (incluidas las default privileges para objetos futuros).
--      Las vistas (v_campana_kpis, v_campanas_listado) se cubren con la
--      revocación: como objetos del propietario podrían saltarse RLS.
--   3. La única puerta para anon es merchan_auth_bootstrap (login).
--
-- Verificación en vivo (transacción revertida): anon no lee tablas ni vistas
-- (insufficient_privilege), anon sí ejecuta bootstrap, authenticated lee y
-- escribe con normalidad.
--
-- ROLLBACK por tabla:  alter table public.<t> disable row level security;
-- ROLLBACK de grants:  grant select on all tables in schema public to anon;
--                      (solo si fuera imprescindible; no recomendado)
-- El refinado por rol (gestor vs admin, provincias) queda para una fase
-- posterior sobre esta base.

do $$
declare
  t record;
begin
  for t in select tablename from pg_tables where schemaname = 'public' loop
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

revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
alter default privileges in schema public revoke all on tables from anon;
alter default privileges in schema public revoke all on sequences from anon;
alter default privileges for role postgres in schema public revoke all on tables from anon;
alter default privileges for role postgres in schema public revoke all on sequences from anon;

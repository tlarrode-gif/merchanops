-- v9_1 (C1): puente a Supabase Auth manteniendo usuarios/contraseñas de app_users.
-- APLICADA al proyecto dptmswhwmqimijpfyndn el 2026-07-11 (incluye el ajuste
-- v9_1b: bootstrap devuelve {error} en vez de excepción para que el contador de
-- intentos fallidos persista — una excepción revertía el INSERT del intento).
--
-- El login pasa a ser: rpc merchan_auth_bootstrap (verifica PBKDF2 en el SERVIDOR
-- y crea/sincroniza el usuario en auth.users) + supabase.auth.signInWithPassword.
-- El navegador deja de descargar hashes; el rate limiting pasa a ser de servidor.

alter table app_users add column if not exists auth_user_id uuid;

create table if not exists auth_login_attempts (
  username text primary key,
  failed_count int not null default 0,
  first_failed_at timestamptz,
  last_failed_at timestamptz
);
revoke all on auth_login_attempts from anon, authenticated;

-- PBKDF2-SHA256 (mismo algoritmo y formato que lib/password.ts del cliente).
-- Verificado contra un vector generado con WebCrypto: coincide byte a byte.
-- v9_1c: XOR nativo de bit(256) por iteración (~0,45s en 150.000 iteraciones);
-- la versión inicial con subconsulta por iteración superaba el
-- statement_timeout de 3s del rol anon y el login fallaba por timeout.
create or replace function merchan_pbkdf2_sha256(p_password text, p_salt bytea, p_iterations int)
returns bytea
language plpgsql immutable
set search_path = ''
as $$
declare
  key bytea := convert_to(p_password,'utf8');
  u bytea;
  acc bit(256);
  i int;
begin
  u := extensions.hmac(p_salt || decode('00000001','hex'), key, 'sha256');
  acc := ('x' || encode(u,'hex'))::bit(256);
  for i in 2..p_iterations loop
    u := extensions.hmac(u, key, 'sha256');
    acc := acc # ('x' || encode(u,'hex'))::bit(256);
  end loop;
  return decode((
    select string_agg(lpad(to_hex(substring(acc from n*32+1 for 32)::int), 8, '0'), '' order by n)
    from generate_series(0, 7) n
  ), 'hex');
end $$;

-- Verifica una contraseña contra el formato almacenado "pbkdf2:<iter>:<salt_hex>:<hash_hex>"
-- (o igualdad directa si quedara algún valor legado en claro).
create or replace function merchan_verify_stored_password(p_password text, p_stored text)
returns boolean
language plpgsql immutable
set search_path = ''
as $$
declare
  parts text[];
  iters int;
begin
  if coalesce(p_password,'') = '' or coalesce(p_stored,'') = '' then return false; end if;
  if left(p_stored, 7) <> 'pbkdf2:' then return p_stored = p_password; end if;
  parts := string_to_array(p_stored, ':');
  if array_length(parts, 1) <> 4 then return false; end if;
  iters := parts[2]::int;
  if iters < 1 or iters > 1000000 then return false; end if;
  return encode(public.merchan_pbkdf2_sha256(p_password, decode(parts[3],'hex'), iters), 'hex') = parts[4];
exception when others then
  return false;
end $$;

-- Login puente. Devuelve {email} para signInWithPassword o {error} (genérico).
-- IMPORTANTE: devuelve el error en vez de lanzarlo para que el registro del
-- intento fallido no se revierta con la excepción (rate limiting persistente).
create or replace function merchan_auth_bootstrap(p_username text, p_password text)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  v_scope text := lower(btrim(coalesce(p_username,'')));
  v_user public.app_users%rowtype;
  v_email text;
  v_uid uuid;
  v_att public.auth_login_attempts%rowtype;
  v_valid boolean := false;
begin
  if v_scope = '' or coalesce(p_password,'') = '' then
    return jsonb_build_object('error', 'Usuario o contraseña incorrectos');
  end if;

  -- Rate limiting de SERVIDOR: 5 fallos por usuario cada 15 minutos.
  select * into v_att from public.auth_login_attempts where username = v_scope;
  if found and v_att.failed_count >= 5 and v_att.last_failed_at > now() - interval '15 minutes' then
    return jsonb_build_object('error', 'Demasiados intentos fallidos. Vuelve a intentarlo en 15 minutos.');
  end if;

  select * into v_user from public.app_users
    where lower(username) = v_scope and active is true
    limit 1;
  if found then
    v_valid := public.merchan_verify_stored_password(p_password, v_user.password);
  end if;

  if not v_valid then
    insert into public.auth_login_attempts as a (username, failed_count, first_failed_at, last_failed_at)
    values (v_scope, 1, now(), now())
    on conflict (username) do update set
      failed_count = case when a.last_failed_at < now() - interval '15 minutes' then 1 else a.failed_count + 1 end,
      first_failed_at = case when a.last_failed_at < now() - interval '15 minutes' then now() else a.first_failed_at end,
      last_failed_at = now();
    return jsonb_build_object('error', 'Usuario o contraseña incorrectos');
  end if;

  delete from public.auth_login_attempts where username = v_scope;

  v_email := v_scope || '@auth.merchanops.internal';
  select id into v_uid from auth.users where email = v_email limit 1;

  if v_uid is null then
    v_uid := gen_random_uuid();
    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
      confirmation_token, recovery_token, email_change, email_change_token_new,
      email_change_token_current, phone_change, phone_change_token, reauthentication_token,
      is_sso_user, is_anonymous
    ) values (
      '00000000-0000-0000-0000-000000000000', v_uid, 'authenticated', 'authenticated', v_email,
      extensions.crypt(p_password, extensions.gen_salt('bf')), now(),
      jsonb_build_object('provider','email','providers',jsonb_build_array('email')),
      jsonb_build_object('app_user_id', v_user.id, 'username', v_user.username, 'display_name', v_user.display_name),
      now(), now(),
      '', '', '', '', '', '', '', '',
      false, false
    );
    insert into auth.identities (provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
    values (v_uid::text, v_uid,
            jsonb_build_object('sub', v_uid::text, 'email', v_email, 'email_verified', true),
            'email', now(), now(), now());
  else
    -- Contraseña YA verificada contra app_users: re-sincroniza el hash de Auth
    -- (cubre cambios de contraseña hechos desde la pantalla de Usuarios).
    update auth.users
      set encrypted_password = extensions.crypt(p_password, extensions.gen_salt('bf')),
          updated_at = now()
      where id = v_uid and is_sso_user = false;
  end if;

  update public.app_users set auth_user_id = v_uid
    where id = v_user.id and auth_user_id is distinct from v_uid;

  return jsonb_build_object('email', v_email);
end $$;
revoke all on function merchan_auth_bootstrap(text, text) from public;
grant execute on function merchan_auth_bootstrap(text, text) to anon, authenticated;
revoke all on function merchan_pbkdf2_sha256(text, bytea, int) from public, anon, authenticated;
revoke all on function merchan_verify_stored_password(text, text) from public, anon, authenticated;

-- Perfil del usuario autenticado, SIN hash de contraseña (fin de "hashes al navegador").
create or replace function merchan_auth_whoami()
returns jsonb
language sql stable security definer
set search_path = ''
as $$
  select to_jsonb(u) - 'password'
  from public.app_users u
  where u.auth_user_id = auth.uid() and u.active is true
  limit 1;
$$;
revoke all on function merchan_auth_whoami() from public, anon;
grant execute on function merchan_auth_whoami() to authenticated;

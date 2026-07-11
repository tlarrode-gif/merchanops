-- v9_4: cambio de contraseña por el propio usuario (autoservicio).
-- APLICADA al proyecto dptmswhwmqimijpfyndn el 2026-07-11.
-- Requiere sesión + contraseña actual (verificada EN EL SERVIDOR con PBKDF2);
-- actualiza el hash PBKDF2 de app_users y el bcrypt de Supabase Auth EN LA
-- MISMA transacción. Devuelve {error} en vez de excepción (mensajes claros).
-- Verificado en vivo (transacción revertida): contraseña actual incorrecta
-- rechazada; nueva de <8 caracteres rechazada; cambio correcto actualiza
-- ambos hashes.
create or replace function merchan_change_own_password(p_current text, p_new text)
returns jsonb
language plpgsql security definer
set search_path = ''
as $$
declare
  u public.app_users%rowtype;
  v_salt bytea;
  v_hash text;
begin
  select * into u from public.app_users where auth_user_id = auth.uid() and active is true limit 1;
  if not found then return jsonb_build_object('error', 'Sesión no reconocida. Vuelve a iniciar sesión.'); end if;
  if coalesce(length(p_new), 0) < 8 then
    return jsonb_build_object('error', 'La contraseña nueva debe tener al menos 8 caracteres.');
  end if;
  if p_new = p_current then
    return jsonb_build_object('error', 'La contraseña nueva no puede ser igual a la actual.');
  end if;
  if not public.merchan_verify_stored_password(p_current, u.password) then
    return jsonb_build_object('error', 'La contraseña actual no es correcta.');
  end if;

  v_salt := extensions.gen_random_bytes(16);
  v_hash := 'pbkdf2:150000:' || encode(v_salt, 'hex') || ':' || encode(public.merchan_pbkdf2_sha256(p_new, v_salt, 150000), 'hex');
  update public.app_users set password = v_hash, updated_at = now() where id = u.id;
  update auth.users
     set encrypted_password = extensions.crypt(p_new, extensions.gen_salt('bf')), updated_at = now()
   where id = u.auth_user_id;
  return jsonb_build_object('ok', true);
end $$;
revoke all on function merchan_change_own_password(text, text) from public, anon;
grant execute on function merchan_change_own_password(text, text) to authenticated;

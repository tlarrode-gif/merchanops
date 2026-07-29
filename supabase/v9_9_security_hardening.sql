-- v9_9: corrección de vulnerabilidades de seguridad (tanda 1).
-- APLICADA al proyecto dptmswhwmqimijpfyndn el 2026-07-29.
--
-- Esta tanda contiene SOLO lo que no depende de una decisión de negocio: fugas
-- y exposiciones que están mal en cualquier escenario. El cierre de las 31
-- tablas con política abierta (clients, grandes_campanas, payment_ledger,
-- logistics_*, ...) y la validación de permisos dentro de las RPC SECURITY
-- DEFINER quedan pendientes de decidir alcance por rol.
--
-- ============================================================================
-- 1. FUGA DEL HASH DE CONTRASEÑA  (lo más grave de esta tanda)
-- ============================================================================
-- v9_3 revocó la columna `password` de app_users por GRANT de columnas, con el
-- objetivo declarado de que "ni siquiera el admin puede leer hashes por REST".
-- Pero merchan_auth_profile() es SECURITY DEFINER, devuelve el rowtype COMPLETO
-- de app_users (password incluida) y tenía EXECUTE para `authenticated`, así
-- que era invocable como /rest/v1/rpc/merchan_auth_profile.
--
-- Comprobado en vivo con la sesión de una gestora:
--   select (merchan_auth_profile()).password  ->  'pbkdf2:150000:c771cf9d4b...'
--
-- Es decir: cualquier usuario con sesión podía descargarse su propio hash
-- PBKDF2 y atacarlo offline, justo lo que v9_3 pretendía impedir.
--
-- La función es un HELPER INTERNO: la usan merchan_is_admin(), merchan_has_perm(),
-- merchan_has_profile() y merchan_province_scope(), que son SECURITY DEFINER y
-- por tanto la llaman ya como propietario. Revocarle el EXECUTE a `authenticated`
-- cierra la puerta REST sin tocar el RLS.
--
-- Verificado tras la revocación: lectura del hash -> 42501 insufficient_privilege;
-- puntos_venta_campana sigue devolviendo 319 filas a la gestora (idéntico);
-- services 247 filas; facturación ISDIN sigue vetada.
revoke all on function public.merchan_auth_profile() from authenticated, anon, public;

-- ============================================================================
-- 2. VISTAS SECURITY DEFINER QUE SE SALTAN EL RLS  (advisor: nivel ERROR)
-- ============================================================================
-- v_campanas_listado y v_campana_kpis se ejecutaban con los permisos del
-- propietario, así que agregaban SOBRE TODAS las filas de puntos_venta_campana
-- ignorando el ámbito por provincia de quien consulta.
--
-- OJO, CAMBIO VISIBLE EN PANTALLA: los KPIs de campaña de una gestora pasan a
-- contar solo sus provincias. Medido con la gestora "Mai":
--   campaña a060cd07  904 puntos -> 277     campaña c81ddfbc  48 -> 15
--   campaña 1928bfee   48 puntos ->  15     campaña c63bf41c  12 -> 12
-- El administrador no cambia (sigue viendo el total).
--
-- Es coherente con el diseño de v9_3 (la gestora solo ve sus provincias). Si
-- el negocio prefiere que la gestora vea el progreso GLOBAL de la campaña,
-- revertir con:  alter view public.v_campana_kpis set (security_invoker = off);
alter view public.v_campanas_listado set (security_invoker = on);
alter view public.v_campana_kpis    set (security_invoker = on);

-- ============================================================================
-- 3. FUNCIONES DE TRIGGER EXPUESTAS COMO RPC
-- ============================================================================
-- Las tres funciones de auditoría de facturación tenían EXECUTE para anon y
-- authenticated, quedando publicadas en /rest/v1/rpc/. En la práctica Postgres
-- ya rechaza la llamada directa (0A000: las funciones de trigger no se pueden
-- invocar así), pero no hay motivo para tenerlas publicadas.
-- Verificado: tras revocar, el UPDATE sobre isdin_vinyls sigue generando su
-- fila en isdin_billing_audit (0 -> 1). Los triggers no consultan EXECUTE.
revoke all on function public.isdin_vinyls_billing_audit()      from anon, authenticated, public;
revoke all on function public.isdin_billing_settings_audit()    from anon, authenticated, public;
revoke all on function public.isdin_billing_adjustments_audit() from anon, authenticated, public;

-- ============================================================================
-- 4. FUNCIONES DE INFRAESTRUCTURA ACCESIBLES POR ANON
-- ============================================================================
-- El outbox es maquinaria interna de sincronización con MerchanLOGS. anon solo
-- debe poder hacer una cosa: login (merchan_auth_bootstrap). Se le retira todo
-- lo demás. Se conserva el acceso de `authenticated`, que es quien dispara la
-- publicación desde la aplicación.
revoke all on function public.outbox_publish_logistics()          from anon, public;
revoke all on function public.outbox_publish_stock_low()          from anon, public;
revoke all on function public.outbox_process_db_notifier(integer) from anon, public;

-- ============================================================================
-- 5. search_path mutable en funciones (advisor: 18 avisos)
-- ============================================================================
-- Ninguna de estas es SECURITY DEFINER (las definer ya lo tenían fijado en
-- v9_1/v9_3), así que no hay escalada de privilegios posible: se ejecutan con
-- los permisos de quien llama. Se fija igualmente el search_path para que la
-- resolución de nombres no dependa de la sesión y para dejar el linter limpio.
-- Se usa 'public, pg_temp' (con pg_temp AL FINAL, que es lo que evita el ataque
-- de tabla temporal interpuesta) en lugar de '' para no tener que reescribir
-- los cuerpos, que usan nombres sin cualificar.
do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as sig
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and not p.prosecdef
      and p.proconfig is null
      and p.proname in (
        'set_isdin_calls_updated_at','prevent_logistics_movement_mutation',
        'payment_obligations_audit_immutable','payment_obligations_guard',
        'payment_obligations_audit_write','change_payment_obligation_status',
        'create_payment_adjustment','import_runs_immutable','confirm_import_run',
        'logistics_stock_bump_version','logistics_reserve_stock',
        'logistics_release_reservation','logistics_confirm_delivery',
        'logistics_ship_picking','logistics_reject_request',
        'sync_payment_obligations','isdin_billing_audit_block_mutation',
        'isdin_billing_adjustments_guard'
      )
  loop
    execute format('alter function %s set search_path = public, pg_temp', f.sig);
  end loop;
end $$;

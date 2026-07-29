-- v9_10: cierre de la superficie RPC expuesta a anon (tanda 2).
-- APLICADA al proyecto dptmswhwmqimijpfyndn el 2026-07-29.
--
-- EL PROBLEMA
-- v9_2 declaró que "la única puerta para anon es merchan_auth_bootstrap", pero
-- eso solo se cumplía para TABLAS. Sobre funciones seguía vigente el GRANT
-- implícito que Postgres da a PUBLIC al crear cualquier función, y anon hereda
-- de PUBLIC. Resultado: anon (= la clave pública que viaja en el bundle del
-- navegador, legible por cualquiera) podía invocar 27 funciones, entre ellas:
--
--   change_payment_obligation_status(...)   cambiar el estado de un pago
--   create_payment_adjustment(...)          crear un ajuste económico
--   confirm_import_run(...)                 confirmar una importación
--   logistics_ship_picking(...)             marcar un picking como enviado
--   logistics_confirm_delivery(...)         confirmar una entrega
--   logistics_reject_request(...)           rechazar una petición
--   outbox_publish/claim/complete/fail(...) inyectar o manipular eventos
--
-- POR QUÉ NO ERA EXPLOTABLE (todavía)
-- Las 27 son SECURITY INVOKER: se ejecutan con los permisos de quien llama, y
-- v9_2 dejó a anon con CERO privilegios sobre tablas. Comprobado lanzando las
-- tres más peligrosas como anon: las tres mueren con 42501 insufficient_privilege
-- al tocar la primera tabla.
--
-- Aun así se corrige: la contención dependía por completo de que nadie volviera
-- a conceder un SELECT a anon. Un solo `grant ... to anon` (o una migración
-- futura despistada) convertía esto en escritura no autenticada sobre pagos y
-- logística. Defensa en profundidad, no paranoia.
--
-- QUÉ HACE
--   1. Revoca EXECUTE de PUBLIC, anon y authenticated sobre TODAS las funciones
--      de public (hay que quitarlo de PUBLIC: revocarlo solo de anon no surte
--      efecto porque el permiso venía heredado).
--   2. Devuelve EXECUTE a authenticated en las funciones reales de negocio.
--      Se excluye merchan_auth_profile (fuga del hash, cerrada en v9_9).
--   3. Devuelve EXECUTE a service_role (clave de servidor) en las mismas.
--   4. Las funciones de TRIGGER no se conceden a nadie: los triggers no
--      consultan EXECUTE (verificado en v9_9: la auditoría ISDIN sigue
--      generando filas tras revocarlas).
--   5. anon se queda exclusivamente con merchan_auth_bootstrap.
--
-- VERIFICADO tras aplicar, con la sesión de la gestora "Mai": services 247,
-- points 458, puntos_venta_campana 319, workers 25, isdin_vinyls 475,
-- payment_obligations 489, facturación ISDIN 0 (vetada), whoami OK, vista de
-- campañas 4. Idéntico a antes: no se pierde un solo acceso legítimo.
--
-- ROLLBACK: grant execute on all functions in schema public to anon, authenticated;
--           (no recomendado: reabre exactamente lo que este fichero cierra)

do $$
declare f record;
begin
  for f in
    select p.oid::regprocedure as sig,
           p.proname,
           (pg_get_function_result(p.oid) = 'trigger') as es_trigger
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prokind = 'f'
  loop
    execute format('revoke all on function %s from public, anon, authenticated', f.sig);

    if not f.es_trigger and f.proname <> 'merchan_auth_profile' then
      execute format('grant execute on function %s to authenticated', f.sig);
    end if;

    if not f.es_trigger then
      execute format('grant execute on function %s to service_role', f.sig);
    end if;
  end loop;

  -- La única puerta de anon: el login.
  grant execute on function public.merchan_auth_bootstrap(text, text) to anon;
end $$;

-- Que las funciones futuras no vuelvan a nacer abiertas a PUBLIC.
alter default privileges in schema public revoke execute on functions from public;
alter default privileges in schema public revoke execute on functions from anon;
alter default privileges for role postgres in schema public revoke execute on functions from public;
alter default privileges for role postgres in schema public revoke execute on functions from anon;

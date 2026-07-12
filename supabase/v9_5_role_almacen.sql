-- v9_5: nuevo rol 'almacen' en app_users (picking móvil de MerchanLOGS).
-- APLICADA al proyecto dptmswhwmqimijpfyndn el 2026-07-11.
-- En OPS un usuario de almacén no tiene módulos ni provincias (no ve datos
-- operativos); en LOGS entra con la matriz de permisos 'almacen' existente
-- (picking, entradas, envíos, incidencias). Las políticas v9_3 ya lo cubren:
-- no es admin y sin provincias => tablas operativas de OPS invisibles;
-- tablas logistics_* con política authenticated_all => operativas.
alter table app_users drop constraint if exists app_users_role_check;
alter table app_users add constraint app_users_role_check check (role = any (array['admin'::text, 'manager'::text, 'almacen'::text]));

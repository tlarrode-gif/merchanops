-- v9_11: cierre de las 31 tablas con política abierta (tanda 3).
-- APLICADA al proyecto dptmswhwmqimijpfyndn el 2026-07-29.
--
-- Decisiones tomadas por el usuario:
--   1. Lectura limitada a las provincias de cada gestora.
--   2. Económico: la gestora ve los pagos de servicios, grandes campañas y
--      vinilos ISDIN DE SUS PROVINCIAS.
--   3. Logística: "lo que sea más seguro" -> lectura para todos, escritura
--      solo para operadores logísticos (almacén, admin o permiso 'logistica').
--
-- Todas las llamadas a helpers van envueltas en (select ...) para conservar el
-- InitPlan de v9_8: sin eso, cada política volvería a evaluarse por fila y
-- perderíamos la mejora de 1.654 ms -> 27,7 ms.
--
-- ============================================================================
-- DOS HALLAZGOS QUE CONDICIONAN EL DISEÑO
-- ============================================================================
-- (a) grandes_campanas.provincias está VACÍO en las 4 campañas existentes.
--     Filtrar por esa columna dejaría a TODAS las gestoras sin ninguna campaña.
--     La provincia real de una campaña vive en puntos_venta_campana.provincia,
--     así que la visibilidad se deriva de "tiene algún punto que yo pueda ver".
--     Se añade además un escape por autoría para que una campaña recién creada
--     y todavía sin puntos no desaparezca de la vista de quien la creó.
--
-- (b) clients NO tiene columna de provincia y un cliente es una empresa
--     nacional, no provincial. Medido con Kilian (solo Barcelona): derivar la
--     visibilidad de su trabajo le dejaría 0 de 31 clientes (8 si se añade un
--     escape para clientes sin trabajo). Con los desplegables vacíos no podría
--     ni dar de alta su primer servicio en Barcelona.
--     Por eso clients queda LEGIBLE para cualquier gestora con perfil, pero
--     pasa a ser de ESCRITURA SOLO ADMIN (hoy cualquiera podía borrar clientes).
--     Si se prefiere el filtrado estricto pese a la consecuencia, sustituir la
--     política clients_read por:
--       using ((select merchan_is_admin())
--              or exists (select 1 from services s where s.client_id = clients.id))
--
-- ============================================================================
-- HELPERS
-- ============================================================================
-- El rol 'almacen' (MerchanLOGS) nace con TODOS los permisos a false
-- (almacenPermissions en lib/access-control.ts), así que un merchan_has_perm
-- ('logistica') lo dejaría fuera de su propia aplicación. Se le reconoce por rol.
create or replace function public.merchan_can_logistics()
returns boolean language sql stable security definer set search_path = '' as $$
  select public.merchan_is_admin()
      or coalesce((public.merchan_auth_profile()).role = 'almacen', false)
      or coalesce(((public.merchan_auth_profile()).permissions ->> 'logistica')::boolean, false);
$$;
revoke all on function public.merchan_can_logistics() from public, anon;
grant execute on function public.merchan_can_logistics() to authenticated, service_role;

-- Id de app_users del usuario autenticado (para los escapes por autoría).
create or replace function public.merchan_my_app_user_id()
returns text language sql stable security definer set search_path = '' as $$
  select (public.merchan_auth_profile()).id;
$$;
revoke all on function public.merchan_my_app_user_id() from public, anon;
grant execute on function public.merchan_my_app_user_id() to authenticated, service_role;

-- OJO: este helper mira el ROL, no el permiso 'logistica'. Un primer intento usó
-- merchan_can_logistics() como escape para que almacén viera las campañas, pero
-- ese helper incluye el permiso 'logistica', que TODAS las gestoras tienen a
-- true: el escape les devolvía las 4 campañas y anulaba el filtro por provincia.
create or replace function public.merchan_is_almacen()
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((public.merchan_auth_profile()).role = 'almacen', false);
$$;
revoke all on function public.merchan_is_almacen() from public, anon;
grant execute on function public.merchan_is_almacen() to authenticated, service_role;

-- ============================================================================
-- 1. CAMPAÑAS Y CATÁLOGOS
-- ============================================================================
-- grandes_campanas: visible si tiene algún punto que yo vea (el propio RLS de
-- puntos_venta_campana filtra la subconsulta), si sus provincias declaradas
-- solapan con las mías, o si la creé yo. Escritura solo admin, que es lo que
-- ya imponía la aplicación (canManageCampaigns).
drop policy if exists authenticated_all on public.grandes_campanas;
drop policy if exists campanas_read     on public.grandes_campanas;
drop policy if exists campanas_admin_write on public.grandes_campanas;
create policy campanas_read on public.grandes_campanas for select to authenticated
using (
  (select public.merchan_is_admin())
  -- El rol almacén no tiene provincias asignadas, así que el filtro lo dejaba
  -- sin ninguna campaña; MerchanLOGS las necesita para etiquetar pickings,
  -- envíos y peticiones. Solo lectura: la escritura sigue siendo de admin.
  or (select public.merchan_is_almacen())
  or ((select public.merchan_has_profile()) and (
        exists (select 1 from public.puntos_venta_campana p where p.campana_id = grandes_campanas.id)
     or (provincias is not null and cardinality(provincias) > 0
         and exists (select 1 from unnest(provincias) x
                     where public.merchan_norm_province(x) = any (((select public.merchan_province_scope()))::text[])))
     or created_by = (select public.merchan_my_app_user_id())
  ))
);
create policy campanas_admin_write on public.grandes_campanas for all to authenticated
using ((select public.merchan_is_admin())) with check ((select public.merchan_is_admin()));

-- campana_gestores: por provincia de la asignación, o si la asignada soy yo.
drop policy if exists authenticated_all on public.campana_gestores;
drop policy if exists gestores_read on public.campana_gestores;
drop policy if exists gestores_admin_write on public.campana_gestores;
create policy gestores_read on public.campana_gestores for select to authenticated
using (
  (select public.merchan_is_admin())
  or ((select public.merchan_has_profile()) and (
        provincia is null
     or public.merchan_norm_province(provincia) = any (((select public.merchan_province_scope()))::text[])
     or gestor_id = (select public.merchan_my_app_user_id())
  ))
);
create policy gestores_admin_write on public.campana_gestores for all to authenticated
using ((select public.merchan_is_admin())) with check ((select public.merchan_is_admin()));

-- incidencias_campana: se hereda del punto (que ya está filtrado por provincia).
-- La gestora sí escribe: abrir y resolver incidencias es su trabajo.
drop policy if exists authenticated_all on public.incidencias_campana;
drop policy if exists incidencias_scope on public.incidencias_campana;
create policy incidencias_scope on public.incidencias_campana for all to authenticated
using (
  (select public.merchan_is_admin())
  or ((select public.merchan_has_profile())
      and exists (select 1 from public.puntos_venta_campana p where p.id = incidencias_campana.punto_id))
)
with check (
  (select public.merchan_is_admin())
  or ((select public.merchan_has_profile())
      and exists (select 1 from public.puntos_venta_campana p where p.id = incidencias_campana.punto_id))
);

-- campana_columnas: configuración de columnas de una campaña. Se lee si se ve
-- la campaña; solo admin la cambia.
drop policy if exists authenticated_all on public.campana_columnas;
drop policy if exists columnas_read on public.campana_columnas;
drop policy if exists columnas_admin_write on public.campana_columnas;
create policy columnas_read on public.campana_columnas for select to authenticated
using (
  (select public.merchan_is_admin())
  or ((select public.merchan_has_profile())
      and exists (select 1 from public.grandes_campanas g where g.id = campana_columnas.campana_id))
);
create policy columnas_admin_write on public.campana_columnas for all to authenticated
using ((select public.merchan_is_admin())) with check ((select public.merchan_is_admin()));

-- clients: ver nota (b). Lectura para cualquier perfil, escritura solo admin.
drop policy if exists authenticated_all on public.clients;
drop policy if exists clients_read on public.clients;
drop policy if exists clients_admin_write on public.clients;
create policy clients_read on public.clients for select to authenticated
using ((select public.merchan_has_profile()));
create policy clients_admin_write on public.clients for all to authenticated
using ((select public.merchan_is_admin())) with check ((select public.merchan_is_admin()));

-- big_campaigns: tiene province propia, se filtra igual que el resto.
drop policy if exists authenticated_all on public.big_campaigns;
drop policy if exists big_campaigns_scope on public.big_campaigns;
create policy big_campaigns_scope on public.big_campaigns for all to authenticated
using (
  (select public.merchan_is_admin())
  or ((select public.merchan_has_profile()) and (province is null
      or public.merchan_norm_province(province) = any (((select public.merchan_province_scope()))::text[])))
)
with check (
  (select public.merchan_is_admin())
  or ((select public.merchan_has_profile()) and (province is null
      or public.merchan_norm_province(province) = any (((select public.merchan_province_scope()))::text[])))
);

-- attachments: cuelgan de un servicio, que ya está filtrado por provincia.
drop policy if exists authenticated_all on public.attachments;
drop policy if exists attachments_scope on public.attachments;
create policy attachments_scope on public.attachments for all to authenticated
using (
  (select public.merchan_is_admin())
  or ((select public.merchan_has_profile())
      and exists (select 1 from public.services s where s.id = attachments.service_id))
)
with check (
  (select public.merchan_is_admin())
  or ((select public.merchan_has_profile())
      and exists (select 1 from public.services s where s.id = attachments.service_id))
);

-- worker_addresses: direcciones de envío del instalador. Se hereda del
-- trabajador, que ya está filtrado por provincia.
drop policy if exists authenticated_all on public.worker_addresses;
drop policy if exists worker_addresses_scope on public.worker_addresses;
create policy worker_addresses_scope on public.worker_addresses for all to authenticated
using (
  (select public.merchan_is_admin())
  or ((select public.merchan_has_profile())
      and exists (select 1 from public.workers w where w.id = worker_addresses.worker_id))
)
with check (
  (select public.merchan_is_admin())
  or ((select public.merchan_has_profile())
      and exists (select 1 from public.workers w where w.id = worker_addresses.worker_id))
);

-- ============================================================================
-- 2. ECONÓMICO: permiso 'pagos' Y provincia
-- ============================================================================
-- payment_obligations: hoy el 100% de las filas son de origen ISDIN y su
-- source_id casa con isdin_vinyls.vinyl (489/489 comprobado). La provincia se
-- hereda del vinilo, que ya está filtrado. La condición de origen no-ISDIN se
-- deja abierta a admin para no ocultar en silencio obligaciones futuras de
-- otros orígenes: se verán solo con perfil de administración hasta que se
-- modele su provincia.
drop policy if exists pagos_only on public.payment_obligations;
drop policy if exists pagos_scope on public.payment_obligations;
create policy pagos_scope on public.payment_obligations for all to authenticated
using (
  (select public.merchan_has_perm('pagos')) and (
    (select public.merchan_is_admin())
    or exists (select 1 from public.isdin_vinyls v where v.vinyl = payment_obligations.source_id)
  )
)
with check (
  (select public.merchan_has_perm('pagos')) and (
    (select public.merchan_is_admin())
    or exists (select 1 from public.isdin_vinyls v where v.vinyl = payment_obligations.source_id)
  )
);

drop policy if exists pagos_only on public.payment_obligations_audit;
drop policy if exists pagos_scope on public.payment_obligations_audit;
create policy pagos_scope on public.payment_obligations_audit for all to authenticated
using (
  (select public.merchan_has_perm('pagos')) and (
    (select public.merchan_is_admin())
    or exists (select 1 from public.payment_obligations o where o.id = payment_obligations_audit.obligation_id)
  )
)
with check (
  (select public.merchan_has_perm('pagos')) and (
    (select public.merchan_is_admin())
    or exists (select 1 from public.payment_obligations o where o.id = payment_obligations_audit.obligation_id)
  )
);

-- payment_ledger tiene province propia.
drop policy if exists authenticated_all on public.payment_ledger;
drop policy if exists ledger_scope on public.payment_ledger;
create policy ledger_scope on public.payment_ledger for all to authenticated
using (
  (select public.merchan_has_perm('pagos')) and (
    (select public.merchan_is_admin())
    or province is null
    or public.merchan_norm_province(province) = any (((select public.merchan_province_scope()))::text[])
  )
)
with check (
  (select public.merchan_has_perm('pagos')) and (
    (select public.merchan_is_admin())
    or province is null
    or public.merchan_norm_province(province) = any (((select public.merchan_province_scope()))::text[])
  )
);

drop policy if exists authenticated_all on public.payment_audit_log;
drop policy if exists ledger_audit_scope on public.payment_audit_log;
create policy ledger_audit_scope on public.payment_audit_log for all to authenticated
using (
  (select public.merchan_has_perm('pagos')) and (
    (select public.merchan_is_admin())
    or exists (select 1 from public.payment_ledger l where l.id = payment_audit_log.ledger_id)
  )
)
with check (
  (select public.merchan_has_perm('pagos')) and (
    (select public.merchan_is_admin())
    or exists (select 1 from public.payment_ledger l where l.id = payment_audit_log.ledger_id)
  )
);

-- economic_events ya exigía 'pagos'; se le añade la provincia (columna propia).
drop policy if exists pagos_only on public.economic_events;
drop policy if exists eco_scope on public.economic_events;
create policy eco_scope on public.economic_events for all to authenticated
using (
  (select public.merchan_has_perm('pagos')) and (
    (select public.merchan_is_admin())
    or provincia is null
    or public.merchan_norm_province(provincia) = any (((select public.merchan_province_scope()))::text[])
  )
)
with check (
  (select public.merchan_has_perm('pagos')) and (
    (select public.merchan_is_admin())
    or provincia is null
    or public.merchan_norm_province(provincia) = any (((select public.merchan_province_scope()))::text[])
  )
);

-- economic_month_closures es un calendario GLOBAL de meses cerrados: no tiene
-- ni puede tener provincia. Se queda en permiso 'pagos' para leer y solo admin
-- para cerrar o reabrir un mes.
drop policy if exists authenticated_all on public.economic_month_closures;
drop policy if exists cierres_read on public.economic_month_closures;
drop policy if exists cierres_admin_write on public.economic_month_closures;
create policy cierres_read on public.economic_month_closures for select to authenticated
using ((select public.merchan_has_perm('pagos')));
create policy cierres_admin_write on public.economic_month_closures for all to authenticated
using ((select public.merchan_is_admin())) with check ((select public.merchan_is_admin()));

-- ============================================================================
-- 3. LOGÍSTICA: lectura para todos, escritura solo operadores logísticos
-- ============================================================================
-- OPS es de SOLO CONSULTA en logística (saveLogisticsState está retirado desde
-- C2) y necesita leer para pintar el estado del material en cada servicio, así
-- que la lectura se mantiene abierta a cualquier perfil. La escritura pasa a
-- exigir merchan_can_logistics(): almacén, admin o permiso 'logistica'.
-- Los RPC transaccionales (v8_2/v8_7) son SECURITY INVOKER, así que se ejecutan
-- con estos mismos permisos: quien no sea operador logístico tampoco podrá
-- mutar a través de ellos.
do $$
declare t text;
begin
  foreach t in array array[
    'logistics_materials','logistics_entries','logistics_entry_lines','logistics_stock',
    'logistics_stock_movements','logistics_pickings','logistics_picking_lines',
    'logistics_shipments','logistics_incidents','logistics_pending_arrivals',
    'logistics_material_requirements','logistics_requests','logistics_request_lines',
    'logistics_vins','logistics_notifications','logistics_audit_log',
    'integration_events','sync_logs','outbox_events','inbox_processed'
  ]
  loop
    if exists (select 1 from pg_tables where schemaname='public' and tablename=t) then
      execute format('drop policy if exists authenticated_all on public.%I', t);
      execute format('drop policy if exists logistica_read on public.%I', t);
      execute format('drop policy if exists logistica_write on public.%I', t);
      execute format(
        'create policy logistica_read on public.%I for select to authenticated using ((select public.merchan_has_profile()))', t);
      execute format(
        'create policy logistica_write on public.%I for all to authenticated using ((select public.merchan_can_logistics())) with check ((select public.merchan_can_logistics()))', t);
    end if;
  end loop;
end $$;

-- ============================================================================
-- 4. ÍNDICES DE APOYO
-- ============================================================================
-- Las políticas nuevas hacen EXISTS sobre estas columnas en cada fila filtrada.
create index if not exists idx_isdin_vinyls_vinyl            on public.isdin_vinyls (vinyl);
create index if not exists idx_pvc_campana                   on public.puntos_venta_campana (campana_id);
create index if not exists idx_payment_obl_audit_obligation  on public.payment_obligations_audit (obligation_id);
create index if not exists idx_payment_audit_ledger          on public.payment_audit_log (ledger_id);
create index if not exists idx_attachments_service           on public.attachments (service_id);
create index if not exists idx_worker_addresses_worker       on public.worker_addresses (worker_id);
create index if not exists idx_campana_columnas_campana      on public.campana_columnas (campana_id);
create index if not exists idx_incidencias_campana_punto     on public.incidencias_campana (punto_id);

-- ============================================================================
-- RESULTADO MEDIDO (filas visibles por perfil, tras aplicar)
-- ============================================================================
--                clientes servicios campañas puntos gestores vinilos pagos
--   admin            31      247        4     1012     10      475    489
--   Mai (12 prov)    31      247        4      319      4      475    489
--   Marc (8 prov)    31        0        3      153      4        0      0
--   Kilian (1 prov)  31        0        3      198      2        0      0
--   Natalia almacén  31        0        4        0      1        0      0
--
-- Antes de v9_11 TODOS veían: 31 clientes, 4 campañas, 10 gestores, 489 pagos.
-- El admin no pierde nada. Logística intacta para los cinco (17 materiales,
-- 16 de stock) y almacén conserva su escritura (stock 16 filas, peticiones 12).
--
-- Escritura verificada como BLOQUEADA para una gestora: editar campañas,
-- autoasignarse a una campaña, borrar clientes y reabrir un cierre mensual.
-- Almacén tampoco puede editar campañas.
--
-- Rendimiento tras el cambio (gestora, count(*) con RLS): nada por encima de
-- 15 ms; puntos_venta_campana 6,6 ms y payment_obligations 5,5 ms. Se conserva
-- el InitPlan de v9_8 porque todas las llamadas van envueltas en (select ...).

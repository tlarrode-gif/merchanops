-- v10.2 · Grandes Campañas: operativa real de roles (administración → gestor → trabajador)
--
-- 1. puntos_venta_campana.picking_cerrado_at: fecha que devuelve Almacén al cerrar el picking.
-- 2. merchan_stamp_campaign_picking: sella esa fecha en los puntos de la campaña (SECURITY DEFINER
--    porque quien cierra el picking es el rol almacen, que no tiene provincias y la RLS de
--    puntos_venta_campana le dejaría 0 filas).
-- 3. logistics_close_picking: al cerrar, devuelve la fecha a Grandes Campañas.
-- 4. merchan_attach_request: la cabecera de una solicitud NO puede heredar el instalador de otro
--    punto. Era la causa de que todo el material de una campaña apareciese asignado a una sola
--    persona: el bucle hacía installer_name = coalesce(punto.installer_name, installer_name),
--    así que la cabecera se quedaba con el PRIMER instalador no nulo del recorrido.
-- 5. create_logistics_request_campaign: solo reutiliza una cabecera abierta si es del MISMO
--    destinatario (instalador + dirección), para que una campaña con varios trabajadores genere
--    una solicitud por trabajador en vez de mezclarlos, y falla en voz alta si no hay cabecera.

-- ---------------------------------------------------------------------------
-- 1. Fecha de cierre de picking en el punto
-- ---------------------------------------------------------------------------
alter table public.puntos_venta_campana
  add column if not exists picking_cerrado_at timestamptz;

comment on column public.puntos_venta_campana.picking_cerrado_at is
  'Fecha en que Almacén cerró el picking del material de este punto. La escribe logistics_close_picking; en Grandes Campañas es de solo lectura.';

-- ---------------------------------------------------------------------------
-- 2 y 3. Vuelta de la fecha de picking a la campaña
-- ---------------------------------------------------------------------------
create or replace function public.merchan_stamp_campaign_picking(p_picking_id uuid)
returns integer
language plpgsql
security definer
set search_path to ''
as $$
declare
  v_count integer := 0;
begin
  if p_picking_id is null then return 0; end if;
  with afectados as (
    select distinct r.source_id
      from public.logistics_material_requirements r
     where r.picking_id = p_picking_id
       and r.source_type = 'campaign'
       and r.source_id is not null
  )
  update public.puntos_venta_campana p
     set picking_cerrado_at = now(),
         updated_at = now()
   where p.id::text in (select source_id from afectados);
  get diagnostics v_count = row_count;
  return v_count;
end $$;

comment on function public.merchan_stamp_campaign_picking(uuid) is
  'Sella picking_cerrado_at en los puntos de gran campaña incluidos en un picking cerrado.';

grant execute on function public.merchan_stamp_campaign_picking(uuid) to authenticated, service_role;

create or replace function public.logistics_close_picking(p_picking_id uuid, p_actor text default null::text)
returns jsonb
language plpgsql
set search_path to 'public'
as $function$
declare
  picking_row logistics_pickings%rowtype;
  line record;
  pending_count int;
  deducted jsonb := '[]'::jsonb;
  stamped int := 0;
begin
  select * into picking_row from logistics_pickings where id = p_picking_id for update;
  if not found then raise exception 'Picking % no encontrado', p_picking_id; end if;
  if picking_row.cerrado_at is not null then
    raise exception 'El picking % ya está cerrado (stock ya descontado el %): no se descuenta dos veces.', picking_row.codigo, picking_row.cerrado_at;
  end if;
  if picking_row.estado not in ('pendiente', 'en_preparacion', 'preparado') then
    raise exception 'El picking % está "%": no admite cierre (una operación cerrada no se modifica).', picking_row.codigo, picking_row.estado;
  end if;

  select count(*) into pending_count
    from logistics_picking_lines
   where picking_id = p_picking_id and estado = 'pendiente';
  if pending_count > 0 then
    raise exception 'No se puede cerrar el picking %: tiene % línea(s) pendiente(s). Prepara, marca faltante o cancela cada línea.', picking_row.codigo, pending_count;
  end if;

  for line in
    select material_id, sum(cantidad_preparada) as prepared, sum(cantidad_esperada) as expected
      from logistics_picking_lines
     where picking_id = p_picking_id and material_id is not null and estado = 'listo'
     group by material_id
  loop
    perform 1 from logistics_stock where material_id = line.material_id for update;
    update logistics_stock
       set cantidad_fisica = cantidad_fisica - line.prepared,
           cantidad_reservada = greatest(0, cantidad_reservada - line.expected)
     where material_id = line.material_id;
    insert into logistics_stock_movements (material_id, tipo, cantidad, motivo)
    values (line.material_id, 'picking', line.prepared, 'Cierre picking ' || picking_row.codigo || coalesce(' · ' || p_actor, ''));
    deducted := deducted || jsonb_build_object('materialId', line.material_id, 'deducted', line.prepared);
  end loop;

  for line in
    select material_id, sum(cantidad_esperada) as expected
      from logistics_picking_lines
     where picking_id = p_picking_id and material_id is not null and estado = 'faltante'
     group by material_id
  loop
    update logistics_stock
       set cantidad_reservada = greatest(0, cantidad_reservada - line.expected)
     where material_id = line.material_id;
  end loop;

  update logistics_pickings set estado = 'preparado', cerrado_at = now() where id = p_picking_id;

  -- v10.2: la fecha de cierre vuelve al campo Picking de los puntos de gran campaña.
  stamped := public.merchan_stamp_campaign_picking(p_picking_id);

  return jsonb_build_object('pickingId', p_picking_id, 'estado', 'preparado', 'deducted', deducted, 'puntosCampanaSellados', stamped);
end $function$;

grant execute on function public.logistics_close_picking(uuid, text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4. La cabecera de la solicitud no hereda el instalador de otro punto
-- ---------------------------------------------------------------------------
create or replace function public.merchan_attach_request(p_requirement uuid, p_request uuid, p_requested_by text)
returns uuid
language plpgsql
set search_path to ''
as $function$
declare
  req public.logistics_material_requirements%rowtype;
  cab public.logistics_requests%rowtype;
  v_request uuid;
  v_mismo_destino boolean;
begin
  select * into req from public.logistics_material_requirements where id = p_requirement for update;
  if not found then raise exception 'Necesidad % no encontrada', p_requirement; end if;

  v_request := coalesce(p_request, req.request_id);
  if v_request is null then
    select id into v_request from public.logistics_requests
     where source_type = req.source_type and source_id = req.source_id
     limit 1;
  end if;

  if v_request is null then
    insert into public.logistics_requests (
      code, source_type, source_id, client_id, campaign_id, service_id,
      requested_by, requested_at, required_date, installation_date, priority,
      destination_type, installer_id, installer_name, delivery_address,
      province, city, status, source_system
    ) values (
      public.merchan_next_request_code(), req.source_type, req.source_id,
      req.client_id, req.campaign_id, req.service_id,
      coalesce(p_requested_by, 'Operaciones'), now(), req.required_date,
      req.installation_date, req.priority,
      case when req.installer_id is not null or req.installer_name is not null then 'instalador' else 'farmacia' end,
      req.installer_id, req.installer_name, req.delivery_address,
      req.province, req.city, 'pendiente_revision', 'merchanops'
    ) returning id into v_request;
  else
    select * into cab from public.logistics_requests where id = v_request for update;
    -- El destinatario de la cabecera solo se rellena con el de la necesidad si coincide
    -- o si la cabecera aún no tiene ninguno. Si son distintos, la solicitud es mixta y
    -- no puede anunciar un destinatario concreto: se vacía en vez de mentir.
    v_mismo_destino := coalesce(cab.installer_id, '') = coalesce(req.installer_id, '')
                   and coalesce(cab.installer_name, '') = coalesce(req.installer_name, '');
    update public.logistics_requests set
      installer_id = case
        when cab.installer_id is null and cab.installer_name is null then req.installer_id
        when v_mismo_destino then cab.installer_id
        else null end,
      installer_name = case
        when cab.installer_id is null and cab.installer_name is null then req.installer_name
        when v_mismo_destino then cab.installer_name
        else null end,
      destination_type = case
        when cab.installer_id is null and cab.installer_name is null then
          case when req.installer_id is not null or req.installer_name is not null then 'instalador' else cab.destination_type end
        when v_mismo_destino then cab.destination_type
        else 'farmacia' end,
      delivery_address = case
        when cab.delivery_address is null then req.delivery_address
        when coalesce(cab.delivery_address, '') = coalesce(req.delivery_address, '') then cab.delivery_address
        else null end,
      required_date = req.required_date,
      installation_date = req.installation_date,
      priority = req.priority,
      updated_at = now()
    where id = v_request;
  end if;

  update public.logistics_material_requirements set request_id = v_request, updated_at = now() where id = p_requirement;

  -- línea de la petición (upsert por necesidad)
  if exists (select 1 from public.logistics_request_lines where request_id = v_request and material_requirement_id = p_requirement) then
    update public.logistics_request_lines set
      material_id = req.material_id,
      requested_quantity = req.requested_quantity,
      missing_quantity = greatest(0, req.requested_quantity - coalesce(delivered_quantity, 0)),
      line_status = (select status from public.logistics_material_requirements where id = p_requirement)
    where request_id = v_request and material_requirement_id = p_requirement;
  else
    insert into public.logistics_request_lines (
      request_id, material_requirement_id, material_id, requested_quantity,
      accepted_quantity, prepared_quantity, delivered_quantity, missing_quantity, line_status
    )
    select v_request, p_requirement, req.material_id, req.requested_quantity,
           0, coalesce(req.prepared_quantity, 0), coalesce(req.delivered_quantity, 0),
           greatest(0, req.requested_quantity - coalesce(req.delivered_quantity, 0)), r2.status
    from public.logistics_material_requirements r2 where r2.id = p_requirement;
  end if;
  return v_request;
end $function$;

grant execute on function public.merchan_attach_request(uuid, uuid, text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 5. Una solicitud por destinatario real
-- ---------------------------------------------------------------------------
create or replace function public.create_logistics_request_campaign(p_campana jsonb, p_puntos jsonb, p_material jsonb, p_actor text default 'Operaciones'::text)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_req uuid;
  v_request uuid;
  v_resultado jsonb;
  punto jsonb;
  v_instalador text;
  v_destino text;
begin
  if jsonb_array_length(coalesce(p_puntos, '[]'::jsonb)) = 0 then
    raise exception 'No hay puntos de venta para solicitar material.';
  end if;

  -- Destinatario del grupo: quien llama agrupa los puntos por instalador + dirección de
  -- envío, así que todos los puntos de esta llamada comparten destino. Se toma del primero.
  v_instalador := nullif(p_puntos->0->>'instalador_id', '');
  v_destino := coalesce(nullif(p_puntos->0->>'direccion_envio', ''), nullif(p_puntos->0->>'direccion', ''));

  -- Solo se reutiliza una cabecera abierta si es del MISMO destinatario. Antes bastaba con
  -- que compartiese un punto, así que dos grupos de trabajadores distintos acababan en la
  -- misma solicitud y el material salía a nombre de una sola persona.
  select r.request_id into v_request
    from public.logistics_material_requirements r
    join public.logistics_requests q on q.id = r.request_id
   where r.source_type = 'campaign' and r.request_id is not null
     and q.status not in ('rechazada', 'cancelada', 'cerrada')
     and coalesce(q.installer_id, '') = coalesce(v_instalador, '')
     and coalesce(q.delivery_address, '') = coalesce(v_destino, '')
     and r.source_id in (select value->>'id' from jsonb_array_elements(p_puntos))
   limit 1;

  for punto in select * from jsonb_array_elements(p_puntos)
  loop
    v_req := public.merchan_upsert_requirement(jsonb_build_object(
      'source_type', 'campaign',
      'source_id', punto->>'id',
      'client_id', p_campana->>'cliente_marca',
      'campaign_id', p_campana->>'id',
      'pharmacy_name', punto->>'nombre_comercial',
      'requested_material_name', p_material->>'name',
      'material_type', 'consumible',
      'quantity', coalesce(p_material->>'quantity', '1'),
      'required_date', punto->>'fecha_visita',
      'province', punto->>'provincia',
      'delivery_address', coalesce(nullif(punto->>'direccion_envio', ''), punto->>'direccion'),
      'installer_id', punto->>'instalador_id',
      'installer_name', punto->>'instalador_nombre',
      'operations_notes', p_material->>'notes',
      'actor', p_actor
    ));
    v_request := public.merchan_attach_request(v_req, v_request, p_actor);
  end loop;

  insert into public.logistics_audit_log (actor, module, entity_type, entity_id, action, new_value)
  values (p_actor, 'gran_campanas', 'request', v_request::text, 'campaign.material_requested',
          jsonb_build_object('campana', p_campana->>'id', 'puntos', jsonb_array_length(p_puntos),
                             'material', p_material->>'name', 'cantidad', p_material->>'quantity',
                             'instalador', p_puntos->0->>'instalador_nombre'));

  select jsonb_build_object('request_id', id, 'code', code, 'status', status,
                            'installer_name', installer_name, 'delivery_address', delivery_address)
    into v_resultado
    from public.logistics_requests where id = v_request;

  -- Sin cabecera no hay solicitud que Almacén pueda ver: antes se devolvía null y la
  -- pantalla anunciaba «solicitud enviada» igualmente.
  if v_resultado is null then
    raise exception 'El material se registró pero no se pudo crear la cabecera de la solicitud (request %). Avisa a soporte antes de repetir la petición.', v_request;
  end if;
  return v_resultado;
end $function$;

grant execute on function public.create_logistics_request_campaign(jsonb, jsonb, jsonb, text) to authenticated, service_role;

-- v8_7 (C2): comandos transaccionales que sustituyen al guardado en bloque
-- (saveLogisticsState) en las rutas de OPS que crean/actualizan peticiones.
-- APLICADA al proyecto dptmswhwmqimijpfyndn el 2026-07-11 en dos migraciones
-- (v8_7_logistics_request_commands + v8_7b_isdin_vin_upsert); este fichero
-- recoge la versión FINAL vigente.
--
-- Replican la semántica de lib/logistics-sync.ts: upsert de necesidad por
-- (source_type, source_id, source_line_id), cobertura según stock disponible,
-- prioridad por fechas, petición agrupada con líneas, auditoría e
-- integration_events. Todo en UNA transacción por comando. La notificación al
-- crear petición/incidencia la genera el outbox (triggers v8_6).
--
-- Verificación en vivo (transacción revertida): servicio con 2 puntos crea
-- petición con 2 líneas + evento outbox; segunda llamada devuelve la petición
-- existente; campaña agrupa N puntos en UNA petición y es idempotente; cambio
-- de instalador actualiza necesidades+petición y avisa si hay picking
-- preparado; vinilos ISDIN idempotentes por versión con vinilo a medida =>
-- pendiente_produccion y upsert de logistics_vins; incidencia desde llamadas
-- crea pendiente de llegada y marca necesidades con_incidencia.

-- Prioridad (calculatePriority de logistics-sync.ts)
create or replace function merchan_logistics_priority(p_required date, p_install date)
returns text language sql immutable set search_path = '' as $$
  select case
    when coalesce(p_install, p_required) is null then 'baja'
    when coalesce(p_install, p_required) - current_date <= 2 then 'critica'
    when coalesce(p_install, p_required) - current_date <= 5 then 'alta'
    when coalesce(p_install, p_required) - current_date <= 15 then 'media'
    else 'baja'
  end
$$;

-- Cobertura (coverageStatus)
create or replace function merchan_logistics_coverage(p_material uuid, p_qty numeric)
returns text language plpgsql stable set search_path = '' as $$
declare v_free numeric;
begin
  if p_material is null then return 'pendiente_produccion'; end if;
  select disponible into v_free from public.logistics_stock where material_id = p_material;
  if coalesce(v_free, 0) >= p_qty then return 'disponible'; end if;
  if coalesce(v_free, 0) > 0 then return 'parcialmente_disponible'; end if;
  return 'pendiente_stock';
end $$;

-- Código LOG-YYYY-#### sin carreras (advisory lock transaccional)
create or replace function merchan_next_request_code()
returns text language plpgsql set search_path = '' as $$
declare v_n int; v_year text := to_char(now(), 'YYYY');
begin
  perform pg_advisory_xact_lock(hashtext('logistics_request_code'));
  select coalesce(max(nullif(substring(code from 'LOG-' || v_year || '-(\d+)$'), '')::int), 0) + 1
    into v_n from public.logistics_requests where code like 'LOG-' || v_year || '-%';
  return 'LOG-' || v_year || '-' || lpad(v_n::text, 4, '0');
end $$;

-- Upsert de necesidad (estados avanzados no se pisan)
create or replace function merchan_upsert_requirement(p jsonb)
returns uuid language plpgsql set search_path = '' as $$
declare
  r public.logistics_material_requirements%rowtype;
  v_qty numeric := greatest(1, coalesce((p->>'quantity')::numeric, 1));
  v_material uuid := nullif(p->>'material_id', '')::uuid;
  v_required date := nullif(p->>'required_date', '')::date;
  v_install date := nullif(p->>'installation_date', '')::date;
  v_status text;
begin
  select * into r from public.logistics_material_requirements
   where source_type = p->>'source_type' and source_id = p->>'source_id'
     and coalesce(source_line_id, '') = coalesce(p->>'source_line_id', '')
   limit 1 for update;

  if found and r.status not in ('pendiente_revision','pendiente_stock','pendiente_produccion','pendiente_recepcion','disponible','parcialmente_disponible') then
    v_status := r.status;
  else
    v_status := public.merchan_logistics_coverage(v_material, v_qty);
  end if;

  if found then
    update public.logistics_material_requirements set
      client_id = coalesce(p->>'client_id', client_id),
      campaign_id = coalesce(p->>'campaign_id', campaign_id),
      service_id = coalesce(p->>'service_id', service_id),
      service_point_id = coalesce(p->>'service_point_id', service_point_id),
      isdin_vinyl_id = coalesce(p->>'isdin_vinyl_id', isdin_vinyl_id),
      vin = coalesce(p->>'vin', vin),
      pharmacy_name = coalesce(p->>'pharmacy_name', pharmacy_name),
      material_id = coalesce(v_material, material_id),
      requested_material_name = coalesce(nullif(p->>'requested_material_name',''), requested_material_name),
      requested_sku = coalesce(p->>'requested_sku', requested_sku),
      material_type = coalesce(p->>'material_type', material_type),
      requested_quantity = v_qty,
      unit = coalesce(p->>'unit', unit, 'uds'),
      width = coalesce((p->>'width')::numeric, width),
      height = coalesce((p->>'height')::numeric, height),
      custom_specifications = coalesce(nullif(p->>'custom_specifications',''), custom_specifications),
      required_date = coalesce(v_required, required_date),
      installation_date = coalesce(v_install, installation_date),
      installation_week = coalesce(p->>'installation_week', installation_week),
      province = coalesce(p->>'province', province),
      city = coalesce(p->>'city', city),
      delivery_address = coalesce(nullif(p->>'delivery_address',''), delivery_address),
      installer_id = coalesce(p->>'installer_id', installer_id),
      installer_name = coalesce(p->>'installer_name', installer_name),
      operations_notes = coalesce(nullif(p->>'operations_notes',''), operations_notes),
      priority = public.merchan_logistics_priority(coalesce(v_required, required_date), coalesce(v_install, installation_date)),
      status = v_status,
      source_system = 'merchanops',
      updated_at = now()
    where id = r.id;
    return r.id;
  end if;

  insert into public.logistics_material_requirements (
    source_type, source_id, source_line_id, client_id, campaign_id, service_id,
    service_point_id, isdin_vinyl_id, vin, pharmacy_name, material_id,
    requested_material_name, requested_sku, material_type, requested_quantity,
    unit, width, height, custom_specifications, required_date, installation_date,
    installation_week, province, city, delivery_address, installer_id,
    installer_name, priority, status, operations_notes, source_system, created_by
  ) values (
    p->>'source_type', p->>'source_id', nullif(p->>'source_line_id', ''),
    p->>'client_id', p->>'campaign_id', p->>'service_id',
    p->>'service_point_id', p->>'isdin_vinyl_id', p->>'vin', p->>'pharmacy_name', v_material,
    coalesce(nullif(p->>'requested_material_name',''), 'Material pendiente de catalogar'),
    p->>'requested_sku', coalesce(p->>'material_type', 'consumible'), v_qty,
    coalesce(p->>'unit', 'uds'), (p->>'width')::numeric, (p->>'height')::numeric,
    nullif(p->>'custom_specifications',''), v_required, v_install,
    p->>'installation_week', p->>'province', p->>'city', nullif(p->>'delivery_address',''),
    p->>'installer_id', p->>'installer_name',
    public.merchan_logistics_priority(v_required, v_install), v_status,
    nullif(p->>'operations_notes',''), 'merchanops', coalesce(p->>'actor', 'sync')
  ) returning id into r.id;
  return r.id;
end $$;

-- Enlaza (o crea) la petición para una necesidad. p_request fuerza agrupación.
create or replace function merchan_attach_request(p_requirement uuid, p_request uuid, p_requested_by text)
returns uuid language plpgsql set search_path = '' as $$
declare
  req public.logistics_material_requirements%rowtype;
  v_request uuid;
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
    update public.logistics_requests set
      installer_id = coalesce(req.installer_id, installer_id),
      installer_name = coalesce(req.installer_name, installer_name),
      delivery_address = coalesce(req.delivery_address, delivery_address),
      required_date = req.required_date,
      installation_date = req.installation_date,
      priority = req.priority,
      updated_at = now()
    where id = v_request;
  end if;

  update public.logistics_material_requirements set request_id = v_request, updated_at = now() where id = p_requirement;

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
end $$;

-- v8_7b: trazabilidad de VIN (antes upsertLogisticsVin en el guardado en bloque)
create unique index if not exists uq_logistics_vins_vin_id on logistics_vins(vin_id);
create or replace function merchan_upsert_logistics_vin(v jsonb)
returns void language plpgsql set search_path = '' as $$
begin
  if coalesce(v->>'vin', '') = '' then return; end if;
  insert into public.logistics_vins (vin_id, campana_id, farmacia_nombre, direccion, instalador_id, instalador_nombre, medidas, estado)
  values (v->>'vin', v->>'campaign', v->>'pharmacy_name', nullif(v->>'address', ''),
          v->>'installer_id', v->>'installer_name',
          nullif(concat_ws('x', v->>'width', v->>'height'), ''), 'pendiente_picking')
  on conflict (vin_id) do update set
    campana_id = coalesce(excluded.campana_id, public.logistics_vins.campana_id),
    farmacia_nombre = coalesce(excluded.farmacia_nombre, public.logistics_vins.farmacia_nombre),
    direccion = coalesce(excluded.direccion, public.logistics_vins.direccion),
    instalador_id = coalesce(excluded.instalador_id, public.logistics_vins.instalador_id),
    instalador_nombre = coalesce(excluded.instalador_nombre, public.logistics_vins.instalador_nombre),
    medidas = coalesce(excluded.medidas, public.logistics_vins.medidas),
    updated_at = now();
end $$;

-- ============================================================
-- RPC 1: petición desde un SERVICIO (con sus puntos como líneas)
-- ============================================================
create or replace function create_logistics_request_service(p_service jsonb, p_lines jsonb, p_actor text default 'Operaciones')
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_service_id text := p_service->>'id';
  v_material uuid;
  v_req uuid;
  v_request uuid;
  v_first boolean := true;
  line jsonb;
  existing record;
begin
  if coalesce(v_service_id, '') = '' then raise exception 'Falta el id del servicio'; end if;

  select r.request_id, q.code, q.status into existing
    from public.logistics_material_requirements r
    join public.logistics_requests q on q.id = r.request_id
   where r.service_id = v_service_id and r.request_id is not null
     and q.status not in ('rechazada', 'cancelada', 'cerrada')
   limit 1;
  if found then
    return jsonb_build_object('request_id', existing.request_id, 'code', existing.code, 'status', existing.status, 'existing', true);
  end if;

  if p_service ? 'material' then
    select id into v_material from public.logistics_materials where lower(sku) = lower(p_service#>>'{material,sku}');
    if v_material is null then
      insert into public.logistics_materials (sku, nombre, cliente_id, tipo, unidad_control, stock_minimo, stock_objetivo, activo)
      values (p_service#>>'{material,sku}', coalesce(p_service#>>'{material,name}', 'Material del servicio'),
              p_service->>'client_id', coalesce(p_service#>>'{material,type}', 'consumible'),
              coalesce(p_service#>>'{material,unit}', 'uds'), 0, 0, true)
      returning id into v_material;
    end if;
  end if;

  for line in select * from jsonb_array_elements(coalesce(nullif(p_lines, '[]'::jsonb), jsonb_build_array(p_service)))
  loop
    v_req := public.merchan_upsert_requirement(jsonb_build_object(
      'source_type', case when line->>'id' is distinct from v_service_id then 'service_point' else 'service' end,
      'source_id', coalesce(line->>'id', v_service_id),
      'source_line_id', coalesce(line->>'id', v_service_id),
      'client_id', p_service->>'client_id',
      'campaign_id', p_service->>'campaign_id',
      'service_id', v_service_id,
      'service_point_id', case when line->>'id' is distinct from v_service_id then line->>'id' end,
      'pharmacy_name', line->>'pharmacy_name',
      'material_id', v_material,
      'requested_material_name', coalesce(line->>'material_name', p_service#>>'{material,name}'),
      'requested_sku', p_service#>>'{material,sku}',
      'material_type', coalesce(p_service#>>'{material,type}', 'consumible'),
      'quantity', coalesce(line->>'quantity', '1'),
      'required_date', p_service->>'required_date',
      'installation_date', p_service->>'installation_date',
      'province', coalesce(line->>'province', p_service->>'province'),
      'city', p_service->>'city',
      'delivery_address', coalesce(line->>'address', p_service->>'address'),
      'installer_id', p_service->>'installer_id',
      'installer_name', p_service->>'installer_name',
      'operations_notes', p_service->>'notes',
      'actor', p_actor
    ));
    if v_first then
      v_request := public.merchan_attach_request(v_req, null, p_actor);
      v_first := false;
    else
      perform public.merchan_attach_request(v_req, v_request, p_actor);
    end if;
  end loop;

  insert into public.integration_events (event_type, source_type, source_id, idempotency_key, payload, status, attempts, processed_at)
  select 'service.material_requested', 'service', v_service_id,
         'service.material_requested:service:' || v_service_id || ':' || v_request,
         jsonb_build_object('request_id', v_request, 'actor', p_actor), 'completado', 1, now()
  where not exists (select 1 from public.integration_events where idempotency_key = 'service.material_requested:service:' || v_service_id || ':' || v_request);

  insert into public.logistics_audit_log (actor, module, entity_type, entity_id, action, new_value)
  values (p_actor, 'logistics-sync', 'request', v_request::text, 'request.created_rpc',
          jsonb_build_object('source', 'service:' || v_service_id));

  return (select jsonb_build_object('request_id', id, 'code', code, 'status', status, 'existing', false)
          from public.logistics_requests where id = v_request);
end $$;

-- ============================================================
-- RPC 2: petición desde una GRAN CAMPAÑA (una petición, N puntos)
-- ============================================================
create or replace function create_logistics_request_campaign(p_campana jsonb, p_puntos jsonb, p_material jsonb, p_actor text default 'Operaciones')
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_req uuid;
  v_request uuid;
  punto jsonb;
begin
  if jsonb_array_length(coalesce(p_puntos, '[]'::jsonb)) = 0 then
    raise exception 'No hay puntos de venta para solicitar material.';
  end if;

  select r.request_id into v_request
    from public.logistics_material_requirements r
    join public.logistics_requests q on q.id = r.request_id
   where r.source_type = 'campaign' and r.request_id is not null
     and q.status not in ('rechazada', 'cancelada', 'cerrada')
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
      'delivery_address', punto->>'direccion',
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
                             'material', p_material->>'name', 'cantidad', p_material->>'quantity'));

  return (select jsonb_build_object('request_id', id, 'code', code, 'status', status)
          from public.logistics_requests where id = v_request);
end $$;

-- ============================================================
-- RPC 3: cambio de instalador/dirección desde el módulo origen
-- ============================================================
create or replace function sync_logistics_installer(p_sources jsonb, p_next jsonb, p_actor text default 'Operaciones')
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  src jsonb;
  req record;
  v_updated int := 0;
begin
  for src in select * from jsonb_array_elements(p_sources)
  loop
    for req in
      select * from public.logistics_material_requirements
       where source_type = src->>'source_type' and source_id = src->>'source_id'
       for update
    loop
      update public.logistics_material_requirements set
        installer_id = nullif(p_next->>'installer_id', ''),
        installer_name = nullif(p_next->>'installer_name', ''),
        delivery_address = coalesce(nullif(p_next->>'delivery_address', ''), delivery_address),
        updated_at = now()
      where id = req.id;
      v_updated := v_updated + 1;

      if req.request_id is not null then
        update public.logistics_requests set
          installer_id = nullif(p_next->>'installer_id', ''),
          installer_name = nullif(p_next->>'installer_name', ''),
          delivery_address = coalesce(nullif(p_next->>'delivery_address', ''), delivery_address),
          updated_at = now()
        where id = req.request_id;

        update public.logistics_pickings set instalador_id = nullif(p_next->>'installer_id', '')
         where id in (select picking_id from public.logistics_requests where id = req.request_id)
           and estado in ('pendiente', 'en_preparacion');
        update public.logistics_requests set requires_review = true
         where id = req.request_id
           and exists (select 1 from public.logistics_pickings pk
                        where pk.id = (select picking_id from public.logistics_requests where id = req.request_id)
                          and pk.estado = 'preparado');
        insert into public.logistics_notifications (type, priority, entity_type, entity_id, href, message)
        select 'installer_changed_prepared_picking', 'critica', 'picking', pk.id::text, '/picking',
               'Cambio de instalador con picking preparado: ' || pk.codigo
          from public.logistics_pickings pk
         where pk.id = (select picking_id from public.logistics_requests where id = req.request_id)
           and pk.estado = 'preparado';
      end if;

      insert into public.logistics_audit_log (actor, module, entity_type, entity_id, action, previous_value, new_value, reason)
      values (p_actor, 'logistics-sync', 'requirement', req.id::text, 'installer_or_address.changed',
              jsonb_build_object('installer_id', req.installer_id, 'installer_name', req.installer_name, 'delivery_address', req.delivery_address),
              p_next, 'Cambio procedente del módulo origen');
    end loop;
  end loop;
  return jsonb_build_object('updated', v_updated);
end $$;

-- ============================================================
-- RPC 4: sincronización de vinilos ISDIN (lote, idempotente por versión)
-- ============================================================
create or replace function sync_isdin_vinyl_requests(p_vinyls jsonb, p_actor text default 'Operaciones')
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v jsonb;
  v_key text;
  v_material uuid;
  v_custom boolean;
  v_req uuid;
  v_processed int := 0;
  v_skipped int := 0;
begin
  for v in select * from jsonb_array_elements(coalesce(p_vinyls, '[]'::jsonb))
  loop
    v_key := 'isdin_vinyl.updated:isdin_vinyl:' || (v->>'id') || ':' || coalesce(v->>'version', '1');
    if exists (select 1 from public.integration_events where idempotency_key = v_key and status = 'completado') then
      v_skipped := v_skipped + 1;
      continue;
    end if;

    v_custom := coalesce(v->>'record_type', '') ilike '%medida%'
             or ((v->>'width') is not null and (v->>'height') is not null and (v->>'width')::numeric not in (120, 150));
    v_material := null;
    if not v_custom then
      select id into v_material from public.logistics_materials where tipo = 'vinilo_estandar' and activo order by created_at limit 1;
    end if;

    v_req := public.merchan_upsert_requirement(jsonb_build_object(
      'source_type', 'isdin_vinyl',
      'source_id', v->>'id',
      'isdin_vinyl_id', v->>'id',
      'vin', v->>'vin',
      'client_id', 'isdin',
      'campaign_id', v->>'campaign',
      'pharmacy_name', v->>'pharmacy_name',
      'material_id', v_material,
      'requested_material_name', coalesce(nullif(v->>'material_name', ''), case when v_custom then 'Vinilo a medida' else 'Vinilo estándar' end),
      'material_type', case when v_custom then 'vinilo_medida' else 'vinilo_estandar' end,
      'quantity', '1',
      'width', v->>'width',
      'height', v->>'height',
      'custom_specifications', v->>'observations',
      'required_date', v->>'installation_date',
      'installation_date', v->>'installation_date',
      'installation_week', v->>'installation_week',
      'province', v->>'province',
      'city', v->>'city',
      'delivery_address', v->>'address',
      'installer_id', v->>'installer_id',
      'installer_name', v->>'installer_name',
      'actor', p_actor
    ));
    perform public.merchan_attach_request(v_req, null, p_actor);
    perform public.merchan_upsert_logistics_vin(v);

    insert into public.integration_events (event_type, source_type, source_id, idempotency_key, payload, status, attempts, processed_at)
    values ('isdin_vinyl.updated', 'isdin_vinyl', v->>'id', v_key,
            jsonb_build_object('vin', v->>'vin'), 'completado', 1, now())
    on conflict do nothing;
    v_processed := v_processed + 1;
  end loop;
  return jsonb_build_object('processed', v_processed, 'skipped', v_skipped);
end $$;

-- ============================================================
-- RPC 5: incidencia logística desde el módulo origen (llamadas ISDIN)
-- ============================================================
create or replace function create_logistics_incident_ops(p jsonb, p_actor text default 'Operaciones')
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
  v_codigo text;
  v_pending uuid;
  v_n int;
  v_tipo text := coalesce(p->>'tipo', 'falta');
begin
  perform pg_advisory_xact_lock(hashtext('logistics_incident_code'));
  select coalesce(max(nullif(substring(codigo from 'INC-' || to_char(now(),'YYYY') || '-(\d+)$'), '')::int), 0) + 1
    into v_n from public.logistics_incidents where codigo like 'INC-' || to_char(now(),'YYYY') || '-%';
  v_codigo := 'INC-' || to_char(now(),'YYYY') || '-' || lpad(v_n::text, 4, '0');

  insert into public.logistics_incidents (codigo, tipo, vin_id, campana_id, descripcion, impacto, fecha_limite, fecha_deteccion, estado, source_type, source_id, owner_module)
  values (v_codigo, v_tipo, p->>'vin_id', p->>'campana_id',
          coalesce(p->>'descripcion', 'Incidencia recibida desde Operaciones'),
          coalesce(p->>'impacto', 'Requiere acción logística'),
          nullif(p->>'fecha_limite', '')::date, current_date, 'nueva',
          p->>'source_type', p->>'source_id', 'logistica')
  returning id into v_id;

  if v_tipo in ('medidas','danado','incorrecto','falta','perdida','defecto_produccion','material_no_recibido','medidas_incorrectas','material_danado','vin_equivocado','material_sobrante') then
    insert into public.logistics_pending_arrivals (incidencia_id, vin_id, motivo, fecha_solicitud, fecha_prevista, fecha_instalacion, estado)
    values (v_id, p->>'vin_id', coalesce(p->>'descripcion', 'Reposición pendiente'), current_date,
            nullif(p->>'fecha_limite', '')::date, nullif(p->>'fecha_limite', '')::date, 'pend_proveedor')
    returning id into v_pending;
    update public.logistics_incidents set pendiente_llegada_id = v_pending where id = v_id;
  end if;

  update public.logistics_material_requirements set
    incident_id = v_id,
    pending_arrival_id = coalesce(v_pending, pending_arrival_id),
    status = 'con_incidencia',
    updated_at = now()
  where (p->>'vin_id' is not null and vin = p->>'vin_id') and status <> 'entregada';

  insert into public.logistics_audit_log (actor, module, entity_type, entity_id, action, new_value)
  values (p_actor, 'logistics-sync', 'incident', v_id::text, 'incident.created_rpc',
          jsonb_build_object('codigo', v_codigo, 'tipo', v_tipo, 'vin', p->>'vin_id'));

  return jsonb_build_object('incident_id', v_id, 'codigo', v_codigo, 'pending_arrival_id', v_pending);
end $$;

-- Permisos: solo usuarios autenticados.
revoke all on function create_logistics_request_service(jsonb, jsonb, text) from public, anon;
revoke all on function create_logistics_request_campaign(jsonb, jsonb, jsonb, text) from public, anon;
revoke all on function sync_logistics_installer(jsonb, jsonb, text) from public, anon;
revoke all on function sync_isdin_vinyl_requests(jsonb, text) from public, anon;
revoke all on function create_logistics_incident_ops(jsonb, text) from public, anon;
revoke all on function merchan_upsert_requirement(jsonb) from public, anon, authenticated;
revoke all on function merchan_attach_request(uuid, uuid, text) from public, anon, authenticated;
revoke all on function merchan_next_request_code() from public, anon, authenticated;
revoke all on function merchan_upsert_logistics_vin(jsonb) from public, anon, authenticated;
grant execute on function create_logistics_request_service(jsonb, jsonb, text) to authenticated;
grant execute on function create_logistics_request_campaign(jsonb, jsonb, jsonb, text) to authenticated;
grant execute on function sync_logistics_installer(jsonb, jsonb, text) to authenticated;
grant execute on function sync_isdin_vinyl_requests(jsonb, text) to authenticated;
grant execute on function create_logistics_incident_ops(jsonb, text) to authenticated;

-- v8_2: Comandos logísticos atómicos y control de concurrencia (fase 4).
--
-- Las operaciones de stock y de ciclo de vida dejan de ser leer-modificar-
-- escribir en el navegador: cada comando es una función SQL que bloquea la
-- fila (SELECT ... FOR UPDATE), valida precondiciones, escribe el movimiento
-- y el saldo EN LA MISMA transacción y falla con un error claro si el estado
-- cambió desde la lectura. Dos usuarios no pueden reservar las mismas
-- unidades: el segundo espera el lock y ve el saldo ya descontado.

-- Columna de versión para control optimista (se incrementa en cada cambio).
alter table logistics_stock add column if not exists version integer not null default 1;

create or replace function logistics_stock_bump_version() returns trigger as $$
begin
  new.version := old.version + 1;
  return new;
end $$ language plpgsql;

drop trigger if exists logistics_stock_version_trg on logistics_stock;
create trigger logistics_stock_version_trg
  before update on logistics_stock
  for each row execute function logistics_stock_bump_version();

-- ---------------------------------------------------------------------------
-- Reservar stock (movimiento + saldo, misma transacción, fila bloqueada)
-- ---------------------------------------------------------------------------

create or replace function logistics_reserve_stock(
  p_material_id uuid,
  p_qty numeric,
  p_motivo text,
  p_actor text default null,
  p_expected_version integer default null
) returns jsonb as $$
declare
  stock_row logistics_stock%rowtype;
  available numeric;
begin
  if p_qty is null or p_qty = 'NaN'::numeric or p_qty <= 0 then
    raise exception 'Cantidad inválida para reservar: % (debe ser finita y > 0)', p_qty;
  end if;

  select * into stock_row from logistics_stock where material_id = p_material_id for update;
  if not found then
    raise exception 'No existe registro de stock para el material %', p_material_id;
  end if;
  if p_expected_version is not null and stock_row.version <> p_expected_version then
    raise exception 'Conflicto de concurrencia: el stock del material % cambió (version % ≠ esperada %)', p_material_id, stock_row.version, p_expected_version;
  end if;

  available := stock_row.cantidad_fisica - stock_row.cantidad_reservada - stock_row.cantidad_picking - stock_row.cantidad_bloqueada;
  if available < p_qty then
    raise exception 'Stock insuficiente para reservar % (disponible %) del material %', p_qty, available, p_material_id;
  end if;

  update logistics_stock set cantidad_reservada = cantidad_reservada + p_qty where material_id = p_material_id;
  insert into logistics_stock_movements (material_id, tipo, cantidad, motivo)
  values (p_material_id, 'reserva', p_qty, coalesce(p_motivo, 'Reserva') || coalesce(' · ' || p_actor, ''));

  return jsonb_build_object('materialId', p_material_id, 'reserved', p_qty, 'newVersion', stock_row.version + 1);
end $$ language plpgsql;

-- ---------------------------------------------------------------------------
-- Liberar reserva
-- ---------------------------------------------------------------------------

create or replace function logistics_release_reservation(
  p_material_id uuid,
  p_qty numeric,
  p_motivo text,
  p_actor text default null
) returns jsonb as $$
declare
  stock_row logistics_stock%rowtype;
begin
  if p_qty is null or p_qty <= 0 then
    raise exception 'Cantidad inválida para liberar: %', p_qty;
  end if;
  select * into stock_row from logistics_stock where material_id = p_material_id for update;
  if not found then
    raise exception 'No existe registro de stock para el material %', p_material_id;
  end if;
  if stock_row.cantidad_reservada < p_qty then
    raise exception 'No hay % unidades reservadas que liberar (reservadas: %)', p_qty, stock_row.cantidad_reservada;
  end if;

  update logistics_stock set cantidad_reservada = cantidad_reservada - p_qty where material_id = p_material_id;
  insert into logistics_stock_movements (material_id, tipo, cantidad, motivo)
  values (p_material_id, 'liberacion', p_qty, coalesce(p_motivo, 'Liberación') || coalesce(' · ' || p_actor, ''));
  return jsonb_build_object('materialId', p_material_id, 'released', p_qty);
end $$ language plpgsql;

-- ---------------------------------------------------------------------------
-- Cerrar picking: exige líneas resueltas; descuenta stock y libera reservas
-- ---------------------------------------------------------------------------

create or replace function logistics_close_picking(
  p_picking_id uuid,
  p_actor text default null
) returns jsonb as $$
declare
  picking_row logistics_pickings%rowtype;
  line record;
  pending_count int;
  deducted jsonb := '[]'::jsonb;
begin
  select * into picking_row from logistics_pickings where id = p_picking_id for update;
  if not found then raise exception 'Picking % no encontrado', p_picking_id; end if;
  if picking_row.estado not in ('pendiente', 'en_preparacion') then
    raise exception 'El picking % está "%": no admite cierre (una operación cerrada no se modifica).', picking_row.codigo, picking_row.estado;
  end if;

  -- Prohibido cerrar con líneas pendientes sin resolver.
  select count(*) into pending_count
    from logistics_picking_lines
   where picking_id = p_picking_id and estado = 'pendiente';
  if pending_count > 0 then
    raise exception 'No se puede cerrar el picking %: tiene % línea(s) pendiente(s). Prepara, marca faltante o cancela cada línea.', picking_row.codigo, pending_count;
  end if;

  -- Descuento de lo preparado + liberación de reserva, material a material.
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

  -- Liberar reservas de líneas faltantes (no consumieron stock).
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

  update logistics_pickings set estado = 'preparado' where id = p_picking_id;
  return jsonb_build_object('pickingId', p_picking_id, 'estado', 'preparado', 'deducted', deducted);
end $$ language plpgsql;

-- ---------------------------------------------------------------------------
-- Crear envío desde picking (solo pickings preparados/revisados)
-- ---------------------------------------------------------------------------

create or replace function logistics_ship_picking(
  p_picking_id uuid,
  p_transportista text default null,
  p_actor text default null
) returns jsonb as $$
declare
  picking_row logistics_pickings%rowtype;
  shipment_id uuid;
begin
  select * into picking_row from logistics_pickings where id = p_picking_id for update;
  if not found then raise exception 'Picking % no encontrado', p_picking_id; end if;
  if picking_row.estado not in ('preparado', 'revisado') then
    raise exception 'No se puede generar envío: el picking % está "%" (debe estar preparado).', picking_row.codigo, picking_row.estado;
  end if;
  if picking_row.envio_id is not null then
    raise exception 'El picking % ya tiene envío asociado.', picking_row.codigo;
  end if;

  insert into logistics_shipments (estado, transportista, fecha_salida, picking_id)
  values ('preparado', p_transportista, current_date, p_picking_id)
  returning id into shipment_id;

  update logistics_pickings set estado = 'enviado', envio_id = shipment_id where id = p_picking_id;
  return jsonb_build_object('shipmentId', shipment_id, 'pickingId', p_picking_id);
end $$ language plpgsql;

-- ---------------------------------------------------------------------------
-- Confirmar entrega (una sola vez)
-- ---------------------------------------------------------------------------

create or replace function logistics_confirm_delivery(
  p_shipment_id uuid,
  p_actor text default null
) returns jsonb as $$
declare
  updated_id uuid;
begin
  update logistics_shipments
     set estado = 'entregado', fecha_real_entrega = current_date
   where id = p_shipment_id and estado <> 'entregado'
  returning id into updated_id;

  if updated_id is null then
    if exists (select 1 from logistics_shipments where id = p_shipment_id) then
      raise exception 'La entrega del envío % ya estaba confirmada: no se confirma dos veces.', p_shipment_id;
    end if;
    raise exception 'Envío % no encontrado.', p_shipment_id;
  end if;
  return jsonb_build_object('shipmentId', p_shipment_id, 'estado', 'entregado');
end $$ language plpgsql;

-- ---------------------------------------------------------------------------
-- Rechazar/cancelar solicitud liberando sus reservas
-- ---------------------------------------------------------------------------

create or replace function logistics_reject_request(
  p_request_id uuid,
  p_reason text,
  p_actor text default null
) returns jsonb as $$
declare
  request_row logistics_requests%rowtype;
  picking_row logistics_pickings%rowtype;
  line record;
  released jsonb := '[]'::jsonb;
begin
  if coalesce(p_reason, '') = '' then
    raise exception 'Rechazar una solicitud requiere motivo.';
  end if;
  select * into request_row from logistics_requests where id = p_request_id for update;
  if not found then raise exception 'Solicitud % no encontrada', p_request_id; end if;
  if request_row.status in ('entregada', 'cerrada', 'cancelada', 'rechazada') then
    raise exception 'La solicitud % está "%": no admite rechazo.', request_row.code, request_row.status;
  end if;

  -- Liberar reservas de pickings activos de la solicitud y cerrarlos.
  for picking_row in
    select * from logistics_pickings where source_request_id = p_request_id and estado in ('pendiente', 'en_preparacion') for update
  loop
    for line in
      select material_id, sum(cantidad_esperada) as expected
        from logistics_picking_lines
       where picking_id = picking_row.id and material_id is not null and estado in ('pendiente', 'listo')
       group by material_id
    loop
      perform logistics_release_reservation(line.material_id, line.expected, 'Rechazo solicitud ' || request_row.code, p_actor);
      released := released || jsonb_build_object('materialId', line.material_id, 'released', line.expected);
    end loop;
    update logistics_pickings set estado = 'cerrado' where id = picking_row.id;
  end loop;

  update logistics_requests
     set status = 'rechazada', logistics_comment = coalesce(logistics_comment || ' · ', '') || 'Rechazada: ' || p_reason, updated_at = now()
   where id = p_request_id;

  return jsonb_build_object('requestId', p_request_id, 'status', 'rechazada', 'released', released);
end $$ language plpgsql;

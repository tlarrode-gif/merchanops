-- v8_8 (A8): cierre de picking apto para el flujo de MerchanLOGS.
-- APLICADA al proyecto dptmswhwmqimijpfyndn el 2026-07-11.
-- 1) Idempotencia DURA: cerrado_at marca el descuento de stock; un segundo
--    cierre falla en alto y claro (jamás doble descuento).
-- 2) Acepta también estado 'preparado' (LOGS prepara las líneas primero y
--    después cierra descontando).
--
-- Verificación en vivo (transacción revertida): cierre desde 'preparado' con
-- línea lista (esperado 5, preparado 4) + línea faltante (esperado 3) sobre
-- stock 20/8 => física 16, reservada 0; segundo cierre rechazado con stock
-- intacto; envío generado y no duplicable; entrega confirmada exactamente una
-- vez.
alter table logistics_pickings add column if not exists cerrado_at timestamptz;

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
  return jsonb_build_object('pickingId', p_picking_id, 'estado', 'preparado', 'deducted', deducted);
end $$ language plpgsql set search_path = public;

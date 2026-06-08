-- Módulo completo de Logística MerchanOps.
-- Los movimientos de stock son inmutables: los errores se corrigen con ajustes.

create table if not exists logistics_materials (
  id uuid primary key default uuid_generate_v4(),
  sku text unique not null,
  nombre text not null,
  cliente_id text,
  tipo text not null check (tipo in ('vinilo_estandar','vinilo_medida','herramienta','consumible')),
  medidas text,
  unidad_control text not null default 'uds' check (unidad_control in ('uds','rollos','m2','cajas')),
  stock_minimo numeric default 0,
  stock_objetivo numeric default 0,
  proveedor_id text,
  coste numeric,
  activo boolean default true,
  created_at timestamptz default now()
);

create table if not exists logistics_entries (
  id uuid primary key default uuid_generate_v4(),
  albaran text not null,
  fecha_prevista date,
  fecha_recepcion date,
  proveedor_id text,
  transportista text,
  num_bultos_esperado numeric default 0,
  num_bultos_recibido numeric default 0,
  estado text not null default 'pendiente' check (estado in ('pendiente','recibido_parcial','recibido_completo','con_incidencia','rechazado','cerrado')),
  observaciones text,
  creado_por text,
  created_at timestamptz default now()
);

create table if not exists logistics_entry_lines (
  id uuid primary key default uuid_generate_v4(),
  entrada_id uuid references logistics_entries(id) on delete cascade,
  material_id uuid references logistics_materials(id),
  cantidad_esperada numeric default 0,
  cantidad_recibida numeric default 0,
  cantidad_correcta numeric default 0,
  cantidad_danada numeric default 0,
  diferencia numeric generated always as (cantidad_recibida - cantidad_esperada) stored,
  incidencia_id uuid
);

create table if not exists logistics_stock (
  id uuid primary key default uuid_generate_v4(),
  material_id uuid unique references logistics_materials(id),
  cantidad_fisica numeric default 0,
  cantidad_reservada numeric default 0,
  cantidad_picking numeric default 0,
  cantidad_bloqueada numeric default 0,
  disponible numeric generated always as (cantidad_fisica - cantidad_reservada - cantidad_picking - cantidad_bloqueada) stored,
  constraint logistics_stock_not_negative check (
    cantidad_fisica >= 0 and cantidad_reservada >= 0 and cantidad_picking >= 0 and cantidad_bloqueada >= 0
    and cantidad_fisica - cantidad_reservada - cantidad_picking - cantidad_bloqueada >= 0
  )
);

create table if not exists logistics_stock_movements (
  id uuid primary key default uuid_generate_v4(),
  material_id uuid references logistics_materials(id),
  tipo text not null check (tipo in ('entrada','salida','reserva','liberacion','picking','entrega','consumo','devolucion','danio','perdida','ajuste','transferencia')),
  cantidad numeric not null,
  origen text,
  destino text,
  usuario_id text,
  campana_id text,
  vin_id text,
  motivo text not null,
  created_at timestamptz default now()
);

create table if not exists logistics_pickings (
  id uuid primary key default uuid_generate_v4(),
  codigo text unique not null,
  instalador_id text,
  campana_id text,
  zona text,
  fecha_salida_prevista date,
  estado text not null default 'pendiente' check (estado in ('pendiente','en_preparacion','preparado','revisado','enviado','recibido','cerrado')),
  num_puntos numeric default 0,
  envio_id uuid,
  created_at timestamptz default now()
);

create table if not exists logistics_picking_lines (
  id uuid primary key default uuid_generate_v4(),
  picking_id uuid references logistics_pickings(id) on delete cascade,
  material_id uuid references logistics_materials(id),
  vin_id text,
  cantidad_esperada numeric default 0,
  cantidad_preparada numeric default 0,
  estado text not null default 'pendiente' check (estado in ('pendiente','listo','faltante')),
  justificacion_faltante text
);

create table if not exists logistics_shipments (
  id uuid primary key default uuid_generate_v4(),
  picking_id uuid references logistics_pickings(id),
  fecha_salida date,
  transportista text,
  tracking text,
  destinatario_id text,
  instalador_id text,
  num_bultos numeric default 0,
  fecha_estimada_entrega date,
  fecha_real_entrega date,
  confirmado_por_instalador boolean default false,
  estado text not null default 'pendiente' check (estado in ('pendiente','preparado','recogido','en_transito','entregado','fallido','extraviado','devuelto'))
);

create table if not exists logistics_incidents (
  id uuid primary key default uuid_generate_v4(),
  codigo text unique not null,
  tipo text not null check (tipo in ('sin_picking','medidas','danado','incorrecto','falta','exceso','perdida','entrega_fallida','defecto_produccion')),
  material_id uuid references logistics_materials(id),
  vin_id text,
  campana_id text,
  farmacia_id text,
  picking_id uuid references logistics_pickings(id),
  envio_id uuid references logistics_shipments(id),
  entrada_id uuid references logistics_entries(id),
  responsable_id text,
  fecha_deteccion date default current_date,
  descripcion text not null,
  impacto text,
  fecha_limite date,
  estado text not null default 'nueva' check (estado in ('nueva','en_revision','pend_proveedor','pend_produccion','pend_transporte','mat_enviado','resuelta','cancelada')),
  pendiente_llegada_id uuid
);

create table if not exists logistics_pending_arrivals (
  id uuid primary key default uuid_generate_v4(),
  incidencia_id uuid references logistics_incidents(id),
  vin_id text,
  material_id uuid references logistics_materials(id),
  motivo text not null,
  fecha_solicitud date default current_date,
  fecha_prevista date,
  fecha_instalacion date,
  proveedor_id text,
  estado text not null default 'pend_proveedor' check (estado in ('pend_proveedor','en_produccion','en_transito','recibido','asignado_picking','cerrado')),
  en_riesgo boolean default false
);

create index if not exists idx_logistics_movements_material on logistics_stock_movements(material_id);
create index if not exists idx_logistics_movements_vin on logistics_stock_movements(vin_id);
create index if not exists idx_logistics_pickings_campaign on logistics_pickings(campana_id);
create index if not exists idx_logistics_incidents_vin on logistics_incidents(vin_id);
create index if not exists idx_logistics_pending_status on logistics_pending_arrivals(estado);

create or replace function prevent_logistics_movement_mutation()
returns trigger as $$
begin
  raise exception 'Los movimientos de stock son inmutables. Crea un ajuste con motivo obligatorio.';
end;
$$ language plpgsql;

drop trigger if exists trg_prevent_logistics_movement_update on logistics_stock_movements;
create trigger trg_prevent_logistics_movement_update
before update or delete on logistics_stock_movements
for each row execute function prevent_logistics_movement_mutation();

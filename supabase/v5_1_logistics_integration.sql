-- Integración transversal de Logística con Servicios, ISDIN, campañas e incidencias.
-- Compatible y no destructiva: no modifica pagos, facturación ni visitas fallidas.

alter table services
add column if not exists requires_material boolean default false,
add column if not exists logistics_status text,
add column if not exists logistics_request_id uuid,
add column if not exists logistics_last_sync_at timestamptz,
add column if not exists logistics_sync_event_id uuid;

alter table points
add column if not exists requires_material boolean default false,
add column if not exists logistics_status text,
add column if not exists logistics_request_id uuid,
add column if not exists has_logistics_impact boolean default false,
add column if not exists logistics_incident_id uuid,
add column if not exists replacement_required boolean default false,
add column if not exists affected_material_id uuid,
add column if not exists affected_quantity numeric;

alter table isdin_vinyls
add column if not exists logistics_status text,
add column if not exists logistics_request_id uuid,
add column if not exists logistics_material_requirement_id uuid,
add column if not exists logistics_picking_id uuid,
add column if not exists logistics_shipment_id uuid,
add column if not exists logistics_incident_id uuid,
add column if not exists logistics_pending_arrival_id uuid,
add column if not exists logistics_blocked boolean default false,
add column if not exists logistics_last_sync_at timestamptz,
add column if not exists logistics_sync_event_id uuid;

alter table isdin_calls
add column if not exists requires_logistics_action boolean default false,
add column if not exists logistics_need_type text,
add column if not exists logistics_comment text,
add column if not exists logistics_required_date date,
add column if not exists logistics_incident_id uuid,
add column if not exists logistics_material_requirement_id uuid;

create table if not exists logistics_material_requirements (
  id uuid primary key default uuid_generate_v4(),
  source_type text not null check (source_type in ('service','service_point','isdin_vinyl','campaign','incident','replacement','manual_request')),
  source_id text not null,
  source_line_id text,
  client_id text,
  campaign_id text,
  service_id text,
  service_point_id text,
  isdin_vinyl_id text,
  vin text,
  pharmacy_id text,
  pharmacy_name text,
  material_id uuid references logistics_materials(id),
  requested_material_name text not null,
  requested_sku text,
  material_type text not null check (material_type in ('vinilo_estandar','vinilo_medida','herramienta','consumible')),
  requested_quantity numeric not null default 1,
  unit text not null default 'uds' check (unit in ('uds','rollos','m2','cajas')),
  width numeric,
  height numeric,
  custom_specifications text,
  required_date date,
  installation_date date,
  installation_week text,
  province text,
  city text,
  delivery_address text,
  installer_id text,
  installer_name text,
  priority text not null default 'media' check (priority in ('critica','alta','media','baja')),
  status text not null default 'pendiente_revision' check (status in ('pendiente_revision','aceptada','pendiente_stock','pendiente_produccion','pendiente_recepcion','parcialmente_disponible','disponible','reservada','en_picking','preparada','enviada','entregada','consumida','cancelada','bloqueada','con_incidencia')),
  logistics_notes text,
  operations_notes text,
  request_id uuid,
  picking_id uuid,
  shipment_id uuid,
  incident_id uuid,
  pending_arrival_id uuid,
  received_quantity numeric default 0,
  reserved_quantity numeric default 0,
  prepared_quantity numeric default 0,
  delivered_quantity numeric default 0,
  source_system text,
  sync_event_id uuid,
  created_by text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists logistics_requests (
  id uuid primary key default uuid_generate_v4(),
  code text unique not null,
  source_type text not null,
  source_id text not null,
  client_id text,
  campaign_id text,
  service_id text,
  requested_by text,
  requested_at timestamptz default now(),
  required_date date,
  installation_date date,
  priority text not null default 'media' check (priority in ('critica','alta','media','baja')),
  destination_type text default 'instalador',
  installer_id text,
  installer_name text,
  delivery_address text,
  province text,
  city text,
  status text not null default 'pendiente_revision' check (status in ('borrador','enviada','pendiente_revision','aceptada','parcialmente_aceptada','rechazada','pendiente_material','en_preparacion','preparada','enviada_transporte','entregada','cerrada','cancelada','bloqueada')),
  accepted_by text,
  accepted_at timestamptz,
  rejection_reason text,
  logistics_comment text,
  operations_comment text,
  picking_id uuid,
  shipment_id uuid,
  source_system text,
  sync_event_id uuid,
  requires_review boolean default false,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists logistics_request_lines (
  id uuid primary key default uuid_generate_v4(),
  request_id uuid references logistics_requests(id) on delete cascade,
  material_requirement_id uuid references logistics_material_requirements(id) on delete cascade,
  material_id uuid references logistics_materials(id),
  requested_quantity numeric default 0,
  accepted_quantity numeric default 0,
  prepared_quantity numeric default 0,
  delivered_quantity numeric default 0,
  missing_quantity numeric default 0,
  substitution_material_id uuid references logistics_materials(id),
  substitution_status text check (substitution_status is null or substitution_status in ('propuesta','aceptada','rechazada')),
  line_status text,
  comment text
);

create table if not exists integration_events (
  id uuid primary key default uuid_generate_v4(),
  event_type text not null,
  source_type text not null,
  source_id text not null,
  idempotency_key text unique not null,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'pendiente' check (status in ('pendiente','procesando','completado','error')),
  attempts integer not null default 0,
  last_error text,
  created_at timestamptz default now(),
  processed_at timestamptz
);

create table if not exists logistics_audit_log (
  id uuid primary key default uuid_generate_v4(),
  actor text,
  module text not null,
  entity_type text not null,
  entity_id text not null,
  action text not null,
  previous_value jsonb,
  new_value jsonb,
  reason text,
  sync_event_id uuid,
  created_at timestamptz default now()
);

create table if not exists logistics_notifications (
  id uuid primary key default uuid_generate_v4(),
  type text not null,
  priority text not null default 'media' check (priority in ('critica','alta','media','baja')),
  responsible text,
  entity_type text not null,
  entity_id text not null,
  href text not null,
  message text not null,
  read boolean default false,
  resolved boolean default false,
  created_at timestamptz default now()
);

alter table logistics_entry_lines add column if not exists vin_id text;
alter table logistics_entry_lines add column if not exists service_id text;
alter table logistics_entry_lines add column if not exists campaign_id text;
alter table logistics_entry_lines add column if not exists picking_id uuid;
alter table logistics_entry_lines add column if not exists observations text;

alter table logistics_entries add column if not exists campaign_id text;
alter table logistics_entries add column if not exists client_id text;
alter table logistics_entries add column if not exists logistics_request_id uuid;
alter table logistics_entries add column if not exists logistics_incident_id uuid;
alter table logistics_entries add column if not exists pending_arrival_id uuid;

alter table logistics_incidents add column if not exists source_type text;
alter table logistics_incidents add column if not exists source_id text;
alter table logistics_incidents add column if not exists original_incident_id text;
alter table logistics_incidents add column if not exists replacement_required boolean default false;

create index if not exists idx_logistics_requirements_source on logistics_material_requirements(source_type, source_id);
create unique index if not exists idx_logistics_requirements_source_unique on logistics_material_requirements(source_type, source_id, coalesce(source_line_id, 'main'));
create index if not exists idx_logistics_requirements_vin on logistics_material_requirements(vin);
create index if not exists idx_logistics_requirements_status on logistics_material_requirements(status);
create index if not exists idx_logistics_requests_status on logistics_requests(status);
create index if not exists idx_logistics_request_lines_request on logistics_request_lines(request_id);
create index if not exists idx_integration_events_status on integration_events(status);
create index if not exists idx_logistics_notifications_open on logistics_notifications(priority, resolved, read);

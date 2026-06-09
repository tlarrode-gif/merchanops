-- V5.2 Logística bidireccional: VIN compartido, SyncLog y entrada manual.
-- No toca pagos, facturación ni la lógica de visita fallida.

create table if not exists logistics_vins (
  id uuid primary key default uuid_generate_v4(),
  vin_id text not null unique,
  material_id uuid references logistics_materials(id),
  campana_id text,
  farmacia_id text,
  farmacia_nombre text,
  direccion text,
  telefono text,
  responsable text,
  instalador_id text,
  instalador_nombre text,
  medidas text,
  estado text not null default 'pendiente_picking',
  picking_id uuid,
  shipment_id uuid,
  incident_id uuid,
  pending_arrival_id uuid,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists sync_logs (
  id uuid primary key default uuid_generate_v4(),
  evento text not null,
  origen_modulo text not null,
  destino_modulo text not null,
  entidad_id text,
  usuario_id text,
  payload jsonb not null default '{}'::jsonb,
  resultado text not null check (resultado in ('ok','error')),
  error_message text,
  created_at timestamptz default now()
);

alter table logistics_entries add column if not exists tracking_number text;
alter table logistics_entries add column if not exists photos jsonb default '[]'::jsonb;

alter table logistics_entry_lines add column if not exists estado_material text;
alter table logistics_entry_lines add column if not exists vin_ids text[] default '{}';
alter table logistics_entry_lines add column if not exists photos jsonb default '[]'::jsonb;

alter table logistics_pickings add column if not exists source_request_id uuid;
alter table logistics_picking_lines add column if not exists installer_id text;
alter table logistics_picking_lines add column if not exists pharmacy_id text;
alter table logistics_picking_lines add column if not exists delivery_address text;

alter table logistics_requests add column if not exists urgency text;
alter table logistics_requests add column if not exists rejection_reason text;

alter table logistics_incidents add column if not exists owner_module text;
alter table logistics_incidents add column if not exists shared boolean default true;
alter table logistics_incidents add column if not exists resolution text;
alter table logistics_incidents add column if not exists resolved_at timestamptz;

create index if not exists idx_logistics_vins_vin on logistics_vins(vin_id);
create index if not exists idx_logistics_vins_status on logistics_vins(estado);
create index if not exists idx_logistics_vins_installer on logistics_vins(instalador_id);
create index if not exists idx_sync_logs_event on sync_logs(evento, resultado);
create index if not exists idx_sync_logs_created on sync_logs(created_at desc);

comment on table sync_logs is 'Auditoría funcional de sincronización entre Servicios, ISDIN y Logística.';
comment on column sync_logs.payload is 'Payload resumido del evento de dominio aplicado.';
comment on table logistics_vins is 'Estado logístico compartido por VIN/campaña sin duplicar pagos ni facturación.';

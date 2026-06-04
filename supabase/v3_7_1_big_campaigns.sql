-- MerchanOps V3.7.1
-- Tablas base para Grandes Campañas.
-- No borra datos existentes.

create extension if not exists "uuid-ossp";

create table if not exists big_campaigns (
  id uuid primary key default uuid_generate_v4(),
  client_id uuid references clients(id) on delete set null,
  client text not null,
  ceco text,
  name text not null,
  province text,
  start_date date,
  deadline date,
  reporting_channel text default 'WhatsApp',
  calendar_color text default 'blue',
  status text default 'Activa',
  payment_type text default 'Puntos',
  hourly_rate numeric default 0,
  default_point_fee numeric default 0,
  instructions text,
  notes text,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now()
);

create table if not exists big_campaign_points (
  id uuid primary key default uuid_generate_v4(),
  big_campaign_id uuid references big_campaigns(id) on delete cascade,
  worker_id uuid references workers(id) on delete set null,
  worker_name text,
  name text not null,
  address text,
  province text,
  fee numeric default 0,
  original_fee numeric,
  incident_fee numeric default 8.56,
  report_code text,
  notes text,
  point_status text default 'Pendiente',
  point_comment text,
  incident_status text,
  incident_comment text,
  incident_opened_at timestamp with time zone,
  incident_resolved_at timestamp with time zone,
  incident_next_action text,
  incident_due_date date,
  reported_at timestamp with time zone,
  finished_at timestamp with time zone,
  validated_at timestamp with time zone,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now()
);

alter table big_campaigns disable row level security;
alter table big_campaign_points disable row level security;

create index if not exists idx_big_campaigns_client_id on big_campaigns(client_id);
create index if not exists idx_big_campaigns_status on big_campaigns(status);
create index if not exists idx_big_campaigns_deadline on big_campaigns(deadline);
create index if not exists idx_big_campaign_points_campaign_id on big_campaign_points(big_campaign_id);
create index if not exists idx_big_campaign_points_worker_id on big_campaign_points(worker_id);
create index if not exists idx_big_campaign_points_status on big_campaign_points(point_status);
create index if not exists idx_big_campaign_points_province on big_campaign_points(province);

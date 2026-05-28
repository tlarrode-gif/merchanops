-- MerchanOps V3.7
-- Módulo específico ISDIN dentro de Grandes Campañas.
-- No borra datos existentes.

create table if not exists isdin_vinyls (
  id uuid primary key default gen_random_uuid(),
  pharmacy_name text not null,
  vinyl text not null,
  status text default 'Nuevo',
  comments text,
  vinyl_record_type text,
  vinyl_campaign text,
  height numeric,
  width numeric,
  base_payment numeric default 0,
  failed_visit_payment numeric default 8.56,
  desired_installation_week text,
  desired_installation_date date,
  next_visit_date date,
  street text,
  street_number text,
  city text,
  postal_code text,
  province text,
  installer_id uuid references workers(id) on delete set null,
  installer_name text,
  ceco text default '3159',
  client text default 'ISDIN',
  payment_week text,
  payment_total numeric default 0,
  payment_ready boolean default false,
  incident_opened_at timestamp with time zone,
  incident_resolved_at timestamp with time zone,
  status_changed_at timestamp with time zone,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now()
);

create index if not exists idx_isdin_vinyls_vinyl on isdin_vinyls(vinyl);
create index if not exists idx_isdin_vinyls_status on isdin_vinyls(status);
create index if not exists idx_isdin_vinyls_installer on isdin_vinyls(installer_id);
create index if not exists idx_isdin_vinyls_payment_week on isdin_vinyls(payment_week);
create index if not exists idx_isdin_vinyls_province on isdin_vinyls(province);
create index if not exists idx_isdin_vinyls_city on isdin_vinyls(city);

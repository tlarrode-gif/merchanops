-- MerchanOps V4.0
-- ISDIN · Llamadas Backoffice.
-- Crea una tabla preventiva de llamadas sin alterar pagos ni facturación de instaladores.

create extension if not exists "uuid-ossp";

create table if not exists isdin_calls (
  id uuid primary key default uuid_generate_v4(),
  vinyl_id uuid references isdin_vinyls(id) on delete set null,
  isdin_vinyl_id uuid references isdin_vinyls(id) on delete set null,
  vin text not null,
  pharmacy_name text not null,
  vinyl_campaign text,
  desired_installation_week text,
  desired_installation_date date,
  street text,
  street_number text,
  postal_code text,
  province text,
  city text,
  worker_name text,
  installer_name text,
  client_observations text,
  scaffold_required boolean default false,
  call_status text not null default 'Pendiente de llamar',
  call_datetime timestamp with time zone,
  call_time_slot text,
  contact_person text,
  phone_number text,
  call_comment text,
  backoffice_user text,
  next_visit_date date,
  next_visit_week text,
  requires_operations_review boolean default false,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now(),
  constraint isdin_calls_call_status_check check (call_status in (
    'Pendiente de llamar',
    'Llamada realizada',
    'No contesta',
    'Confirmado',
    'Incidencia en llamada',
    'Pospuesto en llamada',
    'Cancelado en llamada',
    'Requiere revisión operaciones'
  ))
);

create unique index if not exists idx_isdin_calls_vin_unique on isdin_calls(vin);
create index if not exists idx_isdin_calls_status on isdin_calls(call_status);
create index if not exists idx_isdin_calls_week on isdin_calls(desired_installation_week);
create index if not exists idx_isdin_calls_province on isdin_calls(province);
create index if not exists idx_isdin_calls_city on isdin_calls(city);
create index if not exists idx_isdin_calls_datetime on isdin_calls(call_datetime);
create index if not exists idx_isdin_calls_review on isdin_calls(requires_operations_review);
create index if not exists idx_isdin_calls_vinyl_id on isdin_calls(vinyl_id);

create or replace function set_isdin_calls_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_isdin_calls_updated_at on isdin_calls;
create trigger trg_isdin_calls_updated_at
before update on isdin_calls
for each row execute function set_isdin_calls_updated_at();

-- MerchanOps V3.8.1
-- Mejoras de ISDIN: regularizaciones, observaciones, andamio y revisitas.
-- No borra datos existentes.

alter table isdin_vinyls
add column if not exists client_observations text,
add column if not exists scaffold_required boolean default false,
add column if not exists revisit_count integer default 0;

create table if not exists isdin_billing_adjustments (
  id uuid primary key default uuid_generate_v4(),
  concept text not null,
  amount numeric not null default 0,
  billing_week text,
  billing_date date default current_date,
  created_at timestamp with time zone default now()
);

create index if not exists idx_isdin_vinyls_revisit_count on isdin_vinyls(revisit_count);
create index if not exists idx_isdin_vinyls_scaffold_required on isdin_vinyls(scaffold_required);
create index if not exists idx_isdin_billing_adjustments_billing_date on isdin_billing_adjustments(billing_date);

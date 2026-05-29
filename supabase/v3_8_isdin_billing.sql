-- MerchanOps V3.8
-- Facturación específica ISDIN.
-- No borra datos existentes.

create table if not exists isdin_billing_settings (
  id text primary key default 'global',
  standard_rate numeric default 0,
  custom_rate numeric default 0,
  updated_at timestamp with time zone default now()
);

insert into isdin_billing_settings (id, standard_rate, custom_rate)
values ('global', 0, 0)
on conflict (id) do nothing;

alter table isdin_vinyls
add column if not exists billing_extra_equipment numeric default 0,
add column if not exists billing_last_status_date date,
add column if not exists billing_type_override text;

create index if not exists idx_isdin_vinyls_billing_status_date on isdin_vinyls(billing_last_status_date);
create index if not exists idx_isdin_vinyls_billing_type_override on isdin_vinyls(billing_type_override);

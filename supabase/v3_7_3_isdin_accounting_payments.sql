-- MerchanOps V3.7.3
-- Campos para separar pagos contables ISDIN por semana.
-- No borra datos existentes.

alter table isdin_vinyls
add column if not exists incident_payment_week text,
add column if not exists incident_payment_date date,
add column if not exists installation_payment_week text,
add column if not exists installation_payment_date date;

create index if not exists idx_isdin_vinyls_incident_payment_week on isdin_vinyls(incident_payment_week);
create index if not exists idx_isdin_vinyls_installation_payment_week on isdin_vinyls(installation_payment_week);

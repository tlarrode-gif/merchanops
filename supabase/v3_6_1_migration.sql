-- MerchanOps V3.6.1 migration
-- Incidencias y pagos inteligentes.
-- No borra datos existentes: solo añade columnas nuevas si no existen.

alter table points add column if not exists original_fee numeric;
alter table points add column if not exists incident_fee numeric default 8.56;
alter table points add column if not exists incident_status text;
alter table points add column if not exists incident_comment text;
alter table points add column if not exists incident_opened_at timestamp with time zone;
alter table points add column if not exists incident_resolved_at timestamp with time zone;
alter table points add column if not exists incident_next_action text;
alter table points add column if not exists incident_due_date date;

create index if not exists idx_points_incident_status on points(incident_status);
create index if not exists idx_points_incident_opened_at on points(incident_opened_at);
create index if not exists idx_points_incident_due_date on points(incident_due_date);

-- MerchanOps V3 migration
-- Ejecutar en Supabase SQL Editor.
-- No borra datos existentes: solo añade columnas nuevas si no existen.

alter table points add column if not exists point_status text default 'Pendiente';
alter table points add column if not exists point_comment text;
alter table points add column if not exists reported_at timestamp with time zone;
alter table points add column if not exists reviewed_at timestamp with time zone;
alter table points add column if not exists finished_at timestamp with time zone;
alter table points add column if not exists post_incidence_pending_at timestamp with time zone;

alter table services add column if not exists payment_type text default 'Puntos';
alter table services add column if not exists hourly_rate numeric default 0;
alter table services add column if not exists hours_worked numeric default 0;

create index if not exists idx_points_point_status on points(point_status);
create index if not exists idx_services_worker_id on services(worker_id);
create index if not exists idx_services_client_id on services(client_id);
create index if not exists idx_services_payment_type on services(payment_type);

-- MerchanOps V2 migration
-- Ejecutar en Supabase SQL Editor.
-- No borra datos existentes: solo añade columnas nuevas si no existen.

alter table services add column if not exists validated_at timestamp with time zone;
alter table services add column if not exists incident_note text;
alter table services add column if not exists resolved_at timestamp with time zone;

alter table points add column if not exists report_code text;

-- Índices útiles para filtros de pagos y avisos.
create index if not exists idx_services_status on services(status);
create index if not exists idx_services_deadline on services(deadline);
create index if not exists idx_services_validated_at on services(validated_at);
create index if not exists idx_points_service_id on points(service_id);

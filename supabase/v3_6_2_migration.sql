-- MerchanOps V3.6.2 migration
-- Calendario visual.
-- No borra datos existentes: solo añade columnas nuevas si no existen.

alter table services add column if not exists calendar_color text default 'slate';

create index if not exists idx_services_calendar_color on services(calendar_color);

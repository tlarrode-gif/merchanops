-- Refuerzos operativos MerchanOps v6.1
-- 1) Campos espejo de llamadas Backoffice en Vinilos.
-- 2) Metadatos de creación en Grandes Campañas.
-- 3) Índices para filtros por provincia y pagos.

alter table isdin_vinyls add column if not exists call_status text;
alter table isdin_vinyls add column if not exists call_last_datetime timestamp with time zone;
alter table isdin_vinyls add column if not exists call_contact_person text;
alter table isdin_vinyls add column if not exists call_alert boolean default false;
alter table isdin_vinyls add column if not exists call_comment text;
alter table isdin_vinyls add column if not exists call_next_visit_date date;
alter table isdin_vinyls add column if not exists call_next_visit_week text;
alter table isdin_vinyls add column if not exists requires_operations_review boolean default false;

alter table big_campaigns add column if not exists created_by_user_id text;
alter table big_campaigns add column if not exists created_by_user_name text;

create index if not exists idx_isdin_vinyls_call_status on isdin_vinyls(call_status);
create index if not exists idx_isdin_vinyls_call_alert on isdin_vinyls(call_alert);
create index if not exists idx_isdin_vinyls_call_next_visit_date on isdin_vinyls(call_next_visit_date);
create index if not exists idx_big_campaigns_created_by_user_id on big_campaigns(created_by_user_id);
create index if not exists idx_big_campaigns_province on big_campaigns(province);

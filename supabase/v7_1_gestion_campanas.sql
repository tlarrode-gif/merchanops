-- MerchanOps V7.1
-- Gestión de campañas: estado "archivada" y trazabilidad de archivado/duplicado.
-- El archivado es la vía segura frente al borrado definitivo (solo admin).

alter table grandes_campanas drop constraint if exists grandes_campanas_estado_check;
alter table grandes_campanas add constraint grandes_campanas_estado_check
  check (estado in ('borrador','planificada','activa','pausada','completada','cancelada','archivada'));

alter table grandes_campanas add column if not exists archived_at timestamptz;
alter table grandes_campanas add column if not exists duplicada_de uuid references grandes_campanas(id) on delete set null;

create index if not exists idx_gc_archived_at on grandes_campanas(archived_at);

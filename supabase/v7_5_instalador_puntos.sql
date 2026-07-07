-- MerchanOps V7.5
-- Instalador por punto en Grandes Campañas: el gestor coordina la zona
-- (gestor_id/gestor_nombre) y el instalador es quien ejecuta el punto y cobra.
-- Corrige el hallazgo C6 de la auditoría: el beneficiario del pago pasa a ser
-- el instalador (con el gestor como respaldo si aún no hay instalador).

alter table puntos_venta_campana add column if not exists instalador_id text;
alter table puntos_venta_campana add column if not exists instalador_nombre text;

create index if not exists idx_pvc_instalador on puntos_venta_campana(instalador_id);

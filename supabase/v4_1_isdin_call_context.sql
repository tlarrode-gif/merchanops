-- Contexto adicional para llamadas preventivas de Backoffice.
-- Los estados de llamada son preventivos y no generan pagos ni visitas fallidas.

alter table isdin_vinyls
add column if not exists phone_number text;

alter table isdin_calls
add column if not exists height numeric,
add column if not exists width numeric;

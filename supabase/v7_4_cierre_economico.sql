-- MerchanOps V7.4
-- Sprint 1 de estabilización de pagos (auditoría 2026-07):
--  * Cierre de mes contable: un mes cerrado es inmutable; los eventos que lleguen
--    con fecha de un mes cerrado se contabilizan en el mes abierto en curso
--    (guardando el mes de origen en payload.mes_origen).
--  * Estado 'revision' en economic_events: pagos sin beneficiario claro quedan
--    retenidos (no exportables, fuera del neto) hasta que administración los
--    resuelva (corrigiendo el origen y resincronizando, o revirtiéndolos).

create table if not exists economic_month_closures (
  mes_contable text primary key, -- 'YYYY-MM'
  closed_at timestamptz not null default now(),
  closed_by_user_id text,
  closed_by_user_name text,
  notas text
);

alter table economic_month_closures disable row level security;

alter table economic_events drop constraint if exists economic_events_estado_check;
alter table economic_events add constraint economic_events_estado_check
  check (estado in ('activo','revertido','reverso','revision'));

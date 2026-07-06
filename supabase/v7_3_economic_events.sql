-- MerchanOps V7.3
-- Fase 3: flujo económico. Registro único de eventos económicos (pago a
-- trabajador, facturación a cliente y extras/regularizaciones) generados desde
-- los cambios de estado de Servicios, Grandes Campañas e ISDIN.
--
-- Principios:
--  * Idempotencia: cada evento lleva un fingerprint único derivado de su origen;
--    sincronizar dos veces no duplica eventos.
--  * Inmutabilidad + reversos: un evento no se edita ni se borra; se compensa
--    con un evento de reverso (importe opuesto) enlazado por reverso_de. El
--    reverso se contabiliza en el mes en que se emite, no en el original.
--  * Mes contable: se fija al crear el evento (YYYY-MM de la fecha del evento)
--    y no cambia aunque el dato de origen se modifique después.

create table if not exists economic_events (
  id uuid primary key default gen_random_uuid(),
  fingerprint text not null unique,
  tipo text not null check (tipo in ('pago_trabajador','facturacion_cliente','extra')),
  origen text not null check (origen in ('servicio','gran_campana','isdin','manual')),
  source_id text,
  source_line_id text,
  fecha_evento date not null,
  mes_contable text not null, -- 'YYYY-MM'
  worker_id text,
  worker_name text,
  client text,
  ceco text,
  campana text,
  provincia text,
  concepto text not null,
  importe numeric(12,2) not null default 0,
  estado text not null default 'activo' check (estado in ('activo','revertido','reverso')),
  reverso_de uuid references economic_events(id) on delete set null,
  motivo_reverso text,
  created_by_user_id text,
  created_by_user_name text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz default now()
);

create index if not exists idx_econ_events_mes on economic_events(mes_contable);
create index if not exists idx_econ_events_tipo on economic_events(tipo);
create index if not exists idx_econ_events_origen on economic_events(origen);
create index if not exists idx_econ_events_provincia on economic_events(provincia);
create index if not exists idx_econ_events_worker on economic_events(worker_id);
create index if not exists idx_econ_events_estado on economic_events(estado);
create index if not exists idx_econ_events_fecha on economic_events(fecha_evento);

alter table economic_events disable row level security;

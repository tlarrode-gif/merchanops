-- MerchanOps v6.2
-- Ledger idempotente para snapshots de pagos y auditoría operativa.
-- No sustituye el cálculo vivo de Pagos; conserva una foto trazable por fingerprint.

create table if not exists payment_ledger (
  id uuid primary key default uuid_generate_v4(),
  fingerprint text not null unique,
  origin text not null check (origin in ('servicio', 'gran_campana', 'isdin')),
  source_id text not null,
  source_line_id text,
  period text not null,
  payment_date date not null,
  worker_id text,
  worker_name text,
  client_id text,
  client text not null,
  ceco text,
  campaign text,
  province text,
  concept text not null,
  amount numeric not null default 0,
  status text not null default 'calculado' check (status in ('calculado', 'revisado', 'cerrado', 'anulado')),
  created_by_user_id text,
  created_by_user_name text,
  reviewed_by_user_id text,
  reviewed_by_user_name text,
  closed_at timestamp with time zone,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now()
);

create table if not exists payment_audit_log (
  id uuid primary key default uuid_generate_v4(),
  ledger_id uuid references payment_ledger(id) on delete set null,
  fingerprint text,
  action text not null,
  previous_value jsonb,
  new_value jsonb,
  reason text,
  actor_user_id text,
  actor_user_name text,
  created_at timestamp with time zone default now()
);

create index if not exists idx_payment_ledger_period on payment_ledger(period);
create index if not exists idx_payment_ledger_origin on payment_ledger(origin);
create index if not exists idx_payment_ledger_worker_id on payment_ledger(worker_id);
create index if not exists idx_payment_ledger_province on payment_ledger(province);
create index if not exists idx_payment_ledger_status on payment_ledger(status);
create index if not exists idx_payment_ledger_payment_date on payment_ledger(payment_date);
create index if not exists idx_payment_audit_log_fingerprint on payment_audit_log(fingerprint);

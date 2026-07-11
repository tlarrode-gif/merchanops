-- v8_1: Importaciones CSV transaccionales e idempotentes (fase 3).
--
-- Modelo: una importación se PREVISUALIZA en cliente (validación por fila,
-- sin tocar la base) y se CONFIRMA con un único RPC atómico que registra la
-- ejecución, sus filas y sincroniza las obligaciones con el ledger de la
-- fase 2. Si cualquier parte falla, la transacción entera se revierte: no
-- existen importaciones aplicadas a medias.
--
-- Idempotencia en dos niveles:
--  * archivo: UNIQUE (source, file_hash) — reimportar el mismo CSV devuelve
--    'duplicada' sin re-aplicar nada;
--  * fila: huella estable por identidad natural (no incluye importes ni
--    fechas), UNIQUE por ejecución.

create table if not exists import_runs (
  id uuid primary key default gen_random_uuid(),
  source text not null check (source in ('isdin_vinyls', 'servicios_puntos', 'gran_campana_puntos')),
  file_name text not null,
  file_hash text not null,
  actor text,
  status text not null default 'confirmada' check (status in ('confirmada', 'fallida', 'duplicada')),
  total_rows integer not null default 0,
  valid_rows integer not null default 0,
  rejected_rows integer not null default 0,
  errors jsonb not null default '[]'::jsonb,
  created_obligations integer not null default 0,
  updated_obligations integer not null default 0,
  divergences jsonb not null default '[]'::jsonb,
  correlation_id text,
  created_at timestamptz not null default now(),
  constraint import_runs_file_unique unique (source, file_hash)
);

create table if not exists import_run_rows (
  id uuid primary key default gen_random_uuid(),
  run_id uuid not null references import_runs(id) on delete cascade,
  row_index integer not null,
  row_fingerprint text not null,
  status text not null check (status in ('aplicada', 'rechazada')),
  errors jsonb not null default '[]'::jsonb,
  -- Payload minimizado: identidad + campos financieros; sin teléfonos ni
  -- comentarios (política de redacción de logs).
  payload jsonb not null default '{}'::jsonb,
  constraint import_run_rows_fingerprint_unique unique (run_id, row_fingerprint)
);

create index if not exists import_run_rows_run_idx on import_run_rows (run_id);

-- Las ejecuciones de importación son registro financiero: inmutables.
create or replace function import_runs_immutable() returns trigger as $$
begin
  raise exception 'El registro de importaciones es inmutable (%).', tg_op;
end $$ language plpgsql;

drop trigger if exists import_runs_guard on import_runs;
create trigger import_runs_guard
  before update or delete on import_runs
  for each row execute function import_runs_immutable();

drop trigger if exists import_run_rows_guard on import_run_rows;
create trigger import_run_rows_guard
  before update or delete on import_run_rows
  for each row execute function import_runs_immutable();

-- ---------------------------------------------------------------------------
-- RPC: confirmar una importación (atómico)
-- ---------------------------------------------------------------------------

create or replace function confirm_import_run(
  p_source text,
  p_file_name text,
  p_file_hash text,
  p_rows jsonb,          -- [{rowIndex, fingerprint, status: aplicada|rechazada, errors, payload}]
  p_obligations jsonb,   -- payload para sync_payment_obligations
  p_actor text default null,
  p_correlation_id text default null
) returns jsonb as $$
declare
  run_id uuid;
  row_item jsonb;
  sync_result jsonb;
  v_total int := coalesce(jsonb_array_length(p_rows), 0);
  v_valid int := 0;
  v_rejected int := 0;
begin
  -- Idempotencia de archivo: mismo hash + origen => duplicada, sin re-aplicar.
  if exists (select 1 from import_runs where source = p_source and file_hash = p_file_hash) then
    return jsonb_build_object(
      'status', 'duplicada',
      'runId', (select id from import_runs where source = p_source and file_hash = p_file_hash),
      'message', 'Este archivo ya fue importado para este origen; no se aplica de nuevo.'
    );
  end if;

  select count(*) filter (where value->>'status' = 'aplicada'),
         count(*) filter (where value->>'status' = 'rechazada')
    into v_valid, v_rejected
    from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb));

  -- Sincronización con el ledger PRIMERO (misma transacción: o todo, o nada;
  -- si algo falla más abajo, el sync también se revierte).
  sync_result := sync_payment_obligations(coalesce(p_obligations, '[]'::jsonb), p_actor, coalesce(p_correlation_id, 'import:' || p_file_hash));

  insert into import_runs (
    source, file_name, file_hash, actor, status, total_rows, valid_rows, rejected_rows,
    created_obligations, updated_obligations, divergences, correlation_id
  )
  values (
    p_source, p_file_name, p_file_hash, p_actor, 'confirmada', v_total, v_valid, v_rejected,
    coalesce((sync_result->>'inserted')::int, 0),
    coalesce((sync_result->>'updated')::int, 0),
    coalesce(sync_result->'divergences', '[]'::jsonb),
    p_correlation_id
  )
  returning id into run_id;

  for row_item in select * from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) loop
    insert into import_run_rows (run_id, row_index, row_fingerprint, status, errors, payload)
    values (
      run_id,
      (row_item->>'rowIndex')::int,
      row_item->>'fingerprint',
      row_item->>'status',
      coalesce(row_item->'errors', '[]'::jsonb),
      coalesce(row_item->'payload', '{}'::jsonb)
    );
  end loop;

  return jsonb_build_object(
    'status', 'confirmada',
    'runId', run_id,
    'totalRows', v_total,
    'validRows', v_valid,
    'rejectedRows', v_rejected,
    'sync', sync_result
  );
end $$ language plpgsql;

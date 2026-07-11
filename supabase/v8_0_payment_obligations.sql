-- v8_0: Ledger persistente de obligaciones de pago (fase 2 de la remediación).
--
-- Modelo: cada obligación tiene una identidad estable e inmutable
-- (obligation_key, ej. 'isdin:VIN-123:failed_visit:2') que NUNCA contiene
-- importe, fecha ni estado. Los importes van en céntimos enteros de EUR.
-- Ciclo de vida: calculado -> revisado -> cerrado -> anulado (transiciones
-- vigiladas por trigger; una línea cerrada JAMÁS vuelve a calculado y las
-- líneas financieras no se borran físicamente: se anulan).

create table if not exists payment_obligations (
  id uuid primary key default gen_random_uuid(),
  obligation_key text not null unique,
  origin text not null check (origin in ('servicio', 'gran_campana', 'isdin')),
  source_id text not null,
  type text not null check (type in ('installation', 'failed_visit', 'points', 'hours', 'adjustment', 'reversal')),
  kind text not null default 'pago' check (kind in ('pago', 'ajuste', 'anulacion')),
  -- Importes en céntimos enteros de EUR. Los pagos ordinarios no pueden ser
  -- negativos; los ajustes/anulaciones sí (diferenciados por kind).
  amount_cents bigint not null,
  constraint payment_obligations_amount_valid
    check (kind <> 'pago' or amount_cents >= 0),
  currency text not null default 'EUR' check (currency = 'EUR'),
  -- Fecha real del evento. NULL = falta la fecha: la obligación queda
  -- bloqueada (payable=false); jamás se sustituye por la fecha actual.
  event_date date,
  period text generated always as (
    case when event_date is null then null
         else lpad(extract(year from event_date)::text, 4, '0') || '-' || lpad(extract(month from event_date)::text, 2, '0')
    end
  ) stored,
  worker_id text,
  worker_name text,
  concept text not null default '',
  status text not null default 'calculado' check (status in ('calculado', 'revisado', 'cerrado', 'anulado')),
  payable boolean not null default false,
  blocked_reasons jsonb not null default '[]'::jsonb,
  payload jsonb not null default '{}'::jsonb,
  -- Ajustes/anulaciones enlazan SIEMPRE con la obligación original.
  adjusts_obligation_id uuid references payment_obligations(id),
  constraint payment_obligations_adjust_link
    check (kind = 'pago' or adjusts_obligation_id is not null),
  version integer not null default 1,
  change_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by text,
  updated_by text,
  reviewed_at timestamptz,
  closed_at timestamptz,
  voided_at timestamptz,
  void_reason text
);

create index if not exists payment_obligations_source_idx on payment_obligations (origin, source_id);
create index if not exists payment_obligations_period_idx on payment_obligations (period);
create index if not exists payment_obligations_status_idx on payment_obligations (status);

-- ---------------------------------------------------------------------------
-- Auditoría inmutable
-- ---------------------------------------------------------------------------

create table if not exists payment_obligations_audit (
  id uuid primary key default gen_random_uuid(),
  obligation_id uuid not null,
  obligation_key text not null,
  actor text,
  action text not null,
  old_value jsonb,
  new_value jsonb,
  reason text,
  correlation_id text,
  event_id text,
  created_at timestamptz not null default now()
);

create index if not exists payment_obligations_audit_key_idx on payment_obligations_audit (obligation_key);

create or replace function payment_obligations_audit_immutable() returns trigger as $$
begin
  raise exception 'La auditoría financiera es inmutable (%).', tg_op;
end $$ language plpgsql;

drop trigger if exists payment_obligations_audit_guard on payment_obligations_audit;
create trigger payment_obligations_audit_guard
  before update or delete on payment_obligations_audit
  for each row execute function payment_obligations_audit_immutable();

-- ---------------------------------------------------------------------------
-- Guarda de integridad del ledger
-- ---------------------------------------------------------------------------

create or replace function payment_obligations_guard() returns trigger as $$
declare
  allowed text[];
begin
  if tg_op = 'DELETE' then
    raise exception 'Las líneas financieras no se borran físicamente; usa una anulación (status=anulado). Clave: %', old.obligation_key;
  end if;

  if tg_op = 'UPDATE' then
    if old.obligation_key is distinct from new.obligation_key then
      raise exception 'La clave de una obligación es inmutable (%).', old.obligation_key;
    end if;

    if new.status is distinct from old.status then
      allowed := case old.status
        when 'calculado' then array['revisado', 'anulado']
        when 'revisado' then array['cerrado', 'calculado', 'anulado']
        when 'cerrado' then array['anulado']
        else array[]::text[]
      end;
      if not (new.status = any(allowed)) then
        raise exception 'Transición no permitida: % -> % (clave %).', old.status, new.status, old.obligation_key;
      end if;
      if new.status = 'anulado' and coalesce(new.void_reason, '') = '' then
        raise exception 'Anular la obligación % requiere void_reason.', old.obligation_key;
      end if;
      if new.status = 'revisado' then new.reviewed_at := now(); end if;
      if new.status = 'cerrado' then new.closed_at := now(); end if;
      if new.status = 'anulado' then new.voided_at := now(); end if;
    end if;

    if old.status = 'anulado' then
      raise exception 'Una obligación anulada no admite cambios (%).', old.obligation_key;
    end if;

    -- Cerrado es inmutable salvo su anulación.
    if old.status = 'cerrado' and not (new.status = 'anulado') then
      raise exception 'La obligación % está cerrada: solo admite anulación.', old.obligation_key;
    end if;
    if old.status = 'cerrado' and new.status = 'anulado' then
      if row(new.amount_cents, new.event_date, new.worker_id, new.kind)
         is distinct from row(old.amount_cents, old.event_date, old.worker_id, old.kind) then
        raise exception 'Anular no puede modificar los datos de la obligación cerrada %.', old.obligation_key;
      end if;
    end if;

    new.version := old.version + 1;
    new.updated_at := now();
  end if;

  return new;
end $$ language plpgsql;

drop trigger if exists payment_obligations_guard_trg on payment_obligations;
create trigger payment_obligations_guard_trg
  before update or delete on payment_obligations
  for each row execute function payment_obligations_guard();

create or replace function payment_obligations_audit_write() returns trigger as $$
begin
  insert into payment_obligations_audit (obligation_id, obligation_key, actor, action, old_value, new_value, reason)
  values (
    coalesce(new.id, old.id),
    coalesce(new.obligation_key, old.obligation_key),
    coalesce(new.updated_by, new.created_by),
    case when tg_op = 'INSERT' then 'obligation.created' else 'obligation.updated' end,
    case when tg_op = 'UPDATE' then jsonb_build_object('status', old.status, 'amount_cents', old.amount_cents, 'event_date', old.event_date, 'payable', old.payable, 'version', old.version) end,
    jsonb_build_object('status', new.status, 'amount_cents', new.amount_cents, 'event_date', new.event_date, 'payable', new.payable, 'version', new.version),
    new.change_reason
  );
  return new;
end $$ language plpgsql;

drop trigger if exists payment_obligations_audit_trg on payment_obligations;
create trigger payment_obligations_audit_trg
  after insert or update on payment_obligations
  for each row execute function payment_obligations_audit_write();

-- ---------------------------------------------------------------------------
-- RPC: sincronizar obligaciones calculadas por el motor (idempotente)
-- ---------------------------------------------------------------------------
-- Reglas:
--  * clave nueva -> insert (estado calculado).
--  * clave existente en 'calculado' -> se actualizan importe/fecha/bloqueos
--    (recálculo permitido mientras no esté revisada/cerrada).
--  * clave existente en revisado/cerrado/anulado -> NO se toca; si el importe
--    difiere se devuelve una divergencia de conciliación. NUNCA reabre.
--  * las claves que el motor ya no produce NO se borran: se devuelven como
--    divergencia 'missing_in_recalc' para anulación explícita.

create or replace function sync_payment_obligations(
  p_obligations jsonb,
  p_actor text default null,
  p_correlation_id text default null
) returns jsonb as $$
declare
  item jsonb;
  existing payment_obligations%rowtype;
  inserted_count int := 0;
  updated_count int := 0;
  unchanged_count int := 0;
  divergences jsonb := '[]'::jsonb;
  v_amount bigint;
begin
  if p_obligations is null or jsonb_typeof(p_obligations) <> 'array' then
    raise exception 'p_obligations debe ser un array jsonb';
  end if;

  for item in select * from jsonb_array_elements(p_obligations) loop
    v_amount := (item->>'amountCents')::bigint;
    if v_amount is null then
      raise exception 'Obligación sin amountCents: %', item->>'key';
    end if;

    select * into existing from payment_obligations where obligation_key = item->>'key' for update;

    if not found then
      insert into payment_obligations (
        obligation_key, origin, source_id, type, kind, amount_cents, event_date,
        worker_id, worker_name, concept, payable, blocked_reasons, payload,
        created_by, updated_by, change_reason
      ) values (
        item->>'key', item->>'origin', item->>'sourceId', item->>'type',
        coalesce(item->>'kind', 'pago'), v_amount,
        nullif(item->>'eventDate', '')::date,
        item->>'workerId', item->>'workerName', coalesce(item->>'concept', ''),
        coalesce((item->>'payable')::boolean, false),
        coalesce(item->'blockedReasons', '[]'::jsonb),
        coalesce(item->'payload', '{}'::jsonb),
        p_actor, p_actor, coalesce('recalculo ' || p_correlation_id, 'recalculo')
      );
      inserted_count := inserted_count + 1;
    elsif existing.status = 'calculado' then
      if existing.amount_cents = v_amount
         and existing.event_date is not distinct from nullif(item->>'eventDate', '')::date
         and existing.payable = coalesce((item->>'payable')::boolean, false) then
        unchanged_count := unchanged_count + 1;
      else
        update payment_obligations set
          amount_cents = v_amount,
          event_date = nullif(item->>'eventDate', '')::date,
          worker_id = item->>'workerId',
          worker_name = item->>'workerName',
          concept = coalesce(item->>'concept', concept),
          payable = coalesce((item->>'payable')::boolean, false),
          blocked_reasons = coalesce(item->'blockedReasons', '[]'::jsonb),
          updated_by = p_actor,
          change_reason = coalesce('recalculo ' || p_correlation_id, 'recalculo')
        where obligation_key = item->>'key';
        updated_count := updated_count + 1;
      end if;
    else
      -- revisado/cerrado/anulado: intocable. Divergencia si el importe difiere.
      if existing.amount_cents <> v_amount and existing.status <> 'anulado' then
        divergences := divergences || jsonb_build_object(
          'key', existing.obligation_key,
          'reason', 'amount_differs_on_' || existing.status,
          'ledgerAmountCents', existing.amount_cents,
          'engineAmountCents', v_amount
        );
      end if;
      unchanged_count := unchanged_count + 1;
    end if;
  end loop;

  return jsonb_build_object(
    'inserted', inserted_count,
    'updated', updated_count,
    'unchanged', unchanged_count,
    'divergences', divergences
  );
end $$ language plpgsql;

-- ---------------------------------------------------------------------------
-- RPC: cambio de estado con control optimista de versión
-- ---------------------------------------------------------------------------

create or replace function change_payment_obligation_status(
  p_key text,
  p_to text,
  p_actor text,
  p_reason text default null,
  p_expected_version integer default null
) returns payment_obligations as $$
declare
  result payment_obligations%rowtype;
begin
  update payment_obligations set
    status = p_to,
    updated_by = p_actor,
    change_reason = p_reason,
    void_reason = case when p_to = 'anulado' then coalesce(p_reason, void_reason) else void_reason end
  where obligation_key = p_key
    and (p_expected_version is null or version = p_expected_version)
  returning * into result;

  if not found then
    if exists (select 1 from payment_obligations where obligation_key = p_key) then
      raise exception 'Conflicto de concurrencia: la obligación % cambió desde tu lectura (version esperada %).', p_key, p_expected_version;
    end if;
    raise exception 'Obligación % no encontrada.', p_key;
  end if;
  return result;
end $$ language plpgsql;

-- ---------------------------------------------------------------------------
-- RPC: ajuste/anulación enlazado a la obligación original
-- ---------------------------------------------------------------------------

create or replace function create_payment_adjustment(
  p_original_key text,
  p_amount_cents bigint,
  p_actor text,
  p_reason text,
  p_kind text default 'ajuste'
) returns payment_obligations as $$
declare
  original payment_obligations%rowtype;
  adjustment payment_obligations%rowtype;
  seq int;
begin
  if coalesce(p_reason, '') = '' then
    raise exception 'Un ajuste requiere motivo.';
  end if;
  if p_kind not in ('ajuste', 'anulacion') then
    raise exception 'kind debe ser ajuste o anulacion';
  end if;

  select * into original from payment_obligations where obligation_key = p_original_key for update;
  if not found then
    raise exception 'Obligación original % no encontrada.', p_original_key;
  end if;

  select count(*) + 1 into seq from payment_obligations
    where adjusts_obligation_id = original.id;

  insert into payment_obligations (
    obligation_key, origin, source_id, type, kind, amount_cents, event_date,
    worker_id, worker_name, concept, payable, adjusts_obligation_id,
    created_by, updated_by, change_reason
  ) values (
    p_original_key || ':' || p_kind || ':' || seq,
    original.origin, original.source_id,
    case when p_kind = 'anulacion' then 'reversal' else 'adjustment' end,
    p_kind, p_amount_cents, current_date,
    original.worker_id, original.worker_name,
    p_kind || ' de ' || p_original_key || ': ' || p_reason,
    true, original.id, p_actor, p_actor, p_reason
  ) returning * into adjustment;

  return adjustment;
end $$ language plpgsql;

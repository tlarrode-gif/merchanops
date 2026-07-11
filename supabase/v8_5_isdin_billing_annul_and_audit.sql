-- v8_5 (A7): regularizaciones ISDIN sin borrado físico + auditoría de facturación.
-- APLICADA al proyecto dptmswhwmqimijpfyndn el 2026-07-11.
-- 1) Anulación en vez de DELETE; 2) campos económicos inmutables tras crear;
-- 3) auditoría inmutable de tarifas, regularizaciones y edición de facturación de vinilos.

alter table isdin_billing_adjustments
  add column if not exists created_by text,
  add column if not exists annulled_at timestamptz,
  add column if not exists annulled_by text,
  add column if not exists annul_reason text;

alter table isdin_billing_settings
  add column if not exists updated_by text;

create table if not exists isdin_billing_audit (
  id uuid primary key default gen_random_uuid(),
  entity text not null check (entity in ('settings','adjustment','vinyl_billing')),
  entity_id text not null,
  action text not null,
  actor text,
  old_data jsonb,
  new_data jsonb,
  created_at timestamptz not null default now()
);
create index if not exists idx_isdin_billing_audit_entity on isdin_billing_audit(entity, entity_id);

-- La auditoría es inmutable: ni UPDATE ni DELETE.
create or replace function isdin_billing_audit_block_mutation() returns trigger language plpgsql as $$
begin
  raise exception 'isdin_billing_audit es inmutable (operación % bloqueada)', tg_op;
end $$;
drop trigger if exists trg_isdin_billing_audit_immutable on isdin_billing_audit;
create trigger trg_isdin_billing_audit_immutable
  before update or delete on isdin_billing_audit
  for each row execute function isdin_billing_audit_block_mutation();

-- Regularizaciones: prohibido DELETE; UPDATE solo puede anular (una vez, con motivo).
create or replace function isdin_billing_adjustments_guard() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Prohibido borrar regularizaciones ISDIN: usa la anulación (annulled_at + motivo)';
  end if;
  if new.concept is distinct from old.concept
     or new.amount is distinct from old.amount
     or new.billing_week is distinct from old.billing_week
     or new.billing_date is distinct from old.billing_date
     or new.created_at is distinct from old.created_at
     or new.created_by is distinct from old.created_by then
    raise exception 'Una regularización ISDIN es inmutable: para corregirla, anúlala y crea otra';
  end if;
  if old.annulled_at is not null
     and (new.annulled_at is distinct from old.annulled_at
       or new.annulled_by is distinct from old.annulled_by
       or new.annul_reason is distinct from old.annul_reason) then
    raise exception 'La anulación de una regularización no puede modificarse ni revertirse';
  end if;
  if old.annulled_at is null and new.annulled_at is not null
     and coalesce(btrim(new.annul_reason), '') = '' then
    raise exception 'Anular una regularización requiere motivo (annul_reason)';
  end if;
  return new;
end $$;
drop trigger if exists trg_isdin_billing_adjustments_guard on isdin_billing_adjustments;
create trigger trg_isdin_billing_adjustments_guard
  before update or delete on isdin_billing_adjustments
  for each row execute function isdin_billing_adjustments_guard();

-- Auditoría automática de regularizaciones (crear / anular).
create or replace function isdin_billing_adjustments_audit() returns trigger language plpgsql as $$
begin
  insert into isdin_billing_audit(entity, entity_id, action, actor, old_data, new_data)
  values (
    'adjustment',
    new.id::text,
    case
      when tg_op = 'INSERT' then 'crear'
      when new.annulled_at is not null and old.annulled_at is null then 'anular'
      else 'actualizar'
    end,
    case when tg_op = 'INSERT' then new.created_by else coalesce(new.annulled_by, new.created_by) end,
    case when tg_op = 'UPDATE' then to_jsonb(old) end,
    to_jsonb(new)
  );
  return new;
end $$;
drop trigger if exists trg_isdin_billing_adjustments_audit on isdin_billing_adjustments;
create trigger trg_isdin_billing_adjustments_audit
  after insert or update on isdin_billing_adjustments
  for each row execute function isdin_billing_adjustments_audit();

-- Auditoría automática de tarifas de facturación.
create or replace function isdin_billing_settings_audit() returns trigger language plpgsql as $$
begin
  insert into isdin_billing_audit(entity, entity_id, action, actor, old_data, new_data)
  values ('settings', new.id,
          case when tg_op = 'INSERT' then 'crear' else 'actualizar' end,
          new.updated_by,
          case when tg_op = 'UPDATE' then to_jsonb(old) end,
          to_jsonb(new));
  return new;
end $$;
drop trigger if exists trg_isdin_billing_settings_audit on isdin_billing_settings;
create trigger trg_isdin_billing_settings_audit
  after insert or update on isdin_billing_settings
  for each row execute function isdin_billing_settings_audit();

-- Auditoría de la edición de facturación de vinilos: solo cuando cambian las
-- columnas de facturación; guarda únicamente el diff de esas columnas.
create or replace function isdin_vinyls_billing_audit() returns trigger language plpgsql as $$
declare
  old_diff jsonb := '{}'::jsonb;
  new_diff jsonb := '{}'::jsonb;
begin
  if new.billing_type_override is distinct from old.billing_type_override then
    old_diff := old_diff || jsonb_build_object('billing_type_override', old.billing_type_override);
    new_diff := new_diff || jsonb_build_object('billing_type_override', new.billing_type_override);
  end if;
  if new.billing_extra_equipment is distinct from old.billing_extra_equipment then
    old_diff := old_diff || jsonb_build_object('billing_extra_equipment', old.billing_extra_equipment);
    new_diff := new_diff || jsonb_build_object('billing_extra_equipment', new.billing_extra_equipment);
  end if;
  if new.billing_last_status_date is distinct from old.billing_last_status_date then
    old_diff := old_diff || jsonb_build_object('billing_last_status_date', old.billing_last_status_date);
    new_diff := new_diff || jsonb_build_object('billing_last_status_date', new.billing_last_status_date);
  end if;
  if new.scaffold_required is distinct from old.scaffold_required then
    old_diff := old_diff || jsonb_build_object('scaffold_required', old.scaffold_required);
    new_diff := new_diff || jsonb_build_object('scaffold_required', new.scaffold_required);
  end if;
  if new.revisit_count is distinct from old.revisit_count then
    old_diff := old_diff || jsonb_build_object('revisit_count', old.revisit_count);
    new_diff := new_diff || jsonb_build_object('revisit_count', new.revisit_count);
  end if;
  if new.client_observations is distinct from old.client_observations then
    old_diff := old_diff || jsonb_build_object('client_observations', old.client_observations);
    new_diff := new_diff || jsonb_build_object('client_observations', new.client_observations);
  end if;
  if new_diff <> '{}'::jsonb then
    insert into isdin_billing_audit(entity, entity_id, action, actor, old_data, new_data)
    values ('vinyl_billing', new.id::text, 'editar_facturacion', null, old_diff, new_diff);
  end if;
  return new;
end $$;
drop trigger if exists trg_isdin_vinyls_billing_audit on isdin_vinyls;
create trigger trg_isdin_vinyls_billing_audit
  after update on isdin_vinyls
  for each row execute function isdin_vinyls_billing_audit();

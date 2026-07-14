-- v9_7: direcciones de envio del trabajador + anadido opcional en gran campana
-- Feature 2:
--   * worker_addresses: lista reutilizable de direcciones de envio por trabajador.
--   * grandes_campanas.solicitar_direccion_envio: toggle opcional de la campana
--     para pedir a los gestores la direccion de envio de cada trabajador.
--   * puntos_venta_campana.direccion_envio(_id): direccion de envio elegida para
--     el punto (snapshot + referencia a la direccion del trabajador).
--   * create_logistics_request_campaign: el volcado a Logistica ahora prefiere la
--     direccion de envio del trabajador sobre la direccion del punto (farmacia).
-- Idempotente: seguro de re-ejecutar.

-- 1) Direcciones de envio reutilizables por trabajador -----------------------
create table if not exists worker_addresses (
  id uuid primary key default uuid_generate_v4(),
  worker_id uuid not null references workers(id) on delete cascade,
  etiqueta text,
  direccion text not null,
  poblacion text,
  provincia text,
  codigo_postal text,
  predeterminada boolean default false,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now()
);
create index if not exists idx_worker_addresses_worker on worker_addresses(worker_id);

-- RLS: coherente con v9_2 (acceso a usuarios internos autenticados). La
-- visibilidad por provincia del trabajador ya se aplica en la capa de app.
alter table worker_addresses enable row level security;
drop policy if exists authenticated_all on worker_addresses;
create policy authenticated_all on worker_addresses for all to authenticated using (true) with check (true);
grant select, insert, update, delete on worker_addresses to authenticated;
revoke all on worker_addresses from anon;

-- 2) Toggle opcional en la campana -------------------------------------------
alter table grandes_campanas add column if not exists solicitar_direccion_envio boolean default false;

-- 3) Direccion de envio elegida a nivel de punto -----------------------------
alter table puntos_venta_campana add column if not exists direccion_envio text;
alter table puntos_venta_campana add column if not exists direccion_envio_id uuid references worker_addresses(id) on delete set null;

-- 4) Volcado a Logistica: preferir la direccion de envio del trabajador -------
-- Reproduce create_logistics_request_campaign (v8_7) cambiando unicamente la
-- linea de delivery_address para dar prioridad a direccion_envio.
create or replace function create_logistics_request_campaign(p_campana jsonb, p_puntos jsonb, p_material jsonb, p_actor text default 'Operaciones')
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_req uuid;
  v_request uuid;
  punto jsonb;
begin
  if jsonb_array_length(coalesce(p_puntos, '[]'::jsonb)) = 0 then
    raise exception 'No hay puntos de venta para solicitar material.';
  end if;

  select r.request_id into v_request
    from public.logistics_material_requirements r
    join public.logistics_requests q on q.id = r.request_id
   where r.source_type = 'campaign' and r.request_id is not null
     and q.status not in ('rechazada', 'cancelada', 'cerrada')
     and r.source_id in (select value->>'id' from jsonb_array_elements(p_puntos))
   limit 1;

  for punto in select * from jsonb_array_elements(p_puntos)
  loop
    v_req := public.merchan_upsert_requirement(jsonb_build_object(
      'source_type', 'campaign',
      'source_id', punto->>'id',
      'client_id', p_campana->>'cliente_marca',
      'campaign_id', p_campana->>'id',
      'pharmacy_name', punto->>'nombre_comercial',
      'requested_material_name', p_material->>'name',
      'material_type', 'consumible',
      'quantity', coalesce(p_material->>'quantity', '1'),
      'required_date', punto->>'fecha_visita',
      'province', punto->>'provincia',
      'delivery_address', coalesce(nullif(punto->>'direccion_envio', ''), punto->>'direccion'),
      'installer_id', punto->>'instalador_id',
      'installer_name', punto->>'instalador_nombre',
      'operations_notes', p_material->>'notes',
      'actor', p_actor
    ));
    v_request := public.merchan_attach_request(v_req, v_request, p_actor);
  end loop;

  insert into public.logistics_audit_log (actor, module, entity_type, entity_id, action, new_value)
  values (p_actor, 'gran_campanas', 'request', v_request::text, 'campaign.material_requested',
          jsonb_build_object('campana', p_campana->>'id', 'puntos', jsonb_array_length(p_puntos),
                             'material', p_material->>'name', 'cantidad', p_material->>'quantity'));

  return (select jsonb_build_object('request_id', id, 'code', code, 'status', status)
          from public.logistics_requests where id = v_request);
end $$;

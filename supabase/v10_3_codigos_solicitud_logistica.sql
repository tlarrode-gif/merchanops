-- v10.3 · Códigos de solicitud logística: formato trazable y a prueba de borrados
--
-- PROBLEMA 1 · POCO TRAZABLES
-- `LOG-2026-0013` no dice nada: todas las solicitudes empiezan por LOG, vengan de una
-- gran campaña, de un punto de servicio o de un vinilo ISDIN, y del año solo se sabe
-- que es 2026. Almacén no puede situar una solicitud sin abrirla.
--
-- PROBLEMA 2 · SE REUTILIZAN
-- `merchan_next_request_code()` calculaba max(code)+1 SOBRE LAS FILAS SUPERVIVIENTES de
-- logistics_requests. La tabla se vació (borrados manuales por REST y un truncate), así
-- que el siguiente código volvía a ser LOG-2026-0001 y, unas cuantas solicitudes después,
-- chocaba con el índice UNIQUE (code) y el alta fallaba. Además los códigos 0005–0013
-- siguen publicados en outbox_events, o sea que MerchanLOGS ya los conoce.
--
-- FORMATO NUEVO: {ORIGEN}-{AAMMDD}-{NNN}
--   GC-260730-001   gran campaña, 30 de julio de 2026, primera del día
--   SRV-260730-002  punto de servicio
--   ISD-260730-003  vinilo ISDIN
--   LOG-260730-004  origen desconocido (respaldo)
-- Se lee de un golpe (de dónde viene, de qué día y cuál del día), es corto para decirlo
-- por teléfono, ordena cronológicamente y NUNCA puede coincidir con un LOG-AAAA-NNNN
-- antiguo, así que el histórico sigue siendo legible.
--
-- El contador vive en su propia tabla, no se deduce de logistics_requests: borrar
-- solicitudes ya no puede reutilizar un código. La fecha se calcula en hora de Madrid,
-- para que una solicitud de las 00:30 no aparezca con la fecha del día anterior.

-- ---------------------------------------------------------------------------
-- Contador por origen y día
-- ---------------------------------------------------------------------------
create table if not exists public.logistics_request_code_counters (
  scope text primary key,
  last_number integer not null default 0,
  updated_at timestamptz not null default now()
);

comment on table public.logistics_request_code_counters is
  'Contador de códigos de solicitud por origen y día (scope = GC-260730). Vive aparte de logistics_requests para que borrar solicitudes no reutilice códigos.';

alter table public.logistics_request_code_counters enable row level security;
-- Sin políticas a propósito: solo lo toca merchan_next_request_code (SECURITY DEFINER).
revoke all on table public.logistics_request_code_counters from anon, authenticated;

-- Arranque idempotente: si ya existen códigos del formato nuevo, el contador continúa
-- donde estén en lugar de volver a 1. Hoy no hay ninguno, pero deja la migración segura
-- de re-ejecutar.
insert into public.logistics_request_code_counters as c (scope, last_number)
select (regexp_match(code, '^([A-Z]+-[0-9]{6})-([0-9]+)$'))[1] as scope,
       max(((regexp_match(code, '^([A-Z]+-[0-9]{6})-([0-9]+)$'))[2])::int) as last_number
  from public.logistics_requests
 where code ~ '^[A-Z]+-[0-9]{6}-[0-9]+$'
 group by 1
on conflict (scope) do update
  set last_number = greatest(excluded.last_number, c.last_number),
      updated_at = now();

-- ---------------------------------------------------------------------------
-- Generador
-- ---------------------------------------------------------------------------
create or replace function public.merchan_next_request_code(p_source_type text)
returns text
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_prefijo text;
  v_scope text;
  v_n integer;
begin
  v_prefijo := case coalesce(p_source_type, '')
    when 'campaign' then 'GC'
    when 'service' then 'SRV'
    when 'service_point' then 'SRV'
    when 'isdin_vinyl' then 'ISD'
    else 'LOG' end;
  v_scope := v_prefijo || '-' || to_char(now() at time zone 'Europe/Madrid', 'YYMMDD');

  -- El upsert reserva el número de forma atómica: dos solicitudes simultáneas del mismo
  -- origen y día no pueden llevarse el mismo código.
  insert into public.logistics_request_code_counters as c (scope, last_number)
  values (v_scope, 1)
  on conflict (scope) do update set last_number = c.last_number + 1, updated_at = now()
  returning c.last_number into v_n;

  -- lpad a 3 no trunca: pasado el 999 del día el código crece a 4 dígitos.
  return v_scope || '-' || lpad(v_n::text, 3, '0');
end $function$;

comment on function public.merchan_next_request_code(text) is
  'Código de solicitud logística con formato {ORIGEN}-{AAMMDD}-{NNN}. El contador es una tabla propia, así que borrar solicitudes no reutiliza códigos.';

-- Compatibilidad: la firma sin argumentos sigue existiendo para cualquier llamada antigua.
create or replace function public.merchan_next_request_code()
returns text
language sql
security definer
set search_path to ''
as $function$
  select public.merchan_next_request_code(null::text);
$function$;

revoke all on function public.merchan_next_request_code(text) from public, anon, authenticated;
revoke all on function public.merchan_next_request_code() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- La cabecera se crea con el código de su origen
-- ---------------------------------------------------------------------------
-- Igual que la versión de v10.2 (que impide heredar el instalador de otro punto), con el
-- único cambio de pasar req.source_type al generador de códigos.
create or replace function public.merchan_attach_request(p_requirement uuid, p_request uuid, p_requested_by text)
returns uuid
language plpgsql
set search_path to ''
as $function$
declare
  req public.logistics_material_requirements%rowtype;
  cab public.logistics_requests%rowtype;
  v_request uuid;
  v_mismo_destino boolean;
begin
  select * into req from public.logistics_material_requirements where id = p_requirement for update;
  if not found then raise exception 'Necesidad % no encontrada', p_requirement; end if;

  v_request := coalesce(p_request, req.request_id);
  if v_request is null then
    select id into v_request from public.logistics_requests
     where source_type = req.source_type and source_id = req.source_id
     limit 1;
  end if;

  if v_request is null then
    insert into public.logistics_requests (
      code, source_type, source_id, client_id, campaign_id, service_id,
      requested_by, requested_at, required_date, installation_date, priority,
      destination_type, installer_id, installer_name, delivery_address,
      province, city, status, source_system
    ) values (
      public.merchan_next_request_code(req.source_type), req.source_type, req.source_id,
      req.client_id, req.campaign_id, req.service_id,
      coalesce(p_requested_by, 'Operaciones'), now(), req.required_date,
      req.installation_date, req.priority,
      case when req.installer_id is not null or req.installer_name is not null then 'instalador' else 'farmacia' end,
      req.installer_id, req.installer_name, req.delivery_address,
      req.province, req.city, 'pendiente_revision', 'merchanops'
    ) returning id into v_request;
  else
    select * into cab from public.logistics_requests where id = v_request for update;
    -- El destinatario de la cabecera solo se rellena con el de la necesidad si coincide
    -- o si la cabecera aún no tiene ninguno. Si son distintos, la solicitud es mixta y
    -- no puede anunciar un destinatario concreto: se vacía en vez de mentir.
    v_mismo_destino := coalesce(cab.installer_id, '') = coalesce(req.installer_id, '')
                   and coalesce(cab.installer_name, '') = coalesce(req.installer_name, '');
    update public.logistics_requests set
      installer_id = case
        when cab.installer_id is null and cab.installer_name is null then req.installer_id
        when v_mismo_destino then cab.installer_id
        else null end,
      installer_name = case
        when cab.installer_id is null and cab.installer_name is null then req.installer_name
        when v_mismo_destino then cab.installer_name
        else null end,
      destination_type = case
        when cab.installer_id is null and cab.installer_name is null then
          case when req.installer_id is not null or req.installer_name is not null then 'instalador' else cab.destination_type end
        when v_mismo_destino then cab.destination_type
        else 'farmacia' end,
      delivery_address = case
        when cab.delivery_address is null then req.delivery_address
        when coalesce(cab.delivery_address, '') = coalesce(req.delivery_address, '') then cab.delivery_address
        else null end,
      required_date = req.required_date,
      installation_date = req.installation_date,
      priority = req.priority,
      updated_at = now()
    where id = v_request;
  end if;

  update public.logistics_material_requirements set request_id = v_request, updated_at = now() where id = p_requirement;

  -- línea de la petición (upsert por necesidad)
  if exists (select 1 from public.logistics_request_lines where request_id = v_request and material_requirement_id = p_requirement) then
    update public.logistics_request_lines set
      material_id = req.material_id,
      requested_quantity = req.requested_quantity,
      missing_quantity = greatest(0, req.requested_quantity - coalesce(delivered_quantity, 0)),
      line_status = (select status from public.logistics_material_requirements where id = p_requirement)
    where request_id = v_request and material_requirement_id = p_requirement;
  else
    insert into public.logistics_request_lines (
      request_id, material_requirement_id, material_id, requested_quantity,
      accepted_quantity, prepared_quantity, delivered_quantity, missing_quantity, line_status
    )
    select v_request, p_requirement, req.material_id, req.requested_quantity,
           0, coalesce(req.prepared_quantity, 0), coalesce(req.delivered_quantity, 0),
           greatest(0, req.requested_quantity - coalesce(req.delivered_quantity, 0)), r2.status
    from public.logistics_material_requirements r2 where r2.id = p_requirement;
  end if;
  return v_request;
end $function$;

grant execute on function public.merchan_attach_request(uuid, uuid, text) to authenticated, service_role;

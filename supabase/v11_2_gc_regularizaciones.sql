-- v11_2 · Grandes Campañas: regularizaciones (el pago «olvidado»).
-- PENDIENTE DE APLICAR al proyecto dptmswhwmqimijpfyndn.
--
-- ============================================================================
-- PROBLEMA
-- ============================================================================
-- Una campaña real siempre deja pagos fuera del circuito: el desplazamiento
-- extra que nadie previó, la hora de más, el material que hubo que reponer, la
-- revisita. Hoy eso se arregla por WhatsApp y acaba en una hoja aparte, o no
-- acaba en ninguna parte. Administración se entera cuando el trabajador
-- reclama, y para entonces ya no sabe si es refacturable al cliente o no.
--
-- ============================================================================
-- DECISIONES
-- ============================================================================
-- D1  EL GESTOR PROPONE, ADMINISTRACIÓN APRUEBA. La regularización nace como
--     'propuesta' y no vale un euro hasta que administración la resuelve. Sin
--     esto, el botón de «añadir pago olvidado» sería un gestor aprobándose
--     pagos a sí mismo.
--
-- D2  CONCEPTO TIPIFICADO ademas del texto libre. Es lo que permite a
--     administración facturar sin leerse cuarenta textos, y lo que deja ver que
--     el 40 % de las regularizaciones de una campaña son 'error_tarifa' — que
--     no es un extra, es una tarifa mal puesta.
--
-- D3  `refacturable` se decide AL APROBAR, no al proponer. Es la decisión de
--     administración («¿esto se lo cobramos al cliente o lo comemos?») y si no
--     se captura en ese momento se pierde para siempre.
--
-- D4  LA APROBACIÓN CREA LA LÍNEA DE PAGO EN LA MISMA TRANSACCIÓN. No hay estado
--     'aprobada pero todavía sin pagar': o se aprueba y existe la obligación, o
--     no se aprueba. Un limbo entre esos dos estados es exactamente el agujero
--     que esta migración viene a cerrar.
--
-- D5  Cómo se engancha al ledger, respetando SUS invariantes (v8_0):
--       · Si el punto ya tiene su obligación de instalación, la regularización
--         se crea como AJUSTE enlazado a ella (kind='ajuste',
--         adjusts_obligation_id). Así admite importes negativos y queda claro
--         qué pago está corrigiendo.
--       · Si no la tiene, se crea como pago suelto (kind='pago'), que el CHECK
--         `payment_obligations_amount_valid` obliga a que sea >= 0. Una
--         regularización NEGATIVA sin línea original se rechaza con un mensaje
--         que dice qué hacer («vuelca antes los pagos del punto»), en vez de
--         relajar el invariante del ledger.
--
-- D6  Mes contable cerrado (v7_4): no se regulariza contra un mes cerrado. La
--     pantalla lo dice antes de dejar teclear el importe.
--
-- D7  Los RPC son la ÚNICA puerta de escritura: la tabla no tiene policy de
--     INSERT ni de UPDATE para nadie. Son SECURITY DEFINER porque tienen que
--     escribir en `payment_obligations`, cuya policy `pagos_scope` hoy solo deja
--     ver/escribir a administración las líneas que no son de ISDIN. Esa policy
--     no se toca aquí (queda pendiente): esta es una puerta controlada, con el
--     permiso comprobado por dentro, no un agujero.
--
-- D8  El ámbito se comprueba a DOS niveles: la campaña (merchan_gc_puede_operar_campana)
--     y el PUNTO (merchan_gc_puede_operar_punto). Una gestora puede tener la
--     campaña en su ámbito y aun así no ser la responsable de ese punto concreto:
--     con solo el primer nivel podía generar un pago sobre el punto de otra.
--
-- D10 En una regularización DE PUNTO el beneficiario lo pone el servidor a partir
--     del instalador del punto. El cliente no puede nombrar a otro.
--
-- D9  Ni se propone ni se aprueba nada contra una campaña cerrada: es el mismo
--     candado que assertCampanaEditable() aplica en toda la operativa del módulo.
--
-- ============================================================================
-- VERIFICACIÓN (tras aplicar)
-- ============================================================================
--   -- gestora: propone
--   select public.merchan_gc_regularizacion_solicitar(jsonb_build_object(
--     'campana_id','<campana>','punto_id','<punto>','concepto_tipo','desplazamiento_extra',
--     'concepto','Segundo viaje por obra en la calle','importe_cents',2500,'fecha','2026-08-04'));
--   -- gestora: no puede aprobar la suya
--   select public.merchan_gc_regularizacion_resolver('<id>','aprobada',null,true);  -- error
--   -- admin: aprueba y aparece la línea en Pagos
--   select public.merchan_gc_regularizacion_resolver('<id>','aprobada',null,true);
--   select obligation_key, kind, amount_cents, payable, blocked_reasons
--     from payment_obligations where obligation_key like '%regularizacion%';
--   -- rechazo sin motivo: error
--   select public.merchan_gc_regularizacion_resolver('<otro>','rechazada',null,null);
--   -- una resuelta no se vuelve a resolver
--   select public.merchan_gc_regularizacion_resolver('<id>','rechazada','ya no', null);  -- error
--
-- ============================================================================
-- ROLLBACK
-- ============================================================================
--   drop function if exists public.merchan_gc_regularizacion_resolver(uuid, text, text, boolean);
--   drop function if exists public.merchan_gc_regularizacion_solicitar(jsonb);
--   drop function if exists public.merchan_gc_puede_operar_punto(uuid);
--   drop view if exists public.v_campana_regularizaciones;
--   drop table if exists public.campana_regularizaciones;
--   -- las obligaciones ya creadas NO se borran: se anulan con motivo desde Pagos.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. La tabla
-- ---------------------------------------------------------------------------
create table if not exists public.campana_regularizaciones (
  id uuid primary key default gen_random_uuid(),
  campana_id uuid not null references public.grandes_campanas(id) on delete cascade,
  -- null = regularización de campaña (un día de apoyo, una reunión); no cuelga
  -- de ningún punto y por tanto nunca podrá ser un ajuste enlazado (D5).
  punto_id uuid,
  concepto_tipo text not null check (concepto_tipo in (
    'desplazamiento_extra', 'hora_adicional', 'material_repuesto',
    'revisita', 'error_tarifa', 'otro'
  )),
  concepto text not null check (length(btrim(concepto)) > 0),
  -- Céntimos enteros, igual que el ledger. Negativo = descuento.
  importe_cents bigint not null check (importe_cents <> 0),
  fecha date not null,
  mes_contable text not null,
  trabajador_id text,
  trabajador_nombre text,
  -- Decisión de administración al aprobar (D3). null mientras está propuesta.
  refacturable boolean,
  estado text not null default 'propuesta' check (estado in ('propuesta', 'aprobada', 'rechazada')),
  motivo_resolucion text,
  -- Clave de la línea de pago que generó la aprobación (D4).
  obligation_key text,
  solicitada_por text,
  solicitada_por_nombre text,
  solicitada_at timestamptz not null default now(),
  resuelta_por text,
  resuelta_por_nombre text,
  resuelta_at timestamptz,
  created_at timestamptz not null default now()
);

comment on table public.campana_regularizaciones is
  'Pagos fuera del circuito normal de una gran campaña. El gestor propone, administración aprueba, y la aprobación crea la línea en payment_obligations en la misma transacción.';

create index if not exists idx_gc_reg_campana on public.campana_regularizaciones (campana_id, created_at desc);
create index if not exists idx_gc_reg_estado on public.campana_regularizaciones (estado);
create index if not exists idx_gc_reg_punto on public.campana_regularizaciones (punto_id) where punto_id is not null;

-- ---------------------------------------------------------------------------
-- 2. Ámbito del punto (D8)
-- ---------------------------------------------------------------------------
-- merchan_gc_puede_operar_campana() y merchan_gc_campana_editable() viven en
-- v11_0, porque las comparten esta migración y v11_1.
--
-- Este helper es el espejo en la base de sessionCanSeePunto() (lib/campanas.ts):
-- un punto YA asignado a una gestora solo lo trabaja esa gestora; los que aún no
-- tienen gestor los ve quien cubre la provincia. Sin él, una gestora podía
-- regularizar (y por tanto generar un pago sobre) puntos de una compañera.
create or replace function public.merchan_gc_puede_operar_punto(p_punto uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    public.merchan_is_admin()
    or (
      public.merchan_has_profile()
      and not public.merchan_is_almacen()
      and not public.merchan_is_rrhh()
      and exists (
        select 1 from public.puntos_venta_campana p
         where p.id = p_punto
           and (
             p.gestor_id = (public.merchan_auth_profile()).id
             or (
               p.gestor_id is null
               and p.provincia is not null
               and public.merchan_norm_province(p.provincia) = any (public.merchan_province_scope())
             )
           )
      )
    );
$$;

comment on function public.merchan_gc_puede_operar_punto(uuid) is
  'Espejo en la base de sessionCanSeePunto(): un punto asignado solo lo trabaja su gestora; los libres, quien cubre la provincia.';

revoke all on function public.merchan_gc_puede_operar_punto(uuid) from public, anon;
grant execute on function public.merchan_gc_puede_operar_punto(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. Ámbito de lectura: se lee, no se escribe a mano (D7)
-- ---------------------------------------------------------------------------
alter table public.campana_regularizaciones enable row level security;

-- Ámbito real, no «ve la campaña»: una regularización lleva importe y nombre de
-- trabajador. Almacén y RR.HH. quedan fuera (no tienen permiso 'pagos'), y una
-- gestora solo ve las de sus puntos, más las de campaña que ella misma propuso.
drop policy if exists gc_reg_read on public.campana_regularizaciones;
create policy gc_reg_read on public.campana_regularizaciones
  for select to authenticated
  using (
    (select public.merchan_is_admin())
    or (
      (select public.merchan_gc_puede_operar_campana(campana_regularizaciones.campana_id))
      and (
        (punto_id is not null and (select public.merchan_gc_puede_operar_punto(campana_regularizaciones.punto_id)))
        or (punto_id is null and solicitada_por = (select public.merchan_my_app_user_id()))
      )
    )
  );

grant select on public.campana_regularizaciones to authenticated;
revoke insert, update, delete on public.campana_regularizaciones from authenticated, anon;

-- ---------------------------------------------------------------------------
-- 4. El gestor propone (D1)
-- ---------------------------------------------------------------------------
create or replace function public.merchan_gc_regularizacion_solicitar(p_datos jsonb)
returns public.campana_regularizaciones
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_perfil public.app_users;
  v_campana uuid := nullif(p_datos ->> 'campana_id', '')::uuid;
  v_punto uuid := nullif(p_datos ->> 'punto_id', '')::uuid;
  v_fecha date := nullif(p_datos ->> 'fecha', '')::date;
  v_importe bigint := nullif(p_datos ->> 'importe_cents', '')::bigint;
  v_mes text;
  v_punto_row public.puntos_venta_campana;
  v_fila public.campana_regularizaciones;
begin
  v_perfil := public.merchan_auth_profile();
  if v_perfil.id is null then
    raise exception 'Sesión no válida.';
  end if;
  if v_campana is null then
    raise exception 'Falta la campaña.';
  end if;
  if not public.merchan_gc_puede_operar_campana(v_campana) then
    raise exception 'Esta campaña no está en tu ámbito: no puedes registrar regularizaciones en ella.';
  end if;
  -- Espejo de assertCampanaEditable(): una campaña cerrada no genera pagos nuevos.
  if not public.merchan_gc_campana_editable(v_campana) then
    raise exception 'La campaña está cerrada (completada, cancelada o archivada): no admite regularizaciones.';
  end if;
  if v_importe is null or v_importe = 0 then
    raise exception 'La regularización necesita un importe distinto de cero.';
  end if;
  if coalesce(btrim(p_datos ->> 'concepto'), '') = '' then
    raise exception 'Explica en el concepto qué se está regularizando: es lo que administración va a leer para facturarlo.';
  end if;
  if v_fecha is null then
    raise exception 'La regularización necesita una fecha: de ella sale el mes contable.';
  end if;

  v_mes := to_char(v_fecha, 'YYYY-MM');

  -- D6: contra un mes cerrado no se regulariza.
  if exists (select 1 from public.economic_month_closures m where m.mes_contable = v_mes) then
    raise exception 'El mes contable % está cerrado: no admite regularizaciones. Usa una fecha del mes abierto en curso.', v_mes;
  end if;

  if v_punto is not null then
    select * into v_punto_row from public.puntos_venta_campana where id = v_punto;
    if not found then
      raise exception 'El punto indicado no existe.';
    end if;
    if v_punto_row.campana_id <> v_campana then
      raise exception 'Ese punto no pertenece a la campaña indicada.';
    end if;
    -- La campaña puede ser tuya y el punto de otra gestora (D8).
    if not public.merchan_gc_puede_operar_punto(v_punto) then
      raise exception 'Ese punto está asignado a otra gestora o fuera de tus provincias: no puedes regularizarlo.';
    end if;
  end if;

  insert into public.campana_regularizaciones (
    campana_id, punto_id, concepto_tipo, concepto, importe_cents, fecha, mes_contable,
    trabajador_id, trabajador_nombre, solicitada_por, solicitada_por_nombre
  ) values (
    v_campana,
    v_punto,
    coalesce(nullif(p_datos ->> 'concepto_tipo', ''), 'otro'),
    btrim(p_datos ->> 'concepto'),
    v_importe,
    v_fecha,
    v_mes,
    -- D10: con punto, el beneficiario sale SIEMPRE del punto, nunca del cliente.
    -- Antes el JSON ganaba al instalador, así que quien podía operar un punto
    -- suyo podía nombrar beneficiario a otra persona y, si administración lo
    -- aprobaba, el pago se creaba a nombre de quien dijera el JSON en vez de a
    -- nombre del instalador que enseña la pantalla.
    case when v_punto is not null then v_punto_row.instalador_id
         else nullif(p_datos ->> 'trabajador_id', '') end,
    case when v_punto is not null then v_punto_row.instalador_nombre
         else nullif(p_datos ->> 'trabajador_nombre', '') end,
    v_perfil.id,
    coalesce(nullif(v_perfil.display_name, ''), 'Operaciones')
  ) returning * into v_fila;

  return v_fila;
end $$;

comment on function public.merchan_gc_regularizacion_solicitar(jsonb) is
  'La gestora registra una regularización como PROPUESTA. No vale un euro hasta que administración la resuelve.';

grant execute on function public.merchan_gc_regularizacion_solicitar(jsonb) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 5. Administración resuelve, y aprobar CREA la línea de pago (D4, D5)
-- ---------------------------------------------------------------------------
create or replace function public.merchan_gc_regularizacion_resolver(
  p_id uuid,
  p_estado text,
  p_motivo text default null,
  p_refacturable boolean default null
)
returns public.campana_regularizaciones
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_perfil public.app_users;
  v_reg public.campana_regularizaciones;
  v_original public.payment_obligations;
  v_clave text;
  v_bloqueos jsonb := '[]'::jsonb;
  v_pagable boolean;
  v_kind text;
  v_ajusta uuid := null;
begin
  v_perfil := public.merchan_auth_profile();
  if not public.merchan_is_admin() then
    raise exception 'Solo administración puede resolver una regularización.';
  end if;
  if p_estado not in ('aprobada', 'rechazada') then
    raise exception 'Una regularización se aprueba o se rechaza (recibido: %).', p_estado;
  end if;

  select * into v_reg from public.campana_regularizaciones where id = p_id for update;
  if not found then
    raise exception 'Regularización no encontrada.';
  end if;
  if v_reg.estado <> 'propuesta' then
    raise exception 'Esta regularización ya está %: una decisión tomada no se cambia, se compensa con otra regularización.', v_reg.estado;
  end if;

  if p_estado = 'rechazada' then
    if coalesce(btrim(p_motivo), '') = '' then
      raise exception 'Rechazar una regularización exige motivo: lo va a leer quien la propuso.';
    end if;
    update public.campana_regularizaciones set
      estado = 'rechazada',
      motivo_resolucion = btrim(p_motivo),
      resuelta_por = v_perfil.id,
      resuelta_por_nombre = coalesce(nullif(v_perfil.display_name, ''), 'Administración'),
      resuelta_at = now()
    where id = p_id
    returning * into v_reg;
    return v_reg;
  end if;

  -- ---- Aprobación -----------------------------------------------------------
  if p_refacturable is null then
    raise exception 'Al aprobar hay que decir si es refacturable al cliente o lo asume la empresa: es la decisión que se pierde si no se toma ahora.';
  end if;

  if not public.merchan_gc_campana_editable(v_reg.campana_id) then
    raise exception 'La campaña se cerró después de proponerse esta regularización: reábrela o recházala.';
  end if;

  -- El mes pudo cerrarse entre la propuesta y la aprobación.
  if exists (select 1 from public.economic_month_closures m where m.mes_contable = v_reg.mes_contable) then
    raise exception 'El mes contable % se cerró después de proponerse: rechaza esta regularización y vuelve a proponerla con fecha del mes en curso.', v_reg.mes_contable;
  end if;

  -- ¿Hay línea original del punto a la que engancharse? (D5)
  if v_reg.punto_id is not null then
    -- 'anulado' fuera: enganchar un ajuste a una obligación anulada crearía una
    -- línea negativa contra un pago que ya no existe. Si no hay original válida,
    -- cae en la rama de pago suelto, que ya explica qué hacer.
    select * into v_original from public.payment_obligations
     where obligation_key = 'gran_campana:' || v_reg.punto_id::text || ':installation'
       and status <> 'anulado';
  end if;

  -- Se comprueba el id y no `found`: si el punto era null no se ejecutó ninguna
  -- consulta y `found` seguiría hablando del SELECT anterior.
  if v_original.id is not null then
    v_kind := 'ajuste';
    v_ajusta := v_original.id;
  else
    v_kind := 'pago';
    if v_reg.importe_cents < 0 then
      raise exception 'Una regularización negativa necesita la línea de pago original a la que descontar, y este punto todavía no la tiene. Vuelca antes los pagos de la campaña («Volcar pagos») y repite la aprobación.';
    end if;
  end if;

  if coalesce(v_reg.trabajador_id, v_reg.trabajador_nombre) is null then
    v_bloqueos := v_bloqueos || '"missing_worker"'::jsonb;
  end if;
  v_pagable := jsonb_array_length(v_bloqueos) = 0;

  v_clave := 'gran_campana:' || v_reg.campana_id::text || ':regularizacion:' || v_reg.id::text;

  insert into public.payment_obligations (
    obligation_key, origin, source_id, type, kind, amount_cents, event_date,
    worker_id, worker_name, concept, payable, blocked_reasons, adjusts_obligation_id,
    payload, created_by, updated_by, change_reason
  ) values (
    v_clave,
    'gran_campana',
    coalesce(v_reg.punto_id::text, v_reg.campana_id::text),
    'adjustment',
    v_kind,
    v_reg.importe_cents,
    v_reg.fecha,
    v_reg.trabajador_id,
    v_reg.trabajador_nombre,
    'Gran campaña · regularización (' || v_reg.concepto_tipo || '): ' || v_reg.concepto,
    v_pagable,
    v_bloqueos,
    v_ajusta,
    jsonb_build_object(
      'regularizacion_id', v_reg.id,
      'concepto_tipo', v_reg.concepto_tipo,
      'refacturable', p_refacturable,
      'solicitada_por', v_reg.solicitada_por_nombre
    ),
    coalesce(nullif(v_perfil.display_name, ''), 'Administración'),
    coalesce(nullif(v_perfil.display_name, ''), 'Administración'),
    'regularización aprobada de la campaña ' || v_reg.campana_id::text
  );

  update public.campana_regularizaciones set
    estado = 'aprobada',
    refacturable = p_refacturable,
    motivo_resolucion = nullif(btrim(coalesce(p_motivo, '')), ''),
    obligation_key = v_clave,
    resuelta_por = v_perfil.id,
    resuelta_por_nombre = coalesce(nullif(v_perfil.display_name, ''), 'Administración'),
    resuelta_at = now()
  where id = p_id
  returning * into v_reg;

  return v_reg;
end $$;

comment on function public.merchan_gc_regularizacion_resolver(uuid, text, text, boolean) is
  'Administración aprueba (creando la línea en payment_obligations en la misma transacción) o rechaza con motivo. Una regularización resuelta no se vuelve a resolver.';

grant execute on function public.merchan_gc_regularizacion_resolver(uuid, text, text, boolean) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 6. Vista para la pantalla de administración
-- ---------------------------------------------------------------------------
-- security_invoker = true es OBLIGATORIO aquí: sin él la vista se ejecutaría con
-- los permisos de su propietario (postgres) y saltaría la RLS, enseñando a cada
-- gestora las regularizaciones de todas las provincias.
create or replace view public.v_campana_regularizaciones
with (security_invoker = true) as
select
  r.*,
  c.nombre as campana_nombre,
  c.cliente_marca,
  p.nombre_comercial as punto_nombre,
  p.provincia
from public.campana_regularizaciones r
join public.grandes_campanas c on c.id = r.campana_id
left join public.puntos_venta_campana p on p.id = r.punto_id;

comment on view public.v_campana_regularizaciones is
  'Regularizaciones con el nombre de su campaña y de su punto. Hereda la RLS de las tablas de origen.';

grant select on public.v_campana_regularizaciones to authenticated;

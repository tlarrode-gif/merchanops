-- v11_0 · Grandes Campañas: bitácora del punto de venta.
-- PENDIENTE DE APLICAR al proyecto dptmswhwmqimijpfyndn.
--
-- ============================================================================
-- PROBLEMA
-- ============================================================================
-- Las líneas de pago son inmutables, versionadas y con auditoría a prueba de
-- balas (v8_0). El dato que las ALIMENTA no tiene nada: `puntos_venta_campana`
-- no tiene un solo trigger. Hoy alguien cambia un importe de 25 € a 250 €, o
-- mueve una fecha de instalación, y no queda rastro de quién ni de cuándo.
--
-- La asimetría empeora con la actualización masiva por Excel: una subida puede
-- reescribir cientos de puntos de golpe y hoy solo se sabe el recuento que la
-- pantalla enseña un segundo antes de desaparecer.
--
-- La pestaña «Historial» del detalle de campaña ya existe en la interfaz y dice
-- «Próximamente». Esta migración es su contenido.
--
-- ============================================================================
-- DECISIONES
-- ============================================================================
-- D1  Append-only de verdad: `campana_punto_eventos` no admite UPDATE ni DELETE
--     (trigger que lanza excepción), igual que `payment_obligations_audit`.
--
-- D2  SIN clave ajena a `puntos_venta_campana`. Una FK con `on delete cascade`
--     borraría la bitácora justo cuando más se necesita (el punto borrado), y
--     una `restrict` impediría borrar puntos. Se guarda el id suelto y además
--     `punto_nombre`, para que el histórico siga siendo legible cuando el punto
--     ya no exista.
--
-- D3  Una fila por CAMPO cambiado, no una por UPDATE. Es lo que permite
--     preguntar «quién ha tocado importes esta semana» sin abrir un jsonb.
--     Los campos vigilados son los que mueven dinero, plazo o responsable.
--
-- D4  El actor NO lo manda el cliente: sale de `merchan_auth_profile()`, es
--     decir del JWT. Un navegador no puede firmar un cambio con el nombre de
--     otro. Cuando no hay perfil (RPC de servicio, tarea de fondo) se guarda
--     'Sistema'.
--
-- D5  El ORIGEN (pantalla / importación / masiva) viaja en una columna nueva
--     del propio punto, `origen_ultimo_cambio`, que la aplicación incluye en el
--     mismo UPDATE. Se descartó un `current_setting()` de transacción porque
--     supabase-js manda cada sentencia por su cuenta sobre un pool: el GUC no
--     sobreviviría de forma fiable. La columna sí, porque viaja EN la sentencia.
--     Esa columna no se audita a sí misma.
--
-- D6  El importe se guarda como texto igual que el resto de valores. La
--     bitácora es para leerla, no para sumarla: quien suma dinero es el ledger.
--
-- ============================================================================
-- QUIÉN VE QUÉ
-- ============================================================================
--   Administración ve toda la bitácora.
--   La gestora ve la de los puntos que ya puede ver: la policy se apoya en una
--   subconsulta sobre `puntos_venta_campana`, cuya propia RLS por provincia
--   filtra el resultado (mismo mecanismo que usa v9_11).
--   NADIE tiene policy de INSERT/UPDATE/DELETE: la única puerta de escritura es
--   el trigger, que es SECURITY DEFINER.
--
-- ============================================================================
-- VERIFICACIÓN (tras aplicar)
-- ============================================================================
--   -- 1. Un cambio de importe deja exactamente una fila
--   update puntos_venta_campana set importe = 33 where id = '<punto>';
--   select campo, valor_anterior, valor_nuevo, actor_nombre, origen
--     from campana_punto_eventos where punto_id = '<punto>' order by created_at desc;
--
--   -- 2. Un cambio que no toca campos vigilados no genera ruido
--   update puntos_venta_campana set updated_at = now() where id = '<punto>';  -- 0 filas nuevas
--
--   -- 3. La bitácora es inmutable
--   update campana_punto_eventos set campo = 'x';   -- error en castellano
--   delete from campana_punto_eventos;              -- error en castellano
--
--   -- 4. Ámbito: con sesión de gestora solo se ven sus puntos
--   select count(*) from campana_punto_eventos;
--
-- ============================================================================
-- ROLLBACK
-- ============================================================================
--   drop trigger if exists campana_punto_auditoria_trg on public.puntos_venta_campana;
--   drop function if exists public.merchan_gc_punto_auditoria();
--   drop trigger if exists campana_punto_eventos_guard on public.campana_punto_eventos;
--   drop function if exists public.merchan_gc_eventos_inmutables();
--   drop table if exists public.campana_punto_eventos;
--   alter table public.puntos_venta_campana drop column if exists origen_ultimo_cambio;
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. De dónde viene el cambio (D5)
-- ---------------------------------------------------------------------------
alter table public.puntos_venta_campana
  add column if not exists origen_ultimo_cambio text;

comment on column public.puntos_venta_campana.origen_ultimo_cambio is
  'Por dónde entró el último cambio: pantalla | importacion | masiva | logistica | sistema. La escribe la aplicación en el mismo UPDATE y la lee el trigger de auditoría; no se audita a sí misma.';

-- ---------------------------------------------------------------------------
-- 2. La bitácora
-- ---------------------------------------------------------------------------
create table if not exists public.campana_punto_eventos (
  id uuid primary key default gen_random_uuid(),
  -- Sin FK a propósito (D2).
  punto_id uuid not null,
  campana_id uuid,
  punto_nombre text,
  accion text not null check (accion in ('creado', 'actualizado', 'borrado')),
  campo text,
  valor_anterior text,
  valor_nuevo text,
  actor_id text,
  actor_nombre text not null default 'Sistema',
  origen text not null default 'desconocido',
  created_at timestamptz not null default now()
);

comment on table public.campana_punto_eventos is
  'Bitácora append-only de los puntos de gran campaña: una fila por campo cambiado. Alimenta la pestaña «Historial» de la campaña.';

create index if not exists idx_gc_eventos_punto on public.campana_punto_eventos (punto_id, created_at desc);
create index if not exists idx_gc_eventos_campana on public.campana_punto_eventos (campana_id, created_at desc);
create index if not exists idx_gc_eventos_campo on public.campana_punto_eventos (campo);

-- ---------------------------------------------------------------------------
-- 3. Inmutabilidad (D1)
-- ---------------------------------------------------------------------------
create or replace function public.merchan_gc_eventos_inmutables()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'El historial del punto es inmutable: no admite % .', tg_op;
end $$;

drop trigger if exists campana_punto_eventos_guard on public.campana_punto_eventos;
create trigger campana_punto_eventos_guard
  before update or delete on public.campana_punto_eventos
  for each row execute function public.merchan_gc_eventos_inmutables();

-- ---------------------------------------------------------------------------
-- 4. El trigger que escribe la bitácora (D3, D4, D5)
-- ---------------------------------------------------------------------------
create or replace function public.merchan_gc_punto_auditoria()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_perfil public.app_users;
  v_actor_id text;
  v_actor_nombre text;
  v_origen text;
  v_campos text[] := array[
    'estado', 'importe', 'fecha_visita', 'codigo', 'nombre_comercial',
    'direccion', 'provincia', 'tipo', 'gestor_id', 'gestor_nombre',
    'instalador_id', 'instalador_nombre', 'direccion_envio', 'notas',
    'centro_id', 'picking_cerrado_at'
  ];
  v_campo text;
  v_old jsonb;
  v_new jsonb;
  v_antes text;
  v_despues text;
begin
  -- El actor sale del JWT, jamás del cliente (D4).
  v_perfil := public.merchan_auth_profile();
  v_actor_id := v_perfil.id;
  v_actor_nombre := coalesce(nullif(v_perfil.display_name, ''), 'Sistema');

  if tg_op = 'DELETE' then
    insert into public.campana_punto_eventos
      (punto_id, campana_id, punto_nombre, accion, actor_id, actor_nombre, origen)
    values
      (old.id, old.campana_id, old.nombre_comercial, 'borrado', v_actor_id, v_actor_nombre,
       coalesce(nullif(old.origen_ultimo_cambio, ''), 'desconocido'));
    return old;
  end if;

  v_origen := coalesce(nullif(new.origen_ultimo_cambio, ''), 'desconocido');

  if tg_op = 'INSERT' then
    insert into public.campana_punto_eventos
      (punto_id, campana_id, punto_nombre, accion, actor_id, actor_nombre, origen)
    values
      (new.id, new.campana_id, new.nombre_comercial, 'creado', v_actor_id, v_actor_nombre, v_origen);
    return new;
  end if;

  -- UPDATE: una fila por campo vigilado que cambie (D3). Un UPDATE que solo
  -- toca updated_at no deja rastro, que es justo lo que se quiere.
  v_old := to_jsonb(old);
  v_new := to_jsonb(new);
  foreach v_campo in array v_campos loop
    v_antes := v_old ->> v_campo;
    v_despues := v_new ->> v_campo;
    if v_antes is distinct from v_despues then
      insert into public.campana_punto_eventos
        (punto_id, campana_id, punto_nombre, accion, campo, valor_anterior, valor_nuevo,
         actor_id, actor_nombre, origen)
      values
        (new.id, new.campana_id, new.nombre_comercial, 'actualizado', v_campo, v_antes, v_despues,
         v_actor_id, v_actor_nombre, v_origen);
    end if;
  end loop;

  return new;
end $$;

comment on function public.merchan_gc_punto_auditoria() is
  'Escribe la bitácora de un punto de gran campaña. SECURITY DEFINER porque campana_punto_eventos no tiene policy de INSERT para nadie: el trigger es su única puerta.';

drop trigger if exists campana_punto_auditoria_trg on public.puntos_venta_campana;
create trigger campana_punto_auditoria_trg
  after insert or update or delete on public.puntos_venta_campana
  for each row execute function public.merchan_gc_punto_auditoria();

-- ---------------------------------------------------------------------------
-- 5. Ámbito de lectura
-- ---------------------------------------------------------------------------
alter table public.campana_punto_eventos enable row level security;

drop policy if exists gc_eventos_read on public.campana_punto_eventos;
create policy gc_eventos_read on public.campana_punto_eventos
  for select to authenticated
  using (
    (select public.merchan_is_admin())
    -- La RLS por provincia de puntos_venta_campana filtra esta subconsulta.
    or exists (
      select 1 from public.puntos_venta_campana p
       where p.id = campana_punto_eventos.punto_id
    )
  );

grant select on public.campana_punto_eventos to authenticated;
revoke insert, update, delete on public.campana_punto_eventos from authenticated, anon;

-- v11_3 · Grandes Campañas: informe para el cliente (plantillas y copias congeladas).
-- PENDIENTE DE APLICAR al proyecto dptmswhwmqimijpfyndn.
--
-- ============================================================================
-- PROBLEMA
-- ============================================================================
-- El gestor de cuentas manda al cliente un informe de avance cada semana y lo
-- monta a mano. La única exportación que existe es el volcado de puntos a Excel,
-- que lleva importes de COSTE, notas internas y el nombre del instalador: no es
-- algo que se pueda mandar a un cliente.
--
-- ============================================================================
-- DECISIONES
-- ============================================================================
-- D1  PLANTILLAS REUTILIZABLES, no solo un configurador. Si cada semana hay que
--     recomponer el informe eligiendo KPIs, a la tercera semana se vuelve a
--     PowerPoint. Administración configura «Informe semanal ISDIN» una vez y
--     después es un botón.
--
-- D2  CANDADO SOBRE LOS BLOQUES INTERNOS. Cada bloque declara si es interno
--     (coste, margen, presupuesto, tarifas) y un informe con
--     `incluye_costes = false` que contenga uno de ellos NO se guarda: lo
--     rechaza un trigger. El día que alguien mande al cliente el coste por punto
--     el problema no es informático, es comercial.
--
-- D3  EL INFORME SE CONGELA AL GENERARSE. `campana_informes.datos` guarda las
--     cifras del momento, no una consulta que se recalcula. Si el informe se
--     recalculase al abrirlo, no se podría defender lo que se mandó el martes.
--     Por eso además es INMUTABLE: un informe emitido no se edita.
--
-- D4  El catálogo de bloques vive en `merchan_gc_bloques_internos()` y está
--     duplicado en lib/campana-informes.ts. Es duplicación consciente: la lista
--     de la base es la que manda (es la que aplica el candado) y la de TypeScript
--     es la que pinta la pantalla. El test `informe respeta el catálogo de la
--     base` cubre que no se separen.
--
-- D5  UN INFORME INTERNO ES SOLO DE ADMINISTRACIÓN. La primera versión de
--     `gc_informes_read` dejaba leer cualquier informe a quien viera la campaña,
--     así que un informe con `incluye_costes = true` (margen, presupuesto, pagos
--     por trabajador) quedaba al alcance de cualquier gestora. El candado de
--     emisión no sirve de nada si la lectura no distingue.
--
-- D6  El informe emitido tampoco se BORRA. La primera versión daba DELETE a
--     administración, lo que contradice su propio principio de copia congelada
--     (y el borrado lógico de v11_1, y el «nada se borra» de v8_0).
--
-- ============================================================================
-- QUIÉN PUEDE QUÉ
-- ============================================================================
--   Plantillas: las lee cualquier perfil interno (no llevan cifras), las escribe
--   SOLO administración (los gestores de cuentas son perfil admin).
--   Informes emitidos: los de CLIENTE los ve quien puede operar la campaña; los
--   INTERNOS (incluye_costes) solo administración. Los emite administración.
--   Nadie los edita ni los borra: son copias congeladas.
--
-- ============================================================================
-- VERIFICACIÓN (tras aplicar)
-- ============================================================================
--   select public.merchan_gc_bloques_internos();  -- {coste_ejecutado,importe_total,...}
--   -- el candado salta
--   insert into campana_informes (campana_id, titulo, incluye_costes, datos, generado_por_nombre)
--   values ('<campana>', 'Prueba', false,
--     '{"bloques":[{"clave":"coste_ejecutado","valor":100}]}'::jsonb, 'Admin');
--     -- ERROR: el bloque coste_ejecutado es interno
--   -- con incluye_costes = true sí entra
--   -- y un informe emitido no se edita
--   update campana_informes set titulo = 'otro';  -- error en castellano
--
-- ============================================================================
-- ROLLBACK
-- ============================================================================
--   drop trigger if exists campana_informes_guard on public.campana_informes;
--   drop function if exists public.merchan_gc_informe_guard();
--   drop function if exists public.merchan_gc_bloques_internos();
--   drop table if exists public.campana_informes;
--   drop table if exists public.campana_informe_plantillas;
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Qué bloques son internos (D2, D4)
-- ---------------------------------------------------------------------------
create or replace function public.merchan_gc_bloques_internos()
returns text[]
language sql
immutable
set search_path = ''
as $$
  select array[
    'coste_ejecutado',      -- lo que se paga a los trabajadores
    'importe_total',        -- suma de importes de los puntos
    'presupuesto',          -- presupuesto interno de la campaña
    'margen',               -- diferencia entre lo facturado y el coste
    'coste_medio_punto',
    'regularizaciones_importe',
    'detalle_pagos'
  ]::text[];
$$;

comment on function public.merchan_gc_bloques_internos() is
  'Bloques de informe que NUNCA pueden salir en un informe de cliente sin marcar incluye_costes. Es la lista que aplica el candado de campana_informes.';

grant execute on function public.merchan_gc_bloques_internos() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. Plantillas reutilizables (D1)
-- ---------------------------------------------------------------------------
create table if not exists public.campana_informe_plantillas (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  -- Plantilla atada a un cliente ('ISDIN') o general (null).
  cliente_marca text,
  -- Array de claves de bloque, en el orden en que se pintan.
  bloques jsonb not null default '[]'::jsonb,
  -- Texto libre de cabecera que se repite en cada emisión (saludo, notas fijas).
  encabezado text,
  incluye_costes boolean not null default false,
  created_by text,
  created_by_nombre text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.campana_informe_plantillas is
  'Plantillas de informe de cliente reutilizables. Configurar una vez y emitir con un botón (D1 de v11_3).';

create index if not exists idx_gc_plantillas_cliente on public.campana_informe_plantillas (cliente_marca);

alter table public.campana_informe_plantillas enable row level security;

-- Las plantillas no llevan cifras, solo qué bloques se pintan; se leen con
-- cualquier perfil interno para que la pantalla pueda ofrecerlas.
drop policy if exists gc_plantillas_read on public.campana_informe_plantillas;
create policy gc_plantillas_read on public.campana_informe_plantillas
  for select to authenticated
  using ((select public.merchan_has_profile()));

drop policy if exists gc_plantillas_write on public.campana_informe_plantillas;
create policy gc_plantillas_write on public.campana_informe_plantillas
  for all to authenticated
  using ((select public.merchan_is_admin()))
  with check ((select public.merchan_is_admin()));

grant select, insert, update, delete on public.campana_informe_plantillas to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Informes emitidos: copias congeladas (D3)
-- ---------------------------------------------------------------------------
create table if not exists public.campana_informes (
  id uuid primary key default gen_random_uuid(),
  campana_id uuid not null references public.grandes_campanas(id) on delete cascade,
  plantilla_id uuid references public.campana_informe_plantillas(id) on delete set null,
  titulo text not null,
  encabezado text,
  incluye_costes boolean not null default false,
  -- { "bloques": [ { "clave": "...", "etiqueta": "...", "valor": ..., "detalle": [...] } ] }
  datos jsonb not null,
  generado_por text,
  generado_por_nombre text,
  generado_at timestamptz not null default now(),
  notas text
);

comment on table public.campana_informes is
  'Informes de cliente ya emitidos. Copia CONGELADA de las cifras del momento: se guarda lo que se mandó, no una consulta que se recalcula.';

create index if not exists idx_gc_informes_campana on public.campana_informes (campana_id, generado_at desc);

-- ---------------------------------------------------------------------------
-- 4. El candado y la inmutabilidad (D2, D3)
-- ---------------------------------------------------------------------------
create or replace function public.merchan_gc_informe_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_internos text[] := public.merchan_gc_bloques_internos();
  v_clave text;
  v_filtrados text[];
begin
  if tg_op = 'UPDATE' then
    raise exception 'Un informe emitido no se edita: emite uno nuevo. Lo mandado a un cliente tiene que poder defenderse tal cual se mandó.';
  end if;

  -- coalesce OBLIGATORIO: si `datos` no trae la clave 'bloques',
  -- `jsonb_typeof(NULL)` devuelve NULL y `NULL <> 'array'` es NULL, no true, así
  -- que el IF no entraba y el informe se guardaba sin pasar por el candado.
  if coalesce(jsonb_typeof(new.datos -> 'bloques'), 'ausente') <> 'array' then
    raise exception 'El informe necesita datos.bloques como lista.';
  end if;

  if not new.incluye_costes then
    select array_agg(bloque ->> 'clave')
      into v_filtrados
      from jsonb_array_elements(new.datos -> 'bloques') as bloque
     where bloque ->> 'clave' = any (v_internos);

    if v_filtrados is not null and array_length(v_filtrados, 1) > 0 then
      raise exception 'Este informe no está marcado como interno y contiene bloques de coste (%). Quítalos o marca el informe como interno antes de emitirlo.',
        array_to_string(v_filtrados, ', ');
    end if;
  end if;

  return new;
end $$;

drop trigger if exists campana_informes_guard on public.campana_informes;
create trigger campana_informes_guard
  before insert or update on public.campana_informes
  for each row execute function public.merchan_gc_informe_guard();

-- ---------------------------------------------------------------------------
-- 5. Ámbito
-- ---------------------------------------------------------------------------
alter table public.campana_informes enable row level security;

-- D5: un informe INTERNO lleva coste, margen y pagos por trabajador. Solo
-- administración. Los de cliente, quien pueda operar la campaña.
drop policy if exists gc_informes_read on public.campana_informes;
create policy gc_informes_read on public.campana_informes
  for select to authenticated
  using (
    (select public.merchan_is_admin())
    or (
      not incluye_costes
      and (select public.merchan_gc_puede_operar_campana(campana_informes.campana_id))
    )
  );

-- Emitir es cosa de administración: es lo que sale hacia el cliente.
drop policy if exists gc_informes_insert on public.campana_informes;
create policy gc_informes_insert on public.campana_informes
  for insert to authenticated
  with check ((select public.merchan_is_admin()));

grant select, insert on public.campana_informes to authenticated;
-- Ni UPDATE ni DELETE para nadie (D3, D6): un informe emitido es una copia
-- congelada. El trigger ya bloquea el UPDATE; aquí se retiran además los permisos.
revoke update, delete on public.campana_informes from authenticated, anon;

-- MerchanOps V7.0
-- Nuevo módulo Grandes Campañas: campañas nacionales con puntos de venta,
-- gestores asignados e incidencias por punto.
-- Nota de arquitectura: este proyecto NO usa Supabase Auth; los usuarios viven en
-- app_users (id text) y el control de acceso se aplica en la aplicación, igual que
-- en el resto de tablas. RLS queda desactivado hasta la migración de auth pendiente.

create extension if not exists "uuid-ossp";

create table if not exists grandes_campanas (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  cliente_marca text,
  descripcion text,
  estado text not null default 'borrador' check (estado in ('borrador','planificada','activa','pausada','completada','cancelada')),
  fecha_inicio date,
  fecha_fin date,
  provincias text[] not null default '{}',
  presupuesto numeric(12,2),
  created_by text references app_users(id) on delete set null,
  created_by_name text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists campana_gestores (
  id uuid primary key default gen_random_uuid(),
  campana_id uuid not null references grandes_campanas(id) on delete cascade,
  gestor_id text references app_users(id) on delete cascade,
  gestor_nombre text,
  provincia text,
  assigned_at timestamptz default now(),
  unique (campana_id, gestor_id)
);

create table if not exists puntos_venta_campana (
  id uuid primary key default gen_random_uuid(),
  campana_id uuid not null references grandes_campanas(id) on delete cascade,
  gestor_id text references app_users(id) on delete set null,
  gestor_nombre text,
  codigo text,
  nombre_comercial text not null,
  direccion text,
  provincia text,
  tipo text,
  estado text not null default 'pendiente' check (estado in ('pendiente','completado','incidencia','cancelado')),
  fecha_visita date,
  importe numeric(10,2),
  notas text,
  datos_extra jsonb not null default '{}'::jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists incidencias_campana (
  id uuid primary key default gen_random_uuid(),
  punto_id uuid references puntos_venta_campana(id) on delete cascade,
  campana_id uuid references grandes_campanas(id) on delete cascade,
  gestor_id text references app_users(id) on delete set null,
  gestor_nombre text,
  descripcion text,
  estado text not null default 'abierta' check (estado in ('abierta','en_gestion','resuelta')),
  resolved_at timestamptz,
  created_at timestamptz default now()
);

create index if not exists idx_campana_gestores_campana on campana_gestores(campana_id);
create index if not exists idx_campana_gestores_gestor on campana_gestores(gestor_id);
create index if not exists idx_pvc_campana on puntos_venta_campana(campana_id);
create index if not exists idx_pvc_gestor on puntos_venta_campana(gestor_id);
create index if not exists idx_pvc_provincia on puntos_venta_campana(provincia);
create index if not exists idx_pvc_estado on puntos_venta_campana(estado);
create index if not exists idx_inc_campana on incidencias_campana(campana_id);
create index if not exists idx_inc_punto on incidencias_campana(punto_id);
create index if not exists idx_inc_estado on incidencias_campana(estado);
create index if not exists idx_gc_estado on grandes_campanas(estado);

alter table grandes_campanas disable row level security;
alter table campana_gestores disable row level security;
alter table puntos_venta_campana disable row level security;
alter table incidencias_campana disable row level security;

create or replace view v_campana_kpis as
select
  c.id as campana_id,
  count(p.id) as total_puntos,
  count(p.id) filter (where p.estado = 'completado') as completados,
  count(p.id) filter (where p.estado = 'pendiente') as pendientes,
  count(p.id) filter (where p.gestor_id is not null or p.gestor_nombre is not null) as asignados,
  coalesce((select count(*) from incidencias_campana i where i.campana_id = c.id and i.estado <> 'resuelta'), 0) as incidencias_abiertas,
  coalesce(sum(p.importe) filter (where p.estado = 'completado'), 0) as coste_ejecutado,
  coalesce(sum(p.importe), 0) as importe_total,
  case when c.fecha_fin is null then null else (c.fecha_fin - current_date) end as dias_restantes
from grandes_campanas c
left join puntos_venta_campana p on p.campana_id = c.id
group by c.id;

create or replace view v_campanas_listado as
select
  c.*,
  coalesce(k.total_puntos, 0) as total_puntos,
  coalesce(k.completados, 0) as completados,
  coalesce(k.pendientes, 0) as pendientes,
  coalesce(k.asignados, 0) as asignados,
  coalesce(k.incidencias_abiertas, 0) as incidencias_abiertas,
  coalesce(k.coste_ejecutado, 0) as coste_ejecutado,
  coalesce(k.importe_total, 0) as importe_total,
  k.dias_restantes,
  coalesce((select array_agg(g.gestor_nombre order by g.assigned_at) from campana_gestores g where g.campana_id = c.id), '{}') as gestores_nombres,
  coalesce((select array_agg(g.gestor_id order by g.assigned_at) from campana_gestores g where g.campana_id = c.id), '{}') as gestores_ids
from grandes_campanas c
left join v_campana_kpis k on k.campana_id = c.id;

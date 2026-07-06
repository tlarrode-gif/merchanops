-- MerchanOps V7.2
-- Fase 2: importación dinámica de Excel. Cada campaña puede definir su propio
-- esquema de columnas (procedente de las cabeceras del archivo importado):
-- nombre visible, tipo de dato, visibilidad por rol, obligatoriedad, orden y
-- mapeo opcional a un campo interno de puntos_venta_campana.
-- Los valores siguen guardándose en puntos_venta_campana.datos_extra (jsonb),
-- por lo que las campañas anteriores a esta migración siguen funcionando sin
-- esquema (compatibilidad hacia atrás: sin filas aquí, la UI muestra
-- datos_extra tal cual, como hasta ahora).

create table if not exists campana_columnas (
  id uuid primary key default gen_random_uuid(),
  campana_id uuid not null references grandes_campanas(id) on delete cascade,
  nombre_original text not null,
  nombre_visible text not null,
  tipo text not null default 'texto' check (tipo in ('texto','numero','fecha','booleano')),
  campo_interno text,
  visible_gestor boolean not null default true,
  obligatoria boolean not null default false,
  orden integer not null default 0,
  valor_defecto text,
  created_at timestamptz default now(),
  unique (campana_id, nombre_original)
);

create index if not exists idx_campana_columnas_campana on campana_columnas(campana_id);

alter table campana_columnas disable row level security;

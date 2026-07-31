-- v10_5 · Catálogo de RR.HH.: cadenas y centros, y las columnas que los enlazan.
-- PENDIENTE DE APLICAR al proyecto dptmswhwmqimijpfyndn.
--
-- ============================================================================
-- PROBLEMA
-- ============================================================================
-- La pantalla "Accesos a centro" tiene que poder calcular sola, sin que nadie
-- teclee nada (el "texto gris" del diseño):
--
--   "Alcampo tramita por centro · 3 centros → 3 accesos · pedir antes del 29/07"
--   "Media Markt tramita por cadena · 4 centros → 1 acceso · pedir antes del 31/07"
--   "El Corte Inglés · plazo vencido el 25/07"
--
-- Para eso hacen falta dos datos que hoy no existen en ninguna parte:
--   · CÓMO tramita cada cadena  → `cadenas.modo_tramite` ('centro' | 'cadena')
--   · CON CUÁNTA ANTELACIÓN     → `cadenas.lead_time_dias`
-- y la lista de centros de cada cadena para pintar los chips.
--
-- La pantalla "Altas laborales" necesita a su vez el CECO y las horas/día del
-- trabajo. Hoy el CECO de una gran campaña no está en ningún sitio: se hereda
-- "de memoria". Sin esas dos columnas, cada línea de solicitud habría que
-- teclearla, que es justo lo que el diseño dice que NO puede pasar.
--
-- ============================================================================
-- DECISIÓN
-- ============================================================================
-- a) `cadenas` y `centros` son un CATÁLOGO que mantiene RR.HH.: lo lee todo el
--    mundo con perfil (mismo criterio que `clients` en v9_11 — una cadena es
--    una empresa nacional, no algo provincial, y una gestora de Barcelona tiene
--    que poder elegir "Alcampo" para pedir el acceso de su trabajador), y solo
--    lo escriben admin o el ROL rrhh.
--
--    OJO: la escritura usa `merchan_is_rrhh()`, NO `merchan_can_rrhh()`. Ese
--    segundo helper incluye a todas las gestoras (defaultPermissions.rrhh=true,
--    ver v10_4) y dejaría el catálogo abierto a cualquiera. El catálogo es de
--    RR.HH.: si una gestora pudiera cambiar `lead_time_dias`, cambiaría el plazo
--    que el sistema calcula para todo el mundo.
--
-- b) `centros.cadena_id` es ON DELETE RESTRICT: borrar una cadena con centros
--    dejaría accesos históricos apuntando a la nada. Se desactiva (`activa`),
--    no se borra.
--
-- c) `puntos_venta_campana.centro_id` es NULLABLE y SIN migración masiva del
--    histórico: los 1.012 puntos existentes se quedan como están. El enlace se
--    va poblando a medida que RR.HH. da de alta centros y alguien los asocia.
--    Un punto sin centro simplemente no propone acceso automático.
--
-- d) SIN SEMILLA. No se inventan cadenas reales ("Alcampo", "Media Markt", "El
--    Corte Inglés" son ejemplos del diseño, no datos): los plazos y modos de
--    trámite reales solo los conoce RR.HH., y una semilla inventada produciría
--    un "pedir antes del 29/07" falso que la gente se creería.
--
-- ============================================================================
-- VERIFICACIÓN (tras aplicar)
-- ============================================================================
--   -- con sesión de gestora: lee el catálogo pero no lo toca
--   select count(*) from cadenas;                                  -- OK
--   insert into cadenas (nombre, modo_tramite) values ('X','centro'); -- 42501
--   -- con sesión del perfil de RR.HH.: lo mantiene
--   insert into cadenas (nombre, modo_tramite, lead_time_dias)
--     values ('Prueba','centro',2);                                -- OK
--   update cadenas set lead_time_dias = 3 where nombre = 'Prueba'; -- 1 fila
--   delete from cadenas where nombre = 'Prueba';                   -- OK (sin centros)
--   -- columnas nuevas visibles
--   select ceco, horas_dia from grandes_campanas limit 1;
--   select centro_id from puntos_venta_campana limit 1;
--
-- ROLLBACK:
--   drop table if exists public.centros;
--   drop table if exists public.cadenas;
--   alter table public.grandes_campanas drop column if exists ceco;
--   alter table public.grandes_campanas drop column if exists horas_dia;
--   alter table public.puntos_venta_campana drop column if exists centro_id;
--   drop function if exists public.merchan_rrhh_touch_updated_at();
--   (el drop de `cadenas` falla si v10_7 ya está aplicada: rrhh_solicitudes_acceso
--    referencia cadenas con ON DELETE RESTRICT. Revertir v10_7 primero.)

-- ---------------------------------------------------------------------------
-- 0. Sello de updated_at (compartido por todo el módulo de RR.HH.)
-- ---------------------------------------------------------------------------
-- Función de TRIGGER: por eso no lleva `grant execute`. v9_10 dejó documentado
-- que los triggers no consultan EXECUTE, y v9_9 revocó expresamente el EXECUTE
-- de las funciones de trigger porque quedaban publicadas como RPC en
-- /rest/v1/rpc/ sin ningún motivo. Aquí se sigue ese mismo criterio.
create or replace function public.merchan_rrhh_touch_updated_at()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  new.updated_at := now();
  return new;
end $function$;

revoke all on function public.merchan_rrhh_touch_updated_at() from public, anon, authenticated;

comment on function public.merchan_rrhh_touch_updated_at() is
  'Trigger BEFORE UPDATE que sella updated_at en las tablas del módulo de RR.HH. Función de trigger: sin EXECUTE para nadie (criterio de v9_9/v9_10).';

-- ---------------------------------------------------------------------------
-- 1. cadenas
-- ---------------------------------------------------------------------------
create table if not exists public.cadenas (
  id uuid primary key default gen_random_uuid(),
  nombre text not null unique,
  modo_tramite text not null default 'centro' check (modo_tramite in ('centro', 'cadena')),
  lead_time_dias integer not null default 0 check (lead_time_dias >= 0),
  contacto text,
  email text,
  instrucciones text,
  activa boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.cadenas is
  'Catálogo de cadenas de distribución para los accesos a centro. Lo mantiene RR.HH. Es el origen del "texto gris" de la pantalla de accesos: de aquí salen el modo de trámite y el plazo, que el sistema calcula y nadie teclea.';
comment on column public.cadenas.nombre is 'Nombre comercial de la cadena. Único: es la clave con la que la reconoce la gestora.';
comment on column public.cadenas.modo_tramite is
  '"centro" = cada centro necesita su propia solicitud (5 centros → 5 accesos). "cadena" = una sola solicitud vale para toda la cadena (5 centros → 1 acceso, con centro_id NULL). Espejo exacto de ModoTramiteCadena en lib/rrhh/tipos.ts.';
comment on column public.cadenas.lead_time_dias is
  'Días de antelación con los que la cadena exige la solicitud. fecha_limite = fecha_trabajo - lead_time_dias. 0 = sin plazo (el límite es el propio día del trabajo).';
comment on column public.cadenas.contacto is 'Persona o departamento de la cadena al que se pide el acceso. Dato de empresa, no personal del trabajador.';
comment on column public.cadenas.email is 'Buzón al que se manda la solicitud de acceso. Dato de empresa.';
comment on column public.cadenas.instrucciones is 'Cómo se pide el acceso en esta cadena (formulario, portal, correo...). Texto libre para RR.HH.';
comment on column public.cadenas.activa is 'false = cadena retirada. No se borra: los accesos históricos la referencian.';

create index if not exists idx_cadenas_activa on public.cadenas (activa) where activa;

alter table public.cadenas enable row level security;
-- v9_2 dejó a anon con CERO privilegios sobre tablas y esa línea no se cruza:
-- las tablas nuevas nacen abiertas a anon por los privilegios por defecto de
-- Supabase, así que hay que revocarlo explícitamente. Las policies son todas
-- `to authenticated`, pero la defensa en profundidad no sobra.
revoke all on table public.cadenas from anon;
grant select, insert, update, delete on public.cadenas to authenticated, service_role;

-- Lectura: cualquier perfil activo, mismo criterio que `clients` en v9_11. Una
-- cadena es nacional; filtrarla por provincia dejaría los desplegables vacíos.
drop policy if exists cadenas_read on public.cadenas;
create policy cadenas_read on public.cadenas
  for select to authenticated
  using ((select public.merchan_has_profile()));

-- Escritura: admin o ROL rrhh. Nunca merchan_can_rrhh() (incluiría gestoras).
drop policy if exists cadenas_rrhh_write on public.cadenas;
create policy cadenas_rrhh_write on public.cadenas
  for all to authenticated
  using ((select public.merchan_is_admin()) or (select public.merchan_is_rrhh()))
  with check ((select public.merchan_is_admin()) or (select public.merchan_is_rrhh()));

drop trigger if exists trg_cadenas_touch on public.cadenas;
create trigger trg_cadenas_touch
  before update on public.cadenas
  for each row execute function public.merchan_rrhh_touch_updated_at();

-- ---------------------------------------------------------------------------
-- 2. centros
-- ---------------------------------------------------------------------------
create table if not exists public.centros (
  id uuid primary key default gen_random_uuid(),
  cadena_id uuid not null references public.cadenas(id) on delete restrict,
  codigo text,
  nombre text not null,
  direccion text,
  poblacion text,
  provincia text,
  codigo_postal text,
  activo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (cadena_id, codigo)
);

comment on table public.centros is
  'Centros (tiendas) de cada cadena. Alimentan los chips de multi-selección de la pantalla de accesos. Lo mantiene RR.HH.';
comment on column public.centros.cadena_id is
  'Cadena a la que pertenece. ON DELETE RESTRICT a propósito: borrar una cadena con centros dejaría accesos históricos apuntando a la nada. Para retirar una cadena se pone activa = false.';
comment on column public.centros.codigo is
  'Código del centro dentro de la cadena (el que usa la propia cadena). Único por cadena; puede ser NULL mientras no se conozca, y varios NULL conviven porque en un índice UNIQUE los NULL son distintos entre sí.';
comment on column public.centros.provincia is
  'Provincia del centro. Informativa: NO se usa para filtrar por RLS. El acceso a un centro lo pide la gestora del trabajador, que puede estar en otra provincia.';
comment on column public.centros.activo is 'false = centro cerrado o retirado. No se borra: los accesos históricos lo referencian.';

create index if not exists idx_centros_cadena on public.centros (cadena_id);
create index if not exists idx_centros_activo on public.centros (cadena_id, activo) where activo;
create index if not exists idx_centros_nombre on public.centros (nombre);

alter table public.centros enable row level security;
revoke all on table public.centros from anon;
grant select, insert, update, delete on public.centros to authenticated, service_role;

drop policy if exists centros_read on public.centros;
create policy centros_read on public.centros
  for select to authenticated
  using ((select public.merchan_has_profile()));

drop policy if exists centros_rrhh_write on public.centros;
create policy centros_rrhh_write on public.centros
  for all to authenticated
  using ((select public.merchan_is_admin()) or (select public.merchan_is_rrhh()))
  with check ((select public.merchan_is_admin()) or (select public.merchan_is_rrhh()));

drop trigger if exists trg_centros_touch on public.centros;
create trigger trg_centros_touch
  before update on public.centros
  for each row execute function public.merchan_rrhh_touch_updated_at();

-- ---------------------------------------------------------------------------
-- 3. La gran campaña dice su CECO y sus horas/día (decisión D3)
-- ---------------------------------------------------------------------------
-- Cada línea de solicitud de alta HEREDA estos dos valores de la campaña y
-- luego es editable línea a línea (una misma alta puede imputar a dos CECOs).
alter table public.grandes_campanas add column if not exists ceco text;
alter table public.grandes_campanas add column if not exists horas_dia numeric;

comment on column public.grandes_campanas.ceco is
  'Centro de coste al que se imputa el trabajo de esta campaña (el "3005" / "3136" del diseño). Cada línea de solicitud de alta lo hereda y puede sobreescribirlo.';
comment on column public.grandes_campanas.horas_dia is
  'Horas por día de trabajo previstas en la campaña. Se hereda en la línea de solicitud de alta y es editable por línea.';

-- ---------------------------------------------------------------------------
-- 4. El punto de campaña puede apuntar a un centro del catálogo
-- ---------------------------------------------------------------------------
-- NULLABLE y sin migración del histórico: los puntos existentes se quedan como
-- están. ON DELETE SET NULL para que retirar un centro del catálogo no borre
-- puntos de campaña (a diferencia de `centros.cadena_id`, aquí el punto es el
-- dato importante y el centro solo una etiqueta).
alter table public.puntos_venta_campana
  add column if not exists centro_id uuid references public.centros(id) on delete set null;

comment on column public.puntos_venta_campana.centro_id is
  'Centro del catálogo de RR.HH. que corresponde a este punto de venta, si se conoce. NULL = sin enlazar (es el caso de todo el histórico anterior a v10_5): el punto no propone acceso automático, hay que elegir cadena y centro a mano.';

create index if not exists idx_pvc_centro on public.puntos_venta_campana (centro_id) where centro_id is not null;

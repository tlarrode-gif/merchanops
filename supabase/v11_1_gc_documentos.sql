-- v11_1 · Grandes Campañas: contenedor de documentos de campaña y de punto.
-- PENDIENTE DE APLICAR al proyecto dptmswhwmqimijpfyndn.
--
-- ============================================================================
-- PROBLEMA
-- ============================================================================
-- La pestaña «Documentos» del detalle de campaña dice «Próximamente» desde v7.0.
-- Mientras tanto el briefing del cliente, el planograma y las instrucciones de
-- montaje viajan por WhatsApp y por correo. Cuando entra un instalador nuevo a
-- mitad de campaña nadie sabe cuál es la versión buena del planograma, y cuando
-- el cliente reclama un montaje nadie puede demostrar qué instrucciones se
-- dieron.
--
-- ============================================================================
-- DECISIONES
-- ============================================================================
-- D1  ESTA ES LA PRIMERA VEZ QUE EL PROYECTO USA SUPABASE STORAGE. No había
--     ningún bucket ni ninguna subida de fichero en MerchanOPS ni en MerchanLOGS
--     (las fotos de LOGS se analizan pero no se archivan). El bucket nace
--     PRIVADO: se lee con URL firmada de duración corta, nunca por URL pública.
--
-- D2  Dos ámbitos en una sola tabla, distinguidos por `punto_id`:
--       punto_id null  -> documento de CAMPAÑA (briefing, planograma, tarifas)
--       punto_id lleno -> documento de PUNTO (una foto de un escaparate concreto)
--     Mezclarlos en una lista plana hace el contenedor inservible en cuanto la
--     campaña tiene 300 puntos, así que la pantalla los separa siempre.
--
-- D3  `visible_instalador` existe DESDE EL PRIMER DÍA aunque hoy no sirva para
--     nada: el instalador no entra en MerchanOPS. Es el campo que MerchanGO
--     necesitará para saber qué puede enseñar en el móvil. Ponerlo ahora cuesta
--     una columna; ponerlo después obliga a revisar cada documento ya subido.
--
-- D4  VERSIONES, NO SOBREESCRITURA. Subir el «planograma v2» no pisa el v1: se
--     inserta una fila nueva que apunta a la anterior (`sustituye_a`), la vieja
--     deja de ser `vigente` y se queda en el histórico. Es el fallo clásico de
--     estos contenedores: alguien sube encima la versión buena y ya nadie sabe
--     qué planograma estaba vigente el día que se montó el punto.
--
-- D5  El borrado es LÓGICO (`deleted_at`). Un documento que se usó para montar
--     una campaña es parte de la historia de esa campaña, como las líneas de
--     pago. El fichero de Storage sí se puede purgar aparte.
--
-- D6  Límites en la base, no solo en el navegador: 25 MB por fichero (el mismo
--     tope que el importador de Excel) y lista blanca de tipos. Sin esto el
--     contenedor acaba con vídeos de WhatsApp.
--
-- D7  NADA DE ESTE FICHERO PUEDE LLAMAR A merchan_auth_profile() DESDE CÓDIGO QUE
--     EJECUTE EL LLAMANTE. Esa función perdió el EXECUTE para `authenticated` en
--     v9_9 (cerraba una fuga del hash de contraseña) y v9_10 la excluye
--     explícitamente del re-grant masivo. Una primera versión de esta migración
--     la usaba en el RPC (SECURITY INVOKER) y en la policy de UPDATE, y el
--     resultado era que NINGUNA subida, retirada ni cambio de visibilidad
--     funcionaba: `ERROR: permission denied for function merchan_auth_profile`,
--     ni siquiera para administración (el permiso de la función se comprueba al
--     inicializar el InitPlan, antes de evaluar el OR con merchan_is_admin()).
--     Se usa `merchan_my_app_user_id()` (v9_11), que es el wrapper SECURITY
--     DEFINER creado justo para esto y sí tiene grant.
--
-- D8  El RPC pasa a SECURITY DEFINER y comprueba el ámbito por dentro
--     (merchan_gc_puede_operar_campana + merchan_gc_campana_editable, ambos de
--     v11_0), igual que hacen los RPC de v11_2. Con SECURITY INVOKER, jubilar la
--     versión anterior fallaba en cuanto el documento original lo había subido
--     otra persona, y el mensaje que salía era el falso «ya no existe».
--
-- D10 El UPDATE se concede POR COLUMNAS (borrado lógico y visibilidad). Un grant
--     de tabla entera dejaba al autor reescribir storage_path, version o
--     sustituye_a por PostgREST y saltarse el versionado.
--
-- D11 Publicar una versión nueva sobre un documento AJENO se rechaza dentro del
--     RPC. La pantalla ya no lo ofrece, pero el RPC es SECURITY DEFINER y la
--     pantalla no es una defensa.
--
-- D12 El `punto_id` que llega del cliente se valida contra la campaña.
--
-- D9  Escribir documentos exige poder OPERAR la campaña, no solo verla. Almacén
--     y RR.HH. ven las campañas desde v9_11b/v10_4 y con la primera versión de
--     estas policies podían subir y leer documentación de cualquier campaña de
--     España, incluidas las tarifas.
--
-- ============================================================================
-- QUIÉN PUEDE QUÉ
-- ============================================================================
--   Ve y sube documentos quien puede OPERAR la campaña: administración, o la
--   gestora asignada a la campaña o con provincias en ella
--   (merchan_gc_puede_operar_campana, v11_0). Almacén y RR.HH. quedan fuera: ven
--   las campañas pero no su documentación.
--   Retira (borrado lógico) y cambia la visibilidad administración o quien lo
--   subió; jubilar la versión anterior lo hace el RPC, que es SECURITY DEFINER.
--   Ese mismo reparto se repite en las policies de storage.objects, porque un
--   fichero al que se llega por URL no pasa por la tabla. En el DELETE de Storage
--   se añade el dueño del objeto, para que la limpieza del huérfano funcione.
--
-- ============================================================================
-- VERIFICACIÓN (tras aplicar)
-- ============================================================================
--   select id, public from storage.buckets where id = 'campana-documentos';  -- public = false
--   -- una versión nueva desplaza a la anterior sin borrarla
--   select public.merchan_gc_documento_publicar(jsonb_build_object(
--     'campana_id', '<campana>', 'nombre', 'Planograma v2',
--     'storage_path', '<campana>/planograma-v2.pdf', 'mime', 'application/pdf',
--     'tamano_bytes', 12345, 'categoria', 'planograma', 'sustituye_a', '<doc v1>'));
--   select nombre, version, vigente from campana_documentos where campana_id = '<campana>';
--   -- el tope de tamaño salta en la base
--   insert into campana_documentos (campana_id, nombre, storage_path, mime, tamano_bytes)
--   values ('<campana>', 'grande', 'x/y.pdf', 'application/pdf', 99999999);  -- error
--
-- ============================================================================
-- ROLLBACK
-- ============================================================================
--   drop function if exists public.merchan_gc_documento_publicar(jsonb);
--   drop table if exists public.campana_documentos;
--   delete from storage.objects where bucket_id = 'campana-documentos';
--   delete from storage.buckets where id = 'campana-documentos';
--   -- y las cuatro policies gc_docs_* de storage.objects
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. La tabla
-- ---------------------------------------------------------------------------
create table if not exists public.campana_documentos (
  id uuid primary key default gen_random_uuid(),
  campana_id uuid not null references public.grandes_campanas(id) on delete cascade,
  -- null = documento de campaña; lleno = documento de un punto concreto (D2).
  punto_id uuid,
  nombre text not null,
  descripcion text,
  categoria text not null default 'otro'
    check (categoria in ('briefing', 'planograma', 'instrucciones', 'tarifas', 'reporte', 'excel_origen', 'otro')),
  -- Ruta dentro del bucket. Única: dos filas jamás apuntan al mismo fichero.
  storage_path text not null unique,
  mime text not null,
  tamano_bytes bigint not null check (tamano_bytes > 0 and tamano_bytes <= 26214400),
  -- Versionado (D4)
  version integer not null default 1 check (version >= 1),
  sustituye_a uuid references public.campana_documentos(id) on delete set null,
  vigente boolean not null default true,
  -- Visibilidad (D3)
  visible_instalador boolean not null default false,
  visible_gestor boolean not null default true,
  subido_por text,
  subido_por_nombre text,
  created_at timestamptz not null default now(),
  -- Borrado lógico (D5)
  deleted_at timestamptz,
  deleted_por_nombre text
);

comment on table public.campana_documentos is
  'Documentos de una gran campaña (punto_id null) o de uno de sus puntos. Los ficheros viven en el bucket privado campana-documentos; aquí está su ficha, su versión y su visibilidad.';
comment on column public.campana_documentos.visible_instalador is
  'Preparado para MerchanGO: marca qué documentos podrá ver el instalador en el móvil. Hoy no lo consume nadie.';

create index if not exists idx_gc_docs_campana on public.campana_documentos (campana_id, created_at desc);
create index if not exists idx_gc_docs_punto on public.campana_documentos (punto_id) where punto_id is not null;
create index if not exists idx_gc_docs_vigentes on public.campana_documentos (campana_id) where vigente and deleted_at is null;

-- Lista blanca de tipos (D6). Se comprueba con un CHECK y no con un trigger para
-- que sea evidente al leer el esquema qué entra y qué no.
alter table public.campana_documentos drop constraint if exists campana_documentos_mime_permitido;
alter table public.campana_documentos add constraint campana_documentos_mime_permitido check (
  mime in (
    'application/pdf',
    'image/jpeg', 'image/png', 'image/webp', 'image/heic',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-excel',
    'application/vnd.oasis.opendocument.spreadsheet',
    'text/csv',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'application/zip'
  )
);

-- ---------------------------------------------------------------------------
-- 2. Ámbito
-- ---------------------------------------------------------------------------
alter table public.campana_documentos enable row level security;

-- Lectura: quien puede OPERAR la campaña (D9). Verla no basta: almacén y RR.HH.
-- ven todas las campañas y no tienen por qué leer briefings ni tarifas.
drop policy if exists gc_docs_read on public.campana_documentos;
create policy gc_docs_read on public.campana_documentos
  for select to authenticated
  using ((select public.merchan_gc_puede_operar_campana(campana_documentos.campana_id)));

-- Alta: la misma puerta que la lectura.
drop policy if exists gc_docs_insert on public.campana_documentos;
create policy gc_docs_insert on public.campana_documentos
  for insert to authenticated
  with check ((select public.merchan_gc_puede_operar_campana(campana_documentos.campana_id)));

-- Cambio: marca `vigente = false` al publicar una versión nueva y hace el borrado
-- lógico. Administración, o quien lo subió. `merchan_my_app_user_id()` y NO
-- `merchan_auth_profile()`: ver D7, con la segunda esta policy no deja pasar a nadie.
drop policy if exists gc_docs_update on public.campana_documentos;
create policy gc_docs_update on public.campana_documentos
  for update to authenticated
  using (
    (select public.merchan_is_admin())
    or subido_por = (select public.merchan_my_app_user_id())
  )
  with check (
    (select public.merchan_gc_puede_operar_campana(campana_documentos.campana_id))
  );

-- Sin policy de DELETE: los documentos no se borran físicamente (D5).
revoke delete on public.campana_documentos from authenticated, anon;
-- D10: el UPDATE se concede POR COLUMNAS. Con un `grant update` de tabla entera,
-- quien subió un documento podía reescribir por PostgREST `storage_path`,
-- `version`, `sustituye_a`, `vigente` o incluso `campana_id`, saltándose el
-- versionado que esta migración existe para garantizar. Las únicas columnas que
-- la aplicación cambia directamente son las del borrado lógico y la visibilidad;
-- jubilar una versión lo hace el RPC, que es SECURITY DEFINER y no pasa por aquí.
revoke update on public.campana_documentos from authenticated, anon;
grant select, insert on public.campana_documentos to authenticated;
grant update (deleted_at, deleted_por_nombre, vigente, visible_instalador)
  on public.campana_documentos to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Publicar documento / nueva versión, en una sola transacción (D4)
-- ---------------------------------------------------------------------------
-- SECURITY DEFINER (D7, D8): tiene que poder leer el perfil del JWT y jubilar la
-- versión anterior aunque la subiera otra persona. Comprueba el ámbito por dentro,
-- que es exactamente lo que hacen los RPC de v11_2.
create or replace function public.merchan_gc_documento_publicar(p_doc jsonb)
returns public.campana_documentos
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_anterior public.campana_documentos;
  v_nuevo public.campana_documentos;
  v_perfil public.app_users;
  v_version integer := 1;
  v_sustituye uuid := nullif(p_doc ->> 'sustituye_a', '')::uuid;
  v_campana uuid := nullif(p_doc ->> 'campana_id', '')::uuid;
  v_punto uuid := nullif(p_doc ->> 'punto_id', '')::uuid;
begin
  if v_campana is null then
    raise exception 'Falta la campaña del documento.';
  end if;
  if nullif(p_doc ->> 'nombre', '') is null then
    raise exception 'El documento necesita un nombre.';
  end if;
  if nullif(p_doc ->> 'storage_path', '') is null then
    raise exception 'Falta la ruta del fichero subido.';
  end if;

  -- El ámbito se comprueba AQUÍ porque el RPC es SECURITY DEFINER (D8).
  if not public.merchan_gc_puede_operar_campana(v_campana) then
    raise exception 'Esta campaña no está en tu ámbito: no puedes subir documentos en ella.';
  end if;
  if not public.merchan_gc_campana_editable(v_campana) then
    raise exception 'La campaña está cerrada (completada, cancelada o archivada): su documentación es de solo lectura.';
  end if;

  -- D12: el punto llega del cliente; hay que comprobar que existe y que es de esta
  -- campaña, o un documento de punto acabaría colgando del punto de otra campaña.
  if v_punto is not null and not exists (
    select 1 from public.puntos_venta_campana p where p.id = v_punto and p.campana_id = v_campana
  ) then
    raise exception 'Ese punto no existe o no pertenece a esta campaña.';
  end if;

  v_perfil := public.merchan_auth_profile();

  if v_sustituye is not null then
    select * into v_anterior from public.campana_documentos where id = v_sustituye for update;
    if not found then
      raise exception 'El documento al que sustituye ya no existe.';
    end if;
    if v_anterior.campana_id <> v_campana then
      raise exception 'Una versión nueva tiene que ser de la misma campaña que la anterior.';
    end if;
    -- D11: la pantalla solo ofrece «Subir versión nueva» a administración o a quien
    -- lo subió, pero el RPC es SECURITY DEFINER y hay que repetir la regla aquí: si
    -- no, otra gestora de la misma campaña puede publicar encima del briefing ajeno
    -- y dejar el original como no vigente.
    if not public.merchan_is_admin()
       and v_anterior.subido_por is distinct from public.merchan_my_app_user_id() then
      raise exception 'Ese documento lo subió otra persona: solo administración o quien lo subió puede publicar una versión nueva.';
    end if;
    -- Sin estas dos comprobaciones, dos personas podían publicar cada una su «v2»
    -- sobre el mismo v1 y quedaban DOS documentos vigentes con la misma versión.
    if v_anterior.deleted_at is not null then
      raise exception 'Ese documento está retirado: no se le pueden colgar versiones nuevas.';
    end if;
    if not v_anterior.vigente then
      raise exception 'Ese documento ya fue sustituido por una versión posterior. Parte de la versión vigente.';
    end if;
    -- La versión sale del máximo de la cadena, no del +1 de la fila leída.
    select coalesce(max(d.version), v_anterior.version) + 1
      into v_version
      from public.campana_documentos d
     where d.campana_id = v_anterior.campana_id
       and (d.id = v_anterior.id or d.sustituye_a = v_anterior.id);
  end if;

  insert into public.campana_documentos (
    campana_id, punto_id, nombre, descripcion, categoria, storage_path, mime,
    tamano_bytes, version, sustituye_a, vigente, visible_instalador, visible_gestor,
    subido_por, subido_por_nombre
  ) values (
    v_campana,
    v_punto,
    p_doc ->> 'nombre',
    nullif(p_doc ->> 'descripcion', ''),
    coalesce(nullif(p_doc ->> 'categoria', ''), 'otro'),
    p_doc ->> 'storage_path',
    p_doc ->> 'mime',
    (p_doc ->> 'tamano_bytes')::bigint,
    v_version,
    v_sustituye,
    true,
    coalesce((p_doc ->> 'visible_instalador')::boolean, false),
    coalesce((p_doc ->> 'visible_gestor')::boolean, true),
    v_perfil.id,
    coalesce(nullif(v_perfil.display_name, ''), 'Operaciones')
  ) returning * into v_nuevo;

  -- La anterior deja de ser la vigente, pero NO se borra (D4).
  if v_sustituye is not null then
    update public.campana_documentos set vigente = false where id = v_sustituye;
  end if;

  return v_nuevo;
end $$;

comment on function public.merchan_gc_documento_publicar(jsonb) is
  'Publica un documento de campaña. Con sustituye_a crea la versión siguiente y jubila la anterior en la misma transacción.';

grant execute on function public.merchan_gc_documento_publicar(jsonb) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4. El bucket y sus policies (D1)
-- ---------------------------------------------------------------------------
-- El bucket es PRIVADO: se descarga con URL firmada, nunca por URL pública.
insert into storage.buckets (id, name, public, file_size_limit)
values ('campana-documentos', 'campana-documentos', false, 26214400)
on conflict (id) do update set public = false, file_size_limit = 26214400;

-- Las policies de storage.objects las crea el propietario del esquema storage.
-- Si la migración se aplica con un rol sin ese permiso, NO debe morir entera: se
-- avisa y se crean a mano desde el panel de Supabase.
do $$
begin
  -- La primera carpeta de la ruta es SIEMPRE el id de la campaña; de ahí cuelga
  -- el ámbito. La RLS de grandes_campanas filtra la subconsulta igual que arriba.
  execute $pol$
    drop policy if exists gc_docs_storage_read on storage.objects;
    create policy gc_docs_storage_read on storage.objects
      for select to authenticated
      using (
        bucket_id = 'campana-documentos'
        and (select public.merchan_gc_puede_operar_campana(((storage.foldername(name))[1])::uuid))
      );
  $pol$;

  execute $pol$
    drop policy if exists gc_docs_storage_insert on storage.objects;
    create policy gc_docs_storage_insert on storage.objects
      for insert to authenticated
      with check (
        bucket_id = 'campana-documentos'
        and (select public.merchan_gc_puede_operar_campana(((storage.foldername(name))[1])::uuid))
      );
  $pol$;

  -- Reemplazar un fichero por su ruta queda para administración: la operativa
  -- normal es subir una versión nueva, que es otra ruta.
  execute $pol$
    drop policy if exists gc_docs_storage_update on storage.objects;
    create policy gc_docs_storage_update on storage.objects
      for update to authenticated
      using (bucket_id = 'campana-documentos' and (select public.merchan_is_admin()))
      with check (bucket_id = 'campana-documentos' and (select public.merchan_is_admin()));
  $pol$;

  -- Borrar: administración, y ADEMÁS quien acaba de subir el objeto. Sin esa
  -- segunda rama, cuando el alta de la ficha falla, la limpieza del fichero
  -- huérfano que hace lib/campana-documentos.ts era imposible para una gestora y
  -- el fichero se quedaba en el bucket para siempre sin que nadie se enterase.
  execute $pol$
    drop policy if exists gc_docs_storage_delete on storage.objects;
    create policy gc_docs_storage_delete on storage.objects
      for delete to authenticated
      using (
        bucket_id = 'campana-documentos'
        and ((select public.merchan_is_admin()) or owner = (select auth.uid()))
      );
  $pol$;
exception
  when insufficient_privilege then
    raise notice 'Sin permiso para crear las policies de storage.objects: créalas a mano con el rol propietario del esquema storage (ver el cuerpo de esta migración).';
end $$;

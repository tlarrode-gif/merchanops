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
-- ============================================================================
-- QUIÉN PUEDE QUÉ
-- ============================================================================
--   Ve los documentos quien ve la campaña: la policy se apoya en una subconsulta
--   sobre `grandes_campanas`, cuya RLS por provincia hace el filtrado.
--   Sube documentos cualquiera que vea la campaña (el gestor sube el reporte de
--   su zona; administración, el briefing).
--   Borra (lógicamente) administración o quien lo subió. Nadie más.
--   Ese mismo reparto se repite en las policies de storage.objects, porque un
--   fichero al que se llega por URL no pasa por la tabla.
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

-- Lectura: quien ve la campaña. La RLS de grandes_campanas filtra la subconsulta.
drop policy if exists gc_docs_read on public.campana_documentos;
create policy gc_docs_read on public.campana_documentos
  for select to authenticated
  using (
    (select public.merchan_is_admin())
    or exists (select 1 from public.grandes_campanas c where c.id = campana_documentos.campana_id)
  );

-- Alta: la misma puerta que la lectura. Quien puede trabajar la campaña puede
-- aportar documentación.
drop policy if exists gc_docs_insert on public.campana_documentos;
create policy gc_docs_insert on public.campana_documentos
  for insert to authenticated
  with check (
    (select public.merchan_is_admin())
    or exists (select 1 from public.grandes_campanas c where c.id = campana_documentos.campana_id)
  );

-- Cambio: sirve para marcar `vigente = false` al publicar una versión nueva y
-- para el borrado lógico. Administración, o quien lo subió.
drop policy if exists gc_docs_update on public.campana_documentos;
create policy gc_docs_update on public.campana_documentos
  for update to authenticated
  using (
    (select public.merchan_is_admin())
    or subido_por = (select (public.merchan_auth_profile()).id)
  )
  with check (
    (select public.merchan_is_admin())
    or subido_por = (select (public.merchan_auth_profile()).id)
  );

-- Sin policy de DELETE: los documentos no se borran físicamente (D5).
revoke delete on public.campana_documentos from authenticated, anon;
grant select, insert, update on public.campana_documentos to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Publicar documento / nueva versión, en una sola transacción (D4)
-- ---------------------------------------------------------------------------
-- SECURITY INVOKER a propósito: las policies de arriba ya dicen quién puede
-- escribir, así que el RPC no necesita más poder que quien lo llama. Su valor es
-- la ATOMICIDAD: publicar la v2 y jubilar la v1 no pueden quedar a medias.
create or replace function public.merchan_gc_documento_publicar(p_doc jsonb)
returns public.campana_documentos
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_anterior public.campana_documentos;
  v_nuevo public.campana_documentos;
  v_perfil public.app_users;
  v_version integer := 1;
  v_sustituye uuid := nullif(p_doc ->> 'sustituye_a', '')::uuid;
begin
  if nullif(p_doc ->> 'campana_id', '') is null then
    raise exception 'Falta la campaña del documento.';
  end if;
  if nullif(p_doc ->> 'nombre', '') is null then
    raise exception 'El documento necesita un nombre.';
  end if;
  if nullif(p_doc ->> 'storage_path', '') is null then
    raise exception 'Falta la ruta del fichero subido.';
  end if;

  v_perfil := public.merchan_auth_profile();

  if v_sustituye is not null then
    select * into v_anterior from public.campana_documentos where id = v_sustituye for update;
    if not found then
      raise exception 'El documento al que sustituye ya no existe.';
    end if;
    if v_anterior.campana_id <> (p_doc ->> 'campana_id')::uuid then
      raise exception 'Una versión nueva tiene que ser de la misma campaña que la anterior.';
    end if;
    v_version := v_anterior.version + 1;
  end if;

  insert into public.campana_documentos (
    campana_id, punto_id, nombre, descripcion, categoria, storage_path, mime,
    tamano_bytes, version, sustituye_a, vigente, visible_instalador, visible_gestor,
    subido_por, subido_por_nombre
  ) values (
    (p_doc ->> 'campana_id')::uuid,
    nullif(p_doc ->> 'punto_id', '')::uuid,
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
        and (
          (select public.merchan_is_admin())
          or exists (
            select 1 from public.grandes_campanas c
             where c.id::text = (storage.foldername(name))[1]
          )
        )
      );
  $pol$;

  execute $pol$
    drop policy if exists gc_docs_storage_insert on storage.objects;
    create policy gc_docs_storage_insert on storage.objects
      for insert to authenticated
      with check (
        bucket_id = 'campana-documentos'
        and (
          (select public.merchan_is_admin())
          or exists (
            select 1 from public.grandes_campanas c
             where c.id::text = (storage.foldername(name))[1]
          )
        )
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

  execute $pol$
    drop policy if exists gc_docs_storage_delete on storage.objects;
    create policy gc_docs_storage_delete on storage.objects
      for delete to authenticated
      using (bucket_id = 'campana-documentos' and (select public.merchan_is_admin()));
  $pol$;
exception
  when insufficient_privilege then
    raise notice 'Sin permiso para crear las policies de storage.objects: créalas a mano con el rol propietario del esquema storage (ver el cuerpo de esta migración).';
end $$;

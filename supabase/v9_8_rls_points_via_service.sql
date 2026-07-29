-- v9_8 — C-01: cerrar la fuga de `points` sin tocar una sola fila de datos.
--
-- PROBLEMA
-- La policy `province_scope_all` de `points` incluía la rama `province IS NULL`.
-- 364 de 463 filas tienen `province` a NULL (residuo anterior a fae7516, que fue
-- el commit que empezó a propagar la provincia del servicio al punto), así que
-- esas filas quedaban legibles Y modificables (la policy es FOR ALL) por
-- cualquier usuario autenticado con perfil, cruzando las 12 provincias con
-- actividad. Importe expuesto: 13.466,66 € en `fee`, de los cuales 6.559,90 €
-- en servicios "Validado" — es decir, pendientes de pago.
--
-- DECISIÓN
-- No se modifica ningún dato: los 364 puntos se quedan tal cual. En su lugar la
-- provincia se DERIVA del servicio padre, que la tiene poblada al 100 %
-- (0 servicios con provincia nula, 0 puntos huérfanos sin `service_id`).
--
-- La condición sobre `services` se escribe de forma EXPLÍCITA en vez de confiar
-- en que la RLS de `services` se aplique dentro del cuerpo de esta policy: así
-- el comportamiento es el mismo con independencia de esa sutileza semántica.
--
-- IMPACTO EN LA UI: NINGUNO. Verificado gestor a gestor antes de aplicar. La
-- aplicación solo carga los puntos de servicios ya visibles (app/page.tsx:59,
-- `.in("service_id", serviceIds)`), así que el conjunto que ve cada usuario en
-- pantalla es idéntico antes y después. Lo único que cambia es lo que devuelve
-- una llamada directa a /rest/v1/points.
--
--   gestor                       servicios  puntos en app  puntos por API (antes -> después)
--   Kilian, Lara, Lidia, Marc, Yima     0         0                364 -> 0
--   Mai                               252       463                463 -> 463
--
-- La rama `s.province IS NULL` se conserva por simetría con la policy de
-- `services`: si algún día un servicio naciera sin provincia, sus puntos
-- seguirían el mismo criterio de visibilidad que el propio servicio, en vez de
-- volverse invisibles para todo el mundo salvo administración.

drop policy if exists province_scope_all on public.points;

create policy province_scope_all on public.points
  for all to authenticated
  using (
    (select public.merchan_is_admin())
    or (
      (select public.merchan_has_profile())
      and exists (
        select 1
        from public.services s
        where s.id = points.service_id
          and (
            s.province is null
            or public.merchan_norm_province(s.province) = any (
              (select public.merchan_province_scope())::text[]
            )
          )
      )
    )
  )
  with check (
    (select public.merchan_is_admin())
    or (
      (select public.merchan_has_profile())
      and exists (
        select 1
        from public.services s
        where s.id = points.service_id
          and (
            s.province is null
            or public.merchan_norm_province(s.province) = any (
              (select public.merchan_province_scope())::text[]
            )
          )
      )
    )
  );

-- Índice de apoyo: la policy hace un lookup por `service_id` en cada fila.
create index if not exists idx_points_service_id on public.points (service_id);

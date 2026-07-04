# MerchanOps · Reestructuración por roles — plan por fases

Objetivo: diferenciar visión administrativa/global (admin) de visión operativa provincial (gestor),
sin romper datos ni campañas existentes. Este documento registra qué fase está hecha y qué queda.

## Fase 1 — Permisos, gestión de campañas y asignación rápida ✅ (esta entrega)

**1a. Permisos admin vs gestor**
- Helpers centralizados en `lib/access-control.ts`: `canViewFinancials`, `canViewGlobalDashboards`,
  `canManageCampaigns`, `canDeleteCampaigns`.
- Gestor NO ve: presupuesto de campaña (listado, KPIs, formulario, exports), Facturación ISDIN,
  Dashboard KPIs ISDIN, Auditoría de pagos. Bloqueado también por URL directa, no solo en menús.
- Gestor SÍ conserva: filtros de provincia/estado/gestor/tipo/fechas dentro de su ámbito,
  KPIs recalculados sobre sus provincias (listado y detalle de campaña).
- Crear/editar campañas: solo admin (páginas `nueva` y `editar` con guarda).

**1b. Gestión de campañas**
- Menú de acciones por campaña (listado): ver, asignación rápida, exportar, editar, duplicar,
  archivar/restaurar, borrar.
- Duplicar: modal con nuevo nombre/cliente/fechas y opciones (puntos, importes, equipo,
  asignaciones). Incidencias, avances y pagos/facturación nunca se copian. La copia nace en borrador.
- Archivar: estado `archivada` (migración `v7_1_gestion_campanas.sql`), fuera del listado por defecto,
  restaurable. Borrar: solo admin, con resumen de impacto y confirmación escribiendo el nombre;
  las FK en cascada evitan datos huérfanos.

**1c. Asignación rápida** (`/grandes-campanas/[id]/asignacion`)
- Pantalla dividida: listado filtrable con checkboxes + panel de trabajadores con carga
  (puntos, abiertos, importe) y aviso de sobrecarga.
- Asignar/desasignar en bloque, deshacer última operación, sugerir asignación por
  provincia + menor carga con vista previa antes de aplicar.
- Ámbito verificado en `bulkAssignPuntos` (lib): un gestor solo toca puntos de sus provincias.

**Nota de arquitectura**: la app no tiene backend propio (Next client + Supabase con RLS
desactivado y sesión en cliente). El control se aplica en guardas de página y en las funciones
de `lib/` compartidas. El control real a nivel de datos requiere la futura migración a
Supabase Auth + RLS (pendiente de fase posterior).

## Fase 2 — Importación dinámica de Excel (pendiente)
- Schema de columnas por campaña (`campana_columnas`: nombre_original, nombre_visible, tipo,
  visible por rol, obligatoria, orden, valor por defecto, campo interno mapeado).
- Pantalla de configuración de columnas al importar, reutilizable al duplicar/editar.
- Compatibilidad hacia atrás con `datos_extra` de campañas existentes.

## Fase 3 — Flujo económico (pendiente)
- Tabla `economic_events` (pago trabajador / facturación cliente / extras) generada por cambios
  de estado, con idempotencia, reversos y mes contable.
- Exportaciones mensuales de pagos y facturación filtradas por permisos.
- Sustituir/renombrar «Auditoría de pagos» por «Historial económico» sobre esos eventos.

## Fase 4 — ISDIN UX/rendimiento + KPIs (pendiente)
- Virtualización/paginación del listado de vinilos, panel lateral de detalle, vistas agrupadas.
- KPIs ISDIN ejecutivos con export Excel/CSV y variante por rol (gestor: solo sus provincias,
  sin facturación).

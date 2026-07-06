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

## Fase 2 — Importación dinámica de Excel ✅

- Schema de columnas por campaña: tabla `campana_columnas` (migración `v7_2_columnas_dinamicas.sql`,
  aplicada en producción) con nombre_original, nombre_visible, tipo (texto/número/fecha/sí-no),
  campo interno mapeado, visible_gestor, obligatoria, orden y valor por defecto.
- `lib/campana-columnas.ts`: CRUD del esquema, derivación automática desde las cabeceras del
  archivo, filtrado por rol y formateo de valores por tipo.
- Importador (`importador-csv.tsx` + `columnas-config.tsx`): al analizar el archivo se genera el
  esquema; «Configurar columnas» permite renombrar, remapear a campo interno, marcar obligatorias,
  tipar, ocultar al gestor, ordenar, poner valores por defecto o ignorar columnas, y revalidar el
  archivo con esa configuración antes de crear la campaña.
- Reutilizable: el esquema se copia al duplicar campañas y es editable a posteriori desde la
  página de edición (los cambios de mapeo solo afectan a importaciones futuras).
- Render dinámico: el detalle del punto muestra los datos extra con su nombre visible y formato,
  ocultando al gestor las columnas marcadas como no visibles.
- Compatibilidad hacia atrás: campañas sin esquema siguen mostrando `datos_extra` tal cual.

## Fase 3 — Flujo económico ✅

- Tabla `economic_events` (migración `v7_3_economic_events.sql`, aplicada en producción):
  pago_trabajador / facturacion_cliente / extra, con fingerprint único (idempotencia),
  mes contable fijado al crear el evento, y reversos enlazados por `reverso_de`.
  Un evento no se edita ni se borra: se compensa con un reverso de importe opuesto
  contabilizado en el mes en que se emite.
- `lib/economic-events.ts`: generación de eventos desde los orígenes (líneas de pago de
  Servicios y módulo clásico de campañas vía `payment-ledger`, puntos completados del módulo
  nuevo de Grandes Campañas, y facturación ISDIN + regularizaciones), sincronización
  idempotente, lectura filtrada por permisos, reverso y eventos manuales.
- `lib/isdin-billing.ts`: lógica de facturación ISDIN extraída de la página para
  compartirla con el historial (la página de facturación ahora importa de aquí).
- «Auditoría de pagos» sustituida por **«Historial económico»** (`/historial-economico`;
  la URL antigua redirige). Accesible a gestores con permiso de pagos: ven solo
  pagos a trabajador de sus provincias, sin facturación ni extras. Administración ve todo,
  sincroniza eventos, revierte y añade eventos manuales. Se conservan los avisos de
  auditoría cruzada tras cada sincronización.
- Exportaciones mensuales CSV: «pagos del mes» (todos los roles, sobre su ámbito) y
  «facturación del mes» (solo administración).
- El ledger v6.2 (`payment_ledger`) queda como histórico; el flujo nuevo vive en
  `economic_events`.

## Fase 4 — ISDIN UX/rendimiento + KPIs (pendiente)
- Virtualización/paginación del listado de vinilos, panel lateral de detalle, vistas agrupadas.
- KPIs ISDIN ejecutivos con export Excel/CSV y variante por rol (gestor: solo sus provincias,
  sin facturación).

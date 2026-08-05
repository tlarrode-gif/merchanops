import type { NavCounters } from "@/lib/shell/nav-counters";

/**
 * Título y subtítulo de la topbar.
 *
 * En el mockup la topbar no lleva miga de pan: lleva el nombre de la pantalla
 * en serif y, al lado, una frase que dice cómo está esa pantalla ahora mismo
 * («67 en curso · 12 requieren atención»). El subtítulo se compone con los
 * contadores ya cargados para la sidebar, así que no cuesta ninguna consulta
 * extra; cuando un contador no está disponible se cae al texto descriptivo.
 */

export type PageMeta = { title: string; subtitle: string };

const homeTabs: Record<string, PageMeta> = {
  panel: { title: "Panel", subtitle: "Bandeja de acciones del día" },
  servicios: { title: "Servicios", subtitle: "Servicios en curso y su progreso" },
  calendario: { title: "Calendario", subtitle: "Carga por instalador y día" },
  pagos: { title: "Pagos", subtitle: "Del importe validado a la remesa" },
  clientes: { title: "Clientes", subtitle: "Catálogo de clientes y CECOs" },
  trabajadores: { title: "Trabajadores", subtitle: "Instaladores y su capacidad" },
  usuarios: { title: "Usuarios y permisos", subtitle: "Roles, provincias y módulos visibles" },
  "nuevo-servicio": { title: "Nuevo servicio", subtitle: "Alta de servicio y puntos" },
  "nuevo-cliente": { title: "Nuevo cliente", subtitle: "Alta en el catálogo de clientes" },
  "nuevo-trabajador": { title: "Nuevo trabajador", subtitle: "Alta en el catálogo de instaladores" }
};

/** Rutas exactas. Las dinámicas se resuelven por prefijo más abajo. */
const routes: Record<string, PageMeta> = {
  "/grandes-campanas": { title: "Grandes Campañas", subtitle: "Campañas, puntos e incidencias" },
  "/grandes-campanas/nueva": { title: "Nueva campaña", subtitle: "Alta de gran campaña" },
  "/grandes-campanas/mi-zona": { title: "Mi zona", subtitle: "Solo lo asignado a tu provincia" },
  "/grandes-campanas/isdin": { title: "ISDIN · Vinilos", subtitle: "Vinilos de la semana y vencidos anteriores" },
  "/grandes-campanas/isdin/llamadas": { title: "ISDIN · Llamadas", subtitle: "Operativa de llamadas, sin efecto en pagos" },
  "/grandes-campanas/isdin/dashboard": { title: "Dashboard KPIs ISDIN", subtitle: "Ratio de instalación y motivos reales" },
  "/grandes-campanas/isdin/facturacion": { title: "Facturación ISDIN", subtitle: "Líneas del mes y regularizaciones" },
  "/logistica": { title: "Logística", subtitle: "Solo consulta · las acciones se realizan en MerchanLOGS" },
  "/logistica/solicitudes": { title: "Solicitudes de material", subtitle: "Peticiones a logística y su estado" },
  "/pagos/obligaciones": { title: "Aprobación de pagos", subtitle: "Obligaciones calculadas pendientes de validar" },
  "/historial-economico": { title: "Historial económico", subtitle: "Cada movimiento con autor, entidad e importe" },
  "/auditoria-pagos": { title: "Historial económico", subtitle: "Auditoría de pagos" },
  "/configuracion/sincronizacion": { title: "Sincronización", subtitle: "Cola de eventos entre MerchanOps, ISDIN y logística" },
  "/configuracion/avisos": { title: "Avisos del sistema", subtitle: "Mensajes visibles para toda la app" },
  "/rrhh/altas": { title: "Altas laborales", subtitle: "Solicitudes de alta y su tramitación en A3" },
  "/rrhh/accesos": { title: "Accesos a centro", subtitle: "Solicitudes puntuales de acceso" },
  "/rrhh/cadenas": { title: "Cadenas y centros", subtitle: "Catálogo de cadenas, modos de trámite y plazos" },
  "/ui-preview": { title: "Sistema visual", subtitle: "Piezas del rediseño de MerchanOps" }
};

const logisticsSections: Record<string, string> = {
  solicitudes: "Solicitudes",
  entradas: "Entradas de almacén",
  stock: "Stock",
  picking: "Picking",
  salidas: "Salidas y envíos",
  envios: "Salidas y envíos",
  incidencias: "Incidencias",
  pendientes: "Pendientes de llegada"
};

function plural(count: number, singular: string, many: string) {
  return `${count} ${count === 1 ? singular : many}`;
}

/** Frase de estado a partir de los contadores ya cargados para la sidebar. */
function liveSubtitle(key: string, counters: NavCounters): string | null {
  switch (key) {
    case "panel": {
      const pending = (counters.servicios || 0) + (counters.campanas || 0);
      return pending ? `${plural(pending, "asunto abierto", "asuntos abiertos")} requieren tu atención` : null;
    }
    case "servicios":
      return counters.servicios ? `${plural(counters.servicios, "servicio requiere", "servicios requieren")} atención` : null;
    case "pagos":
      return counters.obligaciones ? `${plural(counters.obligaciones, "obligación bloqueada", "obligaciones bloqueadas")}` : null;
    case "/pagos/obligaciones":
      return counters.obligaciones ? `${plural(counters.obligaciones, "obligación pendiente", "obligaciones pendientes")} de validar` : null;
    case "/grandes-campanas":
      return counters.campanas ? `${plural(counters.campanas, "incidencia abierta", "incidencias abiertas")}` : null;
    case "/grandes-campanas/isdin":
      return counters.vinilos ? `${plural(counters.vinilos, "vinilo sin cerrar", "vinilos sin cerrar")}` : null;
    case "/grandes-campanas/isdin/llamadas":
      return counters.llamadas ? `${plural(counters.llamadas, "llamada pendiente", "llamadas pendientes")}` : null;
    case "/logistica":
      return counters.logistica ? `${plural(counters.logistica, "incidencia abierta", "incidencias abiertas")} · solo consulta` : null;
    case "/configuracion/sincronizacion":
      return counters.sincronizacion ? `${plural(counters.sincronizacion, "evento con error", "eventos con error")}` : null;
    case "/rrhh/altas":
      return counters.rrhhAltas ? `${plural(counters.rrhhAltas, "solicitud pendiente", "solicitudes pendientes")}` : null;
    case "/rrhh/accesos":
      return counters.rrhhAccesos ? `${plural(counters.rrhhAccesos, "acceso pendiente", "accesos pendientes")}` : null;
    default:
      return null;
  }
}

export function pageMeta(pathname: string, tab: string, counters: NavCounters = {}): PageMeta {
  // Home: la sección activa la marca ?tab=.
  if (pathname === "/") {
    const base = homeTabs[tab] || homeTabs.panel;
    return { ...base, subtitle: liveSubtitle(tab, counters) || base.subtitle };
  }

  const exact = routes[pathname];
  if (exact) return { ...exact, subtitle: liveSubtitle(pathname, counters) || exact.subtitle };

  // Detalle de campaña y sus subpáginas.
  if (pathname.startsWith("/grandes-campanas/")) {
    if (pathname.endsWith("/editar")) return { title: "Editar campaña", subtitle: "Datos generales, provincias y presupuesto" };
    if (pathname.endsWith("/asignacion")) return { title: "Asignación rápida", subtitle: "Reparto de puntos entre gestores" };
    if (pathname.endsWith("/informe")) return { title: "Informe de campaña", subtitle: "Plantillas y generación de informes" };
    return { title: "Detalle de campaña", subtitle: "Puntos, incidencias, documentos y pagos" };
  }

  // Subvistas de logística: /logistica/<section>.
  if (pathname.startsWith("/logistica/")) {
    const section = pathname.split("/")[2] || "";
    const label = logisticsSections[section];
    if (label) return { title: `Logística · ${label}`, subtitle: "Solo consulta · las acciones se realizan en MerchanLOGS" };
  }

  // Ruta desconocida: se compone un título legible con el último segmento en
  // vez de dejar la topbar vacía.
  const segments = pathname.split("/").filter(Boolean);
  const last = segments[segments.length - 1] || "MerchanOps";
  const readable = last.replace(/-/g, " ");
  return { title: readable.charAt(0).toUpperCase() + readable.slice(1), subtitle: "" };
}

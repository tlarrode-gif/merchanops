import { isSupabaseConfigured, supabase } from "@/lib/supabase";
import { AppSession, canAccessModule, isAdminSession } from "@/lib/access-control";
import { provinceScopeValues } from "@/lib/provinces";
import { getProvinceView, narrowProvincesToView } from "@/lib/shell/province-view";

/**
 * Buscador global de la topbar (⌘K / Ctrl+K).
 *
 * Busca por NOMBRE en las entidades que una persona nombra en voz alta cuando
 * pide algo: «la campaña de Uriage», «la farmacia Sant Gervasi», «lo de Sara».
 * Cada resultado lleva la ruta a la que saltar, así que el buscador es también
 * la forma más corta de moverse entre módulos.
 *
 * Reglas que hereda del resto de la app:
 *  - solo consulta los módulos a los que la sesión tiene acceso;
 *  - acota por el alcance de provincia del rol y por la provincia elegida en
 *    la topbar, igual que las listas.
 */

export type SearchGroup = "Navegación" | "Campañas" | "Puntos y farmacias" | "Servicios" | "Vinilos ISDIN" | "Personas" | "Clientes";

export type SearchResult = {
  id: string;
  group: SearchGroup;
  title: string;
  subtitle?: string;
  href: string;
  icon: "panel" | "campana" | "punto" | "servicio" | "vinilo" | "persona" | "cliente";
};

/** Destinos fijos: el buscador vale también como salto rápido entre secciones. */
type Destination = { label: string; hint: string; href: string; module?: Parameters<typeof canAccessModule>[1]; adminOnly?: boolean };

const destinations: Destination[] = [
  { label: "Panel", hint: "Bandeja de acciones del día", href: "/" },
  { label: "Servicios", hint: "Listado de servicios en curso", href: "/?tab=servicios", module: "servicios" },
  { label: "Calendario", hint: "Carga por instalador y día", href: "/?tab=calendario", module: "calendario" },
  { label: "Pagos", hint: "Conciliación y remesas", href: "/?tab=pagos", module: "pagos" },
  { label: "Aprobación de pagos", hint: "Obligaciones pendientes de validar", href: "/pagos/obligaciones", module: "pagos" },
  { label: "Grandes Campañas", hint: "Listado de campañas", href: "/grandes-campanas", module: "servicios" },
  { label: "Mi zona", hint: "Solo lo asignado a tu provincia", href: "/grandes-campanas/mi-zona", module: "servicios" },
  { label: "ISDIN · Vinilos", hint: "Vinilos de la semana", href: "/grandes-campanas/isdin", module: "isdin" },
  { label: "ISDIN · Llamadas", hint: "Operativa de llamadas", href: "/grandes-campanas/isdin/llamadas", module: "isdin" },
  { label: "ISDIN · Dashboard KPIs", hint: "Ratio de instalación y motivos", href: "/grandes-campanas/isdin/dashboard", module: "isdin" },
  { label: "ISDIN · Facturación", hint: "Líneas del mes y regularizaciones", href: "/grandes-campanas/isdin/facturacion", module: "isdin", adminOnly: true },
  { label: "Logística", hint: "Consulta en tiempo real de MerchanLOGS", href: "/logistica", module: "logistica" },
  { label: "Historial económico", hint: "Trazabilidad de eventos económicos", href: "/historial-economico", module: "pagos" },
  { label: "Altas laborales", hint: "Solicitudes de alta en RR.HH.", href: "/rrhh/altas", module: "rrhh" },
  { label: "Accesos a centro", hint: "Solicitudes de acceso", href: "/rrhh/accesos", module: "rrhh" },
  { label: "Cadenas y centros", hint: "Catálogo de RR.HH.", href: "/rrhh/cadenas", module: "rrhh" },
  { label: "Clientes", hint: "Catálogo de clientes", href: "/?tab=clientes", adminOnly: true },
  { label: "Trabajadores", hint: "Catálogo de instaladores", href: "/?tab=trabajadores", module: "servicios" },
  { label: "Usuarios y permisos", hint: "Roles, provincias y módulos", href: "/?tab=usuarios", adminOnly: true },
  { label: "Sincronización", hint: "Cola de eventos entre módulos", href: "/configuracion/sincronizacion", adminOnly: true },
  { label: "Avisos del sistema", hint: "Mensajes para toda la app", href: "/configuracion/avisos", adminOnly: true }
];

/** Escapa los comodines de PostgREST para que un `%` escrito no rompa el filtro. */
function likeTerm(query: string) {
  return `%${query.replace(/[\\%_,()]/g, " ").trim()}%`;
}

function fold(value: string) {
  return value.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

export function searchDestinations(query: string, session: AppSession | null): SearchResult[] {
  const needle = fold(query.trim());
  if (!needle) return [];
  const admin = isAdminSession(session);
  return destinations
    .filter(d => (!d.module || canAccessModule(session, d.module)) && (!d.adminOnly || admin))
    .filter(d => fold(d.label).includes(needle) || fold(d.hint).includes(needle))
    .slice(0, 5)
    .map(d => ({ id: `nav:${d.href}`, group: "Navegación" as const, title: d.label, subtitle: d.hint, href: d.href, icon: "panel" as const }));
}

const perTable = 5;

export async function searchEntities(query: string, session: AppSession | null): Promise<SearchResult[]> {
  const term = query.trim();
  if (term.length < 2 || !session?.active || !isSupabaseConfigured || !supabase) return [];
  const db = supabase;
  const like = likeTerm(term);

  const view = getProvinceView();
  const scope = view
    ? provinceScopeValues(narrowProvincesToView(isAdminSession(session) ? [view] : session.provinces || []))
    : isAdminSession(session)
      ? []
      : provinceScopeValues(session.provinces || []);
  const scoped = (q: any, column = "province") => (scope.length ? q.in(column, scope) : q);

  type Task = { run: () => PromiseLike<{ data: any[] | null; error: unknown }>; map: (rows: any[]) => SearchResult[] };
  const tasks: Task[] = [];

  if (canAccessModule(session, "servicios")) {
    tasks.push({
      run: () => db.from("grandes_campanas").select("id,nombre,cliente_marca,estado,provincias").ilike("nombre", like).limit(perTable),
      map: rows => rows.map(row => ({
        id: `campana:${row.id}`,
        group: "Campañas" as const,
        title: String(row.nombre || "Campaña"),
        subtitle: [row.cliente_marca, row.estado, (row.provincias || []).slice(0, 3).join(", ")].filter(Boolean).join(" · "),
        href: `/grandes-campanas/${row.id}`,
        icon: "campana" as const
      }))
    });
    tasks.push({
      run: () => scoped(
        db.from("puntos_venta_campana").select("id,campana_id,nombre_comercial,direccion,provincia,estado").ilike("nombre_comercial", like).limit(perTable),
        "provincia"
      ),
      map: rows => rows.map(row => ({
        id: `punto:${row.id}`,
        group: "Puntos y farmacias" as const,
        title: String(row.nombre_comercial || "Punto"),
        subtitle: [row.direccion, row.provincia, row.estado].filter(Boolean).join(" · "),
        href: `/grandes-campanas/${row.campana_id}`,
        icon: "punto" as const
      }))
    });
    tasks.push({
      run: () => scoped(db.from("services").select("id,client,campaign,ceco,province,status").ilike("campaign", like).limit(perTable)),
      map: rows => rows.map(row => ({
        id: `servicio:${row.id}`,
        group: "Servicios" as const,
        title: `${row.client || ""} · ${row.campaign || ""}`.replace(/^ · | · $/g, ""),
        subtitle: [row.ceco && `CECO ${row.ceco}`, row.province, row.status].filter(Boolean).join(" · "),
        href: "/?tab=servicios",
        icon: "servicio" as const
      }))
    });
    tasks.push({
      run: () => scoped(db.from("workers").select("id,name,province,phone").ilike("name", like).limit(perTable)),
      map: rows => rows.map(row => ({
        id: `worker:${row.id}`,
        group: "Personas" as const,
        title: String(row.name || "Instalador"),
        subtitle: [row.province, row.phone].filter(Boolean).join(" · ") || "Instalador",
        href: "/?tab=trabajadores",
        icon: "persona" as const
      }))
    });
  }

  if (canAccessModule(session, "isdin")) {
    tasks.push({
      run: () => scoped(
        db.from("isdin_vinyls").select("id,pharmacy_name,vinyl,status,province,desired_installation_week").ilike("pharmacy_name", like).limit(perTable)
      ),
      map: rows => rows.map(row => ({
        id: `vinilo:${row.id}`,
        group: "Vinilos ISDIN" as const,
        title: String(row.pharmacy_name || "Farmacia"),
        subtitle: [row.vinyl, row.desired_installation_week, row.province, row.status].filter(Boolean).join(" · "),
        href: "/grandes-campanas/isdin",
        icon: "vinilo" as const
      }))
    });
  }

  if (isAdminSession(session)) {
    tasks.push({
      run: () => db.from("clients").select("id,name,ceco").ilike("name", like).limit(perTable),
      map: rows => rows.map(row => ({
        id: `cliente:${row.id}`,
        group: "Clientes" as const,
        title: String(row.name || "Cliente"),
        subtitle: row.ceco ? `CECO ${row.ceco}` : "Cliente",
        href: "/?tab=clientes",
        icon: "cliente" as const
      }))
    });
    tasks.push({
      run: () => db.from("app_users").select("id,display_name,username,role,active").ilike("display_name", like).limit(perTable),
      map: rows => rows.map(row => ({
        id: `usuario:${row.id}`,
        group: "Personas" as const,
        title: String(row.display_name || row.username || "Usuario"),
        subtitle: [row.username, row.role, row.active === false ? "suspendido" : null].filter(Boolean).join(" · "),
        href: "/?tab=usuarios",
        icon: "persona" as const
      }))
    });
  }

  const settled = await Promise.allSettled(tasks.map(t => Promise.resolve(t.run())));
  const results: SearchResult[] = [];
  settled.forEach((outcome, index) => {
    if (outcome.status !== "fulfilled") return;
    const { data, error } = outcome.value;
    if (error || !data) return;
    results.push(...tasks[index].map(data));
  });
  return results;
}

/** Orden de presentación de los grupos en el panel de resultados. */
export const groupOrder: SearchGroup[] = ["Navegación", "Campañas", "Puntos y farmacias", "Vinilos ISDIN", "Servicios", "Personas", "Clientes"];

export function groupResults(results: SearchResult[]) {
  const seen = new Set<string>();
  const unique = results.filter(r => (seen.has(r.id) ? false : (seen.add(r.id), true)));
  return groupOrder
    .map(group => ({ group, items: unique.filter(r => r.group === group) }))
    .filter(entry => entry.items.length);
}

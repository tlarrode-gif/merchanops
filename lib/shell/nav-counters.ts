import { isSupabaseConfigured, supabase } from "@/lib/supabase";
import { AppSession, canAccessModule, isAdminSession } from "@/lib/access-control";
import { provinceScopeValues } from "@/lib/provinces";
import { getProvinceView, narrowProvincesToView } from "@/lib/shell/province-view";

/**
 * Contadores de la sidebar: «dónde tengo trabajo pendiente».
 *
 * Cada clave cuenta lo que hay que ATENDER en su módulo, no su volumen total:
 * un número junto a «Pagos» solo es útil si significa «tres cosas esperan tu
 * aprobación». Por eso todos son recuentos de estados abiertos o bloqueados.
 *
 * Todas las consultas usan `head: true` con `count: "exact"`, así que la base
 * devuelve el número sin transferir una sola fila. Se lanzan en paralelo y con
 * allSettled: si una tabla falla (RLS, migración pendiente, red), ese badge se
 * queda sin número y el resto de la sidebar sigue funcionando.
 */

export type NavCounterKey =
  | "servicios"
  | "pagos"
  | "obligaciones"
  | "campanas"
  | "vinilos"
  | "llamadas"
  | "logistica"
  | "sincronizacion"
  | "rrhhAltas"
  | "rrhhAccesos";

export type NavCounters = Partial<Record<NavCounterKey, number>>;

/** Contadores que señalan riesgo: se pintan en coral en vez de en gris. */
export const alertCounters: NavCounterKey[] = ["sincronizacion", "logistica", "obligaciones"];

export const navCountersChangeEvent = "merchanops-nav-counters-change";

/**
 * Pide un recálculo de los contadores desde cualquier pantalla después de una
 * mutación (resolver una incidencia, aprobar un pago, reintentar un evento).
 * El armazón escucha este evento; las pantallas no necesitan conocerlo.
 */
export function refreshNavCounters() {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(navCountersChangeEvent));
}

type CountQuery = { key: NavCounterKey; run: () => PromiseLike<{ count: number | null; error: unknown }> };

export async function loadNavCounters(session: AppSession | null): Promise<NavCounters> {
  if (!session?.active || !isSupabaseConfigured || !supabase) return {};
  const db = supabase;

  // Alcance de provincia: el del rol, acotado además por el selector de la
  // topbar. Un admin sin filtro no acota nada.
  const roleProvinces = isAdminSession(session) ? [] : provinceScopeValues(session.provinces || []);
  const view = getProvinceView();
  const scope = view
    ? provinceScopeValues(narrowProvincesToView(isAdminSession(session) ? [view] : session.provinces || []))
    : roleProvinces;
  // El constructor de consultas de supabase-js no se deja tipar de forma
  // genérica sin arrastrar sus internals, así que el helper es deliberadamente
  // laxo: solo encadena un .in() y devuelve la misma consulta.
  const scoped = (query: any, column = "province") => (scope.length ? query.in(column, scope) : query);

  const queries: CountQuery[] = [];
  const head = { count: "exact" as const, head: true };

  if (canAccessModule(session, "servicios")) {
    // Servicios con incidencia sin resolver: lo que de verdad pide atención.
    queries.push({
      key: "servicios",
      run: () => scoped(db.from("services").select("id", head).eq("status", "Incidencia").is("resolved_at", null))
    });
    // Incidencias abiertas de grandes campañas (la tabla no tiene provincia
    // propia: cuelga del punto, así que aquí no se acota).
    queries.push({
      key: "campanas",
      run: () => db.from("incidencias_campana").select("id", head).neq("estado", "resuelta")
    });
  }

  if (canAccessModule(session, "pagos")) {
    // Obligaciones calculadas que NO son pagables: están bloqueadas y alguien
    // tiene que mirarlas antes del cierre.
    queries.push({
      key: "obligaciones",
      run: () => db.from("payment_obligations").select("id", head).eq("payable", false).eq("status", "calculado")
    });
  }

  if (canAccessModule(session, "isdin")) {
    queries.push({
      key: "vinilos",
      run: () => scoped(db.from("isdin_vinyls").select("id", head).neq("status", "Finalizado"))
    });
    queries.push({
      key: "llamadas",
      run: () => scoped(db.from("isdin_calls").select("id", head).eq("call_status", "Pendiente de llamar"))
    });
  }

  if (canAccessModule(session, "logistica")) {
    queries.push({
      key: "logistica",
      run: () => db.from("logistics_incidents").select("id", head).not("estado", "in", '("resuelta","cancelada")')
    });
  }

  if (canAccessModule(session, "rrhh")) {
    queries.push({
      key: "rrhhAltas",
      run: () => db.from("rrhh_solicitudes_alta").select("id", head).eq("estado", "pendiente")
    });
    queries.push({
      key: "rrhhAccesos",
      run: () => db.from("rrhh_solicitudes_acceso").select("id", head).in("estado", ["solicitado", "pendiente", "fuera_de_plazo"])
    });
  }

  if (isAdminSession(session)) {
    queries.push({
      key: "sincronizacion",
      run: () => db.from("outbox_events").select("id", head).in("status", ["error", "dead_letter"])
    });
  }

  const settled = await Promise.allSettled(queries.map(q => Promise.resolve(q.run())));
  const counters: NavCounters = {};
  settled.forEach((result, index) => {
    if (result.status !== "fulfilled") return;
    const { count, error } = result.value;
    if (error || count === null || count === undefined) return;
    counters[queries[index].key] = count;
  });
  return counters;
}

/** Sin contadores no se pinta badge; un cero tampoco (no hay nada que señalar). */
export function badgeValue(counters: NavCounters, key?: NavCounterKey) {
  if (!key) return null;
  const value = counters[key];
  return typeof value === "number" && value > 0 ? value : null;
}

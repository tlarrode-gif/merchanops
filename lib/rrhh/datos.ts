/**
 * MerchanOps · RR.HH. — capa de DATOS (la única que habla con Supabase).
 *
 * Las tres pantallas del módulo (`app/rrhh/altas`, `app/rrhh/accesos`,
 * `app/rrhh/cadenas`) leen y escriben SIEMPRE por aquí. La lógica que calcula el
 * "texto gris" del diseño vive en `lib/rrhh/altas.ts` y `lib/rrhh/accesos.ts` y
 * es pura: no toca la red. Este fichero es el puente entre las dos cosas.
 *
 * REGLAS DE LA CASA
 *  - NADA falla en silencio: cualquier error de Supabase se convierte en un
 *    `Error` con mensaje en castellano (patrón de `saveInternalUsers` en
 *    lib/access-control.ts). Nunca un `catch {}` vacío, nunca un `return null`
 *    que disimule un fallo.
 *  - Sin Supabase configurado: las LECTURAS devuelven [] (la pantalla se pinta
 *    vacía y usable) y las ESCRITURAS lanzan, porque prometer que algo se ha
 *    guardado cuando no hay base es la peor mentira posible.
 *  - Los tipos NO se redefinen: vienen de `@/lib/rrhh/tipos`, fuente de verdad
 *    compartida con los CHECK de la base (v10_5, v10_6, v10_7) y con la UI.
 *  - Toda escritura de solicitudes pasa por RPC. Las tablas de solicitudes NO
 *    tienen policy de INSERT ni para admin: la única puerta son las funciones
 *    SECURITY DEFINER, que son las que saben calcular el código, expandir por
 *    modo de trámite y exigir motivo en negativo.
 *
 * DECISIONES QUE CONVIENE CONOCER (documentadas porque son opinables)
 *  - D2: aquí no se lee ni se escribe NINGÚN dato personal (DNI, NAF, IBAN,
 *    domicilio, fecha de nacimiento). De `workers` solo salen id, nombre y
 *    provincia, que es lo justo para elegir a quién se da de alta.
 *  - `puntos_venta_campana.instalador_id` es TEXT (v7_5), no uuid: se compara
 *    con el id del worker en crudo, sin castear.
 *  - Las fechas viajan como texto ISO `YYYY-MM-DD` de punta a punta. Ningún
 *    `new Date()` intermedio, y por tanto ningún desfase de zona horaria.
 */

import { isSupabaseConfigured, supabase } from "@/lib/supabase";
import {
  AltaLaboral,
  Cadena,
  CanalA3,
  Centro,
  EstadoAlta,
  EstadoSolicitudAcceso,
  EstadoSolicitudAlta,
  LineaSolicitudAlta,
  ModoTramiteCadena,
  OrigenTrabajoTipo,
  ResolucionAlta,
  SolicitudAcceso,
  SolicitudAlta,
  TipoAlta,
  TrabajoPendiente
} from "@/lib/rrhh/tipos";

/** Mensaje único cuando falta la configuración de Supabase (solo en escrituras). */
const SIN_SUPABASE = "El módulo de RR.HH. necesita Supabase configurado.";

/** Tamaño de lote para los `.in(...)`: una URL de PostgREST no es infinita. */
const LOTE = 200;

/** Límite por defecto de las tablas de cola: lo que cabe en pantalla sin ahogar la red. */
const LIMITE_POR_DEFECTO = 100;

type ClienteSupabase = NonNullable<typeof supabase>;

/** Cliente para LEER. `null` = sin Supabase; quien llama devuelve [] sin ruido. */
function lectura(): ClienteSupabase | null {
  return isSupabaseConfigured && supabase ? supabase : null;
}

/** Cliente para ESCRIBIR. Sin Supabase lanza: nada se da por guardado a ciegas. */
function escritura(): ClienteSupabase {
  if (!isSupabaseConfigured || !supabase) throw new Error(SIN_SUPABASE);
  return supabase;
}

/** Texto limpio o null: la base prefiere NULL a la cadena vacía. */
function texto(valor: unknown): string | null {
  const limpio = String(valor ?? "").trim();
  return limpio ? limpio : null;
}

/** Número o null. Un "" o un dato ilegible es "no lo sé", no un 0. */
function numero(valor: unknown): number | null {
  if (valor === null || valor === undefined || valor === "") return null;
  const n = Number(valor);
  return Number.isFinite(n) ? n : null;
}

/** Fecha ISO `YYYY-MM-DD` o "" — nunca se construye un Date por el camino. */
function fecha(valor: unknown): string {
  return String(valor ?? "").slice(0, 10);
}

/** Trocea una lista larga para no reventar la URL de PostgREST con un `.in(...)`. */
function lotes<T>(items: T[], tamano = LOTE): T[][] {
  const salida: T[][] = [];
  for (let i = 0; i < items.length; i += tamano) salida.push(items.slice(i, i + tamano));
  return salida;
}

/**
 * Llama a una RPC del módulo y comprueba las DOS capas de error: el fallo de
 * transporte de PostgREST y un campo "error" dentro del jsonb devuelto (mismo
 * patrón que `merchan_auth_bootstrap` en lib/access-control.ts).
 */
async function rpcRrhh<T>(nombre: string, payload: Record<string, unknown>, contexto: string): Promise<T> {
  const db = escritura();
  const { data, error } = await db.rpc(nombre, { p_payload: payload });
  if (error) throw new Error(`${contexto}: ${error.message}`);
  const resultado = (data ?? {}) as { error?: string };
  if (resultado.error) throw new Error(`${contexto}: ${resultado.error}`);
  return resultado as T;
}

// ===========================================================================
// TRABAJADORES
// ===========================================================================

/**
 * Lista de trabajadores para el desplegable de las dos pantallas operativas.
 * Solo id, nombre y provincia: D2 dice que MerchanOps no toca datos personales.
 */
export async function listarTrabajadores(): Promise<{ id: string; name: string; province: string | null }[]> {
  const db = lectura();
  if (!db) return [];
  const { data, error } = await db.from("workers").select("id,name,province").order("name", { ascending: true });
  if (error) throw new Error(`No se pudo cargar la lista de trabajadores: ${error.message}`);
  return ((data ?? []) as Array<{ id: string; name: string | null; province: string | null }>).map(fila => ({
    id: String(fila.id),
    name: String(fila.name ?? ""),
    province: fila.province ?? null
  }));
}

// ===========================================================================
// CATÁLOGO · CADENAS Y CENTROS
// ===========================================================================

function mapCadena(fila: Record<string, unknown>): Cadena {
  return {
    id: String(fila.id),
    nombre: String(fila.nombre ?? ""),
    modo_tramite: (fila.modo_tramite === "cadena" ? "cadena" : "centro") as ModoTramiteCadena,
    lead_time_dias: numero(fila.lead_time_dias) ?? 0,
    contacto: (fila.contacto as string | null) ?? null,
    email: (fila.email as string | null) ?? null,
    instrucciones: (fila.instrucciones as string | null) ?? null,
    activa: fila.activa !== false
  };
}

function mapCentro(fila: Record<string, unknown>): Centro {
  return {
    id: String(fila.id),
    cadena_id: String(fila.cadena_id ?? ""),
    codigo: (fila.codigo as string | null) ?? null,
    nombre: String(fila.nombre ?? ""),
    direccion: (fila.direccion as string | null) ?? null,
    poblacion: (fila.poblacion as string | null) ?? null,
    provincia: (fila.provincia as string | null) ?? null,
    codigo_postal: (fila.codigo_postal as string | null) ?? null,
    activo: fila.activo !== false
  };
}

const COLUMNAS_CADENA = "id,nombre,modo_tramite,lead_time_dias,contacto,email,instrucciones,activa";
const COLUMNAS_CENTRO = "id,cadena_id,codigo,nombre,direccion,poblacion,provincia,codigo_postal,activo";

/** Catálogo completo de cadenas (activas e inactivas), ordenado por nombre. */
export async function listarCadenas(): Promise<Cadena[]> {
  const db = lectura();
  if (!db) return [];
  const { data, error } = await db.from("cadenas").select(COLUMNAS_CADENA).order("nombre", { ascending: true });
  if (error) throw new Error(`No se pudo cargar el catálogo de cadenas: ${error.message}`);
  return ((data ?? []) as Array<Record<string, unknown>>).map(mapCadena);
}

/**
 * Crea o actualiza una cadena. Sin `id` inserta; con `id` actualiza solo los
 * campos presentes, para que editar el plazo no borre el contacto de paso.
 * La RLS de v10_5 exige admin o rol rrhh: una gestora recibirá aquí un 42501.
 */
export async function guardarCadena(cadena: Partial<Cadena>): Promise<Cadena> {
  const db = escritura();
  const nombre = texto(cadena.nombre);
  if (!cadena.id && !nombre) throw new Error("La cadena necesita un nombre.");

  const fila: Record<string, unknown> = {};
  if (cadena.nombre !== undefined) fila.nombre = nombre;
  if (cadena.modo_tramite !== undefined) fila.modo_tramite = cadena.modo_tramite === "cadena" ? "cadena" : "centro";
  if (cadena.lead_time_dias !== undefined) fila.lead_time_dias = Math.max(0, Math.round(numero(cadena.lead_time_dias) ?? 0));
  if (cadena.contacto !== undefined) fila.contacto = texto(cadena.contacto);
  if (cadena.email !== undefined) fila.email = texto(cadena.email);
  if (cadena.instrucciones !== undefined) fila.instrucciones = texto(cadena.instrucciones);
  if (cadena.activa !== undefined) fila.activa = cadena.activa !== false;

  if (cadena.id) {
    if (!Object.keys(fila).length) throw new Error("No hay ningún cambio que guardar en la cadena.");
    const { data, error } = await db.from("cadenas").update(fila).eq("id", cadena.id).select(COLUMNAS_CADENA).single();
    if (error) throw new Error(`No se pudo guardar la cadena: ${error.message}`);
    return mapCadena(data as Record<string, unknown>);
  }
  const { data, error } = await db.from("cadenas").insert(fila).select(COLUMNAS_CADENA).single();
  if (error) throw new Error(`No se pudo crear la cadena: ${error.message}`);
  return mapCadena(data as Record<string, unknown>);
}

/** Centros del catálogo, ordenados por nombre. Con `cadenaId` filtra por cadena. */
export async function listarCentros(cadenaId?: string): Promise<Centro[]> {
  const db = lectura();
  if (!db) return [];
  let consulta = db.from("centros").select(COLUMNAS_CENTRO);
  if (cadenaId) consulta = consulta.eq("cadena_id", cadenaId);
  const { data, error } = await consulta.order("nombre", { ascending: true });
  if (error) throw new Error(`No se pudieron cargar los centros: ${error.message}`);
  return ((data ?? []) as Array<Record<string, unknown>>).map(mapCentro);
}

/**
 * Crea o actualiza un centro. Al crear, `cadena_id` y `nombre` son obligatorios:
 * un centro sin cadena no aparecería en ningún chip y quedaría huérfano.
 */
export async function guardarCentro(centro: Partial<Centro>): Promise<Centro> {
  const db = escritura();
  const nombre = texto(centro.nombre);
  if (!centro.id) {
    if (!texto(centro.cadena_id)) throw new Error("El centro necesita una cadena.");
    if (!nombre) throw new Error("El centro necesita un nombre.");
  }

  const fila: Record<string, unknown> = {};
  if (centro.cadena_id !== undefined) fila.cadena_id = texto(centro.cadena_id);
  if (centro.nombre !== undefined) fila.nombre = nombre;
  if (centro.codigo !== undefined) fila.codigo = texto(centro.codigo);
  if (centro.direccion !== undefined) fila.direccion = texto(centro.direccion);
  if (centro.poblacion !== undefined) fila.poblacion = texto(centro.poblacion);
  if (centro.provincia !== undefined) fila.provincia = texto(centro.provincia);
  if (centro.codigo_postal !== undefined) fila.codigo_postal = texto(centro.codigo_postal);
  if (centro.activo !== undefined) fila.activo = centro.activo !== false;

  if (centro.id) {
    if (!Object.keys(fila).length) throw new Error("No hay ningún cambio que guardar en el centro.");
    const { data, error } = await db.from("centros").update(fila).eq("id", centro.id).select(COLUMNAS_CENTRO).single();
    if (error) throw new Error(`No se pudo guardar el centro: ${error.message}`);
    return mapCentro(data as Record<string, unknown>);
  }
  const { data, error } = await db.from("centros").insert(fila).select(COLUMNAS_CENTRO).single();
  if (error) throw new Error(`No se pudo crear el centro: ${error.message}`);
  return mapCentro(data as Record<string, unknown>);
}

/**
 * Retira un centro poniendo `activo = false`. NUNCA lo borra: las solicitudes de
 * acceso históricas lo referencian y un DELETE dejaría la tabla apuntando a la
 * nada (por eso `centros.cadena_id` es ON DELETE RESTRICT en v10_5).
 */
export async function desactivarCentro(id: string): Promise<void> {
  const db = escritura();
  if (!texto(id)) throw new Error("Falta el centro que hay que retirar.");
  const { error } = await db.from("centros").update({ activo: false }).eq("id", id);
  if (error) throw new Error(`No se pudo retirar el centro: ${error.message}`);
}

// ===========================================================================
// ALTAS REALES (rrhh_altas)
// ===========================================================================

const COLUMNAS_ALTA = "id,worker_id,numero_alta,tipo,fecha_inicio,fecha_fin,ceco,horas_dia,estado,version";

function mapAlta(fila: Record<string, unknown>): AltaLaboral {
  return {
    id: String(fila.id),
    worker_id: String(fila.worker_id ?? ""),
    numero_alta: (fila.numero_alta as string | null) ?? null,
    tipo: (fila.tipo ?? "temporal") as TipoAlta,
    fecha_inicio: fecha(fila.fecha_inicio),
    fecha_fin: fila.fecha_fin ? fecha(fila.fecha_fin) : null,
    ceco: (fila.ceco as string | null) ?? null,
    horas_dia: numero(fila.horas_dia),
    estado: (fila.estado ?? "vigente") as EstadoAlta,
    // Se lee para poder mandarla al ampliar (bloqueo optimista de merchan_rrhh_registrar_alta).
    version: numero(fila.version)
  };
}

/**
 * Altas reales de A3, de la más reciente a la más antigua. Con `workerId` solo
 * las de ese trabajador (es lo que necesita el cálculo de cobertura de altas.ts).
 */
export async function listarAltas(workerId?: string): Promise<AltaLaboral[]> {
  const db = lectura();
  if (!db) return [];
  let consulta = db.from("rrhh_altas").select(COLUMNAS_ALTA);
  if (workerId) consulta = consulta.eq("worker_id", workerId);
  const { data, error } = await consulta.order("fecha_inicio", { ascending: false });
  if (error) throw new Error(`No se pudieron cargar las altas laborales: ${error.message}`);
  return ((data ?? []) as Array<Record<string, unknown>>).map(mapAlta);
}

/** Lo que RR.HH. teclea de un alta de A3 (D6: integración manual desde el día uno). */
export type PayloadRegistrarAlta = {
  /** Si viene, AMPLÍA o corrige esa alta en lugar de crear una nueva. */
  alta_id?: string | null;
  /** Bloqueo optimista al ampliar: la versión que se leyó. */
  version?: number | null;
  /** Obligatorio al crear. */
  worker_id?: string | null;
  numero_alta?: string | null;
  tipo?: TipoAlta | null;
  /** Obligatoria al crear, ISO `YYYY-MM-DD`. */
  fecha_inicio?: string | null;
  /** null = alta abierta. */
  fecha_fin?: string | null;
  /**
   * true = extender, nunca recortar: si el alta ya terminaba más tarde que la
   * `fecha_fin` enviada, la base conserva la suya. Se manda al ampliar desde la
   * cola; para acortar un alta a mano, no se manda.
   */
  ampliar?: boolean;
  ceco?: string | null;
  horas_dia?: number | null;
  estado?: EstadoAlta | null;
  origen?: "manual" | "solicitud" | "import" | null;
  /** Único dato de A3 que se guarda en `workers`. Jamás datos personales (D2). */
  a3_empleado_codigo?: string | null;
};

/**
 * Registra a mano un alta real de A3, o amplía una existente si se pasa
 * `alta_id` (el «ampliar hasta el 31/07» del diseño). Solo admin o rol rrhh.
 */
export async function registrarAlta(payload: PayloadRegistrarAlta): Promise<{ alta_id: string; numero_alta: string | null; version: number | null }> {
  if (!texto(payload.alta_id) && !texto(payload.worker_id)) {
    throw new Error("Para registrar un alta hace falta el trabajador.");
  }
  const resultado = await rpcRrhh<{ alta_id?: string; numero_alta?: string | null; version?: number }>(
    "merchan_rrhh_registrar_alta",
    { ...payload },
    "No se pudo registrar el alta"
  );
  if (!resultado.alta_id) throw new Error("No se pudo registrar el alta: la base no devolvió ningún identificador.");
  return { alta_id: String(resultado.alta_id), numero_alta: resultado.numero_alta ?? null, version: numero(resultado.version) };
}

// ===========================================================================
// TRABAJOS PENDIENTES DE ALTA
// ===========================================================================

/**
 * Los trabajos de un trabajador que todavía NO están respaldados por ninguna
 * línea de solicitud: es la lista que el gestor marca en «Altas laborales».
 *
 * Se reúne de dos sitios (D1, enlace polimórfico, priorizando Grandes Campañas):
 *  a) `puntos_venta_campana.instalador_id = workerId` (columna TEXT desde v7_5),
 *     con su gran campaña para nombre, CECO y horas/día (columnas de v10_5). La
 *     fecha del punto es `fecha_visita` si la tiene; si no, el rango de la campaña.
 *  b) `services.worker_id = workerId` con estado distinto de "Pagado" (un
 *     servicio ya pagado es historia cerrada, no da trabajo pendiente).
 *
 * Después se descartan los orígenes que ya aparecen en
 * `rrhh_solicitud_alta_lineas`: lo ya pedido no se vuelve a ofrecer.
 * Ordenado por fecha de inicio ascendente, que es como se lee un calendario.
 */
export async function trabajosPendientesDeAlta(workerId: string): Promise<TrabajoPendiente[]> {
  const db = lectura();
  if (!db || !texto(workerId)) return [];

  const [puntosRes, serviciosRes] = await Promise.all([
    db
      .from("puntos_venta_campana")
      .select("id,campana_id,nombre_comercial,provincia,fecha_visita")
      .eq("instalador_id", workerId),
    db
      .from("services")
      .select("id,campaign,ceco,province,start_date,deadline,estimated_hours,status")
      .eq("worker_id", workerId)
      .neq("status", "Pagado")
  ]);
  if (puntosRes.error) throw new Error(`No se pudieron leer los puntos de campaña del trabajador: ${puntosRes.error.message}`);
  if (serviciosRes.error) throw new Error(`No se pudieron leer los servicios del trabajador: ${serviciosRes.error.message}`);

  const puntos = (puntosRes.data ?? []) as Array<{
    id: string;
    campana_id: string | null;
    nombre_comercial: string | null;
    provincia: string | null;
    fecha_visita: string | null;
  }>;
  const servicios = (serviciosRes.data ?? []) as Array<{
    id: string;
    campaign: string | null;
    ceco: string | null;
    province: string | null;
    start_date: string | null;
    deadline: string | null;
    estimated_hours: number | null;
  }>;

  // La campaña aporta el CECO y las horas/día que hereda cada línea (D3).
  const campanaIds = Array.from(new Set(puntos.map(punto => punto.campana_id).filter(Boolean))) as string[];
  const campanas = new Map<string, { nombre: string; ceco: string | null; horas_dia: number | null; fecha_inicio: string; fecha_fin: string }>();
  for (const lote of lotes(campanaIds)) {
    const { data, error } = await db.from("grandes_campanas").select("id,nombre,ceco,horas_dia,fecha_inicio,fecha_fin").in("id", lote);
    if (error) throw new Error(`No se pudieron leer las campañas del trabajador: ${error.message}`);
    for (const fila of (data ?? []) as Array<Record<string, unknown>>) {
      campanas.set(String(fila.id), {
        nombre: String(fila.nombre ?? ""),
        ceco: (fila.ceco as string | null) ?? null,
        horas_dia: numero(fila.horas_dia),
        fecha_inicio: fecha(fila.fecha_inicio),
        fecha_fin: fecha(fila.fecha_fin)
      });
    }
  }

  const trabajos: TrabajoPendiente[] = [];

  for (const punto of puntos) {
    const campana = punto.campana_id ? campanas.get(String(punto.campana_id)) : undefined;
    const visita = fecha(punto.fecha_visita);
    // Un punto con fecha de visita es un trabajo de UN día; sin ella, el trabajo
    // se sitúa en el rango completo de la campaña, que es lo único que se sabe.
    const inicio = visita || campana?.fecha_inicio || "";
    const fin = visita || campana?.fecha_fin || inicio;
    const nombrePunto = texto(punto.nombre_comercial);
    const nombreCampana = campana?.nombre || "";
    trabajos.push({
      origen_tipo: "campana_punto",
      origen_id: String(punto.id),
      worker_id: workerId,
      // Nombre visible: campaña · punto. El gestor reconoce el trabajo por el
      // punto, no por la campaña, cuando lleva varios de la misma.
      campana: [nombreCampana, nombrePunto].filter(Boolean).join(" · ") || "Punto de campaña",
      ceco: campana?.ceco ?? "",
      fecha_inicio: inicio,
      fecha_fin: fin,
      horas_dia: campana?.horas_dia ?? null,
      provincia: punto.provincia ?? null
    });
  }

  for (const servicio of servicios) {
    const inicio = fecha(servicio.start_date);
    const fin = fecha(servicio.deadline) || inicio;
    trabajos.push({
      origen_tipo: "servicio",
      origen_id: String(servicio.id),
      worker_id: workerId,
      campana: String(servicio.campaign ?? "") || "Servicio",
      ceco: servicio.ceco ?? "",
      fecha_inicio: inicio,
      fecha_fin: fin,
      // `estimated_hours` son horas TOTALES del servicio, no horas/día: no se
      // puede deducir el reparto por jornada, así que se deja en null y lo
      // teclea quien tramita (D3: horas/día editables por línea).
      horas_dia: null,
      provincia: servicio.province ?? null
    });
  }

  if (!trabajos.length) return [];

  // Lo ya pedido no se vuelve a ofrecer. La lista la da un RPC (SECURITY
  // DEFINER) y no una consulta directa a rrhh_solicitud_alta_lineas, porque leer
  // la tabla daría una respuesta equivocada dos veces: la gestora solo ve SUS
  // líneas (volvería a pedir lo que ya pidió una compañera) y las líneas de una
  // solicitud rechazada o cancelada seguirían tapando el trabajo para siempre.
  const { data: yaPedidosRaw, error: errorPedidos } = await db.rpc("merchan_rrhh_origenes_solicitados", { p_worker: workerId });
  if (errorPedidos) throw new Error(`No se pudieron leer las solicitudes de alta ya enviadas: ${errorPedidos.message}`);
  // Cada elemento llega como "origen_tipo:origen_id".
  const yaPedidos = new Set<string>((Array.isArray(yaPedidosRaw) ? yaPedidosRaw : []).map(clave => String(clave)));

  return trabajos
    .filter(trabajo => !yaPedidos.has(`${trabajo.origen_tipo}:${trabajo.origen_id}`))
    .sort((a, b) => (a.fecha_inicio < b.fecha_inicio ? -1 : a.fecha_inicio > b.fecha_inicio ? 1 : a.campana.localeCompare(b.campana, "es")));
}

// ===========================================================================
// SOLICITUDES DE ALTA
// ===========================================================================

const COLUMNAS_SOLICITUD_ALTA =
  "id,codigo,worker_id,worker_nombre,fecha_inicio,fecha_fin,horas_dia,resolucion_sistema,resolucion_detalle," +
  "alta_referencia_id,alta_referencia_numero,estado,a3_numero,a3_canal,a3_estado,a3_last_sync_at,a3_last_error," +
  "alta_id,solicitada_por,solicitada_por_nombre,motivo,created_at,updated_at,version";

const COLUMNAS_LINEA_ALTA = "id,solicitud_id,origen_tipo,origen_id,campana,ceco,fecha_inicio,fecha_fin,horas_dia";

function mapSolicitudAlta(fila: Record<string, unknown>): SolicitudAlta {
  return {
    id: String(fila.id),
    codigo: String(fila.codigo ?? ""),
    worker_id: String(fila.worker_id ?? ""),
    worker_nombre: (fila.worker_nombre as string | null) ?? null,
    fecha_inicio: fila.fecha_inicio ? fecha(fila.fecha_inicio) : null,
    fecha_fin: fila.fecha_fin ? fecha(fila.fecha_fin) : null,
    horas_dia: numero(fila.horas_dia),
    resolucion_sistema: (fila.resolucion_sistema as ResolucionAlta | null) ?? null,
    resolucion_detalle: (fila.resolucion_detalle as string | null) ?? null,
    alta_referencia_id: (fila.alta_referencia_id as string | null) ?? null,
    alta_referencia_numero: (fila.alta_referencia_numero as string | null) ?? null,
    estado: (fila.estado ?? "pendiente") as EstadoSolicitudAlta,
    a3_numero: (fila.a3_numero as string | null) ?? null,
    a3_canal: (fila.a3_canal ?? "manual") as CanalA3,
    a3_estado: (fila.a3_estado as string | null) ?? null,
    a3_last_sync_at: (fila.a3_last_sync_at as string | null) ?? null,
    a3_last_error: (fila.a3_last_error as string | null) ?? null,
    alta_id: (fila.alta_id as string | null) ?? null,
    solicitada_por: (fila.solicitada_por as string | null) ?? null,
    solicitada_por_nombre: (fila.solicitada_por_nombre as string | null) ?? null,
    motivo: (fila.motivo as string | null) ?? null,
    created_at: String(fila.created_at ?? ""),
    updated_at: (fila.updated_at as string | null) ?? null,
    version: numero(fila.version) ?? 1,
    lineas: []
  };
}

function mapLineaAlta(fila: Record<string, unknown>): LineaSolicitudAlta {
  return {
    id: String(fila.id),
    solicitud_id: String(fila.solicitud_id ?? ""),
    origen_tipo: (fila.origen_tipo ?? "servicio") as OrigenTrabajoTipo,
    origen_id: String(fila.origen_id ?? ""),
    campana: String(fila.campana ?? ""),
    ceco: String(fila.ceco ?? ""),
    fecha_inicio: fecha(fila.fecha_inicio),
    fecha_fin: fecha(fila.fecha_fin),
    horas_dia: numero(fila.horas_dia)
  };
}

/**
 * Cola de altas: cabeceras (más recientes primero) con sus líneas dentro.
 * Son DOS consultas a propósito, sin `select` anidado de PostgREST: así el
 * fallo de las líneas se distingue del de las cabeceras y se puede contar.
 * La RLS decide qué se ve: RR.HH. y admin lo ven todo; la gestora, lo suyo.
 */
export async function listarSolicitudesAlta(filtros?: { workerId?: string; estado?: string; limite?: number }): Promise<SolicitudAlta[]> {
  const db = lectura();
  if (!db) return [];
  let consulta = db.from("rrhh_solicitudes_alta").select(COLUMNAS_SOLICITUD_ALTA);
  if (filtros?.workerId) consulta = consulta.eq("worker_id", filtros.workerId);
  if (filtros?.estado) consulta = consulta.eq("estado", filtros.estado);
  const { data, error } = await consulta
    .order("created_at", { ascending: false })
    .limit(Math.max(1, filtros?.limite ?? LIMITE_POR_DEFECTO));
  if (error) throw new Error(`No se pudo cargar la cola de altas: ${error.message}`);

  // El `select` de esta tabla es largo y el analizador de tipos de PostgREST no
  // llega a inferir la fila: se pasa por `unknown` y se mapea a mano, que es lo
  // que hace el resto del fichero de todos modos.
  const cabeceras = ((data ?? []) as unknown as Array<Record<string, unknown>>).map(mapSolicitudAlta);
  if (!cabeceras.length) return [];

  const porId = new Map(cabeceras.map(solicitud => [solicitud.id, solicitud]));
  for (const lote of lotes(cabeceras.map(solicitud => solicitud.id))) {
    const { data: lineasData, error: lineasError } = await db.from("rrhh_solicitud_alta_lineas").select(COLUMNAS_LINEA_ALTA).in("solicitud_id", lote);
    if (lineasError) throw new Error(`No se pudieron cargar las imputaciones de las solicitudes: ${lineasError.message}`);
    for (const fila of (lineasData ?? []) as Array<Record<string, unknown>>) {
      const linea = mapLineaAlta(fila);
      porId.get(linea.solicitud_id)?.lineas?.push(linea);
    }
  }
  return cabeceras;
}

/** Una imputación a un CECO dentro de la solicitud (una por trabajo marcado). */
export type PayloadLineaAlta = {
  origen_tipo: OrigenTrabajoTipo;
  origen_id: string;
  campana?: string | null;
  ceco?: string | null;
  fecha_inicio?: string | null;
  fecha_fin?: string | null;
  horas_dia?: number | null;
};

/** Lo que manda el botón «Tramitar» de la pantalla de altas. */
export type PayloadSolicitarAlta = {
  worker_id: string;
  worker_nombre?: string | null;
  /** Si faltan, la base las deduce del mínimo y el máximo de las líneas. */
  fecha_inicio?: string | null;
  fecha_fin?: string | null;
  horas_dia?: number | null;
  /** Lo que calculó `lib/rrhh/altas.ts` (el "texto gris"). Nunca lo teclea nadie. */
  resolucion_sistema?: ResolucionAlta | null;
  resolucion_detalle?: string | null;
  alta_referencia_id?: string | null;
  alta_referencia_numero?: string | null;
  /**
   * Solo los CUATRO estados de nacimiento; el resto los decide RR.HH. al resolver.
   * Son cuatro y no tres porque una cobertura no significa siempre lo mismo: si el
   * alta que tapa el periodo es INDEFINIDA la fila de la cola es «Ya de alta
   * indef.», y si es temporal o fija discontinua el trabajo solo necesita la
   * imputación al CECO («Solo imputación»). Es exactamente lo que propone
   * `estadoSugerido()` en lib/rrhh/altas.ts y lo que acepta —y deriva del tipo del
   * alta referenciada— `merchan_rrhh_solicitar_alta` en v10_6.
   */
  estado?: "pendiente" | "se_solapa" | "ya_alta_indefinida" | "solo_imputacion" | null;
  solicitada_por_nombre?: string | null;
  motivo?: string | null;
  lineas: PayloadLineaAlta[];
};

/**
 * Crea la solicitud de alta con sus líneas y devuelve `{solicitud_id, codigo}`.
 * Única puerta de entrada: `rrhh_solicitudes_alta` no tiene policy de INSERT ni
 * para admin, así que el código ALT-AAMMDD-NNN siempre lo pone la base.
 */
export async function crearSolicitudAlta(payload: PayloadSolicitarAlta): Promise<{ solicitud_id: string; codigo: string; estado: EstadoSolicitudAlta; lineas: number }> {
  if (!texto(payload.worker_id)) throw new Error("Elige el trabajador antes de tramitar la solicitud.");
  if (!payload.lineas?.length) throw new Error("Marca al menos un trabajo antes de tramitar la solicitud.");
  const resultado = await rpcRrhh<{ solicitud_id?: string; codigo?: string; estado?: string; lineas?: number }>(
    "merchan_rrhh_solicitar_alta",
    { ...payload, lineas: payload.lineas },
    "No se pudo tramitar la solicitud de alta"
  );
  if (!resultado.solicitud_id || !resultado.codigo) {
    throw new Error("No se pudo tramitar la solicitud de alta: la base no devolvió el código de la solicitud.");
  }
  return {
    solicitud_id: String(resultado.solicitud_id),
    codigo: String(resultado.codigo),
    estado: (resultado.estado ?? "pendiente") as EstadoSolicitudAlta,
    lineas: numero(resultado.lineas) ?? 0
  };
}

/** Lo que RR.HH. decide sobre una solicitud (columnas «A3» y «Estado» del diseño). */
export type PayloadResolverAlta = {
  solicitud_id: string;
  /** Bloqueo optimista: la versión que se leyó en la tabla. */
  version?: number | null;
  /** Si falta, el estado no cambia (se usa para teclear solo el número de A3). */
  estado?: EstadoSolicitudAlta | null;
  /** Obligatorio en "rechazada" y "cancelada": nada se cierra en negativo sin explicación. */
  motivo?: string | null;
  a3_numero?: string | null;
  a3_canal?: CanalA3 | null;
  a3_estado?: string | null;
  a3_sync_event_id?: string | null;
  a3_last_error?: string | null;
  /** true = además crea el alta real en rrhh_altas a partir de la solicitud. */
  crear_alta?: boolean;
  /** Datos del alta a crear; lo que falte se hereda de la solicitud. */
  alta?: {
    numero_alta?: string | null;
    tipo?: TipoAlta | null;
    fecha_inicio?: string | null;
    fecha_fin?: string | null;
    ceco?: string | null;
    horas_dia?: number | null;
  };
  a3_empleado_codigo?: string | null;
};

/**
 * Resuelve una solicitud de alta: cambia el estado, teclea el número de A3 y,
 * si se pide, crea el alta real. La base exige motivo al rechazar o cancelar y
 * comprueba la transición contra el mismo mapa que `transicionesSolicitudAlta`.
 */
export async function resolverSolicitudAlta(payload: PayloadResolverAlta): Promise<void> {
  if (!texto(payload.solicitud_id)) throw new Error("Falta la solicitud que hay que resolver.");
  await rpcRrhh("merchan_rrhh_resolver_alta", { ...payload }, "No se pudo resolver la solicitud de alta");
}

// ===========================================================================
// SOLICITUDES DE ACCESO
// ===========================================================================

const COLUMNAS_SOLICITUD_ACCESO =
  "id,codigo,worker_id,worker_nombre,cadena_id,cadena_nombre,centro_id,centro_nombre,fecha_trabajo,fecha_limite," +
  "origen_tipo,origen_id,trabajo,estado,solicitada_por,solicitada_por_nombre,concedido_at,consumido_at,motivo," +
  "created_at,updated_at,version";

function mapSolicitudAcceso(fila: Record<string, unknown>): SolicitudAcceso {
  return {
    id: String(fila.id),
    codigo: String(fila.codigo ?? ""),
    worker_id: String(fila.worker_id ?? ""),
    worker_nombre: (fila.worker_nombre as string | null) ?? null,
    cadena_id: String(fila.cadena_id ?? ""),
    cadena_nombre: (fila.cadena_nombre as string | null) ?? null,
    centro_id: (fila.centro_id as string | null) ?? null,
    centro_nombre: (fila.centro_nombre as string | null) ?? null,
    fecha_trabajo: fecha(fila.fecha_trabajo),
    fecha_limite: fila.fecha_limite ? fecha(fila.fecha_limite) : null,
    origen_tipo: (fila.origen_tipo as OrigenTrabajoTipo | null) ?? null,
    origen_id: (fila.origen_id as string | null) ?? null,
    trabajo: (fila.trabajo as string | null) ?? null,
    estado: (fila.estado ?? "pendiente") as EstadoSolicitudAcceso,
    solicitada_por: (fila.solicitada_por as string | null) ?? null,
    solicitada_por_nombre: (fila.solicitada_por_nombre as string | null) ?? null,
    concedido_at: (fila.concedido_at as string | null) ?? null,
    consumido_at: (fila.consumido_at as string | null) ?? null,
    motivo: (fila.motivo as string | null) ?? null,
    created_at: String(fila.created_at ?? ""),
    updated_at: (fila.updated_at as string | null) ?? null,
    version: numero(fila.version) ?? 1
  };
}

/**
 * Tabla de accesos solicitados, de la más reciente a la más antigua. La RLS
 * decide qué se ve: RR.HH. y admin lo ven todo; la gestora, lo que pidió ella.
 */
export async function listarSolicitudesAcceso(filtros?: { workerId?: string; cadenaId?: string; limite?: number }): Promise<SolicitudAcceso[]> {
  const db = lectura();
  if (!db) return [];
  let consulta = db.from("rrhh_solicitudes_acceso").select(COLUMNAS_SOLICITUD_ACCESO);
  if (filtros?.workerId) consulta = consulta.eq("worker_id", filtros.workerId);
  if (filtros?.cadenaId) consulta = consulta.eq("cadena_id", filtros.cadenaId);
  const { data, error } = await consulta
    .order("created_at", { ascending: false })
    .limit(Math.max(1, filtros?.limite ?? LIMITE_POR_DEFECTO));
  if (error) throw new Error(`No se pudo cargar la tabla de accesos: ${error.message}`);
  // Mismo motivo que en listarSolicitudesAlta: `select` largo, fila sin inferir.
  return ((data ?? []) as unknown as Array<Record<string, unknown>>).map(mapSolicitudAcceso);
}

/** Lo que manda el botón «Solicitar» de la pantalla de accesos. */
export type PayloadSolicitarAcceso = {
  worker_id: string;
  worker_nombre?: string | null;
  cadena_id: string;
  /** ISO `YYYY-MM-DD`. De aquí sale la fecha límite: fecha_trabajo − lead_time_dias. */
  fecha_trabajo: string;
  /** Los chips marcados. Se ignoran si la cadena tramita por cadena (modo 'cadena'). */
  centros?: string[];
  origen_tipo?: OrigenTrabajoTipo | null;
  origen_id?: string | null;
  trabajo?: string | null;
};

/** Lo que devuelve la expansión por modo de trámite (una fila por acceso creado). */
export type ResultadoSolicitudesAcceso = {
  creadas: { id: string; codigo: string; centro_id: string | null }[];
  /** Centros que ya tenían una solicitud viva para ese día: no se duplican. */
  omitidas: { centro_id: string | null; motivo: string }[];
  modo_tramite: ModoTramiteCadena | null;
  lead_time_dias: number | null;
  fecha_limite: string | null;
  estado: EstadoSolicitudAcceso | null;
};

/**
 * Crea las solicitudes de acceso expandiendo según `cadenas.modo_tramite`:
 * "centro" → una solicitud por centro marcado; "cadena" → una sola con
 * `centro_id` NULL ("toda la cadena"). La fecha límite y el estado
 * "fuera_de_plazo" los calcula la base, nunca la pantalla.
 */
export async function crearSolicitudesAcceso(payload: PayloadSolicitarAcceso): Promise<ResultadoSolicitudesAcceso> {
  if (!texto(payload.worker_id)) throw new Error("Elige el trabajador antes de solicitar el acceso.");
  if (!texto(payload.cadena_id)) throw new Error("Elige la cadena antes de solicitar el acceso.");
  if (!texto(payload.fecha_trabajo)) throw new Error("Indica la fecha de trabajo antes de solicitar el acceso.");

  const resultado = await rpcRrhh<{
    creadas?: Array<{ id?: string; codigo?: string; centro_id?: string | null }>;
    omitidas?: Array<{ centro_id?: string | null; motivo?: string }>;
    modo_tramite?: string;
    lead_time_dias?: number;
    fecha_limite?: string | null;
    estado?: string;
  }>("merchan_rrhh_solicitar_acceso", { ...payload, centros: payload.centros ?? [] }, "No se pudo solicitar el acceso");

  return {
    creadas: (resultado.creadas ?? []).map(fila => ({
      id: String(fila.id ?? ""),
      codigo: String(fila.codigo ?? ""),
      centro_id: fila.centro_id ?? null
    })),
    omitidas: (resultado.omitidas ?? []).map(fila => ({
      centro_id: fila.centro_id ?? null,
      motivo: String(fila.motivo ?? "")
    })),
    modo_tramite: (resultado.modo_tramite as ModoTramiteCadena | undefined) ?? null,
    lead_time_dias: numero(resultado.lead_time_dias),
    fecha_limite: resultado.fecha_limite ? fecha(resultado.fecha_limite) : null,
    estado: (resultado.estado as EstadoSolicitudAcceso | undefined) ?? null
  };
}

/** Lo que RR.HH. decide sobre un acceso (columna «Estado» del diseño). */
export type PayloadResolverAcceso = {
  acceso_id: string;
  /** Bloqueo optimista: la versión que se leyó en la tabla. */
  version?: number | null;
  estado?: EstadoSolicitudAcceso | null;
  /** Obligatorio en "denegado" y "cancelado". */
  motivo?: string | null;
  /** true = el trabajador llegó a usar el acceso (sella consumido_at). */
  consumido?: boolean;
};

/**
 * Concede, deniega, cancela o marca como no consumido un acceso. La base exige
 * motivo en negativo y valida la transición contra `transicionesSolicitudAcceso`.
 */
export async function resolverSolicitudAcceso(payload: PayloadResolverAcceso): Promise<void> {
  if (!texto(payload.acceso_id)) throw new Error("Falta el acceso que hay que resolver.");
  await rpcRrhh("merchan_rrhh_resolver_acceso", { ...payload }, "No se pudo resolver el acceso");
}

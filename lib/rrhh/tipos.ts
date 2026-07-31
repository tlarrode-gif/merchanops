/**
 * MerchanOps · Módulo de RR.HH. — vocabulario común.
 *
 * Este fichero es la ÚNICA fuente de verdad de tipos y estados del módulo: la
 * lógica pura (lib/rrhh/*.ts), las pantallas (app/rrhh/*) y los CHECK de la base
 * (supabase/v10_5, v10_6) dicen exactamente lo mismo. Si aquí se añade un estado,
 * hay que añadirlo también al CHECK de la migración correspondiente.
 *
 * Decisiones de diseño (docs/ROADMAP_RRHH.md):
 *  - MerchanOps NO guarda datos personales del trabajador (DNI, NAF, IBAN,
 *    fecha de nacimiento, domicilio): esos viven en A3 y solo en A3. Aquí se
 *    guardan nombre, fechas, CECO, horas y el número de alta que A3 devuelve.
 *  - La columna "A3" y la columna "Estado" las rellena RR.HH. a mano. Todo lo
 *    demás lo calcula el sistema (es el "texto gris" de la leyenda del diseño).
 */

/** De dónde nace un trabajo pendiente de alta. Polimórfico como logistics_requests.source_type. */
export type OrigenTrabajoTipo = "campana" | "campana_punto" | "servicio";

export const origenTrabajoLabels: Record<OrigenTrabajoTipo, string> = {
  campana: "Gran campaña",
  campana_punto: "Punto de campaña",
  servicio: "Servicio"
};

/**
 * Un trabajo asignado a un trabajador que todavía no está respaldado por un alta.
 * Se construye en memoria a partir de grandes_campanas / puntos_venta_campana /
 * services: no hay tabla propia, porque la verdad de la asignación vive allí.
 */
export type TrabajoPendiente = {
  origen_tipo: OrigenTrabajoTipo;
  origen_id: string;
  worker_id: string;
  campana: string;
  ceco: string;
  /** ISO YYYY-MM-DD. */
  fecha_inicio: string;
  /** ISO YYYY-MM-DD. */
  fecha_fin: string;
  horas_dia: number | null;
  provincia?: string | null;
};

/** Tipo de contrato de un alta real en A3. */
export type TipoAlta = "temporal" | "indefinido" | "fijo_discontinuo";

export const tipoAltaLabels: Record<TipoAlta, string> = {
  temporal: "Temporal",
  indefinido: "Indefinido",
  fijo_discontinuo: "Fijo discontinuo"
};

export type EstadoAlta = "vigente" | "ampliada" | "baja_pendiente" | "baja" | "anulada";

/** Un alta laboral REAL, tal y como está en A3. Es contra esto que se calcula la cobertura. */
export type AltaLaboral = {
  id: string;
  worker_id: string;
  /** El "18832" del diseño. Null mientras RR.HH. no lo haya tecleado. */
  numero_alta: string | null;
  tipo: TipoAlta;
  fecha_inicio: string;
  /** null = alta abierta (indefinida o sin fecha de fin conocida). */
  fecha_fin: string | null;
  ceco: string | null;
  horas_dia: number | null;
  estado: EstadoAlta;
  /** Versión de la fila, para el bloqueo optimista al ampliar el alta. */
  version?: number | null;
};

/**
 * Lo que CALCULA el sistema al marcar unos trabajos (el texto gris del diseño).
 * Nunca lo teclea nadie: se recalcula siempre a partir de rrhh_altas.
 */
export type ResolucionAlta = "alta_nueva" | "cubierta" | "solape";

export const resolucionAltaLabels: Record<ResolucionAlta, string> = {
  alta_nueva: "Alta nueva",
  cubierta: "Cubierto por un alta vigente",
  solape: "Se solapa con un alta vigente"
};

/**
 * Estado de la solicitud. Lo rellena RR.HH. (columna con fondo del diseño).
 * Los tres primeros valores los propone el sistema según la resolución; el resto
 * son decisiones humanas de RR.HH.
 */
export type EstadoSolicitudAlta =
  | "pendiente"
  | "se_solapa"
  | "ya_alta_indefinida"
  | "solo_imputacion"
  | "tramitada"
  | "alta_online"
  | "baja_pendiente"
  | "rechazada"
  | "cancelada";

export const estadoSolicitudAltaLabels: Record<EstadoSolicitudAlta, string> = {
  pendiente: "Pendiente",
  se_solapa: "Se solapa",
  ya_alta_indefinida: "Ya de alta indef.",
  solo_imputacion: "Solo imputación",
  tramitada: "Tramitada",
  alta_online: "Alta online",
  baja_pendiente: "Baja pendiente",
  rechazada: "Rechazada",
  cancelada: "Cancelada"
};

/** Clases del badge de estado. Misma paleta que Pagos y Logística. */
export const estadoSolicitudAltaClases: Record<EstadoSolicitudAlta, string> = {
  pendiente: "bg-slate-100 text-slate-600",
  se_solapa: "bg-amber-50 text-amber-700",
  ya_alta_indefinida: "bg-sky-50 text-sky-700",
  solo_imputacion: "bg-sky-50 text-sky-700",
  tramitada: "bg-emerald-50 text-emerald-700",
  alta_online: "bg-emerald-50 text-emerald-700",
  baja_pendiente: "bg-amber-50 text-amber-700",
  rechazada: "bg-red-50 text-red-700",
  cancelada: "bg-slate-100 text-slate-500"
};

/** Estados en los que la solicitud sigue viva y RR.HH. tiene que actuar. */
export const estadosSolicitudAltaAbiertos: EstadoSolicitudAlta[] = [
  "pendiente",
  "se_solapa",
  "ya_alta_indefinida",
  "solo_imputacion",
  "baja_pendiente"
];

/**
 * Transiciones permitidas. Espejo del trigger guardián de la base
 * (merchan_rrhh_guard_solicitud_alta): la UI propone, la base decide.
 */
export const transicionesSolicitudAlta: Record<EstadoSolicitudAlta, EstadoSolicitudAlta[]> = {
  pendiente: ["tramitada", "alta_online", "se_solapa", "ya_alta_indefinida", "solo_imputacion", "rechazada", "cancelada"],
  se_solapa: ["tramitada", "alta_online", "solo_imputacion", "rechazada", "cancelada"],
  ya_alta_indefinida: ["solo_imputacion", "tramitada", "rechazada", "cancelada"],
  solo_imputacion: ["tramitada", "rechazada", "cancelada"],
  tramitada: ["baja_pendiente", "cancelada"],
  alta_online: ["tramitada", "baja_pendiente", "cancelada"],
  baja_pendiente: ["tramitada", "cancelada"],
  rechazada: [],
  cancelada: []
};

/** Estados que exigen motivo escrito: nada se cierra en negativo sin explicación. */
export const estadosSolicitudAltaConMotivo: EstadoSolicitudAlta[] = ["rechazada", "cancelada"];

/**
 * Cómo tramita los accesos una cadena:
 *  - "centro": cada centro necesita su propia solicitud (5 centros = 5 accesos).
 *  - "cadena": una sola solicitud vale para toda la cadena (5 centros = 1 acceso).
 */
export type ModoTramiteCadena = "centro" | "cadena";

export const modoTramiteLabels: Record<ModoTramiteCadena, string> = {
  centro: "Por centro",
  cadena: "Por cadena"
};

export type Cadena = {
  id: string;
  nombre: string;
  modo_tramite: ModoTramiteCadena;
  /** Días de antelación con los que la cadena exige la solicitud. 0 = sin plazo. */
  lead_time_dias: number;
  contacto?: string | null;
  email?: string | null;
  instrucciones?: string | null;
  activa: boolean;
};

export type Centro = {
  id: string;
  cadena_id: string;
  codigo?: string | null;
  nombre: string;
  direccion?: string | null;
  poblacion?: string | null;
  provincia?: string | null;
  codigo_postal?: string | null;
  activo: boolean;
};

export type EstadoSolicitudAcceso =
  | "solicitado"
  | "pendiente"
  | "fuera_de_plazo"
  | "concedido"
  | "concedido_no_consumido"
  | "denegado"
  | "cancelado";

export const estadoSolicitudAccesoLabels: Record<EstadoSolicitudAcceso, string> = {
  solicitado: "Solicitado",
  pendiente: "Pendiente",
  fuera_de_plazo: "Fuera de plazo",
  concedido: "Concedido",
  concedido_no_consumido: "Concedido no consumido",
  denegado: "Denegado",
  cancelado: "Cancelado"
};

export const estadoSolicitudAccesoClases: Record<EstadoSolicitudAcceso, string> = {
  solicitado: "bg-sky-50 text-sky-700",
  pendiente: "bg-slate-100 text-slate-600",
  fuera_de_plazo: "bg-red-50 text-red-700",
  concedido: "bg-emerald-50 text-emerald-700",
  concedido_no_consumido: "bg-amber-50 text-amber-700",
  denegado: "bg-red-50 text-red-700",
  cancelado: "bg-slate-100 text-slate-500"
};

export const transicionesSolicitudAcceso: Record<EstadoSolicitudAcceso, EstadoSolicitudAcceso[]> = {
  pendiente: ["solicitado", "concedido", "denegado", "cancelado"],
  solicitado: ["concedido", "denegado", "cancelado"],
  fuera_de_plazo: ["solicitado", "concedido", "denegado", "cancelado"],
  concedido: ["concedido_no_consumido", "cancelado"],
  concedido_no_consumido: ["concedido", "cancelado"],
  denegado: [],
  cancelado: []
};

export const estadosSolicitudAccesoConMotivo: EstadoSolicitudAcceso[] = ["denegado", "cancelado"];

/** Canal por el que ha viajado el alta a A3. Hoy siempre "manual". */
export type CanalA3 = "manual" | "api";

export const canalA3Labels: Record<CanalA3, string> = {
  manual: "Manual",
  api: "API A3"
};

/** Cabecera de una solicitud de alta, tal y como llega de la base. */
export type SolicitudAlta = {
  id: string;
  codigo: string;
  worker_id: string;
  worker_nombre: string | null;
  fecha_inicio: string | null;
  fecha_fin: string | null;
  horas_dia: number | null;
  resolucion_sistema: ResolucionAlta | null;
  resolucion_detalle: string | null;
  alta_referencia_id: string | null;
  alta_referencia_numero: string | null;
  estado: EstadoSolicitudAlta;
  a3_numero: string | null;
  a3_canal: CanalA3;
  a3_estado: string | null;
  a3_last_sync_at: string | null;
  a3_last_error: string | null;
  alta_id: string | null;
  solicitada_por: string | null;
  solicitada_por_nombre: string | null;
  motivo: string | null;
  created_at: string;
  updated_at: string | null;
  version: number;
  lineas?: LineaSolicitudAlta[];
};

/** Cada imputación a un CECO dentro de una solicitud. */
export type LineaSolicitudAlta = {
  id: string;
  solicitud_id: string;
  origen_tipo: OrigenTrabajoTipo;
  origen_id: string;
  campana: string;
  ceco: string;
  fecha_inicio: string;
  fecha_fin: string;
  horas_dia: number | null;
};

export type SolicitudAcceso = {
  id: string;
  codigo: string;
  worker_id: string;
  worker_nombre: string | null;
  cadena_id: string;
  cadena_nombre: string | null;
  /** null = la solicitud vale para toda la cadena (modo_tramite = "cadena"). */
  centro_id: string | null;
  centro_nombre: string | null;
  fecha_trabajo: string;
  fecha_limite: string | null;
  origen_tipo: OrigenTrabajoTipo | null;
  origen_id: string | null;
  trabajo: string | null;
  estado: EstadoSolicitudAcceso;
  solicitada_por: string | null;
  solicitada_por_nombre: string | null;
  concedido_at: string | null;
  consumido_at: string | null;
  motivo: string | null;
  created_at: string;
  updated_at: string | null;
  version: number;
};

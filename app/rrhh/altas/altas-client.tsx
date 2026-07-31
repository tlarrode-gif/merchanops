"use client";

/**
 * MerchanOps · RR.HH. — Altas laborales.
 *
 * QUÉ RESUELVE
 * La gestora elige un trabajador, marca los trabajos que van juntos y el sistema
 * dice —en gris, sin que nadie teclee nada— si hace falta un alta nueva, si el
 * rango ya está cubierto por un alta vigente o si hay que ampliar una existente.
 * «Tramitar» convierte esa lectura en una solicitud con sus líneas de imputación.
 *
 * QUIÉN PUEDE QUÉ
 *  - Cualquiera con permiso `rrhh` (los gestores lo tienen por defecto) SOLICITA.
 *  - Solo RR.HH. o administración RESUELVE: teclear el número de A3 y mover el
 *    estado (`canManageRrhh`). Es la leyenda del diseño: el texto gris lo calcula
 *    el sistema, «A3» y «Estado» los rellena RR.HH.
 * Esta pantalla no es la frontera: la de verdad es la RLS y el gate
 * `merchan_is_rrhh()` de los RPC. Aquí solo se evita ofrecer lo que va a fallar.
 *
 * NADA SE TECLEA DOS VECES
 * `resolucion_sistema`, `resolucion_detalle`, fechas y CECOs salen íntegros de
 * `lib/rrhh/altas.ts`. Si el cálculo cambia, cambia la pantalla sola.
 *
 * EL CICLO SE CIERRA
 * Mover una solicitud a «Tramitada» o «Alta online» abre el modal «Tramitar en
 * A3»: además del número de A3 y el estado, ahí se decide si el alta REAL queda
 * registrada en `rrhh_altas` (o si se amplía la que ya existía). Ese paso es el
 * que hace que el sistema aprenda: sin él, los próximos trabajos del mismo
 * trabajador volverían a calcularse como «Alta nueva» aunque el alta ya esté
 * hecha en A3, y la pantalla no serviría para nada.
 *
 * CONCURRENCIA
 * Cada resolución envía el `version` que se leyó. Si otra persona tocó la
 * solicitud entretanto, el RPC la rechaza en vez de pisarla: aquí se enseña el
 * mensaje real y se recarga la cola.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { RefreshCw, Search, Send } from "lucide-react";
import { AppSession, canAccessModule, canManageRrhh, getCurrentAppSession, merchanopsSessionChangeEvent } from "@/lib/access-control";
import {
  AltaLaboral,
  EstadoSolicitudAlta,
  LineaSolicitudAlta,
  ResolucionAlta,
  SolicitudAlta,
  TipoAlta,
  TrabajoPendiente,
  estadoSolicitudAltaClases,
  estadoSolicitudAltaLabels,
  tipoAltaLabels
} from "@/lib/rrhh/tipos";
import { estadoSugerido, exigeMotivo, formateaFechaCorta, puedeTransicionar, rangoDeTrabajos, textoResolucion } from "@/lib/rrhh/altas";
import {
  PayloadResolverAlta,
  PayloadSolicitarAlta,
  crearSolicitudAlta,
  listarAltas,
  listarSolicitudesAlta,
  listarTrabajadores,
  registrarAlta,
  resolverSolicitudAlta,
  trabajosPendientesDeAlta
} from "@/lib/rrhh/datos";

/** Lo que devuelve `listarTrabajadores()`. */
type FilaTrabajador = Awaited<ReturnType<typeof listarTrabajadores>>[number];

/** Los cuatro únicos estados de nacimiento que acepta `merchan_rrhh_solicitar_alta`. */
type EstadoInicialAlta = NonNullable<PayloadSolicitarAlta["estado"]>;

const ESTADOS_INICIALES: EstadoSolicitudAlta[] = ["pendiente", "se_solapa", "ya_alta_indefinida", "solo_imputacion"];

/** ¿Es uno de los cuatro estados con los que una solicitud puede nacer? */
function esEstadoInicial(estado: EstadoSolicitudAlta): estado is EstadoInicialAlta {
  return ESTADOS_INICIALES.includes(estado);
}

/**
 * El estado con el que nace la solicitud NO se elige: es exactamente el que
 * propone `estadoSugerido()` a partir de la resolución calculada, `solo_imputacion`
 * incluido. Una cobertura no significa siempre lo mismo: si el alta que tapa el
 * periodo es INDEFINIDA la fila es «Ya de alta indef.»; si es temporal o fija
 * discontinua, el trabajo solo necesita la imputación al CECO («Solo imputación»).
 * Son dos filas distintas del diseño, así que reconducir la segunda a la primera
 * etiquetaría como fijo a quien solo tiene un alta temporal. La base dice lo mismo
 * desde v10_6: acepta los cuatro estados y deriva ese caso del tipo del alta
 * referenciada. El `if` de abajo es solo la red de tipos: hoy `estadoSugerido()`
 * no devuelve ningún otro estado, y si algún día lo hiciera preferimos romper con
 * un mensaje legible antes que colar en la cola una etiqueta que no toca.
 */
function estadoInicial(resolucion: ResolucionAlta, alta: AltaLaboral | null): EstadoInicialAlta {
  const sugerido = estadoSugerido(resolucion, alta);
  if (!esEstadoInicial(sugerido)) {
    throw new Error(`El cálculo propuso el estado «${sugerido}», que no es un estado con el que una solicitud pueda nacer.`);
  }
  return sugerido;
}

const TODOS_LOS_ESTADOS = Object.keys(estadoSolicitudAltaLabels) as EstadoSolicitudAlta[];

/** Cómo se pinta el texto calculado según lo que diga `textoResolucion`. */
const CLASE_TONO: Record<"neutro" | "aviso" | "vacio", string> = {
  neutro: "text-slate-500",
  aviso: "text-amber-700",
  vacio: "text-slate-400"
};

/** Los estados que significan «esto ya está hecho en A3»: abren el modal de trámite. */
const ESTADOS_TRAMITE: EstadoSolicitudAlta[] = ["tramitada", "alta_online"];

/** Los tres tipos de contrato del desplegable, en el orden del CHECK de la base. */
const TIPOS_ALTA = Object.keys(tipoAltaLabels) as TipoAlta[];

/**
 * Qué puede hacer el trámite con `rrhh_altas`, según lo que calculó el sistema:
 *  - "crear":   no hay alta detrás (resolución «Alta nueva» o sin resolución guardada).
 *  - "ampliar": la resolución fue «Se solapa» y hay un alta a la que estirar la fecha de fin.
 *  - "ninguno": ya hay un alta que cubre esto (o la solicitud ya tiene la suya):
 *               crear otra sería duplicar justo lo que este módulo evita.
 */
type ModoTramite = "crear" | "ampliar" | "ninguno";

function modoDeTramite(solicitud: SolicitudAlta): ModoTramite {
  if (solicitud.alta_id) return "ninguno";
  if (solicitud.resolucion_sistema === "solape") return solicitud.alta_referencia_id ? "ampliar" : "ninguno";
  if (solicitud.resolucion_sistema === "cubierta") return "ninguno";
  return "crear";
}

/** Lo que RR.HH. teclea en el modal «Tramitar en A3» antes de confirmar. */
type BorradorTramite = {
  solicitud: SolicitudAlta;
  destino: EstadoSolicitudAlta;
  modo: ModoTramite;
  /** La decisión de arriba del modal: ¿aprende el sistema de este trámite? */
  registrar: boolean;
  numero: string;
  tipo: TipoAlta;
  fecha_inicio: string;
  fecha_fin: string;
  ceco: string;
  horas: string;
  empleado: string;
};

/**
 * Todo prerrellenado con lo que ya sabe la solicitud: RR.HH. teclea el número de
 * A3 y, como mucho, corrige. La casilla nace marcada siempre que haya algo que
 * registrar, porque no registrar el alta es la excepción, no lo normal.
 */
function borradorTramite(solicitud: SolicitudAlta, destino: EstadoSolicitudAlta): BorradorTramite {
  const modo = modoDeTramite(solicitud);
  return {
    solicitud,
    destino,
    modo,
    registrar: modo !== "ninguno",
    numero: String(solicitud.a3_numero ?? "").trim(),
    tipo: "temporal",
    fecha_inicio: solicitud.fecha_inicio ?? "",
    fecha_fin: solicitud.fecha_fin ?? "",
    ceco: primerCeco(solicitud),
    horas: typeof solicitud.horas_dia === "number" ? String(solicitud.horas_dia) : "",
    empleado: ""
  };
}

export function AltasClient() {
  const [session, setSession] = useState<AppSession | null>(null);

  // Tarjeta de trabajo
  const [trabajadores, setTrabajadores] = useState<FilaTrabajador[]>([]);
  const [workerId, setWorkerId] = useState("");
  const [pendientes, setPendientes] = useState<TrabajoPendiente[]>([]);
  const [altas, setAltas] = useState<AltaLaboral[]>([]);
  const [seleccion, setSeleccion] = useState<string[]>([]);
  const [cargandoTrabajador, setCargandoTrabajador] = useState(false);
  const [tramitando, setTramitando] = useState(false);

  // Cola de altas
  const [solicitudes, setSolicitudes] = useState<SolicitudAlta[]>([]);
  const [cargandoCola, setCargandoCola] = useState(true);
  const [consulta, setConsulta] = useState("");
  const [filtroEstado, setFiltroEstado] = useState<EstadoSolicitudAlta | "">("");
  const [a3Borrador, setA3Borrador] = useState<Record<string, string>>({});
  const [guardandoId, setGuardandoId] = useState("");

  // Avisos
  const [error, setError] = useState("");
  const [aviso, setAviso] = useState("");

  // Modal de motivo (nada se cierra en negativo sin explicación escrita).
  const [peticionMotivo, setPeticionMotivo] = useState<{ solicitud: SolicitudAlta; destino: EstadoSolicitudAlta } | null>(null);
  const [motivo, setMotivo] = useState("");
  const [errorMotivo, setErrorMotivo] = useState("");

  // Modal «Tramitar en A3»: número de A3, estado y —lo importante— el alta real.
  const [peticionTramite, setPeticionTramite] = useState<BorradorTramite | null>(null);
  const [errorTramite, setErrorTramite] = useState("");

  // La sesión se lee en un efecto, nunca en el render inicial: el servidor no
  // tiene localStorage y leerlo antes de montar rompe la hidratación.
  useEffect(() => {
    const sincroniza = () => setSession(getCurrentAppSession());
    sincroniza();
    window.addEventListener(merchanopsSessionChangeEvent, sincroniza);
    window.addEventListener("storage", sincroniza);
    return () => {
      window.removeEventListener(merchanopsSessionChangeEvent, sincroniza);
      window.removeEventListener("storage", sincroniza);
    };
  }, []);

  const cargarCola = useCallback(async () => {
    setCargandoCola(true);
    try {
      setSolicitudes(await listarSolicitudesAlta());
      setError("");
    } catch (err) {
      setSolicitudes([]);
      setError(`No se pudo cargar la cola de altas: ${mensaje(err)}`);
    } finally {
      setCargandoCola(false);
    }
  }, []);

  const cargarTrabajadores = useCallback(async () => {
    try {
      setTrabajadores(await listarTrabajadores());
    } catch (err) {
      setTrabajadores([]);
      setError(`No se pudo cargar la lista de trabajadores: ${mensaje(err)}`);
    }
  }, []);

  const activa = Boolean(session?.active);

  useEffect(() => {
    if (!activa) return;
    void cargarTrabajadores();
    void cargarCola();
  }, [activa, cargarTrabajadores, cargarCola]);

  // Trabajos pendientes y altas reales del trabajador elegido. Se cancela la
  // respuesta vieja si el usuario cambia de trabajador antes de que llegue.
  useEffect(() => {
    if (!workerId) {
      setPendientes([]);
      setAltas([]);
      setSeleccion([]);
      return;
    }
    let cancelado = false;
    setCargandoTrabajador(true);
    setSeleccion([]);
    (async () => {
      try {
        const [trabajos, altasTrabajador] = await Promise.all([trabajosPendientesDeAlta(workerId), listarAltas(workerId)]);
        if (cancelado) return;
        setPendientes(trabajos);
        setAltas(altasTrabajador);
        setError("");
      } catch (err) {
        if (cancelado) return;
        setPendientes([]);
        setAltas([]);
        setError(`No se pudieron cargar los trabajos del trabajador: ${mensaje(err)}`);
      } finally {
        if (!cancelado) setCargandoTrabajador(false);
      }
    })();
    return () => {
      cancelado = true;
    };
  }, [workerId]);

  const trabajadorElegido = useMemo(() => trabajadores.find(fila => fila.id === workerId), [trabajadores, workerId]);
  const nombreTrabajador = trabajadorElegido?.name?.trim() || "";

  const marcados = useMemo(() => pendientes.filter(trabajo => seleccion.includes(claveTrabajo(trabajo))), [pendientes, seleccion]);
  const resolucion = useMemo(() => textoResolucion(marcados, altas), [marcados, altas]);

  const cola = useMemo(() => {
    const aguja = consulta.trim().toLowerCase();
    return solicitudes.filter(solicitud => {
      if (filtroEstado && solicitud.estado !== filtroEstado) return false;
      if (!aguja) return true;
      const heno = [
        solicitud.codigo,
        solicitud.worker_nombre,
        solicitud.a3_numero,
        solicitud.solicitada_por_nombre,
        ...(solicitud.lineas || []).flatMap(linea => [linea.campana, linea.ceco])
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return heno.includes(aguja);
    });
  }, [solicitudes, filtroEstado, consulta]);

  function alternar(trabajo: TrabajoPendiente) {
    const clave = claveTrabajo(trabajo);
    setSeleccion(previa => (previa.includes(clave) ? previa.filter(x => x !== clave) : [...previa, clave]));
  }

  async function tramitar() {
    if (!marcados.length || !workerId) return;
    const rango = rangoDeTrabajos(marcados);
    if (!resolucion.resolucion || !rango) {
      setError("Los trabajos seleccionados no tienen fechas válidas: no se puede calcular el alta.");
      return;
    }
    setTramitando(true);
    setError("");
    setAviso("");
    try {
      const payload: PayloadSolicitarAlta = {
        worker_id: workerId,
        worker_nombre: nombreTrabajador || null,
        resolucion_sistema: resolucion.resolucion,
        resolucion_detalle: resolucion.texto,
        alta_referencia_id: resolucion.alta?.id ?? null,
        alta_referencia_numero: resolucion.alta?.numero_alta ?? null,
        estado: estadoInicial(resolucion.resolucion, resolucion.alta),
        fecha_inicio: rango.inicio,
        fecha_fin: rango.fin,
        horas_dia: horasDeLaSeleccion(marcados),
        solicitada_por_nombre: session?.display_name || null,
        lineas: marcados.map(trabajo => ({
          origen_tipo: trabajo.origen_tipo,
          origen_id: trabajo.origen_id,
          campana: trabajo.campana,
          ceco: trabajo.ceco,
          fecha_inicio: trabajo.fecha_inicio,
          fecha_fin: trabajo.fecha_fin,
          horas_dia: trabajo.horas_dia ?? null
        }))
      };
      const creada = await crearSolicitudAlta(payload);
      setAviso(`Solicitud ${creada.codigo} creada.`);
      setSeleccion([]);
      // Los trabajos ya solicitados dejan de estar pendientes: se relee todo.
      const [trabajos, altasTrabajador] = await Promise.all([trabajosPendientesDeAlta(workerId), listarAltas(workerId)]);
      setPendientes(trabajos);
      setAltas(altasTrabajador);
      await cargarCola();
    } catch (err) {
      setError(`No se pudo tramitar la solicitud: ${mensaje(err)}`);
    } finally {
      setTramitando(false);
    }
  }

  async function guardarA3(solicitud: SolicitudAlta, valor: string) {
    const limpio = valor.trim();
    const actual = String(solicitud.a3_numero ?? "").trim();
    if (limpio === actual) {
      olvidarBorrador(solicitud.id);
      return;
    }
    setGuardandoId(solicitud.id);
    setError("");
    setAviso("");
    try {
      // Sin `estado`: teclear el número de A3 no mueve la solicitud de sitio.
      const payload: PayloadResolverAlta = { solicitud_id: solicitud.id, a3_numero: limpio || null, version: solicitud.version };
      await resolverSolicitudAlta(payload);
      setAviso(`Número de A3 guardado en ${solicitud.codigo}.`);
      // Primero la relectura y después el borrador: si se suelta antes, la celda
      // parpadea con el valor viejo mientras llega la respuesta.
      await cargarCola();
      olvidarBorrador(solicitud.id);
    } catch (err) {
      // El borrador se conserva: lo tecleado no se pierde porque el guardado falle.
      setError(`No se pudo guardar el número de A3 de ${solicitud.codigo}: ${mensaje(err)}`);
    } finally {
      setGuardandoId("");
    }
  }

  function olvidarBorrador(id: string) {
    setA3Borrador(previo => {
      if (!(id in previo)) return previo;
      const siguiente = { ...previo };
      delete siguiente[id];
      return siguiente;
    });
  }

  function pedirCambioEstado(solicitud: SolicitudAlta, destino: EstadoSolicitudAlta) {
    if (destino === solicitud.estado) return;
    if (!puedeTransicionar(solicitud.estado, destino)) {
      setError(`${solicitud.codigo} no puede pasar de «${estadoSolicitudAltaLabels[solicitud.estado]}» a «${estadoSolicitudAltaLabels[destino]}».`);
      return;
    }
    if (exigeMotivo(destino)) {
      setMotivo("");
      setErrorMotivo("");
      setPeticionMotivo({ solicitud, destino });
      return;
    }
    // «Tramitada» y «Alta online» dicen que el alta ya existe en A3: se pregunta
    // por su número y por si hay que registrarla (o ampliarla) en MerchanOps.
    if (ESTADOS_TRAMITE.includes(destino)) {
      setErrorTramite("");
      setPeticionTramite(borradorTramite(solicitud, destino));
      return;
    }
    void aplicarEstado(solicitud, destino);
  }

  /** Cambia un campo del borrador del modal sin perder el resto. */
  function cambiaTramite(cambio: Partial<BorradorTramite>) {
    setPeticionTramite(previo => (previo ? { ...previo, ...cambio } : previo));
  }

  function cerrarTramite() {
    setPeticionTramite(null);
    setErrorTramite("");
  }

  /**
   * Relee las altas del trabajador que se acaba de tramitar, pero solo si es el
   * que hay elegido arriba: es lo que hace que el texto gris deje de decir «Alta
   * nueva» en cuanto el alta existe. Si la relectura falla se dice, sin tapar el
   * hecho de que el trámite sí se guardó.
   */
  async function recargarAltasDe(idTrabajador: string) {
    if (!workerId || workerId !== idTrabajador) return;
    try {
      setAltas(await listarAltas(workerId));
    } catch (err) {
      setError(`El trámite se guardó, pero no se pudieron releer las altas del trabajador: ${mensaje(err)}`);
    }
  }

  /**
   * Confirma el modal «Tramitar en A3». Según la decisión de arriba:
   *  - "crear":   una sola llamada, `resolverSolicitudAlta` con `crear_alta`, que
   *               es transaccional en la base (o se mueve el estado y nace el alta, o nada).
   *  - "ampliar": PRIMERO se estira el alta existente y solo después se mueve el
   *               estado. Si la ampliación falla se para aquí: dejar la solicitud
   *               como «Tramitada» sobre un alta que sigue acabando antes sería la
   *               misma mentira que este módulo existe para evitar.
   *  - "ninguno": solo número de A3 y estado, que es lo que había antes.
   */
  async function confirmarTramite() {
    if (!peticionTramite) return;
    const borrador = peticionTramite;
    const { solicitud, destino, modo } = borrador;

    const numero = borrador.numero.trim();
    if (!numero) {
      setErrorTramite("El número de alta en A3 es obligatorio: es lo que ata esta solicitud con lo que se ha tramitado en A3.");
      return;
    }
    const registrar = modo !== "ninguno" && borrador.registrar;
    if (registrar && modo === "crear" && !borrador.fecha_inicio) {
      setErrorTramite("Para registrar el alta hace falta su fecha de inicio.");
      return;
    }
    if (registrar && borrador.fecha_fin && borrador.fecha_inicio && borrador.fecha_fin < borrador.fecha_inicio) {
      setErrorTramite("El alta está del revés: la fecha de fin es anterior a la de inicio.");
      return;
    }
    const empleado = borrador.empleado.trim() || null;

    cerrarTramite();
    setGuardandoId(solicitud.id);
    setError("");
    setAviso("");
    try {
      if (registrar && modo === "ampliar") {
        try {
          await registrarAlta({
            alta_id: solicitud.alta_referencia_id,
            numero_alta: numero,
            fecha_fin: borrador.fecha_fin || null,
            // Ampliar es extender: si el alta ya llegaba más lejos que este
            // trabajo, la base conserva su fecha de fin en vez de recortarla.
            ampliar: true,
            estado: "ampliada"
          });
        } catch (err) {
          setError(
            `No se pudo ampliar el alta ${numeroAltaReferencia(solicitud)} de ${solicitud.codigo}: ${mensaje(err)}. ` +
              `El estado de la solicitud NO se ha cambiado.`
          );
          return;
        }
      }

      const payload: PayloadResolverAlta = {
        solicitud_id: solicitud.id,
        estado: destino,
        a3_numero: numero,
        a3_empleado_codigo: empleado,
        version: solicitud.version
      };
      if (registrar && modo === "crear") {
        payload.crear_alta = true;
        payload.alta = {
          numero_alta: numero,
          tipo: borrador.tipo,
          fecha_inicio: borrador.fecha_inicio || null,
          // OJO: aquí "vacío" NO abre el alta. Al CREAR, merchan_rrhh_resolver_alta
          // hace coalesce con la fecha de fin de la solicitud, así que un fin vacío
          // hereda la de la solicitud. Solo al AMPLIAR (merchan_rrhh_registrar_alta)
          // un fin vacío deja el alta abierta. El texto de ayuda del campo dice en
          // cada caso lo que va a pasar de verdad.
          fecha_fin: borrador.fecha_fin || null,
          ceco: borrador.ceco.trim() || null,
          horas_dia: horasONulo(borrador.horas)
        };
      }
      await resolverSolicitudAlta(payload);

      setAviso(
        registrar
          ? `${solicitud.codigo} pasa a «${estadoSolicitudAltaLabels[destino]}» y ${
              modo === "ampliar" ? `el alta ${numeroAltaReferencia(solicitud)} queda ampliada` : `el alta ${numero} queda registrada`
            } en MerchanOps.`
          : `${solicitud.codigo} pasa a «${estadoSolicitudAltaLabels[destino]}». No se ha registrado ningún alta.`
      );
      await cargarCola();
      await recargarAltasDe(solicitud.worker_id);
    } catch (err) {
      setError(`No se pudo tramitar ${solicitud.codigo}: ${mensaje(err)}`);
      await cargarCola();
    } finally {
      setGuardandoId("");
    }
  }

  async function aplicarEstado(solicitud: SolicitudAlta, destino: EstadoSolicitudAlta, motivoEscrito?: string) {
    setGuardandoId(solicitud.id);
    setError("");
    setAviso("");
    try {
      const payload: PayloadResolverAlta = {
        solicitud_id: solicitud.id,
        estado: destino,
        motivo: motivoEscrito?.trim() || null,
        version: solicitud.version
      };
      await resolverSolicitudAlta(payload);
      setAviso(`${solicitud.codigo} pasa a «${estadoSolicitudAltaLabels[destino]}».`);
      await cargarCola();
    } catch (err) {
      setError(`No se pudo cambiar el estado de ${solicitud.codigo}: ${mensaje(err)}`);
      await cargarCola();
    } finally {
      setGuardandoId("");
    }
  }

  async function confirmarMotivo() {
    if (!peticionMotivo) return;
    if (!motivo.trim()) {
      setErrorMotivo("El motivo es obligatorio: queda escrito en la auditoría.");
      return;
    }
    const { solicitud, destino } = peticionMotivo;
    setPeticionMotivo(null);
    await aplicarEstado(solicitud, destino, motivo);
    setMotivo("");
  }

  if (!session?.active) return <Gate texto="Inicia sesión en MerchanOps para acceder a RR.HH." />;
  if (!canAccessModule(session, "rrhh")) return <Gate texto="No tienes permiso para acceder al módulo de RR.HH." />;

  const gestionaRrhh = canManageRrhh(session);

  // Qué campos del modal viajan de verdad: los que no, se enseñan apagados en vez
  // de desaparecer, para que se vea qué se está dejando de guardar.
  const tramite = peticionTramite;
  const registraAlta = Boolean(tramite && tramite.modo !== "ninguno" && tramite.registrar);
  const camposDeAltaNueva = registraAlta && tramite?.modo === "crear";

  return (
    <main className="min-h-screen bg-slate-100 p-4 text-slate-900">
      <section className="mx-auto max-w-7xl space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h1 className="text-3xl font-bold">Altas laborales</h1>
            <p className="text-sm text-slate-500">Alta en A3 e imputaciones por CECO de los trabajos pendientes.</p>
          </div>
          <button
            onClick={() => void cargarCola()}
            disabled={cargandoCola}
            className="rounded-2xl border bg-white px-4 py-2 text-sm font-semibold disabled:opacity-50"
          >
            <RefreshCw className="mr-1 inline h-4 w-4" />
            Actualizar
          </button>
        </div>

        {aviso && <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">{aviso}</div>}
        {error && <div className="rounded-2xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}

        {/* ---------- Tarjeta de trabajo ---------- */}
        <div className="rounded-3xl border bg-white p-4 shadow-sm">
          <label className="block max-w-md text-sm">
            <span className="font-medium">Trabajador</span>
            <select
              value={workerId}
              onChange={event => setWorkerId(event.target.value)}
              className="mt-1 w-full rounded-2xl border bg-white px-3 py-2 text-sm"
            >
              <option value="">Selecciona un trabajador...</option>
              {trabajadores.map(fila => (
                <option key={fila.id} value={fila.id}>
                  {fila.name?.trim() || fila.id}
                  {fila.province ? ` · ${fila.province}` : ""}
                </option>
              ))}
            </select>
          </label>

          <h2 className="mt-4 text-lg font-semibold">Trabajos pendientes de alta</h2>

          {!workerId && (
            <p className="mt-2 rounded-2xl bg-slate-50 p-4 text-sm text-slate-500">
              Elige un trabajador para ver sus trabajos pendientes de alta.
            </p>
          )}

          {workerId && cargandoTrabajador && <p className="mt-2 text-sm text-slate-500">Cargando trabajos pendientes...</p>}

          {workerId && !cargandoTrabajador && pendientes.length === 0 && (
            <div className="mt-2 rounded-2xl bg-slate-50 p-4">
              <p className="font-semibold">Este trabajador no tiene trabajos pendientes de alta.</p>
              <p className="text-sm text-slate-500">
                Aquí aparecen las campañas y servicios que ya tiene asignados y todavía no están respaldados por un alta. Si esperabas
                ver alguno, revisa la asignación en su campaña o servicio de origen.
              </p>
            </div>
          )}

          {workerId && !cargandoTrabajador && pendientes.length > 0 && (
            <div className="mt-2 space-y-2">
              {pendientes.map(trabajo => {
                const clave = claveTrabajo(trabajo);
                const marcado = seleccion.includes(clave);
                return (
                  <label
                    key={clave}
                    className={`flex cursor-pointer items-start gap-3 rounded-2xl border p-3 ${marcado ? "bg-slate-50" : "bg-white"}`}
                  >
                    <input
                      type="checkbox"
                      className="mt-1"
                      checked={marcado}
                      onChange={() => alternar(trabajo)}
                      aria-label={`Seleccionar ${trabajo.campana || "trabajo"}`}
                    />
                    <span className="min-w-0">
                      <span className="block font-semibold">{trabajo.campana || "Trabajo sin campaña"}</span>
                      <span className="block text-sm text-slate-500">{lineaGris(trabajo)}</span>
                    </span>
                  </label>
                );
              })}
            </div>
          )}

          {/* Barra de resultado: a la izquierda lo que CALCULA el sistema. */}
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t pt-4">
            <p className={`min-w-0 text-sm ${CLASE_TONO[resolucion.tono]}`}>{resolucion.texto}</p>
            <button
              onClick={() => void tramitar()}
              disabled={!marcados.length || tramitando || !resolucion.resolucion}
              className="rounded-2xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
            >
              <Send className="mr-1 inline h-4 w-4" />
              {tramitando ? "Tramitando..." : "Tramitar"}
            </button>
          </div>
        </div>

        {/* ---------- Cola de altas ---------- */}
        <div className="rounded-3xl border bg-white p-4 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-xl font-semibold">Cola de altas · {cola.length} solicitudes</h2>
            <div className="flex flex-wrap items-center gap-3 text-xs">
              <span className="inline-flex items-center gap-2 text-slate-500">
                <span className="inline-block h-2.5 w-2.5 rounded-full bg-slate-300" />
                Texto gris · automático del sistema
              </span>
              <span className="inline-flex items-center gap-2 rounded-full bg-slate-100 px-2.5 py-1 font-semibold text-slate-700">
                A3 y Estado · lo rellena RRHH
              </span>
            </div>
          </div>

          <div className="mt-3 grid gap-3 md:grid-cols-[1fr_260px]">
            <label className="flex items-center gap-2 rounded-2xl border bg-white px-3 py-2">
              <Search className="h-4 w-4 shrink-0 text-slate-400" />
              <input
                value={consulta}
                onChange={event => setConsulta(event.target.value)}
                placeholder="Buscar por trabajador, campaña, CECO o código..."
                className="w-full bg-transparent text-sm outline-none"
              />
            </label>
            <label className="block text-sm">
              <select
                value={filtroEstado}
                onChange={event => setFiltroEstado(event.target.value as EstadoSolicitudAlta | "")}
                aria-label="Filtrar la cola por estado"
                className="w-full rounded-2xl border bg-white px-3 py-2 text-sm"
              >
                <option value="">Todos los estados</option>
                {TODOS_LOS_ESTADOS.map(estado => (
                  <option key={estado} value={estado}>
                    {estadoSolicitudAltaLabels[estado]}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {cargandoCola && <p className="mt-3 text-sm text-slate-500">Cargando cola de altas...</p>}

          {!cargandoCola && cola.length === 0 && (
            <div className="mt-3 rounded-2xl bg-slate-50 p-4">
              <p className="font-semibold">No hay solicitudes de alta con estos filtros.</p>
              <p className="text-sm text-slate-500">
                Marca los trabajos pendientes de un trabajador y pulsa «Tramitar» para que aparezcan aquí.
              </p>
            </div>
          )}

          {!cargandoCola && cola.length > 0 && (
            <div className="mt-3 overflow-auto">
              <table className="w-full min-w-[1100px] text-sm">
                <thead>
                  <tr className="bg-slate-50">
                    <th className="p-2 text-left">Sol.</th>
                    <th className="p-2 text-left">Gestora</th>
                    <th className="bg-slate-100 p-2 text-left">A3</th>
                    <th className="p-2 text-left">Trabajador</th>
                    <th className="p-2 text-left">CECO</th>
                    <th className="p-2 text-left">Campaña</th>
                    <th className="p-2 text-left">FI → FF</th>
                    <th className="p-2 text-left">Horas</th>
                    <th className="bg-slate-100 p-2 text-left">Estado</th>
                  </tr>
                </thead>
                <tbody>
                  {cola.map(solicitud => {
                    const cecos = resumenLineas(solicitud.lineas, "ceco");
                    const campanas = resumenLineas(solicitud.lineas, "campana");
                    const destinos = TODOS_LOS_ESTADOS.filter(estado => puedeTransicionar(solicitud.estado, estado));
                    const guardando = guardandoId === solicitud.id;
                    return (
                      <tr key={solicitud.id} className="border-t align-top">
                        <td className="p-2">
                          <p className="font-mono font-semibold text-slate-700">{solicitud.codigo}</p>
                          <p className="text-xs text-slate-400">{formateaFechaCorta(solicitud.created_at)}</p>
                        </td>
                        <td className="p-2 text-slate-500">{solicitud.solicitada_por_nombre || "—"}</td>
                        <td className="bg-slate-50 p-2">
                          {gestionaRrhh ? (
                            <input
                              value={a3Borrador[solicitud.id] ?? solicitud.a3_numero ?? ""}
                              onChange={event => setA3Borrador(previo => ({ ...previo, [solicitud.id]: event.target.value }))}
                              onBlur={event => void guardarA3(solicitud, event.target.value)}
                              disabled={guardando}
                              placeholder="Nº A3"
                              aria-label={`Número de A3 de ${solicitud.codigo}`}
                              className="w-28 rounded-2xl border bg-white px-3 py-2 text-sm font-semibold disabled:opacity-50"
                            />
                          ) : (
                            <span className="font-semibold">{solicitud.a3_numero || "—"}</span>
                          )}
                        </td>
                        <td className="p-2 text-slate-500">{solicitud.worker_nombre || "—"}</td>
                        <td className="p-2 text-slate-500" title={cecos.titulo}>
                          {cecos.texto}
                        </td>
                        <td className="p-2 text-slate-500" title={campanas.titulo}>
                          {campanas.texto}
                        </td>
                        <td className="p-2 text-slate-500">
                          {formateaFechaCorta(solicitud.fecha_inicio) || "—"} → {formateaFechaCorta(solicitud.fecha_fin) || "—"}
                        </td>
                        <td className="p-2 text-slate-500">
                          {typeof solicitud.horas_dia === "number" ? `${numero(solicitud.horas_dia)} h` : "—"}
                        </td>
                        {/* El desplegable conserva el color del badge: RR.HH. lee el estado de un vistazo. */}
                        <td className="bg-slate-50 p-2">
                          {gestionaRrhh && destinos.length > 0 ? (
                            <select
                              value={solicitud.estado}
                              onChange={event => pedirCambioEstado(solicitud, event.target.value as EstadoSolicitudAlta)}
                              disabled={guardando}
                              aria-label={`Estado de ${solicitud.codigo}`}
                              className={`w-full min-w-[150px] rounded-2xl border px-3 py-2 text-sm font-semibold disabled:opacity-50 ${estadoSolicitudAltaClases[solicitud.estado]}`}
                            >
                              <option value={solicitud.estado}>{estadoSolicitudAltaLabels[solicitud.estado]}</option>
                              {destinos.map(estado => (
                                <option key={estado} value={estado}>
                                  {estadoSolicitudAltaLabels[estado]}
                                </option>
                              ))}
                            </select>
                          ) : (
                            <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${estadoSolicitudAltaClases[solicitud.estado]}`}>
                              {estadoSolicitudAltaLabels[solicitud.estado]}
                            </span>
                          )}
                          {solicitud.motivo && <p className="mt-1 text-xs text-slate-500">{solicitud.motivo}</p>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>

      {peticionMotivo && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
          <div className="w-full max-w-md rounded-3xl border bg-white p-4 shadow-sm">
            <h3 className="text-lg font-semibold">Motivo obligatorio</h3>
            <p className="mt-1 text-sm text-slate-500">
              Para pasar {peticionMotivo.solicitud.codigo} a «{estadoSolicitudAltaLabels[peticionMotivo.destino]}» hace falta una
              explicación escrita: queda en la auditoría y no se puede deshacer.
            </p>
            <textarea
              value={motivo}
              onChange={event => setMotivo(event.target.value)}
              rows={3}
              autoFocus
              placeholder="Motivo..."
              className="mt-3 w-full rounded-2xl border px-3 py-2 text-sm"
            />
            {errorMotivo && <p className="mt-2 rounded-2xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{errorMotivo}</p>}
            <div className="mt-3 flex justify-end gap-2">
              <button
                onClick={() => {
                  setPeticionMotivo(null);
                  setMotivo("");
                  setErrorMotivo("");
                }}
                className="rounded-2xl border bg-white px-4 py-2 text-sm font-semibold"
              >
                Cancelar
              </button>
              <button
                onClick={() => void confirmarMotivo()}
                className="rounded-2xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white"
              >
                Guardar motivo
              </button>
            </div>
          </div>
        </div>
      )}

      {tramite && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
          <div className="max-h-[90vh] w-full max-w-2xl overflow-auto rounded-3xl border bg-white p-4 shadow-sm">
            <h3 className="text-lg font-semibold">Tramitar en A3</h3>
            <p className="mt-1 text-sm text-slate-500">
              {tramite.solicitud.codigo}
              {tramite.solicitud.worker_nombre ? ` · ${tramite.solicitud.worker_nombre}` : ""} pasa a «
              {estadoSolicitudAltaLabels[tramite.destino]}». Teclea el número que ha devuelto A3 y decide qué se guarda en MerchanOps.
            </p>

            {/* La decisión de arriba del todo: ¿aprende el sistema de este trámite? */}
            {tramite.modo === "ninguno" ? (
              <p className="mt-3 rounded-2xl bg-slate-50 p-3 text-sm text-slate-500">{textoSinAltaQueCrear(tramite.solicitud)}</p>
            ) : (
              <label className="mt-3 flex cursor-pointer items-start gap-3 rounded-2xl border p-3">
                <input
                  type="checkbox"
                  className="mt-1"
                  checked={tramite.registrar}
                  onChange={event => cambiaTramite({ registrar: event.target.checked })}
                />
                <span className="min-w-0 text-sm">
                  <span className="block font-semibold">
                    {tramite.modo === "ampliar"
                      ? `Ampliar el alta ${numeroAltaReferencia(tramite.solicitud)} hasta el ${
                          formateaFechaCorta(tramite.fecha_fin) || "final abierto"
                        }`
                      : "Registrar el alta en MerchanOps para que el sistema calcule las coberturas futuras"}
                  </span>
                  <span className="block text-slate-500">
                    {tramite.registrar
                      ? tramite.modo === "ampliar"
                        ? "Primero se amplía el alta y solo después se mueve el estado: si la ampliación falla, la solicitud se queda como está."
                        : "El alta queda en MerchanOps y los próximos trabajos de este trabajador se calcularán contra ella."
                      : "Sin registrar el alta, el sistema volverá a proponer un alta nueva para los próximos trabajos de este trabajador."}
                  </span>
                </span>
              </label>
            )}

            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <label className="block text-sm">
                <span className="font-medium">Número de alta en A3</span>
                <input
                  value={tramite.numero}
                  onChange={event => cambiaTramite({ numero: event.target.value })}
                  autoFocus
                  placeholder="18832"
                  aria-label="Número de alta en A3"
                  className="mt-1 w-full rounded-2xl border px-3 py-2 text-sm font-semibold"
                />
              </label>

              <label className="block text-sm">
                <span className="font-medium">Tipo de contrato</span>
                <select
                  value={tramite.tipo}
                  onChange={event => cambiaTramite({ tipo: event.target.value as TipoAlta })}
                  disabled={!camposDeAltaNueva}
                  aria-label="Tipo de contrato"
                  className="mt-1 w-full rounded-2xl border bg-white px-3 py-2 text-sm disabled:opacity-50"
                >
                  {TIPOS_ALTA.map(tipo => (
                    <option key={tipo} value={tipo}>
                      {tipoAltaLabels[tipo]}
                    </option>
                  ))}
                </select>
              </label>

              <label className="block text-sm">
                <span className="font-medium">Fecha de inicio</span>
                <input
                  type="date"
                  value={tramite.fecha_inicio}
                  onChange={event => cambiaTramite({ fecha_inicio: event.target.value })}
                  disabled={!camposDeAltaNueva}
                  aria-label="Fecha de inicio del alta"
                  className="mt-1 w-full rounded-2xl border px-3 py-2 text-sm disabled:opacity-50"
                />
              </label>

              <label className="block text-sm">
                <span className="font-medium">Fecha de fin</span>
                <input
                  type="date"
                  value={tramite.fecha_fin}
                  onChange={event => cambiaTramite({ fecha_fin: event.target.value })}
                  disabled={!registraAlta}
                  aria-label="Fecha de fin del alta"
                  className="mt-1 w-full rounded-2xl border px-3 py-2 text-sm disabled:opacity-50"
                />
                {/* La verdad depende del RPC: al AMPLIAR, vaciarla abre el alta; al
                    CREAR, `merchan_rrhh_resolver_alta` cae en la fecha de fin de la
                    solicitud si no le mandan otra. Se dice lo que va a pasar. */}
                <span className="mt-1 block text-xs text-slate-500">
                  {tramite.modo !== "ampliar" && tramite.solicitud.fecha_fin
                    ? `Vacía = se usa la fecha de fin de la solicitud (${formateaFechaCorta(tramite.solicitud.fecha_fin)}).`
                    : "Vacía = alta abierta, sin fecha de fin."}
                </span>
              </label>

              <label className="block text-sm">
                <span className="font-medium">CECO</span>
                <input
                  value={tramite.ceco}
                  onChange={event => cambiaTramite({ ceco: event.target.value })}
                  disabled={!camposDeAltaNueva}
                  placeholder="3005"
                  aria-label="CECO del alta"
                  className="mt-1 w-full rounded-2xl border px-3 py-2 text-sm disabled:opacity-50"
                />
              </label>

              <label className="block text-sm">
                <span className="font-medium">Horas/día</span>
                <input
                  type="number"
                  min={0}
                  step="0.5"
                  value={tramite.horas}
                  onChange={event => cambiaTramite({ horas: event.target.value })}
                  disabled={!camposDeAltaNueva}
                  placeholder="6"
                  aria-label="Horas por día del alta"
                  className="mt-1 w-full rounded-2xl border px-3 py-2 text-sm disabled:opacity-50"
                />
              </label>
            </div>

            {registraAlta && tramite.modo === "ampliar" && (
              <p className="mt-2 text-xs text-slate-500">
                Al ampliar el alta {numeroAltaReferencia(tramite.solicitud)} solo viajan su número y su nueva fecha de fin: el tipo de
                contrato, el CECO y las horas se quedan como ya estaban en MerchanOps.
              </p>
            )}
            {!registraAlta && (
              <p className="mt-2 text-xs text-slate-500">
                Estos datos no se guardan en ningún sitio: sin registrar el alta solo se guardan el número de A3 y el estado.
              </p>
            )}

            <label className="mt-3 block text-sm">
              <span className="font-medium">
                Código de empleado en A3 <span className="font-normal text-slate-400">(opcional)</span>
              </span>
              <input
                value={tramite.empleado}
                onChange={event => cambiaTramite({ empleado: event.target.value })}
                placeholder="E-1234"
                aria-label="Código de empleado en A3"
                className="mt-1 w-full rounded-2xl border px-3 py-2 text-sm"
              />
              <span className="mt-1 block text-xs text-slate-500">
                Es el único dato de A3 que MerchanOps guarda del trabajador: sirve para casar el alta cuando exista la API. No se
                guardan DNI, NAF ni IBAN.
              </span>
            </label>

            {errorTramite && <p className="mt-2 rounded-2xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{errorTramite}</p>}

            <div className="mt-3 flex justify-end gap-2">
              <button onClick={cerrarTramite} className="rounded-2xl border bg-white px-4 py-2 text-sm font-semibold">
                Cancelar
              </button>
              <button
                onClick={() => void confirmarTramite()}
                className="rounded-2xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white"
              >
                Guardar y tramitar
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

function Gate({ texto }: { texto: string }) {
  return (
    <main className="min-h-screen bg-slate-100 p-4 text-slate-900">
      <section className="mx-auto max-w-7xl space-y-4">
        <div className="rounded-3xl border bg-white p-4 shadow-sm">
          <h1 className="text-2xl font-bold">Altas laborales</h1>
          <p className="mt-2 text-sm text-slate-600">{texto}</p>
        </div>
      </section>
    </main>
  );
}

/** Identidad de un trabajo pendiente: el par polimórfico origen_tipo + origen_id. */
function claveTrabajo(trabajo: TrabajoPendiente) {
  return `${trabajo.origen_tipo}:${trabajo.origen_id}`;
}

/** «3136 · 28/07 → 29/07 · 3 h/día», saltando lo que no haya. */
function lineaGris(trabajo: TrabajoPendiente) {
  const inicio = formateaFechaCorta(trabajo.fecha_inicio);
  const fin = formateaFechaCorta(trabajo.fecha_fin);
  return [
    String(trabajo.ceco ?? "").trim(),
    inicio && fin ? `${inicio} → ${fin}` : inicio || fin,
    trabajo.horas_dia === null || trabajo.horas_dia === undefined ? "" : `${numero(trabajo.horas_dia)} h/día`
  ]
    .filter(Boolean)
    .join(" · ");
}

/**
 * Horas/día de la cabecera de la solicitud. Se manda la mayor de la selección:
 * cada línea conserva las suyas, así que no se pierde nada, y la cabecera no se
 * queda corta respecto a ninguno de los trabajos que ampara.
 */
function horasDeLaSeleccion(trabajos: TrabajoPendiente[]): number | null {
  const horas = trabajos.map(trabajo => trabajo.horas_dia).filter((valor): valor is number => typeof valor === "number" && Number.isFinite(valor));
  if (!horas.length) return null;
  return Math.max(...horas);
}

/** Primer valor distinto de las líneas y «+N» con el detalle completo en el title. */
function resumenLineas(lineas: LineaSolicitudAlta[] | undefined, campo: "ceco" | "campana") {
  const valores = Array.from(new Set((lineas || []).map(linea => String(linea?.[campo] ?? "").trim()).filter(Boolean)));
  if (!valores.length) return { texto: "—", titulo: "" };
  const extra = valores.length - 1;
  return { texto: extra > 0 ? `${valores[0]} +${extra}` : valores[0], titulo: valores.join(" · ") };
}

function numero(valor: number) {
  return new Intl.NumberFormat("es-ES", { maximumFractionDigits: 2 }).format(valor);
}

/** El CECO con el que se prerrellena el modal: el de la primera línea que traiga uno. */
function primerCeco(solicitud: SolicitudAlta): string {
  const linea = (solicitud.lineas || []).find(fila => String(fila?.ceco ?? "").trim());
  return String(linea?.ceco ?? "").trim();
}

/** Cómo se nombra en el modal el alta que hay que ampliar. */
function numeroAltaReferencia(solicitud: SolicitudAlta): string {
  return String(solicitud.alta_referencia_numero ?? "").trim() || "referenciada";
}

/** Por qué este trámite no ofrece crear ni ampliar nada. */
function textoSinAltaQueCrear(solicitud: SolicitudAlta): string {
  if (solicitud.alta_id) {
    return "Esta solicitud ya tiene su alta registrada en MerchanOps: aquí solo se guardan el número de A3 y el estado.";
  }
  if (solicitud.resolucion_sistema === "cubierta") {
    return `El periodo ya lo cubre ${
      solicitud.alta_referencia_numero ? `el alta ${solicitud.alta_referencia_numero}` : "un alta vigente"
    }, así que no hay nada que registrar: aquí solo se guardan el número de A3 y el estado.`;
  }
  return "No hay ningún alta que registrar ni ampliar desde esta solicitud: aquí solo se guardan el número de A3 y el estado.";
}

/** Las horas/día tecleadas, con coma o con punto. Vacío o ilegible es "no lo sé", no un 0. */
function horasONulo(valor: string): number | null {
  const limpio = valor.trim().replace(",", ".");
  if (!limpio) return null;
  const horas = Number(limpio);
  return Number.isFinite(horas) ? horas : null;
}

/** Ningún error se traga: siempre sale su mensaje real. */
function mensaje(err: unknown) {
  return err instanceof Error ? err.message : String(err ?? "error desconocido");
}

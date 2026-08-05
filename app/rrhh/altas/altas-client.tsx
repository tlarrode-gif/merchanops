"use client";

/**
 * MerchanOps · RR.HH. — Altas laborales.
 *
 * QUÉ RESUELVE
 * Con 26 trabajadores y 173 trabajos pendientes, la pregunta no es «¿sabe el
 * sistema calcular el alta?» sino «¿se tarda menos que con un Excel?». Por eso
 * esta pantalla enseña la carga ENTERA de todos los trabajadores a la vez,
 * agrupada por persona, y deja marcar en bloque: casilla por fila, casilla por
 * grupo y «marcar todo lo visible». Ir trabajador por trabajador —26 vueltas
 * para tramitar lo mismo— era la fricción que hacía la pantalla inservible.
 *
 * UNA SOLICITUD ES DE UN TRABAJADOR
 * Es la regla de `merchan_rrhh_solicitar_alta` y no se negocia. Así que marcar
 * trabajos de varias personas no crea un engendro compartido: crea UNA solicitud
 * por trabajador, en serie, enseñando el progreso. Si una falla, las demás
 * siguen: al final se dice cuáles se crearon y cuáles no, con su motivo real.
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
 * `resolucion_sistema`, `resolucion_detalle`, fechas, CECOs y horas/día salen
 * íntegros de `lib/rrhh/altas.ts` y `lib/rrhh/datos.ts`. Las horas/día de un
 * servicio se derivan de sus horas totales repartidas entre los días naturales
 * (`horasDiaDerivadas`), así que la fila enseña «3 h/día» en vez de un hueco que
 * alguien tendría que rellenar 173 veces.
 *
 * EL TRÁMITE YA NO ES UN MODAL OBLIGATORIO
 * Mover la cola a «Tramitada» o «Alta online» es un clic, también en bloque.
 * El modal «Registrar alta…» sigue estando, pero solo para quien quiera crear o
 * ampliar el alta REAL con detalle. Ese paso es el que hace que el sistema
 * aprenda: sin él, los próximos trabajos del mismo trabajador se volverán a
 * calcular como «Alta nueva» aunque el alta ya esté hecha en A3. Se dice en gris
 * bajo la barra de acciones, en vez de imponerlo con un formulario de 6 campos.
 *
 * CONCURRENCIA
 * Cada resolución envía el `version` que se leyó. Si otra persona tocó la
 * solicitud entretanto, el RPC la rechaza en vez de pisarla: aquí se enseña el
 * mensaje real y se recarga la cola.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronRight, RefreshCw, Search, Send } from "lucide-react";
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
import {
  estadoSugerido,
  exigeMotivo,
  formateaFechaCorta,
  formateaHoras,
  normalizaFecha,
  puedeTransicionar,
  rangoDeTrabajos,
  textoResolucion
} from "@/lib/rrhh/altas";
import {
  PayloadResolverAlta,
  PayloadSolicitarAlta,
  crearSolicitudAlta,
  listarAltas,
  listarSolicitudesAlta,
  listarTrabajadores,
  registrarAlta,
  resolverSolicitudAlta,
  trabajosPendientesDeTodos
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
    throw new Error(`el cálculo propuso el estado «${sugerido}», que no es un estado con el que una solicitud pueda nacer`);
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

/** Los estados que significan «esto ya está hecho en A3». */
const ESTADOS_TRAMITE: EstadoSolicitudAlta[] = ["tramitada", "alta_online"];

/** Las tres acciones en bloque de la cola, en el orden en que se usan. */
const ACCIONES_COLA: EstadoSolicitudAlta[] = ["tramitada", "alta_online", "rechazada"];

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

/** Lo que RR.HH. teclea en el modal «Registrar alta…» antes de confirmar. */
type BorradorTramite = {
  solicitud: SolicitudAlta;
  /** "" = no se toca el estado: solo se registra el alta y el número de A3. */
  destino: EstadoSolicitudAlta | "";
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
 * registrar, porque no registrar el alta es la excepción, no lo normal. El estado
 * de destino se propone —«Tramitada» si la transición existe— pero ya no se
 * impone: el modal es para el ALTA, y mover la cola se puede hacer sin él.
 */
function borradorTramite(solicitud: SolicitudAlta): BorradorTramite {
  const modo = modoDeTramite(solicitud);
  const destinos = ESTADOS_TRAMITE.filter(estado => puedeTransicionar(solicitud.estado, estado));
  return {
    solicitud,
    destino: destinos[0] ?? "",
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

/** Un trabajador con todos sus trabajos pendientes: la unidad de esta pantalla. */
type GrupoTrabajador = {
  workerId: string;
  nombre: string;
  trabajos: TrabajoPendiente[];
};

/** Lo que hay que decidir en el modal de motivo: puede ser una fila o un lote entero. */
type PeticionMotivo = { solicitudes: SolicitudAlta[]; destino: EstadoSolicitudAlta };

export function AltasClient() {
  const [session, setSession] = useState<AppSession | null>(null);

  // Tarjeta de trabajo: la carga ENTERA, de todos los trabajadores a la vez.
  const [trabajadores, setTrabajadores] = useState<FilaTrabajador[]>([]);
  const [pendientes, setPendientes] = useState<TrabajoPendiente[]>([]);
  const [altas, setAltas] = useState<AltaLaboral[]>([]);
  const [seleccion, setSeleccion] = useState<string[]>([]);
  const [abiertos, setAbiertos] = useState<string[]>([]);
  const [cargandoCarga, setCargandoCarga] = useState(true);
  const [tramitando, setTramitando] = useState(false);
  const [progreso, setProgreso] = useState("");

  // Filtros rápidos de la carga
  const [busqueda, setBusqueda] = useState("");
  const [desde, setDesde] = useState("");
  const [hasta, setHasta] = useState("");
  const [enfocado, setEnfocado] = useState("");

  // Cola de altas
  const [solicitudes, setSolicitudes] = useState<SolicitudAlta[]>([]);
  const [cargandoCola, setCargandoCola] = useState(true);
  const [consulta, setConsulta] = useState("");
  const [filtroEstado, setFiltroEstado] = useState<EstadoSolicitudAlta | "">("");
  const [seleccionCola, setSeleccionCola] = useState<string[]>([]);
  const [a3Borrador, setA3Borrador] = useState<Record<string, string>>({});
  const [guardandoId, setGuardandoId] = useState("");
  const [progresoCola, setProgresoCola] = useState("");

  // Avisos
  const [error, setError] = useState("");
  const [aviso, setAviso] = useState("");

  // Modal de motivo (nada se cierra en negativo sin explicación escrita).
  const [peticionMotivo, setPeticionMotivo] = useState<PeticionMotivo | null>(null);
  const [motivo, setMotivo] = useState("");
  const [errorMotivo, setErrorMotivo] = useState("");

  // Modal «Registrar alta…»: el alta REAL, y de paso el número de A3 y el estado.
  const [peticionTramite, setPeticionTramite] = useState<BorradorTramite | null>(null);
  const [errorTramite, setErrorTramite] = useState("");

  /** Para que el selector de trabajador pueda llevar la pantalla hasta su grupo. */
  const nodosGrupo = useRef<Record<string, HTMLDivElement | null>>({});

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

  /**
   * Toda la carga en una sola pasada: trabajadores, trabajos pendientes de TODOS
   * y todas las altas reales. Son tres viajes para pintar la pantalla entera, no
   * tres por cabeza. `primeraVez` deja abierto solo el primer grupo; al recargar
   * después de tramitar se respeta lo que la persona tenga desplegado.
   */
  const cargarCarga = useCallback(async (primeraVez: boolean) => {
    setCargandoCarga(true);
    try {
      const [gente, trabajos, todasLasAltas] = await Promise.all([listarTrabajadores(), trabajosPendientesDeTodos(), listarAltas()]);
      setTrabajadores(gente);
      setPendientes(trabajos);
      setAltas(todasLasAltas);
      if (primeraVez) {
        const primero = agrupaPorTrabajador(trabajos, gente)[0];
        setAbiertos(primero ? [primero.workerId] : []);
      }
      setError("");
    } catch (err) {
      setTrabajadores([]);
      setPendientes([]);
      setAltas([]);
      setError(`No se pudo cargar la carga de trabajo pendiente: ${mensaje(err)}`);
    } finally {
      setCargandoCarga(false);
    }
  }, []);

  const activa = Boolean(session?.active);

  useEffect(() => {
    if (!activa) return;
    void cargarCarga(true);
    void cargarCola();
  }, [activa, cargarCarga, cargarCola]);

  const nombresPorId = useMemo(() => {
    const mapa = new Map<string, string>();
    for (const fila of trabajadores) mapa.set(fila.id, fila.name?.trim() || fila.id);
    return mapa;
  }, [trabajadores]);

  /** Las altas de cada trabajador, para calcular su cobertura sin volver a la red. */
  const altasPorTrabajador = useMemo(() => {
    const mapa = new Map<string, AltaLaboral[]>();
    for (const alta of altas) {
      const lista = mapa.get(alta.worker_id);
      if (lista) lista.push(alta);
      else mapa.set(alta.worker_id, [alta]);
    }
    return mapa;
  }, [altas]);

  /** Lo que queda tras los filtros rápidos: es lo que se ve y lo que marca «todo lo visible». */
  const visibles = useMemo(() => {
    const aguja = busqueda.trim().toLowerCase();
    const inicioFiltro = normalizaFecha(desde);
    const finFiltro = normalizaFecha(hasta);
    return pendientes.filter(trabajo => {
      // Rango: se conserva el trabajo que TOCA la ventana, no solo el que cabe
      // entera dentro. Un trabajo del 28/07 al 03/08 sale al filtrar por julio.
      if (inicioFiltro && trabajo.fecha_fin && trabajo.fecha_fin < inicioFiltro) return false;
      if (finFiltro && trabajo.fecha_inicio && trabajo.fecha_inicio > finFiltro) return false;
      if (!aguja) return true;
      const heno = [nombresPorId.get(trabajo.worker_id) ?? "", trabajo.campana, trabajo.ceco, trabajo.provincia ?? ""]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return heno.includes(aguja);
    });
  }, [pendientes, busqueda, desde, hasta, nombresPorId]);

  const grupos = useMemo(() => agrupaPorTrabajador(visibles, trabajadores), [visibles, trabajadores]);

  const claves = useMemo(() => new Set(seleccion), [seleccion]);
  const marcados = useMemo(() => pendientes.filter(trabajo => claves.has(claveTrabajo(trabajo))), [pendientes, claves]);
  const gruposMarcados = useMemo(() => agrupaPorTrabajador(marcados, trabajadores), [marcados, trabajadores]);

  /** Marcados que los filtros están escondiendo: se dice, no se disimula. */
  const marcadosOcultos = useMemo(() => {
    const visiblesClaves = new Set(visibles.map(claveTrabajo));
    return marcados.filter(trabajo => !visiblesClaves.has(claveTrabajo(trabajo))).length;
  }, [marcados, visibles]);

  /** Una línea de texto gris POR TRABAJADOR: cada alta se calcula contra las suyas. */
  const resoluciones = useMemo(
    () => gruposMarcados.map(grupo => ({ grupo, resolucion: textoResolucion(grupo.trabajos, altasPorTrabajador.get(grupo.workerId) ?? []) })),
    [gruposMarcados, altasPorTrabajador]
  );

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

  const clavesCola = useMemo(() => new Set(seleccionCola), [seleccionCola]);
  const marcadasCola = useMemo(() => solicitudes.filter(solicitud => clavesCola.has(solicitud.id)), [solicitudes, clavesCola]);

  // ---------- Marcar: barato en todas sus formas ----------

  function alternar(trabajo: TrabajoPendiente) {
    const clave = claveTrabajo(trabajo);
    setSeleccion(previa => (previa.includes(clave) ? previa.filter(x => x !== clave) : [...previa, clave]));
  }

  /** Marca o desmarca una lista entera de golpe (un grupo, o todo lo visible). */
  function alternarLote(trabajos: TrabajoPendiente[], marcar: boolean) {
    const afectadas = new Set(trabajos.map(claveTrabajo));
    setSeleccion(previa => {
      const restantes = previa.filter(clave => !afectadas.has(clave));
      return marcar ? [...restantes, ...afectadas] : restantes;
    });
  }

  function abrirGrupo(workerId: string, abierto: boolean) {
    setAbiertos(previa => (abierto ? (previa.includes(workerId) ? previa : [...previa, workerId]) : previa.filter(id => id !== workerId)));
  }

  /**
   * El selector de arriba NO filtra la carga: lleva hasta el grupo y lo despliega.
   * Filtrar escondería el resto de lo marcado, que es justo lo que esta pantalla
   * quiere evitar; el buscador sí filtra, y para eso está.
   */
  function irATrabajador(workerId: string) {
    setEnfocado(workerId);
    if (!workerId) return;
    abrirGrupo(workerId, true);
    const nodo = nodosGrupo.current[workerId];
    if (!nodo) {
      setAviso(`${nombresPorId.get(workerId) ?? workerId} no tiene trabajos pendientes con los filtros de ahora mismo.`);
      return;
    }
    setAviso("");
    nodo.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  // ---------- Tramitar EN BLOQUE: una solicitud por trabajador ----------

  /**
   * Una llamada por trabajador, en serie y con progreso. Un fallo NO aborta el
   * lote: se anota y se sigue, porque que la solicitud 2 de 12 dé error no es
   * motivo para dejar sin tramitar las diez siguientes. Al final se enseña lo
   * creado y lo fallado, cada cosa con su mensaje real.
   */
  async function tramitarLote() {
    if (!gruposMarcados.length || tramitando) return;
    const lote = gruposMarcados;
    setTramitando(true);
    setError("");
    setAviso("");

    const creadas: string[] = [];
    const fallos: string[] = [];
    const hechas = new Set<string>();

    for (let i = 0; i < lote.length; i += 1) {
      const grupo = lote[i];
      setProgreso(`${i + 1} de ${lote.length}...`);
      try {
        const rango = rangoDeTrabajos(grupo.trabajos);
        const resolucion = textoResolucion(grupo.trabajos, altasPorTrabajador.get(grupo.workerId) ?? []);
        if (!resolucion.resolucion || !rango) {
          throw new Error("los trabajos marcados no tienen fechas válidas y no se puede calcular el alta");
        }
        const payload: PayloadSolicitarAlta = {
          worker_id: grupo.workerId,
          worker_nombre: grupo.nombre || null,
          resolucion_sistema: resolucion.resolucion,
          resolucion_detalle: resolucion.texto,
          alta_referencia_id: resolucion.alta?.id ?? null,
          alta_referencia_numero: resolucion.alta?.numero_alta ?? null,
          estado: estadoInicial(resolucion.resolucion, resolucion.alta),
          fecha_inicio: rango.inicio,
          fecha_fin: rango.fin,
          horas_dia: horasDeLaSeleccion(grupo.trabajos),
          solicitada_por_nombre: session?.display_name || null,
          lineas: grupo.trabajos.map(trabajo => ({
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
        creadas.push(creada.codigo);
        for (const trabajo of grupo.trabajos) hechas.add(claveTrabajo(trabajo));
      } catch (err) {
        fallos.push(`${grupo.nombre}: ${mensaje(err)}`);
      }
    }

    setProgreso("");
    // Solo se desmarca lo que SÍ se creó: lo que falló sigue marcado para reintentar.
    if (hechas.size) setSeleccion(previa => previa.filter(clave => !hechas.has(clave)));

    setAviso(
      creadas.length
        ? `${creadas.length} ${creadas.length === 1 ? "solicitud creada" : "solicitudes creadas"}: ${creadas.join(", ")}.`
        : ""
    );
    setError(
      fallos.length
        ? `${fallos.length} ${fallos.length === 1 ? "solicitud no se pudo crear" : "solicitudes no se pudieron crear"} · ${fallos.join(" · ")}`
        : ""
    );

    // Lo ya solicitado deja de estar pendiente: se relee la carga y la cola.
    await cargarCarga(false);
    await cargarCola();
    setTramitando(false);
  }

  // ---------- Cola: número de A3 y acciones en bloque ----------

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

  function alternarCola(id: string) {
    setSeleccionCola(previa => (previa.includes(id) ? previa.filter(x => x !== id) : [...previa, id]));
  }

  function alternarColaLote(lista: SolicitudAlta[], marcar: boolean) {
    const afectadas = new Set(lista.map(solicitud => solicitud.id));
    setSeleccionCola(previa => {
      const restantes = previa.filter(id => !afectadas.has(id));
      return marcar ? [...restantes, ...afectadas] : restantes;
    });
  }

  /**
   * Puerta única de los cambios de estado, tanto de una fila como de un lote. Si
   * el destino exige motivo se pide UNO para todo el lote: escribir doce veces
   * «duplicado» es exactamente la fricción que esta fase viene a quitar.
   */
  function pedirCambioEstado(lista: SolicitudAlta[], destino: EstadoSolicitudAlta) {
    const candidatas = lista.filter(solicitud => solicitud.estado !== destino);
    if (!candidatas.length) return;
    if (exigeMotivo(destino)) {
      setMotivo("");
      setErrorMotivo("");
      setPeticionMotivo({ solicitudes: candidatas, destino });
      return;
    }
    void aplicarLoteCola(candidatas, destino);
  }

  /**
   * Aplica la transición a todas las marcadas, en serie. Las que no la admiten
   * según `puedeTransicionar` se saltan —no se intentan contra la base para que
   * el trigger guardián las rechace una a una— y se dicen al final por su nombre.
   * Un error tampoco corta el lote: se anota y se sigue.
   */
  async function aplicarLoteCola(lista: SolicitudAlta[], destino: EstadoSolicitudAlta, motivoEscrito?: string) {
    if (!lista.length || progresoCola) return;
    const admiten = lista.filter(solicitud => puedeTransicionar(solicitud.estado, destino));
    const saltadas = lista.filter(solicitud => !puedeTransicionar(solicitud.estado, destino));

    setError("");
    setAviso("");

    const hechas: string[] = [];
    const fallos: string[] = [];

    for (let i = 0; i < admiten.length; i += 1) {
      const solicitud = admiten[i];
      setProgresoCola(`${i + 1} de ${admiten.length}...`);
      setGuardandoId(solicitud.id);
      try {
        const payload: PayloadResolverAlta = {
          solicitud_id: solicitud.id,
          estado: destino,
          motivo: motivoEscrito?.trim() || null,
          version: solicitud.version
        };
        await resolverSolicitudAlta(payload);
        hechas.push(solicitud.codigo);
      } catch (err) {
        fallos.push(`${solicitud.codigo}: ${mensaje(err)}`);
      }
    }

    setProgresoCola("");
    setGuardandoId("");

    const partes: string[] = [];
    if (hechas.length) {
      partes.push(
        `${hechas.length} ${hechas.length === 1 ? "solicitud pasa" : "solicitudes pasan"} a «${estadoSolicitudAltaLabels[destino]}»: ${hechas.join(", ")}.`
      );
    }
    if (saltadas.length) {
      partes.push(
        `Se ${saltadas.length === 1 ? "ha saltado 1 solicitud que no admite" : `han saltado ${saltadas.length} solicitudes que no admiten`} ese cambio: ${saltadas
          .map(solicitud => `${solicitud.codigo} (${estadoSolicitudAltaLabels[solicitud.estado]})`)
          .join(", ")}.`
      );
    }
    setAviso(partes.join(" "));
    setError(fallos.length ? `${fallos.length} ${fallos.length === 1 ? "solicitud falló" : "solicitudes fallaron"} · ${fallos.join(" · ")}` : "");

    if (hechas.length) {
      const hechasIds = new Set(admiten.filter(solicitud => hechas.includes(solicitud.codigo)).map(solicitud => solicitud.id));
      setSeleccionCola(previa => previa.filter(id => !hechasIds.has(id)));
    }
    await cargarCola();
  }

  async function confirmarMotivo() {
    if (!peticionMotivo) return;
    if (!motivo.trim()) {
      setErrorMotivo("El motivo es obligatorio: queda escrito en la auditoría.");
      return;
    }
    const { solicitudes: lista, destino } = peticionMotivo;
    setPeticionMotivo(null);
    await aplicarLoteCola(lista, destino, motivo);
    setMotivo("");
  }

  // ---------- Modal «Registrar alta…»: el alta REAL, ya no obligatorio ----------

  /** Cambia un campo del borrador del modal sin perder el resto. */
  function cambiaTramite(cambio: Partial<BorradorTramite>) {
    setPeticionTramite(previo => (previo ? { ...previo, ...cambio } : previo));
  }

  function cerrarTramite() {
    setPeticionTramite(null);
    setErrorTramite("");
  }

  /**
   * Relee las altas después de registrar una: es lo que hace que el texto gris
   * deje de decir «Alta nueva» en cuanto el alta existe. Si la relectura falla se
   * dice, sin tapar el hecho de que el trámite sí se guardó.
   */
  async function recargarAltas() {
    try {
      setAltas(await listarAltas());
    } catch (err) {
      setError(`El trámite se guardó, pero no se pudieron releer las altas: ${mensaje(err)}`);
    }
  }

  /**
   * Confirma el modal. Según la decisión de arriba:
   *  - "crear":   una sola llamada, `resolverSolicitudAlta` con `crear_alta`, que
   *               es transaccional en la base (o se mueve el estado y nace el alta, o nada).
   *  - "ampliar": PRIMERO se estira el alta existente y solo después se mueve el
   *               estado. Si la ampliación falla se para aquí: dejar la solicitud
   *               como «Tramitada» sobre un alta que sigue acabando antes sería la
   *               misma mentira que este módulo existe para evitar.
   *  - "ninguno": solo número de A3 y estado.
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
        // Sin destino la solicitud no se mueve de sitio: el modal es para el ALTA.
        estado: destino || null,
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

      const cambioEstado = destino ? ` y pasa a «${estadoSolicitudAltaLabels[destino]}»` : "";
      setAviso(
        registrar
          ? `${solicitud.codigo}: ${
              modo === "ampliar" ? `el alta ${numeroAltaReferencia(solicitud)} queda ampliada` : `el alta ${numero} queda registrada`
            } en MerchanOps${cambioEstado}.`
          : `${solicitud.codigo}: número de A3 guardado${cambioEstado}. No se ha registrado ningún alta.`
      );
      await cargarCola();
      await recargarAltas();
    } catch (err) {
      setError(`No se pudo tramitar ${solicitud.codigo}: ${mensaje(err)}`);
      await cargarCola();
    } finally {
      setGuardandoId("");
    }
  }

  if (!session?.active) return <Gate texto="Inicia sesión en MerchanOps para acceder a RR.HH." />;
  if (!canAccessModule(session, "rrhh")) return <Gate texto="No tienes permiso para acceder al módulo de RR.HH." />;

  const gestionaRrhh = canManageRrhh(session);

  // Qué campos del modal viajan de verdad: los que no, se enseñan apagados en vez
  // de desaparecer, para que se vea qué se está dejando de guardar.
  const tramite = peticionTramite;
  const registraAlta = Boolean(tramite && tramite.modo !== "ninguno" && tramite.registrar);
  const camposDeAltaNueva = registraAlta && tramite?.modo === "crear";
  const destinosTramite = tramite ? ESTADOS_TRAMITE.filter(estado => puedeTransicionar(tramite.solicitud.estado, estado)) : [];

  const todoVisibleMarcado = visibles.length > 0 && visibles.every(trabajo => claves.has(claveTrabajo(trabajo)));
  const todaLaColaMarcada = cola.length > 0 && cola.every(solicitud => clavesCola.has(solicitud.id));
  const trabajandoCola = Boolean(progresoCola);

  return (
    <main className="min-h-screen bg-slate-100 p-4 text-slate-900">
      {/* El hueco de abajo deja sitio al contador flotante: nunca tapa una fila. */}
      <section className="mx-auto max-w-7xl space-y-4 pb-28">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h1 className="mo-page-title text-3xl font-bold">Altas laborales</h1>
            <p className="text-sm text-slate-500">Alta en A3 e imputaciones por CECO de los trabajos pendientes.</p>
          </div>
          <button
            onClick={() => {
              void cargarCarga(false);
              void cargarCola();
            }}
            disabled={cargandoCola || cargandoCarga}
            className="rounded-2xl border bg-white px-4 py-2 text-sm font-semibold disabled:opacity-50"
          >
            <RefreshCw className="mr-1 inline h-4 w-4" />
            Actualizar
          </button>
        </div>

        {aviso && <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">{aviso}</div>}
        {error && <div className="rounded-2xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>}

        {/* ---------- Tarjeta de trabajo: TODA la carga, agrupada por trabajador ---------- */}
        <div className="rounded-3xl border bg-white p-4 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-xl font-semibold">
              Trabajos pendientes de alta · {visibles.length}
              {visibles.length !== pendientes.length ? ` de ${pendientes.length}` : ""} · {grupos.length}{" "}
              {grupos.length === 1 ? "trabajador" : "trabajadores"}
            </h2>
            <button
              onClick={() => alternarLote(visibles, !todoVisibleMarcado)}
              disabled={!visibles.length}
              className="rounded-2xl border bg-white px-4 py-2 text-sm font-semibold disabled:opacity-50"
            >
              {todoVisibleMarcado ? "Desmarcar todo lo visible" : "Marcar todo lo visible"}
            </button>
          </div>

          <div className="mt-3 grid gap-3 md:grid-cols-[1fr_240px_auto]">
            <label className="flex items-center gap-2 rounded-2xl border bg-white px-3 py-2">
              <Search className="h-4 w-4 shrink-0 text-slate-400" />
              <input
                value={busqueda}
                onChange={event => setBusqueda(event.target.value)}
                placeholder="Buscar por trabajador, campaña o CECO..."
                aria-label="Buscar en los trabajos pendientes"
                className="w-full bg-transparent text-sm outline-none"
              />
            </label>
            <select
              value={enfocado}
              onChange={event => irATrabajador(event.target.value)}
              aria-label="Ir al grupo de un trabajador"
              className="w-full rounded-2xl border bg-white px-3 py-2 text-sm"
            >
              <option value="">Ir a un trabajador...</option>
              {trabajadores.map(fila => (
                <option key={fila.id} value={fila.id}>
                  {fila.name?.trim() || fila.id}
                  {fila.province ? ` · ${fila.province}` : ""}
                </option>
              ))}
            </select>
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <input
                type="date"
                value={desde}
                onChange={event => setDesde(event.target.value)}
                aria-label="Trabajos desde"
                className="rounded-2xl border bg-white px-3 py-2 text-sm"
              />
              <span className="text-slate-400">→</span>
              <input
                type="date"
                value={hasta}
                onChange={event => setHasta(event.target.value)}
                aria-label="Trabajos hasta"
                className="rounded-2xl border bg-white px-3 py-2 text-sm"
              />
              {(desde || hasta) && (
                <button
                  onClick={() => {
                    setDesde("");
                    setHasta("");
                  }}
                  className="rounded-2xl border bg-white px-3 py-2 text-sm font-semibold"
                >
                  Quitar fechas
                </button>
              )}
            </div>
          </div>
          <p className="mt-2 text-xs text-slate-400">
            El selector de trabajador no filtra: despliega su grupo y lleva la pantalla hasta él, para que lo marcado en otros
            trabajadores no desaparezca de la vista.
          </p>

          {cargandoCarga && <p className="mt-3 text-sm text-slate-500">Cargando los trabajos pendientes de todos los trabajadores...</p>}

          {!cargandoCarga && pendientes.length === 0 && (
            <div className="mt-3 rounded-2xl bg-slate-50 p-4">
              <p className="font-semibold">No hay ningún trabajo pendiente de alta.</p>
              <p className="text-sm text-slate-500">
                Aquí aparecen las campañas y servicios ya asignados que todavía no están respaldados por un alta ni por una solicitud
                viva. Si esperabas ver alguno, revisa la asignación en su campaña o servicio de origen.
              </p>
            </div>
          )}

          {!cargandoCarga && pendientes.length > 0 && grupos.length === 0 && (
            <div className="mt-3 rounded-2xl bg-slate-50 p-4">
              <p className="font-semibold">Ningún trabajo encaja con estos filtros.</p>
              <p className="text-sm text-slate-500">Prueba a vaciar el buscador o el rango de fechas.</p>
            </div>
          )}

          {!cargandoCarga && grupos.length > 0 && (
            <div className="mt-3 space-y-2">
              {grupos.map(grupo => {
                const abierto = abiertos.includes(grupo.workerId);
                const marcadosGrupo = grupo.trabajos.filter(trabajo => claves.has(claveTrabajo(trabajo))).length;
                const todoElGrupo = marcadosGrupo === grupo.trabajos.length;
                return (
                  <div
                    key={grupo.workerId}
                    ref={nodo => {
                      nodosGrupo.current[grupo.workerId] = nodo;
                    }}
                    className="rounded-2xl border"
                  >
                    <div className={`flex items-center gap-3 rounded-2xl p-3 ${marcadosGrupo ? "bg-slate-50" : "bg-white"}`}>
                      <Casilla
                        marcada={todoElGrupo && marcadosGrupo > 0}
                        parcial={marcadosGrupo > 0 && !todoElGrupo}
                        onChange={() => alternarLote(grupo.trabajos, !todoElGrupo)}
                        etiqueta={`Marcar los ${grupo.trabajos.length} trabajos de ${grupo.nombre}`}
                      />
                      <button
                        onClick={() => abrirGrupo(grupo.workerId, !abierto)}
                        aria-expanded={abierto}
                        className="flex min-w-0 flex-1 items-center gap-2 text-left"
                      >
                        {abierto ? (
                          <ChevronDown className="h-4 w-4 shrink-0 text-slate-400" />
                        ) : (
                          <ChevronRight className="h-4 w-4 shrink-0 text-slate-400" />
                        )}
                        <span className="min-w-0">
                          <span className="block truncate font-semibold">{grupo.nombre}</span>
                          <span className="block text-sm text-slate-500">
                            {grupo.trabajos.length} {grupo.trabajos.length === 1 ? "trabajo pendiente" : "trabajos pendientes"}
                            {marcadosGrupo ? ` · ${marcadosGrupo} marcados` : ""}
                          </span>
                        </span>
                      </button>
                    </div>

                    {abierto && (
                      <div className="space-y-2 border-t p-3">
                        {grupo.trabajos.map(trabajo => {
                          const clave = claveTrabajo(trabajo);
                          const marcado = claves.has(clave);
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
                  </div>
                );
              })}
            </div>
          )}

          {/* Lo que CALCULA el sistema, una línea por trabajador marcado. */}
          <div className="mt-4 border-t pt-4">
            {resoluciones.length === 0 ? (
              <p className={`text-sm ${CLASE_TONO.vacio}`}>Marca trabajos para calcular las altas.</p>
            ) : (
              <ul className="space-y-1">
                {resoluciones.map(({ grupo, resolucion }) => (
                  <li key={grupo.workerId} className={`text-sm ${CLASE_TONO[resolucion.tono]}`}>
                    <span className="font-semibold text-slate-700">{grupo.nombre}</span> · {resolucion.texto}
                  </li>
                ))}
              </ul>
            )}
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

          {/* Barra de acciones en bloque: solo cuando hay algo marcado. */}
          {gestionaRrhh && marcadasCola.length > 0 && (
            <div className="mt-3 rounded-2xl border bg-slate-50 p-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-semibold">
                  {marcadasCola.length} {marcadasCola.length === 1 ? "solicitud marcada" : "solicitudes marcadas"}
                </span>
                {ACCIONES_COLA.map(destino => (
                  <button
                    key={destino}
                    onClick={() => pedirCambioEstado(marcadasCola, destino)}
                    disabled={trabajandoCola}
                    className="rounded-2xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
                  >
                    {destino === "rechazada" ? "Rechazar" : `Marcar como ${estadoSolicitudAltaLabels[destino]}`}
                  </button>
                ))}
                <button
                  onClick={() => setSeleccionCola([])}
                  disabled={trabajandoCola}
                  className="rounded-2xl border bg-white px-4 py-2 text-sm font-semibold disabled:opacity-50"
                >
                  Quitar marcas
                </button>
                {trabajandoCola && <span className="text-sm text-slate-500">Aplicando {progresoCola}</span>}
              </div>
              <p className="mt-2 text-xs text-slate-500">
                Marcar como tramitada mueve el estado y nada más. Mientras no se registre el alta real con «Registrar alta…», el sistema
                seguirá proponiendo alta nueva para los próximos trabajos de ese trabajador.
              </p>
            </div>
          )}

          {cargandoCola && <p className="mt-3 text-sm text-slate-500">Cargando cola de altas...</p>}

          {!cargandoCola && cola.length === 0 && (
            <div className="mt-3 rounded-2xl bg-slate-50 p-4">
              <p className="font-semibold">No hay solicitudes de alta con estos filtros.</p>
              <p className="text-sm text-slate-500">
                Marca los trabajos pendientes de arriba y pulsa «Tramitar» para que aparezcan aquí.
              </p>
            </div>
          )}

          {!cargandoCola && cola.length > 0 && (
            <div className="mt-3 overflow-auto">
              <table className="w-full min-w-[1200px] text-sm">
                <thead>
                  <tr className="bg-slate-50">
                    <th className="p-2 text-left">
                      <input
                        type="checkbox"
                        checked={todaLaColaMarcada}
                        onChange={() => alternarColaLote(cola, !todaLaColaMarcada)}
                        aria-label="Marcar todas las solicitudes visibles"
                      />
                    </th>
                    <th className="p-2 text-left">Sol.</th>
                    <th className="p-2 text-left">Gestora</th>
                    <th className="bg-slate-100 p-2 text-left">A3</th>
                    <th className="p-2 text-left">Trabajador</th>
                    <th className="p-2 text-left">CECO</th>
                    <th className="p-2 text-left">Campaña</th>
                    <th className="p-2 text-left">FI → FF</th>
                    <th className="p-2 text-left">Horas</th>
                    <th className="bg-slate-100 p-2 text-left">Estado</th>
                    <th className="p-2 text-left">Alta real</th>
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
                          <input
                            type="checkbox"
                            className="mt-2"
                            checked={clavesCola.has(solicitud.id)}
                            onChange={() => alternarCola(solicitud.id)}
                            aria-label={`Marcar ${solicitud.codigo}`}
                          />
                        </td>
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
                        <td className="p-2 text-slate-500">{formateaHoras(solicitud.horas_dia) || "—"}</td>
                        {/* El desplegable conserva el color del badge: RR.HH. lee el estado de un vistazo. */}
                        <td className="bg-slate-50 p-2">
                          {gestionaRrhh && destinos.length > 0 ? (
                            <select
                              value={solicitud.estado}
                              onChange={event => pedirCambioEstado([solicitud], event.target.value as EstadoSolicitudAlta)}
                              disabled={guardando || trabajandoCola}
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
                        <td className="p-2">
                          {gestionaRrhh ? (
                            <button
                              onClick={() => {
                                setErrorTramite("");
                                setPeticionTramite(borradorTramite(solicitud));
                              }}
                              disabled={guardando || trabajandoCola}
                              className="rounded-2xl border bg-white px-3 py-2 text-xs font-semibold disabled:opacity-50"
                            >
                              Registrar alta…
                            </button>
                          ) : (
                            <span className="text-xs text-slate-400">{solicitud.alta_id ? "Registrada" : "—"}</span>
                          )}
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

      {/* ---------- Contador flotante: siempre a la vista mientras haya marcas ---------- */}
      {marcados.length > 0 && (
        <div className="pointer-events-none fixed inset-x-0 bottom-0 z-40 flex justify-center p-4">
          <div className="pointer-events-auto flex flex-wrap items-center gap-3 rounded-2xl bg-slate-900 px-4 py-3 text-sm text-white shadow-lg">
            <span className="font-semibold">
              {marcados.length} {marcados.length === 1 ? "trabajo marcado" : "trabajos marcados"} · {gruposMarcados.length}{" "}
              {gruposMarcados.length === 1 ? "trabajador" : "trabajadores"}
            </span>
            {marcadosOcultos > 0 && <span className="text-slate-300">{marcadosOcultos} fuera del filtro</span>}
            <button
              onClick={() => setSeleccion([])}
              disabled={tramitando}
              className="rounded-2xl border border-white/40 px-3 py-2 font-semibold disabled:opacity-50"
            >
              Quitar marcas
            </button>
            <button
              onClick={() => void tramitarLote()}
              disabled={tramitando}
              className="rounded-2xl bg-white px-4 py-2 font-semibold text-slate-900 disabled:opacity-50"
            >
              <Send className="mr-1 inline h-4 w-4" />
              {tramitando
                ? `Tramitando ${progreso}`
                : gruposMarcados.length === 1
                  ? "Tramitar 1 solicitud"
                  : `Tramitar ${gruposMarcados.length} solicitudes`}
            </button>
          </div>
        </div>
      )}

      {peticionMotivo && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
          <div className="w-full max-w-md rounded-3xl border bg-white p-4 shadow-sm">
            <h3 className="text-lg font-semibold">Motivo obligatorio</h3>
            <p className="mt-1 text-sm text-slate-500">
              Para pasar{" "}
              {peticionMotivo.solicitudes.length === 1
                ? peticionMotivo.solicitudes[0].codigo
                : `${peticionMotivo.solicitudes.length} solicitudes`}{" "}
              a «{estadoSolicitudAltaLabels[peticionMotivo.destino]}» hace falta una explicación escrita: queda en la auditoría y no se
              puede deshacer.
              {peticionMotivo.solicitudes.length > 1 && " El mismo motivo se guarda en todas."}
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
            <h3 className="text-lg font-semibold">Registrar el alta de A3</h3>
            <p className="mt-1 text-sm text-slate-500">
              {tramite.solicitud.codigo}
              {tramite.solicitud.worker_nombre ? ` · ${tramite.solicitud.worker_nombre}` : ""}. Este paso es opcional: sirve para que el
              alta REAL quede en MerchanOps y las coberturas futuras se calculen contra ella.
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
                <span className="font-medium">Estado al guardar</span>
                <select
                  value={tramite.destino}
                  onChange={event => cambiaTramite({ destino: event.target.value as EstadoSolicitudAlta | "" })}
                  aria-label="Estado de la solicitud al guardar"
                  className="mt-1 w-full rounded-2xl border bg-white px-3 py-2 text-sm"
                >
                  <option value="">Dejarlo como está ({estadoSolicitudAltaLabels[tramite.solicitud.estado]})</option>
                  {destinosTramite.map(estado => (
                    <option key={estado} value={estado}>
                      {estadoSolicitudAltaLabels[estado]}
                    </option>
                  ))}
                </select>
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
                Guardar
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

/**
 * Casilla de grupo con estado intermedio. `indeterminate` no es un atributo de
 * HTML sino una propiedad del nodo, así que hay que ponerla a mano: sin ella,
 * un grupo a medio marcar se vería igual que uno vacío.
 */
function Casilla({
  marcada,
  parcial,
  onChange,
  etiqueta
}: {
  marcada: boolean;
  parcial: boolean;
  onChange: () => void;
  etiqueta: string;
}) {
  const nodo = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (nodo.current) nodo.current.indeterminate = parcial;
  }, [parcial]);
  return <input ref={nodo} type="checkbox" checked={marcada} onChange={onChange} aria-label={etiqueta} />;
}

/**
 * Agrupa los trabajos por trabajador. El orden es por CARGA descendente —quien
 * más trabajos acumula sale arriba, que es por donde se empieza a despachar— y a
 * igualdad, alfabético. Como el primer grupo es el único que arranca desplegado,
 * lo que se ve al abrir la pantalla es justo el montón más grande.
 */
function agrupaPorTrabajador(trabajos: TrabajoPendiente[], trabajadores: FilaTrabajador[]): GrupoTrabajador[] {
  const nombres = new Map(trabajadores.map(fila => [fila.id, fila.name?.trim() || fila.id]));
  const grupos = new Map<string, GrupoTrabajador>();
  for (const trabajo of trabajos) {
    const workerId = String(trabajo.worker_id ?? "");
    if (!workerId) continue;
    const grupo = grupos.get(workerId);
    if (grupo) grupo.trabajos.push(trabajo);
    // Un trabajo asignado a alguien que ya no está en `workers` no se esconde: se
    // enseña con su id, porque el trabajo existe y alguien tendrá que resolverlo.
    else grupos.set(workerId, { workerId, nombre: nombres.get(workerId) ?? workerId, trabajos: [trabajo] });
  }
  return Array.from(grupos.values()).sort((a, b) => {
    if (a.trabajos.length !== b.trabajos.length) return b.trabajos.length - a.trabajos.length;
    return a.nombre.localeCompare(b.nombre, "es");
  });
}

/** Identidad de un trabajo pendiente: trabajador + el par polimórfico origen_tipo/origen_id. */
function claveTrabajo(trabajo: TrabajoPendiente) {
  return `${trabajo.worker_id}:${trabajo.origen_tipo}:${trabajo.origen_id}`;
}

/** «3136 · 28/07 → 29/07 · 3 h/día», saltando lo que no haya. */
function lineaGris(trabajo: TrabajoPendiente) {
  const inicio = formateaFechaCorta(trabajo.fecha_inicio);
  const fin = formateaFechaCorta(trabajo.fecha_fin);
  return [String(trabajo.ceco ?? "").trim(), inicio && fin ? `${inicio} → ${fin}` : inicio || fin, formateaHoras(trabajo.horas_dia)]
    .filter(Boolean)
    .join(" · ");
}

/**
 * Horas/día de la cabecera de la solicitud. Se manda la mayor de la selección:
 * cada línea conserva las suyas, así que no se pierde nada, y la cabecera no se
 * queda corta respecto a ninguno de los trabajos que ampara.
 */
function horasDeLaSeleccion(trabajos: TrabajoPendiente[]): number | null {
  const horas = trabajos
    .map(trabajo => trabajo.horas_dia)
    .filter((valor): valor is number => typeof valor === "number" && Number.isFinite(valor));
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

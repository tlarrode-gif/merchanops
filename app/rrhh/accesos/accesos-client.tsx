"use client";

/**
 * MerchanOps · RR.HH. — Accesos a centro.
 *
 * QUÉ RESUELVE
 * La gestora elige cadena y fecha de trabajo, marca los chips de los trabajadores
 * y de los centros donde se va a trabajar, y el SISTEMA dice —en gris, sin que
 * nadie teclee nada— cuántas solicitudes salen de ahí y hasta cuándo hay plazo:
 *
 *   «Alcampo tramita por centro · 3 centros → 3 accesos · pedir antes del 29/07»
 *   «Media Markt tramita por cadena · 4 centros → 1 acceso · pedir antes del 31/07»
 *   «El Corte Inglés · plazo vencido el 25/07»
 *
 * Con varios trabajadores marcados ese mismo texto se multiplica y lo dice:
 *
 *   «Alcampo tramita por centro · 3 centros → 12 accesos · pedir antes del 29/07 · para 4 trabajadores»
 *
 * «Solicitar» convierte esa lectura en solicitudes reales. La expansión por modo
 * de trámite la hace `merchan_rrhh_solicitar_acceso`: aquí se calcula solo para
 * ENSEÑARLA, nunca para decidirla. Si el catálogo cambia entre el cálculo y el
 * envío, manda la base, y por eso el aviso de éxito repite lo que devolvió ella
 * (códigos creados y centros omitidos), no lo que había pintado la pantalla.
 *
 * POR QUÉ EN BLOQUE
 * El RPC es de UN trabajador por llamada y su contrato no se toca. Para pedir a
 * varios se hace una llamada POR TRABAJADOR, en serie (no en paralelo: así el
 * contador de códigos y el índice de duplicados de la base no compiten entre sí)
 * y con progreso a la vista. Si una falla, las demás siguen y el error real de la
 * que falló sale escrito con nombre y apellidos.
 *
 * ALTA DE CENTRO EN LÍNEA
 * El catálogo nace con cadenas pero SIN centros. Obligar a salir a «Cadenas y
 * centros» y volver es justo la fricción que hacía esta pantalla más lenta que un
 * Excel: por eso el centro se crea aquí mismo, junto a los chips, y queda YA
 * MARCADO. Solo lo ve quien puede escribir en el catálogo (`canManageRrhh`); a
 * los demás la RLS de v10_5 les devolvería un 42501.
 *
 * QUIÉN PUEDE QUÉ
 *  - Cualquiera con permiso `rrhh` (los gestores lo tienen por defecto) SOLICITA.
 *  - Solo RR.HH. o administración RESUELVE: conceder, denegar, cancelar o marcar
 *    un acceso como no consumido (`canManageRrhh`). Es la leyenda del diseño: el
 *    texto gris lo calcula el sistema, «Estado» lo rellena RRHH.
 * Esta pantalla no es la frontera: la de verdad es la RLS y el gate
 * `merchan_is_rrhh()` de los RPC. Aquí solo se evita ofrecer lo que va a fallar.
 *
 * CONCURRENCIA
 * Cada resolución envía el `version` que se leyó. Si otra persona tocó el acceso
 * entretanto, el RPC lo rechaza en vez de pisarlo: aquí se enseña el mensaje real
 * y se recarga la tabla. En bloque vale lo mismo, fila a fila.
 */

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Ban, Building2, Check, Plus, RefreshCw, Search, Send } from "lucide-react";
import { AppSession, canAccessModule, canManageRrhh, getCurrentAppSession, merchanopsSessionChangeEvent } from "@/lib/access-control";
import {
  Cadena,
  Centro,
  EstadoSolicitudAcceso,
  SolicitudAcceso,
  estadoSolicitudAccesoClases,
  estadoSolicitudAccesoLabels
} from "@/lib/rrhh/tipos";
import { TextoAcceso, accesosNecesarios, esConcedidoNoConsumido, exigeMotivoAcceso, puedeTransicionarAcceso, textoSolicitudAcceso } from "@/lib/rrhh/accesos";
import { formateaFechaCorta } from "@/lib/rrhh/altas";
import {
  PayloadResolverAcceso,
  PayloadSolicitarAcceso,
  crearSolicitudesAcceso,
  guardarCentro,
  listarCadenas,
  listarCentros,
  listarSolicitudesAcceso,
  listarTrabajadores,
  resolverSolicitudAcceso
} from "@/lib/rrhh/datos";

/** Lo que devuelve `listarTrabajadores()`. */
type FilaTrabajador = Awaited<ReturnType<typeof listarTrabajadores>>[number];

const TODOS_LOS_ESTADOS = Object.keys(estadoSolicitudAccesoLabels) as EstadoSolicitudAcceso[];

/** Las dos decisiones que se toman en bloque desde la tabla. */
const ESTADOS_EN_BLOQUE: EstadoSolicitudAcceso[] = ["concedido", "denegado"];

/** Cuántos códigos se listan en el aviso antes de resumir por número. */
const MAX_CODIGOS_EN_AVISO = 8;

/** Cómo se pinta el texto calculado según lo que diga `textoSolicitudAcceso`. */
const CLASE_TONO: Record<TextoAcceso["tono"], string> = {
  neutro: "text-slate-500",
  aviso: "text-amber-700",
  error: "font-semibold text-red-700",
  vacio: "text-slate-400"
};

/** Fondo de la fila cuando el estado pide que salte a la vista. */
const CLASE_FILA: Partial<Record<EstadoSolicitudAcceso, string>> = {
  fuera_de_plazo: "bg-red-50",
  concedido_no_consumido: "bg-amber-50"
};

export function AccesosClient() {
  const [session, setSession] = useState<AppSession | null>(null);

  // Catálogo
  const [trabajadores, setTrabajadores] = useState<FilaTrabajador[]>([]);
  const [cadenas, setCadenas] = useState<Cadena[]>([]);
  const [centros, setCentros] = useState<Centro[]>([]);
  const [cargandoCentros, setCargandoCentros] = useState(false);

  // Tarjeta de trabajo
  const [workerIds, setWorkerIds] = useState<string[]>([]);
  const [buscaTrabajador, setBuscaTrabajador] = useState("");
  const [cadenaId, setCadenaId] = useState("");
  const [fechaTrabajo, setFechaTrabajo] = useState("");
  const [marcados, setMarcados] = useState<string[]>([]);
  const [solicitando, setSolicitando] = useState(false);
  const [progresoSolicitud, setProgresoSolicitud] = useState("");

  // Alta de centro en línea (solo RR.HH.)
  const [nombreCentro, setNombreCentro] = useState("");
  const [poblacionCentro, setPoblacionCentro] = useState("");
  const [creandoCentro, setCreandoCentro] = useState(false);

  // Tabla de accesos
  const [solicitudes, setSolicitudes] = useState<SolicitudAcceso[]>([]);
  const [cargandoTabla, setCargandoTabla] = useState(true);
  const [consulta, setConsulta] = useState("");
  const [filtroCadena, setFiltroCadena] = useState("");
  const [seleccionTabla, setSeleccionTabla] = useState<string[]>([]);
  const [procesando, setProcesando] = useState<string[]>([]);
  const [progresoLote, setProgresoLote] = useState("");

  // Avisos
  const [error, setError] = useState("");
  const [aviso, setAviso] = useState("");

  // Modal de motivo (nada se cierra en negativo sin explicación escrita).
  // Guarda una LISTA: una fila sola y un lote de cincuenta usan el mismo camino.
  const [peticionMotivo, setPeticionMotivo] = useState<{ accesos: SolicitudAcceso[]; destino: EstadoSolicitudAcceso } | null>(null);
  const [motivo, setMotivo] = useState("");
  const [errorMotivo, setErrorMotivo] = useState("");

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

  const cargarTabla = useCallback(async () => {
    setCargandoTabla(true);
    try {
      setSolicitudes(await listarSolicitudesAcceso());
      setError("");
    } catch (err) {
      setSolicitudes([]);
      setError(`No se pudo cargar la tabla de accesos: ${mensaje(err)}`);
    } finally {
      setCargandoTabla(false);
    }
  }, []);

  const cargarCatalogo = useCallback(async () => {
    try {
      const [filas, catalogo] = await Promise.all([listarTrabajadores(), listarCadenas()]);
      setTrabajadores(filas);
      setCadenas(catalogo);
    } catch (err) {
      setTrabajadores([]);
      setCadenas([]);
      setError(`No se pudo cargar el catálogo de RR.HH.: ${mensaje(err)}`);
    }
  }, []);

  const activa = Boolean(session?.active);

  useEffect(() => {
    if (!activa) return;
    void cargarCatalogo();
    void cargarTabla();
  }, [activa, cargarCatalogo, cargarTabla]);

  // Centros de la cadena elegida. Al cambiar de cadena se limpia la selección:
  // un chip marcado de otra cadena no significa nada y no puede viajar al RPC.
  useEffect(() => {
    setMarcados([]);
    setNombreCentro("");
    setPoblacionCentro("");
    if (!cadenaId) {
      setCentros([]);
      return;
    }
    let cancelado = false;
    setCargandoCentros(true);
    (async () => {
      try {
        const filas = await listarCentros(cadenaId);
        if (cancelado) return;
        setCentros(filas);
        setError("");
      } catch (err) {
        if (cancelado) return;
        setCentros([]);
        setError(`No se pudieron cargar los centros de la cadena: ${mensaje(err)}`);
      } finally {
        if (!cancelado) setCargandoCentros(false);
      }
    })();
    return () => {
      cancelado = true;
    };
  }, [cadenaId]);

  const cadenaElegida = useMemo(() => cadenas.find(cadena => cadena.id === cadenaId) ?? null, [cadenas, cadenaId]);

  // Se recorren en el orden del catálogo, no en el de los clics: así el progreso
  // («3 de 7: Sara María») es el mismo que se lee en los chips.
  const trabajadoresMarcados = useMemo(
    () => trabajadores.filter(fila => workerIds.includes(fila.id)),
    [trabajadores, workerIds]
  );

  // Chips de trabajador: se filtran al escribir, pero los ya marcados NUNCA se
  // esconden (si no, se perderían de vista selecciones hechas hace dos búsquedas).
  const trabajadoresVisibles = useMemo(() => {
    const aguja = buscaTrabajador.trim().toLowerCase();
    if (!aguja) return trabajadores;
    return trabajadores.filter(fila => {
      if (workerIds.includes(fila.id)) return true;
      return `${fila.name ?? ""} ${fila.province ?? ""}`.toLowerCase().includes(aguja);
    });
  }, [trabajadores, buscaTrabajador, workerIds]);

  // Solo se ofrecen centros activos: los dados de baja siguen en el histórico de
  // la tabla de abajo, pero no se pueden pedir de nuevo.
  const centrosActivos = useMemo(() => centros.filter(centro => centro.activo), [centros]);
  const centrosMarcados = useMemo(() => centrosActivos.filter(centro => marcados.includes(centro.id)), [centrosActivos, marcados]);

  /** Accesos que sale a UN trabajador. Multiplicado por los marcados da el total. */
  const accesosPorTrabajador = useMemo(
    () => (cadenaElegida ? accesosNecesarios(cadenaElegida, centrosMarcados).length : 0),
    [cadenaElegida, centrosMarcados]
  );

  /** El texto gris del diseño. Se recalcula solo, nadie lo teclea. */
  const resultado = useMemo<TextoAcceso>(() => {
    if (!cadenaElegida) return { texto: "Elige la cadena para calcular la solicitud", tono: "vacio" };
    const base = textoSolicitudAcceso(cadenaElegida, centrosMarcados, fechaTrabajo);
    return conVariosTrabajadores(base, accesosPorTrabajador, trabajadoresMarcados.length);
  }, [cadenaElegida, centrosMarcados, fechaTrabajo, accesosPorTrabajador, trabajadoresMarcados.length]);

  const tabla = useMemo(() => {
    const aguja = consulta.trim().toLowerCase();
    return solicitudes.filter(acceso => {
      if (filtroCadena && acceso.cadena_id !== filtroCadena) return false;
      if (!aguja) return true;
      const heno = [
        acceso.codigo,
        acceso.worker_nombre,
        acceso.cadena_nombre,
        acceso.centro_nombre,
        acceso.trabajo,
        acceso.solicitada_por_nombre
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return heno.includes(aguja);
    });
  }, [solicitudes, filtroCadena, consulta]);

  /** Filas que admiten alguna decisión en bloque: el resto ni se puede marcar. */
  const filasEnBloque = useMemo(
    () => tabla.filter(acceso => ESTADOS_EN_BLOQUE.some(destino => puedeTransicionarAcceso(acceso.estado, destino))),
    [tabla]
  );

  const accesosMarcados = useMemo(
    () => filasEnBloque.filter(acceso => seleccionTabla.includes(acceso.id)),
    [filasEnBloque, seleccionTabla]
  );

  function alternarCentro(centro: Centro) {
    setMarcados(previa => (previa.includes(centro.id) ? previa.filter(id => id !== centro.id) : [...previa, centro.id]));
  }

  function alternarTrabajador(id: string) {
    setWorkerIds(previa => (previa.includes(id) ? previa.filter(x => x !== id) : [...previa, id]));
  }

  function alternarFila(id: string) {
    setSeleccionTabla(previa => (previa.includes(id) ? previa.filter(x => x !== id) : [...previa, id]));
  }

  /** Crea el centro en la cadena elegida y lo deja YA marcado. */
  async function anadirCentro() {
    if (!cadenaId || creandoCentro) return;
    const nombre = nombreCentro.trim();
    if (!nombre) {
      setError("El centro necesita un nombre para poder crearlo.");
      return;
    }
    setCreandoCentro(true);
    setError("");
    try {
      const creado = await guardarCentro({
        cadena_id: cadenaId,
        nombre,
        poblacion: poblacionCentro.trim() || null
      });
      // Se inserta en su sitio alfabético, igual que lo devolvería `listarCentros`.
      setCentros(previa =>
        [...previa.filter(centro => centro.id !== creado.id), creado].sort((a, b) => a.nombre.localeCompare(b.nombre, "es"))
      );
      setMarcados(previa => (previa.includes(creado.id) ? previa : [...previa, creado.id]));
      setNombreCentro("");
      setPoblacionCentro("");
      setAviso(`Centro «${creado.nombre}» dado de alta y marcado.`);
    } catch (err) {
      setError(`No se pudo crear el centro: ${mensaje(err)}`);
    } finally {
      setCreandoCentro(false);
    }
  }

  /**
   * Una llamada al RPC por trabajador, en serie. Si una falla se sigue con las
   * demás y su error real se enseña al final: nada se traga en silencio.
   */
  async function solicitar() {
    if (!cadenaElegida || !centrosMarcados.length || !fechaTrabajo || !trabajadoresMarcados.length) return;
    setSolicitando(true);
    setError("");
    setAviso("");
    try {
      // La expansión por modo de trámite la hace el RPC; se le manda ya la lista
      // deduplicada que calcula `accesosNecesarios`. En modo 'cadena' esa lista
      // es una sola entrada sin centro, así que ahí se envían los chips tal cual:
      // la base los ignora, pero quedan en el payload para la auditoría.
      const accesos = accesosNecesarios(cadenaElegida, centrosMarcados);
      const centrosPayload =
        cadenaElegida.modo_tramite === "cadena"
          ? centrosMarcados.map(centro => centro.id)
          : accesos.map(acceso => acceso.centro_id).filter((id): id is string => Boolean(id));

      const codigos: string[] = [];
      const motivosOmitidos: string[] = [];
      const fallos: string[] = [];
      let omitidas = 0;
      let trabajadoresConAlta = 0;
      let fechaLimite: string | null = null;
      let algunoFueraDePlazo = false;

      for (let indice = 0; indice < trabajadoresMarcados.length; indice += 1) {
        const trabajador = trabajadoresMarcados[indice];
        const nombre = trabajador.name?.trim() || trabajador.id;
        setProgresoSolicitud(`Solicitando ${indice + 1} de ${trabajadoresMarcados.length}: ${nombre}...`);
        const payload: PayloadSolicitarAcceso = {
          worker_id: trabajador.id,
          worker_nombre: trabajador.name?.trim() || null,
          cadena_id: cadenaElegida.id,
          fecha_trabajo: fechaTrabajo,
          centros: centrosPayload
        };
        try {
          const creado = await crearSolicitudesAcceso(payload);
          const nuevos = creado.creadas.map(fila => fila.codigo).filter(Boolean);
          if (nuevos.length) trabajadoresConAlta += 1;
          codigos.push(...nuevos);
          omitidas += creado.omitidas.length;
          for (const fila of creado.omitidas) {
            if (fila.motivo && !motivosOmitidos.includes(fila.motivo)) motivosOmitidos.push(fila.motivo);
          }
          if (!fechaLimite && creado.fecha_limite) fechaLimite = creado.fecha_limite;
          if (creado.estado === "fuera_de_plazo") algunoFueraDePlazo = true;
        } catch (err) {
          fallos.push(`${nombre}: ${mensaje(err)}`);
        }
      }

      const listaCodigos =
        codigos.length <= MAX_CODIGOS_EN_AVISO
          ? codigos.join(", ")
          : `${codigos.slice(0, MAX_CODIGOS_EN_AVISO).join(", ")} y ${codigos.length - MAX_CODIGOS_EN_AVISO} más`;
      const paraTrabajadores =
        trabajadoresMarcados.length > 1 ? ` para ${trabajadoresConAlta} de ${trabajadoresMarcados.length} trabajadores` : "";

      const partes = [
        codigos.length
          ? `${codigos.length} ${codigos.length === 1 ? "solicitud creada" : "solicitudes creadas"}${paraTrabajadores}: ${listaCodigos}.`
          : "No se creó ninguna solicitud nueva.",
        omitidas ? `${omitidas} sin duplicar (${motivosOmitidos.join(" · ") || "ya existían"}).` : "",
        fechaLimite ? `Fecha límite ${formateaFechaCorta(fechaLimite)}.` : "",
        algunoFueraDePlazo ? "Atención: nace fuera de plazo." : ""
      ].filter(Boolean);
      setAviso(partes.join(" "));

      if (fallos.length) {
        setError(
          `${fallos.length} ${fallos.length === 1 ? "trabajador se quedó sin solicitud" : "trabajadores se quedaron sin solicitud"}: ${fallos.join(" · ")}`
        );
      }

      setMarcados([]);
      await cargarTabla();
    } catch (err) {
      setError(`No se pudo solicitar el acceso: ${mensaje(err)}`);
    } finally {
      setProgresoSolicitud("");
      setSolicitando(false);
    }
  }

  /** Puerta única de cambio de estado: valida, pide motivo si toca y aplica. */
  function pedirCambioEstado(accesos: SolicitudAcceso[], destino: EstadoSolicitudAcceso) {
    // Elegir en el desplegable el estado que ya tiene la fila no es un cambio.
    if (accesos.length === 1 && accesos[0].estado === destino) return;
    const aptos = accesos.filter(acceso => puedeTransicionarAcceso(acceso.estado, destino));
    if (!aptos.length) {
      const uno = accesos[0];
      setError(
        accesos.length === 1 && uno
          ? `${uno.codigo} no puede pasar de «${estadoSolicitudAccesoLabels[uno.estado]}» a «${estadoSolicitudAccesoLabels[destino]}».`
          : `Ninguna de las ${accesos.length} solicitudes marcadas admite pasar a «${estadoSolicitudAccesoLabels[destino]}».`
      );
      return;
    }
    if (exigeMotivoAcceso(destino)) {
      setMotivo("");
      setErrorMotivo("");
      setPeticionMotivo({ accesos, destino });
      return;
    }
    void aplicarEstado(accesos, destino);
  }

  /**
   * Aplica el cambio fila a fila. Las que no admiten la transición se saltan (se
   * cuentan en el aviso) y un fallo no detiene al resto: cada error sale con su
   * código y su mensaje real.
   */
  async function aplicarEstado(accesos: SolicitudAcceso[], destino: EstadoSolicitudAcceso, motivoEscrito?: string) {
    const aptos = accesos.filter(acceso => puedeTransicionarAcceso(acceso.estado, destino));
    const saltadas = accesos.length - aptos.length;
    if (!aptos.length) return;

    setProcesando(aptos.map(acceso => acceso.id));
    setError("");
    setAviso("");

    const hechos: string[] = [];
    const fallos: string[] = [];

    for (let indice = 0; indice < aptos.length; indice += 1) {
      const acceso = aptos[indice];
      if (aptos.length > 1) setProgresoLote(`Resolviendo ${indice + 1} de ${aptos.length}: ${acceso.codigo}...`);
      const payload: PayloadResolverAcceso = {
        acceso_id: acceso.id,
        estado: destino,
        motivo: motivoEscrito?.trim() || null,
        version: acceso.version
      };
      // Volver a «Concedido» desde «Concedido no consumido» significa que sí se
      // usó: es la única transición que sella `consumido_at`.
      if (destino === "concedido" && acceso.estado === "concedido_no_consumido") payload.consumido = true;
      try {
        await resolverSolicitudAcceso(payload);
        hechos.push(acceso.codigo);
      } catch (err) {
        fallos.push(`${acceso.codigo}: ${mensaje(err)}`);
      }
    }

    const partes = [
      hechos.length === 1
        ? `${hechos[0]} pasa a «${estadoSolicitudAccesoLabels[destino]}».`
        : hechos.length
          ? `${hechos.length} solicitudes pasan a «${estadoSolicitudAccesoLabels[destino]}»: ${
              hechos.length <= MAX_CODIGOS_EN_AVISO
                ? hechos.join(", ")
                : `${hechos.slice(0, MAX_CODIGOS_EN_AVISO).join(", ")} y ${hechos.length - MAX_CODIGOS_EN_AVISO} más`
            }.`
          : "",
      saltadas ? `${saltadas} ${saltadas === 1 ? "omitida" : "omitidas"}: su estado no admite ese cambio.` : ""
    ].filter(Boolean);
    if (partes.length) setAviso(partes.join(" "));
    if (fallos.length) setError(`${fallos.length} sin cambiar: ${fallos.join(" · ")}`);

    setProgresoLote("");
    setProcesando([]);
    setSeleccionTabla([]);
    await cargarTabla();
  }

  async function confirmarMotivo() {
    if (!peticionMotivo) return;
    if (!motivo.trim()) {
      setErrorMotivo("El motivo es obligatorio: queda escrito en la auditoría.");
      return;
    }
    const { accesos, destino } = peticionMotivo;
    setPeticionMotivo(null);
    await aplicarEstado(accesos, destino, motivo);
    setMotivo("");
  }

  if (!session?.active) return <Gate texto="Inicia sesión en MerchanOps para acceder a RR.HH." />;
  if (!canAccessModule(session, "rrhh")) return <Gate texto="No tienes permiso para acceder al módulo de RR.HH." />;

  const gestionaRrhh = canManageRrhh(session);
  const puedeSolicitar =
    Boolean(trabajadoresMarcados.length && cadenaId && fechaTrabajo && centrosMarcados.length) && !solicitando;
  const enCurso = procesando.length > 0;
  const todasMarcadas = filasEnBloque.length > 0 && accesosMarcados.length === filasEnBloque.length;

  return (
    <main className="min-h-screen bg-slate-100 p-4 text-slate-900">
      <section className="mx-auto max-w-7xl space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h1 className="mo-page-title text-3xl font-bold">Accesos a centro</h1>
            <p className="text-sm text-slate-500">Solicitudes de acceso a los centros de cada cadena.</p>
          </div>
          <button
            onClick={() => void cargarTabla()}
            disabled={cargandoTabla}
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
          <div className="grid gap-3 md:grid-cols-2">
            <label className="block text-sm">
              <span className="font-medium">Cadena</span>
              <select
                value={cadenaId}
                onChange={event => setCadenaId(event.target.value)}
                className="mt-1 w-full rounded-2xl border bg-white px-3 py-2 text-sm"
              >
                <option value="">Selecciona una cadena...</option>
                {cadenas
                  .filter(cadena => cadena.activa || cadena.id === cadenaId)
                  .map(cadena => (
                    <option key={cadena.id} value={cadena.id}>
                      {cadena.nombre}
                    </option>
                  ))}
              </select>
            </label>
            <label className="block text-sm">
              <span className="font-medium">Fecha de trabajo</span>
              <input
                type="date"
                value={fechaTrabajo}
                onChange={event => setFechaTrabajo(event.target.value)}
                className="mt-1 w-full rounded-2xl border bg-white px-3 py-2 text-sm"
              />
            </label>
          </div>

          {/* ---------- Trabajadores (multi-selección) ---------- */}
          <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-lg font-semibold">
              Trabajadores
              {trabajadoresMarcados.length > 0 && (
                <span className="ml-2 text-sm font-normal text-slate-500">{trabajadoresMarcados.length} marcados</span>
              )}
            </h2>
            <div className="flex flex-wrap items-center gap-2">
              <label className="flex items-center gap-2 rounded-2xl border bg-white px-3 py-1.5">
                <Search className="h-4 w-4 shrink-0 text-slate-400" />
                <input
                  value={buscaTrabajador}
                  onChange={event => setBuscaTrabajador(event.target.value)}
                  placeholder="Filtrar trabajadores..."
                  aria-label="Filtrar trabajadores"
                  className="w-44 bg-transparent text-sm outline-none"
                />
              </label>
              {trabajadoresMarcados.length > 0 && (
                <button
                  type="button"
                  onClick={() => setWorkerIds([])}
                  className="rounded-2xl border bg-white px-3 py-1.5 text-sm font-semibold"
                >
                  Quitar selección
                </button>
              )}
            </div>
          </div>

          {trabajadores.length === 0 && (
            <p className="mt-2 rounded-2xl bg-slate-50 p-4 text-sm text-slate-500">
              No hay trabajadores en MerchanOps: sin ellos no hay accesos que pedir.
            </p>
          )}

          {trabajadores.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-2">
              {trabajadoresVisibles.map(fila => {
                const marcado = workerIds.includes(fila.id);
                return (
                  <button
                    key={fila.id}
                    type="button"
                    onClick={() => alternarTrabajador(fila.id)}
                    aria-pressed={marcado}
                    className={`rounded-full border px-3 py-1.5 text-sm ${
                      marcado ? "border-slate-900 bg-slate-900 text-white" : "bg-white"
                    }`}
                  >
                    {fila.name?.trim() || fila.id}
                    {fila.province ? <span className={marcado ? "text-slate-300" : "text-slate-400"}> · {fila.province}</span> : null}
                  </button>
                );
              })}
              {trabajadoresVisibles.length === 0 && (
                <p className="text-sm text-slate-500">Ningún trabajador coincide con «{buscaTrabajador.trim()}».</p>
              )}
            </div>
          )}

          {/* ---------- Centros ---------- */}
          <h2 className="mt-4 text-lg font-semibold">Centros de la cadena</h2>

          {!cadenaId && (
            <p className="mt-2 rounded-2xl bg-slate-50 p-4 text-sm text-slate-500">
              Elige una cadena para ver sus centros y marcar dónde se va a trabajar.
            </p>
          )}

          {cadenaId && cargandoCentros && <p className="mt-2 text-sm text-slate-500">Cargando centros...</p>}

          {cadenaId && !cargandoCentros && centrosActivos.length === 0 && (
            <div className="mt-2 rounded-2xl bg-slate-50 p-4">
              <p className="font-semibold">Esta cadena todavía no tiene centros activos.</p>
              <p className="text-sm text-slate-500">
                {gestionaRrhh
                  ? "Da de alta el primero aquí mismo: se queda marcado y ya puedes pedir el acceso sin salir de esta pantalla."
                  : "Los centros los mantiene RR.HH. en el catálogo: sin ninguno dado de alta no hay chips que marcar ni acceso que pedir."}
              </p>
              {gestionaRrhh && (
                <Link href="/rrhh/cadenas" className="mt-3 inline-flex text-sm font-semibold text-slate-500 underline">
                  Ver el catálogo completo en «Cadenas y centros»
                </Link>
              )}
            </div>
          )}

          {cadenaId && !cargandoCentros && centrosActivos.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-2">
              {centrosActivos.map(centro => {
                const marcado = marcados.includes(centro.id);
                return (
                  <button
                    key={centro.id}
                    type="button"
                    onClick={() => alternarCentro(centro)}
                    aria-pressed={marcado}
                    className={`rounded-full border px-3 py-1.5 text-sm ${
                      marcado ? "border-slate-900 bg-slate-900 text-white" : "bg-white"
                    }`}
                  >
                    {centro.nombre}
                    {centro.poblacion ? <span className={marcado ? "text-slate-300" : "text-slate-400"}> · {centro.poblacion}</span> : null}
                  </button>
                );
              })}
            </div>
          )}

          {/* Alta de centro EN LÍNEA: el catálogo se completa sin salir de aquí. */}
          {cadenaId && !cargandoCentros && gestionaRrhh && (
            <form
              onSubmit={event => {
                event.preventDefault();
                void anadirCentro();
              }}
              className="mt-3 flex flex-wrap items-center gap-2"
            >
              <input
                value={nombreCentro}
                onChange={event => setNombreCentro(event.target.value)}
                placeholder="Nombre del centro..."
                aria-label="Nombre del centro nuevo"
                className="w-56 rounded-2xl border bg-white px-3 py-1.5 text-sm"
              />
              <input
                value={poblacionCentro}
                onChange={event => setPoblacionCentro(event.target.value)}
                placeholder="Población (opcional)"
                aria-label="Población del centro nuevo"
                className="w-48 rounded-2xl border bg-white px-3 py-1.5 text-sm"
              />
              <button
                type="submit"
                disabled={creandoCentro || !nombreCentro.trim()}
                className="rounded-2xl bg-slate-900 px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50"
              >
                <Plus className="mr-1 inline h-4 w-4" />
                {creandoCentro ? "Añadiendo..." : "Añadir centro"}
              </button>
              <span className="text-xs text-slate-400">Se crea en «{cadenaElegida?.nombre ?? "la cadena"}» y queda marcado.</span>
            </form>
          )}

          {/* Barra de resultado: a la izquierda lo que CALCULA el sistema. */}
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t pt-4">
            <div className="min-w-0">
              <p className={`text-sm ${CLASE_TONO[resultado.tono]}`}>{resultado.texto}</p>
              {!trabajadoresMarcados.length && centrosMarcados.length > 0 && (
                <p className="text-xs text-slate-400">Marca al menos un trabajador para poder solicitar el acceso.</p>
              )}
              {progresoSolicitud && <p className="text-xs text-slate-500">{progresoSolicitud}</p>}
            </div>
            <button
              onClick={() => void solicitar()}
              disabled={!puedeSolicitar}
              className="rounded-2xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
            >
              <Send className="mr-1 inline h-4 w-4" />
              {solicitando ? "Solicitando..." : "Solicitar"}
            </button>
          </div>
        </div>

        {/* ---------- Tabla de solicitudes ---------- */}
        <div className="rounded-3xl border bg-white p-4 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-xl font-semibold">Solicitudes de acceso · {tabla.length} solicitudes</h2>
            <div className="flex flex-wrap items-center gap-3 text-xs">
              <span className="inline-flex items-center gap-2 text-slate-500">
                <span className="inline-block h-2.5 w-2.5 rounded-full bg-slate-300" />
                Texto gris · automático del sistema
              </span>
              <span className="inline-flex items-center gap-2 rounded-full bg-slate-100 px-2.5 py-1 font-semibold text-slate-700">
                Estado · lo rellena RRHH
              </span>
            </div>
          </div>

          <div className="mt-3 grid gap-3 md:grid-cols-[1fr_260px]">
            <label className="flex items-center gap-2 rounded-2xl border bg-white px-3 py-2">
              <Search className="h-4 w-4 shrink-0 text-slate-400" />
              <input
                value={consulta}
                onChange={event => setConsulta(event.target.value)}
                placeholder="Buscar por trabajador, cadena, centro, trabajo o código..."
                className="w-full bg-transparent text-sm outline-none"
              />
            </label>
            <label className="block text-sm">
              <select
                value={filtroCadena}
                onChange={event => setFiltroCadena(event.target.value)}
                aria-label="Filtrar la tabla por cadena"
                className="w-full rounded-2xl border bg-white px-3 py-2 text-sm"
              >
                <option value="">Todas las cadenas</option>
                {cadenas.map(cadena => (
                  <option key={cadena.id} value={cadena.id}>
                    {cadena.nombre}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {/* Acciones en bloque: mismo camino que la fila suelta, en lote. */}
          {gestionaRrhh && accesosMarcados.length > 0 && (
            <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-2xl border bg-slate-50 p-3">
              <p className="text-sm text-slate-600">
                {accesosMarcados.length} {accesosMarcados.length === 1 ? "solicitud marcada" : "solicitudes marcadas"}
                {ESTADOS_EN_BLOQUE.map(destino => {
                  const aptas = accesosMarcados.filter(acceso => puedeTransicionarAcceso(acceso.estado, destino)).length;
                  return ` · ${aptas} ${aptas === 1 ? "admite" : "admiten"} «${estadoSolicitudAccesoLabels[destino]}»`;
                }).join("")}
                {progresoLote ? ` · ${progresoLote}` : ""}
              </p>
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={() => pedirCambioEstado(accesosMarcados, "concedido")}
                  disabled={enCurso}
                  className="rounded-2xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
                >
                  <Check className="mr-1 inline h-4 w-4" />
                  Conceder
                </button>
                <button
                  onClick={() => pedirCambioEstado(accesosMarcados, "denegado")}
                  disabled={enCurso}
                  className="rounded-2xl border bg-white px-4 py-2 text-sm font-semibold disabled:opacity-50"
                >
                  <Ban className="mr-1 inline h-4 w-4" />
                  Denegar
                </button>
                <button
                  onClick={() => setSeleccionTabla([])}
                  disabled={enCurso}
                  className="rounded-2xl border bg-white px-4 py-2 text-sm font-semibold disabled:opacity-50"
                >
                  Quitar selección
                </button>
              </div>
            </div>
          )}

          {cargandoTabla && <p className="mt-3 text-sm text-slate-500">Cargando solicitudes de acceso...</p>}

          {!cargandoTabla && tabla.length === 0 && (
            <div className="mt-3 rounded-2xl bg-slate-50 p-4">
              <p className="font-semibold">No hay solicitudes de acceso con estos filtros.</p>
              <p className="text-sm text-slate-500">
                Elige cadena y fecha, marca trabajadores y centros y pulsa «Solicitar» para que aparezcan aquí.
              </p>
            </div>
          )}

          {!cargandoTabla && tabla.length > 0 && (
            <div className="mt-3 overflow-auto">
              <table className="w-full min-w-[1060px] text-sm">
                <thead>
                  <tr className="bg-slate-50">
                    {gestionaRrhh && (
                      <th className="w-10 p-2 text-left">
                        <input
                          type="checkbox"
                          checked={todasMarcadas}
                          disabled={filasEnBloque.length === 0 || enCurso}
                          onChange={() => setSeleccionTabla(todasMarcadas ? [] : filasEnBloque.map(acceso => acceso.id))}
                          aria-label="Marcar todas las solicitudes que admiten decisión"
                        />
                      </th>
                    )}
                    <th className="p-2 text-left">Sol.</th>
                    <th className="p-2 text-left">Gestora</th>
                    <th className="p-2 text-left">Trabajador</th>
                    <th className="p-2 text-left">Cadena</th>
                    <th className="p-2 text-left">Centro</th>
                    <th className="p-2 text-left">Trabajo</th>
                    <th className="bg-slate-100 p-2 text-left">Estado</th>
                  </tr>
                </thead>
                <tbody>
                  {tabla.map(acceso => {
                    const destinos = TODOS_LOS_ESTADOS.filter(estado => puedeTransicionarAcceso(acceso.estado, estado));
                    const guardando = procesando.includes(acceso.id);
                    const enBloque = ESTADOS_EN_BLOQUE.some(destino => puedeTransicionarAcceso(acceso.estado, destino));
                    // Aviso calculado: concedido, día de trabajo pasado y sin consumir.
                    const sinConsumir = acceso.estado === "concedido" && esConcedidoNoConsumido(acceso);
                    return (
                      <tr key={acceso.id} className={`border-t align-top ${CLASE_FILA[acceso.estado] ?? ""}`}>
                        {gestionaRrhh && (
                          <td className="p-2">
                            <input
                              type="checkbox"
                              checked={seleccionTabla.includes(acceso.id)}
                              disabled={!enBloque || enCurso}
                              onChange={() => alternarFila(acceso.id)}
                              aria-label={`Marcar ${acceso.codigo}`}
                            />
                          </td>
                        )}
                        <td className="p-2">
                          <p className="font-mono font-semibold text-slate-700">{acceso.codigo}</p>
                          <p className="text-xs text-slate-400">{formateaFechaCorta(acceso.created_at)}</p>
                        </td>
                        <td className="p-2 text-slate-500">{acceso.solicitada_por_nombre || "—"}</td>
                        <td className="p-2 text-slate-500">{acceso.worker_nombre || "—"}</td>
                        <td className="p-2 text-slate-500">{acceso.cadena_nombre || "—"}</td>
                        <td className="p-2">
                          {acceso.centro_id ? (
                            <span className="text-slate-500">{acceso.centro_nombre || "—"}</span>
                          ) : (
                            <span className="inline-flex items-center gap-1 italic text-slate-400">
                              <Building2 className="h-4 w-4 shrink-0" />
                              toda la cadena
                            </span>
                          )}
                        </td>
                        <td className="p-2 text-slate-500">
                          <p>{acceso.trabajo || "—"}</p>
                          <p className="text-xs text-slate-400">
                            Trabajo {formateaFechaCorta(acceso.fecha_trabajo) || "—"}
                            {acceso.fecha_limite ? ` · pedir antes del ${formateaFechaCorta(acceso.fecha_limite)}` : ""}
                          </p>
                        </td>
                        <td className="bg-slate-50 p-2">
                          {gestionaRrhh && destinos.length > 0 ? (
                            <select
                              value={acceso.estado}
                              onChange={event => pedirCambioEstado([acceso], event.target.value as EstadoSolicitudAcceso)}
                              disabled={guardando || enCurso}
                              aria-label={`Estado de ${acceso.codigo}`}
                              className="w-full min-w-[170px] rounded-2xl border bg-white px-3 py-2 text-sm font-semibold disabled:opacity-50"
                            >
                              <option value={acceso.estado}>{estadoSolicitudAccesoLabels[acceso.estado]}</option>
                              {destinos.map(estado => (
                                <option key={estado} value={estado}>
                                  {estadoSolicitudAccesoLabels[estado]}
                                </option>
                              ))}
                            </select>
                          ) : (
                            <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${estadoSolicitudAccesoClases[acceso.estado]}`}>
                              {estadoSolicitudAccesoLabels[acceso.estado]}
                            </span>
                          )}
                          {sinConsumir && <p className="mt-1 text-xs text-amber-700">Concedido y sin consumir.</p>}
                          {acceso.motivo && <p className="mt-1 text-xs text-slate-500">{acceso.motivo}</p>}
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
              {peticionMotivo.accesos.length === 1
                ? `Para pasar ${peticionMotivo.accesos[0].codigo} a «${estadoSolicitudAccesoLabels[peticionMotivo.destino]}» hace falta una explicación escrita: queda en la auditoría y no se puede deshacer.`
                : `Para pasar ${peticionMotivo.accesos.length} solicitudes a «${estadoSolicitudAccesoLabels[peticionMotivo.destino]}» hace falta una explicación escrita: el MISMO motivo queda en la auditoría de todas ellas y no se puede deshacer.`}
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
    </main>
  );
}

function Gate({ texto }: { texto: string }) {
  return (
    <main className="min-h-screen bg-slate-100 p-4 text-slate-900">
      <section className="mx-auto max-w-7xl space-y-4">
        <div className="rounded-3xl border bg-white p-4 shadow-sm">
          <h1 className="text-2xl font-bold">Accesos a centro</h1>
          <p className="mt-2 text-sm text-slate-600">{texto}</p>
        </div>
      </section>
    </main>
  );
}

/** «1 acceso» / «3 accesos». Misma forma que la frase de `textoSolicitudAcceso`. */
function fraseAccesos(total: number): string {
  return `${total} ${total === 1 ? "acceso" : "accesos"}`;
}

/**
 * El texto gris con varios trabajadores marcados. Se respeta LITERAL lo que
 * devuelve `textoSolicitudAcceso` (es la frase del diseño) y solo se hacen dos
 * cosas: multiplicar el número de accesos y decir para cuántos va.
 *
 *   «Alcampo tramita por centro · 3 centros → 12 accesos · pedir antes del 29/07 · para 4 trabajadores»
 *
 * Si la frase base cambiara de forma y el fragmento «→ N accesos» no apareciera,
 * el total se añade aparte en vez de perderse: nada falla en silencio.
 */
function conVariosTrabajadores(base: TextoAcceso, accesosPorTrabajador: number, trabajadores: number): TextoAcceso {
  if (trabajadores <= 1) return base;
  // Los textos de tono 'vacío' son instrucciones («Indica la fecha de trabajo»),
  // no un cálculo: multiplicarlos no significaría nada.
  if (base.tono === "vacio") return base;

  let texto = base.texto;
  if (accesosPorTrabajador > 0) {
    const total = accesosPorTrabajador * trabajadores;
    const fragmentoBase = `→ ${fraseAccesos(accesosPorTrabajador)}`;
    if (texto.includes(fragmentoBase)) {
      texto = texto.replace(fragmentoBase, `→ ${fraseAccesos(total)}`);
    } else if (base.tono === "neutro") {
      // La frase del cálculo cambió de forma: el total se dice aparte antes que
      // dejar en pantalla un número de accesos que sería falso. En tono 'error'
      // («plazo vencido») no hay cuenta de accesos que multiplicar.
      texto = `${texto} · ${fraseAccesos(total)} en total`;
    }
  }
  return { texto: `${texto} · para ${trabajadores} trabajadores`, tono: base.tono };
}

/** Ningún error se traga: siempre sale su mensaje real. */
function mensaje(err: unknown) {
  return err instanceof Error ? err.message : String(err ?? "error desconocido");
}

"use client";

/**
 * MerchanOps · RR.HH. — Accesos a centro.
 *
 * QUÉ RESUELVE
 * La gestora elige trabajador, cadena y fecha de trabajo, marca los chips de los
 * centros donde se va a trabajar, y el SISTEMA dice —en gris, sin que nadie
 * teclee nada— cuántas solicitudes salen de ahí y hasta cuándo hay plazo:
 *
 *   «Alcampo tramita por centro · 3 centros → 3 accesos · pedir antes del 29/07»
 *   «Media Markt tramita por cadena · 4 centros → 1 acceso · pedir antes del 31/07»
 *   «El Corte Inglés · plazo vencido el 25/07»
 *
 * «Solicitar» convierte esa lectura en solicitudes reales. La expansión por modo
 * de trámite la hace `merchan_rrhh_solicitar_acceso`: aquí se calcula solo para
 * ENSEÑARLA, nunca para decidirla. Si el catálogo cambia entre el cálculo y el
 * envío, manda la base, y por eso el aviso de éxito repite lo que devolvió ella
 * (códigos creados y centros omitidos), no lo que había pintado la pantalla.
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
 * y se recarga la tabla.
 */

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Building2, RefreshCw, Search, Send } from "lucide-react";
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
  listarCadenas,
  listarCentros,
  listarSolicitudesAcceso,
  listarTrabajadores,
  resolverSolicitudAcceso
} from "@/lib/rrhh/datos";

/** Lo que devuelve `listarTrabajadores()`. */
type FilaTrabajador = Awaited<ReturnType<typeof listarTrabajadores>>[number];

const TODOS_LOS_ESTADOS = Object.keys(estadoSolicitudAccesoLabels) as EstadoSolicitudAcceso[];

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
  const [workerId, setWorkerId] = useState("");
  const [cadenaId, setCadenaId] = useState("");
  const [fechaTrabajo, setFechaTrabajo] = useState("");
  const [marcados, setMarcados] = useState<string[]>([]);
  const [solicitando, setSolicitando] = useState(false);

  // Tabla de accesos
  const [solicitudes, setSolicitudes] = useState<SolicitudAcceso[]>([]);
  const [cargandoTabla, setCargandoTabla] = useState(true);
  const [consulta, setConsulta] = useState("");
  const [filtroCadena, setFiltroCadena] = useState("");
  const [guardandoId, setGuardandoId] = useState("");

  // Avisos
  const [error, setError] = useState("");
  const [aviso, setAviso] = useState("");

  // Modal de motivo (nada se cierra en negativo sin explicación escrita).
  const [peticionMotivo, setPeticionMotivo] = useState<{ acceso: SolicitudAcceso; destino: EstadoSolicitudAcceso } | null>(null);
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
  const trabajadorElegido = useMemo(() => trabajadores.find(fila => fila.id === workerId) ?? null, [trabajadores, workerId]);

  // Solo se ofrecen centros activos: los dados de baja siguen en el histórico de
  // la tabla de abajo, pero no se pueden pedir de nuevo.
  const centrosActivos = useMemo(() => centros.filter(centro => centro.activo), [centros]);
  const centrosMarcados = useMemo(() => centrosActivos.filter(centro => marcados.includes(centro.id)), [centrosActivos, marcados]);

  /** El texto gris del diseño. Se recalcula solo, nadie lo teclea. */
  const resultado = useMemo<TextoAcceso>(() => {
    if (!cadenaElegida) return { texto: "Elige la cadena para calcular la solicitud", tono: "vacio" };
    return textoSolicitudAcceso(cadenaElegida, centrosMarcados, fechaTrabajo);
  }, [cadenaElegida, centrosMarcados, fechaTrabajo]);

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

  function alternarCentro(centro: Centro) {
    setMarcados(previa => (previa.includes(centro.id) ? previa.filter(id => id !== centro.id) : [...previa, centro.id]));
  }

  async function solicitar() {
    if (!cadenaElegida || !centrosMarcados.length || !fechaTrabajo || !workerId) return;
    setSolicitando(true);
    setError("");
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

      const payload: PayloadSolicitarAcceso = {
        worker_id: workerId,
        worker_nombre: trabajadorElegido?.name?.trim() || null,
        cadena_id: cadenaElegida.id,
        fecha_trabajo: fechaTrabajo,
        centros: centrosPayload
      };
      const creado = await crearSolicitudesAcceso(payload);

      const codigos = creado.creadas.map(fila => fila.codigo).filter(Boolean);
      const partes = [
        codigos.length
          ? `${codigos.length} ${codigos.length === 1 ? "solicitud creada" : "solicitudes creadas"}: ${codigos.join(", ")}.`
          : "No se creó ninguna solicitud nueva.",
        creado.omitidas.length
          ? `${creado.omitidas.length} sin duplicar (${creado.omitidas.map(fila => fila.motivo).filter(Boolean).join(" · ") || "ya existían"}).`
          : "",
        creado.fecha_limite ? `Fecha límite ${formateaFechaCorta(creado.fecha_limite)}.` : "",
        creado.estado === "fuera_de_plazo" ? "Atención: nace fuera de plazo." : ""
      ].filter(Boolean);
      setAviso(partes.join(" "));

      setMarcados([]);
      await cargarTabla();
    } catch (err) {
      setError(`No se pudo solicitar el acceso: ${mensaje(err)}`);
    } finally {
      setSolicitando(false);
    }
  }

  function pedirCambioEstado(acceso: SolicitudAcceso, destino: EstadoSolicitudAcceso) {
    if (destino === acceso.estado) return;
    if (!puedeTransicionarAcceso(acceso.estado, destino)) {
      setError(
        `${acceso.codigo} no puede pasar de «${estadoSolicitudAccesoLabels[acceso.estado]}» a «${estadoSolicitudAccesoLabels[destino]}».`
      );
      return;
    }
    if (exigeMotivoAcceso(destino)) {
      setMotivo("");
      setErrorMotivo("");
      setPeticionMotivo({ acceso, destino });
      return;
    }
    void aplicarEstado(acceso, destino);
  }

  async function aplicarEstado(acceso: SolicitudAcceso, destino: EstadoSolicitudAcceso, motivoEscrito?: string) {
    setGuardandoId(acceso.id);
    setError("");
    try {
      const payload: PayloadResolverAcceso = {
        acceso_id: acceso.id,
        estado: destino,
        motivo: motivoEscrito?.trim() || null,
        version: acceso.version
      };
      // Volver a «Concedido» desde «Concedido no consumido» significa que sí se
      // usó: es la única transición que sella `consumido_at`.
      if (destino === "concedido" && acceso.estado === "concedido_no_consumido") payload.consumido = true;
      await resolverSolicitudAcceso(payload);
      setAviso(`${acceso.codigo} pasa a «${estadoSolicitudAccesoLabels[destino]}».`);
      await cargarTabla();
    } catch (err) {
      setError(`No se pudo cambiar el estado de ${acceso.codigo}: ${mensaje(err)}`);
      await cargarTabla();
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
    const { acceso, destino } = peticionMotivo;
    setPeticionMotivo(null);
    await aplicarEstado(acceso, destino, motivo);
    setMotivo("");
  }

  if (!session?.active) return <Gate texto="Inicia sesión en MerchanOps para acceder a RR.HH." />;
  if (!canAccessModule(session, "rrhh")) return <Gate texto="No tienes permiso para acceder al módulo de RR.HH." />;

  const gestionaRrhh = canManageRrhh(session);
  const puedeSolicitar = Boolean(workerId && cadenaId && fechaTrabajo && centrosMarcados.length) && !solicitando;

  return (
    <main className="min-h-screen bg-slate-100 p-4 text-slate-900">
      <section className="mx-auto max-w-7xl space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h1 className="text-3xl font-bold">Accesos a centro</h1>
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
          <div className="grid gap-3 md:grid-cols-3">
            <label className="block text-sm">
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
                  </option>
                ))}
              </select>
            </label>
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
                Los centros los mantiene RR.HH. en el catálogo: sin ninguno dado de alta no hay chips que marcar ni acceso que pedir.
              </p>
              {gestionaRrhh && (
                <Link
                  href="/rrhh/cadenas"
                  className="mt-3 inline-flex rounded-2xl border bg-white px-4 py-2 text-sm font-semibold"
                >
                  Dar de alta centros en «Cadenas y centros»
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

          {/* Barra de resultado: a la izquierda lo que CALCULA el sistema. */}
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t pt-4">
            <div className="min-w-0">
              <p className={`text-sm ${CLASE_TONO[resultado.tono]}`}>{resultado.texto}</p>
              {!workerId && centrosMarcados.length > 0 && (
                <p className="text-xs text-slate-400">Elige el trabajador para poder solicitar el acceso.</p>
              )}
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

          {cargandoTabla && <p className="mt-3 text-sm text-slate-500">Cargando solicitudes de acceso...</p>}

          {!cargandoTabla && tabla.length === 0 && (
            <div className="mt-3 rounded-2xl bg-slate-50 p-4">
              <p className="font-semibold">No hay solicitudes de acceso con estos filtros.</p>
              <p className="text-sm text-slate-500">
                Elige trabajador, cadena y fecha, marca los centros y pulsa «Solicitar» para que aparezcan aquí.
              </p>
            </div>
          )}

          {!cargandoTabla && tabla.length > 0 && (
            <div className="mt-3 overflow-auto">
              <table className="w-full min-w-[1000px] text-sm">
                <thead>
                  <tr className="bg-slate-50">
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
                    const guardando = guardandoId === acceso.id;
                    // Aviso calculado: concedido, día de trabajo pasado y sin consumir.
                    const sinConsumir = acceso.estado === "concedido" && esConcedidoNoConsumido(acceso);
                    return (
                      <tr key={acceso.id} className={`border-t align-top ${CLASE_FILA[acceso.estado] ?? ""}`}>
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
                              onChange={event => pedirCambioEstado(acceso, event.target.value as EstadoSolicitudAcceso)}
                              disabled={guardando}
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
              Para pasar {peticionMotivo.acceso.codigo} a «{estadoSolicitudAccesoLabels[peticionMotivo.destino]}» hace falta una
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

/** Ningún error se traga: siempre sale su mensaje real. */
function mensaje(err: unknown) {
  return err instanceof Error ? err.message : String(err ?? "error desconocido");
}

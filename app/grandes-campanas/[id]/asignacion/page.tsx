"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, ArrowLeft, CheckCircle2, RotateCcw, Search, Sparkles, UserMinus, Users } from "lucide-react";
import { PuntoBadgeEstado } from "@/components/grandes-campanas/campana-badge-estado";
import { GestorAvatar } from "@/components/grandes-campanas/gestor-avatars";
import { AppSession, AppUser, canAccessModule, getCurrentAppSession, isAdminSession, loadInternalUsers, sessionProvinceLabel, userCanSeeProvince } from "@/lib/access-control";
import {
  Campana,
  PuntoVenta,
  bulkAssignPuntos,
  eur,
  fetchCampana,
  fetchPuntos,
  filterPuntosBySession,
  formatDate,
  puntoEstadoLabels,
  puntoEstados
} from "@/lib/campanas";

const PAGE_SIZE = 50;
// Umbral orientativo de sobrecarga: aviso cuando un trabajador supera este nº de puntos abiertos.
const CARGA_ALTA = 60;

type Filtros = { q: string; provincia: string; estado: string; tipo: string; asignacion: "" | "sin" | "con"; gestor: string };
const filtrosVacios: Filtros = { q: "", provincia: "", estado: "", tipo: "", asignacion: "", gestor: "" };

type OperacionPrevia = Array<Pick<PuntoVenta, "id" | "gestor_id" | "gestor_nombre">>;

export default function AsignacionRapidaPage({ params }: { params: { id: string } }) {
  const [session] = useState<AppSession | null>(() => typeof window !== "undefined" ? getCurrentAppSession() : null);
  const [campana, setCampana] = useState<Campana | null>(null);
  const [puntos, setPuntos] = useState<PuntoVenta[]>([]);
  const [trabajadores, setTrabajadores] = useState<AppUser[]>([]);
  const [filtros, setFiltros] = useState<Filtros>(filtrosVacios);
  const [seleccion, setSeleccion] = useState<Set<string>>(new Set());
  const [objetivo, setObjetivo] = useState<string>("");
  const [sugerencias, setSugerencias] = useState<Map<string, AppUser>>(new Map());
  const [deshacerPila, setDeshacerPila] = useState<OperacionPrevia[]>([]);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [guardando, setGuardando] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const admin = isAdminSession(session);

  function flash(text: string) {
    setNotice(text);
    setTimeout(() => setNotice(""), 2500);
  }

  async function refresh(silencioso = false) {
    if (!silencioso) setLoading(true);
    const [campanaResult, puntosResult, usuarios] = await Promise.all([
      fetchCampana(params.id),
      fetchPuntos(params.id),
      loadInternalUsers()
    ]);
    setError(campanaResult.error || puntosResult.error || "");
    setCampana(campanaResult.data);
    const sessionActual = getCurrentAppSession();
    setPuntos(filterPuntosBySession(puntosResult.data, sessionActual));
    // Trabajadores asignables: usuarios activos; un gestor solo ve los de su ámbito provincial (y a sí mismo).
    const activos = usuarios.filter(user => user.active);
    setTrabajadores(isAdminSession(sessionActual)
      ? activos
      : activos.filter(user => user.id === sessionActual?.id || user.provinces.some(provincia => userCanSeeProvince(sessionActual, provincia))));
    setLoading(false);
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.id]);

  const provincias = useMemo(() => Array.from(new Set(puntos.map(punto => punto.provincia).filter(Boolean))).sort() as string[], [puntos]);
  const tipos = useMemo(() => Array.from(new Set(puntos.map(punto => punto.tipo).filter(Boolean))).sort() as string[], [puntos]);
  const gestoresActuales = useMemo(() => Array.from(new Set(puntos.map(punto => punto.gestor_nombre).filter(Boolean))).sort() as string[], [puntos]);

  const filtrados = useMemo(() => puntos.filter(punto => {
    const hay = [punto.nombre_comercial, punto.codigo, punto.direccion, punto.provincia, punto.gestor_nombre, punto.tipo].join(" ").toLowerCase();
    return (!filtros.q || hay.includes(filtros.q.toLowerCase()))
      && (!filtros.provincia || punto.provincia === filtros.provincia)
      && (!filtros.estado || punto.estado === filtros.estado)
      && (!filtros.tipo || punto.tipo === filtros.tipo)
      && (!filtros.gestor || punto.gestor_nombre === filtros.gestor)
      && (filtros.asignacion !== "sin" || (!punto.gestor_id && !punto.gestor_nombre))
      && (filtros.asignacion !== "con" || Boolean(punto.gestor_id || punto.gestor_nombre));
  }), [puntos, filtros]);

  const totalPages = Math.max(1, Math.ceil(filtrados.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const pageRows = filtrados.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  const sinAsignar = useMemo(() => puntos.filter(punto => !punto.gestor_id && !punto.gestor_nombre).length, [puntos]);
  const seleccionadosVisibles = useMemo(() => filtrados.filter(punto => seleccion.has(punto.id)), [filtrados, seleccion]);

  // Carga e importe por trabajador dentro de esta campaña (sobre los puntos visibles para la sesión).
  const cargaPorTrabajador = useMemo(() => {
    const mapa = new Map<string, { puntos: number; abiertos: number; importe: number }>();
    puntos.forEach(punto => {
      if (!punto.gestor_id) return;
      const actual = mapa.get(punto.gestor_id) || { puntos: 0, abiertos: 0, importe: 0 };
      actual.puntos += 1;
      if (punto.estado === "pendiente" || punto.estado === "incidencia") actual.abiertos += 1;
      actual.importe += Number(punto.importe || 0);
      mapa.set(punto.gestor_id, actual);
    });
    return mapa;
  }, [puntos]);

  const importePorProvincia = useMemo(() => {
    const mapa = new Map<string, { puntos: number; importe: number }>();
    puntos.forEach(punto => {
      const clave = punto.provincia || "Sin provincia";
      const actual = mapa.get(clave) || { puntos: 0, importe: 0 };
      actual.puntos += 1;
      actual.importe += Number(punto.importe || 0);
      mapa.set(clave, actual);
    });
    return Array.from(mapa.entries()).sort((a, b) => b[1].importe - a[1].importe);
  }, [puntos]);

  const trabajadorObjetivo = trabajadores.find(user => user.id === objetivo) || null;
  const fueraDeZona = useMemo(() => {
    if (!trabajadorObjetivo || !trabajadorObjetivo.provinces.length) return 0;
    return seleccionadosVisibles.filter(punto => punto.provincia && !trabajadorObjetivo.provinces.includes(punto.provincia)).length;
  }, [trabajadorObjetivo, seleccionadosVisibles]);

  function togglePunto(id: string) {
    setSeleccion(previous => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function togglePagina(marcar: boolean) {
    setSeleccion(previous => {
      const next = new Set(previous);
      pageRows.forEach(punto => marcar ? next.add(punto.id) : next.delete(punto.id));
      return next;
    });
  }

  function seleccionarFiltrados() {
    setSeleccion(new Set(filtrados.map(punto => punto.id)));
  }

  async function aplicarAsignacion(ids: string[], destino: AppUser | null, mensaje: string) {
    if (!ids.length) return;
    setGuardando(true);
    setError("");
    const previos: OperacionPrevia = puntos.filter(punto => ids.includes(punto.id)).map(punto => ({ id: punto.id, gestor_id: punto.gestor_id, gestor_nombre: punto.gestor_nombre }));
    const result = await bulkAssignPuntos(ids, destino ? { id: destino.id, nombre: destino.display_name } : null, session);
    if (result.error) setError(result.error);
    if (result.data.asignados > 0) {
      setDeshacerPila(pila => [...pila.slice(-9), previos.filter(previo => ids.includes(previo.id))]);
      flash(`${mensaje} (${result.data.asignados} puntos${result.data.omitidos ? `, ${result.data.omitidos} fuera de tu ámbito omitidos` : ""}).`);
    }
    setSeleccion(new Set());
    await refresh(true);
    setGuardando(false);
  }

  async function asignarSeleccion() {
    if (!trabajadorObjetivo) { setError("Selecciona primero un trabajador en el panel derecho."); return; }
    await aplicarAsignacion(seleccionadosVisibles.map(punto => punto.id), trabajadorObjetivo, `Asignados a ${trabajadorObjetivo.display_name}`);
  }

  async function desasignarSeleccion() {
    await aplicarAsignacion(seleccionadosVisibles.map(punto => punto.id), null, "Puntos desasignados");
  }

  async function deshacer() {
    const ultima = deshacerPila[deshacerPila.length - 1];
    if (!ultima || guardando) return;
    setGuardando(true);
    setError("");
    // Se restaura punto a punto porque cada uno puede tener un gestor previo distinto.
    const grupos = new Map<string, { gestor: { id: string | null; nombre: string | null }; ids: string[] }>();
    ultima.forEach(previo => {
      const clave = `${previo.gestor_id || ""}|${previo.gestor_nombre || ""}`;
      const grupo = grupos.get(clave) || { gestor: { id: previo.gestor_id || null, nombre: previo.gestor_nombre || null }, ids: [] };
      grupo.ids.push(previo.id);
      grupos.set(clave, grupo);
    });
    for (const grupo of Array.from(grupos.values())) {
      const result = await bulkAssignPuntos(grupo.ids, grupo.gestor.id || grupo.gestor.nombre ? grupo.gestor : null, session);
      if (result.error) { setError(result.error); break; }
    }
    setDeshacerPila(pila => pila.slice(0, -1));
    flash("Última operación deshecha.");
    await refresh(true);
    setGuardando(false);
  }

  // Sugerencias: puntos sin asignar del filtro actual → trabajador de la provincia con menos carga abierta.
  function sugerir() {
    const candidatos = filtrados.filter(punto => !punto.gestor_id && !punto.gestor_nombre);
    if (!candidatos.length) { setError("No hay puntos sin asignar en el filtro actual."); return; }
    const carga = new Map<string, number>();
    trabajadores.forEach(user => carga.set(user.id, cargaPorTrabajador.get(user.id)?.abiertos || 0));
    const propuesta = new Map<string, AppUser>();
    candidatos.forEach(punto => {
      const enZona = trabajadores.filter(user => punto.provincia && user.provinces.includes(punto.provincia));
      const opciones = enZona.length ? enZona : trabajadores.filter(user => !user.provinces.length);
      if (!opciones.length) return;
      const elegido = opciones.reduce((mejor, user) => (carga.get(user.id) || 0) < (carga.get(mejor.id) || 0) ? user : mejor, opciones[0]);
      propuesta.set(punto.id, elegido);
      carga.set(elegido.id, (carga.get(elegido.id) || 0) + 1);
    });
    if (!propuesta.size) { setError("No hay trabajadores con zona compatible para sugerir asignaciones."); return; }
    setSugerencias(propuesta);
    flash(`${propuesta.size} asignaciones sugeridas. Revisa y aplica o descarta.`);
  }

  async function aplicarSugerencias() {
    if (!sugerencias.size || guardando) return;
    setGuardando(true);
    setError("");
    const previos: OperacionPrevia = puntos.filter(punto => sugerencias.has(punto.id)).map(punto => ({ id: punto.id, gestor_id: punto.gestor_id, gestor_nombre: punto.gestor_nombre }));
    const porTrabajador = new Map<string, { user: AppUser; ids: string[] }>();
    sugerencias.forEach((user, puntoId) => {
      const grupo = porTrabajador.get(user.id) || { user, ids: [] };
      grupo.ids.push(puntoId);
      porTrabajador.set(user.id, grupo);
    });
    let total = 0;
    for (const grupo of Array.from(porTrabajador.values())) {
      const result = await bulkAssignPuntos(grupo.ids, { id: grupo.user.id, nombre: grupo.user.display_name }, session);
      if (result.error) { setError(result.error); break; }
      total += result.data.asignados;
    }
    if (total > 0) setDeshacerPila(pila => [...pila.slice(-9), previos]);
    setSugerencias(new Map());
    flash(`${total} puntos asignados según la sugerencia.`);
    await refresh(true);
    setGuardando(false);
  }

  if (!session?.active) {
    return <main className="gc-module p-4"><section className="gc-empty mx-auto mt-10 max-w-2xl"><b>Inicia sesión</b> en MerchanOps para usar la asignación rápida.</section></main>;
  }
  if (!canAccessModule(session, "servicios")) {
    return <main className="gc-module p-4"><section className="gc-empty mx-auto mt-10 max-w-2xl">No tienes permiso para acceder a Grandes Campañas.</section></main>;
  }
  if (loading && !campana) {
    return <main className="gc-module"><section className="mx-auto max-w-[1400px] space-y-3 p-4"><div className="gc-skeleton h-20" /><div className="gc-skeleton h-96" /></section></main>;
  }
  if (!campana) {
    return <main className="gc-module p-4"><section className="gc-empty mx-auto mt-10 max-w-2xl"><b>Campaña no encontrada.</b> <a className="underline" href="/grandes-campanas">Volver al listado</a>.</section></main>;
  }

  return (
    <main className="gc-module">
      <section className="mx-auto max-w-[1400px] space-y-4 p-4">
        {notice && <div className="gc-toast">{notice}</div>}
        {error && <div className="gc-toast gc-toast-error">{error}</div>}

        <div>
          <nav className="text-sm" style={{ color: "var(--gc-muted)" }}>
            <a href="/grandes-campanas" className="font-semibold hover:underline">Grandes Campañas</a>
            <span> / </span>
            <a href={`/grandes-campanas/${campana.id}`} className="font-semibold hover:underline">{campana.nombre}</a>
            <span> / Asignación rápida</span>
          </nav>
          <div className="mt-1 flex flex-wrap items-start justify-between gap-3">
            <div>
              <h1 className="text-2xl font-extrabold">Asignación rápida</h1>
              <p className="text-sm" style={{ color: "var(--gc-muted)" }}>
                Selecciona puntos y asígnalos en bloque. Ámbito: <b>{sessionProvinceLabel(session)}</b> · <b>{sinAsignar.toLocaleString("es-ES")}</b> puntos sin asignar de {puntos.length.toLocaleString("es-ES")} visibles.
              </p>
            </div>
            <a href={`/grandes-campanas/${campana.id}`} className="gc-btn-outline"><ArrowLeft className="h-4 w-4" />Volver al detalle</a>
          </div>
        </div>

        <div className="gc-card">
          <div className="flex flex-wrap items-end gap-3">
            <label className="min-w-[200px] flex-1">
              <span className="gc-label">Buscar</span>
              <span className="gc-search block">
                <Search className="h-4 w-4" />
                <input className="gc-input" placeholder="Nombre, código, dirección..." value={filtros.q} onChange={event => { setFiltros({ ...filtros, q: event.target.value }); setPage(1); }} />
              </span>
            </label>
            <label className="w-40">
              <span className="gc-label">Provincia</span>
              <select className="gc-select" value={filtros.provincia} onChange={event => { setFiltros({ ...filtros, provincia: event.target.value }); setPage(1); }}>
                <option value="">{admin ? "Todas" : "Mis provincias"}</option>
                {provincias.map(provincia => <option key={provincia} value={provincia}>{provincia}</option>)}
              </select>
            </label>
            <label className="w-40">
              <span className="gc-label">Asignación</span>
              <select className="gc-select" value={filtros.asignacion} onChange={event => { setFiltros({ ...filtros, asignacion: event.target.value as Filtros["asignacion"] }); setPage(1); }}>
                <option value="">Todos</option>
                <option value="sin">Sin asignar</option>
                <option value="con">Asignados</option>
              </select>
            </label>
            <label className="w-40">
              <span className="gc-label">Estado</span>
              <select className="gc-select" value={filtros.estado} onChange={event => { setFiltros({ ...filtros, estado: event.target.value }); setPage(1); }}>
                <option value="">Todos</option>
                {puntoEstados.map(estado => <option key={estado} value={estado}>{puntoEstadoLabels[estado]}</option>)}
              </select>
            </label>
            <label className="w-40">
              <span className="gc-label">Tipo</span>
              <select className="gc-select" value={filtros.tipo} onChange={event => { setFiltros({ ...filtros, tipo: event.target.value }); setPage(1); }}>
                <option value="">Todos</option>
                {tipos.map(tipo => <option key={tipo} value={tipo}>{tipo}</option>)}
              </select>
            </label>
            <label className="w-44">
              <span className="gc-label">Trabajador actual</span>
              <select className="gc-select" value={filtros.gestor} onChange={event => { setFiltros({ ...filtros, gestor: event.target.value }); setPage(1); }}>
                <option value="">Todos</option>
                {gestoresActuales.map(gestor => <option key={gestor} value={gestor}>{gestor}</option>)}
              </select>
            </label>
            <button className="gc-btn-outline" onClick={() => { setFiltros(filtrosVacios); setPage(1); }}>Limpiar</button>
          </div>
        </div>

        <div className="gc-split">
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2 gc-no-print">
              <button className="gc-btn-outline" onClick={seleccionarFiltrados} disabled={!filtrados.length}>Seleccionar {filtrados.length.toLocaleString("es-ES")} filtrados</button>
              <button className="gc-btn-outline" onClick={() => setSeleccion(new Set())} disabled={!seleccion.size}>Quitar selección</button>
              <button className="gc-btn-outline" onClick={desasignarSeleccion} disabled={guardando || !seleccionadosVisibles.length}><UserMinus className="h-4 w-4" />Desasignar</button>
              <button className="gc-btn-outline" onClick={deshacer} disabled={guardando || !deshacerPila.length}><RotateCcw className="h-4 w-4" />Deshacer</button>
              <button className="gc-btn-outline" onClick={sugerir} disabled={guardando}><Sparkles className="h-4 w-4" />Sugerir asignación</button>
              {sugerencias.size > 0 && (
                <>
                  <button className="gc-btn-dark" onClick={aplicarSugerencias} disabled={guardando}><CheckCircle2 className="h-4 w-4" />Aplicar {sugerencias.size} sugerencias</button>
                  <button className="gc-btn-outline" onClick={() => setSugerencias(new Map())}>Descartar</button>
                </>
              )}
            </div>

            {!filtrados.length ? (
              <div className="gc-empty"><b>No hay puntos con estos filtros.</b> {puntos.length ? "Ajusta los filtros para ver más resultados." : "Esta campaña no tiene puntos visibles en tu ámbito."}</div>
            ) : (
              <div className="gc-table-wrap">
                <table className="gc-table">
                  <thead>
                    <tr>
                      <th style={{ width: 36 }}>
                        <input type="checkbox" checked={pageRows.length > 0 && pageRows.every(punto => seleccion.has(punto.id))} onChange={event => togglePagina(event.target.checked)} />
                      </th>
                      <th>Punto de venta</th>
                      <th>Provincia</th>
                      <th>Tipo</th>
                      <th>Estado</th>
                      <th>Fecha límite</th>
                      <th style={{ textAlign: "right" }}>Importe</th>
                      <th>Trabajador</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pageRows.map(punto => {
                      const sugerido = sugerencias.get(punto.id);
                      return (
                        <tr key={punto.id} className={`gc-row-link ${sugerido ? "gc-row-sugerida" : ""}`} onClick={() => togglePunto(punto.id)}>
                          <td onClick={event => event.stopPropagation()}>
                            <input type="checkbox" checked={seleccion.has(punto.id)} onChange={() => togglePunto(punto.id)} />
                          </td>
                          <td>
                            <p className="font-semibold">{punto.nombre_comercial}</p>
                            <p className="text-xs" style={{ color: "var(--gc-muted)" }}>{punto.codigo ? `${punto.codigo} · ` : ""}{punto.direccion || "Sin dirección"}</p>
                          </td>
                          <td>{punto.provincia || "—"}</td>
                          <td>{punto.tipo || "—"}</td>
                          <td><PuntoBadgeEstado estado={punto.estado} /></td>
                          <td>{formatDate(punto.fecha_visita)}</td>
                          <td className="text-right font-semibold">{punto.importe != null ? eur(punto.importe) : "—"}</td>
                          <td>
                            {sugerido
                              ? <span className="inline-flex items-center gap-2 text-sm font-semibold" style={{ color: "#a16207" }}><Sparkles className="h-3.5 w-3.5" />{sugerido.display_name}</span>
                              : punto.gestor_nombre
                                ? <span className="inline-flex items-center gap-2"><GestorAvatar name={punto.gestor_nombre} size={22} />{punto.gestor_nombre}</span>
                                : <span style={{ color: "var(--gc-muted)" }}>Sin asignar</span>}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                <div className="gc-table-foot">
                  <span><b>{seleccion.size.toLocaleString("es-ES")}</b> seleccionados · {filtrados.length.toLocaleString("es-ES")} puntos filtrados · Importe filtrado {eur(filtrados.reduce((sum, punto) => sum + Number(punto.importe || 0), 0))}</span>
                  <span className="gc-pager">
                    <button disabled={currentPage <= 1} onClick={() => setPage(currentPage - 1)}>‹</button>
                    <span className="px-2 text-xs">{currentPage} / {totalPages}</span>
                    <button disabled={currentPage >= totalPages} onClick={() => setPage(currentPage + 1)}>›</button>
                  </span>
                </div>
              </div>
            )}
          </div>

          <aside className="space-y-3">
            <section className="gc-form-section">
              <h2 className="gc-form-title"><Users className="mr-1 inline h-4 w-4" />Trabajadores</h2>
              <div className="space-y-2" style={{ maxHeight: 420, overflow: "auto" }}>
                {trabajadores.map(user => {
                  const carga = cargaPorTrabajador.get(user.id);
                  const activo = objetivo === user.id;
                  return (
                    <div key={user.id} className={`gc-worker-card ${activo ? "gc-worker-active" : ""}`} onClick={() => setObjetivo(activo ? "" : user.id)}>
                      <div className="flex items-center justify-between gap-2">
                        <span className="inline-flex items-center gap-2 font-semibold"><GestorAvatar name={user.display_name} size={24} />{user.display_name}</span>
                        <input type="radio" checked={activo} onChange={() => setObjetivo(user.id)} />
                      </div>
                      <p className="text-xs" style={{ color: "var(--gc-muted)" }}>{user.provinces.length ? user.provinces.join(", ") : user.role === "admin" ? "Toda España" : "Sin zona definida"}</p>
                      <p className="text-xs">
                        <b>{carga?.puntos || 0}</b> puntos · <b>{carga?.abiertos || 0}</b> abiertos · <b>{eur(carga?.importe || 0)}</b>
                      </p>
                      {(carga?.abiertos || 0) >= CARGA_ALTA && <span className="gc-worker-warn"><AlertTriangle className="h-3.5 w-3.5" />Carga alta</span>}
                    </div>
                  );
                })}
                {!trabajadores.length && <p className="text-sm" style={{ color: "var(--gc-muted)" }}>No hay trabajadores activos en tu ámbito.</p>}
              </div>
              {trabajadorObjetivo && fueraDeZona > 0 && (
                <p className="gc-worker-warn mt-2"><AlertTriangle className="h-3.5 w-3.5" />{fueraDeZona} de los puntos seleccionados están fuera de la zona habitual de {trabajadorObjetivo.display_name}.</p>
              )}
              <button className="gc-btn-dark mt-3 w-full justify-center" disabled={guardando || !trabajadorObjetivo || !seleccionadosVisibles.length} onClick={asignarSeleccion}>
                {guardando ? "Guardando..." : `Asignar ${seleccionadosVisibles.length.toLocaleString("es-ES")} seleccionados${trabajadorObjetivo ? ` a ${trabajadorObjetivo.display_name}` : ""}`}
              </button>
            </section>

            <section className="gc-form-section">
              <h2 className="gc-form-title">Importe estimado por provincia</h2>
              <div className="space-y-1 text-sm">
                {importePorProvincia.map(([provincia, datos]) => (
                  <p key={provincia} className="flex items-center justify-between gap-2">
                    <span>{provincia} <span style={{ color: "var(--gc-muted)" }}>({datos.puntos})</span></span>
                    <b>{eur(datos.importe)}</b>
                  </p>
                ))}
                {!importePorProvincia.length && <p style={{ color: "var(--gc-muted)" }}>Sin puntos visibles.</p>}
              </div>
            </section>
          </aside>
        </div>
      </section>
    </main>
  );
}

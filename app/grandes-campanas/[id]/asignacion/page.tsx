"use client";

import Link from "next/link";

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, ArrowLeft, CheckCircle2, RotateCcw, Search, Sparkles, UserMinus, Users } from "lucide-react";
import { PuntoBadgeEstado } from "@/components/grandes-campanas/campana-badge-estado";
import { GestorAvatar } from "@/components/grandes-campanas/gestor-avatars";
import { AppSession, canAccessModule, getCurrentAppSession, isAdminSession, loadInternalUsers, sessionProvinceLabel } from "@/lib/access-control";
import { mismaProvincia } from "@/lib/campana-asignacion";
import { valorPuntoEur } from "@/lib/campana-horas";
import { delegacionesComoCandidatos, fetchDelegacionesCampana, responsablesDeZona } from "@/lib/campana-delegaciones";
import { supabase } from "@/lib/supabase";
import {
  Campana,
  PuntoVenta,
  bulkAssignInstaladores,
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
// Umbral orientativo de sobrecarga: aviso cuando una persona supera este nº de puntos abiertos.
const CARGA_ALTA = 60;

type Filtros = { q: string; provincia: string; estado: string; tipo: string; asignacion: "" | "sin" | "con"; gestor: string };
const filtrosVacios: Filtros = { q: "", provincia: "", estado: "", tipo: "", asignacion: "", gestor: "" };

/**
 * v11.5 · Esta pantalla tiene DOS caras según quién entra, y no es un detalle
 * cosmético: son las dos capas de reparto de la operativa nueva.
 *
 *   · Administración reparte ZONA: elige gestor o delegación para cada punto, que
 *     es lo que da acceso. Nunca ve trabajadores desde aquí.
 *   · Gestor y delegación reparten TRABAJADOR entre sus propios puntos.
 *
 * Antes la pantalla repartía siempre `gestor_id` y lo llamaba «trabajador», así que
 * un gestor que usara «Asignar» le quitaba a otro gestor sus puntos creyendo que
 * estaba asignando a su instalador.
 */
type Candidato = { id: string; nombre: string; zonas: string[]; etiqueta: string };

type OperacionPrevia = Array<Pick<PuntoVenta, "id" | "gestor_id" | "gestor_nombre" | "instalador_id" | "instalador_nombre">>;

export default function AsignacionRapidaPage({ params }: { params: { id: string } }) {
  const [session] = useState<AppSession | null>(() => typeof window !== "undefined" ? getCurrentAppSession() : null);
  const [campana, setCampana] = useState<Campana | null>(null);
  const [puntos, setPuntos] = useState<PuntoVenta[]>([]);
  const [candidatos, setCandidatos] = useState<Candidato[]>([]);
  const [filtros, setFiltros] = useState<Filtros>(filtrosVacios);
  const [seleccion, setSeleccion] = useState<Set<string>>(new Set());
  const [objetivo, setObjetivo] = useState<string>("");
  const [sugerencias, setSugerencias] = useState<Map<string, Candidato>>(new Map());
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
    const sessionActual = getCurrentAppSession();
    const esAdmin = isAdminSession(sessionActual);
    const [campanaResult, puntosResult] = await Promise.all([fetchCampana(params.id), fetchPuntos(params.id)]);
    setError(campanaResult.error || puntosResult.error || "");
    setCampana(campanaResult.data);
    setPuntos(filterPuntosBySession(puntosResult.data, sessionActual));

    if (esAdmin) {
      // Reparto de ZONA: gestores de la casa y, si la campaña va por delegaciones,
      // las delegaciones marcadas en lugar de los gestores de esas provincias.
      const [usuarios, delegacionesResult] = await Promise.all([loadInternalUsers(), fetchDelegacionesCampana(params.id)]);
      const activos = usuarios.filter(user => user.active);
      const gestores = activos.filter(user => user.role === "manager" || user.role === "admin");
      const { candidatos: responsables } = responsablesDeZona(
        gestores,
        delegacionesComoCandidatos(delegacionesResult.data, activos),
        Boolean(campanaResult.data?.delegaciones_activas)
      );
      setCandidatos(responsables.map(persona => ({
        id: persona.id,
        nombre: persona.display_name || persona.id,
        zonas: persona.provinces || [],
        etiqueta: persona.role === "delegacion" ? "Delegación" : "Gestor"
      })));
    } else {
      // Reparto de TRABAJADORES: los del catálogo `workers` de las provincias que
      // el responsable de zona tiene delante (las de sus propios puntos), no los
      // usuarios internos. Un instalador no es un usuario de la aplicación.
      const provinciasVisibles = new Set(
        filterPuntosBySession(puntosResult.data, sessionActual).map(punto => punto.provincia).filter(Boolean) as string[]
      );
      if (supabase) {
        const { data, error: workersError } = await supabase.from("workers").select("id,name,province").order("name");
        if (workersError) setError(workersError.message);
        const workers = (data || []) as Array<{ id: string; name: string; province?: string | null }>;
        const deZona = workers.filter(worker => Array.from(provinciasVisibles).some(provincia => mismaProvincia(worker.province, provincia)));
        // Los de fuera de zona van detrás, pero siguen estando: hay provincias sin
        // ningún trabajador y el punto no puede quedarse bloqueado por eso.
        const otros = workers.filter(worker => !deZona.some(item => item.id === worker.id));
        setCandidatos([...deZona, ...otros].map(worker => ({
          id: worker.id,
          nombre: worker.name,
          zonas: worker.province ? [worker.province] : [],
          etiqueta: deZona.some(item => item.id === worker.id) ? "En tu zona" : "Otra provincia"
        })));
      }
    }
    setLoading(false);
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.id]);

  // Qué persona lleva ya el punto en la capa que se está repartiendo. Toda la
  // pantalla (filtros, contadores, carga, sugerencias y deshacer) mira ESTO, así
  // que cambiar de capa no deja ningún cálculo apuntando al campo equivocado.
  const asignadoId = (punto: PuntoVenta) => (admin ? punto.gestor_id : punto.instalador_id) || null;
  const asignadoNombre = (punto: PuntoVenta) => (admin ? punto.gestor_nombre : punto.instalador_nombre) || null;

  const provincias = useMemo(() => Array.from(new Set(puntos.map(punto => punto.provincia).filter(Boolean))).sort() as string[], [puntos]);
  const tipos = useMemo(() => Array.from(new Set(puntos.map(punto => punto.tipo).filter(Boolean))).sort() as string[], [puntos]);
  const asignadosActuales = useMemo(
    () => Array.from(new Set(puntos.map(asignadoNombre).filter(Boolean))).sort() as string[],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [puntos, admin]
  );

  const filtrados = useMemo(() => puntos.filter(punto => {
    const hay = [punto.nombre_comercial, punto.codigo, punto.direccion, punto.provincia, punto.gestor_nombre, punto.instalador_nombre, punto.tipo].join(" ").toLowerCase();
    return (!filtros.q || hay.includes(filtros.q.toLowerCase()))
      && (!filtros.provincia || punto.provincia === filtros.provincia)
      && (!filtros.estado || punto.estado === filtros.estado)
      && (!filtros.tipo || punto.tipo === filtros.tipo)
      && (!filtros.gestor || asignadoNombre(punto) === filtros.gestor)
      && (filtros.asignacion !== "sin" || (!asignadoId(punto) && !asignadoNombre(punto)))
      && (filtros.asignacion !== "con" || Boolean(asignadoId(punto) || asignadoNombre(punto)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [puntos, filtros, admin]);

  const totalPages = Math.max(1, Math.ceil(filtrados.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const pageRows = filtrados.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  const sinAsignar = useMemo(
    () => puntos.filter(punto => !asignadoId(punto) && !asignadoNombre(punto)).length,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [puntos, admin]
  );
  const seleccionadosVisibles = useMemo(() => filtrados.filter(punto => seleccion.has(punto.id)), [filtrados, seleccion]);

  // Carga e importe por persona dentro de esta campaña (sobre los puntos visibles).
  const cargaPorPersona = useMemo(() => {
    const mapa = new Map<string, { puntos: number; abiertos: number; importe: number }>();
    puntos.forEach(punto => {
      const id = asignadoId(punto);
      if (!id) return;
      const actual = mapa.get(id) || { puntos: 0, abiertos: 0, importe: 0 };
      actual.puntos += 1;
      if (punto.estado === "pendiente" || punto.estado === "incidencia") actual.abiertos += 1;
      // v11.5 · Lo que vale el punto depende del modo de la campaña: en una campaña
      // por horas el `importe` está vacío y esta columna habría dicho 0 € siempre.
      actual.importe += valorPuntoEur(punto, campana || {});
      mapa.set(id, actual);
    });
    return mapa;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [puntos, admin, campana]);

  const importePorProvincia = useMemo(() => {
    const mapa = new Map<string, { puntos: number; importe: number }>();
    puntos.forEach(punto => {
      const clave = punto.provincia || "Sin provincia";
      const actual = mapa.get(clave) || { puntos: 0, importe: 0 };
      actual.puntos += 1;
      actual.importe += valorPuntoEur(punto, campana || {});
      mapa.set(clave, actual);
    });
    return Array.from(mapa.entries()).sort((a, b) => b[1].importe - a[1].importe);
  }, [puntos, campana]);

  const candidatoObjetivo = candidatos.find(persona => persona.id === objetivo) || null;
  const fueraDeZona = useMemo(() => {
    if (!candidatoObjetivo || !candidatoObjetivo.zonas.length) return 0;
    return seleccionadosVisibles.filter(punto => punto.provincia && !candidatoObjetivo.zonas.some(zona => mismaProvincia(zona, punto.provincia))).length;
  }, [candidatoObjetivo, seleccionadosVisibles]);

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

  /** Escribe en la capa que corresponde al rol de quien está mirando. */
  function asignarEnCapa(ids: string[], persona: { id: string | null; nombre: string | null } | null) {
    return admin ? bulkAssignPuntos(ids, persona, session) : bulkAssignInstaladores(ids, persona, session);
  }

  function fotoPrevia(ids: string[]): OperacionPrevia {
    return puntos
      .filter(punto => ids.includes(punto.id))
      .map(punto => ({
        id: punto.id,
        gestor_id: punto.gestor_id,
        gestor_nombre: punto.gestor_nombre,
        instalador_id: punto.instalador_id,
        instalador_nombre: punto.instalador_nombre
      }));
  }

  async function aplicarAsignacion(ids: string[], destino: Candidato | null, mensaje: string) {
    if (!ids.length) return;
    setGuardando(true);
    setError("");
    const previos = fotoPrevia(ids);
    const result = await asignarEnCapa(ids, destino ? { id: destino.id, nombre: destino.nombre } : null);
    if (result.error) setError(result.error);
    if (result.data.asignados > 0) {
      setDeshacerPila(pila => [...pila.slice(-9), previos]);
      flash(`${mensaje} (${result.data.asignados} puntos${result.data.omitidos ? `, ${result.data.omitidos} fuera de tu ámbito omitidos` : ""}).`);
    }
    setSeleccion(new Set());
    await refresh(true);
    setGuardando(false);
  }

  async function asignarSeleccion() {
    if (!candidatoObjetivo) { setError(`Selecciona primero ${admin ? "un responsable de zona" : "un trabajador"} en el panel derecho.`); return; }
    await aplicarAsignacion(seleccionadosVisibles.map(punto => punto.id), candidatoObjetivo, `Asignados a ${candidatoObjetivo.nombre}`);
  }

  async function desasignarSeleccion() {
    await aplicarAsignacion(seleccionadosVisibles.map(punto => punto.id), null, "Puntos desasignados");
  }

  async function deshacer() {
    const ultima = deshacerPila[deshacerPila.length - 1];
    if (!ultima || guardando) return;
    setGuardando(true);
    setError("");
    // Se restaura por grupos porque cada punto puede tener una persona previa
    // distinta. La foto guarda las dos capas, así que deshacer devuelve siempre
    // el campo que esta sesión tocó, nunca el otro.
    const grupos = new Map<string, { persona: { id: string | null; nombre: string | null }; ids: string[] }>();
    ultima.forEach(previo => {
      const id = (admin ? previo.gestor_id : previo.instalador_id) || null;
      const nombre = (admin ? previo.gestor_nombre : previo.instalador_nombre) || null;
      const clave = `${id || ""}|${nombre || ""}`;
      const grupo = grupos.get(clave) || { persona: { id, nombre }, ids: [] };
      grupo.ids.push(previo.id);
      grupos.set(clave, grupo);
    });
    for (const grupo of Array.from(grupos.values())) {
      const result = await asignarEnCapa(grupo.ids, grupo.persona.id || grupo.persona.nombre ? grupo.persona : null);
      if (result.error) { setError(result.error); break; }
    }
    setDeshacerPila(pila => pila.slice(0, -1));
    flash("Última operación deshecha.");
    await refresh(true);
    setGuardando(false);
  }

  // Sugerencias: puntos sin asignar del filtro actual → persona de la provincia con
  // menos carga abierta. Las provincias sin nadie se quedan vacías a propósito:
  // repartirlas «a quien sea» es peor que dejarlas visibles y sin asignar.
  function sugerir() {
    const pendientes = filtrados.filter(punto => !asignadoId(punto) && !asignadoNombre(punto));
    if (!pendientes.length) { setError("No hay puntos sin asignar en el filtro actual."); return; }
    const carga = new Map<string, number>();
    candidatos.forEach(persona => carga.set(persona.id, cargaPorPersona.get(persona.id)?.abiertos || 0));
    const propuesta = new Map<string, Candidato>();
    pendientes.forEach(punto => {
      const enZona = candidatos.filter(persona => persona.zonas.some(zona => mismaProvincia(zona, punto.provincia)));
      if (!enZona.length) return;
      const elegido = enZona.reduce((mejor, persona) => (carga.get(persona.id) || 0) < (carga.get(mejor.id) || 0) ? persona : mejor, enZona[0]);
      propuesta.set(punto.id, elegido);
      carga.set(elegido.id, (carga.get(elegido.id) || 0) + 1);
    });
    if (!propuesta.size) { setError(`No hay ${admin ? "responsables" : "trabajadores"} con zona compatible para sugerir asignaciones.`); return; }
    setSugerencias(propuesta);
    flash(`${propuesta.size} asignaciones sugeridas. Revisa y aplica o descarta.`);
  }

  async function aplicarSugerencias() {
    if (!sugerencias.size || guardando) return;
    setGuardando(true);
    setError("");
    const previos = fotoPrevia(Array.from(sugerencias.keys()));
    const porPersona = new Map<string, { persona: Candidato; ids: string[] }>();
    sugerencias.forEach((persona, puntoId) => {
      const grupo = porPersona.get(persona.id) || { persona, ids: [] };
      grupo.ids.push(puntoId);
      porPersona.set(persona.id, grupo);
    });
    let total = 0;
    for (const grupo of Array.from(porPersona.values())) {
      const result = await asignarEnCapa(grupo.ids, { id: grupo.persona.id, nombre: grupo.persona.nombre });
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
    return <main className="gc-module p-4"><section className="gc-empty mx-auto mt-10 max-w-2xl"><b>Campaña no encontrada.</b> <Link className="underline" href="/grandes-campanas">Volver al listado</Link>.</section></main>;
  }

  return (
    <main className="gc-module">
      <section className="mx-auto max-w-[1400px] space-y-4 p-4">
        {notice && <div className="gc-toast">{notice}</div>}
        {error && <div className="gc-toast gc-toast-error">{error}</div>}

        <div>
          <nav className="text-sm" style={{ color: "var(--gc-muted)" }}>
            <Link href="/grandes-campanas" className="font-semibold hover:underline">Grandes Campañas</Link>
            <span> / </span>
            <Link href={`/grandes-campanas/${campana.id}`} className="font-semibold hover:underline">{campana.nombre}</Link>
            <span> / Asignación rápida</span>
          </nav>
          <div className="mt-1 flex flex-wrap items-start justify-between gap-3">
            <div>
              <h1 className="mo-page-title text-2xl font-extrabold">{admin ? "Asignación de zona" : "Asignación de trabajadores"}</h1>
              <p className="text-sm" style={{ color: "var(--gc-muted)" }}>
                {admin
                  ? <>Reparte los puntos entre <b>gestores y delegaciones</b>. Asignar la zona es lo que da acceso al punto; el trabajador lo elige después cada responsable. </>
                  : <>Reparte tus puntos entre los <b>trabajadores</b> de la zona. </>}
                Ámbito: <b>{sessionProvinceLabel(session)}</b> · <b>{sinAsignar.toLocaleString("es-ES")}</b> puntos sin asignar de {puntos.length.toLocaleString("es-ES")} visibles.
              </p>
            </div>
            <Link href={`/grandes-campanas/${campana.id}`} className="gc-btn-outline"><ArrowLeft className="h-4 w-4" />Volver al detalle</Link>
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
              <span className="gc-label">{admin ? "Responsable actual" : "Trabajador actual"}</span>
              <select className="gc-select" value={filtros.gestor} onChange={event => { setFiltros({ ...filtros, gestor: event.target.value }); setPage(1); }}>
                <option value="">Todos</option>
                {asignadosActuales.map(nombre => <option key={nombre} value={nombre}>{nombre}</option>)}
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
                      <th>{admin ? "Responsable de zona" : "Trabajador"}</th>
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
                          <td className="text-right font-semibold">{campana.pago_por_horas || punto.importe != null ? eur(valorPuntoEur(punto, campana)) : "—"}</td>
                          <td>
                            {sugerido
                              ? <span className="inline-flex items-center gap-2 text-sm font-semibold" style={{ color: "#a16207" }}><Sparkles className="h-3.5 w-3.5" />{sugerido.nombre}</span>
                              : asignadoNombre(punto)
                                ? <span className="inline-flex items-center gap-2"><GestorAvatar name={asignadoNombre(punto)} size={22} />{asignadoNombre(punto)}</span>
                                : <span style={{ color: "var(--gc-muted)" }}>Sin asignar</span>}
                            {/* En la vista de zona se sigue viendo quién ejecuta, aunque
                                administración no pueda cambiarlo: es información útil. */}
                            {admin && punto.instalador_nombre && (
                              <p className="text-xs" style={{ color: "var(--gc-muted)" }}>Trabajador: {punto.instalador_nombre}</p>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                <div className="gc-table-foot">
                  <span><b>{seleccion.size.toLocaleString("es-ES")}</b> seleccionados · {filtrados.length.toLocaleString("es-ES")} puntos filtrados · Importe filtrado {eur(filtrados.reduce((sum, punto) => sum + valorPuntoEur(punto, campana || {}), 0))}</span>
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
              <h2 className="gc-form-title"><Users className="mr-1 inline h-4 w-4" />{admin ? "Responsables de zona" : "Trabajadores"}</h2>
              {admin && campana.delegaciones_activas && (
                <p className="mb-2 text-xs" style={{ color: "var(--gc-muted)" }}>
                  Campaña <b>por delegaciones</b>: en las provincias subcontratadas aparece la delegación en lugar del gestor.
                </p>
              )}
              <div className="space-y-2" style={{ maxHeight: 420, overflow: "auto" }}>
                {candidatos.map(persona => {
                  const carga = cargaPorPersona.get(persona.id);
                  const activo = objetivo === persona.id;
                  return (
                    <div key={persona.id} className={`gc-worker-card ${activo ? "gc-worker-active" : ""}`} onClick={() => setObjetivo(activo ? "" : persona.id)}>
                      <div className="flex items-center justify-between gap-2">
                        <span className="inline-flex items-center gap-2 font-semibold"><GestorAvatar name={persona.nombre} size={24} />{persona.nombre}</span>
                        <input type="radio" checked={activo} onChange={() => setObjetivo(persona.id)} />
                      </div>
                      <p className="text-xs" style={{ color: "var(--gc-muted)" }}>
                        {persona.etiqueta}{persona.zonas.length ? ` · ${persona.zonas.join(", ")}` : " · sin zona definida"}
                      </p>
                      <p className="text-xs">
                        <b>{carga?.puntos || 0}</b> puntos · <b>{carga?.abiertos || 0}</b> abiertos · <b>{eur(carga?.importe || 0)}</b>
                      </p>
                      {(carga?.abiertos || 0) >= CARGA_ALTA && <span className="gc-worker-warn"><AlertTriangle className="h-3.5 w-3.5" />Carga alta</span>}
                    </div>
                  );
                })}
                {!candidatos.length && (
                  <p className="text-sm" style={{ color: "var(--gc-muted)" }}>
                    {admin ? "No hay gestores ni delegaciones con provincias asignadas." : "No hay trabajadores en el catálogo para tu ámbito."}
                  </p>
                )}
              </div>
              {candidatoObjetivo && fueraDeZona > 0 && (
                <p className="gc-worker-warn mt-2"><AlertTriangle className="h-3.5 w-3.5" />{fueraDeZona} de los puntos seleccionados están fuera de la zona habitual de {candidatoObjetivo.nombre}.</p>
              )}
              <button className="gc-btn-dark mt-3 w-full justify-center" disabled={guardando || !candidatoObjetivo || !seleccionadosVisibles.length} onClick={asignarSeleccion}>
                {guardando ? "Guardando..." : `Asignar ${seleccionadosVisibles.length.toLocaleString("es-ES")} seleccionados${candidatoObjetivo ? ` a ${candidatoObjetivo.nombre}` : ""}`}
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

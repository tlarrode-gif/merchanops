"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { FileDown, Info, MapPin, MessageCircle, Pencil, Plus, Upload, Users } from "lucide-react";
import { parseImportFile } from "@/lib/csv-parser";
import { supabase } from "@/lib/supabase";
import { CampanaBadgeEstado, IncidenciaBadgeEstado } from "@/components/grandes-campanas/campana-badge-estado";
import { CampanaDetalleKpis } from "@/components/grandes-campanas/campana-detalle-kpis";
import { GestorAvatar } from "@/components/grandes-campanas/gestor-avatars";
import { PuntosTabla } from "@/components/grandes-campanas/puntos-tabla";
import { AppSession, canAccessModule, canManageCampaigns, getCurrentAppSession, isAdminSession } from "@/lib/access-control";
import { CampanaColumna, fetchCampanaColumnas } from "@/lib/campana-columnas";
import {
  Campana,
  CampanaGestor,
  CampanaKpis,
  IncidenciaCampana,
  IncidenciaEstado,
  PuntoInput,
  PuntoVenta,
  dateOnly,
  downloadXlsx,
  eur,
  fetchCampana,
  fetchCampanaKpis,
  fetchGestoresCampana,
  fetchIncidencias,
  fetchPuntos,
  filterPuntosBySession,
  formatDate,
  insertIncidencia,
  insertPuntosBatch,
  kpisDesdePuntos,
  puntosCsvRows,
  setIncidenciaEstado,
  syncPuntoCompletadoConLogistica,
  updatePunto,
  updatePuntosPorCodigo,
  deletePunto as deletePuntoDb
} from "@/lib/campanas";

const tabs = [
  ["puntos", "Puntos"],
  ["gestores", "Gestores"],
  ["incidencias", "Incidencias"],
  ["documentos", "Documentos"],
  ["historial", "Historial"],
  ["pagos", "Pagos"]
] as const;
type TabKey = typeof tabs[number][0];

const emptyNuevoPunto: PuntoInput = { codigo: null, nombre_comercial: "", direccion: null, provincia: null, tipo: null, estado: "pendiente", fecha_visita: null, importe: null, gestor_id: null, gestor_nombre: null, notas: null, datos_extra: {} };

export default function CampanaDetallePage({ params }: { params: { id: string } }) {
  const [session] = useState<AppSession | null>(() => typeof window !== "undefined" ? getCurrentAppSession() : null);
  const [campana, setCampana] = useState<Campana | null>(null);
  const [kpis, setKpis] = useState<CampanaKpis | null>(null);
  const [puntos, setPuntos] = useState<PuntoVenta[]>([]);
  const [incidencias, setIncidencias] = useState<IncidenciaCampana[]>([]);
  const [gestores, setGestores] = useState<CampanaGestor[]>([]);
  const [columnas, setColumnas] = useState<CampanaColumna[]>([]);
  const [tab, setTab] = useState<TabKey>("puntos");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [filtroIncidencias, setFiltroIncidencias] = useState("");
  const [nuevoAbierto, setNuevoAbierto] = useState(false);
  const [nuevoPunto, setNuevoPunto] = useState<PuntoInput>({ ...emptyNuevoPunto });
  const [workers, setWorkers] = useState<Array<{ id: string; name: string; province?: string | null; phone?: string | null }>>([]);
  const updateFileRef = useRef<HTMLInputElement>(null);
  const [waOpen, setWaOpen] = useState(false);
  const [waWorkerId, setWaWorkerId] = useState("");
  const [waText, setWaText] = useState("");
  const admin = isAdminSession(session);

  useEffect(() => {
    if (supabase) supabase.from("workers").select("id,name,province,phone").order("name").then(({ data }) => setWorkers((data || []) as Array<{ id: string; name: string; province?: string | null; phone?: string | null }>));
  }, []);

  // Mensaje de WhatsApp para el instalador: campaña + sus puntos asignados. Editable
  // antes de enviar, así se manda solo lo necesario (como en Servicios).
  function construirMensajeWhatsApp(workerId: string) {
    if (!campana) return "";
    const worker = workers.find(w => w.id === workerId);
    const suyos = puntos.filter(punto => punto.instalador_id === workerId);
    const lista = suyos.map((punto, index) => `${index + 1}. ${punto.nombre_comercial}${punto.direccion ? ` — ${punto.direccion}` : ""}${punto.provincia ? ` (${punto.provincia})` : ""}${punto.codigo ? ` · Cód: ${punto.codigo}` : ""}`).join("\n");
    return `*${(campana.cliente_marca || "MerchanOps").toUpperCase()} – ${campana.nombre}*\n\nHola ${worker?.name || ""}, tienes asignados estos puntos de la campaña.\n\n*Periodo:* ${formatDate(campana.fecha_inicio)} — ${formatDate(campana.fecha_fin)}\n*Puntos asignados:* ${suyos.length}\n\n${lista || "Sin puntos asignados todavía."}\n\nConfirma recepción y avisa de cualquier incidencia.`;
  }

  function abrirWhatsApp() {
    const primero = workers.find(w => puntos.some(p => p.instalador_id === w.id));
    const id = primero?.id || "";
    setWaWorkerId(id);
    setWaText(id ? construirMensajeWhatsApp(id) : "");
    setWaOpen(true);
  }

  function cambiarWaWorker(id: string) {
    setWaWorkerId(id);
    setWaText(id ? construirMensajeWhatsApp(id) : "");
  }

  function enviarWhatsApp() {
    const worker = workers.find(w => w.id === waWorkerId);
    if (navigator.clipboard) navigator.clipboard.writeText(waText).catch(() => {});
    const phone = String(worker?.phone || "").replace(/[^0-9]/g, "");
    window.open(phone ? `https://wa.me/${phone}?text=${encodeURIComponent(waText)}` : `https://wa.me/?text=${encodeURIComponent(waText)}`, "_blank");
    setWaOpen(false);
  }

  function flash(text: string) {
    setNotice(text);
    setTimeout(() => setNotice(""), 1800);
  }

  async function refresh(silencioso = false) {
    if (!silencioso) setLoading(true);
    const [campanaResult, kpisResult, puntosResult, incidenciasResult, gestoresResult, columnasResult] = await Promise.all([
      fetchCampana(params.id),
      fetchCampanaKpis(params.id),
      fetchPuntos(params.id),
      fetchIncidencias(params.id),
      fetchGestoresCampana(params.id),
      fetchCampanaColumnas(params.id)
    ]);
    const firstError = campanaResult.error || kpisResult.error || puntosResult.error || incidenciasResult.error || gestoresResult.error;
    setError(firstError || "");
    setCampana(campanaResult.data);
    setKpis(kpisResult.data);
    setPuntos(filterPuntosBySession(puntosResult.data, getCurrentAppSession()));
    setIncidencias(incidenciasResult.data);
    setGestores(gestoresResult.data);
    setColumnas(columnasResult.data);
    setLoading(false);
  }

  useEffect(() => {
    refresh();
    const search = new URLSearchParams(window.location.search);
    const importados = search.get("importados");
    if (importados) flash(`${Number(importados).toLocaleString("es-ES")} puntos importados${search.get("omitidos") && search.get("omitidos") !== "0" ? `, ${search.get("omitidos")} omitidos` : ""}${search.get("duplicados") ? `, ${search.get("duplicados")} duplicados no importados (código ya existente)` : ""}.`);
    const timer = setInterval(() => refresh(true), 30000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.id]);

  async function handleUpdatePunto(punto: PuntoVenta, patch: Partial<PuntoVenta>) {
    setSaving(true);
    const result = await updatePunto(punto.id, patch);
    if (result.error) { setError(result.error); setSaving(false); return; }
    if (patch.estado === "completado" && punto.estado !== "completado") {
      const bridgeError = await syncPuntoCompletadoConLogistica({ ...punto, ...patch }, campana, session);
      if (bridgeError) setError(`Punto guardado, pero la sincronización con Logística falló: ${bridgeError}`);
      else flash("Punto completado y sincronizado con Logística");
    } else if (patch.estado === "incidencia" && punto.estado !== "incidencia") {
      // Marcar un punto como incidencia desde el desplegable crea también su registro
      // en la pestaña Incidencias (si no hay ya una abierta), para que no se pierda.
      const yaAbierta = incidencias.some(inc => inc.punto_id === punto.id && inc.estado !== "resuelta");
      if (!yaAbierta) {
        await insertIncidencia({ punto_id: punto.id, campana_id: params.id, descripcion: `Incidencia marcada en el punto ${punto.nombre_comercial}.`, session });
        flash("Punto marcado como incidencia y registrado en Incidencias");
      } else {
        flash("Punto actualizado");
      }
    } else {
      flash("Punto actualizado");
    }
    await refresh(true);
    setSaving(false);
  }

  async function handleDeletePunto(punto: PuntoVenta) {
    if (!confirm(`¿Borrar el punto ${punto.nombre_comercial}?`)) return;
    setSaving(true);
    const result = await deletePuntoDb(punto.id);
    if (result.error) setError(result.error);
    else flash("Punto borrado");
    await refresh(true);
    setSaving(false);
  }

  async function handleRegistrarIncidencia(punto: PuntoVenta, descripcion: string) {
    setSaving(true);
    const result = await insertIncidencia({ punto_id: punto.id, campana_id: params.id, descripcion, session });
    if (result.error) { setError(result.error); setSaving(false); return; }
    await updatePunto(punto.id, { estado: "incidencia" });
    flash("Incidencia registrada");
    await refresh(true);
    setSaving(false);
  }

  async function handleIncidenciaEstado(incidencia: IncidenciaCampana, estado: IncidenciaEstado) {
    setSaving(true);
    const result = await setIncidenciaEstado(incidencia.id, estado);
    if (result.error) { setError(result.error); setSaving(false); return; }
    if (estado === "resuelta" && incidencia.punto_id) {
      const restantes = incidencias.filter(item => item.punto_id === incidencia.punto_id && item.id !== incidencia.id && item.estado !== "resuelta");
      const punto = puntos.find(item => item.id === incidencia.punto_id);
      if (!restantes.length && punto?.estado === "incidencia") await updatePunto(punto.id, { estado: "pendiente" });
    }
    flash(estado === "resuelta" ? "Incidencia resuelta" : "Incidencia actualizada");
    await refresh(true);
    setSaving(false);
  }

  // Actualización masiva desde Excel/CSV: empareja por código y solo pisa las
  // celdas con valor. Reutiliza el esquema de columnas de la campaña, así que un
  // reporte con las mismas cabeceras del archivo original actualiza sin remapear.
  async function handleUpdateFromExcel(file: File | null | undefined) {
    if (!file) return;
    setSaving(true);
    setError("");
    try {
      const parsed = await parseImportFile(file, columnas.length ? columnas : undefined);
      if (parsed.fileError) { setError(`No se pudo leer el archivo: ${parsed.fileError}`); return; }
      const sinCodigo = parsed.rows.filter(row => !String(row.data.codigo || "").trim()).length;
      if (sinCodigo === parsed.rows.length) { setError("El archivo no tiene columna de código; la actualización necesita un código por fila para emparejar los puntos."); return; }
      const filas = parsed.rows.filter(row => !row.errors.length).map(row => row.data);
      const insertarNuevos = window.confirm(`Se actualizarán los puntos existentes emparejados por código.\n\n¿Quieres además CREAR como nuevos los puntos cuyo código no exista todavía?\n\nAceptar = actualizar y crear nuevos · Cancelar = solo actualizar existentes`);
      const result = await updatePuntosPorCodigo(params.id, filas, { insertarNuevos });
      if (result.error) { setError(result.error); return; }
      const r = result.data;
      flash(`Actualización: ${r.actualizados} puntos actualizados · ${r.sinCambios} sin cambios · ${r.nuevos} nuevos · ${r.noEncontrados - r.nuevos} códigos no encontrados${sinCodigo ? ` · ${sinCodigo} filas sin código ignoradas` : ""}.`);
      await refresh(true);
    } finally {
      setSaving(false);
      if (updateFileRef.current) updateFileRef.current.value = "";
    }
  }

  async function handleAddPunto() {
    if (!nuevoPunto.nombre_comercial.trim()) { setError("El punto necesita un nombre comercial."); return; }
    setSaving(true);
    const result = await insertPuntosBatch(params.id, [{ ...nuevoPunto, nombre_comercial: nuevoPunto.nombre_comercial.trim() }]);
    if (result.error) setError(result.error);
    else { flash("Punto añadido"); setNuevoPunto({ ...emptyNuevoPunto }); setNuevoAbierto(false); }
    await refresh(true);
    setSaving(false);
  }

  const gestorStats = useMemo(() => gestores.map(gestor => {
    const propios = puntos.filter(punto => punto.gestor_id === gestor.gestor_id || (gestor.gestor_nombre && punto.gestor_nombre === gestor.gestor_nombre));
    const abiertas = incidencias.filter(incidencia => incidencia.estado !== "resuelta" && propios.some(punto => punto.id === incidencia.punto_id)).length;
    return { ...gestor, asignados: propios.length, completados: propios.filter(punto => punto.estado === "completado").length, incidencias: abiertas };
  }), [gestores, puntos, incidencias]);

  const incidenciasFiltradas = useMemo(
    () => incidencias.filter(incidencia => !filtroIncidencias || incidencia.estado === filtroIncidencias),
    [incidencias, filtroIncidencias]
  );

  // Pagos de la campaña: solo puntos completados generan pago; se agrupan por
  // trabajador (instalador; gestor como respaldo) en una sola línea con el total.
  const pagosResumen = useMemo(() => {
    const completados = puntos.filter(punto => punto.estado === "completado" && Number(punto.importe || 0) > 0);
    const map = new Map<string, { trabajador: string; puntos: number; importe: number }>();
    for (const punto of completados) {
      const trabajador = punto.instalador_nombre || punto.gestor_nombre || "Sin instalador";
      const grupo = map.get(trabajador) || { trabajador, puntos: 0, importe: 0 };
      grupo.puntos += 1;
      grupo.importe += Number(punto.importe || 0);
      map.set(trabajador, grupo);
    }
    const filas = Array.from(map.values()).sort((a, b) => b.importe - a.importe);
    return { filas, totalPuntos: completados.length, totalImporte: filas.reduce((sum, fila) => sum + fila.importe, 0), pendientes: puntos.length - completados.length };
  }, [puntos]);

  if (!session?.active) {
    return <main className="gc-module p-4"><section className="gc-empty mx-auto mt-10 max-w-2xl"><b>Inicia sesión</b> en MerchanOps para ver esta campaña.</section></main>;
  }
  if (!canAccessModule(session, "servicios")) {
    return <main className="gc-module p-4"><section className="gc-empty mx-auto mt-10 max-w-2xl">No tienes permiso para ver Grandes Campañas.</section></main>;
  }

  if (loading && !campana) {
    return <main className="gc-module"><section className="mx-auto max-w-[1280px] space-y-3 p-4"><div className="gc-skeleton h-24" /><div className="gc-skeleton h-28" /><div className="gc-skeleton h-64" /></section></main>;
  }

  if (!campana) {
    return <main className="gc-module p-4"><section className="gc-empty mx-auto mt-10 max-w-2xl"><b>Campaña no encontrada.</b> <a className="underline" href="/grandes-campanas">Volver al listado</a>.{error ? ` (${error})` : ""}</section></main>;
  }

  return (
    <main className="gc-module">
      <section className="mx-auto max-w-[1280px] space-y-4 p-4">
        {notice && <div className="gc-toast">{notice}</div>}
        {error && <div className="gc-toast gc-toast-error">{error}</div>}

        <div>
          <nav className="text-sm" style={{ color: "var(--gc-muted)" }}>
            <a href="/grandes-campanas" className="font-semibold hover:underline">Grandes Campañas</a>
            <span> / </span>
            <span className="font-semibold" style={{ color: "var(--gc-text)" }}>{campana.nombre}</span>
          </nav>
          <div className="mt-1 flex flex-wrap items-start justify-between gap-3">
            <div>
              <h1 className="flex flex-wrap items-center gap-3 text-2xl font-extrabold">{campana.nombre} <CampanaBadgeEstado estado={campana.estado} /></h1>
              <p className="mt-1 flex flex-wrap items-center gap-4 text-sm" style={{ color: "var(--gc-muted)" }}>
                <span>Cliente: <b style={{ color: "var(--gc-text)" }}>{campana.cliente_marca || "—"}</b></span>
                <span className="inline-flex items-center gap-1"><MapPin className="h-4 w-4" />{(campana.provincias || []).length ? `${campana.provincias.length} provincia${campana.provincias.length > 1 ? "s" : ""} (${campana.provincias.slice(0, 3).join(", ")}${campana.provincias.length > 3 ? "…" : ""})` : "Sin provincias"}</span>
                <span className="inline-flex items-center gap-1"><Users className="h-4 w-4" />{gestores.length} gestores</span>
                <span>{Number(kpis?.asignados || 0)} operativos</span>
              </p>
              <p className="mt-1 text-sm" style={{ color: "var(--gc-muted)" }}>Periodo: <b style={{ color: "var(--gc-text)" }}>{formatDate(campana.fecha_inicio)} — {formatDate(campana.fecha_fin)}</b></p>
            </div>
            <div className="flex flex-wrap gap-2 gc-no-print">
              <button className="gc-btn-outline" onClick={() => downloadXlsx(`campana_${campana.nombre.replace(/[^a-z0-9]+/gi, "_").toLowerCase()}.xlsx`, puntosCsvRows(puntos))}><FileDown className="h-4 w-4" />Exportar</button>
              <button className="gc-btn-outline" onClick={abrirWhatsApp}><MessageCircle className="h-4 w-4" />WhatsApp</button>
              <a href={`/grandes-campanas/${campana.id}/asignacion`} className="gc-btn-outline"><Users className="h-4 w-4" />Asignación rápida</a>
              {canManageCampaigns(session) && <a href={`/grandes-campanas/${campana.id}/editar`} className="gc-btn-outline"><Pencil className="h-4 w-4" />Editar</a>}
              {canManageCampaigns(session) && (
                <>
                  <input ref={updateFileRef} type="file" accept=".csv,.xls,.xlsx,text/csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" className="hidden" onChange={event => handleUpdateFromExcel(event.target.files?.[0])} />
                  <button className="gc-btn-outline" disabled={saving} onClick={() => updateFileRef.current?.click()} title="Sube un Excel/CSV con la columna de código para actualizar estado, fecha, importe o notas de los puntos existentes sin tocar el resto"><Upload className="h-4 w-4" />Actualizar desde Excel</button>
                </>
              )}
              {canManageCampaigns(session) && <button className="gc-btn-dark" onClick={() => setNuevoAbierto(open => !open)}><Plus className="h-4 w-4" />Añadir puntos</button>}
            </div>
          </div>
        </div>

        {nuevoAbierto && (
          <section className="gc-form-section gc-no-print">
            <h2 className="gc-form-title">Añadir punto</h2>
            <div className="grid gap-2 md:grid-cols-6">
              <label className="md:col-span-2"><span className="gc-label">Nombre comercial *</span><input className="gc-input" value={nuevoPunto.nombre_comercial} onChange={event => setNuevoPunto({ ...nuevoPunto, nombre_comercial: event.target.value })} /></label>
              <label className="md:col-span-2"><span className="gc-label">Dirección</span><input className="gc-input" value={nuevoPunto.direccion || ""} onChange={event => setNuevoPunto({ ...nuevoPunto, direccion: event.target.value || null })} /></label>
              <label><span className="gc-label">Provincia</span><input className="gc-input" value={nuevoPunto.provincia || ""} onChange={event => setNuevoPunto({ ...nuevoPunto, provincia: event.target.value || null })} /></label>
              <label><span className="gc-label">Importe</span><input type="number" className="gc-input" value={nuevoPunto.importe ?? ""} onChange={event => setNuevoPunto({ ...nuevoPunto, importe: event.target.value === "" ? null : Number(event.target.value) })} /></label>
              <label><span className="gc-label">Tipo</span><input className="gc-input" value={nuevoPunto.tipo || ""} onChange={event => setNuevoPunto({ ...nuevoPunto, tipo: event.target.value || null })} /></label>
              <label><span className="gc-label">Fecha visita</span><input type="date" className="gc-input" value={nuevoPunto.fecha_visita || ""} onChange={event => setNuevoPunto({ ...nuevoPunto, fecha_visita: event.target.value || null })} /></label>
              <label><span className="gc-label">Gestor</span>
                <select className="gc-select" value={nuevoPunto.gestor_id || ""} onChange={event => { const gestor = gestores.find(item => item.gestor_id === event.target.value); setNuevoPunto({ ...nuevoPunto, gestor_id: gestor?.gestor_id || null, gestor_nombre: gestor?.gestor_nombre || null }); }}>
                  <option value="">Sin asignar</option>
                  {gestores.map(gestor => <option key={gestor.id} value={gestor.gestor_id || ""}>{gestor.gestor_nombre}</option>)}
                </select>
              </label>
              <div className="flex items-end gap-2">
                <button className="gc-btn-dark" disabled={saving} onClick={handleAddPunto}>Guardar punto</button>
                <button className="gc-btn-outline" onClick={() => setNuevoAbierto(false)}>Cerrar</button>
              </div>
            </div>
          </section>
        )}

        {/* El gestor ve KPIs recalculados sobre sus provincias, sin presupuesto de campaña. */}
        <CampanaDetalleKpis
          campana={campana}
          kpis={admin ? kpis : kpisDesdePuntos(campana.id, puntos, incidencias, campana.fecha_fin)}
          showFinancials={admin}
        />

        <div className="gc-tabs gc-no-print">
          {tabs.map(([key, label]) => (
            <button key={key} className={`gc-tab ${tab === key ? "gc-tab-active" : ""}`} onClick={() => setTab(key)}>
              {label}
              {key === "incidencias" && Number(kpis?.incidencias_abiertas || 0) > 0 && <span className="ml-1 rounded-full px-1.5 text-xs font-bold" style={{ background: "#fbe9ec", color: "var(--gc-secondary)" }}>{kpis?.incidencias_abiertas}</span>}
            </button>
          ))}
        </div>

        {tab === "puntos" && (
          <PuntosTabla
            puntos={puntos}
            incidencias={incidencias}
            isAdmin={admin}
            columnas={columnas}
            workers={workers}
            saving={saving}
            onUpdatePunto={handleUpdatePunto}
            onDeletePunto={handleDeletePunto}
            onRegistrarIncidencia={handleRegistrarIncidencia}
          />
        )}

        {tab === "gestores" && (
          !gestorStats.length ? <div className="gc-empty"><b>Sin gestores asignados.</b> Asigna el equipo desde «Editar».</div> : (
            <div className="gc-table-wrap">
              <table className="gc-table">
                <thead><tr><th>Gestor</th><th>Provincia</th><th style={{ textAlign: "right" }}>Puntos asignados</th><th style={{ textAlign: "right" }}>Completados</th><th style={{ textAlign: "right" }}>Incidencias</th><th>Último acceso</th><th>Acciones</th></tr></thead>
                <tbody>
                  {gestorStats.map(gestor => (
                    <tr key={gestor.id}>
                      <td><span className="inline-flex items-center gap-2"><GestorAvatar name={gestor.gestor_nombre} />{gestor.gestor_nombre || "—"}</span></td>
                      <td>{gestor.provincia || "—"}</td>
                      <td className="text-right font-semibold">{gestor.asignados}</td>
                      <td className="text-right">{gestor.completados}</td>
                      <td className="text-right">{gestor.incidencias > 0 ? <b style={{ color: "var(--gc-secondary)" }}>{gestor.incidencias}</b> : "0"}</td>
                      <td style={{ color: "var(--gc-muted)" }}>—</td>
                      <td><button className="gc-btn-outline" onClick={() => setTab("puntos")}>Ver puntos</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        )}

        {tab === "incidencias" && (
          <div className="space-y-3">
            <div className="flex items-end gap-3">
              <label className="w-48">
                <span className="gc-label">Estado</span>
                <select className="gc-select" value={filtroIncidencias} onChange={event => setFiltroIncidencias(event.target.value)}>
                  <option value="">Todas</option>
                  <option value="abierta">Abierta</option>
                  <option value="en_gestion">En gestión</option>
                  <option value="resuelta">Resuelta</option>
                </select>
              </label>
            </div>
            {!incidenciasFiltradas.length ? <div className="gc-empty"><b>Sin incidencias{filtroIncidencias ? " con ese estado" : ""}.</b></div> : (
              <div className="gc-table-wrap">
                <table className="gc-table">
                  <thead><tr><th>#</th><th>Punto</th><th>Gestor</th><th>Descripción</th><th>Estado</th><th>Fecha</th><th>Acciones</th></tr></thead>
                  <tbody>
                    {incidenciasFiltradas.map((incidencia, index) => {
                      const punto = puntos.find(item => item.id === incidencia.punto_id);
                      return (
                        <tr key={incidencia.id} className={incidencia.estado !== "resuelta" ? "gc-row-incidencia" : ""}>
                          <td className="font-mono text-xs">{String(index + 1).padStart(3, "0")}</td>
                          <td className="font-semibold">{punto?.nombre_comercial || "Punto eliminado"}</td>
                          <td>{incidencia.gestor_nombre || "—"}</td>
                          <td className="max-w-[320px]">{incidencia.descripcion || "—"}</td>
                          <td><IncidenciaBadgeEstado estado={incidencia.estado} /></td>
                          <td>{formatDate(incidencia.created_at)}</td>
                          <td>
                            {incidencia.estado !== "resuelta" && (
                              <span className="inline-flex gap-2">
                                {incidencia.estado === "abierta" && <button className="gc-btn-outline" disabled={saving} onClick={() => handleIncidenciaEstado(incidencia, "en_gestion")}>En gestión</button>}
                                <button className="gc-btn-dark" disabled={saving} onClick={() => handleIncidenciaEstado(incidencia, "resuelta")}>Resolver</button>
                              </span>
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
        )}

        {tab === "pagos" && (
          admin ? (
            !pagosResumen.filas.length ? (
              <div className="gc-empty"><b>Todavía no hay pagos.</b> El pago de un punto se genera cuando pasa a <b>Completado</b> y tiene importe. Ahora mismo hay {pagosResumen.pendientes} punto(s) sin completar.</div>
            ) : (
              <div className="space-y-3">
                <div className="grid gap-3 md:grid-cols-3">
                  <div className="gc-kpi"><p className="gc-kpi-label">Puntos pagables</p><p className="gc-kpi-value">{pagosResumen.totalPuntos.toLocaleString("es-ES")}</p></div>
                  <div className="gc-kpi"><p className="gc-kpi-label">Total a pagar</p><p className="gc-kpi-value">{eur(pagosResumen.totalImporte)}</p></div>
                  <div className="gc-kpi"><p className="gc-kpi-label">Pendientes de completar</p><p className="gc-kpi-value">{pagosResumen.pendientes.toLocaleString("es-ES")}</p></div>
                </div>
                <div className="gc-table-wrap">
                  <table className="gc-table">
                    <thead><tr><th>Trabajador</th><th style={{ textAlign: "right" }}>Puntos completados</th><th style={{ textAlign: "right" }}>Importe acumulado</th></tr></thead>
                    <tbody>
                      {pagosResumen.filas.map(fila => (
                        <tr key={fila.trabajador}>
                          <td><span className="inline-flex items-center gap-2"><GestorAvatar name={fila.trabajador} size={24} />{fila.trabajador}</span></td>
                          <td className="text-right font-semibold">{fila.puntos}</td>
                          <td className="text-right font-semibold">{eur(fila.importe)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <div className="gc-table-foot"><span>Una línea por trabajador con el importe actualizado según los puntos completados. El detalle contable definitivo vive en <a className="underline" href="/historial-economico">Historial económico</a> (sincroniza allí para exportar pagos).</span></div>
                </div>
              </div>
            )
          ) : (
            <div className="gc-empty">El detalle de pagos está reservado a administración.</div>
          )
        )}

        {(tab === "documentos" || tab === "historial") && (
          <div className="gc-empty"><b>Próximamente.</b> Esta pestaña se activará cuando haya datos de {tab === "documentos" ? "documentación" : "historial de cambios"} para esta campaña.</div>
        )}

        {admin && (
          <div className="gc-note flex items-start gap-2">
            <Info className="mt-0.5 h-4 w-4 shrink-0" />
            <span><b>Sobre esta vista:</b> estás visualizando el desglose operativo de la campaña. Los KPIs se recalculan automáticamente cada 30 segundos y tras cada cambio. Al completar un punto se sincroniza su necesidad de material con el módulo de Logística. Las incidencias abiertas bloquean el cierre administrativo de la línea correspondiente.</span>
          </div>
        )}
      </section>

      {waOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-label="Enviar WhatsApp">
          <div className="absolute inset-0 bg-slate-900/40" onClick={() => setWaOpen(false)} />
          <div className="relative w-full max-w-lg rounded-2xl bg-white p-5 shadow-2xl">
            <h2 className="text-lg font-bold">Enviar campaña por WhatsApp</h2>
            <p className="mt-1 text-sm" style={{ color: "var(--gc-muted)" }}>Elige el instalador, edita el mensaje (puedes quitar lo que no necesites) y envía. Se copia al portapapeles y abre WhatsApp.</p>
            <label className="mt-3 block">
              <span className="gc-label">Instalador</span>
              <select className="gc-select" value={waWorkerId} onChange={event => cambiarWaWorker(event.target.value)}>
                <option value="">— Sin instalador (mensaje genérico) —</option>
                {workers.map(worker => {
                  const n = puntos.filter(p => p.instalador_id === worker.id).length;
                  return <option key={worker.id} value={worker.id}>{worker.name}{n ? ` (${n} puntos)` : ""}{worker.phone ? "" : " · sin teléfono"}</option>;
                })}
              </select>
            </label>
            <label className="mt-3 block">
              <span className="gc-label">Mensaje</span>
              <textarea className="gc-textarea" rows={12} value={waText} onChange={event => setWaText(event.target.value)} />
            </label>
            <div className="mt-4 flex justify-end gap-2">
              <button className="gc-btn-outline" onClick={() => setWaOpen(false)}>Cancelar</button>
              <button className="gc-btn-dark" disabled={!waText.trim()} onClick={enviarWhatsApp}><MessageCircle className="h-4 w-4" />Copiar y abrir WhatsApp</button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

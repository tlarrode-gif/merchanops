"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, Eye, FileDown, MapPin, Pencil, Plus } from "lucide-react";
import { CampanaBadgeEstado } from "@/components/grandes-campanas/campana-badge-estado";
import { CampanaFiltros, CampanaFiltrosState, emptyCampanaFiltros } from "@/components/grandes-campanas/campana-filtros";
import { CampanaKpiCards } from "@/components/grandes-campanas/campana-kpi-cards";
import { GestorAvatarStack } from "@/components/grandes-campanas/gestor-avatars";
import { AppSession, canAccessModule, getCurrentAppSession, isAdminSession, merchanopsSessionChangeEvent, sessionProvinceLabel } from "@/lib/access-control";
import { CampanaListadoRow, campanaCsvRows, dateOnly, downloadCsv, eurCompact, fetchCampanasListado, formatDate } from "@/lib/campanas";

const PAGE_SIZE = 25;

export default function GrandesCampanasPage() {
  const [session, setSession] = useState<AppSession | null>(() => typeof window !== "undefined" ? getCurrentAppSession() : null);
  const [rows, setRows] = useState<CampanaListadoRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [filtros, setFiltros] = useState<CampanaFiltrosState>(emptyCampanaFiltros);
  const [page, setPage] = useState(1);
  const admin = isAdminSession(session);

  async function refresh(scope?: AppSession | null) {
    setLoading(true);
    const result = await fetchCampanasListado(scope ?? getCurrentAppSession());
    setRows(result.data);
    setError(result.error || "");
    setLoading(false);
  }

  useEffect(() => {
    const syncSession = () => { const next = getCurrentAppSession(); setSession(next); refresh(next); };
    syncSession();
    window.addEventListener(merchanopsSessionChangeEvent, syncSession);
    return () => window.removeEventListener(merchanopsSessionChangeEvent, syncSession);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const provincias = useMemo(() => Array.from(new Set(rows.flatMap(row => row.provincias || []))).sort(), [rows]);
  const gestores = useMemo(() => Array.from(new Set(rows.flatMap(row => row.gestores_nombres || []))).sort(), [rows]);

  const filtradas = useMemo(() => rows.filter(row => {
    const hay = [row.nombre, row.cliente_marca, (row.provincias || []).join(" ")].join(" ").toLowerCase();
    return (!filtros.q || hay.includes(filtros.q.toLowerCase()))
      && (!filtros.estado || row.estado === filtros.estado)
      && (!filtros.provincia || (row.provincias || []).includes(filtros.provincia))
      && (!filtros.gestor || (row.gestores_nombres || []).includes(filtros.gestor))
      && (!filtros.desde || dateOnly(row.fecha_inicio) >= filtros.desde)
      && (!filtros.hasta || dateOnly(row.fecha_fin || row.fecha_inicio) <= filtros.hasta);
  }), [rows, filtros]);

  const totalPages = Math.max(1, Math.ceil(filtradas.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const pageRows = filtradas.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);
  const desde = filtradas.length ? (currentPage - 1) * PAGE_SIZE + 1 : 0;
  const hasta = Math.min(currentPage * PAGE_SIZE, filtradas.length);

  function cambiarFiltros(next: CampanaFiltrosState) {
    setFiltros(next);
    setPage(1);
  }

  function exportarCampana(row: CampanaListadoRow) {
    downloadCsv(`campana_${row.nombre.replace(/[^a-z0-9]+/gi, "_").toLowerCase()}.csv`, campanaCsvRows([row]));
  }

  if (!session?.active) {
    return <main className="gc-module p-4"><section className="gc-empty mx-auto mt-10 max-w-2xl"><b>Inicia sesión</b> en MerchanOps para acceder a Grandes Campañas.</section></main>;
  }
  if (!canAccessModule(session, "servicios")) {
    return <main className="gc-module p-4"><section className="gc-empty mx-auto mt-10 max-w-2xl">No tienes permiso para acceder a Grandes Campañas.</section></main>;
  }

  return (
    <main className="gc-module">
      <section className="mx-auto max-w-[1280px] space-y-4 p-4">
        <div>
          <a href="/" className="inline-flex items-center gap-1 text-sm font-semibold hover:underline" style={{ color: "var(--gc-muted)" }}>
            <ArrowLeft className="h-4 w-4" /> Volver al panel principal
          </a>
          <div className="mt-1 flex flex-wrap items-start justify-between gap-3">
            <div>
              <h1 className="text-3xl font-extrabold">Grandes Campañas</h1>
              <p className="text-sm" style={{ color: "var(--gc-muted)" }}>Gestión masiva de puntos, instaladores, incidencias y pagos por trabajador.</p>
              <p className="mt-2 inline-flex items-center gap-1 rounded-full border px-3 py-1 text-xs font-semibold" style={{ borderColor: "var(--gc-border)", background: "#fff" }}>
                <Eye className="h-3.5 w-3.5" style={{ color: "var(--gc-secondary)" }} />
                Vista: {admin ? (filtros.provincia || "Todas las provincias") : sessionProvinceLabel(session)}{admin ? " [admin]" : ""}
              </p>
            </div>
            <a href="/grandes-campanas/nueva" className="gc-btn-dark"><Plus className="h-4 w-4" />Crear gran campaña</a>
          </div>
        </div>

        {error && <div className="gc-toast gc-toast-error">{error}</div>}

        {loading ? (
          <div className="grid gap-3 md:grid-cols-3 lg:grid-cols-5">
            {[0, 1, 2, 3, 4].map(index => <div key={index} className="gc-skeleton h-24" />)}
          </div>
        ) : (
          <CampanaKpiCards rows={filtradas} />
        )}

        <CampanaFiltros filtros={filtros} onChange={cambiarFiltros} provincias={provincias} gestores={gestores} isAdmin={admin} />

        {loading ? (
          <div className="gc-skeleton h-64" />
        ) : !filtradas.length ? (
          <div className="gc-empty">
            <b>No hay campañas visibles.</b> {rows.length ? "Ajusta los filtros para ver más resultados." : "Crea tu primera gran campaña con el botón «Crear gran campaña»."}
          </div>
        ) : (
          <div className="gc-table-wrap">
            <table className="gc-table">
              <thead>
                <tr>
                  <th>Nombre campaña</th>
                  <th>Cliente</th>
                  <th>Provincia(s)</th>
                  <th>Gestor(es)</th>
                  <th style={{ textAlign: "right" }}>Puntos</th>
                  <th style={{ textAlign: "right" }}>Asig.</th>
                  <th style={{ textAlign: "right" }}>Incid.</th>
                  <th style={{ textAlign: "right" }}>Presupuesto</th>
                  <th>Estado</th>
                  <th>Inicio</th>
                  <th>Acciones</th>
                </tr>
              </thead>
              <tbody>
                {pageRows.map(row => (
                  <tr key={row.id} className="gc-row-link" onClick={() => { window.location.href = `/grandes-campanas/${row.id}`; }}>
                    <td>
                      <p className="font-bold" style={{ color: "var(--gc-secondary)" }}>{row.nombre}</p>
                      {row.descripcion && <p className="max-w-[240px] truncate text-xs" style={{ color: "var(--gc-muted)" }}>{row.descripcion}</p>}
                    </td>
                    <td>{row.cliente_marca || "—"}</td>
                    <td>
                      <span className="inline-flex items-center gap-1">
                        <MapPin className="h-3.5 w-3.5" style={{ color: "var(--gc-muted)" }} />
                        {(row.provincias || []).length > 2 ? `${row.provincias.slice(0, 2).join(", ")} +${row.provincias.length - 2}` : (row.provincias || []).join(", ") || "Todas"}
                      </span>
                    </td>
                    <td><GestorAvatarStack names={row.gestores_nombres || []} /></td>
                    <td className="text-right font-semibold">{Number(row.total_puntos).toLocaleString("es-ES")}</td>
                    <td className="text-right">{Number(row.asignados).toLocaleString("es-ES")}</td>
                    <td className="text-right">{row.incidencias_abiertas > 0 ? <b style={{ color: "var(--gc-secondary)" }}>{row.incidencias_abiertas}</b> : "0"}</td>
                    <td className="text-right font-semibold">{eurCompact(Number(row.presupuesto || row.importe_total || 0))}</td>
                    <td><CampanaBadgeEstado estado={row.estado} /></td>
                    <td>{formatDate(row.fecha_inicio)}</td>
                    <td onClick={event => event.stopPropagation()}>
                      <span className="inline-flex gap-1">
                        <a href={`/grandes-campanas/${row.id}`} title="Ver detalle" className="rounded-lg border p-1.5 hover:bg-slate-50" style={{ borderColor: "var(--gc-border)" }}><Eye className="h-4 w-4" /></a>
                        <a href={`/grandes-campanas/${row.id}/editar`} title="Editar" className="rounded-lg border p-1.5 hover:bg-slate-50" style={{ borderColor: "var(--gc-border)" }}><Pencil className="h-4 w-4" /></a>
                        <button title="Exportar CSV" onClick={() => exportarCampana(row)} className="rounded-lg border p-1.5 hover:bg-slate-50" style={{ borderColor: "var(--gc-border)" }}><FileDown className="h-4 w-4" /></button>
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="gc-table-foot">
              <span>Mostrando {desde}-{hasta} de {filtradas.length.toLocaleString("es-ES")} campañas</span>
              <span className="gc-pager">
                <button disabled={currentPage <= 1} onClick={() => setPage(currentPage - 1)}>‹</button>
                {Array.from({ length: Math.min(totalPages, 5) }, (_, index) => {
                  const pageNumber = index + 1;
                  return <button key={pageNumber} className={pageNumber === currentPage ? "gc-page-active" : ""} onClick={() => setPage(pageNumber)}>{pageNumber}</button>;
                })}
                {totalPages > 5 && <span className="px-1 text-xs">… {totalPages}</span>}
                <button disabled={currentPage >= totalPages} onClick={() => setPage(currentPage + 1)}>›</button>
              </span>
            </div>
          </div>
        )}
      </section>
    </main>
  );
}

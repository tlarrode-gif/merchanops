"use client";

import { useMemo, useState } from "react";
import { AlertTriangle, ChevronDown, ChevronRight, FileDown, Package, Printer, Search, Trash2 } from "lucide-react";
import { PuntoBadgeEstado } from "@/components/grandes-campanas/campana-badge-estado";
import { GestorAvatar } from "@/components/grandes-campanas/gestor-avatars";
import { CampanaColumna, columnasExtraVisibles, formatearValorColumna } from "@/lib/campana-columnas";
import { IncidenciaCampana, PuntoEstado, PuntoVenta, dateOnly, downloadCsv, downloadXlsx, eur, formatDate, puntoEstadoLabels, puntoEstados, puntosCsvRows } from "@/lib/campanas";

const PAGE_SIZE = 25;

type PuntosFiltros = { q: string; provincia: string; estado: string; gestor: string; tipo: string; desde: string; hasta: string };
const emptyFiltros: PuntosFiltros = { q: "", provincia: "", estado: "", gestor: "", tipo: "", desde: "", hasta: "" };

/** Píldora con el estado logístico del punto, enlazada a la solicitud. */
function LogisticaPill({ info }: { info?: { request_id: string | null; status: string | null } }) {
  if (!info?.request_id) return null;
  const text = (info.status || "solicitado").replaceAll("_", " ");
  const raw = info.status || "";
  const tone = ["bloqueada", "con_incidencia", "pendiente_stock", "cancelada"].includes(raw)
    ? { background: "#fdecec", color: "#9f1d2e" }
    : ["entregada", "consumida"].includes(raw)
      ? { background: "#e8f7ee", color: "#1c7c43" }
      : { background: "#fff6e5", color: "#8a5b00" };
  return (
    <a
      href={`/logistica/solicitudes?id=${info.request_id}`}
      onClick={event => event.stopPropagation()}
      className="mt-0.5 inline-flex max-w-full items-center gap-1 truncate rounded-full px-2 py-0.5 text-[10px] font-semibold"
      style={tone}
      title="Ver solicitud en Logística"
    >
      <Package className="h-3 w-3" />
      Logística: {text}
    </a>
  );
}

export function PuntosTabla({
  puntos,
  incidencias,
  isAdmin,
  columnas = [],
  workers = [],
  saving,
  logistica = {},
  onSolicitarMaterial,
  onUpdatePunto,
  onDeletePunto,
  onRegistrarIncidencia
}: {
  puntos: PuntoVenta[];
  incidencias: IncidenciaCampana[];
  isAdmin: boolean;
  columnas?: CampanaColumna[];
  workers?: Array<{ id: string; name: string; province?: string | null }>;
  saving: boolean;
  /** Estado logístico por punto (necesidades source_type "campaign"). */
  logistica?: Record<string, { request_id: string | null; status: string | null }>;
  onSolicitarMaterial?: (punto: PuntoVenta) => void;
  onUpdatePunto: (punto: PuntoVenta, patch: Partial<PuntoVenta>) => Promise<void>;
  onDeletePunto: (punto: PuntoVenta) => Promise<void>;
  onRegistrarIncidencia: (punto: PuntoVenta, descripcion: string) => Promise<void>;
}) {
  const [filtros, setFiltros] = useState<PuntosFiltros>(emptyFiltros);
  const [masFiltros, setMasFiltros] = useState(false);
  const [page, setPage] = useState(1);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [incidenciaPara, setIncidenciaPara] = useState<string | null>(null);
  const [incidenciaTexto, setIncidenciaTexto] = useState("");

  const abiertasPorPunto = useMemo(() => {
    const map = new Map<string, number>();
    incidencias.filter(inc => inc.estado !== "resuelta").forEach(inc => {
      if (inc.punto_id) map.set(inc.punto_id, (map.get(inc.punto_id) || 0) + 1);
    });
    return map;
  }, [incidencias]);

  // Esquema de columnas de la campaña (Fase 2): columnas extra visibles según rol.
  // Sin esquema (campañas anteriores) se muestran las claves crudas de datos_extra.
  const extrasVisibles = useMemo(() => columnasExtraVisibles(columnas, isAdmin), [columnas, isAdmin]);
  const hayEsquema = useMemo(() => columnas.some(col => !col.campo_interno), [columnas]);

  const provincias = useMemo(() => Array.from(new Set(puntos.map(p => p.provincia).filter(Boolean))) as string[], [puntos]);
  const gestores = useMemo(() => Array.from(new Set(puntos.map(p => p.gestor_nombre).filter(Boolean))) as string[], [puntos]);
  const tipos = useMemo(() => Array.from(new Set(puntos.map(p => p.tipo).filter(Boolean))) as string[], [puntos]);

  const filtrados = useMemo(() => puntos.filter(punto => {
    const hay = [punto.nombre_comercial, punto.codigo, punto.direccion, punto.provincia, punto.gestor_nombre, punto.tipo, punto.notas].join(" ").toLowerCase();
    return (!filtros.q || hay.includes(filtros.q.toLowerCase()))
      && (!filtros.provincia || punto.provincia === filtros.provincia)
      && (!filtros.estado || punto.estado === filtros.estado)
      && (!filtros.gestor || punto.gestor_nombre === filtros.gestor)
      && (!filtros.tipo || punto.tipo === filtros.tipo)
      && (!filtros.desde || dateOnly(punto.fecha_visita) >= filtros.desde)
      && (!filtros.hasta || dateOnly(punto.fecha_visita) <= filtros.hasta);
  }), [puntos, filtros]);

  const totalPages = Math.max(1, Math.ceil(filtrados.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const pageRows = filtrados.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);
  const importeTotal = filtrados.reduce((sum, punto) => sum + Number(punto.importe || 0), 0);

  function patchFiltros(partial: Partial<PuntosFiltros>) {
    setFiltros(prev => ({ ...prev, ...partial }));
    setPage(1);
  }

  async function guardarIncidencia(punto: PuntoVenta) {
    if (!incidenciaTexto.trim()) return;
    await onRegistrarIncidencia(punto, incidenciaTexto.trim());
    setIncidenciaTexto("");
    setIncidenciaPara(null);
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <label className="min-w-[220px] flex-1">
          <span className="gc-label">Buscar</span>
          <span className="gc-search block">
            <Search className="h-4 w-4" />
            <input className="gc-input" placeholder="Buscar por nombre, código o dirección..." value={filtros.q} onChange={event => patchFiltros({ q: event.target.value })} />
          </span>
        </label>
        <label className="w-40">
          <span className="gc-label">Provincia</span>
          <select className="gc-select" value={filtros.provincia} onChange={event => patchFiltros({ provincia: event.target.value })}>
            <option value="">{isAdmin ? "Todas" : "Mis provincias"}</option>
            {provincias.map(provincia => <option key={provincia} value={provincia}>{provincia}</option>)}
          </select>
        </label>
        <label className="w-40">
          <span className="gc-label">Estado</span>
          <select className="gc-select" value={filtros.estado} onChange={event => patchFiltros({ estado: event.target.value })}>
            <option value="">Todos</option>
            {puntoEstados.map(estado => <option key={estado} value={estado}>{puntoEstadoLabels[estado]}</option>)}
          </select>
        </label>
        <label className="w-44">
          <span className="gc-label">Gestor</span>
          <select className="gc-select" value={filtros.gestor} onChange={event => patchFiltros({ gestor: event.target.value })}>
            <option value="">Todos</option>
            {gestores.map(gestor => <option key={gestor} value={gestor}>{gestor}</option>)}
          </select>
        </label>
        <button className="gc-btn-outline" onClick={() => setMasFiltros(value => !value)}>Más filtros {masFiltros ? "−" : "+"}</button>
      </div>
      {masFiltros && (
        <div className="flex flex-wrap items-end gap-3">
          <label className="w-44">
            <span className="gc-label">Tipo</span>
            <select className="gc-select" value={filtros.tipo} onChange={event => patchFiltros({ tipo: event.target.value })}>
              <option value="">Todos</option>
              {tipos.map(tipo => <option key={tipo} value={tipo}>{tipo}</option>)}
            </select>
          </label>
          <label className="w-40">
            <span className="gc-label">Visita desde</span>
            <input type="date" className="gc-input" value={filtros.desde} onChange={event => patchFiltros({ desde: event.target.value })} />
          </label>
          <label className="w-40">
            <span className="gc-label">Visita hasta</span>
            <input type="date" className="gc-input" value={filtros.hasta} onChange={event => patchFiltros({ hasta: event.target.value })} />
          </label>
          <button className="gc-btn-outline" onClick={() => { setFiltros(emptyFiltros); setPage(1); }}>Limpiar</button>
        </div>
      )}

      {!filtrados.length ? (
        <div className="gc-empty"><b>No hay puntos que coincidan con los filtros.</b> Importa puntos desde un CSV o añádelos manualmente.</div>
      ) : (
        <div className="gc-table-wrap">
          <table className="gc-table">
            <thead>
              <tr>
                <th style={{ width: 36 }} />
                <th>#</th>
                <th>Punto de venta</th>
                <th>Provincia</th>
                <th>Gestor</th>
                <th>Instalador</th>
                <th>Tipo</th>
                <th>Estado</th>
                <th>Fecha visita</th>
                <th>Incid.</th>
                <th style={{ textAlign: "right" }}>Importe</th>
                <th className="gc-no-print">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {pageRows.map((punto, index) => {
                const abiertas = abiertasPorPunto.get(punto.id) || 0;
                const isOpen = expanded === punto.id;
                return [
                  <tr key={punto.id} className={`gc-row-link ${abiertas > 0 ? "gc-row-incidencia" : ""}`} onClick={() => setExpanded(isOpen ? null : punto.id)}>
                    <td>{isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}</td>
                    <td className="font-mono text-xs">{String((currentPage - 1) * PAGE_SIZE + index + 1).padStart(3, "0")}</td>
                    <td>
                      <p className="font-semibold">{punto.nombre_comercial}</p>
                      <p className="text-xs" style={{ color: "var(--gc-muted)" }}>{punto.direccion || "Sin dirección"}</p>
                      <LogisticaPill info={logistica[punto.id]} />
                    </td>
                    <td>{punto.provincia || "—"}</td>
                    <td>
                      {punto.gestor_nombre
                        ? <span className="inline-flex items-center gap-2"><GestorAvatar name={punto.gestor_nombre} size={24} />{punto.gestor_nombre}</span>
                        : <span style={{ color: "var(--gc-muted)" }}>Sin asignar</span>}
                    </td>
                    <td onClick={event => event.stopPropagation()}>
                      {workers.length ? (
                        <select
                          className="gc-select"
                          style={{ width: 150, padding: "5px 8px", fontSize: 12 }}
                          value={punto.instalador_id || ""}
                          disabled={saving}
                          onChange={event => {
                            const worker = workers.find(w => w.id === event.target.value);
                            onUpdatePunto(punto, { instalador_id: worker?.id || null, instalador_nombre: worker?.name || null });
                          }}
                        >
                          <option value="">Sin instalador</option>
                          {workers.map(worker => <option key={worker.id} value={worker.id}>{worker.name}</option>)}
                        </select>
                      ) : (punto.instalador_nombre || <span style={{ color: "var(--gc-muted)" }}>—</span>)}
                    </td>
                    <td>{punto.tipo || "—"}</td>
                    <td><PuntoBadgeEstado estado={punto.estado} /></td>
                    <td>{formatDate(punto.fecha_visita)}</td>
                    <td>{abiertas > 0 ? <span className="inline-flex items-center gap-1 font-bold" style={{ color: "var(--gc-secondary)" }}><AlertTriangle className="h-4 w-4" />{abiertas}</span> : "—"}</td>
                    <td className="text-right font-semibold">{punto.importe != null ? eur(punto.importe) : "—"}</td>
                    <td className="gc-no-print" onClick={event => event.stopPropagation()}>
                      <select
                        className="gc-select"
                        style={{ width: 130, padding: "5px 8px", fontSize: 12 }}
                        value={punto.estado}
                        disabled={saving}
                        onChange={event => onUpdatePunto(punto, { estado: event.target.value as PuntoEstado })}
                      >
                        {puntoEstados.map(estado => <option key={estado} value={estado}>{puntoEstadoLabels[estado]}</option>)}
                      </select>
                    </td>
                  </tr>,
                  isOpen && (
                    <tr key={`${punto.id}-detalle`}>
                      <td colSpan={12} style={{ background: "#fafbfc" }}>
                        <div className="grid gap-4 p-3 md:grid-cols-2 lg:grid-cols-3">
                          <div className="space-y-1 text-sm">
                            <p className="text-xs font-bold uppercase" style={{ color: "var(--gc-muted)" }}>Ficha del punto</p>
                            <p><b>Código:</b> {punto.codigo || "—"}</p>
                            <p><b>Dirección:</b> {punto.direccion || "—"}</p>
                            <p><b>Provincia:</b> {punto.provincia || "—"}</p>
                            <p><b>Tipo:</b> {punto.tipo || "—"}</p>
                            <p><b>Gestor de zona:</b> {punto.gestor_nombre || "Sin asignar"}</p>
                            <p><b>Instalador:</b> {punto.instalador_nombre || "Sin asignar"}</p>
                            <p><b>Fecha visita:</b> {formatDate(punto.fecha_visita)}</p>
                            <p><b>Importe:</b> {punto.importe != null ? eur(punto.importe) : "—"}</p>
                          </div>
                          <div className="space-y-1 text-sm">
                            <p className="text-xs font-bold uppercase" style={{ color: "var(--gc-muted)" }}>Datos del archivo importado</p>
                            {hayEsquema
                              ? extrasVisibles.length
                                ? extrasVisibles.map(col => (
                                    <p key={col.nombre_original}><b>{col.nombre_visible}:</b> {formatearValorColumna(punto.datos_extra?.[col.nombre_original], col.tipo)}</p>
                                  ))
                                : <p style={{ color: "var(--gc-muted)" }}>Sin campos visibles para tu rol.</p>
                              : punto.datos_extra && Object.keys(punto.datos_extra).length
                                ? Object.entries(punto.datos_extra).map(([key, value]) => <p key={key}><b>{key}:</b> {String(value)}</p>)
                                : <p style={{ color: "var(--gc-muted)" }}>Sin campos adicionales.</p>}
                            <p className="pt-2 text-xs font-bold uppercase" style={{ color: "var(--gc-muted)" }}>Notas</p>
                            <textarea
                              className="gc-textarea"
                              rows={2}
                              defaultValue={punto.notas || ""}
                              onBlur={event => { if (event.target.value !== (punto.notas || "")) onUpdatePunto(punto, { notas: event.target.value }); }}
                            />
                          </div>
                          <div className="space-y-2 text-sm gc-no-print">
                            <p className="text-xs font-bold uppercase" style={{ color: "var(--gc-muted)" }}>Acciones</p>
                            {incidenciaPara === punto.id ? (
                              <div className="space-y-2">
                                <textarea className="gc-textarea" rows={3} placeholder="Describe la incidencia..." value={incidenciaTexto} onChange={event => setIncidenciaTexto(event.target.value)} />
                                <div className="flex gap-2">
                                  <button className="gc-btn-dark" disabled={saving || !incidenciaTexto.trim()} onClick={() => guardarIncidencia(punto)}>Guardar incidencia</button>
                                  <button className="gc-btn-outline" onClick={() => { setIncidenciaPara(null); setIncidenciaTexto(""); }}>Cancelar</button>
                                </div>
                              </div>
                            ) : (
                              <button className="gc-btn-outline" disabled={saving} onClick={() => setIncidenciaPara(punto.id)}>
                                <AlertTriangle className="h-4 w-4" />
                                Registrar incidencia
                              </button>
                            )}
                            {onSolicitarMaterial && (logistica[punto.id]?.request_id ? (
                              <a className="gc-btn-outline" href={`/logistica/solicitudes?id=${logistica[punto.id]?.request_id}`}>
                                <Package className="h-4 w-4" />
                                Ver petición logística
                              </a>
                            ) : (
                              <button className="gc-btn-outline" disabled={saving} onClick={() => onSolicitarMaterial(punto)}>
                                <Package className="h-4 w-4" />
                                Solicitar material
                              </button>
                            ))}
                            {isAdmin && (
                              <button className="gc-btn-outline gc-btn-danger" disabled={saving} onClick={() => onDeletePunto(punto)}>
                                <Trash2 className="h-4 w-4" />
                                Borrar punto
                              </button>
                            )}
                          </div>
                        </div>
                      </td>
                    </tr>
                  )
                ];
              })}
            </tbody>
          </table>
          <div className="gc-table-foot">
            <span><b>{filtrados.length.toLocaleString("es-ES")}</b> de {puntos.length.toLocaleString("es-ES")} puntos · Importe total acumulado: <b>{eur(importeTotal)}</b></span>
            <span className="flex flex-wrap items-center gap-2 gc-no-print">
              <button className="gc-btn-outline" onClick={() => downloadXlsx("puntos_campana.xlsx", puntosCsvRows(filtrados))}><FileDown className="h-4 w-4" />Excel</button>
              <button className="gc-btn-outline" onClick={() => downloadCsv("puntos_campana.csv", puntosCsvRows(filtrados))}><FileDown className="h-4 w-4" />CSV</button>
              <button className="gc-btn-outline" onClick={() => window.print()}><Printer className="h-4 w-4" />Imprimir</button>
              <span className="gc-pager">
                <button disabled={currentPage <= 1} onClick={() => setPage(currentPage - 1)}>‹</button>
                <span className="px-2 text-xs">{currentPage} / {totalPages}</span>
                <button disabled={currentPage >= totalPages} onClick={() => setPage(currentPage + 1)}>›</button>
              </span>
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

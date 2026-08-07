"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, ChevronDown, ChevronRight, FileDown, Package, Printer, Search, Trash2 } from "lucide-react";
import { PuntoBadgeEstado } from "@/components/grandes-campanas/campana-badge-estado";
import { GestorAvatar } from "@/components/grandes-campanas/gestor-avatars";
import { CampanaColumna, columnasExtraVisibles, formatearValorColumna } from "@/lib/campana-columnas";
import { mismaProvincia, trabajadoresDeProvincia } from "@/lib/campana-asignacion";
import { erroresHorasLabels, horasDelPunto, horasEntreMarcas } from "@/lib/campana-horas";
import { IncidenciaCampana, PuntoEstado, PuntoVenta, dateOnly, downloadCsv, downloadXlsx, eur, formatDate, horaCorta, puntoEstadoLabels, puntoEstados, puntosCsvRows } from "@/lib/campanas";
import { WorkerAddress, listWorkerAddresses, formatDireccionEnvio } from "@/lib/direcciones-envio";

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

// Feature 2: selector de la direccion de envio del instalador para un punto.
// Carga las direcciones guardadas del instalador y permite fijar una como
// destino logistico (opcionalmente para todos los puntos de ese instalador).
function PuntoDireccionEnvio({ punto, saving, onSet }: {
  punto: PuntoVenta;
  saving: boolean;
  onSet: (punto: PuntoVenta, direccionEnvio: string | null, direccionEnvioId: string | null, aplicarTodos: boolean) => Promise<void>;
}) {
  const [addresses, setAddresses] = useState<WorkerAddress[]>([]);
  const [loading, setLoading] = useState(false);
  const [aplicarTodos, setAplicarTodos] = useState(false);
  useEffect(() => {
    let alive = true;
    if (!punto.instalador_id) { setAddresses([]); return; }
    setLoading(true);
    listWorkerAddresses(punto.instalador_id).then(result => { if (alive) { setAddresses(result.data); setLoading(false); } });
    return () => { alive = false; };
  }, [punto.instalador_id]);

  if (!punto.instalador_id) return <p style={{ color: "var(--gc-muted)" }}>Asigna un instalador para indicar su dirección de envío.</p>;
  return (
    <div className="space-y-1">
      <p><b>Actual:</b> {punto.direccion_envio || <span style={{ color: "var(--gc-muted)" }}>Dirección del punto (por defecto)</span>}</p>
      {loading ? <p style={{ color: "var(--gc-muted)" }}>Cargando direcciones...</p> : addresses.length > 0 && (
        <select
          className="gc-select"
          disabled={saving}
          value={punto.direccion_envio_id || ""}
          onChange={event => {
            const addr = addresses.find(a => a.id === event.target.value);
            onSet(punto, addr ? formatDireccionEnvio(addr) : null, addr?.id || null, aplicarTodos);
          }}
        >
          <option value="">Dirección del punto (por defecto)</option>
          {addresses.map(addr => <option key={addr.id} value={addr.id}>{(addr.etiqueta ? `${addr.etiqueta} · ` : "") + formatDireccionEnvio(addr)}</option>)}
        </select>
      )}
      {/* Escritura directa: el gestor puede teclear una dirección puntual sin depender de
          que administración la haya guardado antes en la ficha del trabajador. */}
      <input
        className="gc-input"
        placeholder="O escribe aquí la dirección de envío…"
        defaultValue={punto.direccion_envio || ""}
        disabled={saving}
        onBlur={event => {
          const valor = event.target.value.trim();
          if (valor === (punto.direccion_envio || "").trim()) return;
          onSet(punto, valor || null, null, aplicarTodos);
        }}
      />
      <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={aplicarTodos} onChange={event => setAplicarTodos(event.target.checked)} />Aplicar a todos los puntos de este instalador</label>
      <p className="text-xs" style={{ color: "var(--gc-muted)" }}>Para rellenarlas en bloque usa el panel «Direcciones de envío del material».</p>
    </div>
  );
}

type WorkerOption = { id: string; name: string; province?: string | null };

/** Responsable de zona asignable a un punto: gestor de la casa o delegación. */
export type ResponsableZonaOption = { id: string; name: string; provinces?: string[] | null; esDelegacion?: boolean };

/**
 * v11.5 · Desplegable de RESPONSABLE DE ZONA, solo para administración.
 *
 * Hasta ahora el único camino para cambiar el gestor de un punto suelto era la
 * pantalla de asignación rápida (o repartirlo todo de golpe). Como administración
 * ya no toca instaladores, esta columna es su herramienta fina: mueve un punto de
 * una zona a otra sin salir de la tabla. Los de la provincia del punto van primero,
 * porque es la elección correcta el 99 % de las veces.
 */
function ResponsableSelect({ punto, responsables, saving, onUpdatePunto }: {
  punto: PuntoVenta;
  responsables: ResponsableZonaOption[];
  saving: boolean;
  onUpdatePunto: (punto: PuntoVenta, patch: Partial<PuntoVenta>) => Promise<void>;
}) {
  const deZona = useMemo(
    () => responsables.filter(persona => (persona.provinces || []).some(provincia => mismaProvincia(provincia, punto.provincia))),
    [responsables, punto.provincia]
  );
  const otros = useMemo(() => {
    const ids = new Set(deZona.map(persona => persona.id));
    return responsables.filter(persona => !ids.has(persona.id));
  }, [responsables, deZona]);
  const etiqueta = (persona: ResponsableZonaOption) => `${persona.name}${persona.esDelegacion ? " · delegación" : ""}`;
  return (
    <select
      className="gc-select"
      style={{ width: 170, padding: "5px 8px", fontSize: 12 }}
      value={punto.gestor_id || ""}
      disabled={saving}
      title="Asignar el responsable de zona es lo que le da acceso a este punto"
      onChange={event => {
        const persona = responsables.find(item => item.id === event.target.value);
        onUpdatePunto(punto, { gestor_id: persona?.id || null, gestor_nombre: persona?.name || null });
      }}
    >
      <option value="">Sin asignar</option>
      {deZona.length > 0 && (
        <optgroup label={`En ${punto.provincia || "esta provincia"}`}>
          {deZona.map(persona => <option key={persona.id} value={persona.id}>{etiqueta(persona)}</option>)}
        </optgroup>
      )}
      {otros.length > 0 && (
        <optgroup label={deZona.length ? "Otras zonas" : `Nadie cubre ${punto.provincia || "esta provincia"} · otras zonas`}>
          {otros.map(persona => <option key={persona.id} value={persona.id}>{etiqueta(persona)}</option>)}
        </optgroup>
      )}
    </select>
  );
}

/**
 * Desplegable de instalador con los trabajadores DE LA PROVINCIA del punto primero.
 * Antes listaba los 26 trabajadores en bruto, así que el gestor tenía que saberse de
 * memoria quién cubre cada zona. Los de otras provincias siguen accesibles en un segundo
 * grupo, porque hay provincias sin ningún trabajador y el punto no puede quedar bloqueado.
 */
function InstaladorSelect({ punto, workers, saving, onUpdatePunto }: {
  punto: PuntoVenta;
  workers: WorkerOption[];
  saving: boolean;
  onUpdatePunto: (punto: PuntoVenta, patch: Partial<PuntoVenta>) => Promise<void>;
}) {
  const deZona = useMemo(() => trabajadoresDeProvincia(workers, punto.provincia), [workers, punto.provincia]);
  const otros = useMemo(() => {
    const ids = new Set(deZona.map(worker => worker.id));
    return workers.filter(worker => !ids.has(worker.id));
  }, [workers, deZona]);
  return (
    <select
      className="gc-select"
      style={{ width: 160, padding: "5px 8px", fontSize: 12 }}
      value={punto.instalador_id || ""}
      disabled={saving}
      title={deZona.length ? `${deZona.length} trabajador(es) en ${punto.provincia}` : `Sin trabajadores en ${punto.provincia || "esta provincia"}`}
      onChange={event => {
        const worker = workers.find(w => w.id === event.target.value);
        onUpdatePunto(punto, { instalador_id: worker?.id || null, instalador_nombre: worker?.name || null });
      }}
    >
      <option value="">Sin instalador</option>
      {deZona.length > 0 && (
        <optgroup label={`En ${punto.provincia}${deZona.length > 1 ? ` (${deZona.length} opciones)` : ""}`}>
          {deZona.map(worker => <option key={worker.id} value={worker.id}>{worker.name}</option>)}
        </optgroup>
      )}
      {otros.length > 0 && (
        <optgroup label={deZona.length ? "Otras provincias" : `Sin trabajadores en ${punto.provincia || "esta provincia"} · otras`}>
          {otros.map(worker => <option key={worker.id} value={worker.id}>{worker.name}{worker.province ? ` · ${worker.province}` : ""}</option>)}
        </optgroup>
      )}
    </select>
  );
}

export function PuntosTabla({
  puntos,
  incidencias,
  isAdmin,
  columnas = [],
  workers = [],
  responsablesZona = [],
  saving,
  logistica = {},
  pagoPorHoras = false,
  pagoKilometraje = false,
  onSolicitarMaterial,
  onUpdatePunto,
  onDeletePunto,
  onRegistrarIncidencia,
  solicitarDireccionEnvio = false,
  onSetDireccionEnvio
}: {
  puntos: PuntoVenta[];
  incidencias: IncidenciaCampana[];
  isAdmin: boolean;
  columnas?: CampanaColumna[];
  workers?: Array<{ id: string; name: string; province?: string | null }>;
  /** v11.5 · Gestores y delegaciones a los que administración puede dar la zona. */
  responsablesZona?: ResponsableZonaOption[];
  saving: boolean;
  /** Estado logístico por punto (necesidades source_type "campaign"). */
  logistica?: Record<string, { request_id: string | null; status: string | null }>;
  /** v11.5 · Configuración de pago de la campaña: decide qué columnas se piden. */
  pagoPorHoras?: boolean;
  pagoKilometraje?: boolean;
  onSolicitarMaterial?: (punto: PuntoVenta) => void;
  onUpdatePunto: (punto: PuntoVenta, patch: Partial<PuntoVenta>) => Promise<void>;
  onDeletePunto: (punto: PuntoVenta) => Promise<void>;
  onRegistrarIncidencia: (punto: PuntoVenta, descripcion: string) => Promise<void>;
  /** Feature 2: la campaña pide dirección de envío del trabajador. */
  solicitarDireccionEnvio?: boolean;
  onSetDireccionEnvio?: (punto: PuntoVenta, direccionEnvio: string | null, direccionEnvioId: string | null, aplicarTodos: boolean) => Promise<void>;
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
  // Totales del reporte, para el pie de la tabla: es donde el gestor comprueba de
  // un vistazo que lo subido cuadra con lo que le van a pagar a su gente.
  const horasTotal = useMemo(
    () => filtrados.reduce((sum, punto) => sum + (horasDelPunto(punto).horas || 0), 0),
    [filtrados]
  );
  const kilometrosTotal = useMemo(
    () => filtrados.reduce((sum, punto) => sum + Number(punto.kilometros || 0), 0),
    [filtrados]
  );
  // 13 columnas fijas + las que añade la configuración de pago de la campaña. Sin
  // esta cuenta el detalle desplegado se desalineaba al activar el pago por horas.
  const totalColumnas = 13 + (pagoPorHoras ? 2 : 0) + (pagoKilometraje ? 1 : 0);

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

  /**
   * Guarda una marca horaria y, con ella, las horas que se van a pagar. Van en el
   * MISMO patch a propósito: si se guardaran por separado, entre los dos UPDATE el
   * punto tendría una salida nueva con las horas viejas, y ese es exactamente el
   * estado con el que alguien podría volcar los pagos.
   */
  async function guardarTurno(punto: PuntoVenta, patch: Partial<PuntoVenta>) {
    const entrada = patch.hora_entrada !== undefined ? patch.hora_entrada : punto.hora_entrada;
    const salida = patch.hora_salida !== undefined ? patch.hora_salida : punto.hora_salida;
    const calculo = horasEntreMarcas(entrada, salida);
    // El total solo se reescribe cuando el par de marcas da un número. Con el turno
    // a medias (se acaba de teclear la entrada y aún falta la salida) se deja como
    // estaba: si no, escribir la primera hora borraría el total que trajo el Excel.
    // Y con un turno incoherente tampoco hace falta tocarlo, porque el cálculo del
    // pago mira primero las marcas y bloquea la línea con su motivo.
    await onUpdatePunto(punto, calculo.horas !== null ? { ...patch, horas_trabajadas: calculo.horas } : patch);
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
            <span className="gc-label">Instalación desde</span>
            <input type="date" className="gc-input" value={filtros.desde} onChange={event => patchFiltros({ desde: event.target.value })} />
          </label>
          <label className="w-40">
            <span className="gc-label">Instalación hasta</span>
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
                <th>Fecha instalación</th>
                <th title="Fecha en la que Almacén cerró el picking del material">Picking</th>
                {pagoPorHoras && <th title="Hora de entrada y de salida reportadas">Turno</th>}
                {pagoPorHoras && <th style={{ textAlign: "right" }}>Horas</th>}
                {pagoKilometraje && <th style={{ textAlign: "right" }}>Km</th>}
                <th>Incid.</th>
                <th style={{ textAlign: "right" }}>Importe</th>
                <th className="gc-no-print">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {pageRows.map((punto, index) => {
                const abiertas = abiertasPorPunto.get(punto.id) || 0;
                const isOpen = expanded === punto.id;
                const horasPunto = horasDelPunto(punto);
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
                    {/* v11.5 · Administración edita la ZONA y solo lee el trabajador;
                        el gestor o la delegación, justo al revés. */}
                    <td onClick={event => isAdmin && event.stopPropagation()}>
                      {isAdmin && responsablesZona.length ? (
                        <ResponsableSelect punto={punto} responsables={responsablesZona} saving={saving} onUpdatePunto={onUpdatePunto} />
                      ) : punto.gestor_nombre
                        ? <span className="inline-flex items-center gap-2"><GestorAvatar name={punto.gestor_nombre} size={24} />{punto.gestor_nombre}</span>
                        : <span style={{ color: "var(--gc-muted)" }}>Sin asignar</span>}
                    </td>
                    <td onClick={event => event.stopPropagation()}>
                      {!isAdmin && workers.length ? (
                        <InstaladorSelect punto={punto} workers={workers} saving={saving} onUpdatePunto={onUpdatePunto} />
                      ) : (punto.instalador_nombre || <span style={{ color: "var(--gc-muted)" }}>—</span>)}
                    </td>
                    <td>{punto.tipo || "—"}</td>
                    <td><PuntoBadgeEstado estado={punto.estado} /></td>
                    <td>{formatDate(punto.fecha_visita)}</td>
                    <td title={punto.picking_cerrado_at ? "Picking cerrado por Almacén" : "Almacén no ha cerrado el picking"}>
                      {punto.picking_cerrado_at
                        ? formatDate(punto.picking_cerrado_at)
                        : <span style={{ color: "var(--gc-muted)" }}>—</span>}
                    </td>
                    {pagoPorHoras && (
                      <td className="whitespace-nowrap text-xs">
                        {punto.hora_entrada || punto.hora_salida
                          ? `${horaCorta(punto.hora_entrada) || "—"} → ${horaCorta(punto.hora_salida) || "—"}`
                          : <span style={{ color: "var(--gc-muted)" }}>Sin reportar</span>}
                      </td>
                    )}
                    {pagoPorHoras && (
                      <td className="text-right font-semibold" title={horasPunto.error ? erroresHorasLabels[horasPunto.error] : undefined}>
                        {horasPunto.horas != null
                          ? horasPunto.horas.toLocaleString("es-ES", { maximumFractionDigits: 2 })
                          // Un turno mal reportado se señala en rojo: es lo que va a
                          // dejar el pago bloqueado y hay que corregirlo aquí.
                          : <span style={{ color: horasPunto.error === "sin_datos" ? "var(--gc-muted)" : "var(--gc-secondary)" }}>—</span>}
                      </td>
                    )}
                    {pagoKilometraje && (
                      <td className="text-right">
                        {punto.kilometros != null ? punto.kilometros.toLocaleString("es-ES", { maximumFractionDigits: 2 }) : <span style={{ color: "var(--gc-muted)" }}>—</span>}
                      </td>
                    )}
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
                      <td colSpan={totalColumnas} style={{ background: "#fafbfc" }}>
                        <div className="grid gap-4 p-3 md:grid-cols-2 lg:grid-cols-3">
                          <div className="space-y-1 text-sm">
                            <p className="text-xs font-bold uppercase" style={{ color: "var(--gc-muted)" }}>Ficha del punto</p>
                            <p><b>Código:</b> {punto.codigo || "—"}</p>
                            <p><b>Dirección:</b> {punto.direccion || "—"}</p>
                            <p><b>Provincia:</b> {punto.provincia || "—"}</p>
                            <p><b>Tipo:</b> {punto.tipo || "—"}</p>
                            <p><b>Gestor de zona:</b> {punto.gestor_nombre || "Sin asignar"}</p>
                            <p><b>Instalador:</b> {punto.instalador_nombre || "Sin asignar"}</p>
                            <p><b>Picking:</b> {punto.picking_cerrado_at ? formatDate(punto.picking_cerrado_at) : <span style={{ color: "var(--gc-muted)" }}>Almacén no lo ha cerrado</span>}</p>
                            {/* v10.2 · Fecha de instalación e importe editables también por el gestor:
                                la fecha es el dato que administración pasa al cliente y el importe es
                                lo que se paga al trabajador (margen bruto de la campaña). */}
                            <div className="mt-2 grid gap-2 border-t pt-2 gc-no-print sm:grid-cols-2">
                              <label>
                                <span className="gc-label">Fecha instalación</span>
                                <input
                                  type="date"
                                  className="gc-input"
                                  defaultValue={dateOnly(punto.fecha_visita)}
                                  disabled={saving}
                                  onChange={event => {
                                    const valor = event.target.value || null;
                                    if (valor !== (dateOnly(punto.fecha_visita) || null)) onUpdatePunto(punto, { fecha_visita: valor });
                                  }}
                                />
                              </label>
                              <label>
                                <span className="gc-label">Importe del trabajador (€)</span>
                                <input
                                  type="number"
                                  step="0.01"
                                  min="0"
                                  className="gc-input"
                                  defaultValue={punto.importe ?? ""}
                                  disabled={saving}
                                  onBlur={event => {
                                    const texto = event.target.value.trim();
                                    const valor = texto === "" ? null : Number(texto);
                                    if (valor != null && (!Number.isFinite(valor) || valor < 0)) return;
                                    if (valor !== (punto.importe ?? null)) onUpdatePunto(punto, { importe: valor });
                                  }}
                                />
                              </label>
                            </div>
                            {/* v11.5 · Lo que reporta el trabajador de su visita. Se
                                pide solo si la campaña lo paga, para no llenar la ficha
                                de campos que nadie va a rellenar. */}
                            {(pagoPorHoras || pagoKilometraje) && (
                              <div className="mt-2 border-t pt-2 gc-no-print">
                                <p className="mb-1 text-xs font-bold uppercase" style={{ color: "var(--gc-muted)" }}>Reporte de la visita</p>
                                <div className="grid gap-2 sm:grid-cols-2">
                                  {pagoPorHoras && (
                                    <label>
                                      <span className="gc-label">Hora de entrada</span>
                                      <input
                                        type="time"
                                        className="gc-input"
                                        defaultValue={horaCorta(punto.hora_entrada)}
                                        disabled={saving}
                                        onChange={event => guardarTurno(punto, { hora_entrada: event.target.value || null })}
                                      />
                                    </label>
                                  )}
                                  {pagoPorHoras && (
                                    <label>
                                      <span className="gc-label">Hora de salida</span>
                                      <input
                                        type="time"
                                        className="gc-input"
                                        defaultValue={horaCorta(punto.hora_salida)}
                                        disabled={saving}
                                        onChange={event => guardarTurno(punto, { hora_salida: event.target.value || null })}
                                      />
                                    </label>
                                  )}
                                  {pagoKilometraje && (
                                    <label>
                                      <span className="gc-label">Kilometraje reportado (km)</span>
                                      <input
                                        type="number"
                                        step="0.01"
                                        min="0"
                                        className="gc-input"
                                        defaultValue={punto.kilometros ?? ""}
                                        disabled={saving}
                                        onBlur={event => {
                                          const texto = event.target.value.trim();
                                          const valor = texto === "" ? null : Number(texto);
                                          if (valor != null && (!Number.isFinite(valor) || valor < 0)) return;
                                          if (valor !== (punto.kilometros ?? null)) onUpdatePunto(punto, { kilometros: valor });
                                        }}
                                      />
                                    </label>
                                  )}
                                </div>
                                {pagoPorHoras && (
                                  <p className="mt-1 text-xs" style={{ color: horasPunto.error && horasPunto.error !== "sin_datos" ? "var(--gc-secondary)" : "var(--gc-muted)" }}>
                                    {horasPunto.horas != null
                                      ? <>Se pagarán <b>{horasPunto.horas.toLocaleString("es-ES", { maximumFractionDigits: 2 })} h</b>.</>
                                      : <>No se pueden calcular las horas: {erroresHorasLabels[horasPunto.error!]}.</>}
                                  </p>
                                )}
                              </div>
                            )}
                            {solicitarDireccionEnvio && onSetDireccionEnvio && (
                              <div className="mt-2 border-t pt-2 gc-no-print">
                                <p className="mb-1 text-xs font-bold uppercase" style={{ color: "var(--gc-muted)" }}>Dirección de envío (Logística)</p>
                                <PuntoDireccionEnvio punto={punto} saving={saving} onSet={onSetDireccionEnvio} />
                              </div>
                            )}
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
            <span>
              <b>{filtrados.length.toLocaleString("es-ES")}</b> de {puntos.length.toLocaleString("es-ES")} puntos
              {pagoPorHoras && <> · Horas reportadas: <b>{horasTotal.toLocaleString("es-ES", { maximumFractionDigits: 2 })}</b></>}
              {pagoKilometraje && <> · Kilómetros: <b>{kilometrosTotal.toLocaleString("es-ES", { maximumFractionDigits: 2 })}</b></>}
              {" "}· Importe total acumulado: <b>{eur(importeTotal)}</b>
            </span>
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

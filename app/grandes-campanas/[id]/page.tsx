"use client";

import Link from "next/link";

import { useEffect, useMemo, useRef, useState } from "react";
import { Euro, FileDown, FileText, Info, MapPin, MessageCircle, Package, Pencil, Plus, Upload, UserCheck, Users } from "lucide-react";
import { FILE_ACCEPT_ATTR, parseImportFile } from "@/lib/csv-parser";
import { supabase } from "@/lib/supabase";
import { CampanaBadgeEstado, IncidenciaBadgeEstado } from "@/components/grandes-campanas/campana-badge-estado";
import { CampanaDetalleKpis } from "@/components/grandes-campanas/campana-detalle-kpis";
import { GestorAvatar } from "@/components/grandes-campanas/gestor-avatars";
import { PuntosTabla } from "@/components/grandes-campanas/puntos-tabla";
import { DireccionesEnvioPanel } from "@/components/grandes-campanas/direcciones-envio-panel";
import { AppSession, AppUser, canAccessModule, canManageCampaigns, getCurrentAppSession, isAdminSession, loadInternalUsers } from "@/lib/access-control";
import { CampanaDelegacion, delegacionesComoCandidatos, fetchDelegacionesCampana, responsablesDeZona } from "@/lib/campana-delegaciones";
import { CampanaColumna, fetchCampanaColumnas } from "@/lib/campana-columnas";
import { agruparPuntosParaMaterial, mismaProvincia, provinciasConVariosTrabajadores, sugerirGestoresPorPunto, sugerirTrabajadoresPorPunto } from "@/lib/campana-asignacion";
import { addWorkerAddress, formatDireccionEnvio } from "@/lib/direcciones-envio";
import { IncidenciaRow, resumenVolcado, syncCampanaObligations } from "@/lib/payments/campana-obligations";
import { horasDelPunto } from "@/lib/campana-horas";
import { PuntoEvento, fetchEventosCampana } from "@/lib/campana-auditoria";
import { HistorialPanel } from "@/components/grandes-campanas/historial-panel";
import { Documento, cambiarVisibilidadInstalador, fetchDocumentos, retirarDocumento, subirDocumento } from "@/lib/campana-documentos";
import { DocumentosPanel } from "@/components/grandes-campanas/documentos-panel";
import {
  BorradorRegularizacion,
  Regularizacion,
  fetchMesesCerrados,
  fetchRegularizaciones,
  resolverRegularizacion,
  solicitarRegularizacion
} from "@/lib/campana-regularizaciones";
import { RegularizacionesPanel } from "@/components/grandes-campanas/regularizaciones-panel";
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
  aplicarSugerenciasGestor,
  aplicarSugerenciasInstalador,
  bulkSetDireccionEnvio,
  solicitarMaterialCampana,
  updatePunto,
  updatePuntosPorCodigo,
  deletePunto as deletePuntoDb
} from "@/lib/campanas";

const tabs = [
  ["puntos", "Puntos"],
  ["gestores", "Responsables de zona"],
  ["incidencias", "Incidencias"],
  ["documentos", "Documentos"],
  ["historial", "Historial"],
  ["regularizaciones", "Regularizaciones"],
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
  // Usuarios internos con provincias: candidatos a gestor de zona para «Sugerir gestor».
  const [gestoresInternos, setGestoresInternos] = useState<AppUser[]>([]);
  // v11.5 · Delegaciones marcadas en la campaña y sus fichas de usuario. Solo
  // mandan si `campana.delegaciones_activas` está en true.
  const [delegaciones, setDelegaciones] = useState<CampanaDelegacion[]>([]);
  const [usuariosDelegacion, setUsuariosDelegacion] = useState<AppUser[]>([]);
  const updateFileRef = useRef<HTMLInputElement>(null);
  const [waOpen, setWaOpen] = useState(false);
  const [waWorkerId, setWaWorkerId] = useState("");
  const [waText, setWaText] = useState("");
  // Estado logístico por punto (necesidades con source_type "campaign").
  const [logisticaPuntos, setLogisticaPuntos] = useState<Record<string, { request_id: string | null; status: string | null }>>({});
  const [matPara, setMatPara] = useState<PuntoVenta[] | null>(null);
  const [matForm, setMatForm] = useState({ name: "", cantidad: 1, notas: "" });
  // v11.0 · Bitácora de los puntos. Se carga al abrir la pestaña «Historial» y no
  // antes: es la consulta más pesada de la pantalla y casi nadie la mira.
  const [eventos, setEventos] = useState<PuntoEvento[]>([]);
  const [eventosCargados, setEventosCargados] = useState(false);
  const [cargandoEventos, setCargandoEventos] = useState(false);
  // v11.1 · Documentos. Misma idea: se cargan al abrir su pestaña.
  const [documentos, setDocumentos] = useState<Documento[]>([]);
  const [documentosCargados, setDocumentosCargados] = useState(false);
  const [cargandoDocumentos, setCargandoDocumentos] = useState(false);
  // v11.2 · Regularizaciones. El contador de pendientes se pinta en la pestaña,
  // así que estas SÍ se cargan con la pantalla: si no, nadie ve que hay trabajo.
  const [regularizaciones, setRegularizaciones] = useState<Regularizacion[]>([]);
  const [mesesCerrados, setMesesCerrados] = useState<string[]>([]);
  const [cargandoRegularizaciones, setCargandoRegularizaciones] = useState(false);
  // Error de las pestañas nuevas, separado de `error`: el refresco de 30 s limpia
  // `error` y se llevaba por delante el motivo de un fallo de carga o de acción.
  const [errorPestana, setErrorPestana] = useState("");
  const admin = isAdminSession(session);
  const regularizacionesPendientes = regularizaciones.filter(fila => fila.estado === "propuesta").length;

  useEffect(() => {
    if (supabase) supabase.from("workers").select("id,name,province,phone").order("name").then(({ data }) => setWorkers((data || []) as Array<{ id: string; name: string; province?: string | null; phone?: string | null }>));
    if (isAdminSession(session)) {
      loadInternalUsers().then(users => {
        const conZona = users.filter(user => user.active && (user.provinces || []).length > 0);
        setGestoresInternos(conZona.filter(user => user.role !== "delegacion"));
        setUsuariosDelegacion(users.filter(user => user.role === "delegacion"));
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    const [campanaResult, kpisResult, puntosResult, incidenciasResult, gestoresResult, columnasResult, delegacionesResult] = await Promise.all([
      fetchCampana(params.id),
      fetchCampanaKpis(params.id),
      fetchPuntos(params.id),
      fetchIncidencias(params.id),
      fetchGestoresCampana(params.id),
      fetchCampanaColumnas(params.id),
      fetchDelegacionesCampana(params.id)
    ]);
    const firstError = campanaResult.error || kpisResult.error || puntosResult.error || incidenciasResult.error || gestoresResult.error;
    setError(firstError || "");
    setCampana(campanaResult.data);
    setKpis(kpisResult.data);
    setPuntos(filterPuntosBySession(puntosResult.data, getCurrentAppSession()));
    setIncidencias(incidenciasResult.data);
    setGestores(gestoresResult.data);
    setColumnas(columnasResult.data);
    setDelegaciones(delegacionesResult.data);
    // Estado logístico de los puntos: necesidades de material de esta campaña.
    if (supabase) {
      const { data } = await supabase
        .from("logistics_material_requirements")
        .select("source_id,request_id,status")
        .eq("source_type", "campaign")
        .eq("campaign_id", params.id);
      const map: Record<string, { request_id: string | null; status: string | null }> = {};
      (data || []).forEach(row => {
        map[String(row.source_id)] = { request_id: (row.request_id as string) || null, status: (row.status as string) || null };
      });
      setLogisticaPuntos(map);
    }
    setLoading(false);
  }

  useEffect(() => {
    refresh();
    cargarRegularizaciones();
    const search = new URLSearchParams(window.location.search);
    const importados = search.get("importados");
    if (importados) {
      const repartidos = search.get("repartidos");
      const sinGestor = search.get("sinGestor");
      flash([
        `${Number(importados).toLocaleString("es-ES")} puntos importados`,
        search.get("omitidos") && search.get("omitidos") !== "0" ? `${search.get("omitidos")} omitidos` : "",
        search.get("duplicados") ? `${search.get("duplicados")} duplicados no importados (código ya existente)` : "",
        repartidos ? `${repartidos} repartidos entre los gestores de zona` : "",
        sinGestor ? `sin gestor en ${sinGestor.split(",").join(", ")}` : ""
      ].filter(Boolean).join(" · ") + ".");
    }
    // Las regularizaciones entran en el tic: si no, la insignia de «pendientes»
    // nunca aparece para quien deja la campaña abierta toda la mañana.
    const timer = setInterval(() => { refresh(true); cargarRegularizaciones(true); }, 30000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.id]);

  /**
   * Vuelca a Pagos las obligaciones de los puntos indicados. Devuelve el texto del
   * aviso; nunca lanza: si el volcado falla, el cambio del punto ya está guardado y lo
   * que procede es avisar, no revertirlo (mismo criterio que en los vinilos ISDIN).
   */
  async function volcarPagos(objetivo: PuntoVenta[], correlacion?: string): Promise<string> {
    try {
      const result = await syncCampanaObligations(
        objetivo as unknown as Array<Record<string, unknown>>,
        incidencias as unknown as IncidenciaRow[],
        session?.display_name || "Operaciones",
        correlacion,
        // v11.5 · Las tarifas viven en la campaña: sin pasarlas, una campaña por
        // horas se liquidaría con el importe del punto (normalmente vacío).
        {
          pago_por_horas: campana?.pago_por_horas,
          tarifa_hora: campana?.tarifa_hora,
          pago_kilometraje: campana?.pago_kilometraje,
          tarifa_km: campana?.tarifa_km
        }
      );
      return resumenVolcado(result);
    } catch (err) {
      const texto = err instanceof Error ? err.message : "error desconocido";
      setError(`El punto se guardó, pero el volcado a Pagos falló: ${texto}. Usa «Volcar pagos» para reintentarlo.`);
      return "";
    }
  }

  // Recuperación: recalcula los pagos de todos los puntos visibles. Necesario para los
  // puntos que se completaron antes de que existiera este volcado, y para reflejar
  // correcciones de importe o de fecha posteriores.
  async function handleVolcarPagosCampana() {
    setSaving(true);
    setError("");
    const mensaje = await volcarPagos(puntos, `campana:${params.id}`);
    if (mensaje) flash(mensaje);
    setSaving(false);
  }

  /**
   * Carga la bitácora la primera vez que se abre «Historial». Se recarga a mano
   * (no en el refresco de 30 s) porque es historia: no cambia sola mientras se lee.
   */
  async function cargarHistorial(forzar = false) {
    if (cargandoEventos || (eventosCargados && !forzar)) return;
    setCargandoEventos(true);
    const result = await fetchEventosCampana(params.id);
    // Solo se marca como cargada si de verdad se cargó: si no, la pestaña se
    // quedaba para siempre enseñando «no hay historial» sin forma de reintentar.
    if (result.error) {
      setErrorPestana(`No se pudo cargar el historial: ${result.error}`);
    } else {
      // La RLS de la bitácora filtra por provincia, pero la regla v10.2 de la
      // aplicación es más estricta: un punto ya asignado solo lo ve su gestor.
      // Se aplica el mismo filtro que a los puntos para no enseñar de refilón
      // los movimientos de una compañera.
      const visibles = new Set(puntos.map(punto => punto.id));
      const sesion = getCurrentAppSession();
      setEventos(isAdminSession(sesion) ? result.data : result.data.filter(evento => visibles.has(evento.punto_id)));
      setEventosCargados(true);
    }
    setCargandoEventos(false);
  }

  /** Carga los documentos la primera vez que se abre «Documentos». */
  async function cargarDocumentos(forzar = false) {
    if (cargandoDocumentos || (documentosCargados && !forzar)) return;
    setCargandoDocumentos(true);
    const result = await fetchDocumentos(params.id, true);
    if (result.error) {
      setErrorPestana(`No se pudieron cargar los documentos: ${result.error}`);
    } else {
      // Ojo: NO se limpia `errorPestana` aquí. Estas recargas se lanzan justo
      // después de una acción, y una recarga correcta borraba el motivo por el
      // que la subida o la retirada acababan de fallar antes de poder leerlo.
      setDocumentos(result.data);
      setDocumentosCargados(true);
    }
    setCargandoDocumentos(false);
  }

  /**
   * `silencioso` = viene del refresco periódico: no toca el indicador de carga ni
   * pisa un error de la pestaña, solo actualiza el contador de pendientes.
   */
  async function cargarRegularizaciones(silencioso = false) {
    if (!silencioso) setCargandoRegularizaciones(true);
    const [filas, meses] = await Promise.all([fetchRegularizaciones(params.id), fetchMesesCerrados()]);
    if (filas.error) {
      if (!silencioso) setErrorPestana(`No se pudieron cargar las regularizaciones: ${filas.error}`);
    } else {
      setRegularizaciones(filas.data);
    }
    // Sin los meses cerrados el aviso previo desaparece: se dice, no se ignora.
    if (meses.error && !silencioso) {
      setErrorPestana(`No se pudo comprobar qué meses contables están cerrados (${meses.error}). Si el mes está cerrado, el aviso saldrá al enviar.`);
    }
    setMesesCerrados(meses.data);
    if (!silencioso) setCargandoRegularizaciones(false);
  }

  function abrirTab(destino: TabKey) {
    setTab(destino);
    if (destino === "historial") cargarHistorial();
    if (destino === "documentos") cargarDocumentos();
  }

  /**
   * Devuelve si la propuesta se registró. El panel lo necesita para NO vaciar el
   * formulario cuando falla: antes se perdía todo lo tecleado.
   */
  async function handleSolicitarRegularizacion(borrador: BorradorRegularizacion): Promise<boolean> {
    setSaving(true);
    setErrorPestana("");
    const result = await solicitarRegularizacion(borrador, mesesCerrados);
    if (result.error) setErrorPestana(result.error);
    else flash("Regularización registrada. Queda pendiente de que administración la apruebe.");
    await cargarRegularizaciones();
    setSaving(false);
    return !result.error;
  }

  async function handleResolverRegularizacion(
    fila: Regularizacion,
    estado: "aprobada" | "rechazada",
    opciones: { motivo?: string | null; refacturable?: boolean | null }
  ) {
    setSaving(true);
    setErrorPestana("");
    const result = await resolverRegularizacion(fila.id, estado, opciones);
    if (result.error) setErrorPestana(result.error);
    else if (estado === "aprobada") flash("Regularización aprobada: la línea ya está en Pagos.");
    else flash("Regularización rechazada. Quien la propuso verá el motivo.");
    await cargarRegularizaciones();
    setSaving(false);
  }

  async function handleSubirDocumento(
    archivo: File,
    opciones: { nombre: string; categoria: Documento["categoria"]; descripcion: string | null; puntoId: string | null; visibleInstalador: boolean; sustituyeA: string | null }
  ): Promise<boolean> {
    setSaving(true);
    setErrorPestana("");
    const result = await subirDocumento({
      campanaId: params.id,
      puntoId: opciones.puntoId,
      archivo,
      nombre: opciones.nombre,
      descripcion: opciones.descripcion,
      categoria: opciones.categoria,
      visibleInstalador: opciones.visibleInstalador,
      sustituyeA: opciones.sustituyeA
    });
    if (result.error) setErrorPestana(result.error);
    else flash(opciones.sustituyeA ? "Versión nueva publicada. La anterior queda en el histórico." : "Documento subido.");
    await cargarDocumentos(true);
    setSaving(false);
    return !result.error;
  }

  async function handleRetirarDocumento(documento: Documento) {
    if (!confirm(`¿Retirar «${documento.nombre}»?\n\nDeja de ofrecerse, pero su ficha se conserva en el histórico de la campaña.`)) return;
    setSaving(true);
    setErrorPestana("");
    const result = await retirarDocumento(documento.id, session);
    if (result.error) setErrorPestana(result.error);
    else flash("Documento retirado.");
    await cargarDocumentos(true);
    setSaving(false);
  }

  async function handleVisibilidadDocumento(documento: Documento, visible: boolean) {
    setSaving(true);
    setErrorPestana("");
    const result = await cambiarVisibilidadInstalador(documento.id, visible);
    if (result.error) setErrorPestana(result.error);
    await cargarDocumentos(true);
    setSaving(false);
  }

  /** Campos cuyo cambio en un punto YA completado cambia lo que se le paga. */
  const camposQueMuevenElPago: Array<keyof PuntoVenta> = ["importe", "fecha_visita", "hora_entrada", "hora_salida", "horas_trabajadas", "kilometros", "instalador_id"];

  async function handleUpdatePunto(punto: PuntoVenta, patch: Partial<PuntoVenta>) {
    setSaving(true);
    const result = await updatePunto(punto.id, patch);
    if (result.error) { setError(result.error); setSaving(false); return; }
    // Corregir las horas o el importe de un punto ya completado cambia la nómina:
    // se vuelve a volcar en el momento en vez de esperar a que alguien recuerde
    // pulsar «Volcar pagos». La obligación es idempotente por clave, así que
    // repetirlo actualiza la misma línea.
    const siguePagando = punto.estado === "completado" && patch.estado === undefined;
    if (siguePagando && camposQueMuevenElPago.some(campo => patch[campo] !== undefined)) {
      const pagos = await volcarPagos([{ ...punto, ...patch }], `punto:${punto.id}`);
      flash(`Punto actualizado. ${pagos}`);
      await refresh(true);
      setSaving(false);
      return;
    }
    if (patch.estado === "completado" && punto.estado !== "completado") {
      const bridgeError = await syncPuntoCompletadoConLogistica({ ...punto, ...patch }, campana, session);
      // v10.3: completar el punto es lo que genera el pago del trabajador. Si falta el
      // importe o la fecha, la obligación se crea BLOQUEADA en lugar de perderse.
      const pagos = await volcarPagos([{ ...punto, ...patch }], `punto:${punto.id}`);
      if (bridgeError) setError(`Punto guardado, pero la sincronización con Logística falló: ${bridgeError}`);
      else flash(`Punto completado y sincronizado con Logística. ${pagos}`);
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

  // Feature 2: fija la direccion de envio del instalador en el punto (o en todos
  // los puntos del mismo instalador). Se vuelca a Logistica como destino.
  async function handleSetDireccionEnvio(punto: PuntoVenta, direccionEnvio: string | null, direccionEnvioId: string | null, aplicarTodos: boolean) {
    setSaving(true);
    const result = aplicarTodos && punto.instalador_id
      ? await bulkSetDireccionEnvio(params.id, punto.instalador_id, direccionEnvio, direccionEnvioId, session)
      : await updatePunto(punto.id, { direccion_envio: direccionEnvio, direccion_envio_id: direccionEnvioId });
    if (result.error) setError(result.error);
    else flash(aplicarTodos ? "Dirección de envío aplicada a los puntos del instalador" : "Dirección de envío actualizada");
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
      // Un archivo de avance puede traer solo código + estado/fecha/importe: eso
      // actualiza, pero no puede crear puntos nuevos (harían falta los nombres).
      const sinNombre = filas.filter(fila => !String(fila.nombre_comercial || "").trim()).length;
      const insertarNuevos = window.confirm(`Se actualizarán los puntos existentes emparejados por código.\n\n¿Quieres además CREAR como nuevos los puntos cuyo código no exista todavía?\n\nAceptar = actualizar y crear nuevos · Cancelar = solo actualizar existentes`);
      const result = await updatePuntosPorCodigo(params.id, filas, { insertarNuevos });
      if (result.error) { setError(result.error); return; }
      const r = result.data;
      let resumenPagos = "";
      // v11.5 · «Que se vuelque el reporte y pague en consecuencia»: si el archivo
      // ha cambiado algo, los pagos se recalculan aquí mismo. Se leen los puntos
      // recién guardados en vez de usar el estado de la pantalla, que todavía tiene
      // los valores anteriores y habría vuelto a volcar el importe viejo.
      if (r.actualizados > 0 || r.nuevos > 0) {
        const frescos = await fetchPuntos(params.id);
        if (frescos.error) setError(`Puntos actualizados, pero no se pudieron releer para recalcular los pagos: ${frescos.error}`);
        else resumenPagos = ` ${await volcarPagos(filterPuntosBySession(frescos.data, getCurrentAppSession()), `campana:${params.id}`)}`;
      }
      flash(`Actualización: ${r.actualizados} puntos actualizados · ${r.sinCambios} sin cambios · ${r.nuevos} nuevos · ${r.noEncontrados - r.nuevos} códigos no encontrados${sinCodigo ? ` · ${sinCodigo} filas sin código ignoradas` : ""}${insertarNuevos && sinNombre ? ` · ${sinNombre} filas sin nombre no se han creado como nuevas` : ""}.${resumenPagos}`);
      await refresh(true);
    } finally {
      setSaving(false);
      if (updateFileRef.current) updateFileRef.current.value = "";
    }
  }

  // --- Solicitud de material a Logística (por punto o masiva) ---
  // El listado `puntos` ya viene filtrado por sesión (filterPuntosBySession),
  // así que la solicitud masiva de un gestor solo incluye SUS puntos.

  function abrirSolicitudMaterial(target: PuntoVenta[]) {
    if (!target.length) return;
    setMatForm({ name: `Material campaña ${campana?.nombre || ""}`.trim(), cantidad: 1, notas: "" });
    setMatPara(target);
  }

  // Grupos de la solicitud: una solicitud por trabajador + dirección de envío. Se calcula
  // antes de enviar para que quien pide el material vea exactamente qué va a crear.
  const gruposMaterial = useMemo(() => (matPara ? agruparPuntosParaMaterial(matPara) : []), [matPara]);

  async function handleSolicitarMaterial() {
    if (!campana || !matPara?.length) return;
    if (!matForm.name.trim()) { setError("Indica qué material se solicita."); return; }
    setSaving(true);
    setError("");
    try {
      if (!supabase) { setError("Logística no disponible en modo local"); return; }
      // Una cabecera de solicitud solo admite un destinatario: los puntos se agrupan por
      // trabajador y dirección, así que Almacén recibe una solicitud por destino real.
      const result = await solicitarMaterialCampana(
        campana,
        matPara,
        { name: matForm.name, cantidad: matForm.cantidad, notas: matForm.notas },
        session?.display_name || "Operaciones"
      );
      const creadas = result.data.filter(grupo => !grupo.error);
      if (result.error) setError(`Logística: ${result.error}`);
      if (creadas.length) {
        const resumen = creadas
          .map(grupo => `${grupo.code || "s/código"} · ${grupo.instalador_nombre || "sin trabajador"} (${grupo.puntos})`)
          .join(" · ");
        flash(`${creadas.length} solicitud${creadas.length > 1 ? "es" : ""} enviada${creadas.length > 1 ? "s" : ""} a Logística: ${resumen}`);
      }
      if (!result.error) setMatPara(null);
      await refresh(true);
    } catch (err) {
      setError(err instanceof Error ? `Error logística: ${err.message}` : "Error creando la solicitud de material");
    } finally {
      setSaving(false);
    }
  }

  // --- Reparto de personas por zona ---
  // Administración reparte los puntos entre GESTORES (y ese reparto es lo que les da
  // acceso al punto). Cada gestor reparte sus puntos entre TRABAJADORES de la zona.

  async function handleSugerirGestores() {
    if (!candidatosZona.length) { setError("No hay usuarios con provincias asignadas a los que repartir los puntos."); return; }
    const propuesta = sugerirGestoresPorPunto(puntos, candidatosZona);
    if (!propuesta.sugerencias.length) {
      setError(propuesta.provinciasSinCandidato.length
        ? `Nadie cubre estas provincias: ${propuesta.provinciasSinCandidato.join(", ")}. Ajusta las provincias de los usuarios (o las delegaciones de la campaña) y vuelve a intentarlo.`
        : "Todos los puntos visibles ya tienen responsable de zona asignado.");
      return;
    }
    const detalle = Object.entries(propuesta.sugerencias.reduce<Record<string, number>>((acc, item) => {
      acc[item.persona_nombre] = (acc[item.persona_nombre] || 0) + 1;
      return acc;
    }, {})).map(([nombre, total]) => `${nombre}: ${total}`).join("\n");
    const avisoDelegadas = zonasDelegadas.length
      ? `Zonas que lleva una delegación: ${zonasDelegadas.join(", ")}.\n\n`
      : "";
    if (!window.confirm(`Se van a repartir ${propuesta.sugerencias.length} punto(s) sin responsable:\n\n${detalle}\n\n${avisoDelegadas}${propuesta.provinciasSinCandidato.length ? `Sin nadie asignado en: ${propuesta.provinciasSinCandidato.join(", ")}.\n\n` : ""}Asignar el responsable de zona es lo que le da acceso al punto. ¿Continuar?`)) return;
    setSaving(true);
    setError("");
    const result = await aplicarSugerenciasGestor(propuesta.sugerencias, session);
    if (result.error) setError(result.error);
    else flash(`${result.data.aplicados} puntos repartidos entre ${result.data.personas} responsable(s) de zona${propuesta.provinciasSinCandidato.length ? ` · sin nadie en ${propuesta.provinciasSinCandidato.join(", ")}` : ""}`);
    await refresh(true);
    setSaving(false);
  }

  async function handleSugerirTrabajadores() {
    if (!workers.length) { setError("No hay trabajadores en el catálogo."); return; }
    const propuesta = sugerirTrabajadoresPorPunto(puntos, workers);
    if (!propuesta.sugerencias.length) {
      setError(propuesta.provinciasSinCandidato.length
        ? `No hay trabajadores en estas provincias: ${propuesta.provinciasSinCandidato.join(", ")}. Asígnalos a mano o añade trabajadores a esas zonas.`
        : "Todos tus puntos ya tienen trabajador asignado.");
      return;
    }
    const detalle = Object.entries(propuesta.sugerencias.reduce<Record<string, number>>((acc, item) => {
      acc[item.persona_nombre] = (acc[item.persona_nombre] || 0) + 1;
      return acc;
    }, {})).map(([nombre, total]) => `${nombre}: ${total}`).join("\n");
    const avisoVarios = propuesta.provinciasConVarios.length
      ? `\n\nProvincias con varios trabajadores (repartidos por carga, revísalas si quieres otro): ${propuesta.provinciasConVarios.join(", ")}.`
      : "";
    if (!window.confirm(`Se van a asignar ${propuesta.sugerencias.length} punto(s) sin trabajador:\n\n${detalle}${avisoVarios}${propuesta.provinciasSinCandidato.length ? `\n\nSin trabajador en: ${propuesta.provinciasSinCandidato.join(", ")}.` : ""}\n\n¿Continuar?`)) return;
    setSaving(true);
    setError("");
    const result = await aplicarSugerenciasInstalador(propuesta.sugerencias, session);
    if (result.error) setError(result.error);
    else flash(`${result.data.aplicados} puntos asignados a ${result.data.personas} trabajador(es)${propuesta.provinciasConVarios.length ? ` · revisa ${propuesta.provinciasConVarios.join(", ")}: hay varias opciones` : ""}`);
    await refresh(true);
    setSaving(false);
  }

  // Dirección de envío en bloque: se escribe una vez por trabajador y se vuelca a todos
  // sus puntos de la campaña. Si se marca, queda guardada en su ficha para reutilizarla.
  async function handleAplicarDireccionEnvio(input: {
    workerId: string;
    workerNombre: string;
    direccion: string;
    poblacion: string;
    codigoPostal: string;
    provincia: string;
    etiqueta: string;
    guardarEnFicha: boolean;
    direccionExistenteId?: string | null;
  }) {
    setSaving(true);
    setError("");
    try {
      let direccionId = input.direccionExistenteId || null;
      if (input.guardarEnFicha) {
        const guardada = await addWorkerAddress(input.workerId, {
          etiqueta: input.etiqueta || null,
          direccion: input.direccion,
          poblacion: input.poblacion || null,
          provincia: input.provincia || null,
          codigo_postal: input.codigoPostal || null,
          predeterminada: true
        });
        if (guardada.error) { setError(`No se pudo guardar la dirección en la ficha del trabajador: ${guardada.error}`); return; }
        direccionId = guardada.data?.id || null;
      }
      const snapshot = formatDireccionEnvio({
        direccion: input.direccion,
        codigo_postal: input.codigoPostal,
        poblacion: input.poblacion,
        provincia: input.provincia
      });
      const result = await bulkSetDireccionEnvio(params.id, input.workerId, snapshot, direccionId, session);
      if (result.error) setError(result.error);
      else flash(`Dirección de envío aplicada a ${result.data} punto(s) de ${input.workerNombre}${input.guardarEnFicha ? " y guardada en su ficha" : ""}`);
      await refresh(true);
    } finally {
      setSaving(false);
    }
  }

  const puntosSinMaterial = useMemo(
    () => puntos.filter(punto => punto.estado !== "completado" && punto.estado !== "cancelado" && !logisticaPuntos[punto.id]?.request_id),
    [puntos, logisticaPuntos]
  );
  // Puntos que generan pago: completados (trabajo), con incidencia (visita fallida)
  // o —en las campañas que lo pagan— con kilometraje reportado, porque el
  // desplazamiento se cobra aunque el punto siga abierto.
  const puntosPagables = useMemo(() => {
    const conIncidencia = new Set(incidencias.map(inc => inc.punto_id).filter(Boolean) as string[]);
    return puntos.filter(punto =>
      punto.estado === "completado"
      || conIncidencia.has(punto.id)
      || (campana?.pago_kilometraje && punto.estado !== "cancelado" && Number(punto.kilometros || 0) > 0)
    );
  }, [puntos, incidencias, campana?.pago_kilometraje]);
  // Completados a los que les falta un dato para poder cobrarse. En una campaña por
  // horas lo que falta no es el importe sino las marcas horarias: mirar `importe`
  // ahí habría avisado de un problema inexistente y callado el de verdad.
  const puntosSinImporte = useMemo(
    () => puntos.filter(punto => {
      if (punto.estado !== "completado") return false;
      if (!punto.fecha_visita) return true;
      return campana?.pago_por_horas ? horasDelPunto(punto).horas == null : !Number(punto.importe || 0);
    }),
    [puntos, campana?.pago_por_horas]
  );
  const puntosSinGestor = useMemo(() => puntos.filter(punto => !punto.gestor_id), [puntos]);
  const puntosSinTrabajador = useMemo(() => puntos.filter(punto => !punto.instalador_id), [puntos]);

  // v11.5 · Responsables de zona de ESTA campaña. Con delegaciones activas, sus
  // provincias salen del reparto de los gestores y pasan a la delegación; sin
  // ellas, todo funciona como antes.
  const candidatosDelegacion = useMemo(
    () => delegacionesComoCandidatos(delegaciones, usuariosDelegacion),
    [delegaciones, usuariosDelegacion]
  );
  const { candidatos: candidatosZona, delegadas: zonasDelegadas } = useMemo(
    () => responsablesDeZona(gestoresInternos, candidatosDelegacion, Boolean(campana?.delegaciones_activas)),
    [gestoresInternos, candidatosDelegacion, campana?.delegaciones_activas]
  );
  // Zonas subcontratadas que además tienen puntos en la campaña: son las únicas
  // que merece la pena nombrar en pantalla.
  const zonasDelegadasConPuntos = useMemo(() => {
    const deLaCampana = new Set(puntos.map(punto => punto.provincia).filter(Boolean) as string[]);
    return zonasDelegadas.filter(zona => Array.from(deLaCampana).some(propia => mismaProvincia(propia, zona)));
  }, [puntos, zonasDelegadas]);
  // Opciones del desplegable de zona de la tabla (solo lo usa administración).
  const responsablesParaTabla = useMemo(
    () => candidatosZona.map(persona => ({
      id: persona.id,
      name: persona.display_name || persona.id,
      provinces: persona.provinces || [],
      esDelegacion: persona.role === "delegacion"
    })),
    [candidatosZona]
  );
  // Provincias de ESTA campaña en las que hay que elegir a mano porque hay varios trabajadores.
  const provinciasVariosTrabajadores = useMemo(() => {
    const deLaCampana = new Set(puntos.map(punto => punto.provincia).filter(Boolean) as string[]);
    return provinciasConVariosTrabajadores(workers).filter(provincia =>
      Array.from(deLaCampana).some(propia => mismaProvincia(propia, provincia))
    );
  }, [puntos, workers]);

  async function handleAddPunto() {
    if (!nuevoPunto.nombre_comercial.trim()) { setError("El punto necesita un nombre comercial."); return; }
    setSaving(true);
    // "pantalla": este punto se teclea, no llega de un Excel. Sin decirlo, la
    // bitácora lo registraba como «subiendo un archivo».
    const result = await insertPuntosBatch(params.id, [{ ...nuevoPunto, nombre_comercial: nuevoPunto.nombre_comercial.trim() }], "pantalla");
    if (result.error) setError(result.error);
    else { flash("Punto añadido"); setNuevoPunto({ ...emptyNuevoPunto }); setNuevoAbierto(false); }
    await refresh(true);
    setSaving(false);
  }

  /**
   * Filas de la pestaña «Gestores». Junta el equipo guardado de la campaña con las
   * delegaciones marcadas: sin ellas, en una campaña subcontratada la pestaña salía
   * vacía o mostraba gestores sin un solo punto, que es justo lo contrario de lo
   * que está pasando. Se añade además cualquier responsable que tenga puntos pero
   * no figure en el equipo (reparto manual, campaña heredada): si tiene puntos,
   * tiene que verse.
   */
  const gestorStats = useMemo(() => {
    type Fila = { id: string; gestor_id?: string | null; gestor_nombre?: string | null; provincia?: string | null; esDelegacion: boolean };
    const filas = new Map<string, Fila>();
    for (const gestor of gestores) {
      filas.set(String(gestor.gestor_id || gestor.gestor_nombre || gestor.id), {
        id: gestor.id,
        gestor_id: gestor.gestor_id,
        gestor_nombre: gestor.gestor_nombre,
        provincia: gestor.provincia,
        esDelegacion: false
      });
    }
    if (campana?.delegaciones_activas) {
      for (const delegacion of delegaciones) {
        const clave = String(delegacion.delegacion_id || delegacion.delegacion_nombre || delegacion.id);
        filas.set(clave, {
          id: String(delegacion.id || clave),
          gestor_id: delegacion.delegacion_id,
          gestor_nombre: delegacion.delegacion_nombre,
          provincia: (delegacion.provincias || []).join(", ") || null,
          esDelegacion: true
        });
      }
    }
    for (const punto of puntos) {
      const clave = String(punto.gestor_id || punto.gestor_nombre || "");
      if (!clave || filas.has(clave)) continue;
      filas.set(clave, {
        id: clave,
        gestor_id: punto.gestor_id,
        gestor_nombre: punto.gestor_nombre,
        provincia: punto.provincia,
        esDelegacion: (delegaciones || []).some(delegacion => delegacion.delegacion_id === punto.gestor_id)
      });
    }
    return Array.from(filas.values()).map(fila => {
      const propios = puntos.filter(punto => punto.gestor_id === fila.gestor_id || (fila.gestor_nombre && punto.gestor_nombre === fila.gestor_nombre));
      const abiertas = incidencias.filter(incidencia => incidencia.estado !== "resuelta" && propios.some(punto => punto.id === incidencia.punto_id)).length;
      return { ...fila, asignados: propios.length, completados: propios.filter(punto => punto.estado === "completado").length, incidencias: abiertas };
    });
  }, [gestores, delegaciones, campana?.delegaciones_activas, puntos, incidencias]);

  const incidenciasFiltradas = useMemo(
    () => incidencias.filter(incidencia => !filtroIncidencias || incidencia.estado === filtroIncidencias),
    [incidencias, filtroIncidencias]
  );

  /**
   * Pagos de la campaña. Solo los puntos completados generan pago y se agrupan por
   * trabajador (instalador; gestor como respaldo) en una línea con su total.
   *
   * v11.5 · El importe del trabajo sale del modo de la campaña —importe del punto,
   * u horas × tarifa— y el kilometraje se suma aparte, con su propia columna,
   * porque en la nómina es otro concepto. Este resumen es un ESPEJO de lo que
   * calcula el motor de pagos: los euros que mandan son los de `payment_obligations`.
   */
  const pagosResumen = useMemo(() => {
    const porHoras = Boolean(campana?.pago_por_horas);
    const tarifaHora = Number(campana?.tarifa_hora ?? 0);
    const conKm = Boolean(campana?.pago_kilometraje);
    const tarifaKm = Number(campana?.tarifa_km ?? 0);
    const completados = puntos.filter(punto => punto.estado === "completado");
    const map = new Map<string, { trabajador: string; puntos: number; horas: number; kilometros: number; trabajo: number; kilometraje: number }>();
    let sinDatos = 0;
    for (const punto of completados) {
      const trabajador = punto.instalador_nombre || punto.gestor_nombre || "Sin instalador";
      const grupo = map.get(trabajador) || { trabajador, puntos: 0, horas: 0, kilometros: 0, trabajo: 0, kilometraje: 0 };
      const horas = porHoras ? horasDelPunto(punto).horas : null;
      if (porHoras && horas === null) sinDatos += 1;
      const kilometros = conKm ? Number(punto.kilometros || 0) : 0;
      grupo.puntos += 1;
      grupo.horas += horas || 0;
      grupo.kilometros += kilometros;
      grupo.trabajo += porHoras ? (horas || 0) * tarifaHora : Number(punto.importe || 0);
      grupo.kilometraje += kilometros * tarifaKm;
      map.set(trabajador, grupo);
    }
    const filas = Array.from(map.values())
      .filter(fila => fila.trabajo > 0 || fila.kilometraje > 0)
      .sort((a, b) => (b.trabajo + b.kilometraje) - (a.trabajo + a.kilometraje));
    return {
      filas,
      porHoras,
      conKm,
      // «Sin datos» son puntos completados de una campaña por horas a los que les
      // faltan las marcas horarias: su pago existe, pero está bloqueado.
      sinDatos,
      totalPuntos: completados.length,
      totalImporte: filas.reduce((sum, fila) => sum + fila.trabajo + fila.kilometraje, 0),
      pendientes: puntos.length - completados.length
    };
  }, [puntos, campana?.pago_por_horas, campana?.tarifa_hora, campana?.pago_kilometraje, campana?.tarifa_km]);

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
    return <main className="gc-module p-4"><section className="gc-empty mx-auto mt-10 max-w-2xl"><b>Campaña no encontrada.</b> <Link className="underline" href="/grandes-campanas">Volver al listado</Link>.{error ? ` (${error})` : ""}</section></main>;
  }

  return (
    <main className="gc-module">
      <section className="mx-auto max-w-[1280px] space-y-4 p-4">
        {notice && <div className="gc-toast">{notice}</div>}
        {error && <div className="gc-toast gc-toast-error">{error}</div>}
        {/* Error propio de Historial / Documentos / Regularizaciones: vive aparte
            porque el refresco de 30 s limpia `error` y se lo llevaba por delante. */}
        {errorPestana && (
          <div className="gc-note gc-alert-err flex items-start justify-between gap-3 gc-no-print">
            <span>{errorPestana}</span>
            <button
              className="gc-btn-outline shrink-0"
              onClick={() => {
                setErrorPestana("");
                if (tab === "historial") cargarHistorial(true);
                else if (tab === "documentos") cargarDocumentos(true);
                else if (tab === "regularizaciones") cargarRegularizaciones();
              }}
            >
              Reintentar
            </button>
          </div>
        )}

        <div>
          <nav className="text-sm" style={{ color: "var(--gc-muted)" }}>
            <Link href="/grandes-campanas" className="font-semibold hover:underline">Grandes Campañas</Link>
            <span> / </span>
            <span className="font-semibold" style={{ color: "var(--gc-text)" }}>{campana.nombre}</span>
          </nav>
          <div className="mt-1 flex flex-wrap items-start justify-between gap-3">
            <div>
              <h1 className="flex flex-wrap items-center gap-3 text-2xl font-extrabold">{campana.nombre} <CampanaBadgeEstado estado={campana.estado} /></h1>
              <p className="mt-1 flex flex-wrap items-center gap-4 text-sm" style={{ color: "var(--gc-muted)" }}>
                <span>Cliente: <b style={{ color: "var(--gc-text)" }}>{campana.cliente_marca || "—"}</b></span>
                <span className="inline-flex items-center gap-1"><MapPin className="h-4 w-4" />{(campana.provincias || []).length ? `${campana.provincias.length} provincia${campana.provincias.length > 1 ? "s" : ""} (${campana.provincias.slice(0, 3).join(", ")}${campana.provincias.length > 3 ? "…" : ""})` : "Sin provincias"}</span>
                <span className="inline-flex items-center gap-1"><Users className="h-4 w-4" />{gestorStats.length} responsable{gestorStats.length === 1 ? "" : "s"} de zona</span>
                {campana.delegaciones_activas && <span className="gc-badge">Por delegaciones</span>}
                {campana.pago_por_horas && <span className="gc-badge">Pago por horas{campana.tarifa_hora != null ? ` · ${eur(campana.tarifa_hora)}/h` : ""}</span>}
                {campana.pago_kilometraje && <span className="gc-badge">Kilometraje{campana.tarifa_km != null ? ` · ${eur(campana.tarifa_km)}/km` : ""}</span>}
                <span>{Number(kpis?.asignados || 0)} operativos</span>
              </p>
              <p className="mt-1 text-sm" style={{ color: "var(--gc-muted)" }}>Periodo: <b style={{ color: "var(--gc-text)" }}>{formatDate(campana.fecha_inicio)} — {formatDate(campana.fecha_fin)}</b></p>
            </div>
            <div className="flex flex-wrap gap-2 gc-no-print">
              <button className="gc-btn-outline" onClick={() => downloadXlsx(`campana_${campana.nombre.replace(/[^a-z0-9]+/gi, "_").toLowerCase()}.xlsx`, puntosCsvRows(puntos))}><FileDown className="h-4 w-4" />Exportar</button>
              <button className="gc-btn-outline" onClick={abrirWhatsApp}><MessageCircle className="h-4 w-4" />WhatsApp</button>
              <Link href={`/grandes-campanas/${campana.id}/asignacion`} className="gc-btn-outline"><Users className="h-4 w-4" />Asignación rápida</Link>
              {/* v11.3 · El informe que se manda al cliente. Solo administración: es lo que sale fuera. */}
              {admin && <Link href={`/grandes-campanas/${campana.id}/informe`} className="gc-btn-outline"><FileText className="h-4 w-4" />Informe de cliente</Link>}
              {canManageCampaigns(session) && <Link href={`/grandes-campanas/${campana.id}/editar`} className="gc-btn-outline"><Pencil className="h-4 w-4" />Editar</Link>}
              {canManageCampaigns(session) && (
                <>
                  <input ref={updateFileRef} type="file" accept={FILE_ACCEPT_ATTR} className="hidden" onChange={event => handleUpdateFromExcel(event.target.files?.[0])} />
                  <button
                    className="gc-btn-outline"
                    disabled={saving}
                    onClick={() => updateFileRef.current?.click()}
                    title={`Sube un Excel/CSV con la columna de código para actualizar estado, fecha, importe${campana.pago_por_horas ? ", hora de entrada y salida" : ""}${campana.pago_kilometraje ? ", kilometraje" : ""} o notas de los puntos existentes sin tocar el resto`}
                  >
                    <Upload className="h-4 w-4" />Actualizar desde Excel
                  </button>
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
              {/* Responsable de zona del punto nuevo. Se listan los mismos que en la
                  tabla (gestores y, si la campaña va por delegaciones, delegaciones)
                  y no solo el equipo guardado: si no, un punto de una provincia
                  subcontratada nacía sin poder asignarse a su delegación. */}
              <label><span className="gc-label">Responsable de zona</span>
                <select
                  className="gc-select"
                  value={nuevoPunto.gestor_id || ""}
                  onChange={event => {
                    const persona = responsablesParaTabla.find(item => item.id === event.target.value);
                    setNuevoPunto({ ...nuevoPunto, gestor_id: persona?.id || null, gestor_nombre: persona?.name || null });
                  }}
                >
                  <option value="">Sin asignar</option>
                  {responsablesParaTabla.map(persona => <option key={persona.id} value={persona.id}>{persona.name}{persona.esDelegacion ? " · delegación" : ""}</option>)}
                </select>
              </label>
              <div className="flex items-end gap-2">
                <button className="gc-btn-dark" disabled={saving} onClick={handleAddPunto}>Guardar punto</button>
                <button className="gc-btn-outline" onClick={() => setNuevoAbierto(false)}>Cerrar</button>
              </div>
            </div>
          </section>
        )}

        {matPara && (
          <section className="gc-form-section gc-no-print">
            <h2 className="gc-form-title">
              <Package className="mr-1 inline h-4 w-4" />
              Solicitar material a Logística — {matPara.length === 1 ? matPara[0].nombre_comercial : `${matPara.length} puntos (los tuyos visibles)`}
            </h2>
            <div className="grid gap-2 md:grid-cols-6">
              <label className="md:col-span-2"><span className="gc-label">Material *</span><input className="gc-input" value={matForm.name} onChange={event => setMatForm({ ...matForm, name: event.target.value })} /></label>
              <label><span className="gc-label">Cantidad por punto</span><input type="number" min={1} className="gc-input" value={matForm.cantidad} onChange={event => setMatForm({ ...matForm, cantidad: Number(event.target.value) })} /></label>
              <label className="md:col-span-2"><span className="gc-label">Notas para Logística</span><input className="gc-input" value={matForm.notas} onChange={event => setMatForm({ ...matForm, notas: event.target.value })} placeholder="Opcional" /></label>
              <div className="flex items-end gap-2">
                <button className="gc-btn-dark" disabled={saving || !matForm.name.trim()} onClick={handleSolicitarMaterial}>Enviar solicitud</button>
                <button className="gc-btn-outline" onClick={() => setMatPara(null)}>Cancelar</button>
              </div>
            </div>
            {/* Una cabecera de solicitud solo tiene un destinatario y una dirección, así que
                se crea una solicitud por trabajador + dirección. Se muestra antes de enviar. */}
            <div className="mt-3">
              <p className="mb-1 text-xs font-bold uppercase" style={{ color: "var(--gc-muted)" }}>
                Se crearán {gruposMaterial.length} solicitud{gruposMaterial.length === 1 ? "" : "es"} (una por trabajador y dirección de envío)
              </p>
              <ul className="space-y-1 text-xs">
                {gruposMaterial.map(grupo => (
                  <li key={grupo.key} className="flex flex-wrap items-center gap-2">
                    <span className="gc-badge" style={grupo.instalador_id ? undefined : { background: "#fdecec", color: "#9f1d2e" }}>
                      {grupo.instalador_nombre || "Sin trabajador asignado"}
                    </span>
                    <span>{grupo.puntos.length} punto{grupo.puntos.length > 1 ? "s" : ""}</span>
                    <span style={{ color: "var(--gc-muted)" }}>→ {grupo.direccion_envio || "sin dirección (irá a la dirección del punto)"}</span>
                  </li>
                ))}
              </ul>
              {gruposMaterial.some(grupo => !grupo.instalador_id) && (
                <p className="gc-note mt-2">
                  Hay puntos <b>sin trabajador asignado</b>: Almacén recibirá su material sin destinatario. Asigna los
                  trabajadores antes de pedir el material si quieres que salga a nombre de cada uno.
                </p>
              )}
            </div>
            <p className="mt-2 text-xs" style={{ color: "var(--gc-muted)" }}>
              Se creará una necesidad por punto, agrupada en una petición por destinatario, visible en Logística y en MerchanLOGS. Al completar un punto, su necesidad se cierra automáticamente.
            </p>
          </section>
        )}

        {/* El gestor ve KPIs recalculados sobre sus provincias, sin presupuesto de campaña. */}
        <CampanaDetalleKpis
          campana={campana}
          kpis={admin ? kpis : kpisDesdePuntos(campana.id, puntos, incidencias, campana.fecha_fin, campana)}
          showFinancials={admin}
        />

        <div className="gc-tabs gc-no-print">
          {tabs.map(([key, label]) => (
            <button key={key} className={`gc-tab ${tab === key ? "gc-tab-active" : ""}`} onClick={() => abrirTab(key)}>
              {label}
              {key === "incidencias" && Number(kpis?.incidencias_abiertas || 0) > 0 && <span className="ml-1 rounded-full px-1.5 text-xs font-bold" style={{ background: "#fbe9ec", color: "var(--gc-secondary)" }}>{kpis?.incidencias_abiertas}</span>}
              {/* Sin este contador, una regularización pendiente se queda esperando para siempre. */}
              {key === "regularizaciones" && regularizacionesPendientes > 0 && <span className="ml-1 rounded-full px-1.5 text-xs font-bold" style={{ background: "#fbe9ec", color: "var(--gc-secondary)" }}>{regularizacionesPendientes}</span>}
            </button>
          ))}
        </div>

        {tab === "puntos" && (
          <>
            {campana.solicitar_direccion_envio && (
              <DireccionesEnvioPanel puntos={puntos} saving={saving} onAplicar={handleAplicarDireccionEnvio} />
            )}
            <div className="flex flex-wrap items-center justify-end gap-2 gc-no-print">
              {/* v11.5 · Las dos capas de reparto no se solapan:
                    · administración reparte ZONA (gestores o delegaciones), que es lo
                      que da acceso al punto, y no ve el reparto de trabajadores;
                    · el responsable de zona reparte TRABAJADORES entre sus puntos. */}
              {admin ? (
                <button
                  className="gc-btn-outline"
                  disabled={saving || !puntosSinGestor.length}
                  title={puntosSinGestor.length
                    ? "Repartir los puntos sin responsable entre los gestores (o delegaciones) de cada provincia"
                    : "Todos los puntos tienen responsable de zona asignado"}
                  onClick={handleSugerirGestores}
                >
                  <Users className="h-4 w-4" />
                  Asignar zona ({puntosSinGestor.length} sin responsable)
                </button>
              ) : (
                <button
                  className="gc-btn-outline"
                  disabled={saving || !puntosSinTrabajador.length}
                  title={puntosSinTrabajador.length ? "Proponer un trabajador por provincia para tus puntos sin asignar" : "Todos tus puntos tienen trabajador asignado"}
                  onClick={handleSugerirTrabajadores}
                >
                  <UserCheck className="h-4 w-4" />
                  Sugerir trabajador ({puntosSinTrabajador.length} sin trabajador)
                </button>
              )}
              {/* Los pagos se vuelcan al completar cada punto; este botón recupera los
                  puntos completados antes de existir el volcado y refleja correcciones. */}
              <button
                className="gc-btn-outline"
                disabled={saving || !puntosPagables.length}
                title={puntosPagables.length
                  ? "Recalcular y registrar en Pagos las obligaciones de los puntos completados y de las incidencias"
                  : "Todavía no hay puntos completados ni incidencias que generen pago"}
                onClick={handleVolcarPagosCampana}
              >
                <Euro className="h-4 w-4" />
                Volcar pagos ({puntosPagables.length})
              </button>
              <button
                className="gc-btn-dark"
                disabled={saving || !puntosSinMaterial.length}
                title={puntosSinMaterial.length ? "Solicitar material para todos tus puntos sin petición" : "Todos tus puntos activos ya tienen petición de material"}
                onClick={() => abrirSolicitudMaterial(puntosSinMaterial)}
              >
                <Package className="h-4 w-4" />
                Solicitar material ({puntosSinMaterial.length} sin petición)
              </button>
            </div>
            {puntosSinImporte.length > 0 && (
              <p className="text-xs gc-no-print" style={{ color: "var(--gc-secondary)" }}>
                <b>{puntosSinImporte.length} punto(s) completados sin {campana.pago_por_horas ? "horas" : "importe"} o sin fecha de instalación.</b> Su pago
                queda registrado en Pagos pero <b>bloqueado</b>: nadie los cobrará hasta rellenar esos datos en la ficha del punto.
              </p>
            )}
            {/* Un gestor nunca reparte trabajadores en una provincia que ya no es suya:
                decirlo aquí evita que descubra el cambio al ver puntos que no salen. */}
            {campana.delegaciones_activas && zonasDelegadasConPuntos.length > 0 && (
              <p className="text-xs gc-no-print" style={{ color: "var(--gc-muted)" }}>
                <b>Campaña por delegaciones.</b> Estas provincias las gestiona una delegación subcontratada: {zonasDelegadasConPuntos.join(", ")}.
                El resto sigue a cargo de los gestores.
              </p>
            )}
            {!admin && provinciasVariosTrabajadores.length > 0 && (
              <p className="text-xs gc-no-print" style={{ color: "var(--gc-muted)" }}>
                Provincias de esta campaña con <b>más de un trabajador</b> disponible: {provinciasVariosTrabajadores.join(", ")}.
                Usa el filtro de provincia para revisarlas y elegir a mano.
              </p>
            )}
            <PuntosTabla
              puntos={puntos}
              incidencias={incidencias}
              isAdmin={admin}
              columnas={columnas}
              workers={workers}
              responsablesZona={responsablesParaTabla}
              saving={saving}
              logistica={logisticaPuntos}
              pagoPorHoras={!!campana.pago_por_horas}
              pagoKilometraje={!!campana.pago_kilometraje}
              onSolicitarMaterial={punto => abrirSolicitudMaterial([punto])}
              onUpdatePunto={handleUpdatePunto}
              onDeletePunto={handleDeletePunto}
              onRegistrarIncidencia={handleRegistrarIncidencia}
              solicitarDireccionEnvio={!!campana?.solicitar_direccion_envio}
              onSetDireccionEnvio={handleSetDireccionEnvio}
            />
          </>
        )}

        {tab === "gestores" && (
          !gestorStats.length ? <div className="gc-empty"><b>Sin responsables de zona asignados.</b> Asigna el equipo (y, si procede, las delegaciones) desde «Editar».</div> : (
            <div className="gc-table-wrap">
              <table className="gc-table">
                <thead><tr><th>Responsable</th><th>Tipo</th><th>Provincia</th><th style={{ textAlign: "right" }}>Puntos asignados</th><th style={{ textAlign: "right" }}>Completados</th><th style={{ textAlign: "right" }}>Incidencias</th><th>Acciones</th></tr></thead>
                <tbody>
                  {gestorStats.map(gestor => (
                    <tr key={gestor.id}>
                      <td><span className="inline-flex items-center gap-2"><GestorAvatar name={gestor.gestor_nombre} />{gestor.gestor_nombre || "—"}</span></td>
                      <td>{gestor.esDelegacion ? <span className="gc-badge">Delegación</span> : "Gestor"}</td>
                      <td>{gestor.provincia || "—"}</td>
                      <td className="text-right font-semibold">{gestor.asignados}</td>
                      <td className="text-right">{gestor.completados}</td>
                      <td className="text-right">{gestor.incidencias > 0 ? <b style={{ color: "var(--gc-secondary)" }}>{gestor.incidencias}</b> : "0"}</td>
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
              <div className="gc-empty">
                <b>Todavía no hay pagos.</b> El pago de un punto se genera cuando pasa a <b>Completado</b> y tiene {pagosResumen.porHoras ? "horas reportadas y tarifa" : "importe"}.
                Ahora mismo hay {pagosResumen.pendientes} punto(s) sin completar{pagosResumen.sinDatos ? ` y ${pagosResumen.sinDatos} completado(s) sin horas` : ""}.
              </div>
            ) : (
              <div className="space-y-3">
                <div className="grid gap-3 md:grid-cols-3">
                  <div className="gc-kpi"><p className="gc-kpi-label">Puntos pagables</p><p className="gc-kpi-value">{pagosResumen.totalPuntos.toLocaleString("es-ES")}</p></div>
                  <div className="gc-kpi"><p className="gc-kpi-label">Total a pagar</p><p className="gc-kpi-value">{eur(pagosResumen.totalImporte)}</p></div>
                  <div className="gc-kpi"><p className="gc-kpi-label">Pendientes de completar</p><p className="gc-kpi-value">{pagosResumen.pendientes.toLocaleString("es-ES")}</p></div>
                </div>
                {pagosResumen.porHoras && (
                  <p className="gc-note">
                    Campaña <b>con pago por horas</b> a {campana.tarifa_hora != null ? `${eur(campana.tarifa_hora)}/h` : <b style={{ color: "var(--gc-secondary)" }}>tarifa sin configurar</b>}
                    {pagosResumen.sinDatos > 0 && <> · <b style={{ color: "var(--gc-secondary)" }}>{pagosResumen.sinDatos} punto(s) completados sin horas</b>: su pago queda bloqueado hasta rellenar la entrada y la salida.</>}
                  </p>
                )}
                {pagosResumen.conKm && (
                  <p className="gc-note">
                    Kilometraje a {campana.tarifa_km != null ? `${eur(campana.tarifa_km)}/km` : <b style={{ color: "var(--gc-secondary)" }}>tarifa sin configurar</b>}. Se liquida como línea aparte del trabajo.
                  </p>
                )}
                <div className="gc-table-wrap">
                  <table className="gc-table">
                    <thead>
                      <tr>
                        <th>Trabajador</th>
                        <th style={{ textAlign: "right" }}>Puntos completados</th>
                        {pagosResumen.porHoras && <th style={{ textAlign: "right" }}>Horas</th>}
                        <th style={{ textAlign: "right" }}>{pagosResumen.porHoras ? "Importe por horas" : "Importe acumulado"}</th>
                        {pagosResumen.conKm && <th style={{ textAlign: "right" }}>Km</th>}
                        {pagosResumen.conKm && <th style={{ textAlign: "right" }}>Kilometraje</th>}
                        {pagosResumen.conKm && <th style={{ textAlign: "right" }}>Total</th>}
                      </tr>
                    </thead>
                    <tbody>
                      {pagosResumen.filas.map(fila => (
                        <tr key={fila.trabajador}>
                          <td><span className="inline-flex items-center gap-2"><GestorAvatar name={fila.trabajador} size={24} />{fila.trabajador}</span></td>
                          <td className="text-right font-semibold">{fila.puntos}</td>
                          {pagosResumen.porHoras && <td className="text-right">{fila.horas.toLocaleString("es-ES", { maximumFractionDigits: 2 })}</td>}
                          <td className="text-right font-semibold">{eur(fila.trabajo)}</td>
                          {pagosResumen.conKm && <td className="text-right">{fila.kilometros.toLocaleString("es-ES", { maximumFractionDigits: 2 })}</td>}
                          {pagosResumen.conKm && <td className="text-right">{eur(fila.kilometraje)}</td>}
                          {pagosResumen.conKm && <td className="text-right font-semibold">{eur(fila.trabajo + fila.kilometraje)}</td>}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <div className="gc-table-foot"><span>Una línea por trabajador con el importe actualizado según los puntos completados. El detalle contable definitivo vive en <Link className="underline" href="/historial-economico">Historial económico</Link> (sincroniza allí para exportar pagos).</span></div>
                </div>
              </div>
            )
          ) : (
            <div className="gc-empty">El detalle de pagos está reservado a administración.</div>
          )
        )}

        {tab === "historial" && <HistorialPanel eventos={eventos} cargando={cargandoEventos} />}

        {tab === "regularizaciones" && (
          <RegularizacionesPanel
            campanaId={params.id}
            regularizaciones={regularizaciones}
            puntos={puntos}
            mesesCerrados={mesesCerrados}
            admin={admin}
            cargando={cargandoRegularizaciones}
            saving={saving}
            onSolicitar={handleSolicitarRegularizacion}
            onResolver={handleResolverRegularizacion}
          />
        )}

        {tab === "documentos" && (
          <DocumentosPanel
            documentos={documentos}
            puntos={puntos}
            session={session}
            cargando={cargandoDocumentos}
            saving={saving}
            onSubir={handleSubirDocumento}
            onRetirar={handleRetirarDocumento}
            onVisibilidad={handleVisibilidadDocumento}
          />
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

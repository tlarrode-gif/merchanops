"use client";

import { useEffect, useMemo, useState } from "react";
import { AppSession, canAccessModule, getCurrentAppSession, isAdminSession, sessionProvinceLabel } from "@/lib/access-control";
import { MoKpi } from "@/components/ui/mo";
import {
  EconomicEvent,
  EconomicEventOrigen,
  EconomicEventTipo,
  addExtraEvent,
  cerrarMes,
  economicEstadoLabels,
  economicOrigenLabels,
  economicTipoLabels,
  facturacionEventsFromIsdin,
  fetchEconomicEvents,
  fetchMesesCerrados,
  mesContable,
  reabrirMes,
  pagoEventsFromCampanaPuntos,
  pagoEventsFromPaymentLines,
  revertEconomicEvent,
  summarizeEconomicEvents,
  syncEconomicEvents
} from "@/lib/economic-events";
import { IsdinBillingSettings, isdinBillingLines } from "@/lib/isdin-billing";
import { auditBigCampaigns, auditIsdinPreventiveCalls, auditServices, type PaymentIssue } from "@/lib/payment-ledger";
import { buildEnginePaymentLines } from "@/lib/payments/lines";
import { isSupabaseConfigured, supabase } from "@/lib/supabase";
import { csvSafeCell } from "@/lib/sanitize";

type Row = Record<string, any>;

function eur(value: number) { return new Intl.NumberFormat("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(value || 0)) + " €"; }
function csvEscape(value: unknown) { const text = csvSafeCell(value); return text.includes(";") || text.includes("\n") || text.includes('"') ? `"${text.replace(/"/g, '""')}"` : text; }
function downloadCsv(name: string, rows: unknown[][]) { const blob = new Blob(["\ufeff" + rows.map(row => row.map(csvEscape).join(";")).join("\n")], { type: "text/csv;charset=utf-8;" }); const url = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = url; a.download = name; a.click(); URL.revokeObjectURL(url); }
function issueWeight(issue: PaymentIssue) { return issue.severity === "critico" ? 4 : issue.severity === "alto" ? 3 : issue.severity === "medio" ? 2 : 1; }

const emptyExtra = { fecha: new Date().toISOString().slice(0, 10), concepto: "", importe: "", tipo: "extra" as EconomicEventTipo, worker_name: "", provincia: "" };

export default function HistorialEconomicoPage() {
  const [session, setSession] = useState<AppSession | null>(null);
  const [eventos, setEventos] = useState<EconomicEvent[]>([]);
  const [issues, setIssues] = useState<PaymentIssue[]>([]);
  const [mes, setMes] = useState(mesContable());
  const [tipo, setTipo] = useState<EconomicEventTipo | "">("");
  const [origen, setOrigen] = useState<EconomicEventOrigen | "">("");
  const [worker, setWorker] = useState("");
  const [provincia, setProvincia] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [extra, setExtra] = useState({ ...emptyExtra });
  const [mesesCerrados, setMesesCerrados] = useState<string[]>([]);

  async function load(activeSession?: AppSession | null) {
    const current = activeSession ?? getCurrentAppSession();
    setSession(current);
    if (!current?.active || !canAccessModule(current, "pagos")) return;
    setLoading(true);
    const [result, cerrados] = await Promise.all([
      fetchEconomicEvents({ mes, tipo, origen, worker, provincia }, current),
      fetchMesesCerrados()
    ]);
    if (result.error) setMessage(result.error);
    setEventos(result.data);
    setMesesCerrados(cerrados.data);
    setLoading(false);
  }

  useEffect(() => { load(); }, [mes, tipo, origen, worker, provincia]); // eslint-disable-line react-hooks/exhaustive-deps

  // Sincronización automática de la gestora, una sola vez al abrir la pantalla.
  // No hay botón para ella: entra y sus pagos ya están al día. Es idempotente
  // (repetirla no duplica eventos), así que abrir la pantalla varias veces no
  // tiene efectos. Administración sigue sincronizando a mano, porque su alcance
  // incluye la facturación a cliente.
  useEffect(() => {
    const current = getCurrentAppSession();
    if (!current?.active || isAdminSession(current)) return;
    if (!canAccessModule(current, "pagos") || !(current.provinces || []).length) return;
    void sync(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sincroniza el registro de eventos con el estado actual de los orígenes.
  // Idempotente: repetir la sincronización no duplica eventos ya contabilizados.
  /**
   * `silencioso` = sincronización automática de una gestora al abrir la pantalla.
   * No hay botón para ella: sus pagos se sincronizan solos y punto. Solo se le
   * habla si algo falla; el resumen de altas/sustituciones es ruido para quien
   * no ha pedido nada.
   *
   * Administración conserva el botón explícito, porque su sincronización abarca
   * también la facturación a cliente y los extras.
   *
   * `syncEconomicEvents` filtra por tipo y provincia, y la RLS (v9_11) lo vuelve
   * a comprobar en la base: esto es comodidad, no la defensa.
   */
  async function sync(silencioso = false) {
    const current = getCurrentAppSession();
    if (!isSupabaseConfigured || !supabase) {
      if (!silencioso) setMessage("La sincronización requiere Supabase activo.");
      return;
    }
    if (!current?.active || !canAccessModule(current, "pagos")) return;
    setSyncing(true);
    if (!silencioso) setMessage("");
    try {
      const [servicesR, pointsR, bigCampaignsR, bigPointsR, vinylsR, settingsR, adjustmentsR, campanasR, puntosR] = await Promise.all([
        supabase.from("services").select("*"),
        supabase.from("points").select("*"),
        supabase.from("big_campaigns").select("*"),
        supabase.from("big_campaign_points").select("*"),
        supabase.from("isdin_vinyls").select("*"),
        supabase.from("isdin_billing_settings").select("*").eq("id", "global").maybeSingle(),
        supabase.from("isdin_billing_adjustments").select("*"),
        // v11.5 · La configuración de pago de la campaña y las horas/kilómetros del
        // punto entran en el SELECT: sin ellas, una campaña por horas no generaba
        // ni un evento económico (su `importe` está siempre vacío).
        supabase.from("grandes_campanas").select("id,nombre,cliente_marca,pago_por_horas,tarifa_hora,pago_kilometraje,tarifa_km"),
        supabase.from("puntos_venta_campana").select("id,campana_id,gestor_id,gestor_nombre,instalador_id,instalador_nombre,codigo,nombre_comercial,provincia,estado,fecha_visita,importe,hora_entrada,hora_salida,horas_trabajadas,kilometros,updated_at")
      ]);
      const services = (servicesR.data || []) as Row[];
      const points = (pointsR.data || []) as Row[];
      const bigCampaigns = (bigCampaignsR.data || []) as Row[];
      const bigPoints = (bigPointsR.data || []) as Row[];
      const vinyls = (vinylsR.data || []) as Row[];
      const settings = (settingsR.data as IsdinBillingSettings) || { id: "global", standard_rate: 0, custom_rate: 0 };
      const adjustments = (adjustmentsR.data || []) as Row[];

      // C3: las líneas de pago salen del MOTOR ÚNICO con identidad estable
      // (fingerprint = clave de obligación, sin fecha/importe): una corrección
      // actualiza el mismo evento económico en vez de crear uno paralelo.
      const engineResult = buildEnginePaymentLines(services, points, bigCampaigns, bigPoints);
      const paymentLines = engineResult.lines;
      const billingLines = (vinyls as any[]).flatMap(vinyl => isdinBillingLines(vinyl, settings));
      const nuevos = [
        ...pagoEventsFromPaymentLines(paymentLines),
        ...pagoEventsFromCampanaPuntos((puntosR.data || []) as Row[], (campanasR.data || []) as Row[]),
        ...facturacionEventsFromIsdin(billingLines, adjustments as any[])
      ];
      const result = await syncEconomicEvents(nuevos, current);
      if (result.error) {
        // Un fallo SÍ se dice siempre, aunque la sincronización fuera automática:
        // que los pagos no se hayan registrado no puede pasar desapercibido.
        setMessage(`Error al sincronizar: ${result.error}`);
      } else if (!silencioso) {
        const { nuevos: altas, sustituidos, retenidos, omitidos } = result.data;
        const partes = [
          altas ? `${altas} eventos nuevos` : "",
          sustituidos ? `${sustituidos} sustituidos (el origen cambió: reverso automático + evento nuevo)` : "",
          retenidos ? `${retenidos} retenidos en revisión (sin beneficiario)` : "",
          omitidos ? `${omitidos} fuera de tus provincias o de facturación a cliente (los sincroniza administración)` : ""
        ].filter(Boolean);
        setMessage(partes.length ? partes.join(" · ") + "." : "Sin cambios: el historial ya estaba al día.");
      }

      setIssues([...engineResult.issues, ...auditServices(services, points), ...auditBigCampaigns(bigCampaigns, bigPoints), ...auditIsdinPreventiveCalls(vinyls)].sort((a, b) => issueWeight(b) - issueWeight(a)));
      await load(current);
    } finally {
      setSyncing(false);
    }
  }

  async function revertir(evento: EconomicEvent) {
    const motivo = window.prompt(`Motivo del reverso de "${evento.concepto}" (${eur(evento.importe)})`);
    if (motivo === null) return;
    const result = await revertEconomicEvent(evento, motivo.trim(), getCurrentAppSession());
    setMessage(result.error || "Reverso registrado. El original queda marcado como revertido.");
    if (!result.error) await load();
  }

  async function crearExtra() {
    const result = await addExtraEvent({ fecha: extra.fecha, concepto: extra.concepto, importe: Number(extra.importe), tipo: extra.tipo, worker_name: extra.worker_name || null, provincia: extra.provincia || null }, getCurrentAppSession());
    setMessage(result.error || "Evento manual registrado.");
    if (!result.error) { setExtra({ ...emptyExtra }); await load(); }
  }

  const admin = isAdminSession(session);
  const summary = useMemo(() => summarizeEconomicEvents(eventos), [eventos]);
  const workers = useMemo(() => Array.from(new Map(eventos.filter(evento => evento.worker_id || evento.worker_name).map(evento => [evento.worker_id || evento.worker_name, evento.worker_name || "Sin trabajador"])).entries()), [eventos]);
  const provincias = useMemo(() => Array.from(new Set(eventos.map(evento => evento.provincia).filter(Boolean))) as string[], [eventos]);

  const mesCerrado = Boolean(mes && mesesCerrados.includes(mes));

  async function alternarCierreMes() {
    if (!mes) return;
    const actor = getCurrentAppSession();
    const result = mesCerrado ? await reabrirMes(mes, actor) : await cerrarMes(mes, actor);
    setMessage(result.error || (mesCerrado ? `Mes ${mes} reabierto.` : `Mes ${mes} cerrado: sus eventos quedan congelados y lo nuevo se contabilizará en el mes abierto en curso.`));
    if (!result.error) await load();
  }

  // Export agrupado: una línea por campaña × trabajador × mes con el importe
  // neto acumulado (los reversos restan), en lugar de una línea por punto.
  // El detalle punto a punto sigue disponible en «Exportar pagos del mes».
  function exportarPagosAgrupados() {
    const objetivo = eventos.filter(evento => evento.tipo === "pago_trabajador" && evento.estado !== "revision");
    if (!objetivo.length) { setMessage("No hay pagos exportables en el filtro actual."); return; }
    const grupos = new Map<string, { mes: string; campana: string; origen: string; worker: string; provincia: Set<string>; lineas: number; reversos: number; importe: number }>();
    for (const evento of objetivo) {
      const campana = evento.campana || economicOrigenLabels[evento.origen];
      const worker = evento.worker_name || "Sin trabajador";
      const key = [evento.mes_contable, campana, worker].join("|");
      const grupo = grupos.get(key) || { mes: evento.mes_contable, campana, origen: economicOrigenLabels[evento.origen], worker, provincia: new Set<string>(), lineas: 0, reversos: 0, importe: 0 };
      if (evento.provincia) grupo.provincia.add(evento.provincia);
      if (evento.estado === "reverso") grupo.reversos += 1; else grupo.lineas += 1;
      grupo.importe += Number(evento.importe || 0);
      grupos.set(key, grupo);
    }
    downloadCsv(`pagos_agrupados_${mes || "todo"}.csv`, [
      ["Mes contable", "Campaña", "Origen", "Trabajador", "Provincias", "Puntos/líneas", "Reversos", "Importe neto"],
      ...Array.from(grupos.values())
        .sort((a, b) => a.campana.localeCompare(b.campana, "es") || a.worker.localeCompare(b.worker, "es"))
        .map(grupo => [grupo.mes, grupo.campana, grupo.origen, grupo.worker, Array.from(grupo.provincia).join(", "), grupo.lineas, grupo.reversos, grupo.importe.toFixed(2)])
    ]);
  }

  // Los eventos retenidos en revisión no se exportan: no son pagables/facturables
  // hasta que administración los resuelva.
  function exportar(tipoExport: "pagos" | "facturacion") {
    const objetivo = eventos.filter(evento => (tipoExport === "pagos" ? evento.tipo === "pago_trabajador" : evento.tipo === "facturacion_cliente") && evento.estado !== "revision");
    if (!objetivo.length) { setMessage("No hay eventos exportables de ese tipo en el filtro actual."); return; }
    downloadCsv(`${tipoExport}_${mes || "todo"}.csv`, [
      ["Mes contable", "Fecha", "Tipo", "Origen", "Trabajador", "Cliente", "CECO", "Campaña", "Provincia", "Concepto", "Importe", "Estado", "Motivo reverso"],
      ...objetivo.map(evento => [evento.mes_contable, evento.fecha_evento, economicTipoLabels[evento.tipo], economicOrigenLabels[evento.origen], evento.worker_name || "", evento.client || "", evento.ceco || "", evento.campana || "", evento.provincia || "", evento.concepto, evento.importe, economicEstadoLabels[evento.estado], evento.motivo_reverso || ""])
    ]);
  }

  if (!session?.active) return <main className="min-h-screen bg-slate-100 p-4 text-slate-900"><section className="mx-auto max-w-5xl rounded-3xl border bg-white p-5 shadow-sm">Inicia sesión para ver el historial económico.</section></main>;
  if (!canAccessModule(session, "pagos")) return <main className="min-h-screen bg-slate-100 p-4 text-slate-900"><section className="mx-auto max-w-5xl rounded-3xl border bg-white p-5 shadow-sm">No tienes permiso para ver el historial económico.</section></main>;

  return (
    <main className="min-h-screen bg-slate-100 p-4 text-slate-900">
      <section className="mx-auto max-w-7xl space-y-5">
        <div>
          <h1 className="mo-page-title text-3xl font-bold">Historial económico</h1>
          <p className="text-sm text-slate-500">
            Registro contable de pagos a trabajadores{admin ? ", facturación a cliente y extras" : ""} generado desde los cambios de estado. Vista: {sessionProvinceLabel(session)}.
            {!admin && " Como gestor ves únicamente los pagos de tus provincias."}
          </p>
        </div>

        {message && <div className="rounded-2xl border bg-emerald-50 p-3 text-sm text-emerald-800">{message}</div>}

        <div className="rounded-3xl border bg-white p-5 shadow-sm">
          <div className="grid gap-3 md:grid-cols-6">
            <label><span className="text-xs text-slate-500">Mes contable</span><input className="mt-1 w-full rounded-xl border px-3 py-2" type="month" value={mes} onChange={event => setMes(event.target.value)} /></label>
            {admin && (
              <label><span className="text-xs text-slate-500">Tipo</span><select className="mt-1 w-full rounded-xl border bg-white px-3 py-2" value={tipo} onChange={event => setTipo(event.target.value as EconomicEventTipo | "")}><option value="">Todos</option>{Object.entries(economicTipoLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
            )}
            <label><span className="text-xs text-slate-500">Origen</span><select className="mt-1 w-full rounded-xl border bg-white px-3 py-2" value={origen} onChange={event => setOrigen(event.target.value as EconomicEventOrigen | "")}><option value="">Todos</option>{Object.entries(economicOrigenLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
            <label><span className="text-xs text-slate-500">Trabajador</span><select className="mt-1 w-full rounded-xl border bg-white px-3 py-2" value={worker} onChange={event => setWorker(event.target.value)}><option value="">Todos</option>{workers.map(([id, name]) => <option key={String(id)} value={String(id)}>{name}</option>)}</select></label>
            <label><span className="text-xs text-slate-500">Provincia</span><select className="mt-1 w-full rounded-xl border bg-white px-3 py-2" value={provincia} onChange={event => setProvincia(event.target.value)}><option value="">Todas</option>{provincias.map(name => <option key={name} value={name}>{name}</option>)}</select></label>
            <button onClick={() => load()} className="self-end rounded-2xl border bg-white px-4 py-2">Actualizar</button>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {/* La gestora no pulsa nada: sus pagos se sincronizan solos al abrir
                la pantalla (ver el efecto de arriba). El botón queda solo para
                administración, cuya sincronización abarca además la facturación
                a cliente y los extras. */}
            {admin && <button onClick={() => sync()} disabled={syncing} className="rounded-2xl bg-slate-900 px-4 py-2 text-white">{syncing ? "Sincronizando..." : "Sincronizar eventos"}</button>}
            <button onClick={() => exportar("pagos")} className="rounded-2xl border bg-white px-4 py-2">Exportar pagos del mes</button>
            <button onClick={exportarPagosAgrupados} className="rounded-2xl border bg-white px-4 py-2" title="Una línea por campaña y trabajador con el importe neto acumulado">Exportar pagos agrupados</button>
            {admin && <button onClick={() => exportar("facturacion")} className="rounded-2xl border bg-white px-4 py-2">Exportar facturación del mes</button>}
            {admin && mes && (
              <button onClick={alternarCierreMes} className={`rounded-2xl border px-4 py-2 ${mesCerrado ? "border-amber-300 bg-amber-50 text-amber-900" : "bg-white"}`}>
                {mesCerrado ? `Reabrir mes ${mes}` : `Cerrar mes ${mes}`}
              </button>
            )}
            {mesCerrado && <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-900">🔒 Mes cerrado: eventos congelados</span>}
          </div>
        </div>

        <div className="grid gap-3 md:grid-cols-6">
          <K label="Pagos (neto)" value={eur(summary.pagos)} accent="gold" />
          {admin && <K label="Facturación (neto)" value={eur(summary.facturacion)} accent="gold" />}
          {admin && <K label="Extras (neto)" value={eur(summary.extras)} accent="gold" />}
          <K label="Eventos" value={summary.total} accent="ink" />
          <K label="Reversos" value={summary.reversos} accent="risk" />
          <K label="En revisión" value={summary.enRevision} accent="risk" />
        </div>

        {admin && (
          <div className="rounded-3xl border bg-white p-5 shadow-sm">
            <h2 className="mb-3 text-lg font-semibold">Añadir evento manual</h2>
            <div className="grid gap-2 md:grid-cols-6">
              <label><span className="text-xs text-slate-500">Fecha</span><input className="mt-1 w-full rounded-xl border px-3 py-2" type="date" value={extra.fecha} onChange={event => setExtra({ ...extra, fecha: event.target.value })} /></label>
              <label className="md:col-span-2"><span className="text-xs text-slate-500">Concepto</span><input className="mt-1 w-full rounded-xl border px-3 py-2" value={extra.concepto} onChange={event => setExtra({ ...extra, concepto: event.target.value })} /></label>
              <label><span className="text-xs text-slate-500">Importe +/-</span><input className="mt-1 w-full rounded-xl border px-3 py-2" type="number" value={extra.importe} onChange={event => setExtra({ ...extra, importe: event.target.value })} /></label>
              <label><span className="text-xs text-slate-500">Tipo</span><select className="mt-1 w-full rounded-xl border bg-white px-3 py-2" value={extra.tipo} onChange={event => setExtra({ ...extra, tipo: event.target.value as EconomicEventTipo })}>{Object.entries(economicTipoLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
              <button onClick={crearExtra} className="self-end rounded-2xl bg-slate-900 px-4 py-2 text-white">Añadir</button>
            </div>
          </div>
        )}

        <div className="rounded-3xl border bg-white p-5 shadow-sm">
          <h2 className="mb-3 text-lg font-semibold">Eventos del periodo</h2>
          {loading ? <p>Cargando...</p> : eventos.length === 0 ? <p className="text-sm text-slate-500">Sin eventos con los filtros actuales.{admin ? " Usa «Sincronizar eventos» para generar el historial desde los datos vivos." : ""}</p> : (
            <div className="overflow-auto">
              <table className="w-full min-w-[1100px] text-sm">
                <thead><tr className="bg-slate-50"><th className="p-2 text-left">Mes</th><th>Fecha</th><th>Tipo</th><th>Origen</th><th>Trabajador</th><th>Cliente</th><th>Campaña</th><th>Provincia</th><th>Concepto</th><th className="text-right">Importe</th><th>Estado</th>{admin && <th></th>}</tr></thead>
                <tbody>
                  {eventos.map(evento => (
                    <tr key={evento.id} className={`border-t ${evento.estado === "revertido" ? "text-slate-400 line-through" : evento.estado === "reverso" ? "bg-amber-50" : evento.estado === "revision" ? "bg-rose-50" : ""}`}>
                      <td className="p-2">{evento.mes_contable}</td>
                      <td>{evento.fecha_evento}</td>
                      <td>{economicTipoLabels[evento.tipo]}</td>
                      <td>{economicOrigenLabels[evento.origen]}</td>
                      <td>{evento.worker_name || "—"}</td>
                      <td>{evento.client || "—"}</td>
                      <td>{evento.campana || "—"}</td>
                      <td>{evento.provincia || "—"}</td>
                      <td title={evento.motivo_reverso || undefined}>{evento.concepto}</td>
                      <td className="text-right font-semibold">{eur(evento.importe)}</td>
                      <td>{economicEstadoLabels[evento.estado]}</td>
                      {admin && <td className="p-2 text-right">{evento.estado === "activo" ? <button onClick={() => revertir(evento)} className="rounded-xl border px-3 py-1 text-xs text-red-600">Revertir</button> : evento.estado === "revision" ? <button onClick={() => revertir(evento)} className="rounded-xl border px-3 py-1 text-xs text-red-600">Descartar</button> : null}</td>}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {admin && issues.length > 0 && (
          <div className="rounded-3xl border bg-white p-5 shadow-sm">
            <h2 className="mb-3 text-lg font-semibold">Avisos de auditoría</h2>
            <div className="space-y-2">
              {issues.map((issue, index) => (
                <div key={`${issue.origin}-${issue.entity}-${index}`} className={`rounded-2xl border p-3 text-sm ${issue.severity === "critico" ? "border-red-200 bg-red-50" : issue.severity === "alto" ? "border-orange-200 bg-orange-50" : "bg-white"}`}>
                  <div className="flex flex-wrap items-center gap-2"><b className="uppercase">{issue.severity}</b><span className="text-slate-500">{issue.origin} · {issue.entity}</span></div>
                  <p className="mt-1">{issue.description}</p>
                  <p className="mt-1 text-xs text-slate-500">{issue.action}</p>
                </div>
              ))}
            </div>
          </div>
        )}
      </section>
    </main>
  );
}

function K({ label, value, accent }: { label: string; value: any; accent?: "coral" | "risk" | "ok" | "gold" | "ink" }) { return <MoKpi label={label} value={value} accent={accent} />; }

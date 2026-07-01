"use client";

import { useEffect, useMemo, useState } from "react";
import { AppSession, canAccessModule, getCurrentAppSession, isAdminSession, sessionProvinceLabel, userCanSeeProvince } from "@/lib/access-control";
import {
  INCIDENT_FEE,
  auditBigCampaigns,
  auditIsdinPreventiveCalls,
  auditServices,
  buildBigCampaignPaymentLines,
  buildServicePaymentLines,
  dateOnly,
  summarizePayments,
  type PaymentIssue,
  type PaymentLine
} from "@/lib/payment-ledger";
import { isSupabaseConfigured, supabase } from "@/lib/supabase";

type Row = Record<string, any>;

function monthStart() { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`; }
function monthEnd() { const d = new Date(); const last = new Date(d.getFullYear(), d.getMonth() + 1, 0); return `${last.getFullYear()}-${String(last.getMonth() + 1).padStart(2, "0")}-${String(last.getDate()).padStart(2, "0")}`; }
function todayISO() { return new Date().toISOString(); }
function eur(value: number) { return new Intl.NumberFormat("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(value || 0)) + " €"; }
function csvEscape(value: unknown) { const text = String(value ?? ""); return text.includes(";") || text.includes("\n") || text.includes('"') ? `"${text.replace(/"/g, '""')}"` : text; }
function downloadCsv(name: string, rows: unknown[][]) { const blob = new Blob(["\ufeff" + rows.map(row => row.map(csvEscape).join(";")).join("\n")], { type: "text/csv;charset=utf-8;" }); const url = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = url; a.download = name; a.click(); URL.revokeObjectURL(url); }
function pStatus(point: Row) { return point.point_status || point.status || "Pendiente"; }
function isFailedStatus(status: string) { return status === "Incidencia" || status === "Pospuesto"; }
function originalFee(point: Row) { return Number(point.original_fee ?? point.fee ?? 0); }
function issueWeight(issue: PaymentIssue) { return issue.severity === "critico" ? 4 : issue.severity === "alto" ? 3 : issue.severity === "medio" ? 2 : 1; }
function canSeeProvince(session: AppSession | null, province?: string | null) { return isAdminSession(session) || userCanSeeProvince(session, province); }

export default function PaymentAuditPage() {
  const [session, setSession] = useState<AppSession | null>(null);
  const [services, setServices] = useState<Row[]>([]);
  const [points, setPoints] = useState<Row[]>([]);
  const [campaigns, setCampaigns] = useState<Row[]>([]);
  const [campaignPoints, setCampaignPoints] = useState<Row[]>([]);
  const [vinyls, setVinyls] = useState<Row[]>([]);
  const [ledger, setLedger] = useState<Row[]>([]);
  const [from, setFrom] = useState(monthStart());
  const [to, setTo] = useState(monthEnd());
  const [origin, setOrigin] = useState("");
  const [worker, setWorker] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

  async function load() {
    const activeSession = getCurrentAppSession();
    setSession(activeSession);
    setLoading(true);
    setMessage("");

    if (isSupabaseConfigured && supabase && canAccessModule(activeSession, "pagos")) {
      const scopedProvinces = !isAdminSession(activeSession) ? (activeSession?.provinces || []).filter(Boolean) : [];
      let serviceQuery = supabase.from("services").select("*");
      if (scopedProvinces.length) serviceQuery = serviceQuery.in("province", scopedProvinces);
      let campaignPointQuery = supabase.from("big_campaign_points").select("*");
      if (scopedProvinces.length) campaignPointQuery = campaignPointQuery.in("province", scopedProvinces);
      let vinylQuery = supabase.from("isdin_vinyls").select("*");
      if (scopedProvinces.length) vinylQuery = vinylQuery.in("province", scopedProvinces);

      const [{ data: serviceRows }, { data: pointRows }, { data: campaignPointRows }, { data: vinylRows }, { data: ledgerRows }] = await Promise.all([
        serviceQuery,
        supabase.from("points").select("*"),
        campaignPointQuery,
        vinylQuery,
        supabase.from("payment_ledger").select("*").order("created_at", { ascending: false }).limit(300)
      ]);

      const visibleServices = (serviceRows || []) as Row[];
      const visibleServiceIds = new Set(visibleServices.map(service => service.id));
      const visiblePoints = ((pointRows || []) as Row[]).filter(point => visibleServiceIds.has(point.service_id));
      const visibleCampaignPoints = (campaignPointRows || []) as Row[];
      const campaignIds = Array.from(new Set(visibleCampaignPoints.map(point => point.big_campaign_id).filter(Boolean)));
      let visibleCampaigns: Row[] = [];
      if (campaignIds.length) {
        const { data } = await supabase.from("big_campaigns").select("*").in("id", campaignIds);
        visibleCampaigns = (data || []) as Row[];
      }

      setServices(visibleServices);
      setPoints(visiblePoints);
      setCampaignPoints(visibleCampaignPoints);
      setCampaigns(visibleCampaigns);
      setVinyls((vinylRows || []) as Row[]);
      setLedger(((ledgerRows || []) as Row[]).filter(row => canSeeProvince(activeSession, row.province)));
    } else {
      const local = JSON.parse(localStorage.getItem("merchanops_local_v362") || "{}");
      const localServices = (local.services || []).filter((service: Row) => canSeeProvince(activeSession, service.province));
      setServices(localServices);
      setPoints(localServices.flatMap((service: Row) => service.points || []));
      setCampaigns([]);
      setCampaignPoints([]);
      setVinyls([]);
      setLedger([]);
    }

    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  const serviceLines = useMemo(() => buildServicePaymentLines(services, points), [services, points]);
  const campaignLines = useMemo(() => buildBigCampaignPaymentLines(campaigns, campaignPoints), [campaigns, campaignPoints]);
  const allLines = useMemo(() => [...serviceLines, ...campaignLines], [serviceLines, campaignLines]);
  const filteredLines = useMemo(() => allLines.filter(line => (!from || line.payment_date >= from) && (!to || line.payment_date <= to) && (!origin || line.origin === origin) && (!worker || line.worker_id === worker || line.worker_name === worker)), [allLines, from, to, origin, worker]);
  const issues = useMemo(() => [...auditServices(services, points), ...auditBigCampaigns(campaigns, campaignPoints), ...auditIsdinPreventiveCalls(vinyls)].sort((a, b) => issueWeight(b) - issueWeight(a)), [services, points, campaigns, campaignPoints, vinyls]);
  const periodLedger = useMemo(() => ledger.filter(row => (!from || dateOnly(row.payment_date) >= from) && (!to || dateOnly(row.payment_date) <= to)), [ledger, from, to]);
  const summary = summarizePayments(filteredLines);
  const ledgerFingerprints = new Set(periodLedger.map(row => row.fingerprint));
  const pendingSnapshot = filteredLines.filter(line => !ledgerFingerprints.has(line.fingerprint));
  const workers = Array.from(new Map(allLines.filter(line => line.worker_id || line.worker_name).map(line => [line.worker_id || line.worker_name, line.worker_name || "Sin trabajador"])).entries());
  const severityCounts = issues.reduce<Record<string, number>>((acc, issue) => { acc[issue.severity] = (acc[issue.severity] || 0) + 1; return acc; }, {});

  async function normalize() {
    if (!supabase) { setMessage("Normalización automática solo disponible con Supabase activo."); return; }
    const messages: string[] = [];
    for (const service of services) {
      if ((service.status === "Validado" || service.status === "Pagado") && !service.validated_at) {
        const value = service.resolved_at || todayISO();
        await supabase.from("services").update({ validated_at: value }).eq("id", service.id);
        messages.push(`Servicio ${service.client || ""} · ${service.campaign || ""}: añadida fecha de validación.`);
      }
    }
    for (const point of points) {
      const status = pStatus(point);
      if (isFailedStatus(status) && !point.original_fee) {
        await supabase.from("points").update({ original_fee: Number(point.fee || 0), incident_fee: Number(point.incident_fee || INCIDENT_FEE) }).eq("id", point.id);
        messages.push(`Punto ${point.name || point.id}: guardado importe original.`);
      }
      if (status === "Finalizado" && point.incident_status === "Abierta") {
        const original = originalFee(point);
        const incident = Number(point.incident_fee || INCIDENT_FEE);
        await supabase.from("points").update({ incident_status: "Resuelta", incident_resolved_at: todayISO(), fee: original + incident, original_fee: original, incident_fee: incident }).eq("id", point.id);
        messages.push(`Punto ${point.name || point.id}: incidencia resuelta y pago recalculado.`);
      }
    }
    setMessage(messages.length ? messages.join(" ") : "No había datos de Servicios que normalizar.");
    await load();
  }

  async function saveSnapshot() {
    if (!supabase) { setMessage("El snapshot solo puede guardarse con Supabase activo."); return; }
    if (!pendingSnapshot.length) { setMessage("No hay líneas nuevas que guardar en el ledger para el periodo filtrado."); return; }
    const actor = getCurrentAppSession();
    const rows = pendingSnapshot.map(line => ({
      fingerprint: line.fingerprint,
      origin: line.origin,
      source_id: line.source_id,
      source_line_id: line.source_line_id || null,
      period: line.period,
      payment_date: line.payment_date,
      worker_id: line.worker_id || null,
      worker_name: line.worker_name || null,
      client_id: line.client_id || null,
      client: line.client,
      ceco: line.ceco || null,
      campaign: line.campaign || null,
      province: line.province || null,
      concept: line.concept,
      amount: line.amount,
      status: "calculado",
      created_by_user_id: actor?.id || null,
      created_by_user_name: actor?.display_name || null,
      payload: line.payload || {}
    }));
    const { error } = await supabase.from("payment_ledger").upsert(rows, { onConflict: "fingerprint" });
    if (error) { setMessage(`No se pudo guardar el snapshot: ${error.message}`); return; }
    setMessage(`${rows.length} líneas guardadas en el ledger de pagos.`);
    await load();
  }

  function exportLines() {
    downloadCsv("auditoria_pagos_lineas.csv", [["Origen", "Periodo", "Fecha", "Trabajador", "Cliente", "CECO", "Campaña", "Provincia", "Concepto", "Importe", "Estado", "Fingerprint"], ...filteredLines.map(line => [line.origin, line.period, line.payment_date, line.worker_name, line.client, line.ceco, line.campaign, line.province, line.concept, line.amount, line.status, line.fingerprint])]);
  }

  if (!session?.active) return <main className="min-h-screen bg-slate-100 p-4 text-slate-900"><section className="mx-auto max-w-5xl rounded-3xl border bg-white p-5 shadow-sm">Inicia sesión para ver la auditoría de pagos.</section></main>;
  if (!canAccessModule(session, "pagos")) return <main className="min-h-screen bg-slate-100 p-4 text-slate-900"><section className="mx-auto max-w-5xl rounded-3xl border bg-white p-5 shadow-sm">No tienes permiso para ver pagos.</section></main>;

  return <main className="min-h-screen bg-slate-100 p-4 text-slate-900"><section className="mx-auto max-w-7xl space-y-5"><div><a href="/" className="text-sm text-slate-500">← Volver</a><h1 className="mt-2 text-3xl font-bold">Auditoría de pagos</h1><p className="text-sm text-slate-500">Control cruzado de Servicios, Grandes Campañas e ISDIN preventivo. Vista: {sessionProvinceLabel(session)}.</p></div>{message && <div className="rounded-2xl border bg-emerald-50 p-3 text-sm text-emerald-800">{message}</div>}<div className="rounded-3xl border bg-white p-5 shadow-sm"><div className="grid gap-3 md:grid-cols-6"><label><span className="text-xs text-slate-500">Desde</span><input className="mt-1 w-full rounded-xl border px-3 py-2" type="date" value={from} onChange={event => setFrom(event.target.value)} /></label><label><span className="text-xs text-slate-500">Hasta</span><input className="mt-1 w-full rounded-xl border px-3 py-2" type="date" value={to} onChange={event => setTo(event.target.value)} /></label><label><span className="text-xs text-slate-500">Origen</span><select className="mt-1 w-full rounded-xl border bg-white px-3 py-2" value={origin} onChange={event => setOrigin(event.target.value)}><option value="">Todos</option><option value="servicio">Servicios</option><option value="gran_campana">Grandes Campañas</option></select></label><label><span className="text-xs text-slate-500">Trabajador</span><select className="mt-1 w-full rounded-xl border bg-white px-3 py-2" value={worker} onChange={event => setWorker(event.target.value)}><option value="">Todos</option>{workers.map(([id, name]) => <option key={String(id)} value={String(id)}>{name}</option>)}</select></label><button onClick={load} className="self-end rounded-2xl border bg-white px-4 py-2">Actualizar</button><button onClick={exportLines} className="self-end rounded-2xl border bg-white px-4 py-2">Exportar líneas</button></div><div className="mt-3 flex flex-wrap gap-2"><button onClick={saveSnapshot} className="rounded-2xl bg-slate-900 px-4 py-2 text-white">Guardar snapshot ledger</button><button onClick={normalize} className="rounded-2xl border bg-white px-4 py-2">Normalizar Servicios</button></div></div><div className="grid gap-3 md:grid-cols-5"><K label="Total filtrado" value={eur(summary.total)} /><K label="Líneas" value={summary.count} /><K label="Pendientes ledger" value={pendingSnapshot.length} /><K label="Avisos críticos/altos" value={(severityCounts.critico || 0) + (severityCounts.alto || 0)} /><K label="Ledger histórico" value={periodLedger.length} /></div><div className="grid gap-4 lg:grid-cols-3"><Box title="Por origen">{Object.entries(summary.byOrigin).length ? Object.entries(summary.byOrigin).map(([key, value]) => <RowLine key={key} label={key} value={eur(value)} />) : <p className="text-sm text-slate-500">Sin líneas en el periodo.</p>}</Box><Box title="Por trabajador">{Object.entries(summary.byWorker).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([key, value]) => <RowLine key={key} label={key} value={eur(value)} />)}</Box><Box title="Avisos">{["critico", "alto", "medio", "bajo"].map(key => <RowLine key={key} label={key} value={severityCounts[key] || 0} />)}</Box></div><Box title="Líneas de pago calculadas">{loading ? <p>Cargando...</p> : filteredLines.length === 0 ? <p className="text-sm text-slate-500">Sin pagos en el periodo.</p> : <div className="overflow-auto"><table className="w-full min-w-[1000px] text-sm"><thead><tr className="bg-slate-50"><th className="p-2 text-left">Origen</th><th>Fecha</th><th>Trabajador</th><th>Cliente</th><th>Campaña</th><th>Concepto</th><th className="text-right">Importe</th><th>Ledger</th></tr></thead><tbody>{filteredLines.map(line => <tr key={line.fingerprint} className="border-t"><td className="p-2">{line.origin}</td><td>{line.payment_date}</td><td>{line.worker_name}</td><td>{line.client}</td><td>{line.campaign}</td><td>{line.concept}</td><td className="text-right font-semibold">{eur(line.amount)}</td><td>{ledgerFingerprints.has(line.fingerprint) ? "Guardado" : "Pendiente"}</td></tr>)}</tbody></table></div>}</Box><Box title="Avisos de auditoría">{issues.length === 0 ? <p className="text-sm text-emerald-700">No se detectan avisos.</p> : <div className="space-y-2">{issues.map((issue, index) => <div key={`${issue.origin}-${issue.entity}-${index}`} className={`rounded-2xl border p-3 text-sm ${issue.severity === "critico" ? "border-red-200 bg-red-50" : issue.severity === "alto" ? "border-orange-200 bg-orange-50" : "bg-white"}`}><div className="flex flex-wrap items-center gap-2"><b className="uppercase">{issue.severity}</b><span className="text-slate-500">{issue.origin} · {issue.entity}</span></div><p className="mt-1">{issue.description}</p><p className="mt-1 text-xs text-slate-500">{issue.action}</p></div>)}</div>}</Box></section></main>;
}

function K({ label, value }: { label: string; value: any }) { return <div className="rounded-3xl border bg-white p-5 shadow-sm"><p className="text-sm text-slate-500">{label}</p><p className="text-2xl font-bold">{value}</p></div>; }
function Box({ title, children }: { title: string; children: any }) { return <div className="rounded-3xl border bg-white p-5 shadow-sm"><h2 className="mb-3 text-lg font-semibold">{title}</h2>{children}</div>; }
function RowLine({ label, value }: { label: string; value: any }) { return <div className="flex justify-between gap-3 border-b py-2 text-sm"><span className="capitalize text-slate-500">{label.replace("_", " ")}</span><b>{value}</b></div>; }

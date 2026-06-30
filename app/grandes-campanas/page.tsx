"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, ArrowLeft, CheckCircle2, CreditCard, FileDown, Package, Plus, Trash2, Users } from "lucide-react";
import { isSupabaseConfigured, supabase } from "@/lib/supabase";
import { AppSession, canAccessModule, filterBySessionProvince, getCurrentAppSession, isAdminSession, sessionProvinceLabel, userCanSeeProvince } from "@/lib/access-control";
import { provinceOptions } from "@/lib/provinces";

type Client = { id: string; name: string; ceco?: string | null };
type Worker = { id: string; name: string; phone?: string | null; province?: string | null };
type BigPoint = {
  id: string;
  big_campaign_id?: string | null;
  worker_id?: string | null;
  worker_name?: string | null;
  name: string;
  address?: string | null;
  province?: string | null;
  fee: number;
  original_fee?: number | null;
  incident_fee?: number | null;
  report_code?: string | null;
  notes?: string | null;
  point_status?: string | null;
  point_comment?: string | null;
  incident_status?: string | null;
  incident_comment?: string | null;
  incident_opened_at?: string | null;
  incident_resolved_at?: string | null;
  incident_next_action?: string | null;
  incident_due_date?: string | null;
  reported_at?: string | null;
  finished_at?: string | null;
  validated_at?: string | null;
};
type BigCampaign = {
  id: string;
  client_id?: string | null;
  client: string;
  ceco?: string | null;
  name: string;
  province?: string | null;
  start_date?: string | null;
  deadline?: string | null;
  reporting_channel?: string | null;
  calendar_color?: string | null;
  status?: string | null;
  payment_type?: string | null;
  hourly_rate?: number | null;
  default_point_fee?: number | null;
  instructions?: string | null;
  notes?: string | null;
  points?: BigPoint[];
};

type LocalData = { clients: Client[]; workers: Worker[]; campaigns: BigCampaign[] };

const INCIDENT_FEE = 8.56;
const localKey = "merchanops_big_campaigns_local_v2";
const provinces = ["", ...provinceOptions];
const campaignStatuses = ["Activa", "En ejecución", "Reportada", "Validada", "Cerrada", "Pausada"];
const pointStatuses = ["Pendiente", "Revisado", "Reportado", "Incidencia", "Pospuesto", "Finalizado", "Pendiente recepción post-incidencia"];
const payableFailedPointStatuses = ["Incidencia", "Pospuesto"];
const colors: Record<string, string> = { slate: "#0f172a", blue: "#2563eb", sky: "#0284c7", violet: "#7c3aed", pink: "#db2777", orange: "#ea580c", green: "#16a34a", amber: "#d97706", red: "#dc2626", teal: "#0d9488" };
const colorLabels: Record<string, string> = { slate: "Gris", blue: "Azul", sky: "Celeste", violet: "Violeta", pink: "Rosa", orange: "Naranja", green: "Verde", amber: "Ámbar", red: "Rojo", teal: "Turquesa" };

function uid() { return typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : String(Date.now() + Math.random()); }
function nowISO() { return new Date().toISOString(); }
function dateOnly(v?: string | null) { return v ? v.slice(0, 10) : ""; }
function eur(v: number) { return new Intl.NumberFormat("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(v || 0)) + " €"; }
function statusOf(p: BigPoint) { return p.point_status || "Pendiente"; }
function isPayableFailedStatus(status: string) { return payableFailedPointStatuses.includes(status); }
function isPostIncidentPending(p: BigPoint) { return statusOf(p) === "Pendiente recepción post-incidencia"; }
function isIncidentActive(p: BigPoint) { return isPayableFailedStatus(statusOf(p)) && p.incident_status !== "Resuelta" && !p.incident_resolved_at; }
function isIncidentResolved(p: BigPoint) { return p.incident_status === "Resuelta" || !!p.incident_resolved_at; }
function originalFee(p: BigPoint) { return Number(p.original_fee ?? p.fee ?? 0); }
function payable(p: BigPoint) { const incident = Number(p.incident_fee || INCIDENT_FEE); const original = Number(p.original_fee || 0); if (isPostIncidentPending(p)) return 0; if (isIncidentActive(p)) return incident; if (isIncidentResolved(p)) return original ? original + incident : Number(p.fee || 0); return Number(p.fee || 0); }
function csvEscape(v: unknown) { const s = String(v ?? ""); return s.includes(";") || s.includes("\n") || s.includes('"') ? `"${s.replace(/"/g, '""')}"` : s; }
function downloadCSV(name: string, rows: unknown[][]) { const blob = new Blob(["\ufeff" + rows.map(r => r.map(csvEscape).join(";")).join("\n")], { type: "text/csv;charset=utf-8;" }); const url = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = url; a.download = name; a.click(); URL.revokeObjectURL(url); }
function findWorkerByName(workers: Worker[], raw?: string) { const name = String(raw || "").trim(); if (!name) return null; return workers.find(w => String(w.name).trim() === name) || null; }
function parseBigPoints(text: string, defaultFee: number, workers: Worker[]): BigPoint[] { return text.split("\n").map(line => line.trim()).filter(Boolean).map(line => { const [name, address, fee, reportCode, province, workerName, ...notes] = line.split(";"); const worker = findWorkerByName(workers, workerName); const parsedFee = Number(fee || defaultFee || 0); return { id: uid(), name: name || "Punto sin nombre", address: address || "", fee: Number.isFinite(parsedFee) ? parsedFee : 0, report_code: reportCode || "", province: province || "", worker_id: worker?.id || null, worker_name: worker?.name || null, notes: notes.join(";") || "", point_status: "Pendiente", incident_fee: INCIDENT_FEE }; }); }
function loadLocal(): LocalData { try { const raw = localStorage.getItem(localKey); if (raw) return JSON.parse(raw); } catch {} return { clients: [], workers: [], campaigns: [] }; }

export default function GrandesCampanasPage() {
  const [clients, setClients] = useState<Client[]>([]);
  const [workers, setWorkers] = useState<Worker[]>([]);
  const [campaigns, setCampaigns] = useState<BigCampaign[]>([]);
  const [session] = useState<AppSession | null>(() => typeof window !== "undefined" ? getCurrentAppSession() : null);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState("");
  const [showNew, setShowNew] = useState(false);

  function saved(text = "Guardado") { setNotice(text); window.setTimeout(() => setNotice(""), 1300); }

  async function refresh() {
    setLoading(true);
    if (isSupabaseConfigured && supabase) {
      const scopedProvinces = !isAdminSession(session) ? (session?.provinces || []).filter(Boolean) : [];
      let workerQuery = supabase.from("workers").select("*").order("name");
      if (scopedProvinces.length) workerQuery = workerQuery.in("province", scopedProvinces);
      let pointQuery = supabase.from("big_campaign_points").select("*");
      if (scopedProvinces.length) pointQuery = pointQuery.in("province", scopedProvinces);
      const [{ data: c }, { data: w }, { data: bp }] = await Promise.all([
        supabase.from("clients").select("*").order("name"),
        workerQuery,
        pointQuery
      ]);
      const points = (bp || []) as BigPoint[], campaignIds = Array.from(new Set(points.map(p => p.big_campaign_id).filter(Boolean))) as string[];
      let bc: BigCampaign[] = [];
      if (isAdminSession(session)) {
        const { data } = await supabase.from("big_campaigns").select("*").order("deadline", { ascending: true });
        bc = (data || []) as BigCampaign[];
      } else if (campaignIds.length) {
        const { data } = await supabase.from("big_campaigns").select("*").in("id", campaignIds).order("deadline", { ascending: true });
        bc = (data || []) as BigCampaign[];
      }
      setClients((c || []) as Client[]);
      setWorkers((w || []) as Worker[]);
      setCampaigns(bc.map(camp => ({ ...camp, points: points.filter(p => p.big_campaign_id === camp.id) })));
    } else {
      const local = loadLocal(); setClients(local.clients); setWorkers(local.workers); setCampaigns(local.campaigns || []);
    }
    setLoading(false);
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { refresh(); }, []);
  useEffect(() => { if (!isSupabaseConfigured) localStorage.setItem(localKey, JSON.stringify({ clients, workers, campaigns })); }, [clients, workers, campaigns]);

  async function createCampaign(form: Omit<BigCampaign, "id">, points: BigPoint[]) {
    const clean = { ...form, client: String(form.client || "").trim(), name: String(form.name || "").trim(), status: form.status || "Activa", calendar_color: form.calendar_color || "blue" };
    if (!clean.client || !clean.name) { saved("Faltan cliente y nombre de campaña"); return; }
    if (!points.length) { saved("Añade al menos un punto"); return; }
    const scopedPoints = points.map(p => ({ ...p, province: p.province || clean.province || "" }));
    if (!isAdminSession(session)) {
      const provincesToCheck = Array.from(new Set([clean.province, ...scopedPoints.map(p => p.province)].filter(Boolean)));
      if (!provincesToCheck.length || provincesToCheck.some(province => !userCanSeeProvince(session, province))) { saved("No puedes crear grandes campañas fuera de tus provincias asignadas"); return; }
    }
    if (isSupabaseConfigured && supabase) {
      const { data, error } = await supabase.from("big_campaigns").insert({ ...clean, created_by_user_id: session?.id || null, created_by_user_name: session?.display_name || null }).select().single();
      if (error) { saved(error.message); return; }
      const inserted = data as BigCampaign;
      let insertedPoints: BigPoint[] = [];
      if (scopedPoints.length) {
        const { data: pointData, error: pointError } = await supabase.from("big_campaign_points").insert(scopedPoints.map(p => ({ big_campaign_id: inserted.id, worker_id: p.worker_id || null, worker_name: p.worker_name || null, name: p.name, address: p.address, province: p.province, fee: p.fee, report_code: p.report_code, notes: p.notes, point_status: p.point_status, incident_fee: INCIDENT_FEE }))).select();
        if (pointError) { await supabase.from("big_campaigns").delete().eq("id", inserted.id); saved(pointError.message); return; }
        insertedPoints = (pointData || []) as BigPoint[];
      }
      setCampaigns(prev => [{ ...inserted, points: insertedPoints }, ...prev]);
    } else setCampaigns(prev => [{ id: uid(), ...clean, points: scopedPoints } as BigCampaign, ...prev]);
    setShowNew(false); saved("Gran campaña creada");
  }

  async function updateCampaign(campaign: BigCampaign, patch: Partial<BigCampaign>) { setCampaigns(prev => prev.map(c => c.id === campaign.id ? { ...c, ...patch } : c)); if (isSupabaseConfigured && supabase) { const { points, ...dbPatch } = patch as any; await supabase.from("big_campaigns").update(dbPatch).eq("id", campaign.id); } saved(); }
  async function deleteCampaign(campaign: BigCampaign) { if (!confirm(`¿Borrar gran campaña ${campaign.client} · ${campaign.name}?`)) return; setCampaigns(prev => prev.filter(c => c.id !== campaign.id)); if (isSupabaseConfigured && supabase) await supabase.from("big_campaigns").delete().eq("id", campaign.id); saved("Gran campaña borrada"); }

  async function updatePoint(point: BigPoint, patch: Partial<BigPoint>) {
    const extra: Partial<BigPoint> = {};
    if (patch.point_status && isPayableFailedStatus(patch.point_status) && !isIncidentActive(point) && !isIncidentResolved(point)) { extra.original_fee = Number(point.original_fee ?? point.fee ?? 0); extra.incident_fee = INCIDENT_FEE; extra.fee = INCIDENT_FEE; extra.incident_status = "Abierta"; extra.incident_opened_at = nowISO(); }
    if (patch.point_status === "Pendiente recepción post-incidencia" && isIncidentActive(point)) { extra.fee = 0; extra.incident_status = null; }
    if (patch.point_status === "Reportado") extra.reported_at = nowISO();
    if (patch.point_status === "Finalizado") extra.finished_at = nowISO();
    const finalPatch = { ...patch, ...extra };
    setCampaigns(prev => prev.map(c => ({ ...c, points: (c.points || []).map(p => p.id === point.id ? { ...p, ...finalPatch } : p) })));
    if (isSupabaseConfigured && supabase) await supabase.from("big_campaign_points").update(finalPatch).eq("id", point.id);
    saved();
  }
  async function resolveIncident(point: BigPoint) { const finalFee = originalFee(point) + Number(point.incident_fee || INCIDENT_FEE); await updatePoint(point, { point_status: "Finalizado", incident_status: "Resuelta", incident_resolved_at: nowISO(), fee: finalFee, point_comment: point.point_comment || point.incident_comment || "Incidencia finalizada" }); saved("Incidencia finalizada y pago actualizado"); }
  async function addPoint(campaign: BigCampaign, raw: Omit<BigPoint, "id">) { const point = { ...raw, province: raw.province || campaign.province || "", name: String(raw.name || "").trim(), fee: Number.isFinite(Number(raw.fee)) ? Number(raw.fee) : 0, incident_fee: INCIDENT_FEE }; if (!point.name) { saved("Falta nombre del punto"); return; } if (!isAdminSession(session) && !userCanSeeProvince(session, point.province)) { saved("No puedes añadir puntos fuera de tus provincias asignadas"); return; } if (isSupabaseConfigured && supabase) { const { data, error } = await supabase.from("big_campaign_points").insert({ ...point, big_campaign_id: campaign.id }).select().single(); if (error) { saved(error.message); return; } setCampaigns(prev => prev.map(c => c.id === campaign.id ? { ...c, points: [...(c.points || []), data as BigPoint] } : c)); } else setCampaigns(prev => prev.map(c => c.id === campaign.id ? { ...c, points: [...(c.points || []), { id: uid(), ...point }] } : c)); saved("Punto añadido"); }
  async function deletePoint(point: BigPoint) { if (!confirm("¿Borrar punto?")) return; setCampaigns(prev => prev.map(c => ({ ...c, points: (c.points || []).filter(p => p.id !== point.id) }))); if (isSupabaseConfigured && supabase) await supabase.from("big_campaign_points").delete().eq("id", point.id); saved("Punto borrado"); }

  const canUsePage = canAccessModule(session, "servicios");
  const visibleCampaigns = useMemo(() => canUsePage ? filterBySessionProvince(campaigns, session) : [], [campaigns, session, canUsePage]);
  const visibleWorkers = useMemo(() => isAdminSession(session) ? workers : workers.filter(worker => userCanSeeProvince(session, worker.province)), [workers, session]);
  const stats = useMemo(() => { const pts = visibleCampaigns.flatMap(c => c.points || []); return { campaigns: visibleCampaigns.length, points: pts.length, assigned: pts.filter(p => p.worker_id).length, incidents: pts.filter(isIncidentActive).length, total: pts.reduce((a, p) => a + payable(p), 0) }; }, [visibleCampaigns]);

  return <main className="min-h-screen bg-slate-100 text-slate-900"><header className="sticky top-0 z-10 border-b bg-white"><div className="mx-auto flex max-w-7xl flex-col gap-3 px-4 py-4 md:flex-row md:items-center md:justify-between"><div><a href="/" className="mb-2 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-900"><ArrowLeft className="h-4 w-4" /> Volver al panel principal</a><h1 className="text-3xl font-bold">Grandes Campañas</h1><p className="text-sm text-slate-500">Gestión masiva de puntos, instaladores, incidencias y pagos por trabajador.</p><p className="text-xs text-slate-400">Vista: {sessionProvinceLabel(session)}</p></div>{canUsePage&&<button onClick={() => setShowNew(v => !v)} className="rounded-2xl bg-slate-900 px-4 py-2 text-white"><Plus className="mr-1 inline h-4 w-4" />Crear gran campaña</button>}</div></header><section className="mx-auto max-w-7xl space-y-5 p-4">{notice && <div className="fixed right-4 top-24 z-50 rounded-2xl border bg-emerald-50 px-4 py-2 text-sm shadow">{notice}</div>}{!canUsePage?<Card>No tienes permiso para acceder a Grandes Campañas.</Card>:<>{!isSupabaseConfigured && <div className="rounded-2xl border bg-amber-50 p-3 text-sm">Modo local sin conexión Supabase.</div>}<div className="grid gap-3 md:grid-cols-5"><Kpi label="Campañas" value={stats.campaigns} icon={Package} /><Kpi label="Puntos" value={stats.points} icon={CheckCircle2} /><Kpi label="Asignados" value={`${stats.assigned}/${stats.points}`} icon={Users} /><Kpi label="Incidencias" value={stats.incidents} icon={AlertTriangle} /><Kpi label="Total previsto" value={eur(stats.total)} icon={CreditCard} /></div>{showNew && <NewCampaignForm clients={clients} workers={visibleWorkers} save={createCampaign} session={session} />}{loading ? <Card>Cargando grandes campañas...</Card> : <CampaignList campaigns={visibleCampaigns} workers={visibleWorkers} updateCampaign={updateCampaign} updatePoint={updatePoint} resolveIncident={resolveIncident} addPoint={addPoint} deletePoint={deletePoint} deleteCampaign={deleteCampaign} />}</>}</section></main>;
}

function Card({ children }: { children: any }) { return <div className="rounded-3xl border bg-white p-5 shadow-sm">{children}</div>; }
function Kpi({ label, value, icon: Icon }: any) { return <Card><Icon className="mb-2 h-5 w-5" /><p className="text-sm text-slate-500">{label}</p><p className="text-2xl font-bold">{value}</p></Card>; }
function Input({ label, value, onChange, type = "text" }: any) { return <label className="block"><span className="text-sm font-medium">{label}</span><input type={type} value={value ?? ""} onChange={e => onChange(e.target.value)} className="w-full rounded-2xl border px-3 py-2" /></label>; }
function Textarea({ label, value, onChange, rows = 4 }: any) { return <label className="block"><span className="text-sm font-medium">{label}</span><textarea rows={rows} value={value ?? ""} onChange={e => onChange(e.target.value)} className="w-full rounded-2xl border px-3 py-2" /></label>; }
function Select({ label, value, onChange, options, labels = {} }: any) { return <label className="block"><span className="text-sm font-medium">{label}</span><select value={value ?? ""} onChange={e => onChange(e.target.value)} className="w-full rounded-2xl border bg-white px-3 py-2">{options.map((o: string) => <option key={o} value={o}>{labels[o] || o || "Seleccionar"}</option>)}</select></label>; }
function SelectMini({ value, onChange, options, labels = {} }: any) { return <select value={value ?? ""} onChange={e => onChange(e.target.value)} className="rounded-xl border bg-white px-2 py-1 text-sm">{options.map((o: string) => <option key={o} value={o}>{labels[o] || o || "Seleccionar"}</option>)}</select>; }
function Mini({ label, value }: any) { return <div className="rounded-xl bg-slate-50 p-2"><p className="text-slate-500">{label}</p><b>{value}</b></div>; }

function NewCampaignForm({ clients, workers, save, session }: any) {
  const provinceChoices = isAdminSession(session) ? provinces : ["", ...(session?.provinces || [])];
  const [form, setForm] = useState<any>({ client_id: "", client: "", ceco: "", name: "", province: provinceChoices[1] || "", start_date: "", deadline: "", reporting_channel: "WhatsApp", calendar_color: "blue", status: "Activa", payment_type: "Puntos", hourly_rate: 0, default_point_fee: 0, instructions: "", notes: "" });
  const [text, setText] = useState("Punto 1;Dirección;17;COD001;Provincia;Nombre exacto instalador;Notas");
  const points = parseBigPoints(text, Number(form.default_point_fee || 0), workers);
  const assigned = points.filter(p => p.worker_id).length;
  return <Card><div className="space-y-4"><h2 className="text-xl font-semibold">Nueva Gran Campaña</h2><div className="grid gap-3 md:grid-cols-3"><Select label="Cliente existente" value={form.client_id} onChange={(id: string) => { const c = clients.find((x: Client) => x.id === id); setForm({ ...form, client_id: id, client: c?.name || form.client, ceco: c?.ceco || form.ceco }); }} options={["", ...clients.map((c: Client) => c.id)]} labels={{ "": "Seleccionar", ...Object.fromEntries(clients.map((c: Client) => [c.id, c.name])) }} /><Input label="Cliente" value={form.client} onChange={(v: string) => setForm({ ...form, client: v })} /><Input label="CECO" value={form.ceco} onChange={(v: string) => setForm({ ...form, ceco: v })} /><Input label="Nombre campaña" value={form.name} onChange={(v: string) => setForm({ ...form, name: v })} /><Select label="Provincia" value={form.province} onChange={(v: string) => setForm({ ...form, province: v })} options={provinceChoices} labels={{ "": "Varias" }} /><Select label="Estado" value={form.status} onChange={(v: string) => setForm({ ...form, status: v })} options={campaignStatuses} /><Input label="Inicio" type="date" value={form.start_date} onChange={(v: string) => setForm({ ...form, start_date: v })} /><Input label="Límite" type="date" value={form.deadline} onChange={(v: string) => setForm({ ...form, deadline: v })} /><Select label="Color calendario" value={form.calendar_color} onChange={(v: string) => setForm({ ...form, calendar_color: v })} options={Object.keys(colors)} labels={colorLabels} /><Input label="Importe por defecto" type="number" value={form.default_point_fee} onChange={(v: string) => setForm({ ...form, default_point_fee: Number(v) })} /></div><Textarea label="Instrucciones generales" value={form.instructions} onChange={(v: string) => setForm({ ...form, instructions: v })} /><Textarea rows={8} label="Puntos masivos: Nombre;Dirección;Importe;Código de reporte;Provincia;Instalador;Notas" value={text} onChange={setText} /><div className="rounded-2xl bg-slate-50 p-3 text-sm">Puntos cargados: <b>{points.length}</b> · Asignados automáticamente: <b>{assigned}/{points.length}</b> · Total previsto: <b>{eur(points.reduce((a, p) => a + Number(p.fee || 0), 0))}</b></div><button onClick={() => save(form, points)} className="rounded-2xl bg-slate-900 px-4 py-2 text-white">Crear gran campaña</button></div></Card>;
}

function CampaignList({ campaigns, workers, updateCampaign, updatePoint, resolveIncident, addPoint, deletePoint, deleteCampaign }: any) {
  const [q, setQ] = useState(""); const [status, setStatus] = useState("");
  const filtered = campaigns.filter((c: BigCampaign) => (!q || [c.client, c.name, c.province, c.ceco].some(x => String(x || "").toLowerCase().includes(q.toLowerCase()))) && (!status || c.status === status));
  return <div className="space-y-4"><Card><div className="grid gap-2 md:grid-cols-2"><Input label="Buscar gran campaña" value={q} onChange={setQ} /><Select label="Estado campaña" value={status} onChange={setStatus} options={["", ...campaignStatuses]} labels={{ "": "Todos" }} /></div></Card>{filtered.length === 0 ? <Card>No hay grandes campañas con los filtros actuales.</Card> : filtered.map((c: BigCampaign) => <CampaignCard key={c.id} campaign={c} workers={workers} updateCampaign={updateCampaign} updatePoint={updatePoint} resolveIncident={resolveIncident} addPoint={addPoint} deletePoint={deletePoint} deleteCampaign={deleteCampaign} />)}</div>;
}

function CampaignCard({ campaign, workers, updateCampaign, updatePoint, resolveIncident, addPoint, deletePoint, deleteCampaign }: any) {
  const [text, setText] = useState(""); const [workerFilter, setWorkerFilter] = useState(""); const [statusFilter, setStatusFilter] = useState(""); const [provinceFilter, setProvinceFilter] = useState(""); const [codeFilter, setCodeFilter] = useState("");
  const [newPoint, setNewPoint] = useState<any>({ name: "", address: "", fee: 0, report_code: "", province: "", notes: "", point_status: "Pendiente" });
  const allPoints = campaign.points || [];
  const provinceOptions = Array.from(new Set(allPoints.map((p: BigPoint) => p.province).filter(Boolean))) as string[];
  const filtered = allPoints.filter((p: BigPoint) => { const hay = [p.name, p.address, p.report_code, p.province, p.worker_name, p.notes, statusOf(p), p.point_comment, p.incident_comment].join(" ").toLowerCase(); return (!text || hay.includes(text.toLowerCase())) && (!workerFilter || p.worker_id === workerFilter) && (!statusFilter || statusOf(p) === statusFilter) && (!provinceFilter || String(p.province || "") === provinceFilter) && (!codeFilter || String(p.report_code || "").toLowerCase().includes(codeFilter.toLowerCase())); });
  const total = filtered.reduce((a: number, p: BigPoint) => a + payable(p), 0); const assigned = allPoints.filter((p: BigPoint) => p.worker_id).length; const finished = allPoints.filter((p: BigPoint) => ["Finalizado", "Reportado"].includes(statusOf(p))).length; const incidents = allPoints.filter(isIncidentActive).length;
  const payByWorker = workers.map((w: Worker) => ({ worker: w, points: filtered.filter((p: BigPoint) => p.worker_id === w.id).length, total: filtered.filter((p: BigPoint) => p.worker_id === w.id).reduce((a: number, p: BigPoint) => a + payable(p), 0) })).filter((x: any) => x.points > 0);
  function exportCampaign() { downloadCSV(`gran_campana_${campaign.client}_${campaign.name}.csv`, [["Cliente", "Campaña", "Punto", "Dirección", "Código", "Provincia", "Instalador", "Estado", "Importe", "Notas"], ...filtered.map((p: BigPoint) => [campaign.client, campaign.name, p.name, p.address, p.report_code, p.province, p.worker_name, statusOf(p), payable(p), p.point_comment || p.incident_comment || p.notes])]); }
  return <Card><div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between"><div><h3 className="text-2xl font-semibold"><span className="mr-2 inline-block h-3 w-3 rounded-full" style={{ backgroundColor: colors[campaign.calendar_color || "blue"] || colors.blue }} />{campaign.client} · {campaign.name}</h3><p className="text-sm text-slate-500">{campaign.ceco || "Sin CECO"} · {campaign.province || "Varias provincias"} · {dateOnly(campaign.start_date) || "—"} → {dateOnly(campaign.deadline) || "—"}</p></div><div className="flex flex-wrap gap-2"><SelectMini value={campaign.status || "Activa"} onChange={(v: string) => updateCampaign(campaign, { status: v })} options={campaignStatuses} /><SelectMini value={campaign.calendar_color || "blue"} onChange={(v: string) => updateCampaign(campaign, { calendar_color: v })} options={Object.keys(colors)} labels={Object.fromEntries(Object.entries(colorLabels).map(([k, v]) => [k, `Color: ${v}`]))} /><button onClick={exportCampaign} className="rounded-xl border px-3 py-1 text-sm"><FileDown className="mr-1 inline h-4 w-4" />Exportar</button><button onClick={() => deleteCampaign(campaign)} className="rounded-xl border px-3 py-1 text-sm text-red-600"><Trash2 className="mr-1 inline h-4 w-4" />Borrar</button></div></div><div className="mt-4 grid gap-3 md:grid-cols-5"><Mini label="Puntos" value={allPoints.length} /><Mini label="Asignados" value={`${assigned}/${allPoints.length}`} /><Mini label="Finalizados" value={`${finished}/${allPoints.length}`} /><Mini label="Incidencias" value={incidents} /><Mini label="Total filtrado" value={eur(total)} /></div><div className="mt-4 rounded-2xl bg-slate-50 p-3"><div className="grid gap-2 md:grid-cols-5"><Input label="Filtrar cualquier campo" value={text} onChange={setText} /><Select label="Instalador" value={workerFilter} onChange={setWorkerFilter} options={["", ...workers.map((w: Worker) => w.id)]} labels={{ "": "Todos", ...Object.fromEntries(workers.map((w: Worker) => [w.id, w.name])) }} /><Select label="Estado punto" value={statusFilter} onChange={setStatusFilter} options={["", ...pointStatuses]} labels={{ "": "Todos" }} /><Select label="Provincia" value={provinceFilter} onChange={setProvinceFilter} options={["", ...provinceOptions]} labels={{ "": "Todas" }} /><Input label="Código reporte" value={codeFilter} onChange={setCodeFilter} /></div></div><div className="mt-4"><h4 className="mb-2 font-semibold">Pagos por trabajador</h4>{payByWorker.length === 0 ? <p className="text-sm text-slate-500">Sin puntos asignados con los filtros actuales.</p> : <div className="grid gap-2 md:grid-cols-3">{payByWorker.map((x: any) => <div key={x.worker.id} className="flex justify-between rounded-xl bg-slate-50 p-2 text-sm"><span>{x.worker.name} · {x.points} puntos</span><b>{eur(x.total)}</b></div>)}</div>}</div><div className="mt-4 overflow-auto"><table className="w-full min-w-[1200px] text-sm"><thead><tr className="bg-slate-50"><th className="p-2 text-left">Punto</th><th className="p-2 text-left">Dirección</th><th className="p-2 text-left">Código</th><th className="p-2 text-left">Provincia</th><th className="p-2 text-left">Instalador</th><th className="p-2 text-left">Estado</th><th className="p-2 text-left">Comentario / notas</th><th className="p-2 text-right">Pago</th><th className="p-2"></th></tr></thead><tbody>{filtered.map((p: BigPoint) => <tr key={p.id} className={`border-t align-top ${isIncidentActive(p) ? "bg-red-50" : ""}`}><td className="p-2 font-medium">{p.name}</td><td className="p-2 text-slate-600">{p.address}</td><td className="p-2 font-mono text-xs">{p.report_code}</td><td className="p-2">{p.province}</td><td className="p-2"><SelectMini value={p.worker_id || ""} onChange={(id: string) => { const w = workers.find((x: Worker) => x.id === id); updatePoint(p, { worker_id: id || null, worker_name: w?.name || null }); }} options={["", ...workers.map((w: Worker) => w.id)]} labels={{ "": "Sin asignar", ...Object.fromEntries(workers.map((w: Worker) => [w.id, w.name])) }} /></td><td className="p-2"><SelectMini value={statusOf(p)} onChange={(v: string) => updatePoint(p, { point_status: v })} options={pointStatuses} /></td><td className="p-2"><input className="w-full rounded-xl border px-2 py-1" value={p.point_comment || p.incident_comment || p.notes || ""} onChange={e => updatePoint(p, { point_comment: e.target.value, incident_comment: isIncidentActive(p) ? e.target.value : p.incident_comment })} />{isIncidentActive(p) && <button onClick={() => resolveIncident(p)} className="mt-1 rounded-xl border px-2 py-1 text-xs">Finalizar incidencia</button>}</td><td className="p-2 text-right font-semibold">{eur(payable(p))}{isIncidentActive(p) && <p className="text-xs font-normal text-slate-500">Original {eur(originalFee(p))}</p>}</td><td className="p-2"><button onClick={() => deletePoint(p)} className="text-red-600"><Trash2 className="h-4 w-4" /></button></td></tr>)}</tbody></table></div><div className="mt-4 rounded-2xl bg-slate-50 p-3"><h4 className="mb-2 font-semibold">Añadir punto manual</h4><div className="grid gap-2 md:grid-cols-7"><Input label="Nombre" value={newPoint.name} onChange={(v: string) => setNewPoint({ ...newPoint, name: v })} /><Input label="Dirección" value={newPoint.address} onChange={(v: string) => setNewPoint({ ...newPoint, address: v })} /><Input label="Importe" type="number" value={newPoint.fee} onChange={(v: string) => setNewPoint({ ...newPoint, fee: Number(v) })} /><Input label="Código" value={newPoint.report_code} onChange={(v: string) => setNewPoint({ ...newPoint, report_code: v })} /><Input label="Provincia" value={newPoint.province} onChange={(v: string) => setNewPoint({ ...newPoint, province: v })} /><Select label="Instalador" value={newPoint.worker_id || ""} onChange={(id: string) => { const w = workers.find((x: Worker) => x.id === id); setNewPoint({ ...newPoint, worker_id: id || null, worker_name: w?.name || null }); }} options={["", ...workers.map((w: Worker) => w.id)]} labels={{ "": "Sin asignar", ...Object.fromEntries(workers.map((w: Worker) => [w.id, w.name])) }} /><div className="flex items-end"><button className="rounded-xl border px-3 py-2" onClick={() => { addPoint(campaign, newPoint); setNewPoint({ name: "", address: "", fee: 0, report_code: "", province: "", notes: "", point_status: "Pendiente" }); }}>Añadir</button></div></div></div></Card>;
}

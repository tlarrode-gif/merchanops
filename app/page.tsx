"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, CreditCard, Edit3, FileDown, MessageCircle, Package, Plus, Search, Trash2, Users, X } from "lucide-react";
import { isSupabaseConfigured, supabase } from "@/lib/supabase";

type Client = { id: string; name: string; ceco?: string; notes?: string };
type Worker = { id: string; name: string; phone?: string; province?: string; capacity?: number; active_hours?: number; skills?: string };
type Point = { id: string; service_id?: string; name: string; address?: string; fee: number; report_code?: string; notes?: string; status?: string };
type Service = {
  id: string;
  client_id?: string;
  client: string;
  ceco?: string;
  campaign: string;
  province?: string;
  start_date?: string;
  deadline?: string;
  priority?: string;
  service_type?: string;
  reporting_channel?: string;
  worker_id?: string;
  worker_name?: string;
  status?: string;
  material_status?: string;
  tracking?: string;
  default_point_fee?: number;
  estimated_hours?: number;
  instructions?: string;
  communication_sent_at?: string;
  payment_included?: boolean;
  validated_at?: string;
  incident_note?: string;
  resolved_at?: string;
  points?: Point[];
};

const provinces = [
  "Asturias",
  "Huesca", "Teruel", "Zaragoza",
  "Alicante", "Castellón", "Valencia",
  "Lleida", "Sevilla", "Córdoba", "Jaén", "Almería"
];
const statuses = ["Pendiente asignar", "Asignado", "Info enviada", "Material pendiente", "Material recibido", "En ejecución", "Reportado", "Validado", "Incidencia", "Pagado"];
const reportChannels = ["App Merchanservis", "Adwise", "WhatsApp"];
const priorities = ["Baja", "Media", "Alta", "Urgente"];
const serviceTypes = ["Vinilo", "PLV", "Prospección", "Implantación", "Retirada", "Auditoría", "Mantenimiento", "Otro"];
const localKey = "merchanops_local_fallback_v2";

function uid() { return typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : String(Date.now() + Math.random()); }
function todayISO() { return new Date().toISOString(); }
function dateOnly(value?: string) { return value ? value.slice(0, 10) : ""; }
function isValidated(s: Service) { return s.status === "Validado" || s.status === "Pagado"; }
function isOverdue(s: Service) {
  if (!s.deadline || isValidated(s)) return false;
  const end = new Date(s.deadline + "T23:59:59");
  return end.getTime() < Date.now();
}
function csvEscape(value: unknown) {
  const s = String(value ?? "");
  return s.includes(";") || s.includes("\n") || s.includes('"') ? `"${s.replace(/"/g, '""')}"` : s;
}
function downloadCSV(filename: string, rows: unknown[][]) {
  const csv = rows.map((row) => row.map(csvEscape).join(";")).join("\n");
  const blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click(); URL.revokeObjectURL(url);
}
function parsePointsText(text: string, defaultFee = 0): Point[] {
  return text.split("\n").map((line) => line.trim()).filter(Boolean).map((line) => {
    const [name, address, fee, reportCode, ...notes] = line.split(";");
    return { id: uid(), name: name || "Punto sin nombre", address: address || "", fee: Number(fee || defaultFee || 0), report_code: reportCode || "", notes: notes.join(";") || "", status: "Pendiente" };
  });
}
function buildWhatsApp(service: Service) {
  const points = service.points || [];
  const list = points.map((p, i) => `${i + 1}. ${p.name} — ${p.address || "Dirección pendiente"}${p.report_code ? ` — Código reporte: ${p.report_code}` : ""}`).join("\n");
  return `*${service.client.toUpperCase()} – ${service.campaign}*\n\nTienes asignado este servicio en *${service.province || "zona pendiente"}*.\n\n*CECO:* ${service.ceco || "Sin CECO"}\n*Tipo:* ${service.service_type || "Otro"}\n*Prioridad:* ${service.priority || "Media"}\n*Total de puntos:* ${points.length}\n*Fecha inicio:* ${service.start_date || "Pendiente"}\n*Fecha límite:* ${service.deadline || "Pendiente"}\n*Reporte:* ${service.reporting_channel || "WhatsApp"}\n*Material:* ${service.material_status || "Pendiente"}${service.tracking ? ` — Tracking: ${service.tracking}` : ""}\n\n*Puntos a visitar:*\n${list}\n\n*Indicaciones:*\n${service.instructions || "Revisar briefing y reportar al finalizar."}\n\nConfirma recepción del servicio y avisa si hay incidencias.`;
}

const demoClients: Client[] = [{ id: uid(), name: "Revlon", ceco: "CECO-REVLON", notes: "Cliente demo" }, { id: uid(), name: "Banc Sabadell", ceco: "CECO-SABADELL", notes: "Cliente demo" }];
const demoWorkers: Worker[] = [{ id: uid(), name: "Ignacio", phone: "+34600000001", province: "Sevilla", capacity: 40, active_hours: 8, skills: "Vinilo, PLV" }];
type LocalData = { clients: Client[]; workers: Worker[]; services: Service[] };
function loadLocal(): LocalData { try { const raw = localStorage.getItem(localKey); if (raw) return JSON.parse(raw); } catch {} return { clients: demoClients, workers: demoWorkers, services: [] }; }

export default function Home() {
  const [tab, setTab] = useState("panel");
  const [clients, setClients] = useState<Client[]>([]);
  const [workers, setWorkers] = useState<Worker[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState("");
  const [editingClient, setEditingClient] = useState<Client | null>(null);
  const [editingWorker, setEditingWorker] = useState<Worker | null>(null);

  async function refresh() {
    setLoading(true);
    if (isSupabaseConfigured && supabase) {
      const [{ data: c }, { data: w }, { data: s }, { data: p }] = await Promise.all([
        supabase.from("clients").select("*").order("name"),
        supabase.from("workers").select("*").order("name"),
        supabase.from("services").select("*").order("created_at", { ascending: false }),
        supabase.from("points").select("*")
      ]);
      const points = (p || []) as Point[];
      setClients((c || []) as Client[]);
      setWorkers((w || []) as Worker[]);
      setServices(((s || []) as Service[]).map((service) => ({ ...service, points: points.filter((point) => point.service_id === service.id) })));
    } else {
      const local = loadLocal(); setClients(local.clients); setWorkers(local.workers); setServices(local.services);
    }
    setLoading(false);
  }
  useEffect(() => { refresh(); }, []);
  function saveLocal(next: Partial<LocalData>) { const merged = { clients, workers, services, ...next }; localStorage.setItem(localKey, JSON.stringify(merged)); }

  async function addClient(client: Omit<Client, "id">) { if (isSupabaseConfigured && supabase) await supabase.from("clients").insert(client); else { const next = [{ id: uid(), ...client }, ...clients]; setClients(next); saveLocal({ clients: next }); } setNotice("Cliente creado"); refresh(); }
  async function updateClient(client: Client) { if (isSupabaseConfigured && supabase) await supabase.from("clients").update({ name: client.name, ceco: client.ceco, notes: client.notes }).eq("id", client.id); else { const next = clients.map(c => c.id === client.id ? client : c); setClients(next); saveLocal({ clients: next }); } setEditingClient(null); setNotice("Cliente actualizado"); refresh(); }
  async function deleteClient(client: Client) { if (!confirm(`¿Borrar cliente ${client.name}?`)) return; if (isSupabaseConfigured && supabase) await supabase.from("clients").delete().eq("id", client.id); else { const next = clients.filter(c => c.id !== client.id); setClients(next); saveLocal({ clients: next }); } setNotice("Cliente borrado"); refresh(); }

  async function addWorker(worker: Omit<Worker, "id">) { if (isSupabaseConfigured && supabase) await supabase.from("workers").insert(worker); else { const next = [{ id: uid(), ...worker }, ...workers]; setWorkers(next); saveLocal({ workers: next }); } setNotice("Trabajador creado"); refresh(); }
  async function updateWorker(worker: Worker) { if (isSupabaseConfigured && supabase) await supabase.from("workers").update({ name: worker.name, phone: worker.phone, province: worker.province, capacity: worker.capacity, active_hours: worker.active_hours, skills: worker.skills }).eq("id", worker.id); else { const next = workers.map(w => w.id === worker.id ? worker : w); setWorkers(next); saveLocal({ workers: next }); } setEditingWorker(null); setNotice("Trabajador actualizado"); refresh(); }
  async function deleteWorker(worker: Worker) { if (!confirm(`¿Borrar trabajador ${worker.name}?`)) return; if (isSupabaseConfigured && supabase) await supabase.from("workers").delete().eq("id", worker.id); else { const next = workers.filter(w => w.id !== worker.id); setWorkers(next); saveLocal({ workers: next }); } setNotice("Trabajador borrado"); refresh(); }

  async function addService(service: Omit<Service, "id">, points: Point[]) {
    if (isSupabaseConfigured && supabase) {
      const { data, error } = await supabase.from("services").insert(service).select().single();
      if (error) { setNotice(error.message); return; }
      if (points.length) await supabase.from("points").insert(points.map((p) => ({ service_id: (data as any).id, name: p.name, address: p.address, fee: p.fee, report_code: p.report_code, notes: p.notes, status: p.status })));
    } else { const next = [{ id: uid(), ...service, points } as Service, ...services]; setServices(next); saveLocal({ services: next }); }
    setNotice("Servicio creado"); refresh();
  }
  async function updateService(service: Service, patch: Partial<Service>) {
    const nextPatch: any = { ...patch };
    if (patch.status === "Validado" && !service.validated_at) nextPatch.validated_at = todayISO();
    if (patch.status && patch.status !== "Validado") nextPatch.validated_at = patch.status === "Pagado" ? service.validated_at : null;
    if (patch.status === "Incidencia" && !service.incident_note) nextPatch.incident_note = service.incident_note || "Pendiente de detallar";
    if (isSupabaseConfigured && supabase) { const { points, ...dbPatch } = nextPatch; await supabase.from("services").update(dbPatch).eq("id", service.id); }
    else { const next = services.map((s) => s.id === service.id ? { ...s, ...nextPatch } : s); setServices(next); saveLocal({ services: next }); }
    refresh();
  }
  async function deleteService(service: Service) { if (!confirm(`¿Borrar servicio ${service.client} · ${service.campaign}?`)) return; if (isSupabaseConfigured && supabase) await supabase.from("services").delete().eq("id", service.id); else { const next = services.filter((s) => s.id !== service.id); setServices(next); saveLocal({ services: next }); } setNotice("Servicio eliminado"); refresh(); }

  const filteredServices = useMemo(() => { const q = query.toLowerCase(); return services.filter((s) => [s.client, s.ceco, s.campaign, s.province, s.worker_name, s.status].some((x) => String(x || "").toLowerCase().includes(q))); }, [services, query]);
  const overdue = services.filter(isOverdue);
  const incidents = services.filter(s => s.status === "Incidencia" && !s.resolved_at);
  const stats = { services: services.length, points: services.reduce((sum, s) => sum + (s.points?.length || 0), 0), unassigned: services.filter((s) => !s.worker_id).length, pendingMaterial: services.filter((s) => s.material_status !== "Recibido").length, overdue: overdue.length, incidents: incidents.length, payable: services.filter(isValidated).reduce((sum, s) => sum + (s.points?.length || 0), 0) };

  function exportWorkers() { const rows: unknown[][] = [["Nombre", "Teléfono", "Provincia", "Capacidad", "Horas comprometidas", "Especialidades"]]; workers.forEach((w) => rows.push([w.name, w.phone || "", w.province || "", w.capacity || 0, w.active_hours || 0, w.skills || ""])); downloadCSV("trabajadores_merchanops.csv", rows); }

  return <main className="min-h-screen bg-slate-100 text-slate-900"><header className="sticky top-0 z-10 border-b bg-white"><div className="mx-auto flex max-w-7xl flex-col gap-4 px-4 py-4 md:flex-row md:items-center md:justify-between"><div><h1 className="text-3xl font-bold">MerchanOps V2</h1><p className="text-sm text-slate-500">Servicios, validaciones, incidencias, CECO y pagos.</p></div><div className="flex flex-wrap gap-2"><button onClick={() => setTab("nuevo-servicio")} className="rounded-2xl bg-slate-900 px-4 py-2 text-white"><Plus className="mr-2 inline h-4 w-4" />Nuevo servicio</button><button onClick={() => setTab("nuevo-cliente")} className="rounded-2xl border bg-white px-4 py-2">Nuevo cliente</button><button onClick={() => setTab("nuevo-trabajador")} className="rounded-2xl border bg-white px-4 py-2">Nuevo trabajador</button></div></div></header><section className="mx-auto max-w-7xl space-y-5 p-4">{notice && <div className="rounded-2xl border bg-emerald-50 p-3 text-sm text-emerald-800">{notice}</div>}{!isSupabaseConfigured && <div className="rounded-2xl border bg-amber-50 p-3 text-sm text-amber-800">Modo demo local: faltan las claves de Supabase en Vercel.</div>}<nav className="flex flex-wrap gap-2">{[["panel", "Panel"], ["servicios", "Servicios"], ["clientes", "Clientes"], ["trabajadores", "Trabajadores"], ["pagos", "Pagos"]].map(([id, label]) => <button key={id} onClick={() => setTab(id)} className={`rounded-2xl px-4 py-2 ${tab === id ? "bg-slate-900 text-white" : "border bg-white"}`}>{label}</button>)}</nav>{loading && <div className="rounded-2xl bg-white p-6">Cargando...</div>}{!loading && tab === "panel" && <Panel stats={stats} overdue={overdue} incidents={incidents} updateService={updateService} />}{!loading && tab === "servicios" && <Services services={filteredServices} workers={workers} query={query} setQuery={setQuery} updateService={updateService} deleteService={deleteService} />}{!loading && tab === "clientes" && <Clients clients={clients} edit={setEditingClient} del={deleteClient} />}{!loading && tab === "trabajadores" && <Workers workers={workers} services={services} exportWorkers={exportWorkers} edit={setEditingWorker} del={deleteWorker} />}{!loading && tab === "pagos" && <Payments services={services} />}{!loading && tab === "nuevo-cliente" && <ClientForm addClient={addClient} />}{!loading && tab === "nuevo-trabajador" && <WorkerForm addWorker={addWorker} />}{!loading && tab === "nuevo-servicio" && <ServiceForm clients={clients} workers={workers} addService={addService} />}</section>{editingClient && <Modal title="Editar cliente" onClose={() => setEditingClient(null)}><ClientEditor value={editingClient} save={updateClient} /></Modal>}{editingWorker && <Modal title="Editar trabajador" onClose={() => setEditingWorker(null)}><WorkerEditor value={editingWorker} save={updateWorker} /></Modal>}</main>;
}

function Panel({ stats, overdue, incidents, updateService }: any) { const cards = [["Servicios", stats.services, CheckCircle2], ["Puntos", stats.points, Package], ["Sin asignar", stats.unassigned, AlertTriangle], ["Material pendiente", stats.pendingMaterial, Package], ["Fuera de plazo", stats.overdue, AlertTriangle], ["Incidencias", stats.incidents, AlertTriangle], ["Puntos pagables", stats.payable, CreditCard]]; return <div className="space-y-5"><div className="grid gap-4 md:grid-cols-4">{cards.map(([label, value, Icon]: any) => <div key={label} className="rounded-3xl border bg-white p-5 shadow-sm"><Icon className="mb-3 h-6 w-6" /><p className="text-sm text-slate-500">{label}</p><p className="text-3xl font-bold">{value}</p></div>)}</div><PanelList title="Avisos: fuera de plazo sin validar" items={overdue} empty="No hay servicios fuera de plazo." updateService={updateService} /><PanelList title="Incidencias pendientes" items={incidents} empty="No hay incidencias pendientes." updateService={updateService} incidents /></div>; }
function PanelList({ title, items, empty, updateService, incidents = false }: any) { return <div className="rounded-3xl border bg-white p-5"><h2 className="mb-3 text-lg font-semibold">{title}</h2>{items.length === 0 && <p className="text-sm text-slate-500">{empty}</p>}{items.map((s: Service) => <div key={s.id} className="border-t py-3"><p className="font-semibold">{s.client} · {s.campaign}</p><p className="text-sm text-slate-500">{s.province} · límite {s.deadline || "sin fecha"} · {s.worker_name || "sin trabajador"}</p>{incidents && <textarea className="mt-2 w-full rounded-xl border p-2 text-sm" value={s.incident_note || ""} onChange={(e) => updateService(s, { incident_note: e.target.value })} placeholder="Describe la incidencia pendiente..." />}{incidents && <button className="mt-2 rounded-xl border px-3 py-1 text-sm" onClick={() => updateService(s, { resolved_at: todayISO(), status: "Reportado" })}>Marcar incidencia resuelta</button>}</div>)}</div>; }

function Services({ services, workers, query, setQuery, updateService, deleteService }: any) { return <div className="space-y-4"><div className="flex items-center gap-2 rounded-2xl border bg-white px-3 py-2"><Search className="h-4 w-4 text-slate-400" /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar servicio..." className="w-full outline-none" /></div>{services.map((s: Service) => <div key={s.id} className="rounded-3xl border bg-white p-5 shadow-sm"><div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between"><div><h3 className="text-xl font-semibold">{s.client} · {s.campaign}</h3><p className="text-sm text-slate-500">CECO: {s.ceco || "Sin CECO"} · {s.province} · {s.points?.length || 0} puntos · {s.reporting_channel}</p><p className="text-sm text-slate-500">Trabajador: {s.worker_name || "Sin asignar"} · Estado: {s.status} {s.validated_at ? `· Validado ${dateOnly(s.validated_at)}` : ""}</p>{s.incident_note && <p className="mt-1 text-sm text-red-700">Incidencia: {s.incident_note}</p>}</div><div className="flex flex-wrap gap-2"><select value={s.worker_id || ""} onChange={(e) => { const w = workers.find((x: Worker) => x.id === e.target.value); updateService(s, { worker_id: e.target.value, worker_name: w?.name || "", status: e.target.value ? "Asignado" : "Pendiente asignar" }); }} className="rounded-2xl border px-3 py-2"><option value="">Asignar</option>{workers.map((w: Worker) => <option key={w.id} value={w.id}>{w.name}</option>)}</select><select value={s.status || ""} onChange={(e) => updateService(s, { status: e.target.value })} className="rounded-2xl border px-3 py-2">{statuses.map((x) => <option key={x}>{x}</option>)}</select><button onClick={() => { const worker = workers.find((w: Worker) => w.id === s.worker_id); const msg = buildWhatsApp(s); if (worker?.phone) window.open(`https://wa.me/${worker.phone.replace(/[^0-9]/g, "")}?text=${encodeURIComponent(msg)}`, "_blank"); navigator.clipboard.writeText(msg); updateService(s, { communication_sent_at: todayISO(), status: "Info enviada" }); }} className="rounded-2xl border px-3 py-2"><MessageCircle className="mr-1 inline h-4 w-4" />WhatsApp</button><button onClick={() => deleteService(s)} className="rounded-2xl border px-3 py-2 text-red-600"><Trash2 className="h-4 w-4" /></button></div></div><table className="mt-4 w-full text-sm"><thead><tr className="bg-slate-50"><th className="p-2 text-left">Punto</th><th className="p-2 text-left">Dirección</th><th className="p-2 text-left">Código reporte</th><th className="p-2 text-right">Importe</th></tr></thead><tbody>{(s.points || []).map((p) => <tr key={p.id} className="border-t"><td className="p-2">{p.name}</td><td className="p-2">{p.address}</td><td className="p-2">{p.report_code}</td><td className="p-2 text-right">{Number(p.fee || 0).toFixed(2)} €</td></tr>)}</tbody></table></div>)}</div>; }
function Clients({ clients, edit, del }: any) { return <div className="grid gap-4 md:grid-cols-3">{clients.map((c: Client) => <div key={c.id} className="rounded-3xl border bg-white p-5"><h3 className="text-lg font-semibold">{c.name}</h3><p className="mt-2 rounded-2xl bg-slate-50 p-2 font-mono text-sm">{c.ceco || "Sin CECO"}</p><p className="mt-2 text-sm text-slate-500">{c.notes}</p><div className="mt-4 flex gap-2"><button onClick={() => edit(c)} className="rounded-xl border px-3 py-1 text-sm"><Edit3 className="mr-1 inline h-3 w-3" />Editar</button><button onClick={() => del(c)} className="rounded-xl border px-3 py-1 text-sm text-red-600"><Trash2 className="mr-1 inline h-3 w-3" />Borrar</button></div></div>)}</div>; }
function Workers({ workers, services, exportWorkers, edit, del }: any) { return <div className="space-y-4"><button onClick={exportWorkers} className="rounded-2xl bg-slate-900 px-4 py-2 text-white"><FileDown className="mr-2 inline h-4 w-4" />Exportar trabajadores</button><div className="grid gap-4 md:grid-cols-3">{workers.map((w: Worker) => <div key={w.id} className="rounded-3xl border bg-white p-5"><Users className="mb-3 h-5 w-5" /><h3 className="text-lg font-semibold">{w.name}</h3><p className="text-sm text-slate-500">{w.phone}</p><p className="text-sm text-slate-500">{w.province}</p><p className="mt-2 text-sm">{w.skills}</p><p className="mt-2 text-sm text-slate-500">Servicios asignados: {services.filter((s: Service) => s.worker_id === w.id).length}</p><div className="mt-4 flex gap-2"><button onClick={() => edit(w)} className="rounded-xl border px-3 py-1 text-sm"><Edit3 className="mr-1 inline h-3 w-3" />Editar</button><button onClick={() => del(w)} className="rounded-xl border px-3 py-1 text-sm text-red-600"><Trash2 className="mr-1 inline h-3 w-3" />Borrar</button></div></div>)}</div></div>; }
function Payments({ services }: any) { const [from, setFrom] = useState(""); const [to, setTo] = useState(""); const validServices = services.filter((s: Service) => isValidated(s) && s.validated_at && (!from || dateOnly(s.validated_at) >= from) && (!to || dateOnly(s.validated_at) <= to)); const rows: any[] = []; validServices.forEach((s: Service) => (s.points || []).forEach((p) => rows.push({ worker: s.worker_name || "Sin asignar", client: s.client, ceco: s.ceco || "", campaign: s.campaign, province: s.province || "", point: p.name, report_code: p.report_code || "", fee: Number(p.fee || 0), validated_at: dateOnly(s.validated_at) }))); const totals = rows.reduce((acc, row) => { const key = `${row.worker} · ${row.client}`; acc[key] = (acc[key] || 0) + row.fee; return acc; }, {} as Record<string, number>); function exportPayments() { const out: unknown[][] = [["Trabajador", "Cliente", "CECO", "Campaña", "Provincia", "Punto", "Código reporte", "Importe", "Fecha validación"]]; rows.forEach(r => out.push([r.worker, r.client, r.ceco, r.campaign, r.province, r.point, r.report_code, r.fee, r.validated_at])); downloadCSV("pagos_validados_merchanops.csv", out); } return <div className="space-y-4"><div className="rounded-3xl border bg-white p-5"><h2 className="mb-3 text-lg font-semibold">Filtro de pagos validados</h2><div className="grid gap-3 md:grid-cols-3"><Input label="Desde" type="date" value={from} onChange={setFrom} /><Input label="Hasta" type="date" value={to} onChange={setTo} /><div className="flex items-end"><button onClick={exportPayments} className="rounded-2xl bg-slate-900 px-4 py-2 text-white"><FileDown className="mr-2 inline h-4 w-4" />Exportar pagos</button></div></div><p className="mt-2 text-sm text-slate-500">Solo aparecen servicios marcados como Validado o Pagado.</p></div><div className="rounded-3xl border bg-white p-5"><h3 className="mb-3 text-lg font-semibold">Totales</h3>{Object.entries(totals).map(([k, v]) => <p key={k} className="border-t py-2">{k}: <strong>{Number(v).toFixed(2)} €</strong></p>)}</div><div className="overflow-auto rounded-3xl border bg-white p-5"><table className="w-full text-sm"><thead><tr><th className="p-2 text-left">Fecha</th><th className="p-2 text-left">Trabajador</th><th className="p-2 text-left">Cliente</th><th className="p-2 text-left">Punto</th><th className="p-2 text-left">Código</th><th className="p-2 text-right">Importe</th></tr></thead><tbody>{rows.map((r, i) => <tr key={i} className="border-t"><td className="p-2">{r.validated_at}</td><td className="p-2">{r.worker}</td><td className="p-2">{r.client}</td><td className="p-2">{r.point}</td><td className="p-2">{r.report_code}</td><td className="p-2 text-right">{r.fee.toFixed(2)} €</td></tr>)}</tbody></table></div></div>; }
function ClientForm({ addClient }: any) { const [name, setName] = useState(""); const [ceco, setCeco] = useState(""); const [notes, setNotes] = useState(""); return <div className="rounded-3xl border bg-white p-5"><h2 className="mb-4 text-xl font-semibold">Nuevo cliente</h2><div className="grid gap-3 md:grid-cols-2"><Input label="Cliente" value={name} onChange={setName} /><Input label="CECO fijo" value={ceco} onChange={setCeco} /><Textarea label="Notas" value={notes} onChange={setNotes} /></div><button onClick={() => addClient({ name, ceco, notes })} className="mt-4 rounded-2xl bg-slate-900 px-4 py-2 text-white">Guardar cliente</button></div>; }
function WorkerForm({ addWorker }: any) { const [worker, setWorker] = useState<any>({ name: "", phone: "", province: provinces[0], capacity: 40, active_hours: 0, skills: "" }); return <div className="rounded-3xl border bg-white p-5"><h2 className="mb-4 text-xl font-semibold">Nuevo trabajador</h2><WorkerFields worker={worker} setWorker={setWorker} /><button onClick={() => addWorker(worker)} className="mt-4 rounded-2xl bg-slate-900 px-4 py-2 text-white">Guardar trabajador</button></div>; }
function ServiceForm({ clients, workers, addService }: any) { const [form, setForm] = useState<any>({ client_id: "", client: "", ceco: "", campaign: "", province: provinces[0], start_date: "", deadline: "", priority: "Media", service_type: "Vinilo", reporting_channel: "WhatsApp", worker_id: "", worker_name: "", status: "Pendiente asignar", material_status: "Pendiente", tracking: "", default_point_fee: 0, estimated_hours: 1, instructions: "" }); const [pointsText, setPointsText] = useState("Punto 1;Dirección;17;COD001;Notas\nPunto 2;Dirección;22;COD002;Notas"); const points = parsePointsText(pointsText, Number(form.default_point_fee || 0)); return <div className="space-y-4 rounded-3xl border bg-white p-5"><h2 className="text-xl font-semibold">Nuevo servicio</h2><div className="grid gap-3 md:grid-cols-3"><Select label="Cliente existente" value={form.client_id} onChange={(v) => { const c = clients.find((x: Client) => x.id === v); setForm({ ...form, client_id: v, client: c?.name || "", ceco: c?.ceco || "" }); }} options={["", ...clients.map((c: Client) => c.id)]} labels={{ "": "Seleccionar", ...Object.fromEntries(clients.map((c: Client) => [c.id, `${c.name} · ${c.ceco || "Sin CECO"}`])) }} /><Input label="Cliente" value={form.client} onChange={(v) => setForm({ ...form, client: v })} /><Input label="CECO" value={form.ceco} onChange={(v) => setForm({ ...form, ceco: v })} /><Input label="Campaña" value={form.campaign} onChange={(v) => setForm({ ...form, campaign: v })} /><Select label="Provincia" value={form.province} onChange={(v) => setForm({ ...form, province: v })} options={provinces} /><Select label="Reporte" value={form.reporting_channel} onChange={(v) => setForm({ ...form, reporting_channel: v })} options={reportChannels} /><Input label="Inicio" type="date" value={form.start_date} onChange={(v) => setForm({ ...form, start_date: v })} /><Input label="Límite" type="date" value={form.deadline} onChange={(v) => setForm({ ...form, deadline: v })} /><Select label="Prioridad" value={form.priority} onChange={(v) => setForm({ ...form, priority: v })} options={priorities} /><Select label="Tipo" value={form.service_type} onChange={(v) => setForm({ ...form, service_type: v })} options={serviceTypes} /><Select label="Trabajador" value={form.worker_id} onChange={(v) => { const w = workers.find((x: Worker) => x.id === v); setForm({ ...form, worker_id: v, worker_name: w?.name || "", status: v ? "Asignado" : "Pendiente asignar" }); }} options={["", ...workers.map((w: Worker) => w.id)]} labels={{ "": "Sin asignar", ...Object.fromEntries(workers.map((w: Worker) => [w.id, w.name])) }} /><Input label="Pago por punto defecto" type="number" value={form.default_point_fee} onChange={(v) => setForm({ ...form, default_point_fee: Number(v) })} /><Input label="Tracking" value={form.tracking} onChange={(v) => setForm({ ...form, tracking: v })} /><Input label="Horas estimadas" type="number" value={form.estimated_hours} onChange={(v) => setForm({ ...form, estimated_hours: Number(v) })} /></div><Textarea label="Instrucciones" value={form.instructions} onChange={(v) => setForm({ ...form, instructions: v })} /><div><label className="mb-1 block text-sm font-medium">Puntos a visitar: Nombre;Dirección;Importe;Código de reporte;Notas</label><textarea value={pointsText} onChange={(e) => setPointsText(e.target.value)} rows={6} className="w-full rounded-2xl border p-3" /></div><div className="rounded-2xl bg-slate-50 p-3 text-sm">Se crearán {points.length} puntos. Total previsto: <strong>{points.reduce((s, p) => s + Number(p.fee || 0), 0).toFixed(2)} €</strong></div><button onClick={() => addService(form, points)} className="rounded-2xl bg-slate-900 px-4 py-2 text-white">Crear servicio</button></div>; }
function Modal({ title, children, onClose }: any) { return <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4"><div className="w-full max-w-2xl rounded-3xl bg-white p-5 shadow-2xl"><div className="mb-4 flex items-center justify-between"><h2 className="text-xl font-semibold">{title}</h2><button onClick={onClose}><X className="h-5 w-5" /></button></div>{children}</div></div>; }
function ClientEditor({ value, save }: any) { const [client, setClient] = useState(value); return <div className="space-y-3"><Input label="Cliente" value={client.name} onChange={(v) => setClient({ ...client, name: v })} /><Input label="CECO" value={client.ceco} onChange={(v) => setClient({ ...client, ceco: v })} /><Textarea label="Notas" value={client.notes} onChange={(v) => setClient({ ...client, notes: v })} /><button onClick={() => save(client)} className="rounded-2xl bg-slate-900 px-4 py-2 text-white">Guardar cambios</button></div>; }
function WorkerEditor({ value, save }: any) { const [worker, setWorker] = useState(value); return <div className="space-y-3"><WorkerFields worker={worker} setWorker={setWorker} /><button onClick={() => save(worker)} className="rounded-2xl bg-slate-900 px-4 py-2 text-white">Guardar cambios</button></div>; }
function WorkerFields({ worker, setWorker }: any) { return <div className="grid gap-3 md:grid-cols-2"><Input label="Nombre" value={worker.name} onChange={(v) => setWorker({ ...worker, name: v })} /><Input label="Teléfono" value={worker.phone} onChange={(v) => setWorker({ ...worker, phone: v })} /><Select label="Provincia" value={worker.province} onChange={(v) => setWorker({ ...worker, province: v })} options={provinces} /><Input label="Capacidad semanal" type="number" value={worker.capacity} onChange={(v) => setWorker({ ...worker, capacity: Number(v) })} /><Input label="Horas comprometidas" type="number" value={worker.active_hours} onChange={(v) => setWorker({ ...worker, active_hours: Number(v) })} /><Input label="Especialidades" value={worker.skills} onChange={(v) => setWorker({ ...worker, skills: v })} /></div>; }
function Input({ label, value, onChange, type = "text" }: any) { return <label className="block"><span className="mb-1 block text-sm font-medium">{label}</span><input type={type} value={value || ""} onChange={(e) => onChange(e.target.value)} className="w-full rounded-2xl border px-3 py-2" /></label>; }
function Textarea({ label, value, onChange }: any) { return <label className="block md:col-span-2"><span className="mb-1 block text-sm font-medium">{label}</span><textarea value={value || ""} onChange={(e) => onChange(e.target.value)} rows={4} className="w-full rounded-2xl border px-3 py-2" /></label>; }
function Select({ label, value, onChange, options, labels = {} }: any) { return <label className="block"><span className="mb-1 block text-sm font-medium">{label}</span><select value={value || ""} onChange={(e) => onChange(e.target.value)} className="w-full rounded-2xl border bg-white px-3 py-2">{options.map((option: string) => <option key={option} value={option}>{labels[option] || option || "Seleccionar"}</option>)}</select></label>; }

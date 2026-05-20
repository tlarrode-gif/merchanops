"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, Copy, CreditCard, FileDown, MessageCircle, Package, Plus, Search, Trash2, Users } from "lucide-react";
import * as XLSX from "xlsx";
import { isSupabaseConfigured, supabase } from "@/lib/supabase";

type Client = { id: string; name: string; ceco?: string; notes?: string };
type Worker = { id: string; name: string; phone?: string; province?: string; capacity?: number; active_hours?: number; skills?: string };
type Point = { id: string; service_id?: string; name: string; address?: string; fee: number; notes?: string; status?: string };
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
  points?: Point[];
};

const provinces = ["Asturias", "Aragón", "Comunidad Valenciana", "Lleida", "Sevilla", "Córdoba", "Jaén", "Almería"];
const statuses = ["Pendiente asignar", "Asignado", "Info enviada", "Material pendiente", "Material recibido", "En ejecución", "Reportado", "Validado", "Incluido en pago", "Pagado", "Incidencia"];
const reportChannels = ["App Merchanservis", "Adwise", "WhatsApp"];
const priorities = ["Baja", "Media", "Alta", "Urgente"];
const serviceTypes = ["Vinilo", "PLV", "Prospección", "Implantación", "Retirada", "Auditoría", "Mantenimiento", "Otro"];

function uid() {
  return typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : String(Date.now() + Math.random());
}

function csvEscape(value: unknown) {
  const s = String(value ?? "");
  if (s.includes(";") || s.includes("\n") || s.includes('"')) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function downloadCSV(filename: string, rows: unknown[][]) {
  const csv = rows.map((row) => row.map(csvEscape).join(";")).join("\n");
  const blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function parsePointsText(text: string, defaultFee = 0): Point[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [name, address, fee, ...notes] = line.split(";");
      return { id: uid(), name: name || "Punto sin nombre", address: address || "", fee: Number(fee || defaultFee || 0), notes: notes.join(";"), status: "Pendiente" };
    });
}

function buildWhatsApp(service: Service) {
  const points = service.points || [];
  const list = points.map((p, index) => `${index + 1}. ${p.name} — ${p.address || "Dirección pendiente"} — ${Number(p.fee || 0).toFixed(2)} €`).join("\n");
  return `*${service.client.toUpperCase()} – ${service.campaign}*\n\nTienes asignado este servicio en *${service.province || "zona pendiente"}*.\n\n*CECO:* ${service.ceco || "Sin CECO"}\n*Tipo:* ${service.service_type || "Otro"}\n*Prioridad:* ${service.priority || "Media"}\n*Total de puntos:* ${points.length}\n*Fecha inicio:* ${service.start_date || "Pendiente"}\n*Fecha límite:* ${service.deadline || "Pendiente"}\n*Reporte:* ${service.reporting_channel || "WhatsApp"}\n*Material:* ${service.material_status || "Pendiente"}${service.tracking ? ` — Tracking: ${service.tracking}` : ""}\n\n*Puntos a visitar:*\n${list}\n\n*Indicaciones:*\n${service.instructions || "Revisar briefing y reportar al finalizar."}\n\nConfirma recepción del servicio y avisa si hay incidencias.`;
}

const localKey = "merchanops_local_fallback";
const demoClients: Client[] = [
  { id: uid(), name: "Revlon", ceco: "CECO-REVLON", notes: "Cliente demo" },
  { id: uid(), name: "Banc Sabadell", ceco: "CECO-SABADELL", notes: "Cliente demo" }
];
const demoWorkers: Worker[] = [
  { id: uid(), name: "Ignacio", phone: "+34600000001", province: "Sevilla", capacity: 40, active_hours: 8, skills: "Vinilo, PLV" },
  { id: uid(), name: "Sara Álvarez", phone: "+34600000002", province: "Asturias", capacity: 30, active_hours: 6, skills: "Prospección" }
];

type LocalData = { clients: Client[]; workers: Worker[]; services: Service[] };

function loadLocal(): LocalData {
  try {
    const raw = localStorage.getItem(localKey);
    if (raw) return JSON.parse(raw);
  } catch {}
  return { clients: demoClients, workers: demoWorkers, services: [] };
}

export default function Home() {
  const [tab, setTab] = useState("panel");
  const [clients, setClients] = useState<Client[]>([]);
  const [workers, setWorkers] = useState<Worker[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState("");

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
      const local = loadLocal();
      setClients(local.clients);
      setWorkers(local.workers);
      setServices(local.services);
    }
    setLoading(false);
  }

  useEffect(() => { refresh(); }, []);

  function saveLocal(next: Partial<LocalData>) {
    const current = { clients, workers, services };
    const merged = { ...current, ...next };
    localStorage.setItem(localKey, JSON.stringify(merged));
  }

  async function addClient(client: Omit<Client, "id">) {
    if (isSupabaseConfigured && supabase) await supabase.from("clients").insert(client);
    else { const next = [{ id: uid(), ...client }, ...clients]; setClients(next); saveLocal({ clients: next }); }
    setNotice("Cliente creado");
    refresh();
  }

  async function addWorker(worker: Omit<Worker, "id">) {
    if (isSupabaseConfigured && supabase) await supabase.from("workers").insert(worker);
    else { const next = [{ id: uid(), ...worker }, ...workers]; setWorkers(next); saveLocal({ workers: next }); }
    setNotice("Trabajador creado");
    refresh();
  }

  async function addService(service: Omit<Service, "id">, points: Point[]) {
    if (isSupabaseConfigured && supabase) {
      const { data, error } = await supabase.from("services").insert(service).select().single();
      if (error) { setNotice(error.message); return; }
      const inserted = data as Service;
      if (points.length) await supabase.from("points").insert(points.map((p) => ({ service_id: inserted.id, name: p.name, address: p.address, fee: p.fee, notes: p.notes, status: p.status })));
    } else {
      const nextService = { id: uid(), ...service, points } as Service;
      const next = [nextService, ...services];
      setServices(next);
      saveLocal({ services: next });
    }
    setNotice("Servicio creado");
    refresh();
  }

  async function updateService(service: Service, patch: Partial<Service>) {
    if (isSupabaseConfigured && supabase) {
      const { points, ...dbPatch } = patch;
      await supabase.from("services").update(dbPatch).eq("id", service.id);
    } else {
      const next = services.map((s) => s.id === service.id ? { ...s, ...patch } : s);
      setServices(next);
      saveLocal({ services: next });
    }
    refresh();
  }

  async function deleteService(service: Service) {
    if (isSupabaseConfigured && supabase) await supabase.from("services").delete().eq("id", service.id);
    else { const next = services.filter((s) => s.id !== service.id); setServices(next); saveLocal({ services: next }); }
    setNotice("Servicio eliminado");
    refresh();
  }

  const filteredServices = useMemo(() => {
    const q = query.toLowerCase();
    return services.filter((s) => [s.client, s.ceco, s.campaign, s.province, s.worker_name, s.status].some((x) => String(x || "").toLowerCase().includes(q)));
  }, [services, query]);

  const stats = {
    services: services.length,
    points: services.reduce((sum, s) => sum + (s.points?.length || 0), 0),
    unassigned: services.filter((s) => !s.worker_id).length,
    pendingMaterial: services.filter((s) => s.material_status !== "Recibido").length,
    toValidate: services.filter((s) => s.status === "Reportado").length,
    payable: services.filter((s) => ["Validado", "Incluido en pago", "Pagado"].includes(s.status || "")).reduce((sum, s) => sum + (s.points?.length || 0), 0)
  };

  function exportPayments() {
    const rows = [["Trabajador", "Cliente", "CECO", "Campaña", "Provincia", "Punto", "Importe", "Estado", "Reporte"]];
    services.forEach((s) => (s.points || []).forEach((p) => rows.push([s.worker_name || "Sin asignar", s.client, s.ceco || "", s.campaign, s.province || "", p.name, p.fee, s.status || "", s.reporting_channel || ""])));
    downloadCSV("pagos_merchanops.csv", rows);
  }

  function exportWorkers() {
    const rows = [["Nombre", "Teléfono", "Provincia", "Capacidad", "Horas comprometidas", "Especialidades"]];
    workers.forEach((w) => rows.push([w.name, w.phone || "", w.province || "", w.capacity || 0, w.active_hours || 0, w.skills || ""]));
    downloadCSV("trabajadores_merchanops.csv", rows);
  }

  return (
    <main className="min-h-screen bg-slate-100 text-slate-900">
      <header className="sticky top-0 z-10 border-b bg-white">
        <div className="mx-auto flex max-w-7xl flex-col gap-4 px-4 py-4 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="text-3xl font-bold">MerchanOps</h1>
            <p className="text-sm text-slate-500">Servicios, trabajadores, clientes, puntos, CECO y pagos.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button onClick={() => setTab("nuevo-servicio")} className="rounded-2xl bg-slate-900 px-4 py-2 text-white"><Plus className="mr-2 inline h-4 w-4" />Nuevo servicio</button>
            <button onClick={() => setTab("nuevo-cliente")} className="rounded-2xl border bg-white px-4 py-2">Nuevo cliente</button>
            <button onClick={() => setTab("nuevo-trabajador")} className="rounded-2xl border bg-white px-4 py-2">Nuevo trabajador</button>
          </div>
        </div>
      </header>

      <section className="mx-auto max-w-7xl space-y-5 p-4">
        {notice && <div className="rounded-2xl border bg-emerald-50 p-3 text-sm text-emerald-800">{notice}</div>}
        {!isSupabaseConfigured && <div className="rounded-2xl border bg-amber-50 p-3 text-sm text-amber-800">Modo demo local: faltan las claves de Supabase en Vercel. Los datos se guardan solo en este navegador.</div>}

        <nav className="flex flex-wrap gap-2">
          {[["panel", "Panel"], ["servicios", "Servicios"], ["clientes", "Clientes"], ["trabajadores", "Trabajadores"], ["pagos", "Pagos"]].map(([id, label]) => <button key={id} onClick={() => setTab(id)} className={`rounded-2xl px-4 py-2 ${tab === id ? "bg-slate-900 text-white" : "border bg-white"}`}>{label}</button>)}
        </nav>

        {loading && <div className="rounded-2xl bg-white p-6">Cargando...</div>}

        {!loading && tab === "panel" && <Panel stats={stats} />}
        {!loading && tab === "servicios" && <Services services={filteredServices} workers={workers} query={query} setQuery={setQuery} updateService={updateService} deleteService={deleteService} />}
        {!loading && tab === "clientes" && <Clients clients={clients} />}
        {!loading && tab === "trabajadores" && <Workers workers={workers} services={services} exportWorkers={exportWorkers} />}
        {!loading && tab === "pagos" && <Payments services={services} exportPayments={exportPayments} />}
        {!loading && tab === "nuevo-cliente" && <ClientForm addClient={addClient} />}
        {!loading && tab === "nuevo-trabajador" && <WorkerForm addWorker={addWorker} />}
        {!loading && tab === "nuevo-servicio" && <ServiceForm clients={clients} workers={workers} addService={addService} />}
      </section>
    </main>
  );
}

function Panel({ stats }: { stats: any }) {
  const cards = [
    ["Servicios", stats.services, CheckCircle2],
    ["Puntos", stats.points, Package],
    ["Sin asignar", stats.unassigned, AlertTriangle],
    ["Material pendiente", stats.pendingMaterial, Package],
    ["Pendiente validar", stats.toValidate, CheckCircle2],
    ["Puntos pagables", stats.payable, CreditCard]
  ];
  return <div className="grid gap-4 md:grid-cols-3">{cards.map(([label, value, Icon]: any) => <div key={label} className="rounded-3xl border bg-white p-5 shadow-sm"><Icon className="mb-3 h-6 w-6" /><p className="text-sm text-slate-500">{label}</p><p className="text-3xl font-bold">{value}</p></div>)}</div>;
}

function Services({ services, workers, query, setQuery, updateService, deleteService }: any) {
  return <div className="space-y-4"><div className="flex items-center gap-2 rounded-2xl border bg-white px-3 py-2"><Search className="h-4 w-4 text-slate-400" /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar servicio..." className="w-full outline-none" /></div>{services.map((s: Service) => <div key={s.id} className="rounded-3xl border bg-white p-5 shadow-sm"><div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between"><div><h3 className="text-xl font-semibold">{s.client} · {s.campaign}</h3><p className="text-sm text-slate-500">CECO: {s.ceco || "Sin CECO"} · {s.province} · {s.points?.length || 0} puntos · {s.reporting_channel}</p><p className="text-sm text-slate-500">Trabajador: {s.worker_name || "Sin asignar"} · Estado: {s.status}</p></div><div className="flex flex-wrap gap-2"><select value={s.worker_id || ""} onChange={(e) => { const w = workers.find((x: Worker) => x.id === e.target.value); updateService(s, { worker_id: e.target.value, worker_name: w?.name || "", status: e.target.value ? "Asignado" : "Pendiente asignar" }); }} className="rounded-2xl border px-3 py-2"><option value="">Asignar</option>{workers.map((w: Worker) => <option key={w.id} value={w.id}>{w.name}</option>)}</select><select value={s.status || ""} onChange={(e) => updateService(s, { status: e.target.value })} className="rounded-2xl border px-3 py-2">{statuses.map((x) => <option key={x}>{x}</option>)}</select><button onClick={() => { const worker = workers.find((w: Worker) => w.id === s.worker_id); const msg = buildWhatsApp(s); if (worker?.phone) window.open(`https://wa.me/${worker.phone.replace(/[^0-9]/g, "")}?text=${encodeURIComponent(msg)}`, "_blank"); navigator.clipboard.writeText(msg); updateService(s, { communication_sent_at: new Date().toISOString(), status: "Info enviada" }); }} className="rounded-2xl border px-3 py-2"><MessageCircle className="mr-1 inline h-4 w-4" />WhatsApp</button><button onClick={() => deleteService(s)} className="rounded-2xl border px-3 py-2 text-red-600"><Trash2 className="h-4 w-4" /></button></div></div><div className="mt-4 overflow-auto"><table className="w-full text-sm"><thead><tr className="bg-slate-50"><th className="p-2 text-left">Punto</th><th className="p-2 text-left">Dirección</th><th className="p-2 text-right">Importe</th></tr></thead><tbody>{(s.points || []).map((p) => <tr key={p.id} className="border-t"><td className="p-2">{p.name}</td><td className="p-2">{p.address}</td><td className="p-2 text-right">{Number(p.fee || 0).toFixed(2)} €</td></tr>)}</tbody></table></div></div>)}</div>;
}

function Clients({ clients }: { clients: Client[] }) {
  return <div className="grid gap-4 md:grid-cols-3">{clients.map((c) => <div key={c.id} className="rounded-3xl border bg-white p-5"><h3 className="text-lg font-semibold">{c.name}</h3><p className="mt-2 rounded-2xl bg-slate-50 p-2 font-mono text-sm">{c.ceco || "Sin CECO"}</p><p className="mt-2 text-sm text-slate-500">{c.notes}</p></div>)}</div>;
}

function Workers({ workers, services, exportWorkers }: any) {
  return <div className="space-y-4"><button onClick={exportWorkers} className="rounded-2xl bg-slate-900 px-4 py-2 text-white"><FileDown className="mr-2 inline h-4 w-4" />Exportar trabajadores</button><div className="grid gap-4 md:grid-cols-3">{workers.map((w: Worker) => <div key={w.id} className="rounded-3xl border bg-white p-5"><Users className="mb-3 h-5 w-5" /><h3 className="text-lg font-semibold">{w.name}</h3><p className="text-sm text-slate-500">{w.phone}</p><p className="text-sm text-slate-500">{w.province}</p><p className="mt-2 text-sm">{w.skills}</p><p className="mt-2 text-sm text-slate-500">Servicios asignados: {services.filter((s: Service) => s.worker_id === w.id).length}</p></div>)}</div></div>;
}

function Payments({ services, exportPayments }: any) {
  const rows: any[] = [];
  services.forEach((s: Service) => (s.points || []).forEach((p) => rows.push({ worker: s.worker_name || "Sin asignar", client: s.client, ceco: s.ceco || "", campaign: s.campaign, point: p.name, fee: Number(p.fee || 0), status: s.status })));
  const totals = rows.reduce((acc, row) => { const key = `${row.worker} · ${row.client}`; acc[key] = (acc[key] || 0) + row.fee; return acc; }, {} as Record<string, number>);
  return <div className="space-y-4"><button onClick={exportPayments} className="rounded-2xl bg-slate-900 px-4 py-2 text-white"><FileDown className="mr-2 inline h-4 w-4" />Exportar pagos</button><div className="rounded-3xl border bg-white p-5"><h3 className="mb-3 text-lg font-semibold">Totales</h3>{Object.entries(totals).map(([k, v]) => <p key={k} className="border-t py-2">{k}: <strong>{Number(v).toFixed(2)} €</strong></p>)}</div><div className="rounded-3xl border bg-white p-5 overflow-auto"><table className="w-full text-sm"><thead><tr><th className="p-2 text-left">Trabajador</th><th className="p-2 text-left">Cliente</th><th className="p-2 text-left">CECO</th><th className="p-2 text-left">Punto</th><th className="p-2 text-right">Importe</th></tr></thead><tbody>{rows.map((r, i) => <tr key={i} className="border-t"><td className="p-2">{r.worker}</td><td className="p-2">{r.client}</td><td className="p-2">{r.ceco}</td><td className="p-2">{r.point}</td><td className="p-2 text-right">{r.fee.toFixed(2)} €</td></tr>)}</tbody></table></div></div>;
}

function ClientForm({ addClient }: any) {
  const [name, setName] = useState("");
  const [ceco, setCeco] = useState("");
  const [notes, setNotes] = useState("");
  return <div className="rounded-3xl border bg-white p-5"><h2 className="mb-4 text-xl font-semibold">Nuevo cliente</h2><div className="grid gap-3 md:grid-cols-2"><Input label="Cliente" value={name} onChange={setName} /><Input label="CECO fijo" value={ceco} onChange={setCeco} /><Textarea label="Notas" value={notes} onChange={setNotes} /></div><button onClick={() => addClient({ name, ceco, notes })} className="mt-4 rounded-2xl bg-slate-900 px-4 py-2 text-white">Guardar cliente</button></div>;
}

function WorkerForm({ addWorker }: any) {
  const [worker, setWorker] = useState<any>({ name: "", phone: "", province: provinces[0], capacity: 40, active_hours: 0, skills: "" });
  return <div className="rounded-3xl border bg-white p-5"><h2 className="mb-4 text-xl font-semibold">Nuevo trabajador</h2><div className="grid gap-3 md:grid-cols-2"><Input label="Nombre" value={worker.name} onChange={(v) => setWorker({ ...worker, name: v })} /><Input label="Teléfono" value={worker.phone} onChange={(v) => setWorker({ ...worker, phone: v })} /><Select label="Provincia" value={worker.province} onChange={(v) => setWorker({ ...worker, province: v })} options={provinces} /><Input label="Capacidad semanal" type="number" value={worker.capacity} onChange={(v) => setWorker({ ...worker, capacity: Number(v) })} /><Input label="Horas comprometidas" type="number" value={worker.active_hours} onChange={(v) => setWorker({ ...worker, active_hours: Number(v) })} /><Input label="Especialidades" value={worker.skills} onChange={(v) => setWorker({ ...worker, skills: v })} /></div><button onClick={() => addWorker(worker)} className="mt-4 rounded-2xl bg-slate-900 px-4 py-2 text-white">Guardar trabajador</button></div>;
}

function ServiceForm({ clients, workers, addService }: any) {
  const [form, setForm] = useState<any>({ client_id: "", client: "", ceco: "", campaign: "", province: provinces[0], start_date: "", deadline: "", priority: "Media", service_type: "Vinilo", reporting_channel: "WhatsApp", worker_id: "", worker_name: "", status: "Pendiente asignar", material_status: "Pendiente", tracking: "", default_point_fee: 0, estimated_hours: 1, instructions: "" });
  const [pointsText, setPointsText] = useState("Punto 1;Dirección;17;Notas\nPunto 2;Dirección;22;Notas");
  const points = parsePointsText(pointsText, Number(form.default_point_fee || 0));
  return <div className="space-y-4 rounded-3xl border bg-white p-5"><h2 className="text-xl font-semibold">Nuevo servicio</h2><div className="grid gap-3 md:grid-cols-3"><Select label="Cliente existente" value={form.client_id} onChange={(v) => { const c = clients.find((x: Client) => x.id === v); setForm({ ...form, client_id: v, client: c?.name || "", ceco: c?.ceco || "" }); }} options={["", ...clients.map((c: Client) => c.id)]} labels={{ "": "Seleccionar", ...Object.fromEntries(clients.map((c: Client) => [c.id, `${c.name} · ${c.ceco || "Sin CECO"}`])) }} /><Input label="Cliente" value={form.client} onChange={(v) => setForm({ ...form, client: v })} /><Input label="CECO" value={form.ceco} onChange={(v) => setForm({ ...form, ceco: v })} /><Input label="Campaña" value={form.campaign} onChange={(v) => setForm({ ...form, campaign: v })} /><Select label="Provincia" value={form.province} onChange={(v) => setForm({ ...form, province: v })} options={provinces} /><Select label="Reporte" value={form.reporting_channel} onChange={(v) => setForm({ ...form, reporting_channel: v })} options={reportChannels} /><Input label="Inicio" type="date" value={form.start_date} onChange={(v) => setForm({ ...form, start_date: v })} /><Input label="Límite" type="date" value={form.deadline} onChange={(v) => setForm({ ...form, deadline: v })} /><Select label="Prioridad" value={form.priority} onChange={(v) => setForm({ ...form, priority: v })} options={priorities} /><Select label="Tipo" value={form.service_type} onChange={(v) => setForm({ ...form, service_type: v })} options={serviceTypes} /><Select label="Trabajador" value={form.worker_id} onChange={(v) => { const w = workers.find((x: Worker) => x.id === v); setForm({ ...form, worker_id: v, worker_name: w?.name || "", status: v ? "Asignado" : "Pendiente asignar" }); }} options={["", ...workers.map((w: Worker) => w.id)]} labels={{ "": "Sin asignar", ...Object.fromEntries(workers.map((w: Worker) => [w.id, w.name])) }} /><Input label="Pago por punto defecto" type="number" value={form.default_point_fee} onChange={(v) => setForm({ ...form, default_point_fee: Number(v) })} /><Input label="Tracking" value={form.tracking} onChange={(v) => setForm({ ...form, tracking: v })} /><Input label="Horas estimadas" type="number" value={form.estimated_hours} onChange={(v) => setForm({ ...form, estimated_hours: Number(v) })} /></div><Textarea label="Instrucciones" value={form.instructions} onChange={(v) => setForm({ ...form, instructions: v })} /><div><label className="mb-1 block text-sm font-medium">Puntos a visitar: Nombre;Dirección;Importe;Notas</label><textarea value={pointsText} onChange={(e) => setPointsText(e.target.value)} rows={6} className="w-full rounded-2xl border p-3" /></div><div className="rounded-2xl bg-slate-50 p-3 text-sm">Se crearán {points.length} puntos. Total previsto: <strong>{points.reduce((s, p) => s + Number(p.fee || 0), 0).toFixed(2)} €</strong></div><button onClick={() => addService(form, points)} className="rounded-2xl bg-slate-900 px-4 py-2 text-white">Crear servicio</button></div>;
}

function Input({ label, value, onChange, type = "text" }: any) {
  return <label className="block"><span className="mb-1 block text-sm font-medium">{label}</span><input type={type} value={value || ""} onChange={(e) => onChange(e.target.value)} className="w-full rounded-2xl border px-3 py-2" /></label>;
}

function Textarea({ label, value, onChange }: any) {
  return <label className="block md:col-span-2"><span className="mb-1 block text-sm font-medium">{label}</span><textarea value={value || ""} onChange={(e) => onChange(e.target.value)} rows={4} className="w-full rounded-2xl border px-3 py-2" /></label>;
}

function Select({ label, value, onChange, options, labels = {} }: any) {
  return <label className="block"><span className="mb-1 block text-sm font-medium">{label}</span><select value={value || ""} onChange={(e) => onChange(e.target.value)} className="w-full rounded-2xl border bg-white px-3 py-2">{options.map((option: string) => <option key={option} value={option}>{labels[option] || option || "Seleccionar"}</option>)}</select></label>;
}

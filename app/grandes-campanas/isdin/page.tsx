"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, FileDown, Plus, Trash2, Upload } from "lucide-react";
import { isSupabaseConfigured, supabase } from "@/lib/supabase";

type Worker = { id: string; name: string; phone?: string | null; province?: string | null };
type IsdinVinyl = {
  id: string;
  pharmacy_name: string;
  vinyl: string;
  status?: string | null;
  comments?: string | null;
  vinyl_record_type?: string | null;
  vinyl_campaign?: string | null;
  height?: number | null;
  width?: number | null;
  base_payment?: number | null;
  failed_visit_payment?: number | null;
  desired_installation_week?: string | null;
  desired_installation_date?: string | null;
  next_visit_date?: string | null;
  street?: string | null;
  street_number?: string | null;
  city?: string | null;
  postal_code?: string | null;
  province?: string | null;
  installer_id?: string | null;
  installer_name?: string | null;
  ceco?: string | null;
  client?: string | null;
  payment_week?: string | null;
  payment_total?: number | null;
  payment_ready?: boolean | null;
  incident_opened_at?: string | null;
  incident_resolved_at?: string | null;
  status_changed_at?: string | null;
};

const CECO = "3159";
const CLIENT = "ISDIN";
const FAILED_VISIT = 8.56;
const statuses = ["Nuevo", "Finalizado", "Resuelto - Pendiente colocador", "Incidencia", "Cancelado"];
const localKey = "merchanops_isdin_local_v2";

function uid() { return typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : String(Date.now() + Math.random()); }
function nowISO() { return new Date().toISOString(); }
function eur(v: number) { return new Intl.NumberFormat("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(v || 0)) + " €"; }
function n(v: unknown) { return Number(String(v ?? "").replace("€", "").replace(/\s/g, "").replace(",", ".")) || 0; }
function clean(s: unknown) { return String(s ?? "").trim(); }
function dateOnly(v?: string | null) { return v ? v.slice(0, 10) : ""; }
function weekLabelFromDate(date: string) {
  if (!date) return "";
  const d = new Date(date + "T12:00:00");
  if (Number.isNaN(d.getTime())) return "";
  const oneJan = new Date(d.getFullYear(), 0, 1);
  const dayMs = 86400000;
  const week = Math.ceil((((d.getTime() - oneJan.getTime()) / dayMs) + oneJan.getDay() + 1) / 7);
  const month = new Intl.DateTimeFormat("es-ES", { month: "long" }).format(d);
  return `Semana ${week} ${month.charAt(0).toUpperCase() + month.slice(1)} ${d.getFullYear()}`;
}
function isResolvedAfterIncident(v: IsdinVinyl) { return v.status === "Finalizado" && !!v.incident_opened_at; }
function calcPayment(v: IsdinVinyl) {
  const base = Number(v.base_payment || 0);
  if (v.status === "Finalizado") return isResolvedAfterIncident(v) ? base + FAILED_VISIT : base;
  if (v.status === "Incidencia") return FAILED_VISIT;
  if (v.status === "Resuelto - Pendiente colocador") return base + FAILED_VISIT;
  if (v.status === "Cancelado") return FAILED_VISIT;
  return 0;
}
function paymentReady(v: IsdinVinyl) { return ["Finalizado", "Cancelado", "Incidencia", "Resuelto - Pendiente colocador"].includes(String(v.status || "")); }
function recalc(v: IsdinVinyl): IsdinVinyl { return { ...v, payment_total: calcPayment(v), payment_ready: paymentReady(v), ceco: CECO, client: CLIENT, failed_visit_payment: FAILED_VISIT }; }
function workerByExactName(workers: Worker[], name?: string | null) { const target = clean(name); return target ? workers.find(w => clean(w.name) === target) || null : null; }
function csvEscape(v: unknown) { const s = String(v ?? ""); return s.includes(";") || s.includes("\n") || s.includes('"') ? `"${s.replace(/"/g, '""')}"` : s; }
function downloadCSV(name: string, rows: unknown[][]) { const blob = new Blob(["\ufeff" + rows.map(r => r.map(csvEscape).join(";")).join("\n")], { type: "text/csv;charset=utf-8;" }); const url = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = url; a.download = name; a.click(); URL.revokeObjectURL(url); }
function parseRows(text: string, workers: Worker[]): IsdinVinyl[] {
  return text.split("\n").map(x => x.trim()).filter(Boolean).filter(line => !line.toLowerCase().startsWith("nombre farmacia;")).map(line => {
    const [pharmacy_name, vinyl, statusRaw, comments, vinyl_record_type, vinyl_campaign, height, width, base_payment, desired_installation_week, street, street_number, city, postal_code, province, installerRaw] = line.split(";");
    const installer = workerByExactName(workers, installerRaw);
    const status = statuses.includes(clean(statusRaw)) ? clean(statusRaw) : "Nuevo";
    const item: IsdinVinyl = {
      id: uid(), pharmacy_name: clean(pharmacy_name), vinyl: clean(vinyl), status, comments: clean(comments), vinyl_record_type: clean(vinyl_record_type), vinyl_campaign: clean(vinyl_campaign), height: n(height), width: n(width), base_payment: n(base_payment), failed_visit_payment: FAILED_VISIT, desired_installation_week: clean(desired_installation_week), street: clean(street), street_number: clean(street_number), city: clean(city), postal_code: clean(postal_code), province: clean(province), installer_id: installer?.id || null, installer_name: installer?.name || clean(installerRaw) || null, ceco: CECO, client: CLIENT, payment_week: clean(desired_installation_week), incident_opened_at: status === "Incidencia" ? nowISO() : null, status_changed_at: nowISO()
    };
    return recalc(item);
  }).filter(r => !!(r.pharmacy_name || r.vinyl));
}
function localLoad(): IsdinVinyl[] { try { const raw = localStorage.getItem(localKey); if (raw) return JSON.parse(raw); } catch {} return []; }

export default function IsdinPage() {
  const [workers, setWorkers] = useState<Worker[]>([]);
  const [items, setItems] = useState<IsdinVinyl[]>([]);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState("");
  const [showImport, setShowImport] = useState(false);
  const [paste, setPaste] = useState("NOMBRE FARMACIA;Vinyl;Estado;COMENTARIOS;Vinyl: Tipo de registro;Campaña de Vinilos;Alto;Ancho;PAGO;Fecha instalación deseada;Calle;Numero;Ciudad;Código Postal;Provincia;INSTALADOR\nPALOMARES CUELLAR C.B;VIN-30836;Nuevo;;Vinilo standard;MINIONS VERANO 2026 - STANDARD 120 x 150;120;150;15;Semana 25 Mayo 2026;Carrer del Doctor Manuel Candela;54;València;46021;Valencia;ALFONSO GOMIS");
  const [filters, setFilters] = useState({ q: "", status: "", installer: "", province: "", week: "" });
  function saved(t = "Guardado") { setNotice(t); window.setTimeout(() => setNotice(""), 1200); }
  async function refresh() {
    setLoading(true);
    if (isSupabaseConfigured && supabase) {
      const [{ data: w }, { data: v }] = await Promise.all([supabase.from("workers").select("*").order("name"), supabase.from("isdin_vinyls").select("*").order("desired_installation_week", { ascending: true })]);
      setWorkers((w || []) as Worker[]); setItems((v || []) as IsdinVinyl[]);
    } else { setWorkers([]); setItems(localLoad()); }
    setLoading(false);
  }
  useEffect(() => { refresh(); }, []);
  useEffect(() => { if (!isSupabaseConfigured) localStorage.setItem(localKey, JSON.stringify(items)); }, [items]);
  async function importRows() {
    const ready = parseRows(paste, workers);
    if (!ready.length) { saved("No hay filas válidas"); return; }
    if (isSupabaseConfigured && supabase) {
      const { data, error } = await supabase.from("isdin_vinyls").insert(ready.map(({ id, ...r }) => r)).select();
      if (error) { saved(error.message); return; }
      setItems(prev => [...((data || []) as IsdinVinyl[]), ...prev]);
    } else setItems(prev => [...ready, ...prev]);
    setShowImport(false); saved(`${ready.length} vinilos importados`);
  }
  async function updateItem(item: IsdinVinyl, patch: Partial<IsdinVinyl>) {
    let next: IsdinVinyl = { ...item, ...patch, status_changed_at: nowISO() };
    if (patch.status === "Incidencia" && !item.incident_opened_at) next.incident_opened_at = nowISO();
    if (patch.status === "Finalizado" && item.status === "Incidencia") next.incident_resolved_at = nowISO();
    if (patch.status === "Cancelado") next.incident_resolved_at = null;
    if (patch.next_visit_date) { const week = weekLabelFromDate(patch.next_visit_date); next.desired_installation_date = patch.next_visit_date; next.desired_installation_week = week; next.payment_week = week; }
    if (patch.desired_installation_date) { const week = weekLabelFromDate(patch.desired_installation_date); next.desired_installation_week = week; next.payment_week = week; }
    if (patch.installer_id !== undefined) { const w = workers.find(x => x.id === patch.installer_id); next.installer_name = w?.name || null; }
    if (!next.payment_week) next.payment_week = next.desired_installation_week || "Sin semana";
    next = recalc(next);
    setItems(prev => prev.map(x => x.id === item.id ? next : x));
    if (isSupabaseConfigured && supabase) { const { id, ...db } = next; await supabase.from("isdin_vinyls").update(db).eq("id", item.id); }
    saved();
  }
  async function deleteItem(item: IsdinVinyl) { if (!confirm(`¿Borrar ${item.vinyl}?`)) return; setItems(prev => prev.filter(x => x.id !== item.id)); if (isSupabaseConfigured && supabase) await supabase.from("isdin_vinyls").delete().eq("id", item.id); saved("Vinilo borrado"); }
  const weeks = Array.from(new Set(items.map(x => x.payment_week || x.desired_installation_week).filter(Boolean))) as string[];
  const itemProvinces = Array.from(new Set(items.map(x => x.province).filter(Boolean))) as string[];
  const filtered = items.filter(x => { const hay = [x.pharmacy_name, x.vinyl, x.status, x.comments, x.vinyl_record_type, x.vinyl_campaign, x.desired_installation_week, x.street, x.street_number, x.city, x.postal_code, x.province, x.installer_name, x.payment_week].join(" ").toLowerCase(); return (!filters.q || hay.includes(filters.q.toLowerCase())) && (!filters.status || x.status === filters.status) && (!filters.installer || x.installer_id === filters.installer) && (!filters.province || x.province === filters.province) && (!filters.week || (x.payment_week || x.desired_installation_week) === filters.week); });
  const stats = useMemo(() => ({ total: filtered.length, ready: filtered.filter(paymentReady).length, incidents: filtered.filter(x => x.status === "Incidencia").length, pending: filtered.filter(x => x.status === "Nuevo").length, payments: filtered.reduce((a, x) => a + Number(x.payment_total || 0), 0) }), [filtered]);
  function exportAll() { downloadCSV("isdin_vinilos.csv", [["NOMBRE FARMACIA", "Vinyl", "Estado", "COMENTARIOS", "Vinyl: Tipo de registro", "Campaña de Vinilos", "Alto", "Ancho", "PAGO BASE", "PAGO TOTAL", "Fecha instalación deseada", "Fecha deseada", "Próxima visita", "Calle", "Numero", "Ciudad", "Código Postal", "Provincia", "INSTALADOR", "Cliente", "CECO", "Semana pago"], ...filtered.map(x => [x.pharmacy_name, x.vinyl, x.status, x.comments, x.vinyl_record_type, x.vinyl_campaign, x.height, x.width, x.base_payment, x.payment_total, x.desired_installation_week, x.desired_installation_date, x.next_visit_date, x.street, x.street_number, x.city, x.postal_code, x.province, x.installer_name, CLIENT, CECO, x.payment_week])]); }
  function exportPayments() { downloadCSV("pagos_isdin.csv", [["Cliente", "CECO", "Campaña/Semana", "Trabajador", "Farmacia", "VIN", "Estado", "Total"], ...filtered.filter(paymentReady).map(x => [CLIENT, CECO, x.payment_week || x.desired_installation_week || "Sin semana", x.installer_name || "Sin instalador", x.pharmacy_name, x.vinyl, x.status, x.payment_total || 0])]); }
  return <main className="min-h-screen bg-slate-100 text-slate-900"><header className="sticky top-0 z-10 border-b bg-white"><div className="mx-auto flex max-w-7xl flex-col gap-3 px-4 py-4 md:flex-row md:items-center md:justify-between"><div><a href="/grandes-campanas" className="mb-2 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-900"><ArrowLeft className="h-4 w-4" /> Volver a Grandes Campañas</a><h1 className="text-3xl font-bold">ISDIN · Vinilos</h1><p className="text-sm text-slate-500">CECO fijo {CECO}. Gestión por VIN, semana, instalador, estado, incidencias y pagos.</p></div><div className="flex flex-wrap gap-2"><button onClick={() => setShowImport(v => !v)} className="rounded-2xl bg-slate-900 px-4 py-2 text-white"><Upload className="mr-1 inline h-4 w-4" />Carga masiva</button><button onClick={exportAll} className="rounded-2xl border bg-white px-4 py-2"><FileDown className="mr-1 inline h-4 w-4" />Exportar datos</button><button onClick={exportPayments} className="rounded-2xl border bg-white px-4 py-2"><FileDown className="mr-1 inline h-4 w-4" />Exportar pagos</button></div></div></header><section className="mx-auto max-w-7xl space-y-5 p-4">{notice && <div className="fixed right-4 top-24 z-50 rounded-2xl border bg-emerald-50 px-4 py-2 text-sm shadow">{notice}</div>}{!isSupabaseConfigured && <div className="rounded-2xl border bg-amber-50 p-3 text-sm">Modo local: los datos se guardan en este navegador.</div>}<div className="grid gap-3 md:grid-cols-5"><Kpi label="Filas visibles" value={stats.total} /><Kpi label="Pendientes" value={stats.pending} /><Kpi label="Listas para pago" value={stats.ready} /><Kpi label="Incidencias" value={stats.incidents} /><Kpi label="Total pago" value={eur(stats.payments)} /></div>{showImport && <Card><div className="space-y-3"><h2 className="text-xl font-semibold">Carga masiva desde Excel</h2><p className="text-sm text-slate-500">Orden: NOMBRE FARMACIA;Vinyl;Estado;COMENTARIOS;Vinyl: Tipo de registro;Campaña de Vinilos;Alto;Ancho;PAGO;Fecha instalación deseada;Calle;Numero;Ciudad;Código Postal;Provincia;INSTALADOR</p><textarea rows={8} value={paste} onChange={e => setPaste(e.target.value)} className="w-full rounded-2xl border p-3 font-mono text-xs" /><button onClick={importRows} className="rounded-2xl bg-slate-900 px-4 py-2 text-white"><Plus className="mr-1 inline h-4 w-4" />Importar filas</button></div></Card>}<Card><div className="grid gap-2 md:grid-cols-5"><Input label="Buscar cualquier campo" value={filters.q} onChange={(v: string) => setFilters({ ...filters, q: v })} /><Select label="Estado" value={filters.status} onChange={(v: string) => setFilters({ ...filters, status: v })} options={["", ...statuses]} labels={{ "": "Todos" }} /><Select label="Instalador" value={filters.installer} onChange={(v: string) => setFilters({ ...filters, installer: v })} options={["", ...workers.map(w => w.id)]} labels={{ "": "Todos", ...Object.fromEntries(workers.map(w => [w.id, w.name])) }} /><Select label="Provincia" value={filters.province} onChange={(v: string) => setFilters({ ...filters, province: v })} options={["", ...itemProvinces]} labels={{ "": "Todas" }} /><Select label="Semana" value={filters.week} onChange={(v: string) => setFilters({ ...filters, week: v })} options={["", ...weeks]} labels={{ "": "Todas" }} /></div></Card><Card>{loading ? "Cargando..." : <div className="overflow-auto"><table className="w-full min-w-[1850px] text-sm"><thead><tr className="bg-slate-900 text-white"><th className="p-2 text-left">NOMBRE FARMACIA</th><th className="p-2 text-left">Vinyl</th><th className="p-2 text-left">Estado</th><th className="p-2 text-left">COMENTARIOS</th><th className="p-2 text-left">Tipo registro</th><th className="p-2 text-left">Campaña</th><th className="p-2 text-right">Alto</th><th className="p-2 text-right">Ancho</th><th className="p-2 text-right">Pago base</th><th className="p-2 text-right">Pago total</th><th className="p-2 text-left">Semana instalación/pago</th><th className="p-2 text-left">Fecha deseada</th><th className="p-2 text-left">Próxima visita</th><th className="p-2 text-left">Calle</th><th className="p-2 text-left">Número</th><th className="p-2 text-left">Ciudad</th><th className="p-2 text-left">CP</th><th className="p-2 text-left">Provincia</th><th className="p-2 text-left">INSTALADOR</th><th className="p-2"></th></tr></thead><tbody>{filtered.map(item => <tr key={item.id} className={`border-t ${item.status === "Incidencia" ? "bg-orange-50" : item.status === "Finalizado" ? "bg-green-50" : item.status === "Cancelado" ? "bg-red-50" : item.status === "Resuelto - Pendiente colocador" ? "bg-blue-50" : "bg-white"}`}><td className="p-2 font-medium">{item.pharmacy_name}</td><td className="p-2 font-mono text-xs">{item.vinyl}</td><td className="p-2"><SelectMini value={item.status || "Nuevo"} onChange={(v: string) => updateItem(item, { status: v })} options={statuses} /></td><td className="p-2"><input value={item.comments || ""} onChange={e => updateItem(item, { comments: e.target.value })} className="w-56 rounded-xl border px-2 py-1" /></td><td className="p-2">{item.vinyl_record_type}</td><td className="p-2">{item.vinyl_campaign}</td><td className="p-2 text-right">{item.height}</td><td className="p-2 text-right">{item.width}</td><td className="p-2 text-right"><input type="number" value={item.base_payment || 0} onChange={e => updateItem(item, { base_payment: Number(e.target.value) })} className="w-20 rounded-xl border px-2 py-1 text-right" /></td><td className="p-2 text-right font-semibold">{eur(item.payment_total || 0)}</td><td className="p-2"><input value={item.desired_installation_week || item.payment_week || ""} onChange={e => updateItem(item, { desired_installation_week: e.target.value, payment_week: e.target.value })} className="w-44 rounded-xl border px-2 py-1" /></td><td className="p-2"><input type="date" value={dateOnly(item.desired_installation_date)} onChange={e => updateItem(item, { desired_installation_date: e.target.value })} className="rounded-xl border px-2 py-1" /></td><td className="p-2"><input type="date" value={dateOnly(item.next_visit_date)} onChange={e => updateItem(item, { next_visit_date: e.target.value })} className="rounded-xl border px-2 py-1" /></td><td className="p-2">{item.street}</td><td className="p-2">{item.street_number}</td><td className="p-2">{item.city}</td><td className="p-2">{item.postal_code}</td><td className="p-2">{item.province}</td><td className="p-2"><SelectMini value={item.installer_id || ""} onChange={(id: string) => updateItem(item, { installer_id: id || null })} options={["", ...workers.map(w => w.id)]} labels={{ "": "Sin asignar", ...Object.fromEntries(workers.map(w => [w.id, w.name])) }} /></td><td className="p-2"><button onClick={() => deleteItem(item)} className="text-red-600"><Trash2 className="h-4 w-4" /></button></td></tr>)}</tbody></table></div>}</Card></section></main>;
}

function Card({ children }: { children: any }) { return <div className="rounded-3xl border bg-white p-5 shadow-sm">{children}</div>; }
function Kpi({ label, value }: { label: string; value: any }) { return <Card><p className="text-sm text-slate-500">{label}</p><p className="text-2xl font-bold">{value}</p></Card>; }
function Input({ label, value, onChange }: any) { return <label className="block"><span className="text-sm font-medium">{label}</span><input value={value ?? ""} onChange={e => onChange(e.target.value)} className="w-full rounded-2xl border px-3 py-2" /></label>; }
function Select({ label, value, onChange, options, labels = {} }: any) { return <label className="block"><span className="text-sm font-medium">{label}</span><select value={value ?? ""} onChange={e => onChange(e.target.value)} className="w-full rounded-2xl border bg-white px-3 py-2">{options.map((o: string) => <option key={o} value={o}>{labels[o] || o || "Seleccionar"}</option>)}</select></label>; }
function SelectMini({ value, onChange, options, labels = {} }: any) { return <select value={value ?? ""} onChange={e => onChange(e.target.value)} className="rounded-xl border bg-white px-2 py-1 text-sm">{options.map((o: string) => <option key={o} value={o}>{labels[o] || o || "Seleccionar"}</option>)}</select>; }

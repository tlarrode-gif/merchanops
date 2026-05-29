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
  incident_payment_week?: string | null;
  incident_payment_date?: string | null;
  installation_payment_week?: string | null;
  installation_payment_date?: string | null;
};

type ColKey = "pharmacy_name" | "vinyl" | "status" | "comments" | "vinyl_record_type" | "vinyl_campaign" | "height" | "width" | "base_payment" | "payment_total" | "desired_installation_week" | "desired_installation_date" | "next_visit_date" | "incident_payment_week" | "installation_payment_week" | "street" | "street_number" | "city" | "postal_code" | "province" | "installer";
type ColumnDef = { key: ColKey; label: string; exportLabel: string; compact?: boolean };
type SortState = { key: ColKey | ""; direction: "asc" | "desc" };
type PaymentLine = { client: string; ceco: string; week: string; worker: string; pharmacy: string; vin: string; status: string; concept: string; total: number };

const CECO = "3159";
const CLIENT = "ISDIN";
const FAILED_VISIT = 8.56;
const statuses = ["Nuevo", "Finalizado", "Resuelto - Pendiente colocador", "Incidencia", "Incidencia llamada", "Cancelado"];
const openStatuses = ["Nuevo", "Resuelto - Pendiente colocador", "Incidencia", "Incidencia llamada"];
const closedStatuses = ["Finalizado", "Cancelado"];
const localKey = "merchanops_isdin_local_v373";

const columns: ColumnDef[] = [
  { key: "pharmacy_name", label: "Farmacia", exportLabel: "NOMBRE FARMACIA" },
  { key: "vinyl", label: "VIN", exportLabel: "Vinyl", compact: true },
  { key: "status", label: "Estado", exportLabel: "Estado" },
  { key: "comments", label: "Comentarios", exportLabel: "COMENTARIOS" },
  { key: "vinyl_record_type", label: "Tipo", exportLabel: "Vinyl: Tipo de registro" },
  { key: "vinyl_campaign", label: "Campaña", exportLabel: "Campaña de Vinilos" },
  { key: "height", label: "Alto", exportLabel: "Alto", compact: true },
  { key: "width", label: "Ancho", exportLabel: "Ancho", compact: true },
  { key: "base_payment", label: "Base", exportLabel: "PAGO BASE", compact: true },
  { key: "payment_total", label: "Total previsto", exportLabel: "PAGO TOTAL", compact: true },
  { key: "desired_installation_week", label: "Semana actual", exportLabel: "Fecha instalación deseada" },
  { key: "desired_installation_date", label: "Fecha actual", exportLabel: "Fecha deseada", compact: true },
  { key: "next_visit_date", label: "Próx. visita", exportLabel: "Próxima visita", compact: true },
  { key: "incident_payment_week", label: "Semana 1ª visita", exportLabel: "Semana pago incidencia" },
  { key: "installation_payment_week", label: "Semana instalación", exportLabel: "Semana pago instalación" },
  { key: "street", label: "Calle", exportLabel: "Calle" },
  { key: "street_number", label: "Nº", exportLabel: "Numero", compact: true },
  { key: "city", label: "Ciudad", exportLabel: "Ciudad" },
  { key: "postal_code", label: "CP", exportLabel: "Código Postal", compact: true },
  { key: "province", label: "Provincia", exportLabel: "Provincia" },
  { key: "installer", label: "Instalador", exportLabel: "INSTALADOR" }
];
const defaultVisible: Record<ColKey, boolean> = Object.fromEntries(columns.map(c => [c.key, true])) as Record<ColKey, boolean>;

function uid() { return typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : String(Date.now() + Math.random()); }
function nowISO() { return new Date().toISOString(); }
function todayDate() { return new Date().toISOString().slice(0, 10); }
function eur(v: number) { return new Intl.NumberFormat("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(v || 0)) + " €"; }
function n(v: unknown) { return Number(String(v ?? "").replace("€", "").replace(/\s/g, "").replace(",", ".")) || 0; }
function clean(s: unknown) { return String(s ?? "").trim(); }
function dateOnly(v?: string | null) { return v ? v.slice(0, 10) : ""; }
function pct(n: number, d: number) { return d ? Math.round((n / d) * 100) : 0; }
function weekLabelFromDate(date: string) {
  if (!date) return "";
  const d = new Date(date + "T12:00:00");
  if (Number.isNaN(d.getTime())) return "";
  const oneJan = new Date(d.getFullYear(), 0, 1);
  const week = Math.ceil((((d.getTime() - oneJan.getTime()) / 86400000) + oneJan.getDay() + 1) / 7);
  const month = new Intl.DateTimeFormat("es-ES", { month: "long" }).format(d);
  return `Semana ${week} ${month.charAt(0).toUpperCase() + month.slice(1)} ${d.getFullYear()}`;
}
function weekFromMaybeDate(date?: string | null, fallback?: string | null) { return date ? weekLabelFromDate(dateOnly(date)) : (fallback || "Sin semana"); }
function isResolvedAfterIncident(v: IsdinVinyl) { return v.status === "Finalizado" && !!v.incident_opened_at; }
function calcPayment(v: IsdinVinyl) {
  const base = Number(v.base_payment || 0);
  if (v.status === "Finalizado") return isResolvedAfterIncident(v) ? base + FAILED_VISIT : base;
  if (v.status === "Incidencia") return FAILED_VISIT;
  if (v.status === "Incidencia llamada") return 0;
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
    const desiredWeek = clean(desired_installation_week);
    const item: IsdinVinyl = { id: uid(), pharmacy_name: clean(pharmacy_name), vinyl: clean(vinyl), status, comments: clean(comments), vinyl_record_type: clean(vinyl_record_type), vinyl_campaign: clean(vinyl_campaign), height: n(height), width: n(width), base_payment: n(base_payment), failed_visit_payment: FAILED_VISIT, desired_installation_week: desiredWeek, street: clean(street), street_number: clean(street_number), city: clean(city), postal_code: clean(postal_code), province: clean(province), installer_id: installer?.id || null, installer_name: installer?.name || clean(installerRaw) || null, ceco: CECO, client: CLIENT, payment_week: desiredWeek, installation_payment_week: status === "Finalizado" ? desiredWeek : null, incident_payment_week: ["Incidencia", "Resuelto - Pendiente colocador", "Cancelado"].includes(status) ? desiredWeek : null, incident_opened_at: status === "Incidencia" ? nowISO() : null, status_changed_at: nowISO() };
    return recalc(item);
  }).filter(r => !!(r.pharmacy_name || r.vinyl));
}
function localLoad(): IsdinVinyl[] { try { const raw = localStorage.getItem(localKey); if (raw) return JSON.parse(raw); } catch {} return []; }
function colValue(x: IsdinVinyl, key: ColKey) { if (key === "installer") return x.installer_name || ""; if (key === "base_payment" || key === "payment_total") return eur(Number((x as any)[key] || 0)); return String((x as any)[key] ?? ""); }
function rawSortValue(x: IsdinVinyl, key: ColKey | "") { if (!key) return ""; if (key === "installer") return x.installer_name || ""; if (["height", "width", "base_payment", "payment_total"].includes(key)) return Number((x as any)[key] || 0); return String((x as any)[key] ?? "").toLowerCase(); }
function statusClass(status?: string | null) { if (status === "Incidencia") return "bg-orange-50"; if (status === "Incidencia llamada") return "bg-purple-50"; if (status === "Finalizado") return "bg-green-50"; if (status === "Cancelado") return "bg-red-50"; if (status === "Resuelto - Pendiente colocador") return "bg-blue-50"; return "bg-white"; }
function buildPaymentLines(v: IsdinVinyl): PaymentLine[] {
  const base = Number(v.base_payment || 0);
  const worker = v.installer_name || "Sin instalador";
  const common = { client: CLIENT, ceco: CECO, worker, pharmacy: v.pharmacy_name, vin: v.vinyl, status: v.status || "Nuevo" };
  const incidentWeek = v.incident_payment_week || v.payment_week || v.desired_installation_week || "Sin semana";
  const installationWeek = v.installation_payment_week || v.payment_week || v.desired_installation_week || "Sin semana";
  if (v.status === "Incidencia llamada" || v.status === "Nuevo") return [];
  if (v.status === "Cancelado") return [{ ...common, week: incidentWeek, concept: "Visita fallida - cancelado", total: FAILED_VISIT }];
  if (v.status === "Incidencia") return [{ ...common, week: incidentWeek, concept: "Visita fallida - incidencia 1ª visita", total: FAILED_VISIT }];
  if (v.status === "Resuelto - Pendiente colocador") return [{ ...common, week: incidentWeek, concept: "Visita fallida - pendiente recolocación", total: FAILED_VISIT }];
  if (v.status === "Finalizado" && v.incident_payment_week) return [
    { ...common, week: incidentWeek, concept: "Visita fallida - incidencia 1ª visita", total: FAILED_VISIT },
    { ...common, week: installationWeek, concept: "Instalación vinilo resuelta", total: base }
  ];
  if (v.status === "Finalizado") return [{ ...common, week: installationWeek, concept: "Instalación vinilo", total: base }];
  return [];
}

export default function IsdinPage() {
  const [workers, setWorkers] = useState<Worker[]>([]);
  const [items, setItems] = useState<IsdinVinyl[]>([]);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState("");
  const [showImport, setShowImport] = useState(false);
  const [showCols, setShowCols] = useState(false);
  const [paste, setPaste] = useState("NOMBRE FARMACIA;Vinyl;Estado;COMENTARIOS;Vinyl: Tipo de registro;Campaña de Vinilos;Alto;Ancho;PAGO;Fecha instalación deseada;Calle;Numero;Ciudad;Código Postal;Provincia;INSTALADOR\nPALOMARES CUELLAR C.B;VIN-30836;Nuevo;;Vinilo standard;MINIONS VERANO 2026 - STANDARD 120 x 150;120;150;15;Semana 25 Mayo 2026;Carrer del Doctor Manuel Candela;54;València;46021;Valencia;ALFONSO GOMIS");
  const [filters, setFilters] = useState({ q: "", installer: "", province: "" });
  const [selectedWeeks, setSelectedWeeks] = useState<string[]>([]);
  const [selectedStatuses, setSelectedStatuses] = useState<string[]>([]);
  const [visibleCols, setVisibleCols] = useState<Record<ColKey, boolean>>(defaultVisible);
  const [sort, setSort] = useState<SortState>({ key: "", direction: "asc" });

  function saved(t = "Guardado") { setNotice(t); window.setTimeout(() => setNotice(""), 1200); }
  async function refresh() { setLoading(true); if (isSupabaseConfigured && supabase) { const [{ data: w }, { data: v }] = await Promise.all([supabase.from("workers").select("*").order("name"), supabase.from("isdin_vinyls").select("*").order("desired_installation_week", { ascending: true })]); setWorkers((w || []) as Worker[]); setItems((v || []) as IsdinVinyl[]); } else { setWorkers([]); setItems(localLoad()); } setLoading(false); }
  useEffect(() => { refresh(); }, []);
  useEffect(() => { if (!isSupabaseConfigured) localStorage.setItem(localKey, JSON.stringify(items)); }, [items]);

  async function importRows() { const ready = parseRows(paste, workers); if (!ready.length) { saved("No hay filas válidas"); return; } if (isSupabaseConfigured && supabase) { const { data, error } = await supabase.from("isdin_vinyls").insert(ready.map(({ id, ...r }) => r)).select(); if (error) { saved(error.message); return; } setItems(prev => [...((data || []) as IsdinVinyl[]), ...prev]); } else setItems(prev => [...ready, ...prev]); setShowImport(false); saved(`${ready.length} vinilos importados`); }

  async function updateItem(item: IsdinVinyl, patch: Partial<IsdinVinyl>) {
    let next: IsdinVinyl = { ...item, ...patch, status_changed_at: nowISO() };
    if (patch.status === "Incidencia" && !item.incident_payment_week) { next.incident_opened_at = item.incident_opened_at || nowISO(); next.incident_payment_week = item.payment_week || item.desired_installation_week || weekFromMaybeDate(item.desired_installation_date, "Sin semana"); next.incident_payment_date = item.desired_installation_date || todayDate(); }
    if (patch.status === "Resuelto - Pendiente colocador" && !item.incident_payment_week) { next.incident_payment_week = item.payment_week || item.desired_installation_week || weekFromMaybeDate(item.desired_installation_date, "Sin semana"); next.incident_payment_date = item.desired_installation_date || todayDate(); }
    if (patch.status === "Cancelado" && !item.incident_payment_week) { next.incident_payment_week = item.payment_week || item.desired_installation_week || weekFromMaybeDate(item.desired_installation_date, "Sin semana"); next.incident_payment_date = item.desired_installation_date || todayDate(); }
    if (patch.status === "Finalizado") { next.installation_payment_week = next.payment_week || next.desired_installation_week || weekFromMaybeDate(next.desired_installation_date, "Sin semana"); next.installation_payment_date = next.desired_installation_date || todayDate(); if (item.status === "Incidencia") next.incident_resolved_at = nowISO(); }
    if (patch.status === "Incidencia llamada") { next.incident_resolved_at = null; next.incident_payment_week = null; next.incident_payment_date = null; }
    if (patch.next_visit_date) { const week = weekLabelFromDate(patch.next_visit_date); next.desired_installation_date = patch.next_visit_date; next.desired_installation_week = week; next.payment_week = week; if (next.status === "Finalizado") { next.installation_payment_week = week; next.installation_payment_date = patch.next_visit_date; } }
    if (patch.desired_installation_date) { const week = weekLabelFromDate(patch.desired_installation_date); next.desired_installation_week = week; next.payment_week = week; if (next.status === "Finalizado") { next.installation_payment_week = week; next.installation_payment_date = patch.desired_installation_date; } }
    if (patch.installer_id !== undefined) { const w = workers.find(x => x.id === patch.installer_id); next.installer_name = w?.name || null; }
    if (!next.payment_week) next.payment_week = next.desired_installation_week || "Sin semana";
    next = recalc(next);
    setItems(prev => prev.map(x => x.id === item.id ? next : x));
    if (isSupabaseConfigured && supabase) { const { id, ...db } = next; await supabase.from("isdin_vinyls").update(db).eq("id", item.id); }
    saved();
  }

  async function deleteItem(item: IsdinVinyl) { if (!confirm(`¿Borrar ${item.vinyl}?`)) return; setItems(prev => prev.filter(x => x.id !== item.id)); if (isSupabaseConfigured && supabase) await supabase.from("isdin_vinyls").delete().eq("id", item.id); saved("Vinilo borrado"); }

  const weeks = Array.from(new Set(items.flatMap(x => [x.payment_week, x.desired_installation_week, x.incident_payment_week, x.installation_payment_week]).filter(Boolean))) as string[];
  const itemProvinces = Array.from(new Set(items.map(x => x.province).filter(Boolean))) as string[];
  const filtered = items.filter(x => { const hay = columns.map(c => colValue(x, c.key)).concat([x.payment_week || "", x.ceco || ""]).join(" ").toLowerCase(); const itemWeeks = [x.payment_week, x.desired_installation_week, x.incident_payment_week, x.installation_payment_week].filter(Boolean) as string[]; return (!filters.q || hay.includes(filters.q.toLowerCase())) && (!selectedStatuses.length || selectedStatuses.includes(String(x.status || "Nuevo"))) && (!filters.installer || x.installer_id === filters.installer) && (!filters.province || x.province === filters.province) && (!selectedWeeks.length || itemWeeks.some(w => selectedWeeks.includes(w))); });
  const sortedFiltered = [...filtered].sort((a, b) => { if (!sort.key) return 0; const av = rawSortValue(a, sort.key); const bv = rawSortValue(b, sort.key); const res = typeof av === "number" && typeof bv === "number" ? av - bv : String(av).localeCompare(String(bv), "es", { numeric: true, sensitivity: "base" }); return sort.direction === "asc" ? res : -res; });
  const paymentLines = sortedFiltered.flatMap(buildPaymentLines);
  const workerKpis = useMemo(() => workers.map(w => { const own = sortedFiltered.filter(x => x.installer_id === w.id || (!x.installer_id && x.installer_name === w.name)); return { name: w.name, total: own.length, finalizados: own.filter(x => x.status === "Finalizado").length, incidencias: own.filter(x => x.status === "Incidencia").length, bloqueos: own.filter(x => x.status === "Incidencia llamada").length, pendientes: own.filter(x => x.status === "Nuevo" || x.status === "Resuelto - Pendiente colocador" || x.status === "Incidencia llamada").length, pago: own.flatMap(buildPaymentLines).reduce((a, x) => a + Number(x.total || 0), 0), tasaFinalizado: pct(own.filter(x => x.status === "Finalizado").length, own.length), tasaIncidencia: pct(own.filter(x => x.status === "Incidencia").length, own.length) }; }).filter(x => x.total > 0).sort((a,b)=>b.total-a.total), [workers, sortedFiltered]);
  const stats = useMemo(() => { const total = sortedFiltered.length; const finalizados = sortedFiltered.filter(x => x.status === "Finalizado").length; const cancelados = sortedFiltered.filter(x => x.status === "Cancelado").length; const incidencias = sortedFiltered.filter(x => x.status === "Incidencia").length; const incidenciaLlamada = sortedFiltered.filter(x => x.status === "Incidencia llamada").length; const pendientesColocador = sortedFiltered.filter(x => x.status === "Resuelto - Pendiente colocador").length; const nuevos = sortedFiltered.filter(x => x.status === "Nuevo").length; const asignados = sortedFiltered.filter(x => !!x.installer_id || !!x.installer_name).length; const pagos = paymentLines.reduce((a, x) => a + Number(x.total || 0), 0); const fallidas = sortedFiltered.filter(x => ["Incidencia", "Cancelado", "Resuelto - Pendiente colocador"].includes(String(x.status))).length; return { total, finalizados, cancelados, incidencias, incidenciaLlamada, pendientesColocador, nuevos, asignados, pagos, fallidas, avance: pct(finalizados + cancelados, total), pendiente: total - finalizados - cancelados, tasaIncidencia: pct(incidencias, total), tasaFallida: pct(fallidas, total), sinInstalador: total - asignados, ahorroPreventivo: incidenciaLlamada * FAILED_VISIT, lineasPago: paymentLines.length }; }, [sortedFiltered, paymentLines]);

  function toggleStatus(st: string) { setSelectedStatuses(prev => prev.includes(st) ? prev.filter(x => x !== st) : [...prev, st]); }
  function toggleWeek(week: string) { setSelectedWeeks(prev => prev.includes(week) ? prev.filter(x => x !== week) : [...prev, week]); }
  function setOnlyActive() { setSelectedStatuses(openStatuses); }
  function setOnlyClosed() { setSelectedStatuses(closedStatuses); }
  function changeSort(key: ColKey) { setSort(prev => prev.key !== key ? { key, direction: "asc" } : { key, direction: prev.direction === "asc" ? "desc" : "asc" }); }
  function sortMark(key: ColKey) { if (sort.key !== key) return ""; return sort.direction === "asc" ? " ↑" : " ↓"; }
  function exportAll() { const activeCols = columns.filter(c => visibleCols[c.key]); downloadCSV("isdin_vinilos.csv", [activeCols.map(c => c.exportLabel).concat(["Cliente", "CECO", "Semana pago", "Semana 1ª visita", "Semana instalación"]), ...sortedFiltered.map(x => activeCols.map(c => colValue(x, c.key)).concat([CLIENT, CECO, x.payment_week || x.desired_installation_week || "Sin semana", x.incident_payment_week || "", x.installation_payment_week || ""]))]); }
  function exportPayments() { downloadCSV("pagos_isdin.csv", [["Cliente", "CECO", "Campaña/Semana", "Trabajador", "Farmacia", "VIN", "Estado", "Concepto", "Total"], ...paymentLines.map(x => [x.client, x.ceco, x.week, x.worker, x.pharmacy, x.vin, x.status, x.concept, x.total])]); }

  const activeCols = columns.filter(c => visibleCols[c.key]);
  return <main className="min-h-screen bg-slate-100 text-slate-900"><header className="sticky top-0 z-10 border-b bg-white"><div className="mx-auto flex max-w-7xl flex-col gap-3 px-4 py-4 md:flex-row md:items-center md:justify-between"><div><a href="/grandes-campanas" className="mb-2 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-900"><ArrowLeft className="h-4 w-4"/>Volver a Grandes Campañas</a><h1 className="text-3xl font-bold">ISDIN · Vinilos V3.7.3</h1><p className="text-sm text-slate-500">Pagos contables separados: visita fallida e instalación pueden ir a semanas diferentes.</p></div><div className="flex flex-wrap gap-2"><a href="/grandes-campanas/isdin/dashboard" className="rounded-2xl border bg-white px-4 py-2">Dashboard KPIs</a><button onClick={()=>setShowImport(v=>!v)} className="rounded-2xl bg-slate-900 px-4 py-2 text-white"><Upload className="mr-1 inline h-4 w-4"/>Carga masiva</button><button onClick={exportAll} className="rounded-2xl border bg-white px-4 py-2"><FileDown className="mr-1 inline h-4 w-4"/>Exportar datos</button><button onClick={exportPayments} className="rounded-2xl border bg-white px-4 py-2"><FileDown className="mr-1 inline h-4 w-4"/>Exportar pagos contables</button></div></div></header><section className="mx-auto max-w-7xl space-y-5 p-4">{notice&&<div className="fixed right-4 top-24 z-50 rounded-2xl border bg-emerald-50 px-4 py-2 text-sm shadow">{notice}</div>}{!isSupabaseConfigured&&<div className="rounded-2xl border bg-amber-50 p-3 text-sm">Modo local: los datos se guardan en este navegador.</div>}
    <div className="grid gap-3 md:grid-cols-4 lg:grid-cols-8"><Kpi label="Avance" value={`${stats.avance}%`} hint="Finalizados + cancelados"/><Kpi label="Total visible" value={stats.total}/><Kpi label="Pendiente" value={stats.pendiente}/><Kpi label="Finalizados" value={stats.finalizados}/><Kpi label="Incidencias" value={stats.incidencias}/><Kpi label="Incid. llamada" value={stats.incidenciaLlamada} hint="Sin pago"/><Kpi label="Líneas pago" value={stats.lineasPago}/><Kpi label="Pago contable" value={eur(stats.pagos)}/></div>
    <div className="grid gap-4 lg:grid-cols-3"><KpiCard title="Calidad operativa"><Metric label="Tasa de incidencia real" value={`${stats.tasaIncidencia}%`}/><Metric label="Visitas fallidas" value={`${stats.fallidas} · ${stats.tasaFallida}%`}/><Metric label="Bloqueos preventivos" value={`${stats.incidenciaLlamada} · ahorro ${eur(stats.ahorroPreventivo)}`}/></KpiCard><KpiCard title="Pagos contables"><Metric label="Líneas generadas" value={stats.lineasPago}/><Metric label="Total exportable" value={eur(stats.pagos)}/><Metric label="Pago de incidencias" value={eur(paymentLines.filter(x=>x.concept.includes("fallida")).reduce((a,x)=>a+x.total,0))}/></KpiCard><KpiCard title="Top instaladores"><div className="space-y-2">{workerKpis.slice(0,5).map(w=><div key={w.name} className="text-sm"><div className="flex justify-between gap-2"><span className="truncate">{w.name}</span><b>{w.total} · {eur(w.pago)}</b></div><div className="h-2 rounded-full bg-slate-100"><div className="h-2 rounded-full bg-slate-900" style={{width:`${Math.max(4,w.tasaFinalizado)}%`}}/></div><p className="text-xs text-slate-500">Finalizado {w.tasaFinalizado}% · Incidencia {w.tasaIncidencia}% · Bloqueos {w.bloqueos}</p></div>)}{!workerKpis.length&&<p className="text-sm text-slate-500">Sin datos por instalador.</p>}</div></KpiCard></div>
    {showImport&&<Card><div className="space-y-3"><h2 className="text-xl font-semibold">Carga masiva desde Excel</h2><p className="text-sm text-slate-500">Orden: NOMBRE FARMACIA;Vinyl;Estado;COMENTARIOS;Vinyl: Tipo de registro;Campaña de Vinilos;Alto;Ancho;PAGO;Fecha instalación deseada;Calle;Numero;Ciudad;Código Postal;Provincia;INSTALADOR</p><textarea rows={8} value={paste} onChange={e=>setPaste(e.target.value)} className="w-full rounded-2xl border p-3 font-mono text-xs"/><button onClick={importRows} className="rounded-2xl bg-slate-900 px-4 py-2 text-white"><Plus className="mr-1 inline h-4 w-4"/>Importar filas</button></div></Card>}
    <Card><div className="space-y-4"><div className="grid gap-2 md:grid-cols-3"><Input label="Buscar cualquier campo" value={filters.q} onChange={(v:string)=>setFilters({...filters,q:v})}/><Select label="Instalador" value={filters.installer} onChange={(v:string)=>setFilters({...filters,installer:v})} options={["",...workers.map(w=>w.id)]} labels={{"":"Todos",...Object.fromEntries(workers.map(w=>[w.id,w.name]))}}/><Select label="Provincia" value={filters.province} onChange={(v:string)=>setFilters({...filters,province:v})} options={["",...itemProvinces]} labels={{"":"Todas"}}/></div><div><p className="mb-2 text-sm font-medium">Filtro de semanas múltiple</p><div className="flex flex-wrap gap-2">{weeks.map(week=><button key={week} onClick={()=>toggleWeek(week)} className={`rounded-xl border px-3 py-1 text-sm ${selectedWeeks.includes(week)?"bg-slate-900 text-white":"bg-white"}`}>{week}</button>)}<button onClick={()=>setSelectedWeeks([])} className="rounded-xl border px-3 py-1 text-sm">Todas</button></div></div><div><p className="mb-2 text-sm font-medium">Filtro de estado múltiple</p><div className="flex flex-wrap gap-2">{statuses.map(st=><button key={st} onClick={()=>toggleStatus(st)} className={`rounded-xl border px-3 py-1 text-sm ${selectedStatuses.includes(st)?"bg-slate-900 text-white":"bg-white"}`}>{st}</button>)}<button onClick={()=>setSelectedStatuses([])} className="rounded-xl border px-3 py-1 text-sm">Todos</button><button onClick={setOnlyActive} className="rounded-xl border px-3 py-1 text-sm">Abiertos</button><button onClick={setOnlyClosed} className="rounded-xl border px-3 py-1 text-sm">Cerrados</button></div></div><div><button onClick={()=>setShowCols(v=>!v)} className="rounded-xl border px-3 py-1 text-sm">Mostrar/ocultar columnas</button>{showCols&&<div className="mt-3 grid gap-2 rounded-2xl bg-slate-50 p-3 md:grid-cols-4">{columns.map(c=><label key={c.key} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={visibleCols[c.key]} onChange={e=>setVisibleCols({...visibleCols,[c.key]:e.target.checked})}/>{c.label}</label>)}<button onClick={()=>setVisibleCols(defaultVisible)} className="rounded-xl border bg-white px-3 py-1 text-sm">Ver todas</button><button onClick={()=>setVisibleCols({...defaultVisible,comments:false,vinyl_campaign:false,street:false})} className="rounded-xl border bg-white px-3 py-1 text-sm">Vista compacta</button></div>}</div></div></Card>
    <Card>{loading?"Cargando...":<div className="overflow-auto"><table className="w-full min-w-max table-auto text-xs"><thead><tr className="bg-slate-900 text-white">{activeCols.map(c=><th key={c.key} onClick={()=>changeSort(c.key)} className={`cursor-pointer whitespace-nowrap p-2 text-left hover:bg-slate-700 ${c.compact?"w-24":""}`}>{c.label}{sortMark(c.key)}</th>)}<th className="p-2"></th></tr></thead><tbody>{sortedFiltered.map(item=><tr key={item.id} className={`border-t align-top ${statusClass(item.status)}`}>{activeCols.map(c=><Cell key={c.key} column={c} item={item} workers={workers} updateItem={updateItem}/>) }<td className="p-2"><button onClick={()=>deleteItem(item)} className="text-red-600"><Trash2 className="h-4 w-4"/></button></td></tr>)}</tbody></table></div>}</Card>
  </section></main>;
}

function Cell({column,item,workers,updateItem}:any){const k:ColKey=column.key;if(k==="status")return <td className="p-2"><SelectMini value={item.status||"Nuevo"} onChange={(v:string)=>updateItem(item,{status:v})} options={statuses}/></td>; if(k==="comments")return <td className="p-2"><input disabled={!["Incidencia","Incidencia llamada","Resuelto - Pendiente colocador"].includes(item.status||"")} value={item.comments||""} onChange={e=>updateItem(item,{comments:e.target.value})} className="w-48 rounded-xl border px-2 py-1 disabled:bg-slate-100"/></td>; if(k==="base_payment")return <td className="p-2 text-right"><input type="number" value={item.base_payment||0} onChange={e=>updateItem(item,{base_payment:Number(e.target.value)})} className="w-20 rounded-xl border px-2 py-1 text-right"/></td>; if(k==="payment_total")return <td className="whitespace-nowrap p-2 text-right font-semibold">{eur(item.payment_total||0)}</td>; if(k==="desired_installation_week")return <td className="p-2"><input value={item.desired_installation_week||item.payment_week||""} onChange={e=>updateItem(item,{desired_installation_week:e.target.value,payment_week:e.target.value})} className="w-44 rounded-xl border px-2 py-1"/></td>; if(k==="desired_installation_date")return <td className="p-2"><input type="date" value={dateOnly(item.desired_installation_date)} onChange={e=>updateItem(item,{desired_installation_date:e.target.value})} className="rounded-xl border px-2 py-1"/></td>; if(k==="next_visit_date")return <td className="p-2"><input type="date" value={dateOnly(item.next_visit_date)} onChange={e=>updateItem(item,{next_visit_date:e.target.value})} className="rounded-xl border px-2 py-1"/></td>; if(k==="incident_payment_week")return <td className="p-2"><input value={item.incident_payment_week||""} onChange={e=>updateItem(item,{incident_payment_week:e.target.value})} className="w-44 rounded-xl border px-2 py-1"/></td>; if(k==="installation_payment_week")return <td className="p-2"><input value={item.installation_payment_week||""} onChange={e=>updateItem(item,{installation_payment_week:e.target.value})} className="w-44 rounded-xl border px-2 py-1"/></td>; if(k==="installer")return <td className="p-2"><SelectMini value={item.installer_id||""} onChange={(id:string)=>updateItem(item,{installer_id:id||null})} options={["",...workers.map((w:Worker)=>w.id)]} labels={{"":"Sin asignar",...Object.fromEntries(workers.map((w:Worker)=>[w.id,w.name]))}}/></td>; if(k==="height"||k==="width")return <td className="p-2 text-right">{(item as any)[k]}</td>; return <td className="max-w-[260px] whitespace-nowrap p-2"><span className="block truncate" title={colValue(item,k)}>{colValue(item,k)}</span></td>}
function Card({children}:{children:any}){return <div className="rounded-3xl border bg-white p-5 shadow-sm">{children}</div>}
function Kpi({label,value,hint}:{label:string;value:any;hint?:string}){return <Card><p className="text-sm text-slate-500">{label}</p><p className="text-2xl font-bold">{value}</p>{hint&&<p className="mt-1 text-xs text-slate-400">{hint}</p>}</Card>}
function KpiCard({title,children}:any){return <Card><h3 className="mb-3 font-semibold">{title}</h3>{children}</Card>}
function Metric({label,value}:any){return <div className="flex justify-between border-b py-2 text-sm"><span className="text-slate-500">{label}</span><b>{value}</b></div>}
function Input({label,value,onChange}:any){return <label className="block"><span className="text-sm font-medium">{label}</span><input value={value??""} onChange={e=>onChange(e.target.value)} className="w-full rounded-2xl border px-3 py-2"/></label>}
function Select({label,value,onChange,options,labels={}}:any){return <label className="block"><span className="text-sm font-medium">{label}</span><select value={value??""} onChange={e=>onChange(e.target.value)} className="w-full rounded-2xl border bg-white px-3 py-2">{options.map((o:string)=><option key={o} value={o}>{labels[o]||o||"Seleccionar"}</option>)}</select></label>}
function SelectMini({value,onChange,options,labels={}}:any){return <select value={value??""} onChange={e=>onChange(e.target.value)} className="rounded-xl border bg-white px-2 py-1 text-xs">{options.map((o:string)=><option key={o} value={o}>{labels[o]||o||"Seleccionar"}</option>)}</select>}

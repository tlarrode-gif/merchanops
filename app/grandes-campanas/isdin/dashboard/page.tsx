"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, Download, Eye, FileText } from "lucide-react";
import { isSupabaseConfigured, supabase } from "@/lib/supabase";

type Worker = { id: string; name: string; province?: string | null };
type IsdinVinyl = {
  id: string;
  pharmacy_name: string;
  vinyl: string;
  status?: string | null;
  comments?: string | null;
  client_observations?: string | null;
  vinyl_record_type?: string | null;
  vinyl_campaign?: string | null;
  desired_installation_week?: string | null;
  desired_installation_date?: string | null;
  next_visit_date?: string | null;
  city?: string | null;
  postal_code?: string | null;
  province?: string | null;
  installer_id?: string | null;
  installer_name?: string | null;
  scaffold_required?: boolean | null;
  revisit_count?: number | null;
  payment_week?: string | null;
  status_changed_at?: string | null;
};

type SectionKey = "executive" | "funnel" | "incidents" | "weeks" | "province" | "vinylType" | "workers" | "risks";
type GroupRow = { name: string; total: number; finalizados: number; incidencias: number; cancelados: number; pendientesColocador: number; nuevos: number; pospuestos: number; avance: number; tasaIncidencia: number; riesgo: string };

const CLIENT = "ISDIN";
const CECO = "3159";
const openBacklogStatuses = ["Nuevo", "Resuelto - Pendiente colocador", "Incidencia"];
const sections: Record<SectionKey, string> = {
  executive: "Resumen ejecutivo",
  funnel: "Embudo operativo",
  incidents: "Incidencias y pospuestos",
  weeks: "Análisis por semana",
  province: "Análisis por provincia",
  vinylType: "Análisis por tipo/campaña",
  workers: "Seguimiento por instalador",
  risks: "Riesgos y focos de mejora"
};
const defaultSections: Record<SectionKey, boolean> = Object.fromEntries(Object.keys(sections).map(k => [k, true])) as Record<SectionKey, boolean>;

function pct(n: number, d: number) { return d ? Math.round((n / d) * 100) : 0; }
function status(v: IsdinVinyl) { return v.status || "Nuevo"; }
function isFinal(v: IsdinVinyl) { return status(v) === "Finalizado"; }
function isCancel(v: IsdinVinyl) { return status(v) === "Cancelado"; }
function isIncident(v: IsdinVinyl) { return status(v) === "Incidencia"; }
function isPendingInstaller(v: IsdinVinyl) { return status(v) === "Resuelto - Pendiente colocador"; }
function isNew(v: IsdinVinyl) { return status(v) === "Nuevo"; }
function isManaged(v: IsdinVinyl) { return isFinal(v) || isCancel(v) || isIncident(v) || isPendingInstaller(v); }
function esc(s: unknown) { return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }
function localLoad(): IsdinVinyl[] { try { const raw = localStorage.getItem("merchanops_isdin_local_v381"); if (raw) return JSON.parse(raw); } catch {} return []; }
function mondayOf(date = new Date()) { const d = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 12); const jsDay = d.getDay(); const diff = jsDay === 0 ? -6 : 1 - jsDay; d.setDate(d.getDate() + diff); return d; }
function cap(s: string) { return s.charAt(0).toUpperCase() + s.slice(1); }
function weekLabelFromDate(date = new Date()) { const monday = mondayOf(date); const month = cap(new Intl.DateTimeFormat("es-ES", { month: "long" }).format(monday)); return `Semana ${monday.getDate()} ${month} ${monday.getFullYear()}`; }
function monthIndex(name: string) { const normalized = name.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, ""); return ["enero","febrero","marzo","abril","mayo","junio","julio","agosto","septiembre","octubre","noviembre","diciembre"].indexOf(normalized); }
function weekStartFromLabel(label?: string | null) { const m = String(label || "").match(/Semana\s+(\d+)\s+([A-Za-zÁÉÍÓÚÜÑáéíóúüñ]+)\s+(20\d{2})/i); if (!m) return null; const month = monthIndex(m[2]); if (month < 0) return null; return new Date(Number(m[3]), month, Number(m[1]), 12); }
function currentWeekInfo() { const start = mondayOf(new Date()); const label = weekLabelFromDate(start); return { label, start }; }
function itemWeek(v: IsdinVinyl) { return v.payment_week || v.desired_installation_week || "Sin semana"; }
function isCurrentWeek(v: IsdinVinyl) { const cur = currentWeekInfo(); const parsed = weekStartFromLabel(itemWeek(v)); if (parsed) return parsed.getTime() === cur.start.getTime(); const d = v.desired_installation_date ? new Date(v.desired_installation_date + "T12:00:00") : null; return !!d && weekLabelFromDate(d) === cur.label; }
function isPastWeek(v: IsdinVinyl) { const cur = currentWeekInfo(); const parsed = weekStartFromLabel(itemWeek(v)); if (parsed) return parsed.getTime() < cur.start.getTime(); const d = v.desired_installation_date ? mondayOf(new Date(v.desired_installation_date + "T12:00:00")) : null; return !!d && d.getTime() < cur.start.getTime(); }
function defaultScope(v: IsdinVinyl) { return isCurrentWeek(v) || (isPastWeek(v) && openBacklogStatuses.includes(status(v))); }
function riskFor(row: { avance: number; tasaIncidencia: number; total: number; nuevos?: number; pospuestos?: number }) { if (!row.total) return "Sin datos"; if (row.avance < 50 || row.tasaIncidencia >= 20 || Number(row.nuevos || 0) + Number(row.pospuestos || 0) > row.total * 0.5) return "Alto"; if (row.avance < 80 || row.tasaIncidencia >= 10) return "Medio"; return "Bajo"; }
function groupBy(items: IsdinVinyl[], keyFn: (v: IsdinVinyl) => string): GroupRow[] { const map = new Map<string, IsdinVinyl[]>(); items.forEach(v => { const key = keyFn(v) || "Sin dato"; map.set(key, [...(map.get(key) || []), v]); }); return Array.from(map.entries()).map(([name, rows]) => { const total = rows.length; const finalizados = rows.filter(isFinal).length; const incidencias = rows.filter(isIncident).length; const cancelados = rows.filter(isCancel).length; const pendientesColocador = rows.filter(isPendingInstaller).length; const nuevos = rows.filter(isNew).length; const pospuestos = pendientesColocador; const avance = pct(finalizados + cancelados, total); const tasaIncidencia = pct(incidencias, total); return { name, total, finalizados, incidencias, cancelados, pendientesColocador, nuevos, pospuestos, avance, tasaIncidencia, riesgo: riskFor({ avance, tasaIncidencia, total, nuevos, pospuestos }) }; }).sort((a, b) => b.total - a.total); }
function downloadHtml(filename: string, html: string) { const blob = new Blob([html], { type: "text/html;charset=utf-8" }); const url = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = url; a.download = filename; a.click(); URL.revokeObjectURL(url); }

export default function IsdinDashboardPage() {
  const [items, setItems] = useState<IsdinVinyl[]>([]);
  const [workers, setWorkers] = useState<Worker[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Record<SectionKey, boolean>>(defaultSections);
  const [filters, setFilters] = useState({ week: "", province: "", installer: "" });

  async function refresh() { setLoading(true); if (isSupabaseConfigured && supabase) { const [{ data: v }, { data: w }] = await Promise.all([supabase.from("isdin_vinyls").select("*").order("desired_installation_week", { ascending: true }), supabase.from("workers").select("*").order("name")]); setItems((v || []) as IsdinVinyl[]); setWorkers((w || []) as Worker[]); } else { setItems(localLoad()); setWorkers([]); } setLoading(false); }
  useEffect(() => { refresh(); }, []);

  const currentWeek = currentWeekInfo().label;
  const weeks = Array.from(new Set(items.map(x => itemWeek(x)).filter(Boolean))) as string[];
  const provinces = Array.from(new Set(items.map(x => x.province).filter(Boolean))) as string[];
  const scoped = items.filter(x => filters.week ? itemWeek(x) === filters.week : defaultScope(x));
  const filtered = scoped.filter(x => (!filters.province || x.province === filters.province) && (!filters.installer || x.installer_id === filters.installer));

  const stats = useMemo(() => { const total = filtered.length; const finalizados = filtered.filter(isFinal).length; const cancelados = filtered.filter(isCancel).length; const incidencias = filtered.filter(isIncident).length; const pendientesColocador = filtered.filter(isPendingInstaller).length; const nuevos = filtered.filter(isNew).length; const gestionados = filtered.filter(isManaged).length; const andamios = filtered.filter(x => x.scaffold_required).length; const revisitas = filtered.reduce((a, x) => a + Number(x.revisit_count || 0), 0); const avance = pct(finalizados + cancelados, total); const avanceGestion = pct(gestionados, total); const tasaInstalacionEfectiva = pct(finalizados, gestionados); const tasaIncidencia = pct(incidencias, total); const tasaPospuesto = pct(pendientesColocador, total); const backlog = nuevos + incidencias + pendientesColocador; return { total, finalizados, cancelados, incidencias, pendientesColocador, nuevos, gestionados, andamios, revisitas, avance, avanceGestion, tasaInstalacionEfectiva, tasaIncidencia, tasaPospuesto, backlog, riesgo: riskFor({ avance, tasaIncidencia, total, nuevos, pospuestos: pendientesColocador }) }; }, [filtered]);
  const weekly = groupBy(filtered, x => itemWeek(x));
  const byProvince = groupBy(filtered, x => x.province || "Sin provincia");
  const byType = groupBy(filtered, x => x.vinyl_record_type || "Sin tipo");
  const byCampaign = groupBy(filtered, x => x.vinyl_campaign || "Sin campaña");
  const byWorker = groupBy(filtered, x => x.installer_name || "Sin instalador");
  const risks = [...weekly.map(x => ({ scope: "Semana", ...x })), ...byProvince.map(x => ({ scope: "Provincia", ...x })), ...byWorker.map(x => ({ scope: "Instalador", ...x }))].filter(x => x.riesgo !== "Bajo").sort((a, b) => (a.riesgo === "Alto" ? -1 : 1) - (b.riesgo === "Alto" ? -1 : 1) || b.total - a.total).slice(0, 12);

  function htmlTable(rows: any[], title: string) { return `<section class="card"><h2>${esc(title)}</h2><table><thead><tr><th>Concepto</th><th>Total</th><th>Avance</th><th>Incidencias</th><th>Pospuestos</th><th>Riesgo</th></tr></thead><tbody>${rows.map(r => `<tr><td>${esc(r.name)}</td><td>${r.total}</td><td>${r.avance}%</td><td>${r.incidencias}</td><td>${r.pendientesColocador}</td><td><b>${esc(r.riesgo)}</b></td></tr>`).join("")}</tbody></table></section>`; }
  function buildHtml() { const parts: string[] = []; if (selected.executive) parts.push(`<section class="hero"><h1>Informe estratégico ISDIN</h1><p>Cliente: ${CLIENT} · CECO ${CECO}</p><p>Alcance: ${filters.week ? esc(filters.week) : `Semana actual (${esc(currentWeek)}) + backlog vencido abierto`}</p><p>Fecha de exportación: ${new Date().toLocaleString("es-ES")}</p><div class="grid"><div><span>Avance operativo</span><b>${stats.avance}%</b></div><div><span>Instalación efectiva</span><b>${stats.tasaInstalacionEfectiva}%</b></div><div><span>Incidencias</span><b>${stats.incidencias}</b></div><div><span>Pospuestos</span><b>${stats.pendientesColocador}</b></div><div><span>Backlog abierto</span><b>${stats.backlog}</b></div><div><span>Riesgo</span><b>${stats.riesgo}</b></div></div></section>`); if (selected.funnel) parts.push(`<section class="card"><h2>Embudo operativo</h2><div class="grid"><div><span>Total</span><b>${stats.total}</b></div><div><span>Nuevos</span><b>${stats.nuevos}</b></div><div><span>Gestionados</span><b>${stats.gestionados}</b></div><div><span>Finalizados</span><b>${stats.finalizados}</b></div><div><span>Cancelados</span><b>${stats.cancelados}</b></div><div><span>Pospuestos</span><b>${stats.pendientesColocador}</b></div></div></section>`); if (selected.incidents) parts.push(`<section class="card"><h2>Incidencias y pospuestos</h2><div class="grid"><div><span>Incidencias abiertas</span><b>${stats.incidencias}</b></div><div><span>Tasa incidencia</span><b>${stats.tasaIncidencia}%</b></div><div><span>Pospuestos</span><b>${stats.pendientesColocador}</b></div><div><span>Tasa pospuesto</span><b>${stats.tasaPospuesto}%</b></div></div></section>`); if (selected.weeks) parts.push(htmlTable(weekly, "Análisis por semana")); if (selected.province) parts.push(htmlTable(byProvince, "Análisis por provincia")); if (selected.vinylType) parts.push(htmlTable(byType, "Análisis por tipo de vinilo") + htmlTable(byCampaign.slice(0, 15), "Análisis por campaña")); if (selected.workers) parts.push(htmlTable(byWorker, "Seguimiento por instalador")); if (selected.risks) parts.push(htmlTable(risks as any[], "Riesgos y focos de mejora")); return `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Informe ISDIN</title><style>body{font-family:Arial,sans-serif;background:#f1f5f9;color:#0f172a;margin:0;padding:32px}.hero,.card{background:#fff;border:1px solid #e2e8f0;border-radius:22px;padding:24px;margin-bottom:18px;box-shadow:0 4px 18px rgba(15,23,42,.06)}h1{font-size:34px;margin:0 0 8px}h2{margin:0 0 16px}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:12px}.grid div{background:#f8fafc;border-radius:16px;padding:14px}.grid span{display:block;color:#64748b;font-size:12px}.grid b{font-size:24px}table{width:100%;border-collapse:collapse;font-size:13px}th{background:#0f172a;color:white;text-align:left;padding:10px}td{border-bottom:1px solid #e2e8f0;padding:9px}tr:nth-child(even)td{background:#f8fafc}.footer{color:#64748b;font-size:12px;margin-top:24px}</style></head><body>${parts.join("")}<p class="footer">Informe generado desde MerchanOps · ISDIN · CECO ${CECO}</p></body></html>`; }
  function exportHtml() { downloadHtml("informe_estrategico_isdin.html", buildHtml()); }
  function previewHtml() { const w = window.open("", "_blank"); if (w) { w.document.open(); w.document.write(buildHtml()); w.document.close(); } }

  return <main className="isdin-page min-h-screen bg-slate-100 text-slate-900"><header className="sticky top-0 z-10 border-b bg-white"><div className="mx-auto flex max-w-7xl flex-col gap-3 px-4 py-4 md:flex-row md:items-center md:justify-between"><div><a href="/grandes-campanas/isdin" className="mb-2 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-900"><ArrowLeft className="h-4 w-4"/>Volver a ISDIN Vinilos</a><h1 className="text-3xl font-bold">Dashboard estratégico ISDIN</h1><p className="text-sm text-slate-500">Por defecto: semana actual + vinilos abiertos vencidos de semanas anteriores. No incluye costes internos ni pagos a instaladores.</p></div><div className="flex flex-wrap gap-2"><button onClick={previewHtml} className="rounded-2xl border bg-white px-4 py-2"><Eye className="mr-1 inline h-4 w-4"/>Vista previa HTML</button><button onClick={exportHtml} className="rounded-2xl bg-slate-900 px-4 py-2 text-white"><Download className="mr-1 inline h-4 w-4"/>Exportar HTML</button></div></div></header><section className="mx-auto max-w-7xl space-y-5 p-4">{!isSupabaseConfigured&&<div className="rounded-2xl border bg-amber-50 p-3 text-sm">Modo local: este dashboard usa los datos guardados en este navegador.</div>}<Card><div className="mb-4 flex items-center gap-2"><FileText className="h-5 w-5"/><h2 className="text-xl font-semibold">Configurar informe</h2></div><p className="mb-3 rounded-2xl bg-slate-50 p-3 text-sm text-slate-600">Alcance actual: <b>{filters.week ? filters.week : `Semana actual (${currentWeek}) + backlog abierto de semanas anteriores`}</b></p><div className="grid gap-3 md:grid-cols-3"><Select label="Semana" value={filters.week} onChange={(v:string)=>setFilters({...filters,week:v})} options={["",...weeks]} labels={{"":"Actual + backlog"}}/><Select label="Provincia" value={filters.province} onChange={(v:string)=>setFilters({...filters,province:v})} options={["",...provinces]} labels={{"":"Todas"}}/><Select label="Instalador" value={filters.installer} onChange={(v:string)=>setFilters({...filters,installer:v})} options={["",...workers.map(w=>w.id)]} labels={{"":"Todos",...Object.fromEntries(workers.map(w=>[w.id,w.name]))}}/></div><div className="mt-4 grid gap-2 md:grid-cols-4">{(Object.keys(sections) as SectionKey[]).map(k=><label key={k} className="flex items-center gap-2 rounded-xl border bg-white p-2 text-sm"><input type="checkbox" checked={selected[k]} onChange={e=>setSelected({...selected,[k]:e.target.checked})}/>{sections[k]}</label>)}</div></Card>{loading?<Card>Cargando KPIs...</Card>:<><div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4"><ProgressKpi label="Avance operativo" value={stats.avance} detail={`${stats.finalizados + stats.cancelados}/${stats.total} cerrados`}/><ProgressKpi label="Instalación efectiva" value={stats.tasaInstalacionEfectiva} detail={`${stats.finalizados}/${stats.gestionados} gestionados`}/><ProgressKpi label="Tasa incidencia" value={stats.tasaIncidencia} inverse detail={`${stats.incidencias} incidencias`}/><ProgressKpi label="Tasa pospuesto" value={stats.tasaPospuesto} inverse detail={`${stats.pendientesColocador} pospuestos`}/></div><div className="grid gap-3 md:grid-cols-3 lg:grid-cols-6"><Kpi label="Total alcance" value={stats.total}/><Kpi label="Backlog abierto" value={stats.backlog}/><Kpi label="Nuevos" value={stats.nuevos}/><Kpi label="Incidencias" value={stats.incidencias}/><Kpi label="Pospuestos" value={stats.pendientesColocador}/><Kpi label="Riesgo" value={stats.riesgo}/></div><div className="grid gap-4 lg:grid-cols-3"><Panel title="Resumen ejecutivo"><Metric label="Finalizados" value={stats.finalizados}/><Metric label="Cancelados" value={stats.cancelados}/><Metric label="Pendientes actuales" value={stats.nuevos + stats.pendientesColocador + stats.incidencias}/><Metric label="Andamios" value={stats.andamios}/><Metric label="Revisitas" value={stats.revisitas}/></Panel><Panel title="Incidencias y pospuestos"><Metric label="Incidencias abiertas" value={stats.incidencias}/><Metric label="Tasa incidencia" value={`${stats.tasaIncidencia}%`}/><Metric label="Pospuestos" value={stats.pendientesColocador}/><Metric label="Tasa pospuesto" value={`${stats.tasaPospuesto}%`}/></Panel><Panel title="Seguimiento operativo"><Metric label="Alcance por defecto" value={filters.week ? filters.week : "Actual + backlog"}/><Metric label="Semana actual" value={currentWeek}/><Metric label="Registros visibles" value={filtered.length}/><Metric label="Riesgo" value={stats.riesgo}/></Panel></div><div className="grid gap-4 lg:grid-cols-2"><TableCard title="Cumplimiento por semana" rows={weekly}/><TableCard title="Cobertura por provincia" rows={byProvince}/><TableCard title="Tipo de vinilo" rows={byType}/><TableCard title="Seguimiento por instalador" rows={byWorker}/></div>{risks.length>0&&<TableCard title="Riesgos prioritarios" rows={risks as any[]}/>}</>}</section></main>;
}

function Card({children}:{children:any}){return <div className="rounded-3xl border bg-white p-5 shadow-sm">{children}</div>}
function Kpi({label,value}:{label:string;value:any}){return <Card><p className="text-sm text-slate-500">{label}</p><p className="text-2xl font-bold">{value}</p></Card>}
function ProgressKpi({label,value,detail,inverse=false}:{label:string;value:number;detail:string;inverse?:boolean}){const v=Math.max(0,Math.min(100,value||0));const color=inverse?(v>=20?"#dc2626":v>=10?"#d97706":"#16a34a"):(v>=80?"#16a34a":v>=50?"#d97706":"#dc2626");return <Card><div className="flex items-center gap-4"><div className="grid h-24 w-24 place-items-center rounded-full" style={{background:`conic-gradient(${color} ${v*3.6}deg,#e2e8f0 0deg)`}}><div className="grid h-16 w-16 place-items-center rounded-full bg-white text-lg font-bold">{v}%</div></div><div><p className="text-sm text-slate-500">{label}</p><p className="text-sm font-medium">{detail}</p></div></div></Card>}
function Panel({title,children}:any){return <Card><h3 className="mb-3 font-semibold">{title}</h3>{children}</Card>}
function Metric({label,value}:any){return <div className="flex justify-between border-b py-2 text-sm"><span className="text-slate-500">{label}</span><b>{value}</b></div>}
function TableCard({title,rows}:{title:string;rows:GroupRow[]}){return <Card><h3 className="mb-3 font-semibold">{title}</h3><div className="overflow-auto"><table className="w-full text-sm"><thead><tr className="bg-slate-900 text-white"><th className="p-2 text-left">Concepto</th><th className="p-2 text-right">Total</th><th className="p-2 text-right">Avance</th><th className="p-2 text-right">Incid.</th><th className="p-2 text-right">Posp.</th><th className="p-2 text-left">Riesgo</th></tr></thead><tbody>{rows.slice(0,12).map(r=><tr key={r.name} className="border-t"><td className="p-2">{r.name}</td><td className="p-2 text-right">{r.total}</td><td className="p-2 text-right">{r.avance}%</td><td className="p-2 text-right">{r.incidencias}</td><td className="p-2 text-right">{r.pendientesColocador}</td><td className="p-2 font-semibold">{r.riesgo}</td></tr>)}</tbody></table></div></Card>}
function Select({label,value,onChange,options,labels={}}:any){return <label className="block"><span className="text-sm font-medium">{label}</span><select value={value??""} onChange={e=>onChange(e.target.value)} className="w-full rounded-2xl border bg-white px-3 py-2">{options.map((o:string)=><option key={o} value={o}>{labels[o]||o||"Seleccionar"}</option>)}</select></label>}

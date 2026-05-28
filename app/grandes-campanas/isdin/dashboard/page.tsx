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

type SectionKey = "executive" | "funnel" | "incidents" | "cost" | "quality" | "weeks" | "province" | "vinylType" | "workers" | "risks";

type GroupRow = { name: string; total: number; finalizados: number; incidencias: number; cancelados: number; pendientesColocador: number; nuevos: number; pago: number; avance: number; tasaIncidencia: number; riesgo: string };

const CECO = "3159";
const CLIENT = "ISDIN";
const sections: Record<SectionKey, string> = {
  executive: "Resumen ejecutivo",
  funnel: "Embudo operativo",
  incidents: "Incidencias y resolución",
  cost: "Coste y sobrecoste",
  quality: "Calidad de datos",
  weeks: "Análisis por semana",
  province: "Análisis por provincia",
  vinylType: "Análisis por tipo/campaña de vinilo",
  workers: "Performance por instalador",
  risks: "Riesgos y focos de mejora"
};
const defaultSections: Record<SectionKey, boolean> = Object.fromEntries(Object.keys(sections).map(k => [k, true])) as Record<SectionKey, boolean>;

function eur(v: number) { return new Intl.NumberFormat("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(v || 0)) + " €"; }
function pct(n: number, d: number) { return d ? Math.round((n / d) * 100) : 0; }
function status(v: IsdinVinyl) { return v.status || "Nuevo"; }
function isFinal(v: IsdinVinyl) { return status(v) === "Finalizado"; }
function isCancel(v: IsdinVinyl) { return status(v) === "Cancelado"; }
function isIncident(v: IsdinVinyl) { return status(v) === "Incidencia"; }
function isPendingInstaller(v: IsdinVinyl) { return status(v) === "Resuelto - Pendiente colocador"; }
function isNew(v: IsdinVinyl) { return status(v) === "Nuevo"; }
function isManaged(v: IsdinVinyl) { return isFinal(v) || isCancel(v) || isIncident(v) || isPendingInstaller(v); }
function isFailedVisit(v: IsdinVinyl) { return isIncident(v) || isCancel(v) || isPendingInstaller(v); }
function esc(s: unknown) { return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }
function riskFor(row: { avance: number; tasaIncidencia: number; total: number; nuevos?: number }) { if (!row.total) return "Sin datos"; if (row.avance < 50 || row.tasaIncidencia >= 20 || Number(row.nuevos || 0) > row.total * 0.5) return "Alto"; if (row.avance < 80 || row.tasaIncidencia >= 10) return "Medio"; return "Bajo"; }
function localLoad(): IsdinVinyl[] { try { const raw = localStorage.getItem("merchanops_isdin_local_v3"); if (raw) return JSON.parse(raw); } catch {} return []; }
function groupBy(items: IsdinVinyl[], keyFn: (v: IsdinVinyl) => string): GroupRow[] {
  const map = new Map<string, IsdinVinyl[]>();
  items.forEach(v => { const key = keyFn(v) || "Sin dato"; map.set(key, [...(map.get(key) || []), v]); });
  return Array.from(map.entries()).map(([name, rows]) => {
    const total = rows.length;
    const finalizados = rows.filter(isFinal).length;
    const incidencias = rows.filter(isIncident).length;
    const cancelados = rows.filter(isCancel).length;
    const pendientesColocador = rows.filter(isPendingInstaller).length;
    const nuevos = rows.filter(isNew).length;
    const pago = rows.reduce((a, x) => a + Number(x.payment_total || 0), 0);
    const avance = pct(finalizados + cancelados, total);
    const tasaIncidencia = pct(incidencias, total);
    return { name, total, finalizados, incidencias, cancelados, pendientesColocador, nuevos, pago, avance, tasaIncidencia, riesgo: riskFor({ avance, tasaIncidencia, total, nuevos }) };
  }).sort((a, b) => b.total - a.total);
}
function downloadHtml(filename: string, html: string) { const blob = new Blob([html], { type: "text/html;charset=utf-8" }); const url = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = url; a.download = filename; a.click(); URL.revokeObjectURL(url); }

export default function IsdinDashboardPage() {
  const [items, setItems] = useState<IsdinVinyl[]>([]);
  const [workers, setWorkers] = useState<Worker[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Record<SectionKey, boolean>>(defaultSections);
  const [filters, setFilters] = useState({ week: "", province: "", installer: "" });

  async function refresh() {
    setLoading(true);
    if (isSupabaseConfigured && supabase) {
      const [{ data: v }, { data: w }] = await Promise.all([
        supabase.from("isdin_vinyls").select("*").order("desired_installation_week", { ascending: true }),
        supabase.from("workers").select("*").order("name")
      ]);
      setItems((v || []) as IsdinVinyl[]);
      setWorkers((w || []) as Worker[]);
    } else {
      setItems(localLoad());
      setWorkers([]);
    }
    setLoading(false);
  }

  useEffect(() => { refresh(); }, []);

  const weeks = Array.from(new Set(items.map(x => x.payment_week || x.desired_installation_week).filter(Boolean))) as string[];
  const provinces = Array.from(new Set(items.map(x => x.province).filter(Boolean))) as string[];
  const filtered = items.filter(x => (!filters.week || (x.payment_week || x.desired_installation_week) === filters.week) && (!filters.province || x.province === filters.province) && (!filters.installer || x.installer_id === filters.installer));

  const stats = useMemo(() => {
    const total = filtered.length;
    const finalizados = filtered.filter(isFinal).length;
    const cancelados = filtered.filter(isCancel).length;
    const incidencias = filtered.filter(isIncident).length;
    const pendientesColocador = filtered.filter(isPendingInstaller).length;
    const nuevos = filtered.filter(isNew).length;
    const gestionados = filtered.filter(isManaged).length;
    const fallidas = filtered.filter(isFailedVisit).length;
    const sinInstalador = filtered.filter(x => !x.installer_id && !x.installer_name).length;
    const sinSemana = filtered.filter(x => !(x.payment_week || x.desired_installation_week)).length;
    const sinPago = filtered.filter(x => !Number(x.base_payment || 0)).length;
    const sinDireccion = filtered.filter(x => !x.street || !x.city || !x.postal_code || !x.province).length;
    const duplicados = filtered.length - new Set(filtered.map(x => x.vinyl)).size;
    const pagoTotal = filtered.reduce((a, x) => a + Number(x.payment_total || 0), 0);
    const pagoBase = filtered.reduce((a, x) => a + Number(x.base_payment || 0), 0);
    const sobrecoste = Math.max(0, pagoTotal - filtered.filter(isFinal).reduce((a, x) => a + Number(x.base_payment || 0), 0));
    const avance = pct(finalizados + cancelados, total);
    const avanceAdmin = pct(gestionados, total);
    const tasaInstalacionEfectiva = pct(finalizados, gestionados);
    const tasaFallida = pct(fallidas, gestionados);
    const tasaIncidencia = pct(incidencias, total);
    const calidadDatos = pct(total - sinInstalador - sinSemana - sinPago - sinDireccion - duplicados, total);
    return { total, finalizados, cancelados, incidencias, pendientesColocador, nuevos, gestionados, fallidas, sinInstalador, sinSemana, sinPago, sinDireccion, duplicados, pagoTotal, pagoBase, sobrecoste, avance, avanceAdmin, tasaInstalacionEfectiva, tasaFallida, tasaIncidencia, calidadDatos, riesgo: riskFor({ avance, tasaIncidencia, total, nuevos }) };
  }, [filtered]);

  const weekly = groupBy(filtered, x => x.payment_week || x.desired_installation_week || "Sin semana");
  const byProvince = groupBy(filtered, x => x.province || "Sin provincia");
  const byType = groupBy(filtered, x => x.vinyl_record_type || "Sin tipo");
  const byCampaign = groupBy(filtered, x => x.vinyl_campaign || "Sin campaña");
  const byWorker = groupBy(filtered, x => x.installer_name || "Sin instalador");
  const risks = [...weekly.map(x => ({ scope: "Semana", ...x })), ...byProvince.map(x => ({ scope: "Provincia", ...x })), ...byWorker.map(x => ({ scope: "Instalador", ...x }))].filter(x => x.riesgo !== "Bajo").sort((a, b) => (a.riesgo === "Alto" ? -1 : 1) - (b.riesgo === "Alto" ? -1 : 1) || b.total - a.total).slice(0, 12);

  function htmlTable(rows: any[], title: string) {
    return `<section class="card"><h2>${esc(title)}</h2><table><thead><tr><th>Concepto</th><th>Total</th><th>Avance</th><th>Incidencias</th><th>Pend. colocador</th><th>Pago</th><th>Riesgo</th></tr></thead><tbody>${rows.map(r => `<tr><td>${esc(r.name)}</td><td>${r.total}</td><td>${r.avance}%</td><td>${r.incidencias}</td><td>${r.pendientesColocador}</td><td>${eur(r.pago)}</td><td><b>${esc(r.riesgo)}</b></td></tr>`).join("")}</tbody></table></section>`;
  }

  function buildHtml() {
    const parts: string[] = [];
    if (selected.executive) parts.push(`<section class="hero"><h1>Informe estratégico ISDIN</h1><p>Cliente: ${CLIENT} · CECO ${CECO}</p><p>Fecha de exportación: ${new Date().toLocaleString("es-ES")}</p><div class="grid"><div><span>Avance operativo</span><b>${stats.avance}%</b></div><div><span>Avance administrativo</span><b>${stats.avanceAdmin}%</b></div><div><span>Instalación efectiva</span><b>${stats.tasaInstalacionEfectiva}%</b></div><div><span>Visita fallida</span><b>${stats.tasaFallida}%</b></div><div><span>Pago total</span><b>${eur(stats.pagoTotal)}</b></div><div><span>Riesgo</span><b>${stats.riesgo}</b></div></div></section>`);
    if (selected.funnel) parts.push(`<section class="card"><h2>Embudo operativo</h2><div class="grid"><div><span>Total</span><b>${stats.total}</b></div><div><span>Nuevos</span><b>${stats.nuevos}</b></div><div><span>Gestionados</span><b>${stats.gestionados}</b></div><div><span>Finalizados</span><b>${stats.finalizados}</b></div><div><span>Cancelados</span><b>${stats.cancelados}</b></div><div><span>Pend. colocador</span><b>${stats.pendientesColocador}</b></div></div></section>`);
    if (selected.incidents) parts.push(`<section class="card"><h2>Incidencias y resolución</h2><div class="grid"><div><span>Incidencias abiertas</span><b>${stats.incidencias}</b></div><div><span>Tasa incidencia</span><b>${stats.tasaIncidencia}%</b></div><div><span>Visitas fallidas</span><b>${stats.fallidas}</b></div><div><span>Tasa visita fallida</span><b>${stats.tasaFallida}%</b></div></div></section>`);
    if (selected.cost) parts.push(`<section class="card"><h2>Coste y sobrecoste</h2><div class="grid"><div><span>Pago total campaña</span><b>${eur(stats.pagoTotal)}</b></div><div><span>Pago base previsto</span><b>${eur(stats.pagoBase)}</b></div><div><span>Sobrecoste operativo estimado</span><b>${eur(stats.sobrecoste)}</b></div></div></section>`);
    if (selected.quality) parts.push(`<section class="card"><h2>Calidad de datos</h2><div class="grid"><div><span>Índice calidad</span><b>${stats.calidadDatos}%</b></div><div><span>Sin instalador</span><b>${stats.sinInstalador}</b></div><div><span>Sin semana</span><b>${stats.sinSemana}</b></div><div><span>Sin pago</span><b>${stats.sinPago}</b></div><div><span>Dirección incompleta</span><b>${stats.sinDireccion}</b></div><div><span>VIN duplicados</span><b>${stats.duplicados}</b></div></div></section>`);
    if (selected.weeks) parts.push(htmlTable(weekly, "Análisis por semana"));
    if (selected.province) parts.push(htmlTable(byProvince, "Análisis por provincia"));
    if (selected.vinylType) parts.push(htmlTable(byType, "Análisis por tipo de vinilo") + htmlTable(byCampaign.slice(0, 15), "Análisis por campaña de vinilos"));
    if (selected.workers) parts.push(htmlTable(byWorker, "Performance por instalador"));
    if (selected.risks) parts.push(htmlTable(risks as any[], "Riesgos y focos de mejora"));
    return `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Informe ISDIN</title><style>body{font-family:Arial,sans-serif;background:#f1f5f9;color:#0f172a;margin:0;padding:32px}.hero,.card{background:#fff;border:1px solid #e2e8f0;border-radius:22px;padding:24px;margin-bottom:18px;box-shadow:0 4px 18px rgba(15,23,42,.06)}h1{font-size:34px;margin:0 0 8px}h2{margin:0 0 16px}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:12px}.grid div{background:#f8fafc;border-radius:16px;padding:14px}.grid span{display:block;color:#64748b;font-size:12px}.grid b{font-size:24px}table{width:100%;border-collapse:collapse;font-size:13px}th{background:#0f172a;color:white;text-align:left;padding:10px}td{border-bottom:1px solid #e2e8f0;padding:9px}tr:nth-child(even)td{background:#f8fafc}.footer{color:#64748b;font-size:12px;margin-top:24px}</style></head><body>${parts.join("")}<p class="footer">Informe generado desde MerchanOps · ISDIN · CECO ${CECO}</p></body></html>`;
  }

  function exportHtml() { downloadHtml("informe_estrategico_isdin.html", buildHtml()); }
  function previewHtml() { const w = window.open("", "_blank"); if (w) { w.document.open(); w.document.write(buildHtml()); w.document.close(); } }

  return <main className="min-h-screen bg-slate-100 text-slate-900"><header className="sticky top-0 z-10 border-b bg-white"><div className="mx-auto flex max-w-7xl flex-col gap-3 px-4 py-4 md:flex-row md:items-center md:justify-between"><div><a href="/grandes-campanas/isdin" className="mb-2 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-900"><ArrowLeft className="h-4 w-4"/>Volver a ISDIN Vinilos</a><h1 className="text-3xl font-bold">Dashboard estratégico ISDIN</h1><p className="text-sm text-slate-500">Indicadores para cliente, dirección comercial y control operativo. CECO {CECO}.</p></div><div className="flex flex-wrap gap-2"><button onClick={previewHtml} className="rounded-2xl border bg-white px-4 py-2"><Eye className="mr-1 inline h-4 w-4"/>Vista previa HTML</button><button onClick={exportHtml} className="rounded-2xl bg-slate-900 px-4 py-2 text-white"><Download className="mr-1 inline h-4 w-4"/>Exportar HTML</button></div></div></header><section className="mx-auto max-w-7xl space-y-5 p-4">{!isSupabaseConfigured&&<div className="rounded-2xl border bg-amber-50 p-3 text-sm">Modo local: este dashboard usa los datos guardados en este navegador.</div>}
    <Card><div className="mb-4 flex items-center gap-2"><FileText className="h-5 w-5"/><h2 className="text-xl font-semibold">Configurar informe</h2></div><div className="grid gap-3 md:grid-cols-3"><Select label="Semana" value={filters.week} onChange={(v:string)=>setFilters({...filters,week:v})} options={["",...weeks]} labels={{"":"Todas"}}/><Select label="Provincia" value={filters.province} onChange={(v:string)=>setFilters({...filters,province:v})} options={["",...provinces]} labels={{"":"Todas"}}/><Select label="Instalador" value={filters.installer} onChange={(v:string)=>setFilters({...filters,installer:v})} options={["",...workers.map(w=>w.id)]} labels={{"":"Todos",...Object.fromEntries(workers.map(w=>[w.id,w.name]))}}/></div><div className="mt-4 grid gap-2 md:grid-cols-5">{(Object.keys(sections) as SectionKey[]).map(k=><label key={k} className="flex items-center gap-2 rounded-xl border bg-white p-2 text-sm"><input type="checkbox" checked={selected[k]} onChange={e=>setSelected({...selected,[k]:e.target.checked})}/>{sections[k]}</label>)}</div></Card>
    {loading?<Card>Cargando KPIs...</Card>:<><div className="grid gap-3 md:grid-cols-3 lg:grid-cols-6"><Kpi label="Avance operativo" value={`${stats.avance}%`} hint="Finalizados + cancelados"/><Kpi label="Avance administrativo" value={`${stats.avanceAdmin}%`} hint="Todo lo gestionado"/><Kpi label="Instalación efectiva" value={`${stats.tasaInstalacionEfectiva}%`} hint="Finalizados / gestionados"/><Kpi label="Visita fallida" value={`${stats.tasaFallida}%`} hint="Incidencia + cancelado + pend."/><Kpi label="Calidad de datos" value={`${stats.calidadDatos}%`}/><Kpi label="Riesgo" value={stats.riesgo}/></div>
    <div className="grid gap-4 lg:grid-cols-3"><Panel title="Resumen ejecutivo"><Metric label="Total puntos" value={stats.total}/><Metric label="Finalizados" value={stats.finalizados}/><Metric label="Pendientes reales" value={stats.nuevos + stats.pendientesColocador}/><Metric label="Pago visible" value={eur(stats.pagoTotal)}/></Panel><Panel title="Incidencias y coste"><Metric label="Incidencias" value={stats.incidencias}/><Metric label="Visitas fallidas" value={stats.fallidas}/><Metric label="Sobrecoste estimado" value={eur(stats.sobrecoste)}/><Metric label="Tasa incidencia" value={`${stats.tasaIncidencia}%`}/></Panel><Panel title="Calidad base cliente"><Metric label="Sin instalador" value={stats.sinInstalador}/><Metric label="Sin semana" value={stats.sinSemana}/><Metric label="Sin pago" value={stats.sinPago}/><Metric label="VIN duplicados" value={stats.duplicados}/></Panel></div>
    <div className="grid gap-4 lg:grid-cols-2"><TableCard title="Cumplimiento por semana" rows={weekly}/><TableCard title="Cobertura por provincia" rows={byProvince}/><TableCard title="Tipo de vinilo" rows={byType}/><TableCard title="Instaladores" rows={byWorker}/></div>{risks.length>0&&<TableCard title="Riesgos prioritarios" rows={risks as any[]}/>}</>}
  </section></main>;
}

function Card({children}:{children:any}){return <div className="rounded-3xl border bg-white p-5 shadow-sm">{children}</div>}
function Kpi({label,value,hint}:{label:string;value:any;hint?:string}){return <Card><p className="text-sm text-slate-500">{label}</p><p className="text-2xl font-bold">{value}</p>{hint&&<p className="mt-1 text-xs text-slate-400">{hint}</p>}</Card>}
function Panel({title,children}:any){return <Card><h3 className="mb-3 font-semibold">{title}</h3>{children}</Card>}
function Metric({label,value}:any){return <div className="flex justify-between border-b py-2 text-sm"><span className="text-slate-500">{label}</span><b>{value}</b></div>}
function TableCard({title,rows}:{title:string;rows:GroupRow[]}){return <Card><h3 className="mb-3 font-semibold">{title}</h3><div className="overflow-auto"><table className="w-full text-sm"><thead><tr className="bg-slate-900 text-white"><th className="p-2 text-left">Concepto</th><th className="p-2 text-right">Total</th><th className="p-2 text-right">Avance</th><th className="p-2 text-right">Incid.</th><th className="p-2 text-right">Pago</th><th className="p-2 text-left">Riesgo</th></tr></thead><tbody>{rows.slice(0,12).map(r=><tr key={r.name} className="border-t"><td className="p-2">{r.name}</td><td className="p-2 text-right">{r.total}</td><td className="p-2 text-right">{r.avance}%</td><td className="p-2 text-right">{r.incidencias}</td><td className="p-2 text-right">{eur(r.pago)}</td><td className="p-2 font-semibold">{r.riesgo}</td></tr>)}</tbody></table></div></Card>}
function Select({label,value,onChange,options,labels={}}:any){return <label className="block"><span className="text-sm font-medium">{label}</span><select value={value??""} onChange={e=>onChange(e.target.value)} className="w-full rounded-2xl border bg-white px-3 py-2">{options.map((o:string)=><option key={o} value={o}>{labels[o]||o||"Seleccionar"}</option>)}</select></label>}

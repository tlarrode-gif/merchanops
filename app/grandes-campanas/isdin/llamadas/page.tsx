"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, Clipboard, ExternalLink, FileDown, Save } from "lucide-react";
import { isSupabaseConfigured, supabase } from "@/lib/supabase";
import {
  IsdinCall,
  IsdinCallStatus,
  IsdinVinylBase,
  callIsCompleted,
  callNeedsOperationsAlert,
  callStatusClass,
  cleanCallStatus,
  dateOnly,
  downloadCsv,
  isdinCallStatuses,
  isdinWeekLabel,
  loadLocalCalls,
  mergeCallsWithVinyls,
  saveLocalCalls,
  syncLocalCallsFromVinyls
} from "@/lib/isdin-calls";

type Worker = { id: string; name: string };
type Filters = {
  week: string;
  province: string;
  city: string;
  status: string;
  installer: string;
  q: string;
  quick: string;
  from: string;
  to: string;
};

const localVinylKey = "merchanops_isdin_local_v381";

function localVinyls(): IsdinVinylBase[] {
  try {
    return JSON.parse(localStorage.getItem(localVinylKey) || "[]");
  } catch {
    return [];
  }
}

function pct(a: number, b: number) {
  return b ? Math.round((a / b) * 100) : 0;
}

function nowLocalDatetime() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}T${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function groupCount<T>(rows: T[], key: (row: T) => string) {
  const out = new Map<string, number>();
  rows.forEach(row => out.set(key(row) || "Sin dato", (out.get(key(row) || "Sin dato") || 0) + 1));
  return Array.from(out.entries()).map(([name, total]) => ({ name, total })).sort((a, b) => b.total - a.total);
}

function callForDb(call: IsdinCall) {
  return {
    ...call,
    call_status: cleanCallStatus(call.call_status),
    call_datetime: call.call_datetime || null,
    desired_installation_date: dateOnly(call.desired_installation_date) || null,
    next_visit_date: dateOnly(call.next_visit_date) || null,
    requires_operations_review: Boolean(call.requires_operations_review)
  };
}

function applyCallPatch(call: IsdinCall, patch: Partial<IsdinCall>): IsdinCall {
  const nextDate = patch.next_visit_date !== undefined ? dateOnly(patch.next_visit_date) : dateOnly(call.next_visit_date);
  const callStatus = patch.call_status ? cleanCallStatus(patch.call_status) : cleanCallStatus(call.call_status);
  const requiresReview = patch.requires_operations_review !== undefined
    ? Boolean(patch.requires_operations_review)
    : callStatus === "Requiere revisión operaciones" || Boolean(call.requires_operations_review);

  return {
    ...call,
    ...patch,
    call_status: callStatus,
    call_datetime: patch.call_datetime !== undefined ? patch.call_datetime || null : call.call_datetime || null,
    next_visit_date: nextDate || null,
    next_visit_week: nextDate ? isdinWeekLabel(nextDate) : patch.next_visit_week !== undefined ? patch.next_visit_week || null : call.next_visit_week || null,
    requires_operations_review: requiresReview,
    updated_at: new Date().toISOString()
  };
}

export default function IsdinCallsPage() {
  const [calls, setCalls] = useState<IsdinCall[]>([]);
  const [workers, setWorkers] = useState<Worker[]>([]);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState("");
  const [filters, setFilters] = useState<Filters>({ week: "", province: "", city: "", status: "", installer: "", q: "", quick: "", from: "", to: "" });

  function flash(text: string) {
    setNotice(text);
    setTimeout(() => setNotice(""), 1400);
  }

  async function refresh() {
    setLoading(true);
    if (isSupabaseConfigured && supabase) {
      const [{ data: vinyls, error: vinylError }, { data: rawCalls, error: callError }, { data: workerRows }] = await Promise.all([
        supabase.from("isdin_vinyls").select("*").order("desired_installation_week", { ascending: true }),
        supabase.from("isdin_calls").select("*").order("desired_installation_week", { ascending: true }),
        supabase.from("workers").select("id,name").order("name")
      ]);
      if (vinylError || callError) {
        flash(callError?.message || vinylError?.message || "No se pudieron cargar llamadas");
        setCalls([]);
      } else {
        const synced = mergeCallsWithVinyls((rawCalls || []) as IsdinCall[], (vinyls || []) as IsdinVinylBase[]);
        setCalls(synced);
        if (synced.length) {
          await supabase.from("isdin_calls").upsert(synced.map(callForDb), { onConflict: "vin" });
        }
      }
      setWorkers((workerRows || []) as Worker[]);
    } else {
      const synced = syncLocalCallsFromVinyls(localVinyls());
      setCalls(synced);
      setWorkers([]);
    }
    setLoading(false);
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { refresh(); }, []);

  async function saveCall(call: IsdinCall, patch: Partial<IsdinCall>, message = "Llamada guardada") {
    const next = applyCallPatch(call, patch);
    const nextCalls = calls.map(row => row.id === call.id ? next : row);
    setCalls(nextCalls);
    if (isSupabaseConfigured && supabase) {
      const { error } = await supabase.from("isdin_calls").upsert(callForDb(next), { onConflict: "vin" });
      if (error) {
        flash(error.message);
        return;
      }
    } else {
      saveLocalCalls(nextCalls);
    }
    flash(message);
  }

  async function quickStatus(call: IsdinCall, status: IsdinCallStatus) {
    const datetime = status === "No contesta" || status === "Confirmado" || status === "Llamada realizada" ? nowLocalDatetime() : call.call_datetime || nowLocalDatetime();
    const attempt = status === "No contesta" ? `Intento sin respuesta: ${new Date().toLocaleString("es-ES")}` : "";
    const comment = attempt ? [call.call_comment, attempt].filter(Boolean).join("\n") : call.call_comment || "";
    // Incidencia en llamada es preventiva y no genera pago de visita fallida.
    await saveCall(call, { call_status: status, call_datetime: datetime, call_comment: comment, requires_operations_review: status === "Requiere revisión operaciones" || call.requires_operations_review }, status);
  }

  async function copySummary(call: IsdinCall) {
    const text = [
      `ISDIN Backoffice · ${call.vin}`,
      `Farmacia: ${call.pharmacy_name}`,
      `Estado llamada: ${call.call_status}`,
      `Semana instalación: ${call.desired_installation_week || "Sin semana"}`,
      call.next_visit_date ? `Nueva fecha propuesta: ${dateOnly(call.next_visit_date)} (${call.next_visit_week || isdinWeekLabel(call.next_visit_date)})` : "",
      call.contact_person ? `Contacto: ${call.contact_person}` : "",
      call.call_comment ? `Comentario: ${call.call_comment}` : "",
      call.requires_operations_review ? "Requiere revisión de operaciones" : ""
    ].filter(Boolean).join("\n");
    try {
      await navigator.clipboard?.writeText(text);
      flash("Resumen copiado");
    } catch {
      flash("No se pudo copiar el resumen");
    }
  }

  const weeks = Array.from(new Set(calls.map(x => x.desired_installation_week).filter(Boolean))) as string[];
  const provinces = Array.from(new Set(calls.map(x => x.province).filter(Boolean))) as string[];
  const cities = Array.from(new Set(calls.map(x => x.city).filter(Boolean))) as string[];
  const installers = Array.from(new Set(calls.map(x => x.installer_name || x.worker_name).filter(Boolean))) as string[];

  const filtered = calls.filter(call => {
    const hay = [call.vin, call.pharmacy_name, call.vinyl_campaign, call.province, call.city, call.call_status, call.installer_name, call.worker_name, call.contact_person, call.call_comment].join(" ").toLowerCase();
    const status = cleanCallStatus(call.call_status);
    const callDate = dateOnly(call.call_datetime);
    const quickOk = !filters.quick
      || (filters.quick === "pendientes" && status === "Pendiente de llamar")
      || (filters.quick === "incidencias" && status === "Incidencia en llamada")
      || (filters.quick === "pospuestos" && status === "Pospuesto en llamada")
      || (filters.quick === "revision" && (status === "Requiere revisión operaciones" || Boolean(call.requires_operations_review)));
    return (!filters.week || call.desired_installation_week === filters.week)
      && (!filters.province || call.province === filters.province)
      && (!filters.city || call.city === filters.city)
      && (!filters.status || status === filters.status)
      && (!filters.installer || call.installer_name === filters.installer || call.worker_name === filters.installer)
      && (!filters.q || hay.includes(filters.q.toLowerCase()))
      && quickOk
      && (!filters.from || callDate >= filters.from)
      && (!filters.to || callDate <= filters.to);
  });

  const stats = useMemo(() => {
    const total = filtered.length;
    const pendientes = filtered.filter(x => x.call_status === "Pendiente de llamar").length;
    const realizadas = filtered.filter(x => callIsCompleted(x.call_status)).length;
    const confirmados = filtered.filter(x => x.call_status === "Confirmado").length;
    const noContesta = filtered.filter(x => x.call_status === "No contesta").length;
    const incidencias = filtered.filter(x => x.call_status === "Incidencia en llamada").length;
    const pospuestos = filtered.filter(x => x.call_status === "Pospuesto en llamada").length;
    const cancelados = filtered.filter(x => x.call_status === "Cancelado en llamada").length;
    const revision = filtered.filter(x => x.call_status === "Requiere revisión operaciones" || x.requires_operations_review).length;
    const problemas = filtered.filter(callNeedsOperationsAlert).length;
    return {
      total, pendientes, realizadas, confirmados, noContesta, incidencias, pospuestos, cancelados, revision,
      completado: pct(realizadas, total),
      confirmacion: pct(confirmados, realizadas),
      problemasPreventivos: pct(problemas, total)
    };
  }, [filtered]);

  const byProvince = groupCount(filtered, x => x.province || "Sin provincia");
  const byWeek = groupCount(filtered, x => x.desired_installation_week || "Sin semana");
  const byStatus = groupCount(filtered, x => cleanCallStatus(x.call_status));
  const byBackoffice = groupCount(filtered, x => x.backoffice_user || "Sin operador");

  function exportCalls() {
    downloadCsv("isdin_llamadas_backoffice.csv", [
      ["VIN", "Farmacia", "Campaña", "Semana instalación", "Provincia", "Ciudad", "Estado llamada", "Fecha/hora llamada", "Persona contactada", "Comentario", "Nueva fecha propuesta", "Nueva semana", "Instalador", "Requiere revisión"],
      ...filtered.map(call => [
        call.vin, call.pharmacy_name, call.vinyl_campaign || "", call.desired_installation_week || "", call.province || "", call.city || "",
        call.call_status, call.call_datetime || "", call.contact_person || "", call.call_comment || "", dateOnly(call.next_visit_date),
        call.next_visit_week || "", call.installer_name || call.worker_name || "", call.requires_operations_review ? "Sí" : "No"
      ])
    ]);
  }

  return <main className="isdin-page min-h-screen bg-slate-100 text-slate-900"><header className="sticky top-0 z-10 border-b bg-white"><div className="mx-auto flex max-w-7xl flex-col gap-3 px-4 py-4 md:flex-row md:items-center md:justify-between"><div><a href="/grandes-campanas/isdin" className="mb-2 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-900"><ArrowLeft className="h-4 w-4"/>Volver a Vinilos</a><h1 className="text-3xl font-bold">ISDIN · Llamadas Backoffice</h1><p className="text-sm text-slate-500">Gestión preventiva de llamadas previas a instalación.</p></div><div className="flex flex-wrap gap-2"><a href="/grandes-campanas/isdin/dashboard" className="rounded-2xl border bg-white px-4 py-2">KPIs ISDIN</a><a href="/grandes-campanas/isdin/facturacion" className="rounded-2xl border bg-white px-4 py-2">Facturación ISDIN</a><button onClick={exportCalls} className="rounded-2xl bg-slate-900 px-4 py-2 text-white"><FileDown className="mr-1 inline h-4 w-4"/>Exportar llamadas</button></div></div></header><section className="mx-auto max-w-7xl space-y-5 p-4">{notice&&<div className="fixed right-4 top-24 z-50 rounded-2xl border bg-emerald-50 px-4 py-2 text-sm shadow">{notice}</div>}{!isSupabaseConfigured&&<div className="rounded-2xl border bg-amber-50 p-3 text-sm">Modo local: las llamadas se guardan en este navegador y se sincronizan con los vinilos locales.</div>}<div className="grid gap-3 md:grid-cols-3 lg:grid-cols-6"><Kpi label="Total registros" value={stats.total}/><Kpi label="Pendientes" value={stats.pendientes}/><Kpi label="Realizadas" value={stats.realizadas}/><Kpi label="Confirmadas" value={stats.confirmados}/><Kpi label="No contesta" value={stats.noContesta}/><Kpi label="% completado" value={`${stats.completado}%`}/><Kpi label="Incidencias llamada" value={stats.incidencias}/><Kpi label="Pospuestos llamada" value={stats.pospuestos}/><Kpi label="Cancelados llamada" value={stats.cancelados}/><Kpi label="Revisión operaciones" value={stats.revision}/><Kpi label="% confirmación" value={`${stats.confirmacion}%`}/><Kpi label="% preventivo" value={`${stats.problemasPreventivos}%`}/></div><Card><div className="grid gap-3 md:grid-cols-3 lg:grid-cols-6"><Select label="Semana" value={filters.week} onChange={(v:string)=>setFilters({...filters,week:v})} options={["",...weeks]}/><Select label="Provincia" value={filters.province} onChange={(v:string)=>setFilters({...filters,province:v})} options={["",...provinces]}/><Select label="Ciudad" value={filters.city} onChange={(v:string)=>setFilters({...filters,city:v})} options={["",...cities]}/><Select label="Estado llamada" value={filters.status} onChange={(v:string)=>setFilters({...filters,status:v})} options={["",...isdinCallStatuses]}/><Select label="Instalador" value={filters.installer} onChange={(v:string)=>setFilters({...filters,installer:v})} options={["",...installers]}/><Input label="VIN / Farmacia" value={filters.q} onChange={(v:string)=>setFilters({...filters,q:v})}/><Input label="Llamada desde" type="date" value={filters.from} onChange={(v:string)=>setFilters({...filters,from:v})}/><Input label="Llamada hasta" type="date" value={filters.to} onChange={(v:string)=>setFilters({...filters,to:v})}/></div><div className="mt-4 flex flex-wrap gap-2"><FilterButton label="Pendientes" active={filters.quick==="pendientes"} onClick={()=>setFilters({...filters,quick:filters.quick==="pendientes"?"":"pendientes"})}/><FilterButton label="Incidencias" active={filters.quick==="incidencias"} onClick={()=>setFilters({...filters,quick:filters.quick==="incidencias"?"":"incidencias"})}/><FilterButton label="Pospuestos" active={filters.quick==="pospuestos"} onClick={()=>setFilters({...filters,quick:filters.quick==="pospuestos"?"":"pospuestos"})}/><FilterButton label="Requiere revisión" active={filters.quick==="revision"} onClick={()=>setFilters({...filters,quick:filters.quick==="revision"?"":"revision"})}/><button onClick={()=>setFilters({week:"",province:"",city:"",status:"",installer:"",q:"",quick:"",from:"",to:""})} className="rounded-2xl border bg-white px-4 py-2 text-sm font-medium">Limpiar filtros</button></div></Card><div className="grid gap-4 lg:grid-cols-4"><MiniTable title="Llamadas por provincia" rows={byProvince}/><MiniTable title="Llamadas por semana" rows={byWeek}/><MiniTable title="Llamadas por estado" rows={byStatus}/><MiniTable title="Operador Backoffice" rows={byBackoffice}/></div><Card><div className="mb-3 flex items-center justify-between gap-3"><h2 className="text-xl font-semibold">Tabla de llamadas</h2><span className="text-sm text-slate-500">{filtered.length} registros visibles</span></div>{loading ? "Cargando llamadas..." : <div className="overflow-auto"><table className="w-full min-w-[1700px] text-sm"><thead><tr className="bg-slate-900 text-white"><th className="p-2 text-left">VIN</th><th className="p-2 text-left">Farmacia</th><th className="p-2 text-left">Semana instalación</th><th className="p-2 text-left">Provincia</th><th className="p-2 text-left">Ciudad</th><th className="p-2 text-left">Instalador</th><th className="p-2 text-left">Estado llamada</th><th className="p-2 text-left">Fecha/hora</th><th className="p-2 text-left">Persona</th><th className="p-2 text-left">Nueva fecha</th><th className="p-2 text-left">Comentario</th><th className="p-2 text-left">Acciones</th></tr></thead><tbody>{filtered.map(call => <CallRow key={call.id} call={call} workers={workers} saveCall={saveCall} quickStatus={quickStatus} copySummary={copySummary}/>)}</tbody></table></div>}</Card></section></main>;
}

function CallRow({ call, saveCall, quickStatus, copySummary }: { call: IsdinCall; workers: Worker[]; saveCall: (call: IsdinCall, patch: Partial<IsdinCall>, message?: string) => Promise<void>; quickStatus: (call: IsdinCall, status: IsdinCallStatus) => Promise<void>; copySummary: (call: IsdinCall) => Promise<void> }) {
  const [draft, setDraft] = useState(call);
  useEffect(() => { setDraft(call); }, [call]);
  const alert = callNeedsOperationsAlert(draft);
  return <tr className={`border-t align-top ${alert ? "bg-rose-50/60" : "bg-white"}`}><td className="p-2 font-mono text-xs">{call.vin}</td><td className="p-2"><b>{call.pharmacy_name}</b>{alert&&<p className="mt-1 text-xs font-semibold text-rose-700">Alerta Backoffice</p>}</td><td className="p-2">{call.desired_installation_week || "Sin semana"}</td><td className="p-2">{call.province || ""}</td><td className="p-2">{call.city || ""}</td><td className="p-2">{call.installer_name || call.worker_name || "Sin asignar"}</td><td className="p-2"><span className={`mb-2 inline-flex rounded-full px-2 py-1 text-xs font-semibold ring-1 ${callStatusClass(draft.call_status)}`}>{draft.call_status}</span><select value={draft.call_status} onChange={e=>setDraft({...draft,call_status:cleanCallStatus(e.target.value)})} className="block w-48 rounded-xl border bg-white px-2 py-1 text-xs">{isdinCallStatuses.map(s=><option key={s} value={s}>{s}</option>)}</select><label className="mt-2 flex items-center gap-2 text-xs"><input type="checkbox" checked={!!draft.requires_operations_review} onChange={e=>setDraft({...draft,requires_operations_review:e.target.checked})}/>Revisión</label></td><td className="p-2"><input type="datetime-local" value={String(draft.call_datetime || "").slice(0,16)} onChange={e=>setDraft({...draft,call_datetime:e.target.value})} className="w-44 rounded-xl border px-2 py-1 text-xs"/><input placeholder="Franja horaria" value={draft.call_time_slot || ""} onChange={e=>setDraft({...draft,call_time_slot:e.target.value})} className="mt-2 w-44 rounded-xl border px-2 py-1 text-xs"/></td><td className="p-2"><input value={draft.contact_person || ""} onChange={e=>setDraft({...draft,contact_person:e.target.value})} className="w-40 rounded-xl border px-2 py-1 text-xs"/><input placeholder="Operador" value={draft.backoffice_user || ""} onChange={e=>setDraft({...draft,backoffice_user:e.target.value})} className="mt-2 w-40 rounded-xl border px-2 py-1 text-xs"/></td><td className="p-2"><input type="date" value={dateOnly(draft.next_visit_date)} onChange={e=>setDraft({...draft,next_visit_date:e.target.value,next_visit_week:isdinWeekLabel(e.target.value)})} className="rounded-xl border px-2 py-1 text-xs"/><p className="mt-1 text-xs text-slate-500">{draft.next_visit_week || ""}</p></td><td className="p-2"><textarea value={draft.call_comment || ""} onChange={e=>setDraft({...draft,call_comment:e.target.value})} rows={3} className="w-64 rounded-xl border px-2 py-1 text-xs"/></td><td className="p-2"><div className="flex w-64 flex-wrap gap-1"><button onClick={()=>saveCall(call,draft,"Cambios guardados")} className="rounded-xl bg-slate-900 px-3 py-1 text-xs text-white"><Save className="mr-1 inline h-3 w-3"/>Guardar</button><button onClick={()=>quickStatus(call,"Confirmado")} className="rounded-xl border bg-white px-3 py-1 text-xs">Confirmado</button><button onClick={()=>quickStatus(call,"No contesta")} className="rounded-xl border bg-white px-3 py-1 text-xs">No contesta</button><button onClick={()=>quickStatus(call,"Incidencia en llamada")} className="rounded-xl border bg-white px-3 py-1 text-xs">Incidencia</button><button onClick={()=>quickStatus(call,"Pospuesto en llamada")} className="rounded-xl border bg-white px-3 py-1 text-xs">Pospuesto</button><button onClick={()=>quickStatus(call,"Requiere revisión operaciones")} className="rounded-xl border bg-white px-3 py-1 text-xs">Revisión</button><a href={`/grandes-campanas/isdin?q=${encodeURIComponent(call.vin)}`} className="rounded-xl border bg-white px-3 py-1 text-xs"><ExternalLink className="mr-1 inline h-3 w-3"/>Vinilo</a><button onClick={()=>copySummary(call)} className="rounded-xl border bg-white px-3 py-1 text-xs"><Clipboard className="mr-1 inline h-3 w-3"/>Copiar</button></div></td></tr>;
}

function Card({ children }: { children: React.ReactNode }) { return <div className="rounded-3xl border bg-white p-5 shadow-sm">{children}</div>; }
function Kpi({ label, value }: { label: string; value: React.ReactNode }) { return <Card><p className="text-sm text-slate-500">{label}</p><p className="text-2xl font-bold">{value}</p></Card>; }
function Input({ label, value, onChange, type = "text" }: any) { return <label className="block"><span className="text-sm font-medium">{label}</span><input type={type} value={value ?? ""} onChange={e => onChange(e.target.value)} className="w-full rounded-2xl border px-3 py-2"/></label>; }
function Select({ label, value, onChange, options }: any) { return <label className="block"><span className="text-sm font-medium">{label}</span><select value={value ?? ""} onChange={e => onChange(e.target.value)} className="w-full rounded-2xl border bg-white px-3 py-2">{options.map((o: string) => <option key={o} value={o}>{o || "Todos"}</option>)}</select></label>; }
function FilterButton({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) { return <button onClick={onClick} className={active ? "rounded-2xl bg-slate-900 px-4 py-2 text-sm font-medium text-white" : "rounded-2xl border bg-white px-4 py-2 text-sm font-medium"}>{label}</button>; }
function MiniTable({ title, rows }: { title: string; rows: { name: string; total: number }[] }) { return <Card><h3 className="mb-3 font-semibold">{title}</h3><div className="space-y-2 text-sm">{rows.slice(0, 8).map(row => <div key={row.name} className="flex justify-between border-b pb-1"><span className="truncate">{row.name}</span><b>{row.total}</b></div>)}{!rows.length&&<p className="text-slate-500">Sin datos.</p>}</div></Card>; }

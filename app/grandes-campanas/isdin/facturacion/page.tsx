"use client";

import { useEffect, useMemo, useState } from "react";
import { isSupabaseConfigured, supabase } from "@/lib/supabase";

type Vinyl = {
  id: string;
  pharmacy_name: string;
  vinyl: string;
  status?: string | null;
  vinyl_record_type?: string | null;
  vinyl_campaign?: string | null;
  province?: string | null;
  city?: string | null;
  payment_week?: string | null;
  desired_installation_week?: string | null;
  incident_payment_week?: string | null;
  installation_payment_week?: string | null;
  billing_extra_equipment?: number | null;
  billing_type_override?: string | null;
  comments?: string | null;
};

type Settings = { id: string; standard_rate: number; custom_rate: number };

const CLIENT = "ISDIN";
const CECO = "3159";

function eur(v: number) {
  return new Intl.NumberFormat("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(v || 0)) + " €";
}
function kind(v: Vinyl) {
  const raw = String(v.billing_type_override || v.vinyl_record_type || "").toLowerCase();
  if (raw.includes("medida")) return "Vinilo a medida";
  if (raw.includes("standard") || raw.includes("estandar") || raw.includes("estándar")) return "Vinilo standard";
  return "Sin clasificar";
}
function rate(v: Vinyl, s: Settings) {
  const k = kind(v);
  if (k === "Vinilo a medida") return Number(s.custom_rate || 0);
  if (k === "Vinilo standard") return Number(s.standard_rate || 0);
  return 0;
}
function linesFor(v: Vinyl, s: Settings) {
  const st = v.status || "Nuevo";
  const base = rate(v, s);
  const extra = Number(v.billing_extra_equipment || 0);
  const incWeek = v.incident_payment_week || v.payment_week || v.desired_installation_week || "Sin semana";
  const endWeek = v.installation_payment_week || v.payment_week || v.desired_installation_week || "Sin semana";
  if (st === "Nuevo" || st === "Incidencia llamada") return [];
  if (st === "Incidencia") return [{ week: incWeek, concept: "Visita incidencia", amount: base + extra }];
  if (st === "Resuelto - Pendiente colocador") return [{ week: incWeek, concept: "Visita pendiente colocador", amount: base + extra }];
  if (st === "Cancelado") return [{ week: incWeek, concept: v.incident_payment_week ? "Visita previa a cancelación" : "Cancelación sin visita", amount: v.incident_payment_week ? base + extra : 0 }];
  if (st === "Finalizado" && v.incident_payment_week) return [{ week: incWeek, concept: "Primera visita", amount: base }, { week: endWeek, concept: "Instalación resuelta", amount: base + extra }];
  if (st === "Finalizado") return [{ week: endWeek, concept: "Instalación", amount: base + extra }];
  return [];
}
function csv(rows: unknown[][]) {
  const content = rows.map(r => r.map(x => `"${String(x ?? "").replace(/"/g, '""')}"`).join(";")).join("\n");
  const blob = new Blob(["\ufeff" + content], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "facturacion_isdin.csv";
  a.click();
  URL.revokeObjectURL(url);
}

export default function Page() {
  const [items, setItems] = useState<Vinyl[]>([]);
  const [settings, setSettings] = useState<Settings>({ id: "global", standard_rate: 0, custom_rate: 0 });
  const [notice, setNotice] = useState("");

  async function refresh() {
    if (!isSupabaseConfigured || !supabase) return;
    const [{ data: v }, { data: s }] = await Promise.all([
      supabase.from("isdin_vinyls").select("*"),
      supabase.from("isdin_billing_settings").select("*").eq("id", "global").maybeSingle()
    ]);
    setItems((v || []) as Vinyl[]);
    setSettings((s as Settings) || { id: "global", standard_rate: 0, custom_rate: 0 });
  }
  useEffect(() => { refresh(); }, []);

  async function saveSettings() {
    if (supabase) await supabase.from("isdin_billing_settings").upsert({ ...settings, id: "global", updated_at: new Date().toISOString() });
    setNotice("Tarifas guardadas");
    setTimeout(() => setNotice(""), 1200);
  }
  async function updateVinyl(v: Vinyl, patch: Partial<Vinyl>) {
    setItems(prev => prev.map(x => x.id === v.id ? { ...x, ...patch } : x));
    if (supabase) await supabase.from("isdin_vinyls").update(patch).eq("id", v.id);
  }

  const rows = useMemo(() => items.flatMap(v => linesFor(v, settings).map(l => ({ v, ...l }))), [items, settings]);
  const total = rows.reduce((a, r) => a + Number(r.amount || 0), 0);

  function exportCsv() {
    csv([["Cliente", "CECO", "Semana", "VIN", "Farmacia", "Campaña", "Tipo", "Estado", "Concepto", "Provincia", "Ciudad", "Total", "Comentarios"], ...rows.map(r => [CLIENT, CECO, r.week, r.v.vinyl, r.v.pharmacy_name, r.v.vinyl_campaign, kind(r.v), r.v.status, r.concept, r.v.province, r.v.city, r.amount, r.v.comments])]);
  }

  return <main className="min-h-screen bg-slate-100 p-4 text-slate-900"><section className="mx-auto max-w-7xl space-y-4"><a href="/grandes-campanas/isdin" className="text-sm text-slate-500">← Volver a ISDIN</a><h1 className="text-3xl font-bold">ISDIN · Facturación</h1>{notice && <div className="rounded-xl bg-emerald-50 p-3">{notice}</div>}<div className="rounded-3xl border bg-white p-5"><div className="grid gap-3 md:grid-cols-4"><label>Tarifa standard<input type="number" className="mt-1 w-full rounded-xl border p-2" value={settings.standard_rate} onChange={e => setSettings({ ...settings, standard_rate: Number(e.target.value) })}/></label><label>Tarifa a medida<input type="number" className="mt-1 w-full rounded-xl border p-2" value={settings.custom_rate} onChange={e => setSettings({ ...settings, custom_rate: Number(e.target.value) })}/></label><button onClick={saveSettings} className="self-end rounded-2xl bg-slate-900 px-4 py-2 text-white">Guardar tarifas</button><button onClick={exportCsv} className="self-end rounded-2xl border bg-white px-4 py-2">Exportar CSV</button></div></div><div className="grid gap-3 md:grid-cols-3"><Kpi label="Líneas" value={rows.length}/><Kpi label="Total facturación" value={eur(total)}/><Kpi label="VIN cargados" value={items.length}/></div><div className="rounded-3xl border bg-white p-5"><h2 className="mb-3 text-xl font-semibold">Extras por VIN</h2><div className="overflow-auto"><table className="w-full min-w-[900px] text-sm"><thead><tr className="bg-slate-900 text-white"><th className="p-2 text-left">VIN</th><th className="p-2 text-left">Farmacia</th><th className="p-2 text-left">Estado</th><th className="p-2 text-left">Tipo</th><th className="p-2 text-left">Corrección tipo</th><th className="p-2 text-right">Extra maquinaria</th></tr></thead><tbody>{items.map(v => <tr key={v.id} className="border-t"><td className="p-2">{v.vinyl}</td><td className="p-2">{v.pharmacy_name}</td><td className="p-2">{v.status}</td><td className="p-2">{kind(v)}</td><td className="p-2"><select className="rounded-xl border p-1" value={v.billing_type_override || ""} onChange={e => updateVinyl(v, { billing_type_override: e.target.value || null })}><option value="">Automático</option><option value="Vinilo standard">Vinilo standard</option><option value="Vinilo a medida">Vinilo a medida</option></select></td><td className="p-2 text-right"><input type="number" className="w-24 rounded-xl border p-1 text-right" value={Number(v.billing_extra_equipment || 0)} onChange={e => updateVinyl(v, { billing_extra_equipment: Number(e.target.value) })}/></td></tr>)}</tbody></table></div></div><div className="rounded-3xl border bg-white p-5"><h2 className="mb-3 text-xl font-semibold">Líneas de facturación</h2><div className="overflow-auto"><table className="w-full min-w-[900px] text-sm"><thead><tr className="bg-slate-900 text-white"><th className="p-2 text-left">Semana</th><th className="p-2 text-left">VIN</th><th className="p-2 text-left">Farmacia</th><th className="p-2 text-left">Tipo</th><th className="p-2 text-left">Estado</th><th className="p-2 text-left">Concepto</th><th className="p-2 text-right">Total</th></tr></thead><tbody>{rows.map((r, i) => <tr key={i} className="border-t"><td className="p-2">{r.week}</td><td className="p-2">{r.v.vinyl}</td><td className="p-2">{r.v.pharmacy_name}</td><td className="p-2">{kind(r.v)}</td><td className="p-2">{r.v.status}</td><td className="p-2">{r.concept}</td><td className="p-2 text-right font-semibold">{eur(r.amount)}</td></tr>)}</tbody></table></div></div></section></main>;
}
function Kpi({ label, value }: { label: string; value: any }) { return <div className="rounded-3xl border bg-white p-5"><p className="text-sm text-slate-500">{label}</p><p className="text-2xl font-bold">{value}</p></div>; }

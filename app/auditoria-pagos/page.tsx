"use client";

import { useEffect, useMemo, useState } from "react";
import { isSupabaseConfigured, supabase } from "@/lib/supabase";
import { auditService, effectivePaymentDate, serviceTotal, shouldAppearInPayments, type AuditService } from "@/lib/payment-audit";

type AnyObj = Record<string, any>;
const INCIDENT_FEE = 8.56;

function todayISO() { return new Date().toISOString(); }
function eur(v: number) { return new Intl.NumberFormat("es-ES", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(v || 0)) + " €"; }
function monthStart() { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`; }
function monthEnd() { const d = new Date(); return new Date(d.getFullYear(), d.getMonth() + 1, 0).toISOString().slice(0, 10); }
function pStatus(p: AnyObj) { return p.point_status || p.status || "Pendiente"; }
function isFailedStatus(st: string) { return ["Incidencia", "Pospuesto", "Pendiente recepción post-incidencia"].includes(st); }
function originalFee(p: AnyObj) { return Number(p.original_fee ?? p.fee ?? 0); }

export default function PaymentAuditPage() {
  const [services, setServices] = useState<AnyObj[]>([]);
  const [points, setPoints] = useState<AnyObj[]>([]);
  const [from, setFrom] = useState(monthStart());
  const [to, setTo] = useState(monthEnd());
  const [log, setLog] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);

  async function load() {
    setLoading(true);
    if (isSupabaseConfigured && supabase) {
      const [{ data: s }, { data: p }] = await Promise.all([
        supabase.from("services").select("*"),
        supabase.from("points").select("*")
      ]);
      setServices(s || []);
      setPoints(p || []);
    } else {
      const local = JSON.parse(localStorage.getItem("merchanops_local_v362") || localStorage.getItem("merchanops_local_v390") || "{}");
      setServices(local.services || []);
      setPoints((local.services || []).flatMap((x: AnyObj) => x.points || []));
    }
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  const hydrated = useMemo<AuditService[]>(() => services.map((s: AnyObj) => ({
    ...s,
    id: String(s.id),
    points: points.filter((p: AnyObj) => p.service_id === s.id || (s.points || []).some((sp: AnyObj) => sp.id === p.id))
  })), [services, points]);

  const audit = useMemo(() => hydrated.map(s => ({ s, issues: auditService(s), appears: shouldAppearInPayments(s, from, to), total: serviceTotal(s), payDate: effectivePaymentDate(s) })), [hydrated, from, to]);
  const withIssues = audit.filter(x => x.issues.length > 0);
  const inPayments = audit.filter(x => x.appears);

  async function normalize() {
    const messages: string[] = [];
    if (!supabase) {
      messages.push("Normalización automática solo disponible con Supabase activo.");
      setLog(messages);
      return;
    }

    for (const s of hydrated as AnyObj[]) {
      if ((s.status === "Validado" || s.status === "Pagado") && !s.validated_at) {
        const value = s.resolved_at || todayISO();
        await supabase.from("services").update({ validated_at: value }).eq("id", s.id);
        messages.push(`Servicio ${s.client || ""} · ${s.campaign || ""}: añadido validated_at.`);
      }
    }

    for (const p of points) {
      const st = pStatus(p);
      if (isFailedStatus(st) && !p.original_fee) {
        await supabase.from("points").update({ original_fee: Number(p.fee || 0), incident_fee: Number(p.incident_fee || INCIDENT_FEE) }).eq("id", p.id);
        messages.push(`Punto ${p.name || p.id}: guardado original_fee.`);
      }
      if (st === "Finalizado" && p.incident_status === "Abierta") {
        const original = originalFee(p);
        const inc = Number(p.incident_fee || INCIDENT_FEE);
        await supabase.from("points").update({ incident_status: "Resuelta", incident_resolved_at: todayISO(), fee: original + inc, original_fee: original, incident_fee: inc }).eq("id", p.id);
        messages.push(`Punto ${p.name || p.id}: incidencia finalizada y pago recalculado.`);
      }
    }

    if (!messages.length) messages.push("No había datos que normalizar.");
    setLog(messages);
    await load();
  }

  return <main className="min-h-screen bg-slate-100 p-4 text-slate-900"><section className="mx-auto max-w-7xl space-y-5"><div><a href="/" className="text-sm text-slate-500">← Volver</a><h1 className="mt-2 text-3xl font-bold">Auditoría de pagos</h1><p className="text-sm text-slate-500">Detecta servicios validados que no entran en pagos e incidencias/pospuestos con cálculo dudoso.</p></div><div className="rounded-3xl border bg-white p-5 shadow-sm"><div className="grid gap-3 md:grid-cols-4"><label><span className="text-xs text-slate-500">Desde</span><input className="mt-1 w-full rounded-xl border px-3 py-2" type="date" value={from} onChange={e => setFrom(e.target.value)} /></label><label><span className="text-xs text-slate-500">Hasta</span><input className="mt-1 w-full rounded-xl border px-3 py-2" type="date" value={to} onChange={e => setTo(e.target.value)} /></label><button onClick={load} className="self-end rounded-2xl border bg-white px-4 py-2">Actualizar</button><button onClick={normalize} className="self-end rounded-2xl bg-slate-900 px-4 py-2 text-white">Normalizar datos</button></div></div><div className="grid gap-3 md:grid-cols-4"><K label="Servicios" value={services.length} /><K label="Entrarían en pagos" value={inPayments.length} /><K label="Avisos" value={withIssues.length} /><K label="Total periodo" value={eur(inPayments.reduce((a, x) => a + x.total, 0))} /></div>{log.length > 0 && <div className="rounded-3xl border bg-white p-5 shadow-sm"><h2 className="font-semibold">Resultado de normalización</h2><ul className="mt-2 list-disc pl-5 text-sm text-slate-700">{log.map(x => <li key={x}>{x}</li>)}</ul></div>}<div className="rounded-3xl border bg-white p-5 shadow-sm"><h2 className="mb-3 text-xl font-semibold">Avisos detectados</h2>{loading ? <p>Cargando...</p> : withIssues.length === 0 ? <p className="text-sm text-emerald-700">No se detectan avisos.</p> : <div className="overflow-auto"><table className="w-full text-sm"><thead><tr className="bg-slate-50"><th className="p-2 text-left">Servicio</th><th>Estado</th><th>Fecha pago</th><th>Total</th><th>Avisos</th></tr></thead><tbody>{withIssues.map(({ s, issues, total, payDate }) => <tr key={s.id} className="border-t align-top"><td className="p-2"><b>{(s as AnyObj).client} · {(s as AnyObj).campaign}</b><p className="text-xs text-slate-500">{(s as AnyObj).worker_name || "Sin trabajador"}</p></td><td>{s.status}</td><td>{payDate}</td><td>{eur(total)}</td><td><ul className="list-disc pl-4 text-xs text-red-700">{issues.map(i => <li key={i}>{i}</li>)}</ul></td></tr>)}</tbody></table></div>}</div></section></main>;
}

function K({ label, value }: { label: string; value: any }) { return <div className="rounded-3xl border bg-white p-5 shadow-sm"><p className="text-sm text-slate-500">{label}</p><p className="text-2xl font-bold">{value}</p></div>; }

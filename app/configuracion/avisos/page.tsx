"use client";

/**
 * Avisos del sistema (solo administración): nada debe fallar en silencio.
 *  - Eventos del outbox en error/dead-letter, con reintento manual.
 *  - Obligaciones de pago bloqueadas (falta fecha/importe): dinero retenido
 *    hasta que se complete el dato, jamás pagado con datos inventados.
 *  - Últimas importaciones registradas (duplicados incluidos).
 */

import { useEffect, useState } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { isSupabaseConfigured, supabase } from "@/lib/supabase";
import { canViewFinancials, getCurrentAppSession } from "@/lib/access-control";

type Row = Record<string, any>;

function eur(cents: number) {
  return new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" }).format(Number(cents || 0) / 100);
}
function when(x?: string | null) {
  return x ? new Date(x).toLocaleString("es-ES") : "—";
}

export default function AvisosPage() {
  const [outbox, setOutbox] = useState<Row[]>([]);
  const [blocked, setBlocked] = useState<Row[]>([]);
  const [imports, setImports] = useState<Row[]>([]);
  const [sinObligacion, setSinObligacion] = useState<Row[]>([]);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const session = typeof window !== "undefined" ? getCurrentAppSession() : null;

  async function refresh() {
    if (!isSupabaseConfigured || !supabase) { setLoading(false); return; }
    setLoading(true);
    const [ob, bl, im, fin, obl] = await Promise.all([
      supabase.from("outbox_events").select("id,event_id,event_type,status,attempts,max_attempts,last_error,created_at,next_attempt_at").in("status", ["error", "dead_letter"]).order("created_at", { ascending: false }).limit(50),
      supabase.from("payment_obligations").select("obligation_key,origin,type,amount_cents,blocked_reasons,concept,status").eq("payable", false).eq("status", "calculado").order("obligation_key").limit(100),
      supabase.from("import_runs").select("id,source,file_name,actor,status,total_rows,valid_rows,rejected_rows,created_at").order("created_at", { ascending: false }).limit(10),
      // Punto ciego que faltaba: las obligaciones que NUNCA llegaron a crearse.
      // El bloque de arriba solo ve las que existen y están bloqueadas.
      supabase.from("isdin_vinyls").select("vinyl,base_payment,installer_name,province,status_changed_at").eq("status", "Finalizado"),
      supabase.from("payment_obligations").select("source_id").eq("type", "installation")
    ]);
    const problems = [ob.error, bl.error, im.error, fin.error, obl.error].filter(Boolean) as { message: string }[];
    setError(problems.length ? `Error cargando avisos: ${problems.map(e => e.message).join(" · ")}` : "");
    setOutbox((ob.data || []) as Row[]);
    setBlocked((bl.data || []) as Row[]);
    setImports((im.data || []) as Row[]);
    const conObligacion = new Set(((obl.data || []) as Row[]).map(row => String(row.source_id)));
    setSinObligacion(((fin.data || []) as Row[]).filter(row => !conObligacion.has(String(row.vinyl))));
    setLoading(false);
  }
  useEffect(() => { refresh(); }, []);

  async function retryEvent(row: Row) {
    if (!supabase) return;
    const { data, error: rpcError } = await supabase
      .from("outbox_events")
      .update({ status: "pendiente", attempts: 0, next_attempt_at: new Date().toISOString(), last_error: null })
      .eq("event_id", row.event_id)
      .in("status", ["error", "dead_letter"])
      .select("event_id")
      .maybeSingle();
    if (rpcError || !data) { setError(`NO se pudo reencolar ${row.event_id}: ${rpcError?.message || "ya no está en error"}`); return; }
    setNotice(`Evento ${row.event_id} reencolado: el consumidor lo reintentará en el próximo minuto.`);
    setTimeout(() => setNotice(""), 4000);
    await refresh();
  }

  if (!session?.active) return <Gate text="Inicia sesión en MerchanOps." />;
  if (!canViewFinancials(session)) return <Gate text="Los avisos del sistema solo están disponibles para administración." />;

  return (
    <main className="min-h-screen bg-slate-100 p-4 text-slate-900">
      <section className="mx-auto max-w-6xl space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h1 className="mo-page-title text-3xl font-bold">Avisos del sistema</h1>
          <button onClick={refresh} className="rounded-xl border bg-white px-3 py-2 text-sm font-semibold"><RefreshCw className="mr-1 inline h-4 w-4" />Actualizar</button>
        </div>
        {notice && <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">{notice}</div>}
        {error && <div className="rounded-2xl border border-red-200 bg-red-50 p-3 text-sm font-semibold text-red-700">{error}</div>}
        {loading && <div className="rounded-2xl border bg-white p-4 text-sm text-slate-500">Cargando avisos...</div>}

        <Card title={`Eventos con problemas (${outbox.length})`} tone={outbox.length ? "warn" : "ok"}>
          {outbox.length === 0 && <Empty text="Ningún evento en error ni en dead-letter. El outbox está sano." />}
          {outbox.map(row => (
            <div key={row.id} className="flex flex-wrap items-center justify-between gap-2 border-t py-3 text-sm">
              <div className="min-w-0">
                <p className="font-semibold">{row.event_type} <span className="font-mono text-xs text-slate-500">{row.event_id}</span></p>
                <p className="text-xs text-slate-500">{row.status === "dead_letter" ? "DEAD-LETTER (agotó reintentos)" : `error · intento ${row.attempts}/${row.max_attempts}`} · {when(row.created_at)}</p>
                {row.last_error && <p className="mt-1 max-w-3xl truncate text-xs text-red-700" title={row.last_error}>{row.last_error}</p>}
              </div>
              <button onClick={() => retryEvent(row)} className="rounded-xl border px-3 py-1.5 text-xs font-semibold hover:bg-slate-50">Reintentar</button>
            </div>
          ))}
        </Card>

        <Card title={`Obligaciones de pago bloqueadas (${blocked.length})`} tone={blocked.length ? "warn" : "ok"}>
          {blocked.length === 0 && <Empty text="Ninguna obligación bloqueada." />}
          {blocked.length > 0 && (
            <p className="border-t pt-3 text-xs text-slate-500">
              Estas líneas NO entran en pagos hasta completar el dato que falta (fecha real o importe original). Nunca se rellenan con la fecha de hoy ni con 0.
            </p>
          )}
          {blocked.map(row => (
            <div key={row.obligation_key} className="flex flex-wrap items-center justify-between gap-2 border-t py-3 text-sm">
              <div>
                <p className="font-semibold">{row.concept} <span className="font-mono text-xs text-slate-500">{row.obligation_key}</span></p>
                <p className="text-xs text-red-700">Bloqueada por: {(Array.isArray(row.blocked_reasons) ? row.blocked_reasons : []).join(", ") || "motivo no registrado"}</p>
              </div>
              <span className="font-semibold">{eur(row.amount_cents)}</span>
            </div>
          ))}
        </Card>

        <Card title={`Instalaciones terminadas sin obligación de pago (${sinObligacion.length})`} tone={sinObligacion.length ? "warn" : "ok"}>
          {sinObligacion.length === 0 && <Empty text="Todo el trabajo terminado tiene su obligación de pago registrada." />}
          {sinObligacion.length > 0 && (
            <p className="border-t pt-3 text-xs text-red-700">
              Estos vinilos están en «Finalizado» pero NO tienen obligación de instalación: es trabajo hecho que
              nadie va a cobrar. Se corrige entrando en el vinilo y guardando cualquier cambio (el volcado es
              automático), o desde «Volcar pagos pendientes» en la pantalla de Vinilos ISDIN.
            </p>
          )}
          {sinObligacion.map(row => (
            <div key={row.vinyl} className="flex flex-wrap items-center justify-between gap-2 border-t py-3 text-sm">
              <div>
                <p className="font-semibold">{row.installer_name || "Sin instalador"} <span className="font-mono text-xs text-slate-500">{row.vinyl}</span></p>
                <p className="text-xs text-slate-500">{row.province || "Sin provincia"} · terminado {when(row.status_changed_at)}</p>
              </div>
              <span className="font-semibold">{eur(Math.round(Number(row.base_payment || 0) * 100))}</span>
            </div>
          ))}
        </Card>

        <Card title="Últimas importaciones" tone="ok">
          {imports.length === 0 && <Empty text="Sin importaciones registradas todavía." />}
          {imports.map(row => (
            <div key={row.id} className="flex flex-wrap items-center justify-between gap-2 border-t py-3 text-sm">
              <div>
                <p className="font-semibold">{row.file_name} <span className="text-xs text-slate-500">({row.source})</span></p>
                <p className="text-xs text-slate-500">{when(row.created_at)} · {row.actor || "—"}</p>
              </div>
              <span className={`rounded-xl px-2 py-1 text-xs font-semibold ${row.status === "duplicada" ? "bg-amber-50 text-amber-800" : "bg-emerald-50 text-emerald-800"}`}>
                {row.status} · {row.valid_rows}/{row.total_rows} filas{row.rejected_rows ? ` · ${row.rejected_rows} rechazadas` : ""}
              </span>
            </div>
          ))}
        </Card>
      </section>
    </main>
  );
}

function Card({ title, tone, children }: { title: string; tone: "ok" | "warn"; children: React.ReactNode }) {
  return (
    <div className="rounded-3xl border bg-white p-5 shadow-sm">
      <h2 className="mb-1 flex items-center gap-2 text-xl font-semibold">
        {tone === "warn" && <AlertTriangle className="h-5 w-5 text-amber-500" />}
        {title}
      </h2>
      {children}
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return <p className="border-t pt-3 text-sm text-slate-500">{text}</p>;
}

function Gate({ text }: { text: string }) {
  return (
    <main className="min-h-screen bg-slate-100 p-4 text-slate-900">
      <section className="mx-auto mt-10 max-w-2xl rounded-3xl border bg-white p-5 shadow-sm">{text}</section>
    </main>
  );
}

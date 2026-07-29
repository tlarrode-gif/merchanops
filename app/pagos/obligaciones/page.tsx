"use client";

/**
 * Aprobación de pagos (P-13).
 *
 * Cierra el hueco que dejaba el ledger: calculaba correctamente lo que se debe
 * y ahí se acababa el rastro. Las 502 obligaciones llevaban desde su creación
 * en `calculado` porque nunca se construyó la pantalla que las mueve de estado,
 * así que los pagos se hacían fuera de MerchanOps y nadie conciliaba.
 *
 * QUIÉN PUEDE QUÉ (decisión de negocio)
 * El gestor aprueba los pagos de su zona de principio a fin —revisar, cerrar y
 * anular—; administración tiene visibilidad de todo. No hay segregación de
 * funciones: el gestor es responsable de su zona, igual que en el volcado de
 * obligaciones. El ámbito real lo impone la RLS (`pagos_scope`), no esta
 * pantalla: un gestor solo ve y toca las obligaciones de vinilos de sus
 * provincias, y esta UI no puede ampliarlo.
 *
 * CONCURRENCIA
 * Cada transición envía el `version` que se leyó. Si otro usuario tocó la línea
 * entretanto, el RPC la rechaza en vez de pisarla, y aquí se avisa y se recarga.
 *
 * Las correcciones de importe NUNCA se hacen editando: se anulan con motivo, que
 * es lo que imponen los triggers de inmutabilidad de la tabla.
 */

import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, Lock, RefreshCw, XCircle } from "lucide-react";
import { AppSession, canAccessModule, getCurrentAppSession, isAdminSession } from "@/lib/access-control";
import { LedgerRow, changeObligationStatus, listObligations } from "@/lib/payments/ledger";
import { ObligationStatus } from "@/lib/payments/types";

const ESTADO_LABEL: Record<ObligationStatus, string> = {
  calculado: "Calculado",
  revisado: "Revisado",
  cerrado: "Cerrado",
  anulado: "Anulado"
};
const ESTADO_CLASE: Record<ObligationStatus, string> = {
  calculado: "bg-slate-100 text-slate-700",
  revisado: "bg-blue-50 text-blue-800",
  cerrado: "bg-emerald-50 text-emerald-800",
  anulado: "bg-red-50 text-red-700"
};
// Espejo de OBLIGATION_TRANSITIONS: solo se ofrece lo que el servidor aceptará.
const SIGUIENTE: Partial<Record<ObligationStatus, ObligationStatus>> = {
  calculado: "revisado",
  revisado: "cerrado"
};

function eur(cents: number) {
  return new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" }).format(Number(cents || 0) / 100);
}

export default function ObligacionesPage() {
  const [session, setSession] = useState<AppSession | null>(null);
  const [rows, setRows] = useState<LedgerRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [seleccion, setSeleccion] = useState<Set<string>>(new Set());
  const [filtroEstado, setFiltroEstado] = useState<ObligationStatus | "">("calculado");
  const [filtroPeriodo, setFiltroPeriodo] = useState("");
  const [filtroTrabajador, setFiltroTrabajador] = useState("");

  useEffect(() => { setSession(getCurrentAppSession()); refresh(); }, []);

  async function refresh() {
    setLoading(true);
    setError("");
    try {
      setRows(await listObligations());
      setSeleccion(new Set());
    } catch (err) {
      setError(`No se pudieron cargar las obligaciones: ${err instanceof Error ? err.message : "error desconocido"}`);
      setRows([]);
    } finally {
      setLoading(false);
    }
  }

  const periodos = useMemo(() => Array.from(new Set(rows.map(r => r.period).filter(Boolean))).sort() as string[], [rows]);
  const trabajadores = useMemo(() => Array.from(new Set(rows.map(r => r.worker_name).filter(Boolean))).sort() as string[], [rows]);

  const visibles = useMemo(() => rows.filter(row =>
    (!filtroEstado || row.status === filtroEstado) &&
    (!filtroPeriodo || row.period === filtroPeriodo) &&
    (!filtroTrabajador || row.worker_name === filtroTrabajador)
  ), [rows, filtroEstado, filtroPeriodo, filtroTrabajador]);

  const totalVisible = visibles.reduce((sum, row) => sum + row.amount_cents, 0);
  const seleccionadas = visibles.filter(row => seleccion.has(row.obligation_key));
  const totalSeleccion = seleccionadas.reduce((sum, row) => sum + row.amount_cents, 0);

  // Un lote solo puede avanzar si todas las líneas comparten estado de origen.
  const estadosEnSeleccion = Array.from(new Set(seleccionadas.map(row => row.status)));
  const destinoLote = estadosEnSeleccion.length === 1 ? SIGUIENTE[estadosEnSeleccion[0]] : undefined;

  const porTrabajador = useMemo(() => {
    const acc = new Map<string, number>();
    visibles.forEach(row => acc.set(row.worker_name || "Sin instalador", (acc.get(row.worker_name || "Sin instalador") || 0) + row.amount_cents));
    return Array.from(acc.entries()).sort((a, b) => b[1] - a[1]);
  }, [visibles]);

  function toggle(key: string) {
    setSeleccion(prev => { const next = new Set(prev); next.has(key) ? next.delete(key) : next.add(key); return next; });
  }

  async function aplicar(destino: ObligationStatus, motivo?: string) {
    if (!seleccionadas.length) return;
    setBusy(true);
    setError("");
    const actor = session?.username || "Operaciones";
    const fallos: string[] = [];
    let ok = 0;
    for (const row of seleccionadas) {
      try {
        await changeObligationStatus(row.obligation_key, destino, actor, motivo, row.version);
        ok++;
      } catch (err) {
        fallos.push(`${row.obligation_key}: ${err instanceof Error ? err.message : "error"}`);
      }
    }
    setBusy(false);
    if (fallos.length) {
      // Nunca se anuncia un éxito global si alguna línea falló: se dice cuántas
      // pasaron y cuáles no, con el motivo exacto de cada una.
      setError(`${ok} de ${seleccionadas.length} actualizadas. Fallaron: ${fallos.join(" · ")}`);
    } else {
      setNotice(`${ok} obligación(es) a «${ESTADO_LABEL[destino]}».`);
      setTimeout(() => setNotice(""), 4000);
    }
    await refresh();
  }

  async function anular() {
    const motivo = window.prompt("Motivo de la anulación (obligatorio, queda en la auditoría):");
    if (!motivo || !motivo.trim()) { setError("La anulación necesita un motivo."); return; }
    await aplicar("anulado", motivo.trim());
  }

  if (!session?.active) return <Gate text="Inicia sesión en MerchanOps para ver las obligaciones de pago." />;
  if (!canAccessModule(session, "pagos")) return <Gate text="No tienes permiso para ver los pagos." />;

  const admin = isAdminSession(session);

  return (
    <main className="min-h-screen bg-slate-100 p-4 text-slate-900">
      <section className="mx-auto max-w-7xl space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h1 className="text-3xl font-bold">Aprobación de pagos</h1>
            <p className="text-sm text-slate-500">
              {admin ? "Administración: visibilidad de todas las provincias." : "Apruebas los pagos de tus provincias asignadas."}
            </p>
          </div>
          <button onClick={refresh} disabled={loading || busy} className="rounded-xl border bg-white px-3 py-2 text-sm font-semibold disabled:opacity-50">
            <RefreshCw className="mr-1 inline h-4 w-4" />Actualizar
          </button>
        </div>

        {notice && <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">{notice}</div>}
        {error && <div className="rounded-2xl border border-red-200 bg-red-50 p-3 text-sm font-semibold text-red-700">{error}</div>}

        <div className="rounded-3xl border bg-white p-4 shadow-sm">
          <div className="grid gap-3 md:grid-cols-4">
            <label className="block text-sm"><span className="font-medium">Estado</span>
              <select value={filtroEstado} onChange={e => setFiltroEstado(e.target.value as ObligationStatus | "")} className="mt-1 w-full rounded-2xl border bg-white px-3 py-2">
                <option value="">Todos</option>
                {(Object.keys(ESTADO_LABEL) as ObligationStatus[]).map(x => <option key={x} value={x}>{ESTADO_LABEL[x]}</option>)}
              </select></label>
            <label className="block text-sm"><span className="font-medium">Periodo</span>
              <select value={filtroPeriodo} onChange={e => setFiltroPeriodo(e.target.value)} className="mt-1 w-full rounded-2xl border bg-white px-3 py-2">
                <option value="">Todos</option>
                {periodos.map(x => <option key={x} value={x}>{x}</option>)}
              </select></label>
            <label className="block text-sm"><span className="font-medium">Instalador</span>
              <select value={filtroTrabajador} onChange={e => setFiltroTrabajador(e.target.value)} className="mt-1 w-full rounded-2xl border bg-white px-3 py-2">
                <option value="">Todos</option>
                {trabajadores.map(x => <option key={x} value={x}>{x}</option>)}
              </select></label>
            <div className="self-end rounded-2xl bg-slate-50 p-3 text-sm">
              <p className="text-slate-500">{visibles.length} línea(s)</p>
              <p className="text-xl font-bold">{eur(totalVisible)}</p>
            </div>
          </div>

          {seleccionadas.length > 0 && (
            <div className="mt-3 flex flex-wrap items-center gap-2 rounded-2xl bg-slate-900 p-3 text-white">
              <span className="text-sm font-semibold">{seleccionadas.length} seleccionada(s) · {eur(totalSeleccion)}</span>
              <div className="ml-auto flex flex-wrap gap-2">
                {destinoLote && (
                  <button onClick={() => aplicar(destinoLote)} disabled={busy} className="rounded-xl bg-white px-3 py-1.5 text-sm font-semibold text-slate-900 disabled:opacity-50">
                    {destinoLote === "cerrado" ? <Lock className="mr-1 inline h-4 w-4" /> : <CheckCircle2 className="mr-1 inline h-4 w-4" />}
                    Pasar a «{ESTADO_LABEL[destinoLote]}»
                  </button>
                )}
                {!destinoLote && estadosEnSeleccion.length > 1 && (
                  <span className="self-center text-xs text-slate-300">Selecciona líneas del mismo estado para avanzarlas en lote.</span>
                )}
                <button onClick={anular} disabled={busy} className="rounded-xl border border-red-300 bg-red-50 px-3 py-1.5 text-sm font-semibold text-red-700 disabled:opacity-50">
                  <XCircle className="mr-1 inline h-4 w-4" />Anular con motivo
                </button>
              </div>
            </div>
          )}
        </div>

        {loading && <div className="rounded-2xl border bg-white p-4 text-sm text-slate-500">Cargando obligaciones...</div>}

        {!loading && visibles.length === 0 && (
          <div className="rounded-3xl border bg-white p-5 text-sm text-slate-500">
            No hay obligaciones con esos filtros. Si esperabas ver trabajo terminado aquí, revisa
            «Volcar pagos pendientes» en la pantalla de Vinilos ISDIN.
          </div>
        )}

        {!loading && visibles.length > 0 && (
          <div className="rounded-3xl border bg-white p-4 shadow-sm">
            <div className="overflow-auto">
              <table className="w-full min-w-[900px] text-sm">
                <thead>
                  <tr className="bg-slate-50">
                    <th className="p-2 text-left">
                      <input type="checkbox" aria-label="Seleccionar todo"
                        checked={visibles.length > 0 && seleccionadas.length === visibles.length}
                        onChange={e => setSeleccion(e.target.checked ? new Set(visibles.map(r => r.obligation_key)) : new Set())} />
                    </th>
                    <th className="p-2 text-left">Concepto</th>
                    <th className="p-2 text-left">Instalador</th>
                    <th className="p-2 text-left">Periodo</th>
                    <th className="p-2 text-left">Fecha</th>
                    <th className="p-2 text-left">Estado</th>
                    <th className="p-2 text-right">Importe</th>
                  </tr>
                </thead>
                <tbody>
                  {visibles.map(row => (
                    <tr key={row.obligation_key} className={`border-t ${seleccion.has(row.obligation_key) ? "bg-slate-50" : ""}`}>
                      <td className="p-2">
                        <input type="checkbox" checked={seleccion.has(row.obligation_key)} onChange={() => toggle(row.obligation_key)}
                          aria-label={`Seleccionar ${row.obligation_key}`} />
                      </td>
                      <td className="p-2">
                        <p className="font-semibold">{row.concept}</p>
                        <p className="font-mono text-xs text-slate-500">{row.obligation_key}</p>
                        {!row.payable && row.blocked_reasons?.length > 0 && (
                          <p className="text-xs text-red-700">Bloqueada: {row.blocked_reasons.join(", ")}</p>
                        )}
                      </td>
                      <td className="p-2">{row.worker_name || "Sin instalador"}</td>
                      <td className="p-2">{row.period || "—"}</td>
                      <td className="p-2">{row.event_date || "—"}</td>
                      <td className="p-2">
                        <span className={`rounded-full px-2 py-1 text-xs font-semibold ${ESTADO_CLASE[row.status]}`}>{ESTADO_LABEL[row.status]}</span>
                      </td>
                      <td className="p-2 text-right font-semibold">{eur(row.amount_cents)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {!loading && porTrabajador.length > 0 && (
          <div className="rounded-3xl border bg-white p-5 shadow-sm">
            <h2 className="mb-3 text-xl font-semibold">Totales por instalador</h2>
            {porTrabajador.map(([nombre, cents]) => (
              <div key={nombre} className="flex justify-between border-t py-2 text-sm">
                <span>{nombre}</span><b>{eur(cents)}</b>
              </div>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}

function Gate({ text }: { text: string }) {
  return (
    <main className="min-h-screen bg-slate-100 p-4 text-slate-900">
      <section className="mx-auto mt-10 max-w-2xl rounded-3xl border bg-white p-5 shadow-sm">{text}</section>
    </main>
  );
}

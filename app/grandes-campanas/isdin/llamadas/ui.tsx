"use client";

import { useEffect, useState } from "react";
import { Clipboard, ExternalLink, MoreHorizontal, Save, X } from "lucide-react";
import {
  IsdinCall,
  IsdinCallStatus,
  callNeedsOperationsAlert,
  callStatusClass,
  callStatusGroup,
  cleanCallStatus,
  dateOnly,
  isdinCallStatuses,
  isdinWeekLabel,
  type CallsFilters
} from "@/lib/isdin-calls";

type Stats = {
  total: number;
  pendientes: number;
  realizadas: number;
  contactadas: number;
  confirmados: number;
  noContesta: number;
  incidencias: number;
  pospuestos: number;
  cancelados: number;
  revision: number;
  alertas: number;
  completado: number;
  confirmacion: number;
  problemasPreventivos: number;
};

type AnalyticsRow = { name: string; total: number };
type Analytics = {
  byProvince: AnalyticsRow[];
  byWeek: AnalyticsRow[];
  byStatus: AnalyticsRow[];
  byBackoffice: AnalyticsRow[];
};

export function Notice({ notice, error }: { notice: string; error: string }) {
  return (
    <>
      {notice && <div className="fixed right-4 top-24 z-50 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-2 text-sm text-emerald-800 shadow">{notice}</div>}
      {error && <div className="rounded-2xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</div>}
    </>
  );
}

export function ModeTabs({ mode, setMode }: { mode: "operativa" | "analisis"; setMode: (mode: "operativa" | "analisis") => void }) {
  return (
    <div className="inline-flex rounded-2xl border bg-white p-1">
      <button onClick={() => setMode("operativa")} className={tabClass(mode === "operativa")}>Operativa</button>
      <button onClick={() => setMode("analisis")} className={tabClass(mode === "analisis")}>Análisis</button>
    </div>
  );
}

export function CallsKpiSummary({ stats, mode }: { stats: Stats; mode: "operativa" | "analisis" }) {
  const operational = [
    ["Total registros", stats.total],
    ["Pendientes", stats.pendientes],
    ["Contactadas", stats.contactadas],
    ["Confirmadas", stats.confirmados],
    ["No contesta", stats.noContesta],
    ["Alertas", stats.alertas]
  ];
  const analysis = [
    ...operational,
    ["Llamadas realizadas", stats.realizadas],
    ["Incidencias en llamada", stats.incidencias],
    ["Pospuestos en llamada", stats.pospuestos],
    ["Cancelados en llamada", stats.cancelados],
    ["Requieren revisión", stats.revision],
    ["% completado", `${stats.completado}%`],
    ["% confirmación", `${stats.confirmacion}%`],
    ["% problemas preventivos", `${stats.problemasPreventivos}%`]
  ];
  const rows = mode === "operativa" ? operational : analysis;
  return <div className="grid gap-3 md:grid-cols-3 lg:grid-cols-6">{rows.map(([label, value]) => <Kpi key={label} label={String(label)} value={value} />)}</div>;
}

export function CallsFilters({
  filters,
  setFilters,
  emptyFilters,
  weeks,
  statuses,
  provinces,
  cities,
  installers,
  backofficeUsers
}: {
  filters: CallsFilters;
  setFilters: (filters: CallsFilters) => void;
  emptyFilters: CallsFilters;
  weeks: string[];
  statuses: readonly string[];
  provinces: string[];
  cities: string[];
  installers: string[];
  backofficeUsers: string[];
}) {
  const [advancedOpen, setAdvancedOpen] = useState(false);
  function patch(patchFilters: Partial<CallsFilters>) {
    setFilters({ ...filters, ...patchFilters });
  }
  return (
    <Card>
      <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
        <Select label="Semana" value={filters.week} onChange={value => patch({ week: value })} options={["", ...weeks]} />
        <Select label="Estado" value={filters.status} onChange={value => patch({ status: value })} options={["", ...statuses]} />
        <Select label="Provincia" value={filters.province} onChange={value => patch({ province: value })} options={["", ...provinces]} />
        <Input label="Buscar VIN o farmacia" value={filters.q} onChange={value => patch({ q: value })} />
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        <FilterButton label="Pendientes" active={filters.quick === "pendientes"} onClick={() => patch({ quick: filters.quick === "pendientes" ? "" : "pendientes" })} />
        <FilterButton label="No contesta" active={filters.quick === "no-contesta"} onClick={() => patch({ quick: filters.quick === "no-contesta" ? "" : "no-contesta" })} />
        <FilterButton label="Confirmadas" active={filters.quick === "confirmadas"} onClick={() => patch({ quick: filters.quick === "confirmadas" ? "" : "confirmadas" })} />
        <FilterButton label="Alertas" active={filters.quick === "alertas"} onClick={() => patch({ quick: filters.quick === "alertas" ? "" : "alertas" })} />
        <button onClick={() => setFilters(emptyFilters)} className="rounded-2xl border bg-white px-4 py-2 text-sm font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-slate-900">Limpiar filtros</button>
      </div>
      <div className="mt-4 rounded-2xl border bg-slate-50">
        <button onClick={() => setAdvancedOpen(!advancedOpen)} className="flex w-full items-center justify-between px-4 py-3 text-left text-sm font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-slate-900">
          Filtros avanzados
          <span>{advancedOpen ? "Cerrar" : "Abrir"}</span>
        </button>
        {advancedOpen && (
          <div className="grid gap-3 border-t p-4 md:grid-cols-2 lg:grid-cols-5">
            <Select label="Ciudad" value={filters.city} onChange={value => patch({ city: value })} options={["", ...cities]} />
            <Select label="Instalador" value={filters.installer} onChange={value => patch({ installer: value })} options={["", ...installers]} />
            <Select label="Operador Backoffice" value={filters.backoffice} onChange={value => patch({ backoffice: value })} options={["", ...backofficeUsers]} />
            <Input label="Fecha llamada desde" type="date" value={filters.from} onChange={value => patch({ from: value })} />
            <Input label="Fecha llamada hasta" type="date" value={filters.to} onChange={value => patch({ to: value })} />
          </div>
        )}
      </div>
    </Card>
  );
}

export function CallsOperationalView({
  calls,
  loading,
  onOpen,
  onQuickStatus,
  onCopySummary
}: {
  calls: IsdinCall[];
  loading: boolean;
  onOpen: (call: IsdinCall) => void;
  onQuickStatus: (call: IsdinCall, status: IsdinCallStatus) => Promise<void>;
  onCopySummary: (call: IsdinCall) => Promise<void>;
}) {
  if (loading) return <Card>Cargando llamadas...</Card>;
  return (
    <Card>
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-xl font-semibold">Trabajo de llamadas</h2>
        <span className="text-sm text-slate-500">{calls.length} registros visibles</span>
      </div>
      <div className="hidden overflow-hidden rounded-2xl border lg:block">
        <table className="w-full table-fixed text-sm">
          <thead>
            <tr className="bg-slate-900 text-white">
              <th className="w-[24%] p-3 text-left">VIN / Farmacia</th>
              <th className="w-[14%] p-3 text-left">Semana</th>
              <th className="w-[10%] p-3 text-left">Provincia</th>
              <th className="w-[14%] p-3 text-left">Estado llamada</th>
              <th className="w-[16%] p-3 text-left">Último contacto</th>
              <th className="w-[10%] p-3 text-left">Alerta</th>
              <th className="w-[12%] p-3 text-left">Acción</th>
            </tr>
          </thead>
          <tbody>{calls.map(call => <CallRow key={call.id} call={call} onOpen={onOpen} onQuickStatus={onQuickStatus} onCopySummary={onCopySummary} />)}</tbody>
        </table>
      </div>
      <div className="space-y-3 lg:hidden">
        {calls.map(call => <CallCard key={call.id} call={call} onOpen={onOpen} onQuickStatus={onQuickStatus} onCopySummary={onCopySummary} />)}
      </div>
      {!calls.length && <p className="rounded-2xl bg-slate-50 p-4 text-sm text-slate-500">No hay llamadas con estos filtros.</p>}
    </Card>
  );
}

export function CallsAnalyticsView({ stats, analytics, total }: { stats: Stats; analytics: Analytics; total: number }) {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <ChartCard title="Llamadas por provincia" rows={analytics.byProvince} total={total} />
      <ChartCard title="Llamadas por semana" rows={analytics.byWeek} total={total} />
      <ChartCard title="Llamadas por estado" rows={analytics.byStatus} total={total} />
      <ChartCard title="Operador Backoffice" rows={analytics.byBackoffice} total={total} />
      <Card>
        <h3 className="mb-3 font-semibold">Resumen porcentual</h3>
        <Metric label="Completado" value={`${stats.completado}%`} />
        <Metric label="Confirmación" value={`${stats.confirmacion}%`} />
        <Metric label="Problemas detectados preventivamente" value={`${stats.problemasPreventivos}%`} />
      </Card>
    </div>
  );
}

export function CallDrawer({
  call,
  saving,
  onClose,
  onSave,
  onSaveAndNext,
  onQuickStatus,
  onCopySummary
}: {
  call: IsdinCall;
  saving: boolean;
  onClose: () => void;
  onSave: (patch: Partial<IsdinCall>) => Promise<boolean>;
  onSaveAndNext: (patch: Partial<IsdinCall>) => Promise<void>;
  onQuickStatus: (status: IsdinCallStatus) => Promise<void>;
  onCopySummary: () => Promise<void>;
}) {
  const [draft, setDraft] = useState(call);
  useEffect(() => setDraft(call), [call]);
  function patch(next: Partial<IsdinCall>) {
    setDraft({ ...draft, ...next });
  }
  async function save(closeAfter = true) {
    const ok = await onSave(draft);
    if (ok && closeAfter) onClose();
  }
  async function quick(status: IsdinCallStatus) {
    if (status === "No contesta" || status === "Confirmado") {
      await onQuickStatus(status);
      onClose();
      return;
    }
    patch({ call_status: status, requires_operations_review: status === "Requiere revisión operaciones" || draft.requires_operations_review });
  }
  return (
    <div className="fixed inset-0 z-50 bg-black/30">
      <aside className="ml-auto flex h-full w-full max-w-3xl flex-col bg-white shadow-2xl md:rounded-l-3xl">
        <div className="flex items-start justify-between gap-3 border-b p-4">
          <div>
            <p className="font-mono text-xs text-slate-500">{call.vin}</p>
            <h2 className="text-xl font-semibold">{call.pharmacy_name}</h2>
            <p className="text-sm text-slate-500">{call.city || "Sin ciudad"} · {call.province || "Sin provincia"}</p>
          </div>
          <button onClick={onClose} aria-label="Cerrar ficha de llamada" className="rounded-xl border p-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-slate-900"><X className="h-4 w-4" /></button>
        </div>
        <div className="flex-1 space-y-5 overflow-auto p-4">
          <Section title="Contexto">
            <div className="grid gap-3 md:grid-cols-2">
              <Read label="VIN" value={call.vin} />
              <Read label="Campaña" value={call.vinyl_campaign || "Sin campaña"} />
              <Read label="Semana instalación" value={call.desired_installation_week || "Sin semana"} />
              <Read label="Fecha prevista" value={dateOnly(call.desired_installation_date) || "Sin fecha"} />
              <Read label="Dirección" value={[call.street, call.street_number, call.postal_code].filter(Boolean).join(", ") || "Sin dirección"} />
              <Read label="Instalador" value={call.installer_name || call.worker_name || "Sin instalador"} />
              <Read label="Observaciones ISDIN" value={call.client_observations || "Sin observaciones"} />
              <Read label="Andamio" value={call.scaffold_required ? "Sí" : "No"} />
            </div>
          </Section>
          <Section title="Acciones rápidas">
            <div className="flex flex-wrap gap-2">
              {(["Confirmado", "No contesta", "Incidencia en llamada", "Pospuesto en llamada", "Cancelado en llamada", "Requiere revisión operaciones"] as IsdinCallStatus[]).map(status => (
                <button key={status} onClick={() => quick(status)} className="rounded-2xl border bg-white px-3 py-2 text-sm font-medium focus-visible:outline focus-visible:outline-2 focus-visible:outline-slate-900">{status}</button>
              ))}
            </div>
          </Section>
          <Section title="Datos de llamada">
            <div className="grid gap-3 md:grid-cols-2">
              <Select label="Estado de llamada" value={draft.call_status} onChange={value => patch({ call_status: cleanCallStatus(value), requires_operations_review: value === "Requiere revisión operaciones" || draft.requires_operations_review })} options={[...isdinCallStatuses]} />
              <Input label="Fecha y hora de llamada" type="datetime-local" value={String(draft.call_datetime || "").slice(0, 16)} onChange={value => patch({ call_datetime: value })} />
              <Input label="Franja horaria" value={draft.call_time_slot || ""} onChange={value => patch({ call_time_slot: value })} />
              <Input label="Persona contactada" value={draft.contact_person || ""} onChange={value => patch({ contact_person: value })} />
              <Input label="Teléfono" value={draft.phone_number || ""} onChange={value => patch({ phone_number: value })} />
              <Input label="Operador Backoffice" value={draft.backoffice_user || ""} onChange={value => patch({ backoffice_user: value })} />
              <Input label="Nueva fecha propuesta" type="date" value={dateOnly(draft.next_visit_date)} onChange={value => patch({ next_visit_date: value, next_visit_week: isdinWeekLabel(value) })} />
              <Read label="Nueva semana calculada" value={draft.next_visit_week || "Sin nueva semana"} />
            </div>
            <label className="mt-3 flex items-center gap-2 rounded-2xl border bg-slate-50 p-3 text-sm">
              <input type="checkbox" checked={!!draft.requires_operations_review} onChange={event => patch({ requires_operations_review: event.target.checked })} />
              Requiere revisión operaciones
            </label>
            <Textarea label="Comentario" value={draft.call_comment || ""} onChange={value => patch({ call_comment: value })} />
          </Section>
        </div>
        <div className="flex flex-col gap-2 border-t p-4 md:flex-row md:items-center md:justify-between">
          <div className="flex flex-wrap gap-2">
            <a href={`/grandes-campanas/isdin?q=${encodeURIComponent(call.vin)}`} className="rounded-2xl border bg-white px-3 py-2 text-sm"><ExternalLink className="mr-1 inline h-4 w-4" />Ver vinilo relacionado</a>
            <button onClick={onCopySummary} className="rounded-2xl border bg-white px-3 py-2 text-sm"><Clipboard className="mr-1 inline h-4 w-4" />Copiar resumen</button>
          </div>
          <div className="flex flex-wrap gap-2">
            <button onClick={onClose} className="rounded-2xl border bg-white px-4 py-2 text-sm">Cancelar</button>
            <button disabled={saving} onClick={() => onSaveAndNext(draft)} className="rounded-2xl border bg-white px-4 py-2 text-sm disabled:opacity-50">Guardar y siguiente</button>
            <button disabled={saving} onClick={() => save(true)} className="rounded-2xl bg-slate-900 px-4 py-2 text-sm text-white disabled:opacity-50"><Save className="mr-1 inline h-4 w-4" />Guardar</button>
          </div>
        </div>
      </aside>
    </div>
  );
}

function CallRow({ call, onOpen, onQuickStatus, onCopySummary }: { call: IsdinCall; onOpen: (call: IsdinCall) => void; onQuickStatus: (call: IsdinCall, status: IsdinCallStatus) => Promise<void>; onCopySummary: (call: IsdinCall) => Promise<void> }) {
  const alert = callNeedsOperationsAlert(call);
  return (
    <tr className={alert ? "border-t bg-rose-50/60 align-top" : "border-t bg-white align-top"}>
      <td className="p-3"><VinCell call={call} /></td>
      <td className="p-3 text-xs">{call.desired_installation_week || "Sin semana"}</td>
      <td className="p-3">{call.province || ""}</td>
      <td className="p-3"><CallStatusBadge call={call} /></td>
      <td className="p-3"><LastContact call={call} /></td>
      <td className="p-3">{alert && <AlertPill call={call} />}</td>
      <td className="p-3"><RowActions call={call} onOpen={onOpen} onQuickStatus={onQuickStatus} onCopySummary={onCopySummary} /></td>
    </tr>
  );
}

function CallCard(props: { call: IsdinCall; onOpen: (call: IsdinCall) => void; onQuickStatus: (call: IsdinCall, status: IsdinCallStatus) => Promise<void>; onCopySummary: (call: IsdinCall) => Promise<void> }) {
  const { call } = props;
  return (
    <div className={callNeedsOperationsAlert(call) ? "rounded-2xl border border-rose-200 bg-rose-50 p-4" : "rounded-2xl border bg-white p-4"}>
      <div className="flex items-start justify-between gap-3"><VinCell call={call} /><CallStatusBadge call={call} /></div>
      <div className="mt-3 grid gap-2 text-sm">
        <Read label="Semana" value={call.desired_installation_week || "Sin semana"} />
        <Read label="Provincia" value={call.province || "Sin provincia"} />
        <LastContact call={call} />
        {callNeedsOperationsAlert(call) && <AlertPill call={call} />}
      </div>
      <div className="mt-3"><RowActions {...props} /></div>
    </div>
  );
}

function RowActions({ call, onOpen, onQuickStatus, onCopySummary }: { call: IsdinCall; onOpen: (call: IsdinCall) => void; onQuickStatus: (call: IsdinCall, status: IsdinCallStatus) => Promise<void>; onCopySummary: (call: IsdinCall) => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const primary = cleanCallStatus(call.call_status) === "Pendiente de llamar" ? "Registrar llamada" : "Editar llamada";
  return (
    <div className="relative flex items-center gap-2">
      <button onClick={() => onOpen(call)} className="rounded-2xl bg-slate-900 px-3 py-2 text-xs font-semibold text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-slate-900">{primary}</button>
      <button aria-label={`Más acciones para ${call.vin}`} onClick={() => setOpen(!open)} className="rounded-xl border bg-white p-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-slate-900"><MoreHorizontal className="h-4 w-4" /></button>
      {open && (
        <div className="absolute right-0 top-10 z-20 w-56 rounded-2xl border bg-white p-2 text-sm shadow-xl">
          <button onClick={() => onQuickStatus(call, "Confirmado")} className="block w-full rounded-xl px-3 py-2 text-left hover:bg-slate-50">Marcar confirmado</button>
          <button onClick={() => onQuickStatus(call, "No contesta")} className="block w-full rounded-xl px-3 py-2 text-left hover:bg-slate-50">Registrar no contesta</button>
          <button onClick={() => onCopySummary(call)} className="block w-full rounded-xl px-3 py-2 text-left hover:bg-slate-50">Copiar resumen</button>
          <a href={`/grandes-campanas/isdin?q=${encodeURIComponent(call.vin)}`} className="block rounded-xl px-3 py-2 hover:bg-slate-50">Ver vinilo</a>
        </div>
      )}
    </div>
  );
}

function VinCell({ call }: { call: IsdinCall }) {
  return <div><p className="font-mono text-xs text-slate-500">{call.vin}</p><p className="font-semibold leading-tight">{call.pharmacy_name}</p><p className="text-xs text-slate-500">{call.city || "Sin ciudad"}</p></div>;
}

function LastContact({ call }: { call: IsdinCall }) {
  return <div className="text-xs"><p>{call.call_datetime ? String(call.call_datetime).replace("T", " ").slice(0, 16) : "Sin contacto"}</p>{call.contact_person && <p className="text-slate-500">{call.contact_person}</p>}</div>;
}

function AlertPill({ call }: { call: IsdinCall }) {
  return <span className="inline-flex rounded-full bg-rose-100 px-2 py-1 text-xs font-semibold text-rose-800">{call.requires_operations_review ? "Revisión operaciones" : cleanCallStatus(call.call_status)}</span>;
}

function CallStatusBadge({ call }: { call: IsdinCall }) {
  return <div><span className={`inline-flex rounded-full px-2 py-1 text-xs font-semibold ring-1 ${callStatusClass(call.call_status)}`}>{cleanCallStatus(call.call_status)}</span><p className="mt-1 text-[11px] text-slate-500">{callStatusGroup(call.call_status, call.requires_operations_review)}</p></div>;
}

function ChartCard({ title, rows, total }: { title: string; rows: AnalyticsRow[]; total: number }) {
  return (
    <Card>
      <h3 className="mb-3 font-semibold">{title}</h3>
      <div className="space-y-3">
        {rows.slice(0, 10).map(row => (
          <div key={row.name}>
            <div className="flex justify-between gap-3 text-sm"><span className="truncate">{row.name}</span><b>{row.total}</b></div>
            <div className="mt-1 h-2 overflow-hidden rounded-full bg-slate-100"><div className="h-full bg-slate-900" style={{ width: `${Math.max(4, total ? (row.total / total) * 100 : 0)}%` }} /></div>
          </div>
        ))}
        {!rows.length && <p className="text-sm text-slate-500">Sin datos.</p>}
      </div>
    </Card>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return <div className="rounded-3xl border bg-white p-5 shadow-sm">{children}</div>;
}

function Kpi({ label, value }: { label: string; value: React.ReactNode }) {
  return <Card><p className="text-sm text-slate-500">{label}</p><p className="text-2xl font-bold">{value}</p></Card>;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return <section className="rounded-3xl border bg-white p-4"><h3 className="mb-3 font-semibold">{title}</h3>{children}</section>;
}

function Read({ label, value }: { label: string; value: React.ReactNode }) {
  return <div><p className="text-xs font-medium text-slate-500">{label}</p><p className="text-sm text-slate-900">{value}</p></div>;
}

function Metric({ label, value }: { label: string; value: React.ReactNode }) {
  return <div className="flex justify-between border-b py-2 text-sm"><span className="text-slate-500">{label}</span><b>{value}</b></div>;
}

function Input({ label, value, onChange, type = "text" }: { label: string; value?: string | number | null; onChange: (value: string) => void; type?: string }) {
  return <label className="block"><span className="text-sm font-medium">{label}</span><input type={type} value={value ?? ""} onChange={event => onChange(event.target.value)} className="w-full rounded-2xl border px-3 py-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-slate-900" /></label>;
}

function Textarea({ label, value, onChange }: { label: string; value?: string | null; onChange: (value: string) => void }) {
  return <label className="mt-3 block"><span className="text-sm font-medium">{label}</span><textarea value={value ?? ""} onChange={event => onChange(event.target.value)} rows={5} className="w-full rounded-2xl border p-3 focus-visible:outline focus-visible:outline-2 focus-visible:outline-slate-900" /></label>;
}

function Select({ label, value, onChange, options }: { label: string; value?: string | null; onChange: (value: string) => void; options: readonly string[] }) {
  return <label className="block"><span className="text-sm font-medium">{label}</span><select value={value ?? ""} onChange={event => onChange(event.target.value)} className="w-full rounded-2xl border bg-white px-3 py-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-slate-900">{options.map(option => <option key={option} value={option}>{option || "Todos"}</option>)}</select></label>;
}

function FilterButton({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return <button onClick={onClick} className={active ? "rounded-2xl bg-slate-900 px-4 py-2 text-sm font-medium text-white" : "rounded-2xl border bg-white px-4 py-2 text-sm font-medium"}>{label}</button>;
}

function tabClass(active: boolean) {
  return active ? "rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white" : "rounded-xl px-4 py-2 text-sm font-semibold text-slate-600 hover:text-slate-900";
}

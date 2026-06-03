"use client";

import { Copy, Edit3, MessageCircle, Trash2 } from "lucide-react";
import type { ReactNode } from "react";

type WorkerLike = { id: string; name: string; phone?: string | null };
type ClientLike = { id: string; name: string };
type PointLike = {
  id: string;
  name: string;
  address?: string | null;
  report_code?: string | null;
  point_status?: string | null;
  status?: string | null;
  point_comment?: string | null;
  incident_comment?: string | null;
};
type ServiceLike = {
  id: string;
  client_id?: string | null;
  client: string;
  ceco?: string | null;
  campaign: string;
  province?: string | null;
  deadline?: string | null;
  worker_id?: string | null;
  worker_name?: string | null;
  status?: string | null;
  payment_type?: string | null;
  calendar_color?: string | null;
  points?: PointLike[];
};

type ServicesTableProps = {
  services: ServiceLike[];
  clients: ClientLike[];
  workers: WorkerLike[];
  serviceStatuses: string[];
  pointStatuses: string[];
  colorFor: (service: ServiceLike) => { bg: string; label?: string };
  eur: (value: number) => string;
  serviceTotal: (service: ServiceLike) => number;
  isOverdue: (service: ServiceLike) => boolean;
  buildWhatsApp: (service: ServiceLike) => string;
  todayISO: () => string;
  updateService: (service: ServiceLike, patch: Partial<ServiceLike>) => void;
  updatePoint: (point: PointLike, patch: Partial<PointLike>) => void;
  editService: (service: ServiceLike) => void;
  duplicateService: (service: ServiceLike) => void;
  deleteService: (service: ServiceLike) => void;
  pointStatus: (point: PointLike) => string;
  pointPay: (point: PointLike) => number;
  pointOriginal: (point: PointLike) => number;
  isIncidentActive: (point: PointLike) => boolean;
  renderHourlyBox?: (service: ServiceLike) => ReactNode;
};

function initials(name?: string | null) {
  return String(name || "?").trim().slice(0, 2).toUpperCase();
}

function statusBadge(status?: string | null) {
  const s = status || "Pendiente asignar";
  const map: Record<string, string> = {
    "Pendiente asignar": "bg-amber-50 text-amber-700 border-amber-200",
    "Asignado": "bg-blue-50 text-blue-700 border-blue-200",
    "Info enviada": "bg-sky-50 text-sky-700 border-sky-200",
    "Material pendiente": "bg-orange-50 text-orange-700 border-orange-200",
    "Material recibido": "bg-teal-50 text-teal-700 border-teal-200",
    "En ejecución": "bg-indigo-50 text-indigo-700 border-indigo-200",
    "Reportado": "bg-cyan-50 text-cyan-700 border-cyan-200",
    "Validado": "bg-green-50 text-green-700 border-green-200",
    "Incidencia": "bg-red-50 text-red-700 border-red-200",
    "Pagado": "bg-emerald-50 text-emerald-700 border-emerald-200"
  };
  return <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${map[s] || "border-slate-200 bg-slate-50 text-slate-700"}`}>{s}</span>;
}

function SelectMini({ value, onChange, options, labels = {} }: { value: string; onChange: (v: string) => void; options: string[]; labels?: Record<string, ReactNode> }) {
  return (
    <select value={value || ""} onChange={e => onChange(e.target.value)} className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs text-slate-700 focus:outline-none focus:ring-1 focus:ring-slate-400">
      {options.map(o => <option key={o} value={o}>{labels[o] || o || "Seleccionar"}</option>)}
    </select>
  );
}

export function ServicesTable({ services, workers, serviceStatuses, pointStatuses, colorFor, eur, serviceTotal, isOverdue, buildWhatsApp, todayISO, updateService, updatePoint, editService, duplicateService, deleteService, pointStatus, pointPay, pointOriginal, isIncidentActive, renderHourlyBox }: ServicesTableProps) {
  return (
    <div className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-sm">
      <div className="overflow-auto">
        <table className="w-full border-collapse text-sm">
          <thead className="bg-slate-50">
            <tr>
              <th className="border-b border-slate-200 px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Cliente · Campaña</th>
              <th className="border-b border-slate-200 px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Instalador</th>
              <th className="border-b border-slate-200 px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Provincia</th>
              <th className="border-b border-slate-200 px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Estado</th>
              <th className="border-b border-slate-200 px-3 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">Fecha límite</th>
              <th className="border-b border-slate-200 px-3 py-2.5 text-right text-xs font-semibold uppercase tracking-wide text-slate-500">Total</th>
              <th className="border-b border-slate-200 px-3 py-2.5 text-right text-xs font-semibold uppercase tracking-wide text-slate-500">Acciones</th>
            </tr>
          </thead>
          <tbody>
            {services.map(service => {
              const worker = workers.find(w => w.id === service.worker_id);
              const overdue = isOverdue(service);
              return (
                <tr key={service.id} className="border-b border-slate-100 align-top transition-colors hover:bg-slate-50/80 last:border-0">
                  <td className="px-3 py-3">
                    <div className="flex items-start gap-2">
                      <span className="mt-1.5 h-2.5 w-2.5 rounded-full" style={{ backgroundColor: colorFor(service).bg }} />
                      <div>
                        <p className="font-semibold text-slate-900">{service.client} · {service.campaign}</p>
                        <p className="mt-0.5 text-xs text-slate-500">{service.ceco ? <span className="font-mono rounded-md bg-slate-100 px-1.5 py-0.5">{service.ceco}</span> : "Sin CECO"} · {service.payment_type || "Puntos"} · {(service.points || []).length} puntos</p>
                      </div>
                    </div>
                    {renderHourlyBox?.(service)}
                    {!!(service.points || []).length && (
                      <details className="mt-3">
                        <summary className="cursor-pointer text-xs font-medium text-slate-500 hover:text-slate-900">Ver puntos</summary>
                        <div className="mt-2 overflow-hidden rounded-xl border border-slate-200">
                          <table className="w-full text-xs">
                            <thead className="bg-slate-50">
                              <tr>
                                <th className="px-2 py-2 text-left font-semibold uppercase tracking-wide text-slate-500">Punto</th>
                                <th className="px-2 py-2 text-left font-semibold uppercase tracking-wide text-slate-500">Código</th>
                                <th className="px-2 py-2 text-left font-semibold uppercase tracking-wide text-slate-500">Estado</th>
                                <th className="px-2 py-2 text-left font-semibold uppercase tracking-wide text-slate-500">Comentario</th>
                                <th className="px-2 py-2 text-right font-semibold uppercase tracking-wide text-slate-500">Pago</th>
                              </tr>
                            </thead>
                            <tbody>
                              {(service.points || []).map(point => (
                                <tr key={point.id} className={`border-t border-slate-100 ${isIncidentActive(point) ? "bg-red-50/70" : ""}`}>
                                  <td className="px-2 py-2"><b>{point.name}</b><br /><span className="text-slate-500">{point.address}</span></td>
                                  <td className="px-2 py-2 font-mono text-slate-700">{point.report_code}</td>
                                  <td className="px-2 py-2"><SelectMini value={pointStatus(point)} onChange={v => updatePoint(point, { point_status: v })} options={pointStatuses} /></td>
                                  <td className="px-2 py-2"><input disabled={!['Incidencia', 'Pospuesto'].includes(pointStatus(point))} value={point.point_comment || point.incident_comment || ""} onChange={e => updatePoint(point, { point_comment: e.target.value, incident_comment: e.target.value })} className="w-full rounded-lg border border-slate-200 px-2 py-1 disabled:bg-slate-100" /></td>
                                  <td className="px-2 py-2 text-right font-mono font-semibold">{eur(pointPay(point))}{isIncidentActive(point) && <p className="text-[10px] font-normal text-slate-500">Original {eur(pointOriginal(point))}</p>}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </details>
                    )}
                  </td>
                  <td className="px-3 py-3">
                    <div className="flex items-center gap-2">
                      <div className="grid h-7 w-7 place-items-center rounded-full bg-slate-100 text-xs font-semibold text-slate-700">{initials(worker?.name || service.worker_name)}</div>
                      <SelectMini value={service.worker_id || ""} onChange={value => {
                        const selected = workers.find(w => w.id === value);
                        updateService(service, { worker_id: value, worker_name: selected?.name || "", status: value ? "Asignado" : "Pendiente asignar" });
                      }} options={["", ...workers.map(w => w.id)]} labels={{ "": "Asignar", ...Object.fromEntries(workers.map(w => [w.id, w.name])) }} />
                    </div>
                  </td>
                  <td className="px-3 py-3 text-slate-700">{service.province || "—"}</td>
                  <td className="px-3 py-3"><div className="space-y-2">{statusBadge(service.status)}<SelectMini value={service.status || ""} onChange={value => updateService(service, { status: value })} options={serviceStatuses} /></div></td>
                  <td className={`px-3 py-3 font-mono text-xs ${overdue ? "text-red-600" : "text-slate-600"}`}>{service.deadline || "—"}</td>
                  <td className="px-3 py-3 text-right font-mono font-semibold text-slate-900">{eur(serviceTotal(service))}</td>
                  <td className="px-3 py-3">
                    <div className="flex justify-end gap-1.5">
                      <button title="Editar" onClick={() => editService(service)} className="rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700"><Edit3 className="h-4 w-4" /></button>
                      <button title="Duplicar" onClick={() => duplicateService(service)} className="rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700"><Copy className="h-4 w-4" /></button>
                      <button title="WhatsApp" onClick={() => {
                        const selectedWorker = workers.find(w => w.id === service.worker_id);
                        const message = buildWhatsApp(service);
                        navigator.clipboard.writeText(message);
                        if (selectedWorker?.phone) window.open(`https://wa.me/${String(selectedWorker.phone).replace(/[^0-9]/g, "")}?text=${encodeURIComponent(message)}`, "_blank");
                        updateService(service, { communication_sent_at: todayISO(), status: "Info enviada" });
                      }} className="rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700"><MessageCircle className="h-4 w-4" /></button>
                      <button title="Borrar" onClick={() => deleteService(service)} className="rounded-lg p-1.5 text-red-500 transition-colors hover:bg-red-50 hover:text-red-700"><Trash2 className="h-4 w-4" /></button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

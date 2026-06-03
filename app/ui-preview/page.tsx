"use client";

import { BarChart3, CalendarDays, CheckCircle2, CreditCard, Package, Users } from "lucide-react";
import { MerchanCard, MerchanKpi, MerchanMini } from "@/components/ui/merchan-card";
import { MerchanInput, MerchanSelect, MerchanSelectMini, MerchanTextarea } from "@/components/ui/merchan-form";
import { MerchanStatusBadge } from "@/components/ui/merchan-status";
import { MerchanShell, MerchanSidebar, MerchanTopbar } from "@/components/ui/merchan-layout";

const sidebarItems = [
  { id: "panel", label: "Panel", icon: BarChart3, badge: 8 },
  { id: "servicios", label: "Servicios", icon: Package, badge: 24 },
  { id: "calendario", label: "Calendario", icon: CalendarDays },
  { id: "trabajadores", label: "Trabajadores", icon: Users },
  { id: "pagos", label: "Pagos", icon: CreditCard }
];

const statuses = ["Pendiente asignar", "Asignado", "Info enviada", "Material pendiente", "Material recibido", "En ejecución", "Reportado", "Validado", "Incidencia", "Pagado"];

export default function UiPreviewPage() {
  return (
    <MerchanShell
      sidebar={<MerchanSidebar items={sidebarItems} activeId="panel" onSelect={() => {}} />}
      topbar={<MerchanTopbar title="UI Preview" breadcrumb="MerchanOps · sistema visual" actions={<button className="btn-primary">Acción principal</button>} />}
    >
      <div className="space-y-5">
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-5">
          <MerchanKpi label="Servicios activos" value="24" icon={Package} colorClass="blue" />
          <MerchanKpi label="Demoras" value="3" icon={CalendarDays} colorClass="red" />
          <MerchanKpi label="Cumplimiento" value="91%" icon={CheckCircle2} colorClass="green" />
          <MerchanKpi label="Total validado" value={<span className="money">1.245,00 €</span>} icon={CreditCard} colorClass="violet" />
          <MerchanKpi label="Trabajadores" value="12" icon={Users} colorClass="amber" />
        </div>

        <div className="grid gap-5 lg:grid-cols-2">
          <MerchanCard accent="#e94560">
            <h2 className="mb-4 text-lg font-semibold text-slate-900">Formulario</h2>
            <div className="grid gap-3 md:grid-cols-2">
              <MerchanInput label="Campaña" value="ISDIN Semana 1 Junio" onChange={() => {}} />
              <MerchanSelect label="Estado" value="Asignado" onChange={() => {}} options={statuses} />
              <MerchanTextarea label="Notas" value="Briefing y observaciones del servicio." onChange={() => {}} />
              <label className="block">
                <span className="mb-1 block text-xs font-medium tracking-wide text-slate-600">Estado compacto</span>
                <MerchanSelectMini value="Validado" onChange={() => {}} options={statuses} />
              </label>
            </div>
          </MerchanCard>

          <MerchanCard>
            <h2 className="mb-4 text-lg font-semibold text-slate-900">Estados</h2>
            <div className="flex flex-wrap gap-2">
              {statuses.map(status => <MerchanStatusBadge key={status} status={status} />)}
            </div>
            <div className="mt-5 grid grid-cols-2 gap-2">
              <MerchanMini label="Activos" value="8" />
              <MerchanMini label="Importe mes" value="845,50 €" mono />
              <MerchanMini label="A tiempo" value="92%" />
              <MerchanMini label="Incidencias" value="2" />
            </div>
          </MerchanCard>
        </div>

        <MerchanCard>
          <h2 className="mb-4 text-lg font-semibold text-slate-900">Tabla ejemplo</h2>
          <div className="overflow-auto">
            <table className="w-full border-collapse text-sm">
              <thead className="bg-slate-50">
                <tr>
                  <th className="table-head-cell">Servicio</th>
                  <th className="table-head-cell">Trabajador</th>
                  <th className="table-head-cell">Estado</th>
                  <th className="table-head-cell text-right">Total</th>
                </tr>
              </thead>
              <tbody>
                {[
                  ["ISDIN · Semana 1 Junio", "Sara", "Asignado", "125,00 €"],
                  ["ISDIN · Semana 15 Junio", "María", "Validado", "245,00 €"],
                  ["ISDIN · Incidencia Asturias", "Nico", "Incidencia", "8,56 €"]
                ].map(row => (
                  <tr key={row[0]} className="border-b border-slate-100 transition-colors hover:bg-slate-50/80 last:border-0">
                    <td className="table-cell font-medium text-slate-900">{row[0]}</td>
                    <td className="table-cell">{row[1]}</td>
                    <td className="table-cell"><MerchanStatusBadge status={row[2]} /></td>
                    <td className="table-cell text-right"><span className="money">{row[3]}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </MerchanCard>
      </div>
    </MerchanShell>
  );
}

"use client";

import { AlertTriangle, CalendarClock, CheckCircle2, ClipboardList, Clock3, CreditCard } from "lucide-react";
import { Campana, CampanaKpis, diasRestantesLabel, eurCompact } from "@/lib/campanas";

function pct(numerator: number, denominator: number) {
  return denominator ? Math.round((numerator / denominator) * 100) : 0;
}

export function CampanaDetalleKpis({ campana, kpis }: { campana: Campana; kpis: CampanaKpis | null }) {
  const total = Number(kpis?.total_puntos || 0);
  const completados = Number(kpis?.completados || 0);
  const pendientes = Number(kpis?.pendientes || 0);
  const incidencias = Number(kpis?.incidencias_abiertas || 0);
  const coste = Number(kpis?.coste_ejecutado || 0);
  const presupuesto = Number(campana.presupuesto || kpis?.importe_total || 0);
  const porcentaje = pct(completados, total);
  const dias = diasRestantesLabel(campana.fecha_fin, kpis?.dias_restantes ?? null);

  return (
    <div className="grid gap-3 md:grid-cols-3 lg:grid-cols-6">
      <div className="gc-kpi">
        <p className="gc-kpi-label"><ClipboardList className="gc-kpi-icon h-4 w-4" />Puntos totales</p>
        <p className="gc-kpi-value">{total.toLocaleString("es-ES")}</p>
      </div>
      <div className="gc-kpi">
        <p className="gc-kpi-label"><CheckCircle2 className="gc-kpi-icon h-4 w-4" />Completados</p>
        <p className="gc-kpi-value">{porcentaje}%</p>
        <p className="gc-kpi-sub">{completados.toLocaleString("es-ES")} / {total.toLocaleString("es-ES")}</p>
        <div className="gc-progress"><div style={{ width: `${Math.min(100, porcentaje)}%` }} /></div>
      </div>
      <div className="gc-kpi">
        <p className="gc-kpi-label"><Clock3 className="gc-kpi-icon h-4 w-4" />Pendientes</p>
        <p className="gc-kpi-value">{pendientes.toLocaleString("es-ES")}</p>
      </div>
      <div className="gc-kpi">
        <p className="gc-kpi-label"><AlertTriangle className="gc-kpi-icon h-4 w-4" />Incidencias abiertas</p>
        <p className={`gc-kpi-value ${incidencias > 0 ? "gc-red" : ""}`}>{incidencias}</p>
      </div>
      <div className="gc-kpi">
        <p className="gc-kpi-label"><CreditCard className="gc-kpi-icon h-4 w-4" />Coste vs previsto</p>
        <p className="gc-kpi-value">{eurCompact(coste)}</p>
        <p className="gc-kpi-sub">de {eurCompact(presupuesto)} presupuestado</p>
      </div>
      <div className="gc-kpi">
        <p className="gc-kpi-label"><CalendarClock className="gc-kpi-icon h-4 w-4" />Días restantes</p>
        <p className="gc-kpi-value">{dias}</p>
      </div>
    </div>
  );
}

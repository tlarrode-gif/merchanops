"use client";

import { AlertTriangle, CheckCircle2, ClipboardList, CreditCard, Users } from "lucide-react";
import { CampanaListadoRow, eurCompact } from "@/lib/campanas";

export function CampanaKpiCards({ rows, showFinancials = true }: { rows: CampanaListadoRow[]; showFinancials?: boolean }) {
  const activas = rows.filter(row => row.estado === "activa").length;
  const puntos = rows.reduce((sum, row) => sum + Number(row.total_puntos || 0), 0);
  const asignados = rows.reduce((sum, row) => sum + Number(row.asignados || 0), 0);
  const pendientes = rows.reduce((sum, row) => sum + Number(row.pendientes || 0), 0);
  const incidencias = rows.reduce((sum, row) => sum + Number(row.incidencias_abiertas || 0), 0);
  const previsto = rows.reduce((sum, row) => sum + Number(row.presupuesto || row.importe_total || 0), 0);
  const cards = [
    { label: "Campañas activas", value: String(activas), icon: ClipboardList },
    { label: "Puntos totales", value: puntos.toLocaleString("es-ES"), icon: CheckCircle2 },
    { label: "Asignados", value: asignados.toLocaleString("es-ES"), icon: Users },
    { label: "Incidencias", value: String(incidencias), icon: AlertTriangle, red: incidencias > 0 },
    // El presupuesto/total previsto es información financiera: solo administración.
    showFinancials
      ? { label: "Total previsto", value: eurCompact(previsto), icon: CreditCard }
      : { label: "Pendientes", value: pendientes.toLocaleString("es-ES"), icon: CreditCard }
  ];
  return (
    <div className="grid gap-3 md:grid-cols-3 lg:grid-cols-5">
      {cards.map(card => (
        <div key={card.label} className="gc-kpi">
          <p className="gc-kpi-label"><card.icon className="gc-kpi-icon h-4 w-4" />{card.label}</p>
          <p className={`gc-kpi-value ${card.red ? "gc-red" : ""}`}>{card.value}</p>
        </div>
      ))}
    </div>
  );
}

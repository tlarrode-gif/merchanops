"use client";

import { CampanaEstado, IncidenciaEstado, PuntoEstado, campanaEstadoLabels, incidenciaEstadoLabels, puntoEstadoLabels } from "@/lib/campanas";

export function CampanaBadgeEstado({ estado }: { estado: CampanaEstado }) {
  return <span className={`gc-badge gc-badge-${estado}`}>{campanaEstadoLabels[estado] || estado}</span>;
}

export function PuntoBadgeEstado({ estado }: { estado: PuntoEstado }) {
  return <span className={`gc-badge gc-badge-${estado}`}>{puntoEstadoLabels[estado] || estado}</span>;
}

export function IncidenciaBadgeEstado({ estado }: { estado: IncidenciaEstado }) {
  return <span className={`gc-badge gc-badge-${estado}`}>{incidenciaEstadoLabels[estado] || estado}</span>;
}

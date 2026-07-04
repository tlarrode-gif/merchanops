"use client";

import { Search, SlidersHorizontal } from "lucide-react";
import { CampanaEstado, campanaEstadoLabels, campanaEstados } from "@/lib/campanas";

export type CampanaFiltrosState = {
  q: string;
  estado: string;
  provincia: string;
  gestor: string;
  desde: string;
  hasta: string;
};

export const emptyCampanaFiltros: CampanaFiltrosState = { q: "", estado: "", provincia: "", gestor: "", desde: "", hasta: "" };

export function CampanaFiltros({
  filtros,
  onChange,
  provincias,
  gestores,
  isAdmin
}: {
  filtros: CampanaFiltrosState;
  onChange: (next: CampanaFiltrosState) => void;
  provincias: string[];
  gestores: string[];
  isAdmin: boolean;
}) {
  const patch = (partial: Partial<CampanaFiltrosState>) => onChange({ ...filtros, ...partial });
  return (
    <div className="gc-card">
      <div className="flex flex-wrap items-end gap-3">
        <label className="min-w-[220px] flex-1">
          <span className="gc-label">Buscar</span>
          <span className="gc-search block">
            <Search className="h-4 w-4" />
            <input className="gc-input" placeholder="Buscar por nombre o cliente..." value={filtros.q} onChange={event => patch({ q: event.target.value })} />
          </span>
        </label>
        <label className="w-40">
          <span className="gc-label">Estado</span>
          <select className="gc-select" value={filtros.estado} onChange={event => patch({ estado: event.target.value })}>
            <option value="">Todos</option>
            {campanaEstados.map(estado => <option key={estado} value={estado}>{campanaEstadoLabels[estado as CampanaEstado]}</option>)}
          </select>
        </label>
        <label className="w-44">
          <span className="gc-label">Provincia</span>
          <select className="gc-select" value={filtros.provincia} onChange={event => patch({ provincia: event.target.value })}>
            <option value="">{isAdmin ? "Todas" : "Mis provincias"}</option>
            {provincias.map(provincia => <option key={provincia} value={provincia}>{provincia}</option>)}
          </select>
        </label>
        <label className="w-44">
          <span className="gc-label">Gestor</span>
          <select className="gc-select" value={filtros.gestor} onChange={event => patch({ gestor: event.target.value })}>
            <option value="">Todos</option>
            {gestores.map(gestor => <option key={gestor} value={gestor}>{gestor}</option>)}
          </select>
        </label>
        <label className="w-40">
          <span className="gc-label">Fecha inicio</span>
          <input type="date" className="gc-input" value={filtros.desde} onChange={event => patch({ desde: event.target.value })} />
        </label>
        <label className="w-40">
          <span className="gc-label">Fecha fin</span>
          <input type="date" className="gc-input" value={filtros.hasta} onChange={event => patch({ hasta: event.target.value })} />
        </label>
        <button className="gc-btn-outline" onClick={() => onChange(emptyCampanaFiltros)}>
          <SlidersHorizontal className="h-4 w-4" />
          Limpiar filtros
        </button>
      </div>
    </div>
  );
}

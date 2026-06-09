"use client";

import { useState } from "react";
import { X } from "lucide-react";
import { IncidentType, today } from "@/lib/logistics";

const incidentTypes: IncidentType[] = [
  "material_no_recibido",
  "medidas_incorrectas",
  "material_danado",
  "vin_equivocado",
  "instalacion_no_realizada",
  "farmacia_cerrada",
  "escaparate_cambiado",
  "material_sobrante",
  "entrega_fallida"
];

export type CrearIncidenciaContext = {
  vin_id?: string | null;
  servicio_id?: string | null;
  campana_id?: string | null;
  farmacia_id?: string | null;
  material_id?: string | null;
};

export function CrearIncidenciaModal({
  open,
  context,
  onClose,
  onCreate
}: {
  open: boolean;
  context: CrearIncidenciaContext;
  onClose: () => void;
  onCreate: (incident: CrearIncidenciaContext & { tipo: IncidentType; descripcion: string; impacto?: string; fecha_limite?: string }) => Promise<void> | void;
}) {
  const [tipo, setTipo] = useState<IncidentType>("material_no_recibido");
  const [descripcion, setDescripcion] = useState("");
  const [impacto, setImpacto] = useState("");
  const [fechaLimite, setFechaLimite] = useState(today());

  if (!open) return null;

  async function submit() {
    if (!descripcion.trim()) return;
    await onCreate({ ...context, tipo, descripcion, impacto, fecha_limite: fechaLimite });
    setDescripcion("");
    setImpacto("");
    onClose();
  }

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-2xl rounded-3xl bg-white p-5 shadow-2xl">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <p className="text-sm text-slate-500">Incidencia cross-módulo</p>
            <h2 className="text-xl font-bold">Crear incidencia</h2>
          </div>
          <button onClick={onClose} className="rounded-xl border p-2" aria-label="Cerrar incidencia">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          <label className="block">
            <span className="text-sm font-medium">Tipo</span>
            <select value={tipo} onChange={event => setTipo(event.target.value as IncidentType)} className="w-full rounded-2xl border bg-white px-3 py-2">
              {incidentTypes.map(type => <option key={type} value={type}>{type}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="text-sm font-medium">Fecha límite</span>
            <input type="date" value={fechaLimite} onChange={event => setFechaLimite(event.target.value)} className="w-full rounded-2xl border px-3 py-2" />
          </label>
        </div>
        <label className="mt-3 block">
          <span className="text-sm font-medium">Descripción</span>
          <textarea value={descripcion} onChange={event => setDescripcion(event.target.value)} rows={4} className="w-full rounded-2xl border p-3" />
        </label>
        <label className="mt-3 block">
          <span className="text-sm font-medium">Impacto operativo/logístico</span>
          <input value={impacto} onChange={event => setImpacto(event.target.value)} className="w-full rounded-2xl border px-3 py-2" />
        </label>
        <div className="mt-4 rounded-2xl bg-slate-50 p-3 text-xs text-slate-600">
          Contexto: {Object.entries(context).filter(([, value]) => value).map(([key, value]) => `${key}: ${value}`).join(" · ") || "sin contexto"}
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <button onClick={onClose} className="rounded-2xl border bg-white px-4 py-2 text-sm font-semibold">Cancelar</button>
          <button onClick={submit} disabled={!descripcion.trim()} className="rounded-2xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40">Crear incidencia</button>
        </div>
      </div>
    </div>
  );
}

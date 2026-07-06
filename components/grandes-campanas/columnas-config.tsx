"use client";

import { ArrowDown, ArrowUp } from "lucide-react";
import {
  CAMPO_IGNORAR,
  CampanaColumna,
  ColumnaTipo,
  camposInternos,
  columnaTipoLabels,
  columnaTipos
} from "@/lib/campana-columnas";

// Editor del esquema de columnas de una campaña. Se usa en la importación
// (configurar el archivo antes de crear) y en la edición de campaña
// (ajustar nombres visibles, visibilidad por rol, etc. a posteriori).
export function ColumnasConfig({
  columnas,
  onChange,
  disabled
}: {
  columnas: CampanaColumna[];
  onChange: (columnas: CampanaColumna[]) => void;
  disabled?: boolean;
}) {
  function patch(index: number, partial: Partial<CampanaColumna>) {
    onChange(columnas.map((col, i) => i === index ? { ...col, ...partial } : col));
  }

  function mover(index: number, delta: -1 | 1) {
    const destino = index + delta;
    if (destino < 0 || destino >= columnas.length) return;
    const next = [...columnas];
    [next[index], next[destino]] = [next[destino], next[index]];
    onChange(next.map((col, i) => ({ ...col, orden: i })));
  }

  if (!columnas.length) {
    return <p className="gc-note">Esta campaña no tiene esquema de columnas. Se creará automáticamente al importar un archivo.</p>;
  }

  return (
    <div className="gc-table-wrap">
      <table className="gc-table">
        <thead>
          <tr>
            <th style={{ width: 70 }}>Orden</th>
            <th>Columna del archivo</th>
            <th>Nombre visible</th>
            <th>Se guarda como</th>
            <th>Tipo</th>
            <th style={{ textAlign: "center" }}>Visible gestor</th>
            <th style={{ textAlign: "center" }}>Obligatoria</th>
            <th>Valor por defecto</th>
          </tr>
        </thead>
        <tbody>
          {columnas.map((col, index) => {
            const ignorada = col.campo_interno === CAMPO_IGNORAR;
            const esExtra = !col.campo_interno;
            return (
              <tr key={col.nombre_original} style={ignorada ? { opacity: 0.45 } : undefined}>
                <td>
                  <span className="inline-flex gap-1">
                    <button type="button" title="Subir" className="rounded border p-1 hover:bg-slate-50" style={{ borderColor: "var(--gc-border)" }} disabled={disabled || index === 0} onClick={() => mover(index, -1)}><ArrowUp className="h-3.5 w-3.5" /></button>
                    <button type="button" title="Bajar" className="rounded border p-1 hover:bg-slate-50" style={{ borderColor: "var(--gc-border)" }} disabled={disabled || index === columnas.length - 1} onClick={() => mover(index, 1)}><ArrowDown className="h-3.5 w-3.5" /></button>
                  </span>
                </td>
                <td className="font-mono text-xs">{col.nombre_original}</td>
                <td>
                  <input className="gc-input" style={{ minWidth: 140 }} value={col.nombre_visible} disabled={disabled || ignorada} onChange={event => patch(index, { nombre_visible: event.target.value })} />
                </td>
                <td>
                  <select
                    className="gc-select"
                    style={{ minWidth: 160 }}
                    value={col.campo_interno ?? ""}
                    disabled={disabled}
                    onChange={event => {
                      const value = event.target.value;
                      patch(index, { campo_interno: value === "" ? null : value });
                    }}
                  >
                    <option value="">Dato extra de la campaña</option>
                    {camposInternos.map(campo => <option key={campo.value} value={campo.value}>Campo interno: {campo.label}</option>)}
                    <option value={CAMPO_IGNORAR}>No importar (ignorar)</option>
                  </select>
                </td>
                <td>
                  <select className="gc-select" style={{ minWidth: 100 }} value={col.tipo} disabled={disabled || !esExtra} onChange={event => patch(index, { tipo: event.target.value as ColumnaTipo })}>
                    {columnaTipos.map(tipo => <option key={tipo} value={tipo}>{columnaTipoLabels[tipo]}</option>)}
                  </select>
                </td>
                <td style={{ textAlign: "center" }}>
                  <input type="checkbox" checked={col.visible_gestor} disabled={disabled || ignorada} onChange={event => patch(index, { visible_gestor: event.target.checked })} />
                </td>
                <td style={{ textAlign: "center" }}>
                  <input type="checkbox" checked={col.obligatoria} disabled={disabled || ignorada} onChange={event => patch(index, { obligatoria: event.target.checked })} />
                </td>
                <td>
                  <input className="gc-input" style={{ minWidth: 110 }} placeholder="—" value={col.valor_defecto ?? ""} disabled={disabled || ignorada} onChange={event => patch(index, { valor_defecto: event.target.value || null })} />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="p-3 text-xs" style={{ color: "var(--gc-muted)" }}>
        Las columnas mapeadas a un <b>campo interno</b> rellenan la ficha del punto (código, provincia, importe...).
        Los <b>datos extra</b> se guardan tal cual y se muestran en el detalle del punto; si desmarcas «Visible gestor», solo administración los verá.
      </p>
    </div>
  );
}

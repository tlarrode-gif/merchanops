"use client";

import { ArrowDown, ArrowUp, Lock } from "lucide-react";
import {
  CAMPO_IGNORAR,
  CampanaColumna,
  ColumnaTipo,
  campoFijoDe,
  camposInternos,
  camposInternosDuplicados,
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

  // Dos columnas del archivo mapeadas al mismo campo interno: la última pisa a la anterior
  // sin avisar. Pasaba de verdad (CLIENTE y Nombre las dos a «Nombre comercial»).
  const duplicados = camposInternosDuplicados(columnas);

  return (
    <div className="gc-table-wrap">
      {duplicados.length > 0 && (
        <div className="gc-note m-3">
          <b>Hay campos mapeados dos veces.</b> Solo se guardará el valor de la última columna, las demás se perderán:
          <ul className="mt-1 list-inside list-disc">
            {duplicados.map(dup => (
              <li key={dup.campo}>{dup.label}: {dup.columnas.join(" y ")}</li>
            ))}
          </ul>
        </div>
      )}
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
            // Columnas fijas de campaña (Instalador, Dirección de envío, Picking): existen
            // siempre y no se pueden remapear ni descartar, porque las rellenan el gestor y
            // Almacén. Sí se puede cambiar su nombre visible y su orden.
            const fija = campoFijoDe(col.campo_interno);
            return (
              <tr key={col.nombre_original} style={ignorada ? { opacity: 0.45 } : undefined}>
                <td>
                  <span className="inline-flex gap-1">
                    <button type="button" title="Subir" className="rounded border p-1 hover:bg-slate-50" style={{ borderColor: "var(--gc-border)" }} disabled={disabled || index === 0} onClick={() => mover(index, -1)}><ArrowUp className="h-3.5 w-3.5" /></button>
                    <button type="button" title="Bajar" className="rounded border p-1 hover:bg-slate-50" style={{ borderColor: "var(--gc-border)" }} disabled={disabled || index === columnas.length - 1} onClick={() => mover(index, 1)}><ArrowDown className="h-3.5 w-3.5" /></button>
                  </span>
                </td>
                <td className="font-mono text-xs">
                  {col.nombre_original}
                  {fija && <span className="ml-1 inline-flex items-center gap-1 align-middle text-[10px] font-semibold uppercase" style={{ color: "var(--gc-secondary)" }}><Lock className="h-3 w-3" />fija</span>}
                </td>
                <td>
                  <input className="gc-input" style={{ minWidth: 140 }} value={col.nombre_visible} disabled={disabled || ignorada} onChange={event => patch(index, { nombre_visible: event.target.value })} />
                </td>
                <td>
                  {fija ? (
                    <span className="block text-xs">
                      <b>{fija.label}</b>
                      <span className="block" style={{ color: "var(--gc-muted)" }}>{fija.ayuda}</span>
                    </span>
                  ) : (
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
                  )}
                </td>
                <td>
                  <select className="gc-select" style={{ minWidth: 100 }} value={col.tipo} disabled={disabled || !esExtra} onChange={event => patch(index, { tipo: event.target.value as ColumnaTipo })}>
                    {columnaTipos.map(tipo => <option key={tipo} value={tipo}>{columnaTipoLabels[tipo]}</option>)}
                  </select>
                </td>
                <td style={{ textAlign: "center" }}>
                  <input type="checkbox" checked={col.visible_gestor} disabled={disabled || ignorada || Boolean(fija)} title={fija ? "Las columnas fijas siempre son visibles para el gestor" : undefined} onChange={event => patch(index, { visible_gestor: event.target.checked })} />
                </td>
                <td style={{ textAlign: "center" }}>
                  <input type="checkbox" checked={col.obligatoria} disabled={disabled || ignorada || Boolean(fija)} onChange={event => patch(index, { obligatoria: event.target.checked })} />
                </td>
                <td>
                  {fija
                    ? <span className="text-xs" style={{ color: "var(--gc-muted)" }}>—</span>
                    : <input className="gc-input" style={{ minWidth: 110 }} placeholder="—" value={col.valor_defecto ?? ""} disabled={disabled || ignorada} onChange={event => patch(index, { valor_defecto: event.target.value || null })} />}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="p-3 text-xs" style={{ color: "var(--gc-muted)" }}>
        Las columnas mapeadas a un <b>campo interno</b> rellenan la ficha del punto (código, provincia, importe...).
        Los <b>datos extra</b> se guardan tal cual y se muestran en el detalle del punto; si desmarcas «Visible gestor», solo administración los verá.
        Las columnas marcadas como <b>fijas</b> (Instalador, Dirección de envío y Picking) existen en toda campaña aunque no vengan en el Excel:
        las dos primeras las rellena el gestor de zona y la de Picking la devuelve Almacén al cerrar el picking, así que su valor no se importa del archivo.
      </p>
    </div>
  );
}

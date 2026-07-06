"use client";

import { useMemo, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, Download, FileUp, Loader2, Settings2, XCircle } from "lucide-react";
import { ColumnasConfig } from "@/components/grandes-campanas/columnas-config";
import { CampanaColumna, columnasDesdeImportacion } from "@/lib/campana-columnas";
import { PuntoInput } from "@/lib/campanas";
import { ParseResult, ParsedRow, buildTemplateCsv, parseImportFile, summarizeParse } from "@/lib/csv-parser";

export type ImportProgress = { done: number; total: number } | null;

export type ImportadorEstado = {
  fileName: string;
  rows: ParsedRow[];
  omitErrors: boolean;
  readyRows: PuntoInput[];
  blockingErrors: number;
  // Esquema de columnas configurado por el usuario; se persiste con la campaña.
  columnas: CampanaColumna[];
};

export function ImportadorCSV({
  progress,
  disabled,
  onChange
}: {
  progress: ImportProgress;
  disabled?: boolean;
  onChange: (estado: ImportadorEstado | null) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [fileName, setFileName] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<ParseResult | null>(null);
  const [omitErrors, setOmitErrors] = useState(false);
  const [showAllErrors, setShowAllErrors] = useState(false);
  const [columnas, setColumnas] = useState<CampanaColumna[]>([]);
  const [configAbierta, setConfigAbierta] = useState(false);
  const [columnasPendientes, setColumnasPendientes] = useState(false);

  const summary = useMemo(() => result ? summarizeParse(result.rows) : null, [result]);

  function emit(nextResult: ParseResult | null, nextOmit: boolean, name: string, nextColumnas: CampanaColumna[]) {
    if (!nextResult || nextResult.fileError) { onChange(null); return; }
    const usable = nextResult.rows.filter(row => nextOmit ? !row.errors.length : true);
    onChange({
      fileName: name,
      rows: nextResult.rows,
      omitErrors: nextOmit,
      readyRows: usable.filter(row => !row.errors.length).map(row => row.data),
      blockingErrors: nextOmit ? 0 : nextResult.rows.filter(row => row.errors.length).length,
      columnas: nextColumnas
    });
  }

  async function handleFile(nextFile: File | undefined | null) {
    if (!nextFile || disabled) return;
    setAnalyzing(true);
    setResult(null);
    setFile(nextFile);
    setFileName(nextFile.name);
    setShowAllErrors(false);
    setConfigAbierta(false);
    setColumnasPendientes(false);
    onChange(null);
    try {
      const parsed = await parseImportFile(nextFile);
      const esquema = parsed.fileError ? [] : columnasDesdeImportacion(parsed.headers, parsed.mapping);
      setResult(parsed);
      setColumnas(esquema);
      emit(parsed, omitErrors, nextFile.name, esquema);
    } catch (error) {
      setResult({ rows: [], headers: [], mapping: [], unmappedColumns: [], fileError: error instanceof Error ? error.message : "No se pudo leer el archivo." });
      onChange(null);
    } finally {
      setAnalyzing(false);
    }
  }

  // Reanaliza el archivo aplicando el esquema editado (mapeos, obligatorias, defectos, tipos).
  async function aplicarColumnas() {
    if (!file) return;
    setAnalyzing(true);
    try {
      const parsed = await parseImportFile(file, columnas);
      setResult(parsed);
      setColumnasPendientes(false);
      emit(parsed, omitErrors, fileName, columnas);
    } finally {
      setAnalyzing(false);
    }
  }

  function cambiarColumnas(next: CampanaColumna[]) {
    setColumnas(next);
    setColumnasPendientes(true);
  }

  function toggleOmit(next: boolean) {
    setOmitErrors(next);
    emit(result, next, fileName, columnas);
  }

  function downloadTemplate() {
    const blob = new Blob([buildTemplateCsv()], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "plantilla_puntos_campana.csv";
    link.click();
    URL.revokeObjectURL(url);
  }

  const preview = (result?.rows || []).slice(0, 5);
  const mensajes = summary?.mensajes || [];
  const visibleMensajes = showAllErrors ? mensajes : mensajes.slice(0, 5);

  return (
    <section className="gc-form-section">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h2 className="gc-form-title mb-0" style={{ borderBottom: "none", paddingBottom: 0 }}>Importación de Puntos de Venta</h2>
        <button type="button" onClick={downloadTemplate} className="gc-btn-outline">
          <Download className="h-4 w-4" />
          Descargar plantilla CSV
        </button>
      </div>

      <input
        ref={inputRef}
        type="file"
        accept=".csv,.xls,.xlsx,text/csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        className="hidden"
        onChange={event => { handleFile(event.target.files?.[0]); event.target.value = ""; }}
      />

      <div
        className={`gc-dropzone ${dragOver ? "gc-drag-over" : ""}`}
        onClick={() => !disabled && inputRef.current?.click()}
        onDragOver={event => { event.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={event => { event.preventDefault(); setDragOver(false); handleFile(event.dataTransfer.files?.[0]); }}
      >
        <FileUp className="mx-auto h-8 w-8" style={{ color: "var(--gc-secondary)" }} />
        <p className="mt-3 text-sm font-semibold">Arrastra aquí tus archivos CSV, XLS o XLSX</p>
        <p className="mt-1 text-xs" style={{ color: "var(--gc-muted)" }}>O haz clic para explorar en tu ordenador (Máx. 10MB)</p>
        {fileName && !analyzing && <p className="mt-2 text-xs font-semibold" style={{ color: "var(--gc-primary)" }}>{fileName}</p>}
      </div>

      {analyzing && (
        <div className="mt-4 flex items-center gap-2 text-sm" style={{ color: "var(--gc-muted)" }}>
          <Loader2 className="h-4 w-4 animate-spin" />
          Analizando archivo...
        </div>
      )}

      {result?.fileError && (
        <div className="gc-note mt-4"><b>No se puede importar:</b> {result.fileError}</div>
      )}

      {result && !result.fileError && summary && (
        <div className="mt-4 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
            <p><b>{summary.total.toLocaleString("es-ES")}</b> puntos detectados</p>
            <span className="flex flex-wrap items-center gap-3">
              <button type="button" className="gc-btn-outline" onClick={() => setConfigAbierta(value => !value)}>
                <Settings2 className="h-4 w-4" />
                Configurar columnas ({columnas.length})
              </button>
              <p style={{ color: "var(--gc-muted)" }}>{summary.ok.toLocaleString("es-ES")} listos · {summary.errores} con error · {summary.avisos} con avisos</p>
            </span>
          </div>

          {configAbierta && (
            <div className="space-y-3">
              <ColumnasConfig columnas={columnas} onChange={cambiarColumnas} disabled={disabled || analyzing} />
              {columnasPendientes && (
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-xs" style={{ color: "var(--gc-muted)" }}>Hay cambios en las columnas sin aplicar al archivo.</p>
                  <button type="button" className="gc-btn-dark" disabled={analyzing} onClick={aplicarColumnas}>
                    {analyzing ? "Revalidando..." : "Aplicar y revalidar archivo"}
                  </button>
                </div>
              )}
            </div>
          )}

          {progress && (
            <div>
              <div className="flex justify-between text-xs" style={{ color: "var(--gc-muted)" }}>
                <span>Importando puntos...</span>
                <span>{progress.done.toLocaleString("es-ES")} / {progress.total.toLocaleString("es-ES")}</span>
              </div>
              <div className="gc-progress"><div style={{ width: `${progress.total ? Math.round((progress.done / progress.total) * 100) : 0}%` }} /></div>
            </div>
          )}

          <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
            <div className="gc-table-wrap">
              <table className="gc-table">
                <thead>
                  <tr><th>ID</th><th>Nombre Comercial</th><th>Dirección</th><th>Provincia</th><th>Estado</th></tr>
                </thead>
                <tbody>
                  {preview.map(row => (
                    <tr key={row.index}>
                      <td className="font-mono text-xs">{row.data.codigo || `F${row.index}`}</td>
                      <td className="font-semibold">{row.data.nombre_comercial}</td>
                      <td>{row.data.direccion || <span style={{ color: "var(--gc-secondary)" }}>Sin dirección</span>}</td>
                      <td>{row.data.provincia || "—"}</td>
                      <td>
                        {row.errors.length
                          ? <span className="gc-badge gc-badge-incidencia">Error</span>
                          : row.warnings.length
                            ? <span className="gc-badge gc-badge-pendiente">Aviso</span>
                            : <span className="gc-badge gc-badge-completado">OK</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {result.rows.length > 5 && <p className="p-3 text-xs" style={{ color: "var(--gc-muted)" }}>Mostrando 5 de {result.rows.length.toLocaleString("es-ES")} filas.</p>}
            </div>

            <div className="gc-alert-panel">
              <p className="mb-2 font-bold">Alertas de Datos</p>
              {mensajes.length === 0 && (
                <p className="gc-alert-line gc-alert-ok"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />{summary.ok.toLocaleString("es-ES")} puntos listos para importar sin avisos.</p>
              )}
              {visibleMensajes.map((mensaje, index) => (
                <p key={index} className={`gc-alert-line ${mensaje.tipo === "error" ? "gc-alert-err" : "gc-alert-warn"}`}>
                  {mensaje.tipo === "error" ? <XCircle className="mt-0.5 h-4 w-4 shrink-0" /> : <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />}
                  <span>Fila {mensaje.fila}: {mensaje.texto}</span>
                </p>
              ))}
              {mensajes.length > 0 && (
                <p className="gc-alert-line gc-alert-ok"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />{summary.ok.toLocaleString("es-ES")} puntos listos para importar.</p>
              )}
              {summary.errores > 0 && (
                <label className="mt-3 flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={omitErrors} onChange={event => toggleOmit(event.target.checked)} />
                  Omitir filas con errores
                </label>
              )}
              {mensajes.length > 5 && (
                <button type="button" className="mt-2 text-sm font-semibold underline-offset-2 hover:underline" style={{ color: "var(--gc-secondary)" }} onClick={() => setShowAllErrors(value => !value)}>
                  {showAllErrors ? "Ocultar errores" : `Ver todos los errores (${mensajes.length}) →`}
                </button>
              )}
              {result.unmappedColumns.length > 0 && (
                <p className="mt-3 text-xs" style={{ color: "var(--gc-muted)" }}>
                  Columnas sin mapear (se guardan como datos extra): {result.unmappedColumns.join(", ")}.
                  Puedes cambiar el mapeo, el nombre visible o la visibilidad por rol en «Configurar columnas».
                </p>
              )}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

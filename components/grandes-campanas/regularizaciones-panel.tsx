"use client";

/**
 * Pestaña «Regularizaciones» del detalle de campaña (v11.2).
 *
 * El gestor propone el pago olvidado; administración aprueba o rechaza con
 * motivo. La aprobación crea la línea en Pagos en la misma transacción, así que
 * la pantalla no tiene ningún estado intermedio que enseñar.
 *
 * DECISIONES DE PANTALLA
 *  - Lo pendiente va ARRIBA y separado: es lo único que exige acción.
 *  - Al aprobar, administración TIENE que decir si es refacturable al cliente.
 *    No hay valor por defecto: es la decisión que se pierde si no se toma ahora.
 *  - El aviso de concepto repetido se enseña aunque no lo pida nadie. Si el 40 %
 *    de las regularizaciones son errores de tarifa, el problema no son las
 *    regularizaciones.
 *  - Al gestor se le enseña el motivo del rechazo. Sin eso, «rechazada» es una
 *    puerta cerrada sin explicación.
 */

import { useMemo, useState } from "react";
import { AlertTriangle, Check, Plus, X } from "lucide-react";

import {
  BorradorRegularizacion,
  ConceptoTipo,
  Regularizacion,
  avisoConceptoRepetido,
  centimosAEuros,
  conceptoAyuda,
  conceptoLabels,
  conceptoTipos,
  estadoLabels,
  resumirRegularizaciones,
  validarRegularizacion
} from "@/lib/campana-regularizaciones";
import { PuntoVenta, formatDate } from "@/lib/campanas";

type Props = {
  campanaId: string;
  regularizaciones: Regularizacion[];
  puntos: PuntoVenta[];
  mesesCerrados: string[];
  admin: boolean;
  cargando: boolean;
  saving: boolean;
  onSolicitar: (borrador: BorradorRegularizacion) => Promise<void>;
  onResolver: (fila: Regularizacion, estado: "aprobada" | "rechazada", opciones: { motivo?: string | null; refacturable?: boolean | null }) => Promise<void>;
};

function hoyIso() {
  return new Date().toISOString().slice(0, 10);
}

export function RegularizacionesPanel({ campanaId, regularizaciones, puntos, mesesCerrados, admin, cargando, saving, onSolicitar, onResolver }: Props) {
  const [abierto, setAbierto] = useState(false);
  const [error, setError] = useState("");
  const [form, setForm] = useState({
    puntoId: "",
    conceptoTipo: "desplazamiento_extra" as ConceptoTipo,
    concepto: "",
    importe: "",
    fecha: hoyIso()
  });

  const resumen = useMemo(() => resumirRegularizaciones(regularizaciones), [regularizaciones]);
  const aviso = useMemo(() => avisoConceptoRepetido(resumen), [resumen]);
  const pendientes = regularizaciones.filter(fila => fila.estado === "propuesta");
  const resueltas = regularizaciones.filter(fila => fila.estado !== "propuesta");

  function borradorActual(): BorradorRegularizacion {
    const punto = puntos.find(item => item.id === form.puntoId);
    return {
      campanaId,
      puntoId: form.puntoId || null,
      conceptoTipo: form.conceptoTipo,
      concepto: form.concepto,
      importe: form.importe,
      fecha: form.fecha,
      trabajadorId: punto?.instalador_id || null,
      trabajadorNombre: punto?.instalador_nombre || null
    };
  }

  async function enviar() {
    const borrador = borradorActual();
    const motivo = validarRegularizacion(borrador, mesesCerrados);
    if (motivo) { setError(motivo); return; }
    setError("");
    await onSolicitar(borrador);
    setForm({ puntoId: "", conceptoTipo: "desplazamiento_extra", concepto: "", importe: "", fecha: hoyIso() });
    setAbierto(false);
  }

  async function aprobar(fila: Regularizacion) {
    const respuesta = window.prompt(
      `Aprobar «${fila.concepto}» (${centimosAEuros(fila.importe_cents)}).\n\n` +
      "¿Se le refactura al cliente? Escribe SÍ o NO.\n" +
      "Esta respuesta es la que permitirá facturarlo después; no se puede dejar en blanco.",
      "SÍ"
    );
    if (respuesta === null) return;
    const limpio = respuesta.trim().toLowerCase();
    const si = ["si", "sí", "s", "yes"].includes(limpio);
    const no = ["no", "n"].includes(limpio);
    if (!si && !no) { setError("Responde SÍ o NO: sin esa respuesta la regularización no se puede facturar después."); return; }
    setError("");
    await onResolver(fila, "aprobada", { refacturable: si });
  }

  async function rechazar(fila: Regularizacion) {
    const motivo = window.prompt(`Motivo del rechazo de «${fila.concepto}» (obligatorio, lo verá quien la propuso):`);
    if (motivo === null) return;
    if (!motivo.trim()) { setError("Rechazar exige motivo."); return; }
    setError("");
    await onResolver(fila, "rechazada", { motivo: motivo.trim() });
  }

  function Fila({ fila }: { fila: Regularizacion }) {
    return (
      <tr>
        <td>
          <p className="font-semibold">{conceptoLabels[fila.concepto_tipo] || fila.concepto_tipo}</p>
          <p className="text-xs" style={{ color: "var(--gc-muted)" }}>{fila.concepto}</p>
          {fila.motivo_resolucion && (
            <p className="mt-1 text-xs gc-alert-err">Motivo: {fila.motivo_resolucion}</p>
          )}
        </td>
        <td>{fila.punto_nombre || <span style={{ color: "var(--gc-muted)" }}>Toda la campaña</span>}</td>
        <td>{fila.trabajador_nombre || <span style={{ color: "var(--gc-muted)" }}>Sin trabajador</span>}</td>
        <td>{formatDate(fila.fecha)}</td>
        <td className="text-right font-semibold">{centimosAEuros(fila.importe_cents)}</td>
        <td>
          <span className={`gc-badge gc-badge-${fila.estado === "aprobada" ? "completado" : fila.estado === "rechazada" ? "cancelado" : "pendiente"}`}>
            {estadoLabels[fila.estado]}
          </span>
          {fila.estado === "aprobada" && (
            <p className="mt-1 text-xs" style={{ color: "var(--gc-muted)" }}>
              {fila.refacturable ? "Se refactura al cliente" : "Lo asume la empresa"}
            </p>
          )}
        </td>
        <td className="text-xs" style={{ color: "var(--gc-muted)" }}>
          {fila.solicitada_por_nombre || "—"}
          {fila.resuelta_por_nombre && <><br />resuelta por {fila.resuelta_por_nombre}</>}
        </td>
        {admin && (
          <td className="gc-no-print">
            {fila.estado === "propuesta" ? (
              <div className="flex gap-1">
                <button className="gc-btn-outline" disabled={saving} onClick={() => aprobar(fila)} title="Crea la línea en Pagos">
                  <Check className="h-4 w-4" /> Aprobar
                </button>
                <button className="gc-btn-outline gc-btn-danger" disabled={saving} onClick={() => rechazar(fila)}>
                  <X className="h-4 w-4" />
                </button>
              </div>
            ) : (
              <span style={{ color: "var(--gc-muted)" }}>—</span>
            )}
          </td>
        )}
      </tr>
    );
  }

  if (cargando) return <div className="space-y-2"><div className="gc-skeleton h-24" /><div className="gc-skeleton h-40" /></div>;

  return (
    <div className="space-y-3">
      <div className="grid gap-3 md:grid-cols-4">
        <div className="gc-kpi">
          <p className="gc-kpi-label">Pendientes de aprobar</p>
          <p className={`gc-kpi-value ${resumen.pendientes ? "gc-red" : ""}`}>{resumen.pendientes}</p>
          <p className="gc-kpi-sub">{centimosAEuros(resumen.importePendiente)}</p>
        </div>
        <div className="gc-kpi">
          <p className="gc-kpi-label">Aprobado</p>
          <p className="gc-kpi-value">{centimosAEuros(resumen.importeAprobado)}</p>
          <p className="gc-kpi-sub">{resumen.aprobadas} regularización(es)</p>
        </div>
        <div className="gc-kpi">
          <p className="gc-kpi-label">Refacturable al cliente</p>
          <p className="gc-kpi-value">{centimosAEuros(resumen.refacturable)}</p>
        </div>
        <div className="gc-kpi">
          <p className="gc-kpi-label">Lo asume la empresa</p>
          <p className="gc-kpi-value">{centimosAEuros(resumen.asumido)}</p>
        </div>
      </div>

      {aviso && (
        <div className="gc-note gc-alert-warn flex items-start gap-2">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{aviso}</span>
        </div>
      )}

      {error && <div className="gc-note gc-alert-err">{error}</div>}

      <div className="gc-no-print">
        {abierto ? (
          <div className="gc-form-section">
            <p className="gc-form-title">Registrar una regularización</p>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              <label>
                <span className="gc-label">¿De qué punto?</span>
                <select className="gc-select" value={form.puntoId} onChange={e => setForm({ ...form, puntoId: e.target.value })}>
                  <option value="">De toda la campaña (sin punto)</option>
                  {puntos.map(punto => (
                    <option key={punto.id} value={punto.id}>
                      {punto.nombre_comercial}{punto.instalador_nombre ? ` — ${punto.instalador_nombre}` : ""}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span className="gc-label">Concepto <span className="gc-req">*</span></span>
                <select className="gc-select" value={form.conceptoTipo} onChange={e => setForm({ ...form, conceptoTipo: e.target.value as ConceptoTipo })}>
                  {conceptoTipos.map(tipo => <option key={tipo} value={tipo}>{conceptoLabels[tipo]}</option>)}
                </select>
              </label>
              <label>
                <span className="gc-label">Importe (€) <span className="gc-req">*</span></span>
                <input className="gc-input" inputMode="decimal" placeholder="25,00" value={form.importe} onChange={e => setForm({ ...form, importe: e.target.value })} />
              </label>
              <label>
                <span className="gc-label">Fecha <span className="gc-req">*</span></span>
                <input type="date" className="gc-input" value={form.fecha} onChange={e => setForm({ ...form, fecha: e.target.value })} />
              </label>
              <label className="sm:col-span-2">
                <span className="gc-label">Explicación <span className="gc-req">*</span></span>
                <input
                  className="gc-input"
                  placeholder="Qué pasó exactamente: lo leerá administración para facturarlo"
                  value={form.concepto}
                  onChange={e => setForm({ ...form, concepto: e.target.value })}
                />
              </label>
            </div>
            <p className="mt-2 text-xs" style={{ color: "var(--gc-muted)" }}>{conceptoAyuda[form.conceptoTipo]}</p>
            <p className="mt-1 text-xs" style={{ color: "var(--gc-muted)" }}>
              Un importe negativo descuenta. Se registra como <b>propuesta</b>: no se paga nada hasta que administración la apruebe.
            </p>
            <div className="mt-3 flex gap-2">
              <button className="gc-btn-dark" disabled={saving} onClick={() => enviar()}>Enviar propuesta</button>
              <button className="gc-btn-outline" disabled={saving} onClick={() => { setAbierto(false); setError(""); }}>Cancelar</button>
            </div>
          </div>
        ) : (
          <button className="gc-btn-dark" onClick={() => setAbierto(true)}>
            <Plus className="h-4 w-4" /> Registrar regularización
          </button>
        )}
      </div>

      {!regularizaciones.length ? (
        <div className="gc-empty">
          <b>Sin regularizaciones.</b> Aquí se registran los pagos que se quedan fuera del circuito normal:
          el desplazamiento extra, la hora de más, el material repuesto o una revisita. El gestor los propone
          y administración los aprueba diciendo si se refacturan al cliente.
        </div>
      ) : (
        <div className="space-y-4">
          {pendientes.length > 0 && (
            <div>
              <p className="mb-2 text-xs font-bold uppercase" style={{ color: "var(--gc-secondary)" }}>
                Pendientes de aprobar ({pendientes.length})
              </p>
              <Tabla filas={pendientes} admin={admin} Fila={Fila} />
            </div>
          )}
          {resueltas.length > 0 && (
            <div>
              <p className="mb-2 text-xs font-bold uppercase" style={{ color: "var(--gc-muted)" }}>Resueltas</p>
              <Tabla filas={resueltas} admin={admin} Fila={Fila} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Tabla({ filas, admin, Fila }: { filas: Regularizacion[]; admin: boolean; Fila: (props: { fila: Regularizacion }) => JSX.Element }) {
  return (
    <div className="gc-table-wrap">
      <table className="gc-table">
        <thead>
          <tr>
            <th>Concepto</th>
            <th>Punto</th>
            <th>Trabajador</th>
            <th>Fecha</th>
            <th style={{ textAlign: "right" }}>Importe</th>
            <th>Estado</th>
            <th>Quién</th>
            {admin && <th className="gc-no-print">Acción</th>}
          </tr>
        </thead>
        <tbody>
          {filas.map(fila => <Fila key={fila.id} fila={fila} />)}
        </tbody>
      </table>
    </div>
  );
}

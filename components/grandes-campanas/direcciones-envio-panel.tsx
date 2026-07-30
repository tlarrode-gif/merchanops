"use client";

import { useEffect, useMemo, useState } from "react";
import { Check, MapPin, Save, Truck } from "lucide-react";
import { trabajadoresConPuntos } from "@/lib/campana-asignacion";
import { PuntoVenta } from "@/lib/campanas";
import { WorkerAddress, formatDireccionEnvio, listWorkerAddresses } from "@/lib/direcciones-envio";

/**
 * Panel de direcciones de envío de una campaña (v10.2).
 *
 * Antes, cuando administración marcaba «Solicitar a los gestores la dirección de envío», al
 * gestor solo se le abría un desplegable con las direcciones que un admin hubiera guardado
 * antes en la ficha del trabajador: si no había ninguna, no había nada que rellenar y el
 * gestor se quedaba sin poder contestar.
 *
 * Aquí el gestor elige un trabajador, escribe la dirección UNA vez y se vuelca a todos los
 * puntos que ese trabajador tiene en la campaña. Por defecto queda guardada en su ficha
 * para reutilizarla en campañas siguientes, y se puede desmarcar para un envío puntual.
 */
export function DireccionesEnvioPanel({
  puntos,
  saving,
  onAplicar
}: {
  puntos: PuntoVenta[];
  saving: boolean;
  onAplicar: (input: {
    workerId: string;
    workerNombre: string;
    direccion: string;
    poblacion: string;
    codigoPostal: string;
    provincia: string;
    etiqueta: string;
    guardarEnFicha: boolean;
    direccionExistenteId?: string | null;
  }) => Promise<void>;
}) {
  const trabajadores = useMemo(() => trabajadoresConPuntos(puntos), [puntos]);
  const [workerId, setWorkerId] = useState("");
  const [guardadas, setGuardadas] = useState<WorkerAddress[]>([]);
  const [cargando, setCargando] = useState(false);
  const [form, setForm] = useState({ etiqueta: "", direccion: "", codigoPostal: "", poblacion: "", provincia: "" });
  const [guardarEnFicha, setGuardarEnFicha] = useState(true);

  const seleccionado = trabajadores.find(item => item.id === workerId);
  const puntosDelTrabajador = useMemo(() => puntos.filter(punto => punto.instalador_id === workerId), [puntos, workerId]);
  const sinDireccion = trabajadores.reduce((sum, item) => sum + item.sinDireccion, 0);
  const puntosSinTrabajador = puntos.filter(punto => !punto.instalador_id).length;

  useEffect(() => {
    let alive = true;
    if (!workerId) { setGuardadas([]); return; }
    setCargando(true);
    listWorkerAddresses(workerId).then(result => {
      if (!alive) return;
      setGuardadas(result.data);
      setCargando(false);
      // Se propone la predeterminada (o la única) para no teclearla otra vez.
      const propuesta = result.data.find(addr => addr.predeterminada) || result.data[0];
      const actual = puntosDelTrabajador.find(punto => punto.direccion_envio)?.direccion_envio;
      if (!actual && propuesta) {
        setForm({
          etiqueta: propuesta.etiqueta || "",
          direccion: propuesta.direccion || "",
          codigoPostal: propuesta.codigo_postal || "",
          poblacion: propuesta.poblacion || "",
          provincia: propuesta.provincia || ""
        });
      }
    });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workerId]);

  function elegirGuardada(id: string) {
    const addr = guardadas.find(item => item.id === id);
    if (!addr) return;
    setForm({
      etiqueta: addr.etiqueta || "",
      direccion: addr.direccion || "",
      codigoPostal: addr.codigo_postal || "",
      poblacion: addr.poblacion || "",
      provincia: addr.provincia || ""
    });
  }

  async function aplicar() {
    if (!workerId || !form.direccion.trim()) return;
    const yaGuardada = guardadas.find(addr => formatDireccionEnvio(addr) === formatDireccionEnvio({
      direccion: form.direccion,
      codigo_postal: form.codigoPostal,
      poblacion: form.poblacion,
      provincia: form.provincia
    }));
    await onAplicar({
      workerId,
      workerNombre: seleccionado?.nombre || workerId,
      direccion: form.direccion.trim(),
      poblacion: form.poblacion.trim(),
      codigoPostal: form.codigoPostal.trim(),
      provincia: form.provincia.trim(),
      etiqueta: form.etiqueta.trim(),
      guardarEnFicha: guardarEnFicha && !yaGuardada,
      direccionExistenteId: yaGuardada?.id || null
    });
  }

  if (!trabajadores.length) {
    return (
      <section className="gc-form-section gc-no-print">
        <h2 className="gc-form-title"><Truck className="mr-2 inline h-4 w-4" />Direcciones de envío del material</h2>
        <p className="gc-note">
          Administración ha pedido la dirección de envío de los trabajadores, pero todavía no hay ningún
          trabajador asignado{puntosSinTrabajador ? ` (${puntosSinTrabajador} punto${puntosSinTrabajador > 1 ? "s" : ""} sin trabajador)` : ""}.
          Asigna trabajadores a los puntos —con «Sugerir trabajador» o desde la columna Instalador— y aquí podrás
          indicar la dirección de cada uno de una sola vez.
        </p>
      </section>
    );
  }

  return (
    <section className="gc-form-section gc-no-print">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="gc-form-title mb-0" style={{ borderBottom: "none", paddingBottom: 0 }}>
          <Truck className="mr-2 inline h-4 w-4" />Direcciones de envío del material
        </h2>
        <p className="text-xs" style={{ color: sinDireccion ? "var(--gc-secondary)" : "var(--gc-muted)" }}>
          {sinDireccion
            ? `${sinDireccion} punto${sinDireccion > 1 ? "s" : ""} sin dirección de envío`
            : "Todos los puntos asignados tienen dirección de envío"}
        </p>
      </div>

      <p className="mb-3 text-xs" style={{ color: "var(--gc-muted)" }}>
        Elige un trabajador, escribe su dirección una sola vez y se aplica a todos sus puntos de esta campaña.
        Es el destino que recibe Logística para preparar el material.
      </p>

      <div className="grid gap-3 md:grid-cols-4">
        <label className="md:col-span-2">
          <span className="gc-label">Trabajador</span>
          <select className="gc-select" value={workerId} disabled={saving} onChange={event => setWorkerId(event.target.value)}>
            <option value="">Selecciona un trabajador…</option>
            {trabajadores.map(item => (
              <option key={item.id} value={item.id}>
                {item.nombre} · {item.puntos} punto{item.puntos > 1 ? "s" : ""}{item.sinDireccion ? ` · ${item.sinDireccion} sin dirección` : " · completo"}
              </option>
            ))}
          </select>
        </label>
        {workerId && guardadas.length > 0 && (
          <label className="md:col-span-2">
            <span className="gc-label">Direcciones guardadas de este trabajador</span>
            <select className="gc-select" defaultValue="" disabled={saving || cargando} onChange={event => elegirGuardada(event.target.value)}>
              <option value="">Reutilizar una dirección guardada…</option>
              {guardadas.map(addr => (
                <option key={addr.id} value={addr.id}>
                  {(addr.etiqueta ? `${addr.etiqueta} · ` : "") + formatDireccionEnvio(addr)}{addr.predeterminada ? " (predeterminada)" : ""}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>

      {workerId && (
        <>
          <div className="mt-3 grid gap-3 md:grid-cols-6">
            <label className="md:col-span-3">
              <span className="gc-label">Dirección *</span>
              <input className="gc-input" placeholder="Calle, número, piso" value={form.direccion} disabled={saving} onChange={event => setForm({ ...form, direccion: event.target.value })} />
            </label>
            <label>
              <span className="gc-label">C. Postal</span>
              <input className="gc-input" value={form.codigoPostal} disabled={saving} onChange={event => setForm({ ...form, codigoPostal: event.target.value })} />
            </label>
            <label>
              <span className="gc-label">Población</span>
              <input className="gc-input" value={form.poblacion} disabled={saving} onChange={event => setForm({ ...form, poblacion: event.target.value })} />
            </label>
            <label>
              <span className="gc-label">Provincia</span>
              <input className="gc-input" value={form.provincia} disabled={saving} onChange={event => setForm({ ...form, provincia: event.target.value })} />
            </label>
          </div>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
            <span className="flex flex-wrap items-center gap-4 text-xs">
              <label className="inline-flex items-center gap-2">
                <input type="checkbox" checked={guardarEnFicha} disabled={saving} onChange={event => setGuardarEnFicha(event.target.checked)} />
                Guardar en la ficha del trabajador para próximas campañas
              </label>
              <label className="inline-flex items-center gap-1" style={{ color: "var(--gc-muted)" }}>
                <input className="gc-input" style={{ width: 120 }} placeholder="Etiqueta (casa…)" value={form.etiqueta} disabled={saving} onChange={event => setForm({ ...form, etiqueta: event.target.value })} />
              </label>
            </span>
            <button className="gc-btn-dark" disabled={saving || !form.direccion.trim()} onClick={aplicar}>
              {guardarEnFicha ? <Save className="h-4 w-4" /> : <Check className="h-4 w-4" />}
              Aplicar a los {puntosDelTrabajador.length} punto{puntosDelTrabajador.length === 1 ? "" : "s"} de {seleccionado?.nombre || "este trabajador"}
            </button>
          </div>
          {puntosDelTrabajador.some(punto => punto.direccion_envio) && (
            <p className="mt-2 text-xs" style={{ color: "var(--gc-muted)" }}>
              <MapPin className="mr-1 inline h-3 w-3" />
              Dirección actual: {puntosDelTrabajador.find(punto => punto.direccion_envio)?.direccion_envio}
            </p>
          )}
        </>
      )}
    </section>
  );
}

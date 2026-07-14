"use client";

import { useMemo, useState } from "react";
import { Plus, Sparkles, Users } from "lucide-react";
import { GestorAvatar } from "@/components/grandes-campanas/gestor-avatars";
import { AppSession, AppUser, isAdminSession } from "@/lib/access-control";
import { CampanaEstado } from "@/lib/campanas";
import { normalizeProvince, spanishProvinces } from "@/lib/provinces";

export type CampanaFormState = {
  nombre: string;
  cliente_marca: string;
  descripcion: string;
  estado: CampanaEstado;
  fecha_inicio: string;
  fecha_fin: string;
  presupuesto: string;
  provincias: string[];
  gestorIds: string[];
  solicitarDireccionEnvio: boolean;
};

export const emptyCampanaForm: CampanaFormState = {
  nombre: "",
  cliente_marca: "",
  descripcion: "",
  estado: "borrador",
  fecha_inicio: "",
  fecha_fin: "",
  presupuesto: "",
  provincias: [],
  gestorIds: [],
  solicitarDireccionEnvio: false
};

type ClientOption = { id: string; name: string };

export function CampanaForm({
  value,
  onChange,
  clients,
  gestores,
  session,
  showEstadoInicial = true
}: {
  value: CampanaFormState;
  onChange: (next: CampanaFormState) => void;
  clients: ClientOption[];
  gestores: AppUser[];
  session: AppSession | null;
  showEstadoInicial?: boolean;
}) {
  const [equipoAbierto, setEquipoAbierto] = useState(false);
  const [provinciasAbierto, setProvinciasAbierto] = useState(false);
  const admin = isAdminSession(session);
  const provinciasDisponibles = useMemo(
    () => admin ? [...spanishProvinces] : (session?.provinces || []),
    [admin, session]
  );
  const patch = (partial: Partial<CampanaFormState>) => onChange({ ...value, ...partial });

  function toggleProvincia(provincia: string) {
    patch({ provincias: value.provincias.includes(provincia) ? value.provincias.filter(p => p !== provincia) : [...value.provincias, provincia] });
  }

  function toggleGestor(gestorId: string) {
    patch({ gestorIds: value.gestorIds.includes(gestorId) ? value.gestorIds.filter(id => id !== gestorId) : [...value.gestorIds, gestorId] });
  }

  // 4A: propone (añade) los gestores cuyas provincias solapan con las de la campaña.
  function sugerirGestores() {
    const provNorm = value.provincias.map(normalizeProvince);
    const propuestos = gestores.filter(gestor => (gestor.provinces || []).some(provincia => provNorm.includes(normalizeProvince(provincia)))).map(gestor => gestor.id);
    if (propuestos.length) patch({ gestorIds: Array.from(new Set([...value.gestorIds, ...propuestos])) });
  }

  const gestoresSeleccionados = gestores.filter(gestor => value.gestorIds.includes(gestor.id));

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <section className="gc-form-section">
        <h2 className="gc-form-title">Detalles Básicos</h2>
        <div className="space-y-3">
          <label className="block">
            <span className="gc-label">Nombre de la Campaña <span className="gc-req">*</span></span>
            <input className="gc-input" placeholder="Ej. Lanzamiento Verano 2026" value={value.nombre} onChange={event => patch({ nombre: event.target.value })} />
          </label>
          <label className="block">
            <span className="gc-label">Cliente/Marca</span>
            <select className="gc-select" value={clients.some(client => client.name === value.cliente_marca) ? value.cliente_marca : ""} onChange={event => patch({ cliente_marca: event.target.value })}>
              <option value="">Seleccionar cliente...</option>
              {clients.map(client => <option key={client.id} value={client.name}>{client.name}</option>)}
            </select>
            <input className="gc-input mt-2" placeholder="O escribe un cliente/marca nuevo" value={value.cliente_marca} onChange={event => patch({ cliente_marca: event.target.value })} />
          </label>
          <label className="block">
            <span className="gc-label">Descripción</span>
            <textarea className="gc-textarea" rows={4} placeholder="Detalles operativos de la campaña..." value={value.descripcion} onChange={event => patch({ descripcion: event.target.value })} />
          </label>
          {showEstadoInicial && (
            <div>
              <span className="gc-label">Estado inicial</span>
              <div className="flex gap-4 text-sm">
                {(["borrador", "planificada"] as CampanaEstado[]).map(estado => (
                  <label key={estado} className="flex items-center gap-2">
                    <input type="radio" name="gc-estado-inicial" checked={value.estado === estado} onChange={() => patch({ estado })} />
                    {estado === "borrador" ? "Borrador" : "Planificada"}
                  </label>
                ))}
              </div>
            </div>
          )}
        </div>
      </section>

      <section className="gc-form-section">
        <h2 className="gc-form-title">Logística y Tiempos</h2>
        <div className="space-y-3">
          <div className="grid gap-3 md:grid-cols-2">
            <label className="block">
              <span className="gc-label">Fecha Inicio</span>
              <input type="date" className="gc-input" value={value.fecha_inicio} onChange={event => patch({ fecha_inicio: event.target.value })} />
            </label>
            <label className="block">
              <span className="gc-label">Fecha Fin</span>
              <input type="date" className="gc-input" value={value.fecha_fin} onChange={event => patch({ fecha_fin: event.target.value })} />
            </label>
          </div>
          {/* Presupuesto: información financiera visible solo para administración. */}
          {admin && (
            <label className="block">
              <span className="gc-label">Presupuesto (€)</span>
              <input type="number" className="gc-input" placeholder="0,00" value={value.presupuesto} onChange={event => patch({ presupuesto: event.target.value })} />
            </label>
          )}
          <div>
            <span className="gc-label">Provincias (Multi-selección)</span>
            <div className="flex flex-wrap items-center gap-2">
              {value.provincias.map(provincia => (
                <button key={provincia} type="button" className="gc-pill" onClick={() => toggleProvincia(provincia)} title="Quitar provincia">{provincia} ×</button>
              ))}
              <button type="button" className="gc-pill gc-pill-off" onClick={() => setProvinciasAbierto(open => !open)}>
                <Plus className="h-3 w-3" /> {provinciasAbierto ? "Cerrar" : "Añadir"}
              </button>
            </div>
            {provinciasAbierto && (
              <div className="mt-2 grid max-h-48 gap-1 overflow-auto rounded-xl border p-3 md:grid-cols-3" style={{ borderColor: "var(--gc-border)" }}>
                {provinciasDisponibles.map(provincia => (
                  <label key={provincia} className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={value.provincias.includes(provincia)} onChange={() => toggleProvincia(provincia)} />
                    {provincia}
                  </label>
                ))}
                {!provinciasDisponibles.length && <p className="text-sm" style={{ color: "var(--gc-muted)" }}>Tu usuario no tiene provincias asignadas.</p>}
              </div>
            )}
          </div>
          <div>
            <span className="gc-label">Gestores Asignados</span>
            <div className="flex flex-wrap items-center gap-2">
              <span className="gc-avatar-stack">
                {gestoresSeleccionados.slice(0, 5).map(gestor => <GestorAvatar key={gestor.id} name={gestor.display_name} />)}
                {gestoresSeleccionados.length > 5 && <span className="gc-avatar gc-avatar-more">+{gestoresSeleccionados.length - 5}</span>}
              </span>
              <button type="button" className="gc-btn-outline" onClick={() => setEquipoAbierto(open => !open)}>
                <Users className="h-4 w-4" />
                {equipoAbierto ? "Cerrar equipo" : "Gestionar equipo"}
              </button>
              <button type="button" className="gc-btn-outline" onClick={sugerirGestores} disabled={!value.provincias.length} title="Proponer gestores según las provincias de la campaña">
                <Sparkles className="h-4 w-4" />
                Sugerir gestor
              </button>
            </div>
            {equipoAbierto && (
              <div className="mt-2 grid max-h-48 gap-1 overflow-auto rounded-xl border p-3 md:grid-cols-2" style={{ borderColor: "var(--gc-border)" }}>
                {gestores.map(gestor => (
                  <label key={gestor.id} className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={value.gestorIds.includes(gestor.id)} onChange={() => toggleGestor(gestor.id)} />
                    <GestorAvatar name={gestor.display_name} size={22} />
                    {gestor.display_name}
                    <span className="text-xs" style={{ color: "var(--gc-muted)" }}>{gestor.provinces?.join(", ") || (gestor.role === "admin" ? "Admin" : "Sin provincias")}</span>
                  </label>
                ))}
                {!gestores.length && <p className="text-sm" style={{ color: "var(--gc-muted)" }}>No hay usuarios activos para asignar.</p>}
              </div>
            )}
          </div>
          {/* Feature 2: anadido opcional — pedir a los gestores la direccion de envio de los trabajadores. */}
          <div>
            <span className="gc-label">Añadido opcional</span>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={value.solicitarDireccionEnvio} onChange={event => patch({ solicitarDireccionEnvio: event.target.checked })} />
              Solicitar a los gestores la dirección de envío de los trabajadores
            </label>
            <p className="text-xs" style={{ color: "var(--gc-muted)" }}>Si se activa, cada gestor podrá indicar la dirección de envío del material de sus trabajadores. Se usará como destino en Logística (con prioridad sobre la dirección del punto).</p>
          </div>
        </div>
      </section>
    </div>
  );
}

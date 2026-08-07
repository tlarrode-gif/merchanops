"use client";

import Link from "next/link";

import { useEffect, useState } from "react";
import { Save } from "lucide-react";
import { CampanaForm, CampanaFormState, configuracionPagoCampana, emptyCampanaForm } from "@/components/grandes-campanas/campana-form";
import { ColumnasConfig } from "@/components/grandes-campanas/columnas-config";
import { AppSession, AppUser, canAccessModule, canManageCampaigns, getCurrentAppSession, loadInternalUsers } from "@/lib/access-control";
import { CampanaColumna, fetchCampanaColumnas, saveCampanaColumnas } from "@/lib/campana-columnas";
import { fetchDelegacionesCampana, saveDelegacionesCampana } from "@/lib/campana-delegaciones";
import { CampanaEstado, campanaEstadoLabels, campanaEstados, dateOnly, fetchCampana, fetchGestoresCampana, saveGestoresCampana, updateCampana } from "@/lib/campanas";
import { isSupabaseConfigured, supabase } from "@/lib/supabase";

type ClientOption = { id: string; name: string };

export default function EditarCampanaPage({ params }: { params: { id: string } }) {
  const [session] = useState<AppSession | null>(() => typeof window !== "undefined" ? getCurrentAppSession() : null);
  const [form, setForm] = useState<CampanaFormState>(emptyCampanaForm);
  const [estado, setEstado] = useState<CampanaEstado>("borrador");
  const [nombreCampana, setNombreCampana] = useState("");
  const [clients, setClients] = useState<ClientOption[]>([]);
  const [gestores, setGestores] = useState<AppUser[]>([]);
  const [delegaciones, setDelegaciones] = useState<AppUser[]>([]);
  const [columnas, setColumnas] = useState<CampanaColumna[]>([]);
  const [columnasEditadas, setColumnasEditadas] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    async function load() {
      const users = await loadInternalUsers();
      if (isSupabaseConfigured && supabase) {
        const { data } = await supabase.from("clients").select("id,name").order("name");
        setClients((data || []) as ClientOption[]);
      }
      const [campanaResult, gestoresResult, columnasResult, delegacionesResult] = await Promise.all([
        fetchCampana(params.id),
        fetchGestoresCampana(params.id),
        fetchCampanaColumnas(params.id),
        fetchDelegacionesCampana(params.id)
      ]);
      if (campanaResult.error) setError(campanaResult.error);
      if (!campanaResult.data) { setNotFound(true); setLoading(false); return; }
      // Los selectores muestran los usuarios activos + los ya asignados a la campaña
      // aunque estén inactivos, para no perderlos al guardar (el delete+insert de
      // saveGestoresCampana / saveDelegacionesCampana los borraría de la campaña).
      const asignadosIds = new Set(gestoresResult.data.map(g => g.gestor_id).filter(Boolean) as string[]);
      const delegadasIds = new Set(delegacionesResult.data.map(d => d.delegacion_id).filter(Boolean) as string[]);
      setGestores(users.filter(user => (user.active && (user.role === "manager" || user.role === "admin")) || asignadosIds.has(user.id)));
      setDelegaciones(users.filter(user => (user.active && user.role === "delegacion") || delegadasIds.has(user.id)));
      setColumnas(columnasResult.data);
      const campana = campanaResult.data;
      setNombreCampana(campana.nombre);
      setEstado(campana.estado);
      setForm({
        nombre: campana.nombre,
        cliente_marca: campana.cliente_marca || "",
        descripcion: campana.descripcion || "",
        estado: campana.estado === "planificada" ? "planificada" : "borrador",
        fecha_inicio: dateOnly(campana.fecha_inicio),
        fecha_fin: dateOnly(campana.fecha_fin),
        presupuesto: campana.presupuesto != null ? String(campana.presupuesto) : "",
        provincias: campana.provincias || [],
        gestorIds: gestoresResult.data.map(gestor => gestor.gestor_id).filter(Boolean) as string[],
        solicitarDireccionEnvio: !!campana.solicitar_direccion_envio,
        delegacionesActivas: !!campana.delegaciones_activas,
        delegacionIds: delegacionesResult.data.map(delegacion => delegacion.delegacion_id).filter(Boolean) as string[],
        pagoPorHoras: !!campana.pago_por_horas,
        // Las tarifas se editan como texto: "" es «sin tarifa» y 0 es «gratis», y
        // convertir null en "0" habría hecho pagable a 0 € lo que debe bloquearse.
        tarifaHora: campana.tarifa_hora != null ? String(campana.tarifa_hora) : "",
        pagoKilometraje: !!campana.pago_kilometraje,
        tarifaKm: campana.tarifa_km != null ? String(campana.tarifa_km) : ""
      });
      setLoading(false);
    }
    load();
  }, [params.id]);

  async function guardar() {
    if (!form.nombre.trim()) { setError("El nombre de la campaña es obligatorio."); return; }
    setSaving(true);
    setError("");
    const result = await updateCampana(params.id, {
      nombre: form.nombre.trim(),
      cliente_marca: form.cliente_marca.trim() || null,
      descripcion: form.descripcion.trim() || null,
      estado,
      fecha_inicio: form.fecha_inicio || null,
      fecha_fin: form.fecha_fin || null,
      provincias: form.provincias,
      presupuesto: form.presupuesto ? Number(form.presupuesto) : null,
      solicitar_direccion_envio: form.solicitarDireccionEnvio,
      ...configuracionPagoCampana(form)
    });
    if (result.error) { setError(result.error); setSaving(false); return; }
    const seleccionados = gestores.filter(gestor => form.gestorIds.includes(gestor.id));
    const gestoresResult = await saveGestoresCampana(params.id, seleccionados);
    if (gestoresResult.error) { setError(`Campaña guardada, pero el equipo no se pudo actualizar: ${gestoresResult.error}`); setSaving(false); return; }
    const delegacionesElegidas = delegaciones.filter(delegacion => form.delegacionIds.includes(delegacion.id));
    const delegacionesResult = await saveDelegacionesCampana(params.id, delegacionesElegidas);
    if (delegacionesResult.error) { setError(`Campaña guardada, pero las delegaciones no se pudieron actualizar: ${delegacionesResult.error}`); setSaving(false); return; }
    if (columnasEditadas) {
      const columnasResult = await saveCampanaColumnas(params.id, columnas);
      if (columnasResult.error) { setError(`Campaña guardada, pero el esquema de columnas no se pudo actualizar: ${columnasResult.error}`); setSaving(false); return; }
    }
    window.location.href = `/grandes-campanas/${params.id}`;
  }

  if (!session?.active) {
    return <main className="gc-module p-4"><section className="gc-empty mx-auto mt-10 max-w-2xl"><b>Inicia sesión</b> en MerchanOps para editar campañas.</section></main>;
  }
  if (!canAccessModule(session, "servicios")) {
    return <main className="gc-module p-4"><section className="gc-empty mx-auto mt-10 max-w-2xl">No tienes permiso para editar Grandes Campañas.</section></main>;
  }
  if (!canManageCampaigns(session)) {
    return <main className="gc-module p-4"><section className="gc-empty mx-auto mt-10 max-w-2xl">La edición de detalles de campaña está reservada a administración. <Link className="underline" href={`/grandes-campanas/${params.id}`}>Volver al detalle</Link>.</section></main>;
  }
  if (loading) {
    return <main className="gc-module"><section className="mx-auto max-w-[1100px] space-y-3 p-4"><div className="gc-skeleton h-16" /><div className="gc-skeleton h-72" /></section></main>;
  }
  if (notFound) {
    return <main className="gc-module p-4"><section className="gc-empty mx-auto mt-10 max-w-2xl"><b>Campaña no encontrada.</b> <Link className="underline" href="/grandes-campanas">Volver al listado</Link>.</section></main>;
  }

  return (
    <main className="gc-module">
      <section className="mx-auto max-w-[1100px] space-y-4 p-4">
        <div>
          <nav className="text-sm" style={{ color: "var(--gc-muted)" }}>
            <Link href="/grandes-campanas" className="font-semibold hover:underline">Grandes Campañas</Link>
            <span> / </span>
            <Link href={`/grandes-campanas/${params.id}`} className="font-semibold hover:underline">{nombreCampana}</Link>
            <span> / Editar</span>
          </nav>
          <h1 className="mo-page-title mt-1 text-2xl font-extrabold">Editar campaña</h1>
        </div>

        <section className="gc-form-section">
          <h2 className="gc-form-title">Estado de la campaña</h2>
          <div className="flex flex-wrap gap-2">
            {campanaEstados.map(opcion => (
              <button key={opcion} className={`gc-pill ${estado === opcion ? "" : "gc-pill-off"}`} onClick={() => setEstado(opcion)}>
                {campanaEstadoLabels[opcion]}
              </button>
            ))}
          </div>
        </section>

        <CampanaForm value={form} onChange={setForm} clients={clients} gestores={gestores} delegaciones={delegaciones} session={session} showEstadoInicial={false} />

        {columnas.length > 0 && (
          <section className="gc-form-section">
            <h2 className="gc-form-title">Columnas del archivo importado</h2>
            <p className="mb-3 text-xs" style={{ color: "var(--gc-muted)" }}>
              Ajusta el nombre visible, la visibilidad por rol o el mapeo de las columnas de esta campaña.
              Los cambios de mapeo solo afectan a importaciones futuras; los datos ya importados no se modifican.
            </p>
            <ColumnasConfig columnas={columnas} onChange={next => { setColumnas(next); setColumnasEditadas(true); }} disabled={saving} />
          </section>
        )}

        {error && <div className="gc-note"><b>Error:</b> {error}</div>}

        <footer className="flex flex-wrap items-center justify-between gap-3 pb-8">
          <Link href={`/grandes-campanas/${params.id}`} className="text-sm font-semibold hover:underline" style={{ color: "var(--gc-muted)" }}>Cancelar</Link>
          <button className="gc-btn-dark" disabled={saving} onClick={guardar}><Save className="h-4 w-4" />{saving ? "Guardando..." : "Guardar cambios"}</button>
        </footer>
      </section>
    </main>
  );
}

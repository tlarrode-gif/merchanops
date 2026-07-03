"use client";

import { useEffect, useState } from "react";
import { Save } from "lucide-react";
import { CampanaForm, CampanaFormState, emptyCampanaForm } from "@/components/grandes-campanas/campana-form";
import { AppSession, AppUser, canAccessModule, getCurrentAppSession, loadInternalUsers } from "@/lib/access-control";
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
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    async function load() {
      const users = await loadInternalUsers();
      setGestores(users.filter(user => user.active));
      if (isSupabaseConfigured && supabase) {
        const { data } = await supabase.from("clients").select("id,name").order("name");
        setClients((data || []) as ClientOption[]);
      }
      const [campanaResult, gestoresResult] = await Promise.all([fetchCampana(params.id), fetchGestoresCampana(params.id)]);
      if (campanaResult.error) setError(campanaResult.error);
      if (!campanaResult.data) { setNotFound(true); setLoading(false); return; }
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
        gestorIds: gestoresResult.data.map(gestor => gestor.gestor_id).filter(Boolean) as string[]
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
      presupuesto: form.presupuesto ? Number(form.presupuesto) : null
    });
    if (result.error) { setError(result.error); setSaving(false); return; }
    const seleccionados = gestores.filter(gestor => form.gestorIds.includes(gestor.id));
    const gestoresResult = await saveGestoresCampana(params.id, seleccionados);
    if (gestoresResult.error) { setError(`Campaña guardada, pero el equipo no se pudo actualizar: ${gestoresResult.error}`); setSaving(false); return; }
    window.location.href = `/grandes-campanas/${params.id}`;
  }

  if (!session?.active) {
    return <main className="gc-module p-4"><section className="gc-empty mx-auto mt-10 max-w-2xl"><b>Inicia sesión</b> en MerchanOps para editar campañas.</section></main>;
  }
  if (!canAccessModule(session, "servicios")) {
    return <main className="gc-module p-4"><section className="gc-empty mx-auto mt-10 max-w-2xl">No tienes permiso para editar Grandes Campañas.</section></main>;
  }
  if (loading) {
    return <main className="gc-module"><section className="mx-auto max-w-[1100px] space-y-3 p-4"><div className="gc-skeleton h-16" /><div className="gc-skeleton h-72" /></section></main>;
  }
  if (notFound) {
    return <main className="gc-module p-4"><section className="gc-empty mx-auto mt-10 max-w-2xl"><b>Campaña no encontrada.</b> <a className="underline" href="/grandes-campanas">Volver al listado</a>.</section></main>;
  }

  return (
    <main className="gc-module">
      <section className="mx-auto max-w-[1100px] space-y-4 p-4">
        <div>
          <nav className="text-sm" style={{ color: "var(--gc-muted)" }}>
            <a href="/grandes-campanas" className="font-semibold hover:underline">Grandes Campañas</a>
            <span> / </span>
            <a href={`/grandes-campanas/${params.id}`} className="font-semibold hover:underline">{nombreCampana}</a>
            <span> / Editar</span>
          </nav>
          <h1 className="mt-1 text-2xl font-extrabold">Editar campaña</h1>
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

        <CampanaForm value={form} onChange={setForm} clients={clients} gestores={gestores} session={session} showEstadoInicial={false} />

        {error && <div className="gc-note"><b>Error:</b> {error}</div>}

        <footer className="flex flex-wrap items-center justify-between gap-3 pb-8">
          <a href={`/grandes-campanas/${params.id}`} className="text-sm font-semibold hover:underline" style={{ color: "var(--gc-muted)" }}>Cancelar</a>
          <button className="gc-btn-dark" disabled={saving} onClick={guardar}><Save className="h-4 w-4" />{saving ? "Guardando..." : "Guardar cambios"}</button>
        </footer>
      </section>
    </main>
  );
}

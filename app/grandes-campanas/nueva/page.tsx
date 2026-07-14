"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowRight, Plus } from "lucide-react";
import { CampanaForm, CampanaFormState, emptyCampanaForm } from "@/components/grandes-campanas/campana-form";
import { ImportProgress, ImportadorCSV, ImportadorEstado } from "@/components/grandes-campanas/importador-csv";
import { AppSession, AppUser, canAccessModule, canManageCampaigns, getCurrentAppSession, loadInternalUsers } from "@/lib/access-control";
import { saveCampanaColumnas } from "@/lib/campana-columnas";
import { PuntoInput, insertCampana, insertPuntosBatch, saveGestoresCampana } from "@/lib/campanas";
import { isSupabaseConfigured, supabase } from "@/lib/supabase";

const BATCH_SIZE = 500;

type ClientOption = { id: string; name: string };

const emptyManual: PuntoInput = { codigo: null, nombre_comercial: "", direccion: null, provincia: null, tipo: null, estado: "pendiente", fecha_visita: null, importe: null, gestor_id: null, gestor_nombre: null, notas: null, datos_extra: {} };

export default function NuevaCampanaPage() {
  const [session] = useState<AppSession | null>(() => typeof window !== "undefined" ? getCurrentAppSession() : null);
  const [form, setForm] = useState<CampanaFormState>(emptyCampanaForm);
  const [clients, setClients] = useState<ClientOption[]>([]);
  const [gestores, setGestores] = useState<AppUser[]>([]);
  const [importEstado, setImportEstado] = useState<ImportadorEstado | null>(null);
  const [progress, setProgress] = useState<ImportProgress>(null);
  const [manualActivo, setManualActivo] = useState(false);
  const [manualPunto, setManualPunto] = useState<PuntoInput>({ ...emptyManual });
  const [manualPuntos, setManualPuntos] = useState<PuntoInput[]>([]);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");

  useEffect(() => {
    async function loadCatalogos() {
      const users = await loadInternalUsers();
      setGestores(users.filter(user => user.active));
      if (isSupabaseConfigured && supabase) {
        const { data } = await supabase.from("clients").select("id,name").order("name");
        setClients((data || []) as ClientOption[]);
      }
    }
    loadCatalogos();
  }, []);

  const totalAImportar = useMemo(() => (importEstado?.readyRows.length || 0) + manualPuntos.length, [importEstado, manualPuntos]);

  function addManualPunto() {
    if (!manualPunto.nombre_comercial.trim()) { setFormError("El punto manual necesita un nombre comercial."); return; }
    setManualPuntos(previous => [...previous, { ...manualPunto, nombre_comercial: manualPunto.nombre_comercial.trim() }]);
    setManualPunto({ ...emptyManual });
    setFormError("");
  }

  async function guardar(modo: "borrador" | "crear") {
    setFormError("");
    if (!form.nombre.trim()) { setFormError("El nombre de la campaña es obligatorio."); return; }
    if (modo === "crear" && importEstado && importEstado.blockingErrors > 0) {
      setFormError(`Hay ${importEstado.blockingErrors} filas con errores en el archivo. Corrígelas o marca «Omitir filas con errores».`);
      return;
    }
    setSaving(true);
    try {
      const estado = modo === "borrador" ? "borrador" : form.estado;
      const created = await insertCampana({
        nombre: form.nombre.trim(),
        cliente_marca: form.cliente_marca.trim() || null,
        descripcion: form.descripcion.trim() || null,
        estado,
        fecha_inicio: form.fecha_inicio || null,
        fecha_fin: form.fecha_fin || null,
        provincias: form.provincias,
        presupuesto: form.presupuesto ? Number(form.presupuesto) : null,
        solicitar_direccion_envio: form.solicitarDireccionEnvio
      }, session);
      if (created.error || !created.data) { setFormError(created.error || "No se pudo crear la campaña."); return; }
      const campanaId = created.data.id;

      const seleccionados = gestores.filter(gestor => form.gestorIds.includes(gestor.id));
      const gestoresResult = await saveGestoresCampana(campanaId, seleccionados);
      if (gestoresResult.error) { setFormError(`Campaña creada, pero no se pudieron asignar gestores: ${gestoresResult.error}`); }

      if (importEstado?.columnas.length) {
        const columnasResult = await saveCampanaColumnas(campanaId, importEstado.columnas);
        if (columnasResult.error) setFormError(`Campaña creada, pero el esquema de columnas no se pudo guardar: ${columnasResult.error}`);
      }

      const puntos = [...(importEstado?.readyRows || []), ...manualPuntos];
      let importados = 0;
      let duplicados = 0;
      if (puntos.length) {
        setProgress({ done: 0, total: puntos.length });
        for (let index = 0; index < puntos.length; index += BATCH_SIZE) {
          const batch = puntos.slice(index, index + BATCH_SIZE);
          const result = await insertPuntosBatch(campanaId, batch);
          if (result.error) {
            setFormError(`Se importaron ${importados} de ${puntos.length} puntos antes de un error: ${result.error}. Puedes reintentar desde el detalle de la campaña: los códigos ya importados no se duplicarán.`);
            window.location.href = `/grandes-campanas/${campanaId}?importados=${importados}`;
            return;
          }
          importados += result.data;
          duplicados += result.omitidos || 0;
          setProgress({ done: importados + duplicados, total: puntos.length });
        }
      }
      const omitidos = (importEstado?.rows.filter(row => row.errors.length).length || 0);
      window.location.href = `/grandes-campanas/${campanaId}?importados=${importados}&omitidos=${importEstado?.omitErrors ? omitidos : 0}${duplicados ? `&duplicados=${duplicados}` : ""}`;
    } finally {
      setSaving(false);
      setProgress(null);
    }
  }

  if (!session?.active) {
    return <main className="gc-module p-4"><section className="gc-empty mx-auto mt-10 max-w-2xl"><b>Inicia sesión</b> en MerchanOps para crear grandes campañas.</section></main>;
  }
  if (!canAccessModule(session, "servicios")) {
    return <main className="gc-module p-4"><section className="gc-empty mx-auto mt-10 max-w-2xl">No tienes permiso para crear grandes campañas.</section></main>;
  }
  if (!canManageCampaigns(session)) {
    return <main className="gc-module p-4"><section className="gc-empty mx-auto mt-10 max-w-2xl">La creación de grandes campañas está reservada a administración. <a className="underline" href="/grandes-campanas">Volver al listado</a>.</section></main>;
  }

  return (
    <main className="gc-module">
      <section className="mx-auto max-w-[1100px] space-y-4 p-4">
        <div>
          <nav className="text-sm" style={{ color: "var(--gc-muted)" }}>
            <a href="/grandes-campanas" className="font-semibold hover:underline">← Grandes Campañas</a>
          </nav>
          <h1 className="mt-1 text-2xl font-extrabold">Crear / Importar nueva campaña nacional</h1>
        </div>

        <CampanaForm value={form} onChange={setForm} clients={clients} gestores={gestores} session={session} />

        <ImportadorCSV progress={progress} disabled={saving} onChange={setImportEstado} />

        <section className="gc-form-section">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-sm font-bold">Añadir puntos manualmente</h2>
              <p className="text-xs" style={{ color: "var(--gc-muted)" }}>Si no tienes un archivo, puedes crear los puntos uno a uno.{manualPuntos.length ? ` (${manualPuntos.length} añadidos)` : ""}</p>
            </div>
            <label className="inline-flex cursor-pointer items-center gap-2 text-sm">
              <input type="checkbox" checked={manualActivo} onChange={event => setManualActivo(event.target.checked)} />
              Activar
            </label>
          </div>
          {manualActivo && (
            <div className="mt-3 grid gap-2 md:grid-cols-6">
              <label className="md:col-span-2"><span className="gc-label">Nombre comercial *</span><input className="gc-input" value={manualPunto.nombre_comercial} onChange={event => setManualPunto({ ...manualPunto, nombre_comercial: event.target.value })} /></label>
              <label className="md:col-span-2"><span className="gc-label">Dirección</span><input className="gc-input" value={manualPunto.direccion || ""} onChange={event => setManualPunto({ ...manualPunto, direccion: event.target.value || null })} /></label>
              <label><span className="gc-label">Provincia</span><input className="gc-input" value={manualPunto.provincia || ""} onChange={event => setManualPunto({ ...manualPunto, provincia: event.target.value || null })} /></label>
              <label><span className="gc-label">Importe</span><input type="number" className="gc-input" value={manualPunto.importe ?? ""} onChange={event => setManualPunto({ ...manualPunto, importe: event.target.value === "" ? null : Number(event.target.value) })} /></label>
              <label><span className="gc-label">Código</span><input className="gc-input" value={manualPunto.codigo || ""} onChange={event => setManualPunto({ ...manualPunto, codigo: event.target.value || null })} /></label>
              <label><span className="gc-label">Tipo</span><input className="gc-input" value={manualPunto.tipo || ""} onChange={event => setManualPunto({ ...manualPunto, tipo: event.target.value || null })} /></label>
              <label><span className="gc-label">Fecha visita</span><input type="date" className="gc-input" value={manualPunto.fecha_visita || ""} onChange={event => setManualPunto({ ...manualPunto, fecha_visita: event.target.value || null })} /></label>
              <div className="flex items-end"><button className="gc-btn-outline" onClick={addManualPunto}><Plus className="h-4 w-4" />Añadir punto</button></div>
            </div>
          )}
        </section>

        {formError && <div className="gc-note"><b>Revisa antes de continuar:</b> {formError}</div>}

        <footer className="flex flex-wrap items-center justify-between gap-3 pb-8">
          <a href="/grandes-campanas" className="text-sm font-semibold hover:underline" style={{ color: "var(--gc-muted)" }}>Cancelar</a>
          <div className="flex flex-wrap gap-2">
            <button className="gc-btn-outline" disabled={saving} onClick={() => guardar("borrador")}>Guardar borrador</button>
            <button className="gc-btn-dark" disabled={saving} onClick={() => guardar("crear")}>
              {saving ? "Creando..." : `Crear campaña${totalAImportar ? ` (${totalAImportar.toLocaleString("es-ES")} puntos)` : ""}`}
              <ArrowRight className="h-4 w-4" />
            </button>
          </div>
        </footer>
      </section>
    </main>
  );
}

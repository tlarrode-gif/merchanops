"use client";

import Link from "next/link";

import { useEffect, useMemo, useState } from "react";
import { ArrowRight, Plus } from "lucide-react";
import { CampanaForm, CampanaFormState, configuracionPagoCampana, emptyCampanaForm } from "@/components/grandes-campanas/campana-form";
import { ImportProgress, ImportadorCSV, ImportadorEstado } from "@/components/grandes-campanas/importador-csv";
import { AppSession, AppUser, canAccessModule, canManageCampaigns, getCurrentAppSession, loadInternalUsers } from "@/lib/access-control";
import { asignarGestoresAPuntosNuevos, provinciasDeLosPuntos } from "@/lib/campana-asignacion";
import { delegacionesComoCandidatos, responsablesDeZona, saveDelegacionesCampana } from "@/lib/campana-delegaciones";
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
  const [delegaciones, setDelegaciones] = useState<AppUser[]>([]);
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
      // El equipo de la campaña son gestores; las delegaciones se eligen en su
      // propio bloque y no se mezclan con ellos. Almacén y RR.HH. quedan fuera:
      // `merchan_gc_puede_operar_campana` no les deja operar una campaña, así que
      // asignarlos no haría absolutamente nada.
      setGestores(users.filter(user => user.active && (user.role === "manager" || user.role === "admin")));
      setDelegaciones(users.filter(user => user.active && user.role === "delegacion"));
      if (isSupabaseConfigured && supabase) {
        const { data } = await supabase.from("clients").select("id,name").order("name");
        setClients((data || []) as ClientOption[]);
      }
    }
    loadCatalogos();
  }, []);

  const totalAImportar = useMemo(() => (importEstado?.readyRows.length || 0) + manualPuntos.length, [importEstado, manualPuntos]);

  // Las provincias de la campaña se deducen del propio archivo. Antes había que teclearlas
  // a mano y, sin ellas, «Sugerir gestor» quedaba deshabilitado justo cuando hacía falta.
  const provinciasDelArchivo = useMemo(
    () => provinciasDeLosPuntos(importEstado?.readyRows || []),
    [importEstado]
  );

  useEffect(() => {
    if (!provinciasDelArchivo.length) return;
    setForm(previous => {
      const faltan = provinciasDelArchivo.filter(provincia => !previous.provincias.includes(provincia));
      if (!faltan.length) return previous;
      return { ...previous, provincias: [...previous.provincias, ...faltan] };
    });
  }, [provinciasDelArchivo]);

  function addManualPunto() {
    if (!manualPunto.nombre_comercial.trim()) { setFormError("El punto manual necesita un nombre comercial."); return; }
    setManualPuntos(previous => [...previous, { ...manualPunto, nombre_comercial: manualPunto.nombre_comercial.trim() }]);
    setManualPunto({ ...emptyManual });
    setFormError("");
  }

  async function guardar(modo: "borrador" | "crear") {
    setFormError("");
    if (!form.nombre.trim()) { setFormError("El nombre de la campaña es obligatorio."); return; }
    if (importEstado?.needsNameColumn) {
      setFormError("El archivo no tiene columna de nombre del punto. Ábrelo en «Configurar columnas», marca esa columna como «Campo interno: Nombre comercial» y pulsa «Aplicar y revalidar archivo».");
      return;
    }
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
        solicitar_direccion_envio: form.solicitarDireccionEnvio,
        ...configuracionPagoCampana(form)
      }, session);
      if (created.error || !created.data) { setFormError(created.error || "No se pudo crear la campaña."); return; }
      const campanaId = created.data.id;

      const seleccionados = gestores.filter(gestor => form.gestorIds.includes(gestor.id));
      const gestoresResult = await saveGestoresCampana(campanaId, seleccionados);
      if (gestoresResult.error) { setFormError(`Campaña creada, pero no se pudieron asignar gestores: ${gestoresResult.error}`); }

      // Las delegaciones marcadas se guardan aunque el modo esté apagado: así se
      // puede preparar la lista y activarla más tarde sin volver a elegirlas.
      const delegacionesElegidas = delegaciones.filter(delegacion => form.delegacionIds.includes(delegacion.id));
      const delegacionesResult = await saveDelegacionesCampana(campanaId, delegacionesElegidas);
      if (delegacionesResult.error) { setFormError(`Campaña creada, pero no se pudieron guardar las delegaciones: ${delegacionesResult.error}`); }

      if (importEstado?.columnas.length) {
        const columnasResult = await saveCampanaColumnas(campanaId, importEstado.columnas);
        if (columnasResult.error) setFormError(`Campaña creada, pero el esquema de columnas no se pudo guardar: ${columnasResult.error}`);
      }

      // Reparto por zona en el momento de crear: cada punto nace con su responsable, y
      // ese reparto es lo que le da acceso al punto. En una campaña por delegaciones,
      // las provincias subcontratadas van a la delegación y el resto a los gestores.
      const puntosSinRepartir = [...(importEstado?.readyRows || []), ...manualPuntos];
      const { candidatos } = responsablesDeZona(
        seleccionados,
        delegacionesComoCandidatos(
          delegacionesElegidas.map(delegacion => ({ delegacion_id: delegacion.id, delegacion_nombre: delegacion.display_name, provincias: delegacion.provinces || [] })),
          delegacionesElegidas
        ),
        form.delegacionesActivas
      );
      const reparto = asignarGestoresAPuntosNuevos(puntosSinRepartir, candidatos);
      const puntos = reparto.puntos;
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
      const query = new URLSearchParams({ importados: String(importados) });
      if (importEstado?.omitErrors && omitidos) query.set("omitidos", String(omitidos));
      if (duplicados) query.set("duplicados", String(duplicados));
      if (reparto.asignados) query.set("repartidos", String(reparto.asignados));
      if (reparto.provinciasSinGestor.length) query.set("sinGestor", reparto.provinciasSinGestor.join(","));
      window.location.href = `/grandes-campanas/${campanaId}?${query.toString()}`;
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
    return <main className="gc-module p-4"><section className="gc-empty mx-auto mt-10 max-w-2xl">La creación de grandes campañas está reservada a administración. <Link className="underline" href="/grandes-campanas">Volver al listado</Link>.</section></main>;
  }

  return (
    <main className="gc-module">
      <section className="mx-auto max-w-[1100px] space-y-4 p-4">
        <div>
          <nav className="text-sm" style={{ color: "var(--gc-muted)" }}>
            <Link href="/grandes-campanas" className="font-semibold hover:underline">← Grandes Campañas</Link>
          </nav>
          <h1 className="mt-1 text-2xl font-extrabold">Crear / Importar nueva campaña nacional</h1>
        </div>

        <CampanaForm value={form} onChange={setForm} clients={clients} gestores={gestores} delegaciones={delegaciones} session={session} />

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
          <Link href="/grandes-campanas" className="text-sm font-semibold hover:underline" style={{ color: "var(--gc-muted)" }}>Cancelar</Link>
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

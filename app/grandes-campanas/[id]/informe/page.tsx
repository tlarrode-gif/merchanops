"use client";

/**
 * Pantalla del informe de cliente (v11.3).
 *
 * Administración elige los bloques, ve la vista previa con las cifras reales y
 * emite. Emitir CONGELA esas cifras: el informe guardado no se recalcula nunca.
 *
 * DECISIONES DE PANTALLA
 *  - Los bloques internos se pintan aparte, con marca roja, y solo se pueden
 *    marcar si el informe se declara interno. Es el candado de v11_3 hecho
 *    visible: no se descubre al pulsar «Emitir», se ve al elegir.
 *  - «Guardar como plantilla» está al lado de la selección, no en otro sitio.
 *    Si configurar es fácil pero guardar es difícil, nadie guarda y el informe
 *    se reconfigura cada semana (que es lo que pasa hoy con PowerPoint).
 *  - Imprimir usa el navegador. Es lo que ya hace el resto del módulo (gc-no-print).
 */

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, FileText, Lock, Printer, Save, Send, Trash2 } from "lucide-react";

import { AppSession, canAccessModule, getCurrentAppSession, isAdminSession } from "@/lib/access-control";
import {
  BloqueCalculado,
  ClaveBloque,
  EntradaInforme,
  InformeEmitido,
  Plantilla,
  bloques as catalogoBloques,
  borrarPlantilla,
  calcularBloques,
  emitirInforme,
  fetchInformes,
  fetchPlantillas,
  guardarPlantilla,
  validarInforme
} from "@/lib/campana-informes";
import { fetchRegularizaciones, Regularizacion } from "@/lib/campana-regularizaciones";
import {
  Campana,
  CampanaKpis,
  IncidenciaCampana,
  PuntoVenta,
  fetchCampana,
  fetchCampanaKpis,
  fetchIncidencias,
  fetchPuntos,
  formatDate
} from "@/lib/campanas";

const bloquesPublicos = catalogoBloques.filter(bloque => !bloque.interno);
const bloquesInternosCatalogo = catalogoBloques.filter(bloque => bloque.interno);

export default function InformeCampanaPage({ params }: { params: { id: string } }) {
  const [session] = useState<AppSession | null>(() => (typeof window !== "undefined" ? getCurrentAppSession() : null));
  const [campana, setCampana] = useState<Campana | null>(null);
  const [kpis, setKpis] = useState<CampanaKpis | null>(null);
  const [puntos, setPuntos] = useState<PuntoVenta[]>([]);
  const [incidencias, setIncidencias] = useState<IncidenciaCampana[]>([]);
  const [regularizaciones, setRegularizaciones] = useState<Regularizacion[]>([]);
  const [plantillas, setPlantillas] = useState<Plantilla[]>([]);
  const [emitidos, setEmitidos] = useState<InformeEmitido[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const [seleccion, setSeleccion] = useState<ClaveBloque[]>(["avance_general", "avance_provincia", "incidencias_resumen"]);
  const [incluyeCostes, setIncluyeCostes] = useState(false);
  const [titulo, setTitulo] = useState("");
  const [encabezado, setEncabezado] = useState("");
  const [plantillaId, setPlantillaId] = useState("");

  const admin = isAdminSession(session);

  useEffect(() => {
    async function cargar() {
      const [campanaR, kpisR, puntosR, incidenciasR, regsR, plantillasR, informesR] = await Promise.all([
        fetchCampana(params.id),
        fetchCampanaKpis(params.id),
        fetchPuntos(params.id),
        fetchIncidencias(params.id),
        fetchRegularizaciones(params.id),
        fetchPlantillas(),
        fetchInformes(params.id)
      ]);
      setError(campanaR.error || puntosR.error || "");
      setCampana(campanaR.data);
      setKpis(kpisR.data);
      setPuntos(puntosR.data);
      setIncidencias(incidenciasR.data);
      setRegularizaciones(regsR.data);
      setPlantillas(plantillasR.data);
      setEmitidos(informesR.data);
      if (campanaR.data && !titulo) {
        setTitulo(`Informe de avance · ${campanaR.data.nombre}`);
      }
      setLoading(false);
    }
    cargar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.id]);

  const entrada: EntradaInforme | null = useMemo(
    () => (campana ? { campana, kpis, puntos, incidencias, regularizaciones } : null),
    [campana, kpis, puntos, incidencias, regularizaciones]
  );

  const previa: BloqueCalculado[] = useMemo(
    () => (entrada ? calcularBloques(seleccion, entrada) : []),
    [entrada, seleccion]
  );

  const motivoBloqueo = validarInforme(seleccion, incluyeCostes);

  function alternar(clave: ClaveBloque) {
    setSeleccion(actual => (actual.includes(clave) ? actual.filter(c => c !== clave) : [...actual, clave]));
  }

  function aplicarPlantilla(id: string) {
    setPlantillaId(id);
    const plantilla = plantillas.find(p => p.id === id);
    if (!plantilla) return;
    setSeleccion(plantilla.bloques);
    setIncluyeCostes(plantilla.incluye_costes);
    if (plantilla.encabezado) setEncabezado(plantilla.encabezado);
  }

  async function handleGuardarPlantilla() {
    const nombre = window.prompt("Nombre de la plantilla (para reutilizarla en futuros informes):", plantillas.find(p => p.id === plantillaId)?.nombre || `Informe ${campana?.cliente_marca || ""}`.trim());
    if (!nombre?.trim()) return;
    setSaving(true);
    setError("");
    const result = await guardarPlantilla(
      {
        nombre: nombre.trim(),
        cliente_marca: campana?.cliente_marca || null,
        bloques: seleccion,
        encabezado: encabezado || null,
        incluye_costes: incluyeCostes
      },
      session?.display_name || "Administración"
    );
    if (result.error) setError(result.error);
    else {
      setNotice("Plantilla guardada: la próxima vez es un clic.");
      const recargadas = await fetchPlantillas();
      setPlantillas(recargadas.data);
      if (result.data) setPlantillaId(result.data.id);
    }
    setSaving(false);
  }

  async function handleBorrarPlantilla() {
    if (!plantillaId) return;
    const plantilla = plantillas.find(p => p.id === plantillaId);
    if (!plantilla || !confirm(`¿Borrar la plantilla «${plantilla.nombre}»?`)) return;
    setSaving(true);
    const result = await borrarPlantilla(plantillaId);
    if (result.error) setError(result.error);
    else {
      setPlantillaId("");
      const recargadas = await fetchPlantillas();
      setPlantillas(recargadas.data);
      setNotice("Plantilla borrada.");
    }
    setSaving(false);
  }

  async function handleEmitir() {
    if (!entrada) return;
    setSaving(true);
    setError("");
    const result = await emitirInforme(entrada, {
      titulo,
      encabezado: encabezado || null,
      claves: seleccion,
      incluyeCostes,
      plantillaId: plantillaId || null,
      actor: session?.display_name || "Administración"
    });
    if (result.error) setError(result.error);
    else {
      setNotice("Informe emitido y congelado: estas cifras ya no cambian aunque cambie la campaña.");
      const recargados = await fetchInformes(params.id);
      setEmitidos(recargados.data);
    }
    setSaving(false);
  }

  if (!session?.active) return <Gate texto="Inicia sesión en MerchanOps para preparar informes." />;
  if (!canAccessModule(session, "servicios")) return <Gate texto="No tienes permiso para ver Grandes Campañas." />;
  if (!admin) return <Gate texto="El informe de cliente lo prepara administración." />;
  if (loading) return <main className="gc-module"><section className="mx-auto max-w-[1100px] space-y-3 p-4"><div className="gc-skeleton h-24" /><div className="gc-skeleton h-64" /></section></main>;

  return (
    <main className="gc-module">
      <section className="mx-auto max-w-[1100px] space-y-4 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2 gc-no-print">
          <Link href={`/grandes-campanas/${params.id}`} className="gc-btn-outline">
            <ArrowLeft className="h-4 w-4" /> Volver a la campaña
          </Link>
          <div className="flex gap-2">
            <button className="gc-btn-outline" onClick={() => window.print()}>
              <Printer className="h-4 w-4" /> Imprimir / PDF
            </button>
            <button className="gc-btn-outline" disabled={saving || Boolean(motivoBloqueo)} onClick={handleGuardarPlantilla}>
              <Save className="h-4 w-4" /> Guardar como plantilla
            </button>
            <button className="gc-btn-dark" disabled={saving || Boolean(motivoBloqueo)} onClick={handleEmitir}>
              <Send className="h-4 w-4" /> Emitir informe
            </button>
          </div>
        </div>

        {error && <div className="gc-note gc-alert-err gc-no-print">{error}</div>}
        {notice && <div className="gc-note gc-alert-ok gc-no-print">{notice}</div>}

        <div className="gc-form-section gc-no-print">
          <p className="gc-form-title">Qué lleva el informe</p>

          <div className="grid gap-2 sm:grid-cols-3">
            <label>
              <span className="gc-label">Plantilla</span>
              <select className="gc-select" value={plantillaId} onChange={e => aplicarPlantilla(e.target.value)}>
                <option value="">Sin plantilla (elijo a mano)</option>
                {plantillas.map(plantilla => (
                  <option key={plantilla.id} value={plantilla.id}>
                    {plantilla.nombre}{plantilla.cliente_marca ? ` · ${plantilla.cliente_marca}` : ""}
                  </option>
                ))}
              </select>
            </label>
            <label className="sm:col-span-2">
              <span className="gc-label">Título del informe</span>
              <input className="gc-input" value={titulo} onChange={e => setTitulo(e.target.value)} />
            </label>
            <label className="sm:col-span-3">
              <span className="gc-label">Texto de cabecera (opcional)</span>
              <textarea className="gc-textarea" rows={2} value={encabezado} onChange={e => setEncabezado(e.target.value)} placeholder="Saludo o nota fija que se repite en cada emisión." />
            </label>
          </div>

          {plantillaId && (
            <button className="mt-2 text-xs underline gc-alert-err" onClick={handleBorrarPlantilla}>
              <Trash2 className="mr-1 inline h-3 w-3" />Borrar esta plantilla
            </button>
          )}

          <p className="mt-4 text-xs font-bold uppercase" style={{ color: "var(--gc-muted)" }}>Bloques para el cliente</p>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            {bloquesPublicos.map(bloque => (
              <label key={bloque.clave} className="flex items-start gap-2 text-sm">
                <input type="checkbox" className="mt-1" checked={seleccion.includes(bloque.clave)} onChange={() => alternar(bloque.clave)} />
                <span>
                  <b>{bloque.etiqueta}</b>
                  <span className="block text-xs" style={{ color: "var(--gc-muted)" }}>{bloque.ayuda}</span>
                </span>
              </label>
            ))}
          </div>

          <div className="mt-4 border-t pt-3">
            <label className="flex items-center gap-2 text-sm font-semibold">
              <input type="checkbox" checked={incluyeCostes} onChange={e => {
                const marcado = e.target.checked;
                setIncluyeCostes(marcado);
                // Al desmarcar se quitan los internos: así el candado nunca sorprende al emitir.
                if (!marcado) setSeleccion(actual => actual.filter(clave => !bloquesInternosCatalogo.some(b => b.clave === clave)));
              }} />
              <Lock className="h-4 w-4" />
              Es un informe INTERNO (puede llevar costes y márgenes)
            </label>
            <p className="mt-1 text-xs" style={{ color: "var(--gc-muted)" }}>
              Sin marcar esto, un informe que lleve bloques de coste no se puede emitir. Lo impide también la base de datos.
            </p>

            <div className={`mt-2 grid gap-2 sm:grid-cols-2 ${incluyeCostes ? "" : "opacity-40"}`}>
              {bloquesInternosCatalogo.map(bloque => (
                <label key={bloque.clave} className="flex items-start gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="mt-1"
                    disabled={!incluyeCostes}
                    checked={seleccion.includes(bloque.clave)}
                    onChange={() => alternar(bloque.clave)}
                  />
                  <span>
                    <b style={{ color: "var(--gc-secondary)" }}>{bloque.etiqueta}</b>
                    <span className="block text-xs" style={{ color: "var(--gc-muted)" }}>{bloque.ayuda}</span>
                  </span>
                </label>
              ))}
            </div>
          </div>

          {motivoBloqueo && <p className="mt-3 text-sm gc-alert-err">{motivoBloqueo}</p>}
        </div>

        {/* ---------------- Vista previa: esto es lo que se imprime ------------- */}
        <article className="gc-card">
          <header className="mb-4 border-b pb-3">
            <p className="text-xs font-bold uppercase" style={{ color: "var(--gc-muted)" }}>
              {campana?.cliente_marca || "MerchanOps"}
            </p>
            <h1 className="text-2xl font-extrabold">{titulo || "Informe de avance"}</h1>
            <p className="text-sm" style={{ color: "var(--gc-muted)" }}>
              {campana?.nombre} · {formatDate(campana?.fecha_inicio)} — {formatDate(campana?.fecha_fin)}
            </p>
            {incluyeCostes && (
              <p className="mt-2 inline-flex items-center gap-1 gc-badge gc-badge-cancelada">
                <Lock className="h-3 w-3" /> Documento interno · no enviar al cliente
              </p>
            )}
          </header>

          {encabezado && <p className="mb-4 whitespace-pre-wrap text-sm">{encabezado}</p>}

          {!previa.length ? (
            <div className="gc-empty">Elige bloques arriba para ver aquí el informe.</div>
          ) : (
            <div className="space-y-5">
              {previa.map(bloque => <BloqueVista key={bloque.clave} bloque={bloque} />)}
            </div>
          )}
        </article>

        {emitidos.length > 0 && (
          <div className="gc-no-print">
            <p className="mb-2 text-xs font-bold uppercase" style={{ color: "var(--gc-muted)" }}>Informes ya emitidos</p>
            <div className="gc-table-wrap">
              <table className="gc-table">
                <thead><tr><th>Título</th><th>Emitido</th><th>Por</th><th>Tipo</th></tr></thead>
                <tbody>
                  {emitidos.map(informe => (
                    <tr key={informe.id}>
                      <td className="font-semibold"><FileText className="mr-1 inline h-4 w-4" />{informe.titulo}</td>
                      <td>{formatDate(informe.generado_at)}</td>
                      <td>{informe.generado_por_nombre || "—"}</td>
                      <td>{informe.incluye_costes ? "Interno" : "Cliente"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="gc-table-foot">
                <span>Cada informe guarda las cifras del día en que se emitió: no se recalculan al abrirlo.</span>
              </div>
            </div>
          </div>
        )}
      </section>
    </main>
  );
}

function BloqueVista({ bloque }: { bloque: BloqueCalculado }) {
  return (
    <section>
      <h2 className="mb-2 text-sm font-bold uppercase" style={{ color: bloque.interno ? "var(--gc-secondary)" : "var(--gc-muted)" }}>
        {bloque.etiqueta}{bloque.interno ? " · interno" : ""}
      </h2>

      {bloque.cifras && (
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {bloque.cifras.map(dato => (
            <div key={dato.etiqueta} className="gc-kpi">
              <p className="gc-kpi-label">{dato.etiqueta}</p>
              <p className="gc-kpi-value" style={{ fontSize: 22 }}>{dato.valor}</p>
            </div>
          ))}
        </div>
      )}

      {bloque.filas && bloque.columnas && (
        bloque.filas.length ? (
          <div className="gc-table-wrap">
            <table className="gc-table">
              <thead><tr>{bloque.columnas.map(columna => <th key={columna}>{columna}</th>)}</tr></thead>
              <tbody>
                {bloque.filas.map((fila, indice) => (
                  <tr key={indice}>
                    {bloque.columnas!.map(columna => <td key={columna}>{fila[columna] ?? "—"}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-sm" style={{ color: "var(--gc-muted)" }}>Sin datos todavía.</p>
        )
      )}
    </section>
  );
}

function Gate({ texto }: { texto: string }) {
  return (
    <main className="gc-module p-4">
      <section className="gc-empty mx-auto mt-10 max-w-2xl">{texto}</section>
    </main>
  );
}

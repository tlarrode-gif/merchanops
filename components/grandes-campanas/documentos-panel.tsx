"use client";

/**
 * Pestaña «Documentos» del detalle de campaña (v11.1).
 *
 * Dos listas separadas a propósito: los documentos de CAMPAÑA (briefing,
 * planograma, tarifas) y los de PUNTO. Con 300 puntos, una lista plana es
 * inservible.
 *
 * DECISIONES DE PANTALLA
 *  - «Subir versión nueva» está en cada documento, no escondido en un menú: es
 *    la operación que evita el desastre de sobreescribir el planograma bueno.
 *  - Las versiones anteriores se enseñan colapsadas bajo el documento vigente.
 *    No se ocultan: saber qué planograma estaba vigente en una fecha es
 *    justamente para lo que sirve el versionado.
 *  - La marca «Visible para el instalador» se ve y se cambia desde aquí aunque
 *    hoy no la consuma nadie: es lo que leerá MerchanGO. Se dice en la propia
 *    pantalla para que nadie piense que ya está enviando algo.
 *  - La descarga pide una URL firmada en el momento del clic. El bucket es
 *    privado y ninguna URL debe quedar guardada en el HTML.
 */

import { useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronRight, Download, FileText, Trash2, Upload } from "lucide-react";

import {
  DOC_ACCEPT_ATTR,
  Documento,
  MAX_DOC_MB,
  agruparDocumentos,
  categoriaLabels,
  categorias,
  CategoriaDocumento,
  formatearTamano,
  historialVersiones,
  puedeBorrar,
  urlDescarga,
  validarArchivo
} from "@/lib/campana-documentos";
import { AppSession } from "@/lib/access-control";
import { PuntoVenta, formatDate } from "@/lib/campanas";

type Props = {
  documentos: Documento[];
  puntos: PuntoVenta[];
  session: AppSession | null;
  cargando: boolean;
  saving: boolean;
  onSubir: (archivo: File, opciones: { nombre: string; categoria: CategoriaDocumento; descripcion: string | null; puntoId: string | null; visibleInstalador: boolean; sustituyeA: string | null }) => Promise<void>;
  onRetirar: (documento: Documento) => Promise<void>;
  onVisibilidad: (documento: Documento, visible: boolean) => Promise<void>;
};

const emptyForm = {
  nombre: "",
  categoria: "otro" as CategoriaDocumento,
  descripcion: "",
  puntoId: "",
  visibleInstalador: false
};

export function DocumentosPanel({ documentos, puntos, session, cargando, saving, onSubir, onRetirar, onVisibilidad }: Props) {
  const [form, setForm] = useState({ ...emptyForm });
  const [sustituyeA, setSustituyeA] = useState<Documento | null>(null);
  const [errorArchivo, setErrorArchivo] = useState("");
  const [abierto, setAbierto] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const agrupados = useMemo(() => agruparDocumentos(documentos), [documentos]);
  const nombrePunto = useMemo(() => new Map(puntos.map(punto => [punto.id, punto.nombre_comercial])), [puntos]);

  async function elegirArchivo(archivo: File | null | undefined) {
    if (!archivo) return;
    const motivo = validarArchivo(archivo);
    if (motivo) { setErrorArchivo(motivo); return; }
    setErrorArchivo("");
    await onSubir(archivo, {
      nombre: form.nombre.trim() || archivo.name,
      categoria: sustituyeA ? (sustituyeA.categoria as CategoriaDocumento) : form.categoria,
      descripcion: form.descripcion.trim() || null,
      puntoId: sustituyeA ? sustituyeA.punto_id || null : form.puntoId || null,
      visibleInstalador: sustituyeA ? sustituyeA.visible_instalador : form.visibleInstalador,
      sustituyeA: sustituyeA?.id || null
    });
    setForm({ ...emptyForm });
    setSustituyeA(null);
    if (inputRef.current) inputRef.current.value = "";
  }

  async function descargar(documento: Documento) {
    const result = await urlDescarga(documento.storage_path);
    if (result.error || !result.data) { setErrorArchivo(`No se pudo abrir el archivo: ${result.error || "sin enlace"}`); return; }
    window.open(result.data, "_blank", "noopener");
  }

  function Ficha({ documento }: { documento: Documento }) {
    const versiones = historialVersiones(documentos, documento.id);
    const anteriores = versiones.slice(1);
    const desplegado = abierto === documento.id;
    return (
      <div className="gc-worker-card">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="flex items-center gap-2 font-semibold">
              <FileText className="h-4 w-4 shrink-0" />
              <span className="truncate">{documento.nombre}</span>
              {documento.version > 1 && <span className="gc-pill">v{documento.version}</span>}
            </p>
            <p className="mt-1 text-xs" style={{ color: "var(--gc-muted)" }}>
              {categoriaLabels[documento.categoria] || documento.categoria} · {formatearTamano(documento.tamano_bytes)} ·
              {" "}subido por {documento.subido_por_nombre || "—"} el {formatDate(documento.created_at)}
            </p>
            {documento.descripcion && <p className="mt-1 text-sm">{documento.descripcion}</p>}
          </div>
          <div className="flex flex-wrap items-center gap-2 gc-no-print">
            <button className="gc-btn-outline" onClick={() => descargar(documento)} title="Abrir con un enlace temporal">
              <Download className="h-4 w-4" /> Abrir
            </button>
            <button
              className="gc-btn-outline"
              disabled={saving}
              onClick={() => { setSustituyeA(documento); inputRef.current?.click(); }}
              title="Sube un archivo nuevo: el actual pasa al histórico, no se pierde"
            >
              <Upload className="h-4 w-4" /> Subir versión nueva
            </button>
            {puedeBorrar(session, documento) && (
              <button className="gc-btn-outline gc-btn-danger" disabled={saving} onClick={() => onRetirar(documento)}>
                <Trash2 className="h-4 w-4" /> Retirar
              </button>
            )}
          </div>
        </div>

        <label className="mt-2 flex items-center gap-2 text-xs gc-no-print" title="Lo leerá MerchanGO cuando exista; hoy no se envía a nadie">
          <input
            type="checkbox"
            checked={documento.visible_instalador}
            disabled={saving}
            onChange={event => onVisibilidad(documento, event.target.checked)}
          />
          Visible para el instalador (preparado para MerchanGO)
        </label>

        {anteriores.length > 0 && (
          <div className="mt-2 border-t pt-2">
            <button className="flex items-center gap-1 text-xs font-semibold" style={{ color: "var(--gc-muted)" }} onClick={() => setAbierto(desplegado ? null : documento.id)}>
              {desplegado ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
              {anteriores.length} versión(es) anterior(es)
            </button>
            {desplegado && (
              <ul className="mt-1 space-y-1 text-xs">
                {anteriores.map(anterior => (
                  <li key={anterior.id} className="flex items-center justify-between gap-2">
                    <span style={{ color: "var(--gc-muted)" }}>
                      v{anterior.version} · {formatDate(anterior.created_at)} · {anterior.subido_por_nombre || "—"}
                    </span>
                    <button className="underline" onClick={() => descargar(anterior)}>Abrir</button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    );
  }

  if (cargando) return <div className="space-y-2"><div className="gc-skeleton h-24" /><div className="gc-skeleton h-40" /></div>;

  return (
    <div className="space-y-4">
      <div className="gc-form-section gc-no-print">
        <p className="gc-form-title">
          {sustituyeA ? `Nueva versión de «${sustituyeA.nombre}»` : "Subir documento"}
        </p>
        {sustituyeA ? (
          <p className="mb-2 text-sm">
            El documento actual pasará al histórico y esta será la versión vigente.{" "}
            <button className="underline" onClick={() => setSustituyeA(null)}>Cancelar y subir uno nuevo</button>
          </p>
        ) : (
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            <label>
              <span className="gc-label">Nombre</span>
              <input className="gc-input" placeholder="Se usa el del archivo si lo dejas vacío" value={form.nombre} onChange={e => setForm({ ...form, nombre: e.target.value })} />
            </label>
            <label>
              <span className="gc-label">Categoría</span>
              <select className="gc-select" value={form.categoria} onChange={e => setForm({ ...form, categoria: e.target.value as CategoriaDocumento })}>
                {categorias.map(categoria => <option key={categoria} value={categoria}>{categoriaLabels[categoria]}</option>)}
              </select>
            </label>
            <label>
              <span className="gc-label">¿De un punto concreto?</span>
              <select className="gc-select" value={form.puntoId} onChange={e => setForm({ ...form, puntoId: e.target.value })}>
                <option value="">Documento de toda la campaña</option>
                {puntos.map(punto => <option key={punto.id} value={punto.id}>{punto.nombre_comercial}</option>)}
              </select>
            </label>
            <label>
              <span className="gc-label">Descripción</span>
              <input className="gc-input" value={form.descripcion} onChange={e => setForm({ ...form, descripcion: e.target.value })} />
            </label>
          </div>
        )}

        <div className="mt-3 flex flex-wrap items-center gap-3">
          <button className="gc-btn-dark" disabled={saving} onClick={() => inputRef.current?.click()}>
            <Upload className="h-4 w-4" /> Elegir archivo
          </button>
          {!sustituyeA && (
            <label className="flex items-center gap-2 text-xs">
              <input type="checkbox" checked={form.visibleInstalador} onChange={e => setForm({ ...form, visibleInstalador: e.target.checked })} />
              Visible para el instalador
            </label>
          )}
          <span className="text-xs" style={{ color: "var(--gc-muted)" }}>
            PDF, imágenes, Excel/CSV, Word, PowerPoint o ZIP · hasta {MAX_DOC_MB} MB
          </span>
        </div>
        <input
          ref={inputRef}
          type="file"
          className="hidden"
          accept={DOC_ACCEPT_ATTR}
          onChange={event => elegirArchivo(event.target.files?.[0])}
        />
        {errorArchivo && <p className="mt-2 text-sm gc-alert-err">{errorArchivo}</p>}
      </div>

      <div>
        <p className="mb-2 text-xs font-bold uppercase" style={{ color: "var(--gc-muted)" }}>De la campaña</p>
        {agrupados.campana.length ? (
          <div className="grid gap-2 md:grid-cols-2">
            {agrupados.campana.map(documento => <Ficha key={documento.id} documento={documento} />)}
          </div>
        ) : (
          <div className="gc-empty">
            <b>Sin documentos de campaña.</b> Aquí van el briefing del cliente, el planograma y las
            instrucciones de montaje: lo que hoy viaja por WhatsApp y nadie sabe dónde está.
          </div>
        )}
      </div>

      {agrupados.porPunto.length > 0 && (
        <div>
          <p className="mb-2 text-xs font-bold uppercase" style={{ color: "var(--gc-muted)" }}>De puntos concretos</p>
          <div className="space-y-3">
            {agrupados.porPunto.map(grupo => (
              <div key={grupo.puntoId}>
                <p className="mb-1 text-sm font-semibold">{nombrePunto.get(grupo.puntoId) || "Punto"}</p>
                <div className="grid gap-2 md:grid-cols-2">
                  {grupo.documentos.map(documento => <Ficha key={documento.id} documento={documento} />)}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

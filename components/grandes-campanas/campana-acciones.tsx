"use client";

import { useEffect, useRef, useState } from "react";
import { Archive, ArchiveRestore, Copy, Eye, FileDown, MoreVertical, Pencil, Trash2, Users } from "lucide-react";
import { AppSession, canDeleteCampaigns, canManageCampaigns } from "@/lib/access-control";
import {
  CampanaImpacto,
  CampanaListadoRow,
  DuplicarOpciones,
  archiveCampana,
  dateOnly,
  deleteCampana,
  duplicateCampana,
  eur,
  fetchCampanaImpacto,
  restoreCampana
} from "@/lib/campanas";

type ModalAbierto = null | "duplicar" | "borrar";

export function CampanaAcciones({
  row,
  session,
  onExport,
  onDone,
  onError
}: {
  row: CampanaListadoRow;
  session: AppSession | null;
  onExport: (row: CampanaListadoRow) => void;
  onDone: (mensaje: string) => void;
  onError: (mensaje: string) => void;
}) {
  const [abierto, setAbierto] = useState(false);
  const [modal, setModal] = useState<ModalAbierto>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const gestiona = canManageCampaigns(session);
  const archivada = row.estado === "archivada";

  useEffect(() => {
    if (!abierto) return;
    const cerrar = (event: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(event.target as Node)) setAbierto(false);
    };
    document.addEventListener("mousedown", cerrar);
    return () => document.removeEventListener("mousedown", cerrar);
  }, [abierto]);

  async function archivar() {
    setAbierto(false);
    if (!confirm(`¿Archivar la campaña «${row.nombre}»? Dejará de aparecer en el listado por defecto, sin perder datos.`)) return;
    const result = await archiveCampana(row.id, session);
    if (result.error) onError(result.error);
    else onDone(`Campaña «${row.nombre}» archivada.`);
  }

  async function restaurar() {
    setAbierto(false);
    const result = await restoreCampana(row.id, session);
    if (result.error) onError(result.error);
    else onDone(`Campaña «${row.nombre}» restaurada (estado Pausada).`);
  }

  return (
    <div ref={wrapRef} className="gc-menu-wrap" onClick={event => event.stopPropagation()}>
      <button title="Acciones" className="rounded-lg border p-1.5 hover:bg-slate-50" style={{ borderColor: "var(--gc-border)" }} onClick={() => setAbierto(open => !open)}>
        <MoreVertical className="h-4 w-4" />
      </button>
      {abierto && (
        <div className="gc-menu">
          <a href={`/grandes-campanas/${row.id}`}><Eye className="h-4 w-4" />Ver detalle</a>
          <a href={`/grandes-campanas/${row.id}/asignacion`}><Users className="h-4 w-4" />Asignación rápida</a>
          <button onClick={() => { setAbierto(false); onExport(row); }}><FileDown className="h-4 w-4" />Exportar CSV</button>
          {gestiona && (
            <>
              <div className="gc-menu-sep" />
              <a href={`/grandes-campanas/${row.id}/editar`}><Pencil className="h-4 w-4" />Editar campaña</a>
              <button onClick={() => { setAbierto(false); setModal("duplicar"); }}><Copy className="h-4 w-4" />Duplicar…</button>
              {archivada
                ? <button onClick={restaurar}><ArchiveRestore className="h-4 w-4" />Restaurar</button>
                : <button onClick={archivar}><Archive className="h-4 w-4" />Archivar</button>}
              {canDeleteCampaigns(session) && (
                <button className="gc-menu-danger" onClick={() => { setAbierto(false); setModal("borrar"); }}><Trash2 className="h-4 w-4" />Borrar…</button>
              )}
            </>
          )}
        </div>
      )}
      {modal === "duplicar" && <DuplicarModal row={row} session={session} onClose={() => setModal(null)} onDone={onDone} onError={onError} />}
      {modal === "borrar" && <BorrarModal row={row} session={session} onClose={() => setModal(null)} onDone={onDone} onError={onError} onArchivar={archivar} />}
    </div>
  );
}

function DuplicarModal({
  row,
  session,
  onClose,
  onDone,
  onError
}: {
  row: CampanaListadoRow;
  session: AppSession | null;
  onClose: () => void;
  onDone: (mensaje: string) => void;
  onError: (mensaje: string) => void;
}) {
  const [opciones, setOpciones] = useState<DuplicarOpciones>({
    nombre: `Copia de ${row.nombre}`,
    cliente_marca: row.cliente_marca || null,
    fecha_inicio: "",
    fecha_fin: "",
    copiarPuntos: true,
    copiarEquipo: true,
    copiarAsignaciones: false,
    copiarImportes: true
  });
  const [guardando, setGuardando] = useState(false);
  const patch = (partial: Partial<DuplicarOpciones>) => setOpciones(previous => ({ ...previous, ...partial }));

  async function duplicar() {
    if (!opciones.nombre.trim()) return;
    setGuardando(true);
    const result = await duplicateCampana(row.id, opciones, session);
    setGuardando(false);
    if (result.error) { onError(result.error); if (!result.data) return; }
    if (result.data) {
      onDone(`Campaña duplicada como «${result.data.nombre}» (en borrador).`);
      window.location.href = `/grandes-campanas/${result.data.id}`;
    }
  }

  return (
    <div className="gc-modal-backdrop" onClick={onClose}>
      <div className="gc-modal" onClick={event => event.stopPropagation()}>
        <h3 className="gc-form-title">Duplicar «{row.nombre}»</h3>
        <div className="space-y-3">
          <label className="block">
            <span className="gc-label">Nombre de la nueva campaña <span className="gc-req">*</span></span>
            <input className="gc-input" value={opciones.nombre} onChange={event => patch({ nombre: event.target.value })} />
          </label>
          <label className="block">
            <span className="gc-label">Cliente/Marca</span>
            <input className="gc-input" value={opciones.cliente_marca || ""} onChange={event => patch({ cliente_marca: event.target.value || null })} />
          </label>
          <div className="grid gap-3 md:grid-cols-2">
            <label className="block">
              <span className="gc-label">Nueva fecha inicio</span>
              <input type="date" className="gc-input" value={opciones.fecha_inicio || ""} onChange={event => patch({ fecha_inicio: event.target.value || null })} />
            </label>
            <label className="block">
              <span className="gc-label">Nueva fecha fin</span>
              <input type="date" className="gc-input" value={opciones.fecha_fin || ""} onChange={event => patch({ fecha_fin: event.target.value || null })} />
            </label>
          </div>
          <div className="space-y-1 text-sm">
            <span className="gc-label">Qué se copia</span>
            <label className="flex items-center gap-2"><input type="checkbox" checked={opciones.copiarPuntos} onChange={event => patch({ copiarPuntos: event.target.checked })} />Puntos de venta ({Number(row.total_puntos).toLocaleString("es-ES")}) — se copian en estado «Pendiente», sin fecha de visita</label>
            <label className="flex items-center gap-2"><input type="checkbox" checked={opciones.copiarImportes} disabled={!opciones.copiarPuntos} onChange={event => patch({ copiarImportes: event.target.checked })} />Importes/tarifas por punto</label>
            <label className="flex items-center gap-2"><input type="checkbox" checked={opciones.copiarEquipo} onChange={event => patch({ copiarEquipo: event.target.checked })} />Equipo de gestores ({(row.gestores_nombres || []).length})</label>
            <label className="flex items-center gap-2"><input type="checkbox" checked={opciones.copiarAsignaciones} disabled={!opciones.copiarPuntos} onChange={event => patch({ copiarAsignaciones: event.target.checked })} />Asignaciones de puntos a gestores</label>
          </div>
          <p className="gc-note">Las incidencias, los avances y los pagos/facturación <b>nunca</b> se copian. La copia se crea en estado «Borrador».</p>
        </div>
        <footer className="mt-4 flex justify-end gap-2">
          <button className="gc-btn-outline" onClick={onClose}>Cancelar</button>
          <button className="gc-btn-dark" disabled={guardando || !opciones.nombre.trim()} onClick={duplicar}>{guardando ? "Duplicando..." : "Duplicar campaña"}</button>
        </footer>
      </div>
    </div>
  );
}

function BorrarModal({
  row,
  session,
  onClose,
  onDone,
  onError,
  onArchivar
}: {
  row: CampanaListadoRow;
  session: AppSession | null;
  onClose: () => void;
  onDone: (mensaje: string) => void;
  onError: (mensaje: string) => void;
  onArchivar: () => Promise<void>;
}) {
  const [impacto, setImpacto] = useState<CampanaImpacto | null>(null);
  const [confirmacion, setConfirmacion] = useState("");
  const [borrando, setBorrando] = useState(false);

  useEffect(() => {
    fetchCampanaImpacto(row.id).then(result => setImpacto(result.data));
  }, [row.id]);

  async function borrar() {
    setBorrando(true);
    const result = await deleteCampana(row.id, session);
    setBorrando(false);
    if (result.error) { onError(result.error); return; }
    onDone(`Campaña «${row.nombre}» borrada definitivamente.`);
    onClose();
  }

  const coincide = confirmacion.trim().toLowerCase() === row.nombre.trim().toLowerCase();

  return (
    <div className="gc-modal-backdrop" onClick={onClose}>
      <div className="gc-modal" onClick={event => event.stopPropagation()}>
        <h3 className="gc-form-title" style={{ color: "var(--gc-secondary)" }}>Borrar definitivamente «{row.nombre}»</h3>
        <div className="space-y-3 text-sm">
          <p>Esta acción <b>no se puede deshacer</b>. Se eliminará la campaña y todo su contenido:</p>
          {!impacto ? <div className="gc-skeleton h-16" /> : (
            <ul className="gc-impacto">
              <li><b>{impacto.puntos.toLocaleString("es-ES")}</b> puntos de venta (importe acumulado {eur(impacto.importe_total)})</li>
              <li><b>{impacto.incidencias}</b> incidencias registradas</li>
              <li><b>{impacto.gestores}</b> asignaciones de gestores</li>
            </ul>
          )}
          <p className="gc-note"><b>Recomendación:</b> si solo quieres retirarla del día a día, usa <b>Archivar</b>: conserva todos los datos y puede restaurarse.</p>
          <label className="block">
            <span className="gc-label">Escribe el nombre de la campaña para confirmar</span>
            <input className="gc-input" placeholder={row.nombre} value={confirmacion} onChange={event => setConfirmacion(event.target.value)} />
          </label>
        </div>
        <footer className="mt-4 flex flex-wrap justify-end gap-2">
          <button className="gc-btn-outline" onClick={onClose}>Cancelar</button>
          {row.estado !== "archivada" && <button className="gc-btn-outline" onClick={async () => { onClose(); await onArchivar(); }}><Archive className="h-4 w-4" />Archivar en su lugar</button>}
          <button className="gc-btn-dark gc-btn-danger-solid" disabled={!coincide || borrando} onClick={borrar}><Trash2 className="h-4 w-4" />{borrando ? "Borrando..." : "Borrar definitivamente"}</button>
        </footer>
      </div>
    </div>
  );
}

export function nombreArchivoCampana(row: Pick<CampanaListadoRow, "nombre">) {
  return `campana_${row.nombre.replace(/[^a-z0-9]+/gi, "_").toLowerCase()}_${dateOnly(new Date().toISOString())}.csv`;
}

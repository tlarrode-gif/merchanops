"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowRight, MapPin } from "lucide-react";
import { AppSession, canAccessModule, getCurrentAppSession, isAdminSession, sessionProvinceLabel } from "@/lib/access-control";
import { CampanaListadoRow, campanaEstadoLabels, fetchCampanasListado } from "@/lib/campanas";

// 4C: vista dedicada del gestor. Reúne las campañas con puntos en su ámbito
// provincial (el listado ya viene filtrado y con KPIs recalculados por sesión en
// lib/campanas.ts) y enlaza a la asignación por provincia de cada una.
export default function MiZonaPage() {
  const [session] = useState<AppSession | null>(() => (typeof window !== "undefined" ? getCurrentAppSession() : null));
  const [rows, setRows] = useState<CampanaListadoRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    fetchCampanasListado(getCurrentAppSession()).then(result => {
      if (alive) { setRows(result.data); setLoading(false); }
    });
    return () => { alive = false; };
  }, []);

  const admin = isAdminSession(session);
  const activas = useMemo(() => rows
    .filter(row => row.total_puntos > 0 && !["archivada", "cancelada", "completada"].includes(row.estado))
    .map(row => ({ ...row, sinAsignar: Math.max(0, row.total_puntos - row.asignados) }))
    .sort((a, b) => b.sinAsignar - a.sinAsignar), [rows]);
  const totalSinAsignar = useMemo(() => activas.reduce((sum, row) => sum + row.sinAsignar, 0), [activas]);

  if (!session?.active) {
    return <main className="gc-module p-4"><section className="gc-empty mx-auto mt-10 max-w-2xl"><b>Inicia sesión</b> en MerchanOps para ver tu zona.</section></main>;
  }
  if (!canAccessModule(session, "servicios")) {
    return <main className="gc-module p-4"><section className="gc-empty mx-auto mt-10 max-w-2xl">No tienes permiso para acceder a Grandes Campañas.</section></main>;
  }

  return (
    <main className="gc-module">
      <section className="mx-auto max-w-[1200px] space-y-4 p-4">
        <div>
          <h1 className="text-2xl font-extrabold"><MapPin className="mr-1 inline h-5 w-5" />Mi zona</h1>
          <p className="text-sm" style={{ color: "var(--gc-muted)" }}>
            {admin ? "Vista de gestor (como administrador ves todas las campañas). " : <>Ámbito: <b>{sessionProvinceLabel(session)}</b>. </>}
            Campañas con puntos en tu zona para asignar por provincia · <b>{totalSinAsignar.toLocaleString("es-ES")}</b> puntos sin asignar.
          </p>
        </div>

        {loading ? (
          <div className="gc-skeleton h-40" />
        ) : !activas.length ? (
          <div className="gc-empty"><b>No tienes campañas activas con puntos en tu zona.</b> Cuando el administrador te asigne a una campaña, aparecerá aquí.</div>
        ) : (
          <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
            {activas.map(row => (
              <div key={row.id} className="gc-card space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <h2 className="font-bold">{row.nombre}</h2>
                  <span className="gc-pill gc-pill-off">{campanaEstadoLabels[row.estado] || row.estado}</span>
                </div>
                {row.cliente_marca && <p className="text-xs" style={{ color: "var(--gc-muted)" }}>{row.cliente_marca}</p>}
                <div className="grid grid-cols-3 gap-2 text-center text-sm">
                  <div><p className="text-lg font-extrabold">{row.total_puntos.toLocaleString("es-ES")}</p><p className="text-xs" style={{ color: "var(--gc-muted)" }}>Mis puntos</p></div>
                  <div><p className="text-lg font-extrabold">{row.asignados.toLocaleString("es-ES")}</p><p className="text-xs" style={{ color: "var(--gc-muted)" }}>Asignados</p></div>
                  <div><p className="text-lg font-extrabold" style={{ color: row.sinAsignar ? "var(--gc-secondary)" : undefined }}>{row.sinAsignar.toLocaleString("es-ES")}</p><p className="text-xs" style={{ color: "var(--gc-muted)" }}>Sin asignar</p></div>
                </div>
                {row.incidencias_abiertas > 0 && <p className="text-xs" style={{ color: "var(--gc-secondary)" }}>{row.incidencias_abiertas} incidencias abiertas</p>}
                <a href={`/grandes-campanas/${row.id}/asignacion`} className="gc-btn-dark w-full justify-center">Asignar por provincia <ArrowRight className="h-4 w-4" /></a>
              </div>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}

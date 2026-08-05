"use client";

/**
 * Pestaña «Historial» del detalle de campaña (v11.0).
 *
 * Enseña la bitácora que escribe el trigger `merchan_gc_punto_auditoria`: quién
 * cambió qué, cuándo y por dónde entró el cambio. La pestaña existía en la
 * interfaz desde v7.0 diciendo «Próximamente»; esto es su contenido.
 *
 * DECISIONES DE PANTALLA
 *  - Se agrupa por día porque así es como se busca («qué pasó el martes»), no
 *    por punto.
 *  - Los cambios de importe, estado, fecha e instalador se destacan: son los que
 *    mueven dinero y son el motivo de que exista esta pantalla.
 *  - El filtro por «solo dinero» es lo primero que pide administración cuando
 *    una campaña tiene 4.000 líneas de bitácora.
 *  - Si la consulta llega al tope se DICE. Un historial truncado en silencio es
 *    peor que no tenerlo: parece completo y no lo está.
 */

import { useMemo, useState } from "react";
import { AlertTriangle, History, Search } from "lucide-react";

import {
  LIMITE_EVENTOS,
  PuntoEvento,
  agruparEventosPorDia,
  describirEvento,
  describirOrigen,
  esCampoSensible,
  horaEvento,
  resumirEventos
} from "@/lib/campana-auditoria";
import { formatDate } from "@/lib/campanas";
import { GestorAvatar } from "@/components/grandes-campanas/gestor-avatars";

type Props = {
  eventos: PuntoEvento[];
  cargando: boolean;
};

export function HistorialPanel({ eventos, cargando }: Props) {
  const [soloDinero, setSoloDinero] = useState(false);
  const [busqueda, setBusqueda] = useState("");

  const filtrados = useMemo(() => {
    const texto = busqueda.trim().toLowerCase();
    return eventos.filter(evento => {
      if (soloDinero && !esCampoSensible(evento.campo)) return false;
      if (!texto) return true;
      return [evento.punto_nombre, evento.actor_nombre, evento.valor_anterior, evento.valor_nuevo]
        .some(valor => String(valor || "").toLowerCase().includes(texto));
    });
  }, [eventos, soloDinero, busqueda]);

  const resumen = useMemo(() => resumirEventos(filtrados), [filtrados]);
  const dias = useMemo(() => agruparEventosPorDia(filtrados), [filtrados]);
  const truncado = eventos.length >= LIMITE_EVENTOS;

  if (cargando) {
    return <div className="space-y-2"><div className="gc-skeleton h-16" /><div className="gc-skeleton h-40" /></div>;
  }

  if (!eventos.length) {
    return (
      <div className="gc-empty">
        <b>Todavía no hay historial.</b> Aquí aparece cada cambio de importe, estado, fecha o instalador
        de los puntos de esta campaña, con su autor y por dónde entró. La bitácora empieza a registrar
        desde que se activó, así que los cambios anteriores no aparecen.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="grid gap-3 md:grid-cols-3">
        <div className="gc-kpi"><p className="gc-kpi-label">Cambios registrados</p><p className="gc-kpi-value">{resumen.total.toLocaleString("es-ES")}</p></div>
        <div className="gc-kpi"><p className="gc-kpi-label">Sobre dinero o plazo</p><p className="gc-kpi-value">{resumen.sensibles.toLocaleString("es-ES")}</p></div>
        <div className="gc-kpi">
          <p className="gc-kpi-label">Quién más ha tocado</p>
          <p className="gc-kpi-value" style={{ fontSize: 20 }}>{resumen.porActor[0]?.actor || "—"}</p>
        </div>
      </div>

      {truncado && (
        <div className="gc-note gc-alert-warn flex items-start gap-2">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>
            Se muestran los <b>{LIMITE_EVENTOS.toLocaleString("es-ES")}</b> cambios más recientes de la campaña.
            Hay más historial anterior que no cabe en esta pantalla.
          </span>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 gc-no-print">
        <div className="gc-search flex-1" style={{ minWidth: 220 }}>
          <Search className="h-4 w-4" />
          <input
            className="gc-input"
            placeholder="Buscar por punto, persona o valor…"
            value={busqueda}
            onChange={event => setBusqueda(event.target.value)}
          />
        </div>
        <button
          type="button"
          className={soloDinero ? "gc-btn-dark" : "gc-btn-outline"}
          onClick={() => setSoloDinero(valor => !valor)}
          title="Importe, estado, fecha de instalación e instalador"
        >
          Solo lo que mueve dinero
        </button>
      </div>

      {!filtrados.length ? (
        <div className="gc-empty">Ningún cambio coincide con ese filtro.</div>
      ) : (
        <div className="space-y-4">
          {dias.map(dia => (
            <div key={dia.dia}>
              <p className="mb-2 flex items-center gap-2 text-xs font-bold uppercase" style={{ color: "var(--gc-muted)" }}>
                <History className="h-4 w-4" />
                {formatDate(dia.dia)} · {dia.eventos.length} cambio(s)
              </p>
              <div className="gc-table-wrap">
                <table className="gc-table">
                  <thead>
                    <tr>
                      <th style={{ width: 64 }}>Hora</th>
                      <th style={{ width: 190 }}>Quién</th>
                      <th>Punto</th>
                      <th>Qué cambió</th>
                      <th style={{ width: 170 }}>Cómo</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dia.eventos.map(evento => (
                      <tr key={evento.id} className={esCampoSensible(evento.campo) ? "gc-row-incidencia" : ""}>
                        <td className="font-mono text-xs">{horaEvento(evento)}</td>
                        <td>
                          <span className="inline-flex items-center gap-2">
                            <GestorAvatar name={evento.actor_nombre} size={24} />
                            {evento.actor_nombre}
                          </span>
                        </td>
                        <td>{evento.punto_nombre || <span style={{ color: "var(--gc-muted)" }}>Punto borrado</span>}</td>
                        <td className={esCampoSensible(evento.campo) ? "font-semibold" : ""}>{describirEvento(evento)}</td>
                        <td className="text-xs" style={{ color: "var(--gc-muted)" }}>{describirOrigen(evento.origen)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

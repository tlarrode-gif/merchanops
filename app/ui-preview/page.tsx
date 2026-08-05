"use client";

/*
  Escaparate del sistema visual.

  Sirve para dos cosas: ver de un vistazo cómo se comporta cada pieza y tener
  dónde probar un cambio de token antes de soltarlo en las 24 pantallas reales.
  Se pinta con las piezas de verdad (components/ui/mo.tsx y las clases de
  mo-*.css), nunca con copias: si algo se ve raro aquí, se ve raro en la app.
*/

import { useState } from "react";
import { AlertTriangle, CheckCircle2, CreditCard, Package, Phone, Truck } from "lucide-react";
import {
  MoActionList, MoActionRow, MoAvatar, MoBadge, MoBars, MoCard, MoColumns, MoDonut,
  MoEmpty, MoKpi, MoKpiGrid, MoLegend, MoNotice, MoProgress, statusTone
} from "@/components/ui/mo";

const estados = [
  "Pendiente asignar", "Asignado", "Info enviada", "Material pendiente", "En ejecución",
  "Reportado", "Validado", "Incidencia", "Pagado", "Pospuesto", "Cancelado", "Fuera de plazo"
];

const paleta = [
  { nombre: "Tinta", valor: "#14141F", uso: "Texto, navegación y botón primario", token: "--mo-ink" },
  { nombre: "Burdeos", valor: "#8B1A2F", uso: "Riesgo: vencido, incidencia, importe negativo", token: "--mo-burgundy" },
  { nombre: "Coral", valor: "#E94560", uso: "Acento de marca: logo, foco, filete de KPI", token: "--mo-coral" },
  { nombre: "Oro", valor: "#B9AA83", uso: "Económico y pendiente de atención", token: "--mo-gold" },
  { nombre: "Verde", valor: "#15803D", uso: "Validado, instalado, conciliado", token: "--mo-green" },
  { nombre: "Lienzo", valor: "#F0F2F5", uso: "Fondo de la aplicación", token: "--mo-canvas" }
];

export default function UiPreviewPage() {
  const [chip, setChip] = useState("todo");

  return (
    <main className="min-h-screen p-4">
      <section className="mx-auto max-w-7xl space-y-4 p-4">
        <header>
          <h1 className="mo-page-title text-3xl font-bold">Sistema visual</h1>
          <p className="text-sm text-slate-500">
            Las piezas con las que está construida MerchanOps. Cambia un token en <code className="code-chip">app/mo-theme.css</code> y
            todo lo de esta página —y las 24 pantallas— cambia con él.
          </p>
        </header>

        {/* --- Tipografía y paleta --- */}
        <div className="grid gap-4 lg:grid-cols-2">
          <MoCard title="Tipografía" subtitle="Tres voces, cada una con su trabajo">
            <div className="space-y-3">
              <div>
                <span className="mo-eyebrow">Source Serif 4 · títulos y cifras</span>
                <p className="mo-figure" style={{ fontSize: "2rem" }}>18.412,50 €</p>
              </div>
              <div className="border-t pt-3">
                <span className="mo-eyebrow">DM Sans · interfaz, tablas y navegación</span>
                <p className="text-sm">Del importe validado a la remesa y al banco.</p>
              </div>
              <div className="border-t pt-3">
                <span className="mo-eyebrow">DM Mono · importes y datos tabulares</span>
                <p className="mo-mono text-sm">VIN-30418 · CECO 4412-BCN · 1.148,00 €</p>
              </div>
            </div>
          </MoCard>

          <MoCard title="Paleta" subtitle="Seis colores; ninguno decorativo">
            <ul className="space-y-2">
              {paleta.map(color => (
                <li key={color.nombre} className="flex items-center gap-3">
                  <span
                    className="h-7 w-7 shrink-0 rounded-lg"
                    style={{ background: color.valor, border: "1px solid var(--mo-border)" }}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium">{color.nombre}</span>
                    <span className="block text-xs text-slate-500">{color.uso}</span>
                  </span>
                  <span className="mo-mono shrink-0 text-xs text-slate-400">{color.valor}</span>
                </li>
              ))}
            </ul>
          </MoCard>
        </div>

        {/* --- KPIs --- */}
        <MoCard title="Tarjetas de KPI" subtitle="El filete de arriba dice de qué habla la cifra">
          <MoKpiGrid>
            <MoKpi label="Servicios activos" value="67" hint="9 en total" accent="ink" icon={CheckCircle2} />
            <MoKpi label="Fuera de plazo" value="3" hint="requieren aviso hoy" accent="risk" icon={AlertTriangle} />
            <MoKpi label="Cumplimiento" value="91%" hint="61 de 67 a tiempo" accent="ok" icon={CheckCircle2} />
            <MoKpi label="Total validado" value="18.412 €" hint="julio a cierre" accent="gold" icon={CreditCard} />
            <MoKpi label="Vinilos semana" value="96" hint="72 instalados" icon={Package} />
          </MoKpiGrid>
        </MoCard>

        {/* --- Estados --- */}
        <MoCard
          title="Píldoras de estado"
          subtitle="El tono lo decide statusTone() a partir del texto, no una lista cerrada: un estado nuevo en la base no se queda sin color"
        >
          <div className="flex flex-wrap gap-2">
            {estados.map(estado => <MoBadge key={estado} status={estado} />)}
          </div>
          <p className="mt-3 text-xs text-slate-500">
            Ejemplo: <code className="code-chip">statusTone(&quot;Reportado&quot;)</code> → <b>{statusTone("Reportado")}</b>
          </p>
        </MoCard>

        {/* --- Chips y controles --- */}
        <div className="grid gap-4 lg:grid-cols-2">
          <MoCard title="Chips de filtro" subtitle="El contador dice si merece la pena pulsar">
            <div className="mo-chips">
              {[["todo", "Todo", 17], ["incidencias", "Incidencias", 7], ["sin-asignar", "Sin asignar", 4], ["pagos", "Pagos", 6]].map(([id, label, count]) => (
                <button
                  key={String(id)}
                  onClick={() => setChip(String(id))}
                  aria-pressed={chip === id}
                  className={chip === id ? "bg-slate-900" : ""}
                >
                  {label}<span className="mo-chip-count">{count}</span>
                </button>
              ))}
            </div>
            <div className="mt-4 grid gap-3 md:grid-cols-2">
              <label className="block text-sm"><span>Instalador</span>
                <select className="w-full rounded-2xl border px-3 py-2" defaultValue="">
                  <option value="">Todos</option><option>Sara Villalba</option>
                </select>
              </label>
              <label className="block text-sm"><span>Buscar</span>
                <input className="w-full rounded-2xl border px-3 py-2" placeholder="Campaña, punto, CECO…" />
              </label>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <button className="rounded-2xl bg-slate-900 px-4 py-2 text-sm text-white">Acción principal</button>
              <button className="rounded-2xl border bg-white px-4 py-2 text-sm">Secundaria</button>
              <button className="rounded-2xl border bg-white px-4 py-2 text-sm text-red-600">Destructiva</button>
              <button disabled className="rounded-2xl bg-slate-900 px-4 py-2 text-sm text-white">Desactivada</button>
            </div>
          </MoCard>

          <MoCard title="Avisos y estado vacío" subtitle="Cómo se dice «ojo» y cómo se dice «aquí no hay nada»">
            <div className="space-y-2">
              <MoNotice icon={Truck}><b>Solo consulta.</b> Las acciones se realizan en MerchanLOGS.</MoNotice>
              <MoNotice tone="risk" icon={AlertTriangle}><b>3 líneas sin conciliar.</b> Revisa antes del cierre del 31/07.</MoNotice>
              <MoNotice tone="ok" icon={CheckCircle2}>Remesa emitida el 20/07.</MoNotice>
            </div>
            <div className="mt-3 border-t">
              <MoEmpty title="Nada pendiente por aquí" hint="No hay incidencias ni demoras en tu ámbito." />
            </div>
          </MoCard>
        </div>

        {/* --- Gráficos --- */}
        <div className="grid gap-4 lg:grid-cols-3">
          <MoCard title="Dónut" subtitle="Cumplimiento del mes">
            <div className="flex items-center gap-4">
              <MoDonut
                size={112}
                centerValue="91%"
                centerLabel="a tiempo"
                segments={[
                  { label: "A tiempo", value: 61, color: "var(--mo-green)" },
                  { label: "Con retraso", value: 3, color: "var(--mo-burgundy)" },
                  { label: "En curso", value: 3, color: "var(--mo-surface-sunken)" }
                ]}
              />
              <MoLegend items={[
                { label: "Cerrados a tiempo", value: 61, color: "var(--mo-green)" },
                { label: "Cerrados con retraso", value: 3, color: "var(--mo-burgundy)" },
                { label: "En curso", value: 3, color: "#c9ced6" }
              ]} />
            </div>
          </MoCard>

          <MoCard title="Barras verticales" subtitle="Validado por semana">
            <MoColumns
              height={92}
              formatValue={v => `${Math.round(v / 100) / 10}k`}
              data={[
                { label: "S25", value: 12400 }, { label: "S26", value: 15100 }, { label: "S27", value: 13800 },
                { label: "S28", value: 16200 }, { label: "S29", value: 14900 }, { label: "S30", value: 18412 }
              ]}
            />
          </MoCard>

          <MoCard title="Barras horizontales" subtitle="Avance por provincia">
            <MoBars
              formatValue={(value, total) => `${value}/${total}`}
              data={[
                { label: "Barcelona", value: 38, total: 42, tone: "ok" },
                { label: "Madrid", value: 15, total: 21, tone: "ink" },
                { label: "Girona", value: 5, total: 11, tone: "risk" },
                { label: "Asturias", value: 2, total: 8, tone: "risk" }
              ]}
            />
          </MoCard>
        </div>

        {/* --- Bandeja de acciones --- */}
        <MoCard
          title="Bandeja de acciones"
          subtitle="La pieza del Panel: qué pasa, cuánto vale y dónde se resuelve"
          actions={<MoBadge tone="risk">4 abiertas</MoBadge>}
          bodyClassName="mo-card__body--flush"
        >
          <MoActionList>
            <MoActionRow tone="risk" title="Farmacia Sant Gervasi · vinilo bloqueado" badge={<MoBadge tone="risk">Incidencia</MoBadge>}
              meta="ISDIN Verano · Barcelona · 6 días abierta" amount="8,56 €" action={<a href="#preview">Resolver →</a>} />
            <MoActionRow tone="warn" title="Uriage · Lineal verano sin asignar" badge={<MoBadge tone="warn">Sin instalador</MoBadge>}
              meta="Madrid · 10 puntos · límite 20/07 (vencido)" amount="264,00 €" action={<a href="#preview">Asignar →</a>} />
            <MoActionRow tone="info" title="ISDIN Semana 29 · 14 puntos reportados sin validar" badge={<MoBadge tone="info">Por validar</MoBadge>}
              meta="Barcelona, Girona · reportados hace 4 días" amount="1.148,00 €" action={<a href="#preview">Validar →</a>} />
            <MoActionRow tone="gold" title="Remesa julio pendiente de conciliar" badge={<MoBadge tone="gold">Pagos</MoBadge>}
              meta="3 líneas · diferencia con extracto bancario" amount="412,80 €" action={<a href="#preview">Conciliar →</a>} />
          </MoActionList>
        </MoCard>

        {/* --- Tabla --- */}
        <MoCard title="Tabla" subtitle="Cabecera en etiqueta diminuta, importes en mono, fila de riesgo en burdeos" bodyClassName="mo-card__body--flush">
          <div className="overflow-auto">
            <table className="w-full text-sm">
              <thead>
                <tr>
                  <th className="text-left">Campaña</th>
                  <th className="text-left">Instalador</th>
                  <th className="text-left">Estado</th>
                  <th className="text-left">Avance</th>
                  <th className="text-right">Total</th>
                </tr>
              </thead>
              <tbody>
                {[
                  { campana: "ISDIN · Semana 30 Vinilos", ceco: "4412-BCN", quien: "Sara Villalba", estado: "En ejecución", avance: 62, total: "342,00 €", riesgo: false },
                  { campana: "Cinfa · Reposición julio", ceco: "3180-AST", quien: "Nico Prats", estado: "Incidencia", avance: 45, total: "176,00 €", riesgo: true },
                  { campana: "Uriage · Lineal verano", ceco: "2298-MAD", quien: "Sin asignar", estado: "Pendiente asignar", avance: 0, total: "264,00 €", riesgo: false },
                  { campana: "ISDIN · Semana 29 Vinilos", ceco: "4411-BCN", quien: "Sara Villalba", estado: "Validado", avance: 100, total: "1.148,00 €", riesgo: false }
                ].map(row => (
                  <tr key={row.ceco} className={row.riesgo ? "mo-row-risk" : undefined}>
                    <td>
                      <span className="block font-medium">{row.campana}</span>
                      <span className="mo-mono block text-xs text-slate-400">CECO {row.ceco}</span>
                    </td>
                    <td>
                      <span className="flex items-center gap-2">
                        <MoAvatar name={row.quien} size={24} />
                        <span>{row.quien}</span>
                      </span>
                    </td>
                    <td><MoBadge status={row.estado} /></td>
                    <td style={{ minWidth: 120 }}>
                      <MoProgress value={row.avance} tone={row.riesgo ? "risk" : row.avance === 100 ? "ok" : "ink"} />
                    </td>
                    <td className="text-right">{row.total}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </MoCard>

        <MoCard title="Avatares" subtitle="Color estable por nombre: la misma persona sale siempre igual">
          <span className="mo-avatar-stack">
            {["Sara Villalba", "María Otero", "Nico Prats", "Jorge Alcaraz", "Elena Ruiz", "Iván Cortés"].map(name => (
              <MoAvatar key={name} name={name} size={30} />
            ))}
          </span>
          <p className="mt-3 flex items-center gap-2 text-sm text-slate-500">
            <Phone className="h-4 w-4" /> También se usan en llamadas, calendario y asignación.
          </p>
        </MoCard>
      </section>
    </main>
  );
}

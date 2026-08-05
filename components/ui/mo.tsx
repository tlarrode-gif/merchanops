import type { ReactNode } from "react";
import Link from "next/link";

/**
 * Piezas del sistema visual de MerchanOps.
 *
 * Solo lo que hace falta escribir en JSX: lo que se puede resolver reescribiendo
 * las clases que ya existen en el marcado vive en app/mo-surfaces.css, para no
 * tener que tocar 40 pantallas. Aquí están las piezas NUEVAS —tarjeta de KPI,
 * píldora de estado, bandeja de acciones, gráficos— que el rediseño introduce.
 *
 * Todas son de presentación: ninguna decide qué se puede hacer ni oculta
 * acciones. Los permisos siguen resolviéndose donde siempre, en cada pantalla.
 */

export type MoTone = "neutral" | "risk" | "warn" | "ok" | "info" | "gold" | "ink";

/* ---------------------------------------------------------------------- */
/* Estados                                                                 */
/* ---------------------------------------------------------------------- */

/**
 * Traduce el vocabulario de estados de la app al tono del sistema visual.
 * Es tolerante a propósito: compara en minúsculas y sin tildes y cae a
 * "neutral" ante cualquier estado que no conozca, porque los estados nacen en
 * la base de datos y esta tabla no puede ser una lista cerrada.
 */
export function statusTone(status?: string | null): MoTone {
  const key = String(status || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
  if (!key) return "neutral";

  if (/(incidencia|vencid|bloquead|error|denegad|rechazad|fallid|dead_letter|anulad|sin conciliar|fuera de plazo)/.test(key)) return "risk";
  if (/(validad|finalizad|instalad|resuelt|completad|pagad|facturad|concedid|entregad|activa|ok|tramitad|cerrad)/.test(key)) return "ok";
  if (/(pendiente|pospuesto|espera|revision|solape|material|preparacion|en gestion|parcial|pausad)/.test(key)) return "warn";
  if (/(asignad|ejecucion|reportad|enviad|curso|planificad|nuevo|solicitad|borrador|procesando)/.test(key)) return "info";
  if (/(cancelad|archivad|consumid)/.test(key)) return "neutral";
  return "neutral";
}

export function MoBadge({ children, tone, status, className = "" }: { children?: ReactNode; tone?: MoTone; status?: string | null; className?: string }) {
  const resolved = tone || statusTone(status);
  return <span className={`mo-badge mo-badge--${resolved} ${className}`.trim()}>{children ?? status}</span>;
}

/* ---------------------------------------------------------------------- */
/* Tarjetas                                                                */
/* ---------------------------------------------------------------------- */

export function MoCard({
  title, subtitle, actions, children, className = "", bodyClassName = ""
}: {
  title?: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <section className={`mo-card ${className}`.trim()}>
      {(title || actions) && (
        <header className="mo-card__head">
          <div className="min-w-0">
            {title && <h2 className="mo-card__title">{title}</h2>}
            {subtitle && <p className="mo-card__subtitle">{subtitle}</p>}
          </div>
          {actions && <div className="mo-card__actions">{actions}</div>}
        </header>
      )}
      <div className={`mo-card__body ${bodyClassName}`.trim()}>{children}</div>
    </section>
  );
}

/* ---------------------------------------------------------------------- */
/* KPIs                                                                    */
/* ---------------------------------------------------------------------- */

type KpiAccent = "coral" | "risk" | "ok" | "gold" | "ink";

export function MoKpiGrid({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`mo-kpi-row ${className}`.trim()}>{children}</div>;
}

export function MoKpi({
  label, value, hint, accent = "coral", icon: Icon, href, onClick
}: {
  label: ReactNode;
  value: ReactNode;
  hint?: ReactNode;
  accent?: KpiAccent;
  icon?: React.ComponentType<{ className?: string }>;
  href?: string;
  onClick?: () => void;
}) {
  const accentClass = accent === "coral" ? "" : ` mo-kpi--${accent}`;
  const body = (
    <>
      <span className="mo-kpi__label">
        {Icon && <Icon className="mo-kpi__icon" />}
        {label}
      </span>
      <span className="mo-kpi__value">{value}</span>
      {hint && <span className="mo-kpi__hint">{hint}</span>}
    </>
  );
  // Con next/link, no con <a>: un KPI enlazado navega en cliente como el resto
  // de la app. Con <a> cada clic recargaría la página entera.
  if (href) return <Link className={`mo-kpi${accentClass}`} href={href}>{body}</Link>;
  if (onClick) return <button type="button" className={`mo-kpi${accentClass}`} onClick={onClick}>{body}</button>;
  return <div className={`mo-kpi${accentClass}`}>{body}</div>;
}

/* ---------------------------------------------------------------------- */
/* Avisos y vacíos                                                         */
/* ---------------------------------------------------------------------- */

export function MoNotice({ tone = "gold", icon: Icon, children }: { tone?: "gold" | "risk" | "info" | "ok"; icon?: React.ComponentType<{ className?: string }>; children: ReactNode }) {
  return (
    <div className={`mo-notice${tone === "gold" ? "" : ` mo-notice--${tone}`}`}>
      {Icon && <Icon className="mo-notice__icon" />}
      <div className="min-w-0">{children}</div>
    </div>
  );
}

export function MoEmpty({ title, hint, action }: { title: string; hint?: string; action?: ReactNode }) {
  return (
    <div className="mo-empty">
      <p className="mo-empty__title">{title}</p>
      {hint && <p className="mo-empty__hint">{hint}</p>}
      {action}
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/* Avatar                                                                  */
/* ---------------------------------------------------------------------- */

/** Color estable a partir del nombre: la misma persona sale siempre igual. */
const avatarColors = ["#8b1a2f", "#1f6f8b", "#7a6c45", "#2f5d3a", "#4b3a6b", "#8a4b1f"];

export function MoAvatar({ name, size = 26 }: { name?: string | null; size?: number }) {
  const clean = String(name || "").trim();
  const parts = clean.split(/\s+/).filter(Boolean);
  const text = parts.length ? (parts[0][0] + (parts[1]?.[0] || "")).toUpperCase() : "··";
  let hash = 0;
  for (let i = 0; i < clean.length; i += 1) hash = (hash * 31 + clean.charCodeAt(i)) % 997;
  return (
    <span
      className="mo-avatar"
      title={clean || undefined}
      style={{ width: size, height: size, background: avatarColors[hash % avatarColors.length], fontSize: Math.round(size * 0.38) }}
    >
      {text}
    </span>
  );
}

/* ---------------------------------------------------------------------- */
/* Progreso                                                                */
/* ---------------------------------------------------------------------- */

export function MoProgress({ value, max = 100, tone = "ink", label }: { value: number; max?: number; tone?: MoTone; label?: ReactNode }) {
  const safeMax = max > 0 ? max : 1;
  const pct = Math.max(0, Math.min(100, (value / safeMax) * 100));
  return (
    <div className="mo-progress-wrap">
      {label && <div className="mo-progress-label">{label}</div>}
      <div className="mo-progress" role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}>
        <div className={`mo-progress__fill mo-progress__fill--${tone}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/* Gráficos                                                                */
/* ---------------------------------------------------------------------- */

/**
 * Dónut de cumplimiento. SVG puro: el proyecto no tiene librería de gráficos y
 * meter una por un anillo y unas barras no se sostiene.
 */
export function MoDonut({
  segments, centerValue, centerLabel, size = 116
}: {
  segments: Array<{ label: string; value: number; color: string }>;
  centerValue: ReactNode;
  centerLabel?: string;
  size?: number;
}) {
  const total = segments.reduce((sum, s) => sum + Math.max(0, s.value), 0);
  const stroke = 13;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  let offset = 0;

  return (
    <div className="mo-donut">
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={centerLabel || "Distribución"}>
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke="var(--mo-surface-sunken)" strokeWidth={stroke} />
        {total > 0 && segments.map(segment => {
          const portion = Math.max(0, segment.value) / total;
          const dash = portion * circumference;
          const element = (
            <circle
              key={segment.label}
              cx={size / 2}
              cy={size / 2}
              r={radius}
              fill="none"
              stroke={segment.color}
              strokeWidth={stroke}
              strokeDasharray={`${dash} ${circumference - dash}`}
              strokeDashoffset={-offset}
              transform={`rotate(-90 ${size / 2} ${size / 2})`}
            />
          );
          offset += dash;
          return element;
        })}
      </svg>
      <div className="mo-donut__center">
        <span className="mo-donut__value">{centerValue}</span>
        {centerLabel && <span className="mo-donut__label">{centerLabel}</span>}
      </div>
    </div>
  );
}

/** Leyenda del dónut: etiqueta a la izquierda, cifra a la derecha. */
export function MoLegend({ items }: { items: Array<{ label: string; value: ReactNode; color: string }> }) {
  return (
    <ul className="mo-legend">
      {items.map(item => (
        <li key={item.label}>
          <span className="mo-legend__dot" style={{ background: item.color }} />
          <span className="mo-legend__label">{item.label}</span>
          <span className="mo-legend__value">{item.value}</span>
        </li>
      ))}
    </ul>
  );
}

/**
 * Barras verticales (el «Validado por semana» del mockup). La última barra se
 * destaca porque es la semana en curso, que es la que se mira.
 */
export function MoColumns({
  data, highlightLast = true, height = 108, formatValue
}: {
  data: Array<{ label: string; value: number; caption?: string }>;
  highlightLast?: boolean;
  height?: number;
  formatValue?: (value: number) => string;
}) {
  const max = Math.max(1, ...data.map(d => Number(d.value) || 0));
  return (
    <div className="mo-columns" style={{ ["--mo-columns-h" as string]: `${height}px` }}>
      {data.map((entry, index) => {
        const value = Number(entry.value) || 0;
        const isLast = highlightLast && index === data.length - 1;
        return (
          <div key={`${entry.label}-${index}`} className="mo-columns__item">
            <span className="mo-columns__value">{formatValue ? formatValue(value) : value}</span>
            <div className="mo-columns__track">
              <div
                className={`mo-columns__bar ${isLast ? "mo-columns__bar--current" : ""}`}
                style={{ height: `${Math.max(2, (value / max) * 100)}%` }}
                title={`${entry.label}: ${formatValue ? formatValue(value) : value}`}
              />
            </div>
            <span className="mo-columns__label">{entry.label}</span>
            {entry.caption && <span className="mo-columns__caption">{entry.caption}</span>}
          </div>
        );
      })}
    </div>
  );
}

/** Barras horizontales con etiqueta y cifra (avance por provincia, embudo). */
export function MoBars({
  data, formatValue
}: {
  data: Array<{ label: string; value: number; total?: number; tone?: MoTone; caption?: string }>;
  formatValue?: (value: number, total?: number) => ReactNode;
}) {
  const max = Math.max(1, ...data.map(d => (d.total ?? Math.max(...data.map(x => x.value), 1))));
  return (
    <ul className="mo-bars">
      {data.map(entry => {
        const total = entry.total ?? max;
        const pct = total > 0 ? Math.min(100, (entry.value / total) * 100) : 0;
        return (
          <li key={entry.label}>
            <div className="mo-bars__head">
              <span className="mo-bars__label">{entry.label}</span>
              <span className="mo-bars__value">{formatValue ? formatValue(entry.value, entry.total) : `${entry.value}`}</span>
            </div>
            <div className="mo-progress">
              <div className={`mo-progress__fill mo-progress__fill--${entry.tone || "ink"}`} style={{ width: `${pct}%` }} />
            </div>
            {entry.caption && <span className="mo-bars__caption">{entry.caption}</span>}
          </li>
        );
      })}
    </ul>
  );
}

/* ---------------------------------------------------------------------- */
/* Bandeja de acciones                                                     */
/* ---------------------------------------------------------------------- */

/**
 * Una fila de «Requiere tu acción hoy»: título, estado, contexto, importe y el
 * botón que lleva a resolverlo. El botón lo pasa quien la usa, así que esta
 * pieza nunca decide qué acción hay disponible.
 */
export function MoActionRow({
  tone = "neutral", title, badge, meta, amount, action
}: {
  tone?: MoTone;
  title: ReactNode;
  badge?: ReactNode;
  meta?: ReactNode;
  amount?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <li className={`mo-action mo-action--${tone}`}>
      <div className="mo-action__text">
        <div className="mo-action__title">
          <span className="mo-action__name">{title}</span>
          {badge}
        </div>
        {meta && <p className="mo-action__meta">{meta}</p>}
      </div>
      {amount !== undefined && amount !== null && <span className="mo-action__amount">{amount}</span>}
      {action && <div className="mo-action__cta">{action}</div>}
    </li>
  );
}

export function MoActionList({ children }: { children: ReactNode }) {
  return <ul className="mo-action-list">{children}</ul>;
}

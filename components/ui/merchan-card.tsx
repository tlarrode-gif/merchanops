import type { ReactNode } from "react";

type CardProps = {
  children: ReactNode;
  accent?: string;
  className?: string;
};

export function MerchanCard({ children, accent, className = "" }: CardProps) {
  if (accent) {
    return (
      <div className={`overflow-hidden rounded-2xl border border-slate-200/70 bg-white shadow-sm ${className}`} style={{ borderLeft: `3px solid ${accent}` }}>
        <div className="p-5">{children}</div>
      </div>
    );
  }

  return <div className={`rounded-2xl border border-slate-200/70 bg-white p-5 shadow-sm ${className}`}>{children}</div>;
}

type KpiProps = {
  label: string;
  value: ReactNode;
  icon?: React.ComponentType<{ className?: string }>;
  colorClass?: "blue" | "red" | "green" | "violet" | "amber" | "slate" | string;
};

const colorMap: Record<string, string> = {
  blue: "bg-blue-50 text-blue-600",
  red: "bg-red-50 text-red-600",
  green: "bg-green-50 text-green-600",
  violet: "bg-violet-50 text-violet-600",
  amber: "bg-amber-50 text-amber-600",
  slate: "bg-slate-100 text-slate-600"
};

export function MerchanKpi({ label, value, icon: Icon, colorClass = "slate" }: KpiProps) {
  return (
    <div className="rounded-2xl border border-slate-200/70 bg-white p-5 shadow-sm">
      <div className="mb-4 flex items-center justify-between">
        {Icon ? (
          <div className={`grid h-8 w-8 place-items-center rounded-lg ${colorMap[colorClass] || colorMap.slate}`}>
            <Icon className="h-4 w-4" />
          </div>
        ) : <span />}
      </div>
      <p className="text-[11px] font-normal uppercase tracking-[0.5px] text-slate-500">{label}</p>
      <p className="mt-1 text-[22px] font-semibold tracking-[-0.5px] text-slate-900">{value}</p>
    </div>
  );
}

type MiniProps = {
  label: string;
  value: ReactNode;
  mono?: boolean;
};

export function MerchanMini({ label, value, mono = false }: MiniProps) {
  return (
    <div className="rounded-xl bg-slate-50 p-2">
      <p className="text-[10px] font-medium uppercase tracking-wide text-slate-500">{label}</p>
      <b className={`text-sm font-semibold text-slate-900 ${mono ? "font-mono" : ""}`}>{value}</b>
    </div>
  );
}

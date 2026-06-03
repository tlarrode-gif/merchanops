import type { ChangeEventHandler, ReactNode } from "react";

type InputProps = {
  label: string;
  value?: string | number | null;
  onChange: (value: string) => void;
  type?: string;
  placeholder?: string;
};

export function MerchanInput({ label, value, onChange, type = "text", placeholder }: InputProps) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium tracking-wide text-slate-600">{label}</span>
      <input
        type={type}
        value={value ?? ""}
        placeholder={placeholder}
        onChange={e => onChange(e.target.value)}
        className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 transition-all focus:border-slate-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-slate-900/10"
      />
    </label>
  );
}

type TextareaProps = {
  label: string;
  value?: string | null;
  onChange: (value: string) => void;
  rows?: number;
};

export function MerchanTextarea({ label, value, onChange, rows = 5 }: TextareaProps) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium tracking-wide text-slate-600">{label}</span>
      <textarea
        value={value ?? ""}
        rows={rows}
        onChange={e => onChange(e.target.value)}
        className="w-full resize-none rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 transition-all focus:border-slate-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-slate-900/10"
      />
    </label>
  );
}

type SelectProps = {
  label: string;
  value?: string | null;
  onChange: (value: string) => void;
  options: string[];
  labels?: Record<string, ReactNode>;
};

export function MerchanSelect({ label, value, onChange, options, labels = {} }: SelectProps) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium tracking-wide text-slate-600">{label}</span>
      <span className="relative block">
        <select
          value={value ?? ""}
          onChange={e => onChange(e.target.value)}
          className="w-full appearance-none rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 pr-9 text-sm text-slate-900 placeholder:text-slate-400 transition-all focus:border-slate-400 focus:bg-white focus:outline-none focus:ring-2 focus:ring-slate-900/10"
        >
          {options.map(o => <option key={o} value={o}>{labels[o] || o || "Seleccionar"}</option>)}
        </select>
        <svg className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
          <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.085l3.71-3.855a.75.75 0 111.08 1.04l-4.25 4.417a.75.75 0 01-1.08 0L5.21 8.27a.75.75 0 01.02-1.06z" clipRule="evenodd" />
        </svg>
      </span>
    </label>
  );
}

type SelectMiniProps = {
  value?: string | null;
  onChange: (value: string) => void;
  options: string[];
  labels?: Record<string, ReactNode>;
};

export function MerchanSelectMini({ value, onChange, options, labels = {} }: SelectMiniProps) {
  return (
    <select
      value={value ?? ""}
      onChange={e => onChange(e.target.value)}
      className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs text-slate-700 focus:outline-none focus:ring-1 focus:ring-slate-400"
    >
      {options.map(o => <option key={o} value={o}>{labels[o] || o || "Seleccionar"}</option>)}
    </select>
  );
}

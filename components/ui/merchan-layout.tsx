import type { ReactNode } from "react";

type Item = {
  id: string;
  label: string;
  icon?: React.ComponentType<{ className?: string }>;
  badge?: ReactNode;
};

export function MerchanSidebar({ items, activeId, onSelect }: { items: Item[]; activeId: string; onSelect: (id: string) => void }) {
  return (
    <aside className="fixed inset-y-0 left-0 z-30 hidden w-[220px] bg-slate-900 px-3 py-4 text-white lg:block">
      <div className="mb-7 flex items-center gap-3 px-2">
        <div className="grid h-8 w-8 place-items-center rounded-lg bg-[#e94560] text-sm font-bold text-white">M</div>
        <div>
          <p className="text-sm font-semibold leading-none text-white">MerchanOps</p>
          <p className="mt-1 text-[11px] text-white/40">Trade marketing</p>
        </div>
      </div>
      <nav className="space-y-1">
        {items.map(item => {
          const Icon = item.icon;
          const active = item.id === activeId;
          return (
            <button
              key={item.id}
              onClick={() => onSelect(item.id)}
              className={`flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm transition-colors ${active ? "bg-[#e94560]/20 text-white" : "text-white/65 hover:bg-white/[0.07] hover:text-white"}`}
            >
              {Icon && <Icon className={`h-4 w-4 ${active ? "text-[#e94560]" : "text-white/45"}`} />}
              <span className="flex-1 truncate">{item.label}</span>
              {item.badge !== undefined && <span className="rounded-full bg-white/10 px-2 py-0.5 text-[11px] text-white/70">{item.badge}</span>}
            </button>
          );
        })}
      </nav>
    </aside>
  );
}

export function MerchanTopbar({ title, breadcrumb, actions }: { title: string; breadcrumb?: string; actions?: ReactNode }) {
  return (
    <div className="sticky top-0 z-20 flex h-[54px] items-center justify-between border-b border-slate-200 bg-white px-5 lg:ml-[220px]">
      <div>
        <h1 className="text-[15px] font-semibold text-slate-900">{title}</h1>
        {breadcrumb && <p className="text-xs text-slate-400">{breadcrumb}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}

export function MerchanShell({ sidebar, topbar, children }: { sidebar: ReactNode; topbar: ReactNode; children: ReactNode }) {
  return (
    <div className="min-h-screen bg-slate-50/50 text-slate-900">
      {sidebar}
      {topbar}
      <main className="h-[calc(100vh-54px)] overflow-auto p-5 lg:ml-[220px]">{children}</main>
    </div>
  );
}

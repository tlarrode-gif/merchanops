"use client";

import { usePathname } from "next/navigation";

const links = [
  { href: "/", label: "Inicio", exact: true },
  { href: "/grandes-campanas", label: "Grandes Campañas" },
  { href: "/grandes-campanas/isdin", label: "ISDIN", exact: true },
  { href: "/grandes-campanas/isdin/llamadas", label: "Llamadas ISDIN" },
  { href: "/grandes-campanas/isdin/dashboard", label: "KPIs ISDIN" },
  { href: "/grandes-campanas/isdin/facturacion", label: "Facturación ISDIN" }
];

export function MainNav() {
  const pathname = usePathname();

  return (
    <div className="sticky top-0 z-40 border-b border-slate-200 bg-white/95 backdrop-blur">
      <nav className="mx-auto flex max-w-[1480px] flex-wrap gap-2 px-4 py-3 text-sm">
        {links.map(link => {
          const active = link.exact ? pathname === link.href : pathname === link.href || pathname.startsWith(`${link.href}/`);
          return (
            <a
              key={link.href}
              className={active ? "rounded-2xl bg-slate-900 px-4 py-2 font-medium text-white shadow-sm shadow-slate-900/10" : "rounded-2xl border border-slate-200 bg-white px-4 py-2 font-medium text-slate-900 hover:bg-slate-50"}
              href={link.href}
              aria-current={active ? "page" : undefined}
            >
              {link.label}
            </a>
          );
        })}
      </nav>
    </div>
  );
}

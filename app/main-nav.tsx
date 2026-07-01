"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { AppSession, canAccessModule, getCurrentAppSession, merchanopsSessionChangeEvent } from "@/lib/access-control";

const links = [
  { href: "/", label: "Inicio", exact: true, module: "servicios" },
  { href: "/auditoria-pagos", label: "Auditoría pagos", exact: true, module: "pagos" },
  { href: "/logistica", label: "Logística", exact: false, module: "logistica" },
  { href: "/grandes-campanas", label: "Grandes Campañas", exact: false, module: "isdin" },
  { href: "/grandes-campanas/isdin", label: "ISDIN", exact: true, module: "isdin" },
  { href: "/grandes-campanas/isdin/llamadas", label: "Llamadas ISDIN", exact: false, module: "isdin" },
  { href: "/grandes-campanas/isdin/dashboard", label: "KPIs ISDIN", exact: false, module: "isdin" },
  { href: "/grandes-campanas/isdin/facturacion", label: "Facturación ISDIN", exact: false, module: "isdin" }
] as const;

export function MainNav() {
  const pathname = usePathname();
  const [session, setSession] = useState<AppSession | null>(null);

  useEffect(() => {
    const syncSession = () => setSession(getCurrentAppSession());
    syncSession();
    window.addEventListener(merchanopsSessionChangeEvent, syncSession);
    window.addEventListener("storage", syncSession);
    return () => {
      window.removeEventListener(merchanopsSessionChangeEvent, syncSession);
      window.removeEventListener("storage", syncSession);
    };
  }, [pathname]);

  if (!session?.active) return null;

  return (
    <div className="sticky top-0 z-40 border-b border-slate-200 bg-white/95 backdrop-blur">
      <nav className="mx-auto flex max-w-[1480px] flex-wrap gap-2 px-4 py-3 text-sm">
        {links.filter(link => canAccessModule(session, link.module)).map(link => {
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

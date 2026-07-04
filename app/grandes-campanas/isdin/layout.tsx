"use client";

import { useEffect, useState } from "react";
import { AppSession, getCurrentAppSession, isAdminSession, merchanopsSessionChangeEvent } from "@/lib/access-control";

// Dashboard y Facturación exponen KPIs globales e importes de cliente: solo admin.
const sections = [
  { href: "/grandes-campanas/isdin", label: "ISDIN · Vinilos", adminOnly: false },
  { href: "/grandes-campanas/isdin/llamadas", label: "Llamadas ISDIN", adminOnly: false },
  { href: "/grandes-campanas/isdin/dashboard", label: "Dashboard KPIs ISDIN", adminOnly: true },
  { href: "/grandes-campanas/isdin/facturacion", label: "Facturación ISDIN", adminOnly: true }
];

export default function IsdinSectionLayout({ children }: { children: React.ReactNode }) {
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
  }, []);

  const admin = isAdminSession(session);

  return (
    <>
      <div className="border-b bg-slate-50">
        <nav className="mx-auto flex max-w-7xl flex-wrap gap-2 px-4 py-3 text-sm">
          {sections.filter(section => admin || !section.adminOnly).map(section => (
            <a key={section.href} className="rounded-2xl border bg-white px-4 py-2 text-slate-900 hover:bg-slate-100" href={section.href}>{section.label}</a>
          ))}
        </nav>
      </div>
      {children}
    </>
  );
}

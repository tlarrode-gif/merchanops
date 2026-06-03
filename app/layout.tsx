import "./globals.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "MerchanOps",
  description: "Gestión de servicios de trade marketing"
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <head>
        {/* UI refresh: DM Sans for interface and DM Mono for numeric/code values. */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=DM+Mono:wght@400;500&family=DM+Sans:wght@300;400;500;600&display=swap" rel="stylesheet" />
      </head>
      <body>
        <div className="border-b bg-white">
          <nav className="mx-auto flex max-w-7xl flex-wrap gap-2 px-4 py-3 text-sm">
            <a className="rounded-2xl bg-slate-900 px-4 py-2 text-white" href="/">Inicio</a>
            <a className="rounded-2xl border bg-white px-4 py-2 text-slate-900 hover:bg-slate-50" href="/grandes-campanas">Grandes Campañas</a>
            <a className="rounded-2xl border bg-white px-4 py-2 text-slate-900 hover:bg-slate-50" href="/grandes-campanas/isdin">ISDIN</a>
            <a className="rounded-2xl border bg-white px-4 py-2 text-slate-900 hover:bg-slate-50" href="/grandes-campanas/isdin/dashboard">KPIs ISDIN</a>
          </nav>
        </div>
        {children}
      </body>
    </html>
  );
}

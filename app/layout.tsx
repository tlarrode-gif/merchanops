import "./globals.css";
import "./services-visual.css";
import "./panel-visual.css";
import "./people-visual.css";
import "./payments-visual.css";
import "./calendar-visual.css";
import "./forms-visual.css";
import "./campaigns-visual.css";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "MerchanOps",
  description: "Gestión de servicios de trade marketing"
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=DM+Mono:wght@400;500&family=DM+Sans:wght@300;400;500;600&display=swap" rel="stylesheet" />
      </head>
      <body>
        <div className="sticky top-0 z-40 border-b border-slate-200 bg-white/95 backdrop-blur">
          <nav className="mx-auto flex max-w-[1480px] flex-wrap gap-2 px-4 py-3 text-sm">
            <a className="rounded-2xl bg-slate-900 px-4 py-2 font-medium text-white shadow-sm shadow-slate-900/10" href="/">Inicio</a>
            <a className="rounded-2xl border border-slate-200 bg-white px-4 py-2 font-medium text-slate-900 hover:bg-slate-50" href="/grandes-campanas">Grandes Campañas</a>
            <a className="rounded-2xl border border-slate-200 bg-white px-4 py-2 font-medium text-slate-900 hover:bg-slate-50" href="/grandes-campanas/isdin">ISDIN</a>
            <a className="rounded-2xl border border-slate-200 bg-white px-4 py-2 font-medium text-slate-900 hover:bg-slate-50" href="/grandes-campanas/isdin/dashboard">KPIs ISDIN</a>
            <a className="rounded-2xl border border-slate-200 bg-white px-4 py-2 font-medium text-slate-900 hover:bg-slate-50" href="/grandes-campanas/isdin/facturacion">Facturación ISDIN</a>
          </nav>
        </div>
        {children}
      </body>
    </html>
  );
}

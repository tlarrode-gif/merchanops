"use client";

/**
 * MerchanOps · RR.HH. — Altas laborales (cascarón de ruta).
 *
 * La pantalla vive entera en `altas-client.tsx`. Aquí solo queda el límite de
 * Suspense: sin él, `next build` revienta al prerenderizar cualquier hook de
 * navegación que se use dentro del cliente. La cabecera y el breadcrumb los
 * pone `app/app-shell.tsx`, así que esta página no pinta ni barra ni sidebar.
 */

import { Suspense } from "react";
import { AltasClient } from "./altas-client";

export default function AltasLaboralesPage() {
  return (
    <Suspense
      fallback={
        <main className="min-h-screen bg-slate-100 p-4 text-slate-900">
          <section className="mx-auto max-w-7xl space-y-4">
            <div className="rounded-3xl border bg-white p-4 text-sm text-slate-500 shadow-sm">Cargando altas laborales...</div>
          </section>
        </main>
      }
    >
      <AltasClient />
    </Suspense>
  );
}

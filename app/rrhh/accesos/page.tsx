"use client";

/**
 * MerchanOps · RR.HH. — Accesos a centro (cascarón de ruta).
 *
 * La pantalla vive entera en `accesos-client.tsx`. Aquí solo queda el límite de
 * Suspense: sin él, `next build` revienta al prerenderizar cualquier hook de
 * navegación que se use dentro del cliente. La cabecera y el breadcrumb los pone
 * `app/app-shell.tsx`, así que esta página no pinta ni barra ni sidebar.
 */

import { Suspense } from "react";
import { AccesosClient } from "./accesos-client";

export default function AccesosCentroPage() {
  return (
    <Suspense
      fallback={
        <main className="min-h-screen bg-slate-100 p-4 text-slate-900">
          <section className="mx-auto max-w-7xl space-y-4">
            <div className="rounded-3xl border bg-white p-4 text-sm text-slate-500 shadow-sm">Cargando accesos a centro...</div>
          </section>
        </main>
      }
    >
      <AccesosClient />
    </Suspense>
  );
}

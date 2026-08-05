/*
  Orden de hojas de estilo — importa, y mucho:

    1. globals.css        Tailwind (base, components, utilities).
    2. mo-theme.css       tokens de marca + base del documento.
    3. mo-shell.css       sidebar y topbar.
    4. mo-surfaces.css    reviste tarjetas, tablas, botones y estados de TODA
                          la app reescribiendo los patrones de clase que ya
                          existen en el marcado.
    5. mo-components.css  piezas nuevas con nombre propio (KPI, bandeja de
                          acciones, dónut, barras) que usa components/ui/mo.tsx.
    6. grandes-campanas   sistema de componentes propio del módulo (clases
                          gc-*, usadas por su JSX).
    7. isdin-refined-table  maquetación de la tabla de Vinilos: cabecera y
                          primeras columnas fijas, anchos por columna.

  Las nueve hojas de «pulido» anteriores (panel-, services-, people-, payments-,
  calendar-, forms-, campaigns-, responsive-visual y isdin-operational-view) se
  han eliminado en el rediseño: eran capas de parches colgando de selectores
  frágiles (`main.min-h-screen.bg-slate-100 ...`, `body main ...`) con !important
  por todas partes, y pintaban la app en la paleta slate de Tailwind, no en la de
  marca. Lo que aportaban vive ahora en mo-surfaces.css, escrito una sola vez y
  contra los tokens.

  Las capas mo-* se cargan después de Tailwind a propósito: cuelgan de `.mo-app`
  (0,2,0), así que ganan a las utilidades de una sola clase (0,1,0) sin recurrir
  a !important salvo en el remapeo de colores de estado, donde sí hace falta.
*/
import "./globals.css";
import "./mo-theme.css";
import "./mo-shell.css";
import "./mo-surfaces.css";
import "./mo-components.css";
import "./grandes-campanas-visual.css";
import "./isdin-refined-table.css";
import { Suspense } from "react";
import type { Metadata } from "next";
import { DM_Mono, DM_Sans, Source_Serif_4 } from "next/font/google";
import { AppShell } from "./app-shell";

const dmSans = DM_Sans({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600"],
  variable: "--font-dm-sans",
  display: "swap"
});

const dmMono = DM_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-dm-mono",
  display: "swap"
});

// La voz seria del producto: títulos de pantalla, títulos de tarjeta y cifras.
const sourceSerif = Source_Serif_4({
  subsets: ["latin"],
  weight: ["400", "600", "700"],
  variable: "--font-source-serif",
  display: "swap"
});

export const metadata: Metadata = {
  title: "MerchanOps",
  description: "Gestión de servicios de trade marketing"
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body className={`${dmSans.variable} ${dmMono.variable} ${sourceSerif.variable}`}>
        {/* AppShell lee la query (?tab=) con useSearchParams para marcar el
            enlace activo tras una navegación client-side; eso exige Suspense. */}
        <Suspense fallback={null}>
          <AppShell>{children}</AppShell>
        </Suspense>
      </body>
    </html>
  );
}

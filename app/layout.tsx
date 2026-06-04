import "./globals.css";
import "./services-visual.css";
import "./panel-visual.css";
import "./people-visual.css";
import "./payments-visual.css";
import "./calendar-visual.css";
import "./forms-visual.css";
import "./campaigns-visual.css";
import "./final-ui-shell.css";
import "./isdin-refined-table.css";
import type { Metadata } from "next";
import { DM_Mono, DM_Sans } from "next/font/google";
import { MainNav } from "./main-nav";

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

export const metadata: Metadata = {
  title: "MerchanOps",
  description: "Gestión de servicios de trade marketing"
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body className={`${dmSans.variable} ${dmMono.variable}`}>
        <MainNav />
        {children}
      </body>
    </html>
  );
}

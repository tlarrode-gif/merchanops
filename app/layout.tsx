import "./globals.css";
import "./services-visual.css";
import "./panel-visual.css";
import "./people-visual.css";
import "./payments-visual.css";
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
      <body>{children}</body>
    </html>
  );
}

import { notFound } from "next/navigation";
import { LogisticsClient } from "../logistics-client";
import { SolicitudesLogisticaClient } from "../solicitudes/solicitudes-logistica-client";

// M-06: sin lista blanca, /logistica/loquesea renderizaba el panel con un
// `section` inválido (logistics-client.tsx:44 cae a "panel"), produciendo URLs
// sin sentido e indexables y un breadcrumb basura. Debe ser un 404.
const SECCIONES_VALIDAS = new Set([
  "panel",
  "solicitudes",
  "entradas",
  "stock",
  "picking",
  "envios",
  "incidencias",
  "pendientes",
  "sincronizacion"
]);

export default function LogisticsSectionPage({ params, searchParams }: { params: { section: string }; searchParams?: { id?: string } }) {
  if (!SECCIONES_VALIDAS.has(params.section)) {
    notFound();
  }

  if (params.section === "solicitudes") {
    return <SolicitudesLogisticaClient detailId={searchParams?.id} />;
  }

  return <LogisticsClient section={params.section} detailId={searchParams?.id} />;
}

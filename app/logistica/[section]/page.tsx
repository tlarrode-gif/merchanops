import { LogisticsClient } from "../logistics-client";
import { SolicitudesLogisticaClient } from "../solicitudes/solicitudes-logistica-client";

export default function LogisticsSectionPage({ params, searchParams }: { params: { section: string }; searchParams?: { id?: string } }) {
  if (params.section === "solicitudes") {
    return <SolicitudesLogisticaClient detailId={searchParams?.id} />;
  }

  return <LogisticsClient section={params.section} detailId={searchParams?.id} />;
}

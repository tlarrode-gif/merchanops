import { SolicitudesLogisticaClient } from "./solicitudes-logistica-client";

export default function SolicitudesLogisticaPage({ searchParams }: { searchParams?: { id?: string } }) {
  return <SolicitudesLogisticaClient detailId={searchParams?.id} />;
}

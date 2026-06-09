import { LogisticsClient } from "@/app/logistica/logistics-client";

export default function ConfiguracionSincronizacionPage({ searchParams }: { searchParams?: { id?: string } }) {
  return <LogisticsClient section="sincronizacion" detailId={searchParams?.id} />;
}

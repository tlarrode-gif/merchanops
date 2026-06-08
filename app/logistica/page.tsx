import { LogisticsClient } from "./logistics-client";

export default function LogisticsPage({ searchParams }: { searchParams?: { id?: string } }) {
  return <LogisticsClient section="panel" detailId={searchParams?.id} />;
}

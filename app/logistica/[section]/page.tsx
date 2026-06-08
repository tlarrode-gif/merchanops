import { LogisticsClient } from "../logistics-client";

export default function LogisticsSectionPage({ params, searchParams }: { params: { section: string }; searchParams?: { id?: string } }) {
  return <LogisticsClient section={params.section} detailId={searchParams?.id} />;
}

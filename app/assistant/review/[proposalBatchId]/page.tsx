import type { Metadata } from "next";
import { AssistantReviewPage } from "@/components/assistant/assistant-review-page";

export const metadata: Metadata = {
  title: "Review Assistant Plan",
  description: "Review and approve the Assistant's persisted planning proposals.",
};

export default async function AssistantReviewRoute({
  params,
}: {
  params: Promise<{ proposalBatchId: string }>;
}) {
  const { proposalBatchId } = await params;
  return <AssistantReviewPage proposalBatchId={proposalBatchId} />;
}

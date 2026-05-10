import type { Metadata } from "next";
import { AssistantPage } from "@/components/assistant/assistant-page";

export const metadata: Metadata = {
  title: "AI Plan Review",
  description:
    "Ask for planning help and review safe suggestions before anything is saved.",
};

export default function AssistantRoutePage() {
  return <AssistantPage />;
}

import type { Metadata } from "next";
import { AssistantPage } from "@/components/assistant/assistant-page";

export const metadata: Metadata = {
  title: "Planning Assistant",
  description:
    "Ask for help turning projects into a realistic plan while staying in control.",
};

export default function AssistantRoutePage() {
  return <AssistantPage />;
}

import type { Metadata } from "next";
import { IntegrationsPage } from "@/components/integrations/integrations-page";

export const metadata: Metadata = {
  title: "Integrations",
  description:
    "Prepare calendar integrations for Schedule Builder, including Apple, Outlook, D2L, Google Calendar, and ICS import.",
};

export default function IntegrationsRoute() {
  return <IntegrationsPage />;
}

import type { Metadata } from "next";
import { IntegrationsPage } from "@/components/integrations/integrations-page";

export const metadata: Metadata = {
  title: "Integrations",
  description:
    "Prepare calendar integrations for Schedule Builder, including Google Calendar, Canvas, D2L, and ICS import/export.",
};

export default function IntegrationsRoute() {
  return <IntegrationsPage />;
}

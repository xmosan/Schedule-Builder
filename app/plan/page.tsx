import type { Metadata } from "next";
import { ProjectDashboard } from "@/components/projects/project-dashboard";

export const metadata: Metadata = {
  title: "Weekly Plan",
  description:
    "Schedule weekly work blocks and export the plan as an ICS calendar file.",
};

export default function PlanPage() {
  return <ProjectDashboard />;
}

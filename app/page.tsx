import type { Metadata } from "next";
import { ProjectDashboard } from "@/components/projects/project-dashboard";

export const metadata: Metadata = {
  description:
    "Plan project-based work with priorities, deadlines, next actions, weekly capacity, and a daily Top 3 focus list.",
};

export default function HomePage() {
  return <ProjectDashboard />;
}

import type { Metadata } from "next";
import { ProjectDashboard } from "@/components/projects/project-dashboard";

export const metadata: Metadata = {
  description:
    "Plan your week across multiple projects with priorities, deadlines, next actions, and a daily top-three focus list.",
};

export default function HomePage() {
  return <ProjectDashboard />;
}

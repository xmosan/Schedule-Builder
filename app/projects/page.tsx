import type { Metadata } from "next";
import { ProjectDashboard } from "@/components/projects/project-dashboard";

export const metadata: Metadata = {
  title: "Projects",
  description:
    "Review projects, add new commitments, and keep each project tied to a clear next action.",
};

export default function ProjectsPage() {
  return <ProjectDashboard />;
}

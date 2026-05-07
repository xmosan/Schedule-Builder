import type { Metadata } from "next";
import { ProjectDashboard } from "@/components/projects/project-dashboard";

export const metadata: Metadata = {
  title: "Settings",
  description: "Review Schedule Builder account and sync status.",
};

export default function SettingsPage() {
  return <ProjectDashboard />;
}

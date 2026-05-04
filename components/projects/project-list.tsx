import { FolderStackIcon } from "@/components/projects/icons";
import { ProjectCard } from "@/components/projects/project-card";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import type { Project } from "@/lib/projects";

type ProjectListProps = {
  onToggleComplete: (id: number) => void;
  projects: Project[];
};

export function ProjectList({ onToggleComplete, projects }: ProjectListProps) {
  return (
    <Card className="rounded-[28px] border-white/70 bg-white/84 sm:rounded-[32px]">
      <CardContent className="p-4 sm:p-6">
        <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <div className="rounded-2xl bg-brand-ink/6 p-2 text-brand-ink">
              <FolderStackIcon className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-brand-ink sm:text-xl">
                Master Project List
              </h2>
              <p className="text-sm text-brand-ink/60">
                Every project needs a clear next action.
              </p>
            </div>
          </div>
          <Badge>{projects.length} projects</Badge>
        </div>

        <div className="space-y-3 sm:space-y-4">
          {projects.map((project) => (
            <ProjectCard
              key={project.id}
              project={project}
              onToggleComplete={onToggleComplete}
            />
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

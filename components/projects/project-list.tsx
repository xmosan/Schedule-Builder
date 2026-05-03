import { ProjectCard } from "@/components/projects/project-card";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import type { Project } from "@/lib/projects";

type ProjectListProps = {
  projects: Project[];
  onToggleComplete: (id: number) => void;
};

export function ProjectList({
  projects,
  onToggleComplete,
}: ProjectListProps) {
  const activeCount = projects.filter((project) => !project.completed).length;

  return (
    <Card className="rounded-[28px] border-white/70 bg-white/82 sm:rounded-[32px]">
      <CardContent className="p-4 sm:p-6">
        <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 className="text-xl font-semibold text-brand-ink sm:text-2xl">
              Master Project List
            </h2>
            <p className="mt-1 text-sm leading-6 text-brand-ink/60">
              Every project needs a clear next action before it earns time on
              your schedule.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="subtle">{activeCount} active</Badge>
            <Badge>{projects.length} total</Badge>
          </div>
        </div>

        <div className="space-y-3">
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

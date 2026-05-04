import { CalendarIcon, CheckCircleIcon, ClockIcon } from "@/components/projects/icons";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  categoryStyles,
  priorityStyles,
  type Project,
} from "@/lib/projects";
import { cn } from "@/lib/utils";

type ProjectCardProps = {
  onToggleComplete: (id: number) => void;
  project: Project;
};

export function ProjectCard({ onToggleComplete, project }: ProjectCardProps) {
  return (
    <article
      className={cn(
        "rounded-[26px] border border-white/75 bg-white/84 p-4 shadow-[0_16px_40px_rgba(18,32,47,0.06)] sm:rounded-[30px] sm:p-5",
        project.completed && "opacity-62",
      )}
    >
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <h3
              className={cn(
                "max-w-full text-lg font-semibold leading-snug text-brand-ink sm:text-xl",
                project.completed && "line-through decoration-brand-ink/30",
              )}
            >
              {project.name}
            </h3>
            <span
              className={cn(
                "rounded-full border px-3 py-1 text-xs font-semibold",
                categoryStyles[project.category],
              )}
            >
              {project.category}
            </span>
            <span
              className={cn(
                "rounded-full border px-3 py-1 text-xs font-semibold",
                priorityStyles[project.priority],
              )}
            >
              {project.priority}
            </span>
          </div>

          <p className="text-sm leading-6 text-brand-ink/68">
            <span className="font-semibold text-brand-ink">Next action:</span>{" "}
            {project.nextAction}
          </p>

          <div className="grid gap-2 text-sm text-brand-ink/56 sm:grid-cols-2">
            <span className="flex items-center gap-2 rounded-2xl bg-brand-ink/[0.035] px-3 py-2">
              <CalendarIcon className="h-4 w-4 shrink-0" />
              {project.deadline || "No deadline"}
            </span>
            <span className="flex items-center gap-2 rounded-2xl bg-brand-ink/[0.035] px-3 py-2">
              <ClockIcon className="h-4 w-4 shrink-0" />
              {project.weeklyHours} hrs/week
            </span>
          </div>
        </div>

        <Button
          className="w-full shrink-0 sm:w-auto"
          variant={project.completed ? "secondary" : "outline"}
          onClick={() => onToggleComplete(project.id)}
        >
          <CheckCircleIcon className="h-4 w-4" />
          {project.completed ? "Undo" : "Done"}
        </Button>
      </div>
    </article>
  );
}

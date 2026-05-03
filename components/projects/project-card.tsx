import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { CalendarIcon, CheckCircleIcon, ClockIcon } from "@/components/projects/icons";
import { categoryStyles, priorityStyles, type Project } from "@/lib/projects";
import { cn } from "@/lib/utils";

type ProjectCardProps = {
  project: Project;
  onToggleComplete: (id: number) => void;
};

export function ProjectCard({ project, onToggleComplete }: ProjectCardProps) {
  return (
    <Card
      className={cn(
        "rounded-[24px] border-white/80 bg-white/90 shadow-[0_16px_40px_rgba(18,32,47,0.05)] sm:rounded-[28px]",
        project.completed && "opacity-60",
      )}
    >
      <CardContent className="flex flex-col gap-4 p-4 sm:p-5">
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div className="min-w-0 flex-1 space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <h3
                className={cn(
                  "text-base font-semibold leading-6 text-brand-ink sm:text-lg",
                  project.completed && "line-through",
                )}
              >
                {project.name}
              </h3>
              <Badge className={categoryStyles[project.category]}>
                {project.category}
              </Badge>
              <Badge className={priorityStyles[project.priority]}>
                {project.priority}
              </Badge>
            </div>

            <p className="text-sm leading-6 text-brand-ink/75">
              <span className="font-semibold text-brand-ink">Next action:</span>{" "}
              {project.nextAction}
            </p>

            <div className="grid gap-2 text-sm text-brand-ink/60 sm:flex sm:flex-wrap sm:gap-4">
              <span className="inline-flex items-center gap-2">
                <CalendarIcon className="h-4 w-4" />
                {project.deadline || "No deadline yet"}
              </span>
              <span className="inline-flex items-center gap-2">
                <ClockIcon className="h-4 w-4" />
                {project.weeklyHours} hrs/week
              </span>
            </div>
          </div>

          <Button
            variant={project.completed ? "secondary" : "outline"}
            className="w-full shrink-0 sm:w-auto"
            onClick={() => onToggleComplete(project.id)}
          >
            <CheckCircleIcon className="h-4 w-4" />
            {project.completed ? "Undo" : "Done"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

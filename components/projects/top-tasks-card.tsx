import { TargetIcon } from "@/components/projects/icons";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import type { Project } from "@/lib/projects";

type TopTasksCardProps = {
  projects: Project[];
};

export function TopTasksCard({ projects }: TopTasksCardProps) {
  return (
    <Card className="rounded-[28px] border-white/70 bg-white/84 sm:rounded-[32px]">
      <CardContent className="p-4 sm:p-6">
        <div className="flex items-center gap-3">
          <div className="rounded-2xl bg-brand-ocean/10 p-2 text-brand-ocean">
            <TargetIcon className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-brand-ink sm:text-xl">
              Today&apos;s Top 3
            </h2>
            <p className="text-sm text-brand-ink/60">
              Ranked by priority first, then weekly hours.
            </p>
          </div>
        </div>

        <div className="mt-5 space-y-3">
          {projects.length > 0 ? (
            projects.map((project, index) => (
              <div
                key={project.id}
                className="rounded-[22px] border border-brand-ink/8 bg-white/92 p-4"
              >
                <div className="flex items-center justify-between gap-3">
                  <Badge className="border-brand-ocean/15 bg-brand-ocean/10 text-brand-ocean">
                    Task {index + 1}
                  </Badge>
                  <span className="text-xs font-semibold uppercase tracking-[0.18em] text-brand-ink/45">
                    {project.priority}
                  </span>
                </div>
                <p className="mt-3 text-sm font-semibold leading-6 text-brand-ink sm:text-base">
                  {project.nextAction}
                </p>
                <p className="mt-1 text-sm text-brand-ink/60">
                  From: {project.name}
                </p>
              </div>
            ))
          ) : (
            <div className="rounded-[24px] border border-dashed border-brand-ink/12 bg-white/65 p-4 text-sm text-brand-ink/60">
              All current projects are marked done. Add a new project or undo one
              to rebuild your focus list.
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

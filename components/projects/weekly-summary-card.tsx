import { ClockIcon } from "@/components/projects/icons";
import { Card, CardContent } from "@/components/ui/card";

type WeeklySummaryCardProps = {
  activeProjects: number;
  completedProjects: number;
  totalHours: number;
};

export function WeeklySummaryCard({
  activeProjects,
  completedProjects,
  totalHours,
}: WeeklySummaryCardProps) {
  return (
    <Card className="rounded-[28px] border-white/70 bg-white/84 sm:rounded-[32px]">
      <CardContent className="p-4 sm:p-6">
        <div className="flex items-center gap-3">
          <div className="rounded-2xl bg-brand-ocean/10 p-2 text-brand-ocean">
            <ClockIcon className="h-5 w-5" />
          </div>
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.18em] text-brand-ink/45">
              Planned Weekly Work
            </p>
            <p className="mt-1 text-3xl font-semibold tracking-tight text-brand-ink">
              {totalHours} hrs
            </p>
          </div>
        </div>

        <div className="mt-5 grid grid-cols-2 gap-3">
          <div className="metric-card p-4">
            <p className="text-sm text-brand-ink/55">Active</p>
            <p className="mt-2 text-2xl font-semibold text-brand-ink">
              {activeProjects}
            </p>
          </div>
          <div className="metric-card p-4">
            <p className="text-sm text-brand-ink/55">Completed</p>
            <p className="mt-2 text-2xl font-semibold text-brand-ink">
              {completedProjects}
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

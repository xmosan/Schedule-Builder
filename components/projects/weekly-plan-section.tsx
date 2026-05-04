"use client";

import type { FormEvent } from "react";
import { useEffect, useMemo, useState } from "react";
import { CalendarIcon, ClockIcon, PlusIcon } from "@/components/projects/icons";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import type { Project } from "@/lib/projects";
import {
  createWeeklyPlanBlock,
  formatEstimatedHours,
  weekDays,
  type WeekDay,
  type WeeklyPlanBlock,
} from "@/lib/weekly-plan";

type WeeklyPlanSectionProps = {
  onAddBlock: (block: WeeklyPlanBlock) => void;
  onRemoveBlock: (id: string) => void;
  planBlocks: WeeklyPlanBlock[];
  projects: Project[];
};

type WeeklyPlanDraftState = {
  day: WeekDay;
  projectId: string;
  plannedTask: string;
  estimatedHours: string;
};

function getInitialDraft(projects: Project[]): WeeklyPlanDraftState {
  const firstProject = projects[0];

  return {
    day: "Monday",
    projectId: firstProject ? String(firstProject.id) : "",
    plannedTask: firstProject?.nextAction ?? "",
    estimatedHours: "1",
  };
}

export function WeeklyPlanSection({
  onAddBlock,
  onRemoveBlock,
  planBlocks,
  projects,
}: WeeklyPlanSectionProps) {
  const [draft, setDraft] = useState<WeeklyPlanDraftState>(() =>
    getInitialDraft(projects),
  );
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setDraft((current) => {
      const currentProjectStillExists = projects.some(
        (project) => String(project.id) === current.projectId,
      );

      if (currentProjectStillExists || projects.length === 0) {
        return current;
      }

      return {
        ...current,
        projectId: String(projects[0].id),
        plannedTask: current.plannedTask || projects[0].nextAction,
      };
    });
  }, [projects]);

  const totalPlannedHours = useMemo(() => {
    return planBlocks.reduce((sum, block) => sum + block.estimatedHours, 0);
  }, [planBlocks]);

  const filledDays = useMemo(() => {
    return weekDays.filter((day) =>
      planBlocks.some((block) => block.day === day),
    ).length;
  }, [planBlocks]);

  const blocksByDay = useMemo(() => {
    return weekDays.reduce<Record<WeekDay, WeeklyPlanBlock[]>>((acc, day) => {
      acc[day] = planBlocks.filter((block) => block.day === day);
      return acc;
    }, {} as Record<WeekDay, WeeklyPlanBlock[]>);
  }, [planBlocks]);

  const canAddBlock =
    draft.projectId.length > 0 &&
    draft.plannedTask.trim().length > 0 &&
    Number(draft.estimatedHours) > 0;

  function handleProjectChange(projectId: string) {
    const selectedProject = projects.find(
      (project) => String(project.id) === projectId,
    );

    setDraft((current) => ({
      ...current,
      projectId,
      plannedTask: selectedProject?.nextAction ?? "",
    }));

    if (error) {
      setError(null);
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const selectedProject = projects.find(
      (project) => String(project.id) === draft.projectId,
    );

    if (!selectedProject) {
      setError("Add a project first, then assign a block to the week.");
      return;
    }

    const planBlock = createWeeklyPlanBlock({
      day: draft.day,
      projectName: selectedProject.name,
      plannedTask: draft.plannedTask,
      estimatedHours: draft.estimatedHours,
    });

    if (!planBlock) {
      setError("Add a task and a positive time estimate before saving.");
      return;
    }

    onAddBlock(planBlock);
    setDraft((current) => ({
      ...current,
      plannedTask: selectedProject.nextAction,
      estimatedHours: "1",
    }));
    setError(null);
  }

  return (
    <section className="grid gap-5 lg:grid-cols-[340px_minmax(0,1fr)] lg:gap-6">
      <Card className="rounded-[28px] border-white/70 bg-white/84 sm:rounded-[32px]">
        <CardContent className="p-4 sm:p-6">
          <div className="flex items-center gap-3">
            <div className="rounded-2xl bg-brand-teal/10 p-2 text-brand-teal">
              <CalendarIcon className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-brand-ink sm:text-xl">
                Weekly Plan
              </h2>
              <p className="text-sm text-brand-ink/60">
                Assign concrete work blocks from Monday through Sunday.
              </p>
            </div>
          </div>

          <div className="mt-5 grid grid-cols-2 gap-3">
            <div className="metric-card p-4">
              <p className="text-sm text-brand-ink/55">Planned hours</p>
              <p className="mt-2 text-2xl font-semibold text-brand-ink">
                {totalPlannedHours}
              </p>
            </div>
            <div className="metric-card p-4">
              <p className="text-sm text-brand-ink/55">Days filled</p>
              <p className="mt-2 text-2xl font-semibold text-brand-ink">
                {filledDays}
              </p>
            </div>
          </div>

          <form className="mt-5 space-y-4 sm:space-y-5" onSubmit={handleSubmit}>
            <div>
              <label className="field-label" htmlFor="plan-day">
                Day
              </label>
              <Select
                id="plan-day"
                value={draft.day}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    day: event.target.value as WeekDay,
                  }))
                }
              >
                {weekDays.map((day) => (
                  <option key={day} value={day}>
                    {day}
                  </option>
                ))}
              </Select>
            </div>

            <div>
              <label className="field-label" htmlFor="plan-project">
                Project
              </label>
              <Select
                id="plan-project"
                value={draft.projectId}
                onChange={(event) => handleProjectChange(event.target.value)}
                disabled={projects.length === 0}
              >
                {projects.length > 0 ? (
                  projects.map((project) => (
                    <option key={project.id} value={String(project.id)}>
                      {project.name}
                      {project.completed ? " (done)" : ""}
                    </option>
                  ))
                ) : (
                  <option value="">No projects yet</option>
                )}
              </Select>
            </div>

            <div>
              <label className="field-label" htmlFor="plan-task">
                Planned task / next action
              </label>
              <Input
                id="plan-task"
                placeholder="Finish the highest-deadline assignment"
                value={draft.plannedTask}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    plannedTask: event.target.value,
                  }))
                }
              />
            </div>

            <div>
              <label className="field-label" htmlFor="plan-hours">
                Estimated time
              </label>
              <Input
                id="plan-hours"
                type="number"
                min="0.5"
                step="0.5"
                inputMode="decimal"
                placeholder="1"
                value={draft.estimatedHours}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    estimatedHours: event.target.value,
                  }))
                }
              />
            </div>

            {projects.length === 0 ? (
              <p className="text-sm text-brand-ink/60">
                Add a project first, then you can place work blocks into the
                week.
              </p>
            ) : null}

            {error ? (
              <p className="text-sm font-medium text-brand-coral">{error}</p>
            ) : null}

            <Button className="w-full" type="submit" disabled={!canAddBlock}>
              <PlusIcon className="h-4 w-4" />
              Add weekly block
            </Button>
          </form>
        </CardContent>
      </Card>

      <div className="space-y-4 sm:space-y-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 className="text-xl font-semibold text-brand-ink sm:text-2xl">
              Weekly Schedule Map
            </h2>
            <p className="text-sm leading-6 text-brand-ink/60">
              Use these blocks to decide what each day is for before the week
              gets crowded.
            </p>
          </div>
          <Badge variant="subtle">{planBlocks.length} blocks planned</Badge>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
          {weekDays.map((day) => {
            const dayBlocks = blocksByDay[day];
            const dayHours = dayBlocks.reduce(
              (sum, block) => sum + block.estimatedHours,
              0,
            );

            return (
              <Card
                key={day}
                className="rounded-[24px] border-white/70 bg-white/80 sm:rounded-[28px]"
              >
                <CardContent className="p-4 sm:p-5">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0">
                      <h3 className="text-base font-semibold text-brand-ink sm:text-lg">
                        {day}
                      </h3>
                      <p className="mt-1 text-sm text-brand-ink/55">
                        {dayBlocks.length} {dayBlocks.length === 1 ? "block" : "blocks"}
                      </p>
                    </div>
                    <Badge>{formatEstimatedHours(dayHours || 0)}</Badge>
                  </div>

                  <div className="mt-4 space-y-3">
                    {dayBlocks.length > 0 ? (
                      dayBlocks.map((block) => (
                        <div
                          key={block.id}
                          className="rounded-[20px] border border-brand-ink/8 bg-white/92 p-3.5 sm:rounded-[22px] sm:p-4"
                        >
                          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                            <div className="min-w-0">
                              <p className="text-sm font-semibold text-brand-ink sm:text-base">
                                {block.projectName}
                              </p>
                              <p className="mt-2 text-sm leading-6 text-brand-ink/65">
                                {block.plannedTask}
                              </p>
                            </div>
                            <Button
                              variant="secondary"
                              size="sm"
                              className="w-full shrink-0 sm:w-auto"
                              onClick={() => onRemoveBlock(block.id)}
                            >
                              Remove
                            </Button>
                          </div>

                          <div className="mt-3 flex items-center gap-2 text-sm text-brand-ink/55">
                            <ClockIcon className="h-4 w-4" />
                            {formatEstimatedHours(block.estimatedHours)}
                          </div>
                        </div>
                      ))
                    ) : (
                      <div className="rounded-[20px] border border-dashed border-brand-ink/12 bg-white/65 p-4 text-sm leading-6 text-brand-ink/55 sm:rounded-[22px]">
                        No blocks planned yet. Add one from the form to give{" "}
                        {day} a clear purpose.
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>
    </section>
  );
}

"use client";

import type { FormEvent } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  CalendarIcon,
  ClockIcon,
  PlusIcon,
  TargetIcon,
} from "@/components/projects/icons";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import {
  generateWeeklyPlanIcs,
  getCurrentWeekMondayInputValue,
} from "@/lib/calendar-export";
import type { Project } from "@/lib/projects";
import {
  createWeeklyPlanBlock,
  formatEstimatedHours,
  formatStartTime,
  parseStartTimeToMinutes,
  weekDays,
  type WeekDay,
  type WeeklyPlanBlock,
} from "@/lib/weekly-plan";

type WeeklyPlanSectionProps = {
  onAddBlock: (block: WeeklyPlanBlock) => void;
  onRemoveBlock: (id: string) => Promise<void> | void;
  planBlocks: WeeklyPlanBlock[];
  projects: Project[];
};

type WeeklyPlanDraftState = {
  day: WeekDay;
  projectId: string;
  plannedTask: string;
  estimatedHours: string;
  startTime: string;
};

const weeklyBlockRemovalAnimationMs = 300;

function getInitialDraft(projects: Project[]): WeeklyPlanDraftState {
  const firstProject = projects[0];

  return {
    day: "Monday",
    projectId: firstProject ? String(firstProject.id) : "",
    plannedTask: firstProject?.nextAction ?? "",
    estimatedHours: "1",
    startTime: "",
  };
}

function normalizeBlockPart(value: string) {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

function getBlockIdentityKey({
  day,
  plannedTask,
  projectName,
}: Pick<WeeklyPlanBlock, "day" | "plannedTask" | "projectName">) {
  return [
    day,
    normalizeBlockPart(projectName),
    normalizeBlockPart(plannedTask),
  ].join(":");
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }

  if (
    typeof error === "object" &&
    error !== null &&
    "message" in error &&
    typeof error.message === "string"
  ) {
    return error.message;
  }

  return "Please try again in a moment.";
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
  const [isAddFormOpen, setIsAddFormOpen] = useState(false);
  const [duplicateWarningKey, setDuplicateWarningKey] = useState<string | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  const [exitingBlockIds, setExitingBlockIds] = useState<
    Record<string, boolean>
  >({});
  const [exportWeekStart, setExportWeekStart] = useState("");
  const [exportError, setExportError] = useState<string | null>(null);
  const [exportMessage, setExportMessage] = useState<string | null>(null);
  const [projectFocusMessage, setProjectFocusMessage] = useState<string | null>(
    null,
  );
  const [removeErrors, setRemoveErrors] = useState<Record<string, string>>({});
  const removeTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>(
    {},
  );

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

  useEffect(() => {
    setExportWeekStart(getCurrentWeekMondayInputValue());
  }, []);

  useEffect(() => {
    return () => {
      Object.values(removeTimers.current).forEach((timerId) => {
        clearTimeout(timerId);
      });
    };
  }, []);

  useEffect(() => {
    const selectedProjectId = new URLSearchParams(window.location.search).get(
      "project",
    );

    if (!selectedProjectId) {
      setProjectFocusMessage(null);
      return;
    }

    const selectedProject = projects.find(
      (project) => String(project.id) === selectedProjectId,
    );

    if (!selectedProject) {
      setProjectFocusMessage(
        "That project is no longer available. Choose another project below.",
      );
      return;
    }

    setDraft((current) => ({
      ...current,
      projectId: String(selectedProject.id),
      plannedTask: selectedProject.nextAction,
    }));
    setProjectFocusMessage(
      `${selectedProject.name} is selected. Choose a day and time estimate, then add it to your weekly plan.`,
    );
    setError(null);
  }, [projects]);

  const selectedProject = useMemo(
    () => projects.find((project) => String(project.id) === draft.projectId),
    [draft.projectId, projects],
  );

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
      acc[day] = planBlocks
        .map((block, index) => ({
          block,
          index,
          startMinutes: parseStartTimeToMinutes(block.startTime),
        }))
        .filter(({ block }) => block.day === day)
        .sort((first, second) => {
          if (first.startMinutes !== null && second.startMinutes !== null) {
            return first.startMinutes - second.startMinutes || first.index - second.index;
          }

          if (first.startMinutes !== null) {
            return -1;
          }

          if (second.startMinutes !== null) {
            return 1;
          }

          return first.index - second.index;
        })
        .map(({ block }) => block);
      return acc;
    }, {} as Record<WeekDay, WeeklyPlanBlock[]>);
  }, [planBlocks]);

  const draftDuplicateKey =
    selectedProject && draft.plannedTask.trim()
      ? getBlockIdentityKey({
          day: draft.day,
          plannedTask: draft.plannedTask,
          projectName: selectedProject.name,
        })
      : null;
  const hasDuplicateDraft = Boolean(
    draftDuplicateKey &&
      planBlocks.some(
        (block) => getBlockIdentityKey(block) === draftDuplicateKey,
      ),
  );
  const isConfirmingDuplicate = Boolean(
    draftDuplicateKey &&
      hasDuplicateDraft &&
      duplicateWarningKey === draftDuplicateKey,
  );
  const hasValidDraftStartTime =
    !draft.startTime.trim() || parseStartTimeToMinutes(draft.startTime) !== null;
  const canAddBlock =
    draft.projectId.length > 0 &&
    draft.plannedTask.trim().length > 0 &&
    Number(draft.estimatedHours) > 0 &&
    hasValidDraftStartTime;

  function clearDraftWarnings() {
    setDuplicateWarningKey(null);

    if (error) {
      setError(null);
    }
  }

  function handleProjectChange(projectId: string) {
    const nextProject = projects.find(
      (project) => String(project.id) === projectId,
    );

    setDraft((current) => ({
      ...current,
      projectId,
      plannedTask: nextProject?.nextAction ?? "",
    }));
    setProjectFocusMessage(null);
    clearDraftWarnings();
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!selectedProject) {
      setError("Add a project first, then schedule a weekly work block.");
      return;
    }

    if (!hasValidDraftStartTime) {
      setError("Choose a valid start time or leave the start time blank.");
      return;
    }

    const planBlock = createWeeklyPlanBlock({
      day: draft.day,
      projectName: selectedProject.name,
      plannedTask: draft.plannedTask,
      estimatedHours: draft.estimatedHours,
      startTime: draft.startTime,
    });

    if (!planBlock) {
      setError("Add a task and a positive time estimate before saving.");
      return;
    }

    const nextBlockKey = getBlockIdentityKey(planBlock);

    if (
      planBlocks.some((block) => getBlockIdentityKey(block) === nextBlockKey) &&
      duplicateWarningKey !== nextBlockKey
    ) {
      setDuplicateWarningKey(nextBlockKey);
      setError(
        "A similar block already exists for that day. Click again if you still want to add another copy.",
      );
      return;
    }

    onAddBlock(planBlock);
    setDraft((current) => ({
      ...current,
      plannedTask: selectedProject.nextAction,
      estimatedHours: "1",
      startTime: "",
    }));
    setIsAddFormOpen(false);
    setDuplicateWarningKey(null);
    setError(null);
  }

  function handleCalendarExport() {
    setExportError(null);
    setExportMessage(null);

    if (planBlocks.length === 0) {
      setExportError("Add at least one weekly plan block before exporting.");
      return;
    }

    const result = generateWeeklyPlanIcs(planBlocks, exportWeekStart);

    if (result.exportedCount === 0) {
      setExportError(
        result.warnings[0] ?? "No valid weekly plan blocks were available to export.",
      );
      return;
    }

    const blob = new Blob([result.content], {
      type: "text/calendar;charset=utf-8",
    });
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "schedule-builder-weekly-plan.ics";
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.URL.revokeObjectURL(url);

    const warningText =
      result.warnings.length > 0
        ? ` ${result.warnings.join(" ")}`
        : result.skippedCount > 0
          ? ` ${result.skippedCount} block${result.skippedCount === 1 ? "" : "s"} skipped.`
          : "";

    setExportMessage(
      `Exported ${result.exportedCount} calendar event${result.exportedCount === 1 ? "" : "s"}.${warningText}`,
    );
  }

  function removeBlockWithAnimation(blockId: string) {
    if (exitingBlockIds[blockId]) {
      return;
    }

    setRemoveErrors((current) => {
      const next = { ...current };
      delete next[blockId];
      return next;
    });
    setExitingBlockIds((current) => ({ ...current, [blockId]: true }));

    removeTimers.current[blockId] = setTimeout(() => {
      void Promise.resolve(onRemoveBlock(blockId))
        .then(() => {
          setExitingBlockIds((current) => {
            const next = { ...current };
            delete next[blockId];
            return next;
          });
        })
        .catch((removeError: unknown) => {
          setExitingBlockIds((current) => {
            const next = { ...current };
            delete next[blockId];
            return next;
          });
          setRemoveErrors((current) => ({
            ...current,
            [blockId]: `Block could not be removed: ${getErrorMessage(removeError)}`,
          }));
        })
        .finally(() => {
          delete removeTimers.current[blockId];
        });
    }, weeklyBlockRemovalAnimationMs);
  }

  return (
    <section className="space-y-5 sm:space-y-6">
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <div className="metric-card">
            <p className="text-sm text-brand-ink/55">Planned hours</p>
            <p className="mt-2 text-2xl font-semibold text-brand-ink">
              {formatEstimatedHours(totalPlannedHours)}
            </p>
          </div>
          <div className="metric-card">
            <p className="text-sm text-brand-ink/55">Days filled</p>
            <p className="mt-2 text-2xl font-semibold text-brand-ink">
              {filledDays}
            </p>
          </div>
          <div className="metric-card">
            <p className="text-sm text-brand-ink/55">Work blocks</p>
            <p className="mt-2 text-2xl font-semibold text-brand-ink">
              {planBlocks.length}
            </p>
          </div>
          <div className="metric-card">
            <p className="text-sm text-brand-ink/55">Projects ready</p>
            <p className="mt-2 text-2xl font-semibold text-brand-ink">
              {projects.filter((project) => !project.completed).length}
            </p>
          </div>
        </div>

        <Card className="rounded-[28px] border-white/70 bg-white/84 sm:rounded-[32px]">
          <CardContent className="p-4 sm:p-6">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div className="flex items-start gap-3">
                <div className="rounded-2xl bg-brand-teal/10 p-2 text-brand-teal">
                  <PlusIcon className="h-5 w-5" />
                </div>
                <div>
                  <h2 className="text-lg font-semibold text-brand-ink sm:text-xl">
                    Plan a work block
                  </h2>
                  <p className="text-sm leading-6 text-brand-ink/60">
                    Choose a day, project, task, start time, and realistic time
                    estimate.
                  </p>
                </div>
              </div>
              <Button
                aria-expanded={isAddFormOpen}
                className="w-full sm:hidden"
                size="sm"
                type="button"
                variant="outline"
                onClick={() => setIsAddFormOpen((current) => !current)}
              >
                <PlusIcon className="h-4 w-4" />
                {isAddFormOpen ? "Close form" : "Add work block"}
              </Button>
            </div>

            <form
              className={`mt-5 gap-4 lg:grid-cols-[160px_minmax(0,1fr)_170px] ${
                isAddFormOpen ? "grid" : "hidden sm:grid"
              }`}
              onSubmit={handleSubmit}
            >
              <div>
                <label className="field-label" htmlFor="plan-day">
                  Day
                </label>
                <Select
                  id="plan-day"
                  value={draft.day}
                  onChange={(event) => {
                    setDraft((current) => ({
                      ...current,
                      day: event.target.value as WeekDay,
                    }));
                    clearDraftWarnings();
                  }}
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
                <label className="field-label" htmlFor="plan-start-time">
                  Start time
                  <span className="font-normal text-brand-ink/45"> optional</span>
                </label>
                <Input
                  id="plan-start-time"
                  type="time"
                  value={draft.startTime}
                  onChange={(event) => {
                    setDraft((current) => ({
                      ...current,
                      startTime: event.target.value,
                    }));
                    clearDraftWarnings();
                  }}
                />
              </div>

              <div className="lg:col-span-2">
                <label className="field-label" htmlFor="plan-task">
                  Planned task
                </label>
                <Input
                  id="plan-task"
                  placeholder="Draft the next deliverable"
                  value={draft.plannedTask}
                  onChange={(event) => {
                    setDraft((current) => ({
                      ...current,
                      plannedTask: event.target.value,
                    }));
                    clearDraftWarnings();
                  }}
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
                  onChange={(event) => {
                    setDraft((current) => ({
                      ...current,
                      estimatedHours: event.target.value,
                    }));
                    clearDraftWarnings();
                  }}
                />
              </div>

              <div className="flex items-end lg:col-span-3">
                <Button className="w-full" type="submit" disabled={!canAddBlock}>
                  <PlusIcon className="h-4 w-4" />
                  {isConfirmingDuplicate
                    ? "Add similar block anyway"
                    : "Add work block"}
                </Button>
              </div>

              {projectFocusMessage ? (
                <p className="rounded-[20px] border border-brand-teal/15 bg-brand-teal/[0.07] px-4 py-3 text-sm font-medium leading-6 text-brand-teal lg:col-span-3">
                  {projectFocusMessage}
                </p>
              ) : null}

              {error ? (
                <p className="rounded-[20px] border border-brand-coral/18 bg-brand-coral/[0.08] px-4 py-3 text-sm font-medium leading-6 text-brand-coral lg:col-span-3">
                  {error}
                </p>
              ) : null}
            </form>
          </CardContent>
        </Card>

        <div className="grid gap-4 lg:grid-cols-2 2xl:grid-cols-3">
          {weekDays.map((day) => {
            const dayBlocks = blocksByDay[day];
            const dayHours = dayBlocks.reduce(
              (sum, block) => sum + block.estimatedHours,
              0,
            );

            return (
              <Card
                key={day}
                className="overflow-hidden rounded-[30px] border-white/70 bg-white/86 shadow-[0_18px_45px_rgba(18,32,47,0.07)] sm:rounded-[34px]"
              >
                <CardContent className="p-4 sm:p-5">
                  <div className="mb-4 flex items-start justify-between gap-3 border-b border-brand-ink/8 pb-4">
                    <div>
                      <h3 className="text-xl font-semibold tracking-[-0.02em] text-brand-ink">
                        {day}
                      </h3>
                      <p className="mt-1 text-sm leading-6 text-brand-ink/55">
                        {dayBlocks.length} block{dayBlocks.length === 1 ? "" : "s"}
                      </p>
                    </div>
                    <Badge className="bg-brand-teal/8 text-brand-teal" variant="subtle">
                      {formatEstimatedHours(dayHours)}
                    </Badge>
                  </div>

                  <div className="space-y-3">
                    {dayBlocks.length > 0 ? (
                      dayBlocks.map((block, index) => (
                        <div
                          key={block.id}
                          className="weekly-block-shell"
                          data-exiting={
                            exitingBlockIds[block.id] ? "true" : "false"
                          }
                        >
                          <div
                            className="weekly-block-inner animate-weekly-block rounded-[24px] border border-brand-ink/8 bg-gradient-to-br from-white via-white to-brand-mist/55 p-4 shadow-[0_12px_28px_rgba(18,32,47,0.055)]"
                            style={{ animationDelay: `${index * 45}ms` }}
                          >
                            <div className="flex items-start justify-between gap-3">
                              <div className="flex min-w-0 items-start gap-3">
                                <div className="rounded-2xl bg-brand-teal/10 p-2 text-brand-teal">
                                  <TargetIcon className="h-4 w-4" />
                                </div>
                                <div className="min-w-0">
                                  <p className="truncate text-sm font-semibold text-brand-ink">
                                    {block.projectName}
                                  </p>
                                  <p className="mt-1 text-sm leading-6 text-brand-ink/68">
                                    {block.plannedTask}
                                  </p>
                                </div>
                              </div>
                              <Button
                                aria-label={`Remove ${block.projectName} from ${day}`}
                                className="h-9 shrink-0 px-3 text-xs text-brand-ink/50 hover:bg-brand-coral/10 hover:text-brand-coral"
                                disabled={Boolean(exitingBlockIds[block.id])}
                                size="sm"
                                variant="secondary"
                                onClick={() => removeBlockWithAnimation(block.id)}
                              >
                                {exitingBlockIds[block.id] ? "..." : "Remove"}
                              </Button>
                            </div>

                            {removeErrors[block.id] ? (
                              <p className="mt-3 rounded-2xl border border-brand-coral/18 bg-brand-coral/[0.08] px-3 py-2 text-xs font-medium leading-5 text-brand-coral">
                                {removeErrors[block.id]}
                              </p>
                            ) : null}

                            <div className="mt-3 flex flex-wrap gap-2">
                              <span className="inline-flex items-center gap-2 rounded-full bg-brand-teal/[0.075] px-3 py-1.5 text-xs font-semibold text-brand-teal">
                                <ClockIcon className="h-4 w-4" />
                                {formatStartTime(block.startTime)}
                              </span>
                              <span className="inline-flex items-center gap-2 rounded-full bg-brand-ink/[0.045] px-3 py-1.5 text-xs font-semibold text-brand-ink/58">
                                <ClockIcon className="h-4 w-4" />
                                {formatEstimatedHours(block.estimatedHours)}
                              </span>
                            </div>
                          </div>
                        </div>
                      ))
                    ) : (
                      <div className="rounded-[24px] border border-dashed border-brand-ink/12 bg-white/55 p-4">
                        <p className="text-sm font-semibold text-brand-ink/70">
                          Open day
                        </p>
                        <p className="mt-1 text-sm leading-6 text-brand-ink/55">
                          Add a focused block when this day needs dedicated
                          planning time.
                        </p>
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>

        <Card className="rounded-[28px] border-white/70 bg-white/84 sm:rounded-[32px]">
          <CardContent className="p-4 sm:p-6">
            <div className="flex items-start gap-3">
              <div className="rounded-2xl bg-brand-ocean/10 p-2 text-brand-ocean">
                <CalendarIcon className="h-5 w-5" />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-brand-ink sm:text-xl">
                  Export your weekly plan
                </h2>
                <p className="mt-1 text-sm leading-6 text-brand-ink/60">
                  Download an .ics file for Apple Calendar, Google Calendar, or
                  Outlook.
                </p>
              </div>
            </div>

            <div className="mt-5">
              <label className="field-label" htmlFor="export-week-start">
                Week start date
              </label>
              <Input
                id="export-week-start"
                type="date"
                value={exportWeekStart}
                onChange={(event) => {
                  setExportWeekStart(event.target.value);
                  setExportError(null);
                  setExportMessage(null);
                }}
              />
              <p className="mt-2 text-sm leading-6 text-brand-ink/55">
                Choose the Monday for this weekly plan. Blocks with start times
                export at their scheduled time. Blocks without start times use
                the default 9:00 AM order.
              </p>
            </div>

            {exportError ? (
              <p className="mt-3 rounded-2xl border border-brand-coral/18 bg-brand-coral/[0.08] px-3 py-2 text-sm font-medium leading-6 text-brand-coral">
                {exportError}
              </p>
            ) : null}

            {exportMessage ? (
              <p className="mt-3 rounded-2xl border border-brand-teal/15 bg-brand-teal/[0.07] px-3 py-2 text-sm font-medium leading-6 text-brand-teal">
                {exportMessage}
              </p>
            ) : null}

            <Button
              className="mt-4 w-full"
              type="button"
              onClick={handleCalendarExport}
            >
              Export to Calendar
            </Button>
          </CardContent>
        </Card>
    </section>
  );
}

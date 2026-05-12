"use client";

import type { FormEvent } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  CalendarIcon,
  ClockIcon,
  PlusIcon,
  TargetIcon,
  TrashIcon,
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
import { cn } from "@/lib/utils";

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

type FormTarget = "quick" | WeekDay;

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
  const [activeDayForm, setActiveDayForm] = useState<WeekDay | null>(null);
  const [duplicateWarningKey, setDuplicateWarningKey] = useState<string | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  const [errorTarget, setErrorTarget] = useState<FormTarget | null>(null);
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
    setIsAddFormOpen(true);
    setActiveDayForm(null);
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
            return (
              first.startMinutes - second.startMinutes ||
              first.index - second.index
            );
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

  const duplicateCountsByBlockId = useMemo(() => {
    const countsByKey = new Map<string, number>();

    planBlocks.forEach((block) => {
      const blockKey = getBlockIdentityKey(block);
      countsByKey.set(blockKey, (countsByKey.get(blockKey) ?? 0) + 1);
    });

    return planBlocks.reduce<Record<string, number>>((acc, block) => {
      acc[block.id] = countsByKey.get(getBlockIdentityKey(block)) ?? 1;
      return acc;
    }, {});
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
      setErrorTarget(null);
    }
  }

  function showFormError(target: FormTarget, message: string) {
    setError(message);
    setErrorTarget(target);
  }

  function getProjectForDraft(projectId: string) {
    return projects.find((project) => String(project.id) === projectId);
  }

  function openQuickAddForm() {
    setIsAddFormOpen((current) => !current);
    setActiveDayForm(null);
    clearDraftWarnings();
  }

  function openDayForm(day: WeekDay) {
    const shouldCloseForm = activeDayForm === day;

    setIsAddFormOpen(false);
    setActiveDayForm(shouldCloseForm ? null : day);

    if (!shouldCloseForm) {
      setDraft((draftState) => {
        const draftProject =
          getProjectForDraft(draftState.projectId) ?? projects[0] ?? null;

        return {
          ...draftState,
          day,
          projectId: draftProject ? String(draftProject.id) : "",
          plannedTask:
            draftState.plannedTask.trim() || draftProject?.nextAction || "",
        };
      });
      clearDraftWarnings();
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

  function handleSubmit(event: FormEvent<HTMLFormElement>, target: FormTarget) {
    event.preventDefault();

    if (!selectedProject) {
      showFormError(
        target,
        "Add a project first, then schedule a weekly work block.",
      );
      return;
    }

    if (!hasValidDraftStartTime) {
      showFormError(
        target,
        "Choose a valid start time or leave the start time blank.",
      );
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
      showFormError(
        target,
        "Add a task and a positive time estimate before saving.",
      );
      return;
    }

    const nextBlockKey = getBlockIdentityKey(planBlock);

    if (
      planBlocks.some((block) => getBlockIdentityKey(block) === nextBlockKey) &&
      duplicateWarningKey !== nextBlockKey
    ) {
      setDuplicateWarningKey(nextBlockKey);
      showFormError(
        target,
        "That day already has this project and task. Edit the existing block, or click Add anyway if you really want another copy.",
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
    if (target === "quick") {
      setIsAddFormOpen(false);
    } else {
      setActiveDayForm(null);
    }
    setDuplicateWarningKey(null);
    setError(null);
    setErrorTarget(null);
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

  function renderPlanBlock(
    block: WeeklyPlanBlock,
    day: WeekDay,
    index: number,
    isTimed: boolean,
    duplicateCount: number,
  ) {
    const timeLabel = isTimed ? formatStartTime(block.startTime) : "Flexible";

    return (
      <div
        key={block.id}
        className="weekly-block-shell"
        data-exiting={exitingBlockIds[block.id] ? "true" : "false"}
      >
        <div
          className={cn(
            "weekly-block-inner animate-weekly-block rounded-[24px] border p-4 shadow-[0_12px_28px_rgba(18,32,47,0.045)]",
            isTimed
              ? "border-brand-teal/14 bg-gradient-to-br from-white via-white to-brand-teal/[0.055]"
              : "border-brand-ink/8 bg-gradient-to-br from-white via-white to-brand-mist/55",
          )}
          style={{ animationDelay: `${index * 45}ms` }}
        >
          <div className="flex items-start gap-3">
            <div
              className={cn(
                "mt-0.5 hidden rounded-2xl p-2 sm:block",
                isTimed
                  ? "bg-brand-teal/10 text-brand-teal"
                  : "bg-brand-ink/[0.045] text-brand-ink/52",
              )}
            >
              <TargetIcon className="h-4 w-4" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-base font-semibold tracking-[-0.02em] text-brand-ink">
                    {block.projectName}
                  </p>
                  <p className="mt-1 text-sm leading-6 text-brand-ink/68">
                    {block.plannedTask}
                  </p>
                </div>
                <Button
                  aria-label={`Remove ${block.projectName} from ${day}`}
                  className="h-11 w-11 shrink-0 rounded-full border border-brand-ink/10 bg-white/85 p-0 text-brand-ink/58 shadow-[0_8px_18px_rgba(18,32,47,0.06)] hover:border-brand-coral/20 hover:bg-brand-coral/10 hover:text-brand-coral"
                  disabled={Boolean(exitingBlockIds[block.id])}
                  size="sm"
                  title={`Remove ${block.projectName}`}
                  type="button"
                  variant="secondary"
                  onClick={() => removeBlockWithAnimation(block.id)}
                >
                  <TrashIcon aria-hidden="true" className="h-5 w-5" />
                  <span className="sr-only">Remove block</span>
                </Button>
              </div>

              {removeErrors[block.id] ? (
                <p className="mt-3 rounded-2xl border border-brand-coral/18 bg-brand-coral/[0.08] px-3 py-2 text-xs font-medium leading-5 text-brand-coral">
                  {removeErrors[block.id]}
                </p>
              ) : null}

              <div className="mt-3 flex flex-wrap gap-2">
                <span
                  className={cn(
                    "inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-semibold",
                    isTimed
                      ? "bg-brand-teal/[0.085] text-brand-teal"
                      : "bg-brand-ink/[0.045] text-brand-ink/58",
                  )}
                >
                  <ClockIcon className="h-4 w-4" />
                  {timeLabel}
                  <span className="text-brand-ink/25">•</span>
                  {formatEstimatedHours(block.estimatedHours)}
                </span>
                {duplicateCount > 1 ? (
                  <span className="inline-flex items-center rounded-full border border-brand-ink/8 bg-brand-ink/[0.035] px-3 py-1.5 text-xs font-semibold text-brand-ink/45">
                    Similar block appears {duplicateCount} times
                  </span>
                ) : null}
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  function renderBlockForm(target: FormTarget, showDayField: boolean) {
    const fieldSuffix = target === "quick" ? "quick" : target.toLowerCase();
    const shouldShowError = error && errorTarget === target;

    return (
      <form
        className={
          showDayField
            ? "mt-5 grid gap-4 lg:grid-cols-[160px_minmax(0,1fr)_170px]"
            : "mt-4 space-y-3"
        }
        onSubmit={(event) => handleSubmit(event, target)}
      >
        {showDayField ? (
          <div>
            <label className="field-label" htmlFor={`plan-day-${fieldSuffix}`}>
              Day
            </label>
            <Select
              id={`plan-day-${fieldSuffix}`}
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
        ) : null}

        <div>
          <label className="field-label" htmlFor={`plan-project-${fieldSuffix}`}>
            Project
          </label>
          <Select
            id={`plan-project-${fieldSuffix}`}
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

        <div className={showDayField ? "lg:col-span-2" : ""}>
          <label className="field-label" htmlFor={`plan-task-${fieldSuffix}`}>
            Planned task
          </label>
          <Input
            id={`plan-task-${fieldSuffix}`}
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

        <div className={showDayField ? "" : "grid gap-3"}>
          <div>
            <label
              className="field-label"
              htmlFor={`plan-start-time-${fieldSuffix}`}
            >
              Start
              <span className="font-normal text-brand-ink/45"> optional</span>
            </label>
            <Input
              id={`plan-start-time-${fieldSuffix}`}
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

          {!showDayField ? (
            <div>
              <label className="field-label" htmlFor={`plan-hours-${fieldSuffix}`}>
                Hours
              </label>
              <Input
                id={`plan-hours-${fieldSuffix}`}
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
          ) : null}
        </div>

        {showDayField ? (
          <div>
            <label className="field-label" htmlFor={`plan-hours-${fieldSuffix}`}>
              Estimated time
            </label>
            <Input
              id={`plan-hours-${fieldSuffix}`}
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
        ) : null}

        <div
          className={
            showDayField
              ? "flex items-end lg:col-span-3"
              : "grid grid-cols-2 gap-2"
          }
        >
          {showDayField ? null : (
            <Button
              className="w-full"
              size="sm"
              type="button"
              variant="outline"
              onClick={() => setActiveDayForm(null)}
            >
              Cancel
            </Button>
          )}
          <Button
            className="w-full"
            size={showDayField ? "default" : "sm"}
            type="submit"
            disabled={!canAddBlock}
          >
            <PlusIcon className="h-4 w-4" />
            {isConfirmingDuplicate ? "Add anyway" : "Add block"}
          </Button>
        </div>

        {projectFocusMessage && target === "quick" ? (
          <p className="rounded-[20px] border border-brand-teal/15 bg-brand-teal/[0.07] px-4 py-3 text-sm font-medium leading-6 text-brand-teal lg:col-span-3">
            {projectFocusMessage}
          </p>
        ) : null}

        {shouldShowError ? (
          <p className="rounded-[20px] border border-brand-coral/18 bg-brand-coral/[0.08] px-4 py-3 text-sm font-medium leading-6 text-brand-coral lg:col-span-3">
            {error}
          </p>
        ) : null}
      </form>
    );
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

      <Card className="rounded-[24px] border-white/70 bg-white/78 sm:rounded-[28px]">
        <CardContent className="p-4 sm:p-5">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex items-start gap-3">
              <div className="rounded-2xl bg-brand-teal/10 p-2 text-brand-teal">
                <PlusIcon className="h-5 w-5" />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-brand-ink sm:text-xl">
                  Quick add block
                </h2>
                <p className="text-sm leading-6 text-brand-ink/60">
                  Add a block quickly, or use a day card below.
                </p>
              </div>
            </div>
            <Button
              aria-expanded={isAddFormOpen}
              className="w-full sm:w-auto"
              size="sm"
              type="button"
              variant="outline"
              onClick={openQuickAddForm}
            >
              <PlusIcon className="h-4 w-4" />
              {isAddFormOpen ? "Close quick add" : "Open quick add"}
            </Button>
          </div>

          {isAddFormOpen ? (
            renderBlockForm("quick", true)
          ) : null}
        </CardContent>
      </Card>

      <div className="grid gap-5 lg:grid-cols-2 2xl:grid-cols-3">
        {weekDays.map((day) => {
          const dayBlocks = blocksByDay[day];
          const timedBlocks = dayBlocks.filter(
            (block) => parseStartTimeToMinutes(block.startTime) !== null,
          );
          const flexibleBlocks = dayBlocks.filter(
            (block) => parseStartTimeToMinutes(block.startTime) === null,
          );
          const dayHours = dayBlocks.reduce(
            (sum, block) => sum + block.estimatedHours,
            0,
          );

          return (
            <Card
              key={day}
              className="h-full overflow-hidden rounded-[30px] border-white/70 bg-white/88 shadow-[0_18px_45px_rgba(18,32,47,0.065)] sm:rounded-[34px]"
            >
              <CardContent className="flex h-full flex-col p-4 sm:p-5 lg:p-6">
                <div className="mb-4 flex flex-col gap-4 border-b border-brand-ink/8 pb-4 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <h3 className="text-xl font-semibold tracking-[-0.02em] text-brand-ink">
                      {day}
                    </h3>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <Badge variant="subtle">
                        {dayBlocks.length} block
                        {dayBlocks.length === 1 ? "" : "s"}
                      </Badge>
                      <Badge
                        className="bg-brand-teal/8 text-brand-teal"
                        variant="subtle"
                      >
                        {formatEstimatedHours(dayHours)}
                      </Badge>
                    </div>
                  </div>
                  {activeDayForm === day ? (
                    <Button
                      className="h-10 px-4 text-sm sm:w-auto"
                      size="sm"
                      type="button"
                      variant="secondary"
                      onClick={() => setActiveDayForm(null)}
                    >
                      Close
                    </Button>
                  ) : (
                    <Button
                      className="w-full border-dashed sm:w-auto"
                      size="sm"
                      type="button"
                      variant="outline"
                      onClick={() => openDayForm(day)}
                    >
                      <PlusIcon className="h-4 w-4" />
                      Add to {day}
                    </Button>
                  )}
                </div>

                <div className="flex flex-1 flex-col gap-4">
                  {activeDayForm === day ? (
                    <div className="rounded-[24px] border border-brand-teal/18 bg-brand-teal/[0.045] p-3 sm:p-4">
                      <div>
                        <p className="text-sm font-semibold text-brand-ink">
                          Add to {day}
                        </p>
                        <p className="text-xs leading-5 text-brand-ink/52">
                          Pick a project, task, time, and duration.
                        </p>
                      </div>
                      {renderBlockForm(day, false)}
                    </div>
                  ) : null}

                  {dayBlocks.length > 0 ? (
                    <div className="space-y-4">
                      {timedBlocks.length > 0 ? (
                        <div className="space-y-2">
                          <div className="flex items-center gap-2 px-1">
                            <span className="h-1.5 w-1.5 rounded-full bg-brand-teal" />
                            <p className="text-[0.68rem] font-bold uppercase tracking-[0.22em] text-brand-teal">
                              Timed
                            </p>
                          </div>
                          <div className="space-y-2">
                            {timedBlocks.map((block, index) =>
                              renderPlanBlock(
                                block,
                                day,
                                index,
                                true,
                                duplicateCountsByBlockId[block.id] ?? 1,
                              ),
                            )}
                          </div>
                        </div>
                      ) : null}

                      {flexibleBlocks.length > 0 ? (
                        <div className="space-y-2">
                          <div className="flex items-center gap-2 px-1">
                            <span className="h-1.5 w-1.5 rounded-full bg-brand-ink/30" />
                            <p className="text-[0.68rem] font-bold uppercase tracking-[0.22em] text-brand-ink/45">
                              Anytime
                            </p>
                          </div>
                          <div className="space-y-2">
                            {flexibleBlocks.map((block, index) =>
                              renderPlanBlock(
                                block,
                                day,
                                timedBlocks.length + index,
                                false,
                                duplicateCountsByBlockId[block.id] ?? 1,
                              ),
                            )}
                          </div>
                        </div>
                      ) : null}
                    </div>
                  ) : (
                    <div className="rounded-[24px] border border-dashed border-brand-ink/12 bg-white/55 p-4">
                      <p className="text-sm font-semibold text-brand-ink/70">
                        Open day
                      </p>
                      <p className="mt-1 text-sm leading-6 text-brand-ink/55">
                        Add a focused block when this day needs structure.
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
              export at their scheduled time. Blocks without start times use the
              default 9:00 AM order.
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

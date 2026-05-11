"use client";

import type { FormEvent } from "react";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  CalendarIcon,
  CheckCircleIcon,
  ClockIcon,
  TargetIcon,
} from "@/components/projects/icons";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import {
  categoryStyles,
  priorityStyles,
  priorityLevels,
  projectCategories,
  type Project,
  type ProjectCategory,
  type ProjectPriority,
} from "@/lib/projects";
import { cn } from "@/lib/utils";

type ProjectEditDraft = {
  category: ProjectCategory;
  deadline: string;
  name: string;
  nextAction: string;
  priority: ProjectPriority;
  weeklyHours: string;
};

type ProjectCardProps = {
  animationIndex?: number;
  deleteError?: string;
  isExiting?: boolean;
  onDeleteProject: (id: number) => void;
  onToggleComplete: (id: number) => void;
  onUpdateProject: (project: Project) => void;
  project: Project;
};

function createDraftFromProject(project: Project): ProjectEditDraft {
  return {
    category: project.category,
    deadline: project.deadline,
    name: project.name,
    nextAction: project.nextAction,
    priority: project.priority,
    weeklyHours: String(project.weeklyHours),
  };
}

function getProjectValidationMessage(draft: ProjectEditDraft) {
  const weeklyHours = Number(draft.weeklyHours);

  if (!draft.name.trim()) {
    return "Project name cannot be empty.";
  }

  if (!draft.nextAction.trim()) {
    return "Add the next clear action before saving.";
  }

  if (!draft.weeklyHours.trim() || !Number.isFinite(weeklyHours) || weeklyHours < 0) {
    return "Weekly hours must be 0 or greater.";
  }

  return null;
}

function updateDraftField<Key extends keyof ProjectEditDraft>(
  draft: ProjectEditDraft,
  field: Key,
  value: ProjectEditDraft[Key],
) {
  return { ...draft, [field]: value };
}

export function ProjectCard({
  animationIndex = 0,
  deleteError,
  isExiting = false,
  onDeleteProject,
  onToggleComplete,
  onUpdateProject,
  project,
}: ProjectCardProps) {
  const [draft, setDraft] = useState<ProjectEditDraft>(() =>
    createDraftFromProject(project),
  );
  const [error, setError] = useState<string | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [isConfirmingDelete, setIsConfirmingDelete] = useState(false);
  const [isShowingMoreActions, setIsShowingMoreActions] = useState(false);

  useEffect(() => {
    setDraft(createDraftFromProject(project));
    setError(null);
    setIsEditing(false);
    setIsConfirmingDelete(false);
    setIsShowingMoreActions(false);
  }, [
    project.category,
    project.completed,
    project.deadline,
    project.id,
    project.name,
    project.nextAction,
    project.priority,
    project.weeklyHours,
  ]);

  const validationMessage = useMemo(
    () => getProjectValidationMessage(draft),
    [draft],
  );
  const hasDeadline = project.deadline.trim().length > 0;
  const planHref = `/plan?project=${encodeURIComponent(String(project.id))}`;

  function updateField<Key extends keyof ProjectEditDraft>(
    field: Key,
    value: ProjectEditDraft[Key],
  ) {
    setDraft((current) => updateDraftField(current, field, value));
    if (error) {
      setError(null);
    }
  }

  function cancelEditing() {
    setDraft(createDraftFromProject(project));
    setError(null);
    setIsEditing(false);
  }

  function handleSave(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const nextError = getProjectValidationMessage(draft);

    if (nextError) {
      setError(nextError);
      return;
    }

    onUpdateProject({
      ...project,
      category: draft.category,
      deadline: draft.deadline.trim(),
      name: draft.name.trim(),
      nextAction: draft.nextAction.trim(),
      priority: draft.priority,
      weeklyHours: Number(draft.weeklyHours),
    });
    setError(null);
    setIsEditing(false);
  }

  return (
    <div
      aria-hidden={isExiting}
      className="project-card-shell"
      data-exiting={isExiting ? "true" : "false"}
      style={{ animationDelay: `${animationIndex * 55}ms` }}
    >
      <article
        className={cn(
          "project-card-inner animate-project-card group overflow-hidden rounded-[28px] border border-white/75 bg-white/88 p-4 shadow-[0_18px_46px_rgba(18,32,47,0.07)] transition duration-200 hover:-translate-y-0.5 hover:bg-white hover:shadow-[0_24px_56px_rgba(18,32,47,0.1)] sm:rounded-[32px] sm:p-5",
          project.completed && "bg-white/68 opacity-80",
          isExiting && "pointer-events-none",
        )}
      >
      {isEditing ? (
        <form className="space-y-4" onSubmit={handleSave}>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.16em] text-brand-ink/40">
                Edit project
              </p>
              <h3 className="mt-1 text-xl font-semibold tracking-[-0.02em] text-brand-ink">
                Keep the plan current
              </h3>
            </div>
            <Badge variant="subtle">Changes sync automatically</Badge>
          </div>

          <div className="grid gap-4">
            <label className="block">
              <span className="field-label">Project name</span>
              <Input
                value={draft.name}
                onChange={(event) => updateField("name", event.target.value)}
              />
            </label>

            <label className="block">
              <span className="field-label">Next action</span>
              <Input
                value={draft.nextAction}
                onChange={(event) =>
                  updateField("nextAction", event.target.value)
                }
              />
            </label>

            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block">
                <span className="field-label">Deadline</span>
                <Input
                  value={draft.deadline}
                  onChange={(event) =>
                    updateField("deadline", event.target.value)
                  }
                />
              </label>

              <label className="block">
                <span className="field-label">Weekly hours</span>
                <Input
                  inputMode="decimal"
                  min="0"
                  step="0.25"
                  type="number"
                  value={draft.weeklyHours}
                  onChange={(event) =>
                    updateField("weeklyHours", event.target.value)
                  }
                />
              </label>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block">
                <span className="field-label">Category</span>
                <Select
                  value={draft.category}
                  onChange={(event) =>
                    updateField("category", event.target.value as ProjectCategory)
                  }
                >
                  {projectCategories.map((category) => (
                    <option key={category} value={category}>
                      {category}
                    </option>
                  ))}
                </Select>
              </label>

              <label className="block">
                <span className="field-label">Priority</span>
                <Select
                  value={draft.priority}
                  onChange={(event) =>
                    updateField("priority", event.target.value as ProjectPriority)
                  }
                >
                  {priorityLevels.map((priority) => (
                    <option key={priority} value={priority}>
                      {priority}
                    </option>
                  ))}
                </Select>
              </label>
            </div>
          </div>

          {error ?? validationMessage ? (
            <p className="rounded-2xl border border-brand-coral/20 bg-brand-coral/10 px-4 py-3 text-sm font-medium leading-6 text-brand-coral">
              {error ?? validationMessage}
            </p>
          ) : null}

          <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
            <Button variant="secondary" onClick={cancelEditing}>
              Cancel
            </Button>
            <Button type="submit" disabled={Boolean(validationMessage)}>
              Save changes
            </Button>
          </div>
        </form>
      ) : (
        <div className="space-y-4">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0 space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <h3
                  className={cn(
                    "max-w-full text-2xl font-semibold leading-tight tracking-[-0.035em] text-brand-ink sm:text-3xl",
                    project.completed && "line-through decoration-brand-ink/25",
                  )}
                >
                  {project.name}
                </h3>
              </div>

              <div className="flex flex-wrap gap-2">
                <span
                  className={cn(
                    "rounded-full border px-3 py-1 text-xs font-semibold",
                    priorityStyles[project.priority],
                  )}
                >
                  {project.priority}
                </span>
                <span
                  className={cn(
                    "rounded-full border px-3 py-1 text-xs font-semibold",
                    categoryStyles[project.category],
                  )}
                >
                  {project.category}
                </span>
                <span className="inline-flex items-center gap-1.5 rounded-full border border-brand-ink/8 bg-white/78 px-3 py-1 text-xs font-semibold text-brand-ink/62">
                  <CalendarIcon className="h-3.5 w-3.5" />
                  {hasDeadline ? project.deadline : "No deadline"}
                </span>
              </div>
            </div>

            <div className="flex items-center gap-2 self-start rounded-[22px] border border-brand-ink/6 bg-brand-ink/[0.025] px-3 py-2 text-sm font-semibold text-brand-ink">
              <ClockIcon className="h-4 w-4 text-brand-ink/45" />
              {project.weeklyHours} hrs
              {project.completed ? (
                <Badge className="ml-1" variant="subtle">
                  Done
                </Badge>
              ) : null}
            </div>
          </div>

          <div className="rounded-[24px] border border-brand-teal/12 bg-gradient-to-br from-brand-teal/[0.08] to-white/70 p-4">
            <div className="flex items-start gap-3">
              <div className="rounded-2xl bg-brand-teal/10 p-2 text-brand-teal">
                <TargetIcon className="h-4 w-4" />
              </div>
              <div className="min-w-0">
                <p className="text-xs font-bold uppercase tracking-[0.16em] text-brand-teal">
                  Next action
                </p>
                <p className="mt-1 text-sm font-semibold leading-6 text-brand-ink sm:text-base">
                  {project.nextAction}
                </p>
              </div>
            </div>
          </div>

          {deleteError ? (
            <p className="rounded-[20px] border border-brand-coral/20 bg-brand-coral/10 px-4 py-3 text-sm font-medium leading-6 text-brand-coral">
              {deleteError}
            </p>
          ) : null}

          {isConfirmingDelete ? (
            <div className="rounded-[22px] border border-brand-coral/20 bg-brand-coral/[0.08] p-4">
              <p className="text-sm font-semibold text-brand-ink">
                Delete this project?
              </p>
              <p className="mt-1 text-sm leading-6 text-brand-ink/60">
                This removes it from your project list. Existing weekly plan
                blocks stay in your plan until you remove them there.
              </p>
              <div className="mt-3 flex flex-col gap-2 sm:flex-row">
                <Button
                  className="text-brand-coral transition hover:text-brand-coral active:scale-[0.98]"
                  disabled={isExiting}
                  variant="outline"
                  onClick={() => onDeleteProject(project.id)}
                >
                  {isExiting ? "Removing..." : "Delete project"}
                </Button>
                <Button
                  disabled={isExiting}
                  variant="secondary"
                  onClick={() => setIsConfirmingDelete(false)}
                >
                  Keep project
                </Button>
              </div>
            </div>
          ) : null}

          {isShowingMoreActions && !isConfirmingDelete ? (
            <div className="rounded-[22px] border border-brand-ink/8 bg-white/64 p-4">
              <p className="text-sm font-semibold text-brand-ink">
                More options
              </p>
              <p className="mt-1 text-sm leading-6 text-brand-ink/58">
                Delete is tucked away here so it takes an intentional extra
                step. Archive can be added later.
              </p>
              <Button
                className="mt-3 text-brand-coral transition hover:text-brand-coral active:scale-[0.98]"
                disabled={isExiting}
                size="sm"
                variant="outline"
                onClick={() => setIsConfirmingDelete(true)}
              >
                Remove project
              </Button>
            </div>
          ) : null}

          <div className="flex flex-wrap gap-2 border-t border-brand-ink/6 pt-4">
            {!project.completed ? (
              <Link
                className="inline-flex h-10 items-center justify-center gap-2 rounded-2xl bg-brand-ink px-4 text-sm font-semibold text-white shadow-[0_16px_40px_rgba(18,32,47,0.18)] transition hover:-translate-y-0.5 hover:bg-brand-teal"
                href={planHref}
              >
                Add to plan
              </Link>
            ) : null}

            <Button
              size="sm"
              variant="outline"
              disabled={isExiting}
              onClick={() => setIsEditing(true)}
            >
              Edit
            </Button>

            <Button
              size="sm"
              variant={project.completed ? "secondary" : "outline"}
              disabled={isExiting}
              onClick={() => onToggleComplete(project.id)}
            >
              <CheckCircleIcon className="h-4 w-4" />
              {project.completed ? "Undo" : "Done"}
            </Button>

            <Button
              size="sm"
              variant="secondary"
              disabled={isExiting}
              onClick={() => {
                setIsShowingMoreActions((current) => !current);
                setIsConfirmingDelete(false);
              }}
            >
              More
            </Button>
          </div>
        </div>
      )}
      </article>
    </div>
  );
}

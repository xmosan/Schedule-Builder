"use client";

import type { FormEvent } from "react";
import { useMemo, useState } from "react";
import { PlusIcon } from "@/components/projects/icons";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import {
  createProjectFromDraft,
  defaultProjectDraft,
  priorityLevels,
  projectCategories,
  type Project,
  type ProjectDraft,
} from "@/lib/projects";
import { cn } from "@/lib/utils";

type AddProjectFormProps = {
  onAddProject: (project: Project) => void;
};

export function AddProjectForm({ onAddProject }: AddProjectFormProps) {
  const [draft, setDraft] = useState<ProjectDraft>(defaultProjectDraft);
  const [error, setError] = useState<string | null>(null);
  const [isExpanded, setIsExpanded] = useState(false);

  const canSubmit = useMemo(() => {
    const weeklyHours = Number(draft.weeklyHours);

    return (
      draft.name.trim().length > 0 &&
      draft.nextAction.trim().length > 0 &&
      draft.weeklyHours.trim().length > 0 &&
      Number.isFinite(weeklyHours) &&
      weeklyHours >= 0
    );
  }, [draft]);

  function updateField<Key extends keyof ProjectDraft>(
    field: Key,
    value: ProjectDraft[Key],
  ) {
    setDraft((current) => ({ ...current, [field]: value }));
    if (error) {
      setError(null);
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const project = createProjectFromDraft(draft);

    if (!project) {
      setError("Add a project name, a clear next action, and 0 or more weekly hours.");
      return;
    }

    onAddProject(project);
    setDraft(defaultProjectDraft);
    setError(null);
    setIsExpanded(false);
  }

  return (
    <Card className="rounded-[28px] border-white/70 bg-white/84 sm:rounded-[32px]">
      <CardContent className="p-4 sm:p-6">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <div className="rounded-2xl bg-brand-coral/10 p-2 text-brand-coral">
              <PlusIcon className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-brand-ink sm:text-xl">
                Start a Project
              </h2>
              <p className="text-sm text-brand-ink/60">
                Turn a goal, course, client, or team effort into something you
                can plan.
              </p>
            </div>
          </div>
          {!isExpanded ? (
            <Button
              className="shrink-0 xl:hidden"
              size="sm"
              onClick={() => setIsExpanded(true)}
            >
              + Add
            </Button>
          ) : null}
        </div>

        {!isExpanded ? (
          <p className="mt-4 rounded-[22px] border border-brand-ink/8 bg-white/62 p-4 text-sm leading-6 text-brand-ink/58 xl:hidden">
            Start with a name, one next action, and a realistic time budget.
          </p>
        ) : null}

        <form
          className={cn(
            "mt-5 space-y-4 sm:space-y-5",
            isExpanded ? "block" : "hidden xl:block",
          )}
          onSubmit={handleSubmit}
        >
          <div>
            <label className="field-label" htmlFor="project-name">
              What are you working on?
            </label>
            <Input
              id="project-name"
              placeholder="Launch campaign, finish course, plan event..."
              value={draft.name}
              onChange={(event) => updateField("name", event.target.value)}
            />
          </div>

          <div>
            <label className="field-label" htmlFor="project-next-action">
              What is the next clear action?
            </label>
            <Input
              id="project-next-action"
              placeholder="Draft the outline, email the client, finish problem set..."
              value={draft.nextAction}
              onChange={(event) =>
                updateField("nextAction", event.target.value)
              }
            />
          </div>

          <div>
            <label className="field-label" htmlFor="project-deadline">
              When does this need attention?
            </label>
            <Input
              id="project-deadline"
              placeholder="Friday, this week, before the meeting..."
              value={draft.deadline}
              onChange={(event) => updateField("deadline", event.target.value)}
            />
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="field-label" htmlFor="project-category">
                Category
              </label>
              <Select
                id="project-category"
                value={draft.category}
                onChange={(event) =>
                  updateField("category", event.target.value as ProjectDraft["category"])
                }
              >
                {projectCategories.map((category) => (
                  <option key={category} value={category}>
                    {category}
                  </option>
                ))}
              </Select>
            </div>

            <div>
              <label className="field-label" htmlFor="project-priority">
                Priority
              </label>
              <Select
                id="project-priority"
                value={draft.priority}
                onChange={(event) =>
                  updateField("priority", event.target.value as ProjectDraft["priority"])
                }
              >
                {priorityLevels.map((priority) => (
                  <option key={priority} value={priority}>
                    {priority}
                  </option>
                ))}
              </Select>
            </div>
          </div>

          <div>
            <label className="field-label" htmlFor="project-hours">
              How many hours this week?
            </label>
            <Input
              id="project-hours"
              type="number"
              min="0"
              step="0.25"
              inputMode="decimal"
              value={draft.weeklyHours}
              onChange={(event) =>
                updateField("weeklyHours", event.target.value)
              }
            />
          </div>

          <p className="text-sm leading-6 text-brand-ink/60">
            Keep it lightweight: one project, one next action, and a realistic time budget.
          </p>

          {error ? <p className="text-sm font-medium text-brand-coral">{error}</p> : null}

          <Button className="w-full" type="submit" disabled={!canSubmit}>
            Add project
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

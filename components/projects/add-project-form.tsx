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

type AddProjectFormProps = {
  onAddProject: (project: Project) => void;
};

export function AddProjectForm({ onAddProject }: AddProjectFormProps) {
  const [draft, setDraft] = useState<ProjectDraft>(defaultProjectDraft);
  const [error, setError] = useState<string | null>(null);

  const canSubmit = useMemo(() => {
    return (
      draft.name.trim().length > 0 &&
      draft.nextAction.trim().length > 0 &&
      Number(draft.weeklyHours) >= 1
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
      setError("Add a name, next action, and at least 1 weekly hour.");
      return;
    }

    onAddProject(project);
    setDraft(defaultProjectDraft);
    setError(null);
  }

  return (
    <Card className="rounded-[28px] border-white/70 bg-white/84 sm:rounded-[32px]">
      <CardContent className="p-4 sm:p-6">
        <div className="flex items-center gap-3">
          <div className="rounded-2xl bg-brand-coral/10 p-2 text-brand-coral">
            <PlusIcon className="h-5 w-5" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-brand-ink sm:text-xl">Add Project</h2>
            <p className="text-sm text-brand-ink/60">
              Keep each project small enough to move with one next action.
            </p>
          </div>
        </div>

        <form className="mt-5 space-y-4 sm:space-y-5" onSubmit={handleSubmit}>
          <div>
            <label className="field-label" htmlFor="project-name">
              Project name
            </label>
            <Input
              id="project-name"
              placeholder="Launch landing page refresh"
              value={draft.name}
              onChange={(event) => updateField("name", event.target.value)}
            />
          </div>

          <div>
            <label className="field-label" htmlFor="project-next-action">
              Next action
            </label>
            <Input
              id="project-next-action"
              placeholder="Write the hero copy draft"
              value={draft.nextAction}
              onChange={(event) =>
                updateField("nextAction", event.target.value)
              }
            />
          </div>

          <div>
            <label className="field-label" htmlFor="project-deadline">
              Deadline
            </label>
            <Input
              id="project-deadline"
              placeholder="Friday or end of month"
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
              Weekly hours
            </label>
            <Input
              id="project-hours"
              type="number"
              min="1"
              inputMode="numeric"
              value={draft.weeklyHours}
              onChange={(event) =>
                updateField("weeklyHours", event.target.value)
              }
            />
          </div>

          <p className="text-sm leading-6 text-brand-ink/60">
            Every project must include a next action so the dashboard always
            answers, &quot;What do I do next?&quot;
          </p>

          {error ? <p className="text-sm font-medium text-brand-coral">{error}</p> : null}

          <Button className="w-full" type="submit" disabled={!canSubmit}>
            Add to schedule
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

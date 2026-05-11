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
import {
  getSupabaseBrowserClient,
  isSupabaseConfigured,
} from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

type AddProjectFormProps = {
  onAddProject: (project: Project) => void;
};

type ProjectCreationMode = "assistant" | "manual";

type ProjectDraftResponse = {
  draft?: ProjectDraft;
  error?: string;
  message?: string;
  source?: "ai" | "fallback";
};

function isProjectDraft(value: unknown): value is ProjectDraft {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const candidate = value as Partial<ProjectDraft>;

  return (
    typeof candidate.name === "string" &&
    typeof candidate.nextAction === "string" &&
    typeof candidate.deadline === "string" &&
    typeof candidate.weeklyHours === "string" &&
    projectCategories.includes(candidate.category as ProjectDraft["category"]) &&
    priorityLevels.includes(candidate.priority as ProjectDraft["priority"])
  );
}

function getDraftErrorMessage(error: unknown) {
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

  return "Project draft could not be created. Try a shorter description.";
}

export function AddProjectForm({ onAddProject }: AddProjectFormProps) {
  const [assistantDescription, setAssistantDescription] = useState("");
  const [draftMessage, setDraftMessage] = useState<string | null>(null);
  const [draft, setDraft] = useState<ProjectDraft>(defaultProjectDraft);
  const [error, setError] = useState<string | null>(null);
  const [isDrafting, setIsDrafting] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const [mode, setMode] = useState<ProjectCreationMode>("manual");

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
    setDraftMessage(null);
    setIsExpanded(false);
  }

  async function createAssistantDraft() {
    const description = assistantDescription.trim();

    if (!description) {
      setError("Describe the project first, then I can draft the fields.");
      return;
    }

    setIsDrafting(true);
    setError(null);
    setDraftMessage(null);

    try {
      let accessToken: string | null = null;

      if (isSupabaseConfigured()) {
        const supabase = getSupabaseBrowserClient();
        const { data, error: sessionError } = await supabase.auth.getSession();

        if (sessionError || !data.session?.access_token) {
          throw new Error(sessionError?.message ?? "Sign in before using assistant draft.");
        }

        accessToken = data.session.access_token;
      }

      const response = await fetch("/api/projects/draft", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        },
        body: JSON.stringify({ description }),
      });
      const payload = (await response.json().catch(() => ({}))) as ProjectDraftResponse;

      if (!response.ok) {
        throw new Error(payload.error ?? "Project draft could not be created.");
      }

      if (!isProjectDraft(payload.draft)) {
        throw new Error("The assistant returned an invalid project draft.");
      }

      setDraft(payload.draft);
      setDraftMessage(
        payload.message ??
          "Project draft created. Review and edit before saving.",
      );
      setMode("manual");
      setIsExpanded(true);
    } catch (draftError) {
      setError(getDraftErrorMessage(draftError));
    } finally {
      setIsDrafting(false);
    }
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

        <div
          className={cn(
            "mt-5",
            isExpanded ? "block" : "hidden xl:block",
          )}
        >
          <div className="mb-5 grid grid-cols-2 gap-2 rounded-[22px] border border-brand-ink/8 bg-brand-ink/[0.025] p-2">
            {(["manual", "assistant"] as ProjectCreationMode[]).map((option) => (
              <button
                key={option}
                className={cn(
                  "h-10 rounded-2xl px-3 text-sm font-semibold transition active:scale-[0.98]",
                  mode === option
                    ? "bg-brand-ink text-white shadow-[0_12px_26px_rgba(18,32,47,0.14)]"
                    : "bg-white/70 text-brand-ink/65 hover:bg-white hover:text-brand-ink",
                )}
                type="button"
                onClick={() => {
                  setMode(option);
                  setError(null);
                }}
              >
                {option === "manual" ? "Manual" : "Assistant Draft"}
              </button>
            ))}
          </div>

          {mode === "assistant" ? (
            <div className="space-y-4">
              <div>
                <label className="field-label" htmlFor="project-assistant-description">
                  Describe the project
                </label>
                <textarea
                  className="min-h-32 w-full resize-y rounded-2xl border border-brand-ink/10 bg-white/82 px-4 py-3 text-base leading-6 text-brand-ink shadow-[inset_0_1px_0_rgba(255,255,255,0.65)] placeholder:text-brand-ink/36 focus:border-brand-teal/35 focus:bg-white"
                  id="project-assistant-description"
                  maxLength={1200}
                  placeholder="Describe what you’re working on…"
                  value={assistantDescription}
                  onChange={(event) => {
                    setAssistantDescription(event.target.value);
                    if (error) {
                      setError(null);
                    }
                  }}
                />
                <p className="mt-2 text-sm leading-6 text-brand-ink/55">
                  The assistant drafts fields only. Nothing is saved until you
                  review and save the project.
                </p>
              </div>

              {error ? (
                <p className="text-sm font-medium leading-6 text-brand-coral">
                  {error}
                </p>
              ) : null}

              <Button
                className="w-full"
                disabled={isDrafting || !assistantDescription.trim()}
                onClick={() => void createAssistantDraft()}
              >
                {isDrafting ? "Creating draft..." : "Create project draft"}
              </Button>
            </div>
          ) : (
            <form className="space-y-4 sm:space-y-5" onSubmit={handleSubmit}>
              {draftMessage ? (
                <p className="rounded-[22px] border border-brand-teal/15 bg-brand-teal/[0.07] p-4 text-sm font-medium leading-6 text-brand-teal">
                  {draftMessage}
                </p>
              ) : null}

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
            Save Project
          </Button>
            </form>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

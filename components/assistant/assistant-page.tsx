"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import {
  CalendarIcon,
  CheckCircleIcon,
  FolderStackIcon,
  TargetIcon,
} from "@/components/projects/icons";
import { SchedulerNav } from "@/components/scheduler/scheduler-nav";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  type AssistantPlanReviewResponse,
  type AssistantSuggestion,
  type AssistantSuggestionSeverity,
  type AssistantSuggestionType,
} from "@/lib/assistant";
import { getSupabaseBrowserClient, isSupabaseConfigured } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

type ReviewDecision = "pending" | "approved" | "rejected";
type AssistantStatus = "loading" | "ready" | "signed_out" | "error";

const examplePrompts = [
  "Help me plan this week around my active projects.",
  "Turn my top projects into weekly work blocks.",
  "Find overloaded days in my plan.",
];

const suggestionTypeLabels: Record<AssistantSuggestionType, string> = {
  suggested_weekly_block: "Suggested weekly block",
  suggested_next_action: "Suggested next action",
  workload_warning: "Workload warning",
  missing_deadline_warning: "Missing deadline",
  unclear_project_warning: "Unclear project",
};

const severityStyles: Record<AssistantSuggestionSeverity, string> = {
  important: "border-brand-coral/20 bg-brand-coral/10 text-brand-coral",
  warning: "border-[#e7c783] bg-[#fff8e6] text-[#8a5d0a]",
  info: "border-brand-teal/18 bg-brand-teal/8 text-brand-teal",
};

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

  return "AI Plan Review is unavailable right now.";
}

function getDecisionStyles(decision: ReviewDecision) {
  if (decision === "approved") {
    return "border-brand-teal/30 bg-brand-teal/8";
  }

  if (decision === "rejected") {
    return "border-brand-coral/25 bg-brand-coral/5 opacity-75";
  }

  return "border-white/70 bg-white/86";
}

function createInitialDecisions(suggestions: AssistantSuggestion[]) {
  return suggestions.reduce<Record<string, ReviewDecision>>((decisions, suggestion) => {
    decisions[suggestion.id] = "pending";
    return decisions;
  }, {});
}

function ContextMetric({
  label,
  value,
}: {
  label: string;
  value: string | number;
}) {
  return (
    <div className="rounded-[22px] border border-brand-ink/8 bg-white/72 p-4">
      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-brand-ink/42">
        {label}
      </p>
      <p className="mt-2 text-2xl font-semibold tracking-[-0.03em] text-brand-ink">
        {value}
      </p>
    </div>
  );
}

function SuggestionCard({
  decision,
  onDecisionChange,
  suggestion,
}: {
  decision: ReviewDecision;
  onDecisionChange: (decision: ReviewDecision) => void;
  suggestion: AssistantSuggestion;
}) {
  return (
    <article
      className={cn(
        "rounded-[28px] border p-4 shadow-[0_14px_34px_rgba(18,32,47,0.07)] sm:p-5",
        getDecisionStyles(decision),
      )}
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <Badge
              variant="subtle"
              className={cn("border", severityStyles[suggestion.severity])}
            >
              {suggestionTypeLabels[suggestion.type]}
            </Badge>
            <Badge variant="subtle">
              {decision === "pending" ? "Needs review" : decision}
            </Badge>
          </div>

          <h3 className="mt-3 text-lg font-semibold tracking-[-0.02em] text-brand-ink">
            {suggestion.title}
          </h3>
          <p className="mt-2 text-sm leading-6 text-brand-ink/70">
            {suggestion.summary}
          </p>
        </div>
      </div>

      <div className="mt-4 grid gap-3 text-sm text-brand-ink/68 sm:grid-cols-2">
        {suggestion.projectName ? (
          <div className="rounded-[20px] border border-brand-ink/8 bg-white/72 p-3">
            <span className="font-semibold text-brand-ink">Project:</span>{" "}
            {suggestion.projectName}
          </div>
        ) : null}

        {suggestion.day ? (
          <div className="rounded-[20px] border border-brand-ink/8 bg-white/72 p-3">
            <span className="font-semibold text-brand-ink">Day:</span>{" "}
            {suggestion.day}
          </div>
        ) : null}

        {suggestion.estimatedHours ? (
          <div className="rounded-[20px] border border-brand-ink/8 bg-white/72 p-3">
            <span className="font-semibold text-brand-ink">Time:</span>{" "}
            {suggestion.estimatedHours}{" "}
            {suggestion.estimatedHours === 1 ? "hr" : "hrs"}
          </div>
        ) : null}

        {suggestion.plannedTask ? (
          <div className="rounded-[20px] border border-brand-ink/8 bg-white/72 p-3">
            <span className="font-semibold text-brand-ink">Task:</span>{" "}
            {suggestion.plannedTask}
          </div>
        ) : null}

        {suggestion.proposedNextAction ? (
          <div className="rounded-[20px] border border-brand-ink/8 bg-white/72 p-3 sm:col-span-2">
            <span className="font-semibold text-brand-ink">Proposed next action:</span>{" "}
            {suggestion.proposedNextAction}
          </div>
        ) : null}
      </div>

      <p className="mt-4 text-sm leading-6 text-brand-ink/60">
        <span className="font-semibold text-brand-ink">Why:</span>{" "}
        {suggestion.rationale}
      </p>

      <div className="mt-4 grid grid-cols-2 gap-2">
        <Button
          variant={decision === "approved" ? "default" : "outline"}
          onClick={() => onDecisionChange("approved")}
        >
          Approve
        </Button>
        <Button
          variant={decision === "rejected" ? "secondary" : "outline"}
          onClick={() => onDecisionChange("rejected")}
        >
          Reject
        </Button>
      </div>
    </article>
  );
}

export function AssistantPage() {
  const [status, setStatus] = useState<AssistantStatus>(
    isSupabaseConfigured() ? "loading" : "signed_out",
  );
  const [prompt, setPrompt] = useState("");
  const [response, setResponse] = useState<AssistantPlanReviewResponse | null>(
    null,
  );
  const [decisions, setDecisions] = useState<Record<string, ReviewDecision>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const approvedCount = useMemo(
    () =>
      Object.values(decisions).filter((decision) => decision === "approved")
        .length,
    [decisions],
  );
  const rejectedCount = useMemo(
    () =>
      Object.values(decisions).filter((decision) => decision === "rejected")
        .length,
    [decisions],
  );

  async function requestPlanReview(
    method: "GET" | "POST",
    nextPrompt?: string,
    signal?: AbortSignal,
  ) {
    const supabase = getSupabaseBrowserClient();
    const { data, error: sessionError } = await supabase.auth.getSession();

    if (sessionError) {
      throw new Error(sessionError.message);
    }

    const accessToken = data.session?.access_token;

    if (!accessToken) {
      const signedOutError = new Error("Sign in before using AI Plan Review.");
      signedOutError.name = "SignedOutError";
      throw signedOutError;
    }

    const apiResponse = await fetch("/api/assistant/plan", {
      method,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        ...(method === "POST" ? { "Content-Type": "application/json" } : {}),
      },
      body: method === "POST" ? JSON.stringify({ prompt: nextPrompt }) : undefined,
      signal,
    });

    const payload: unknown = await apiResponse.json().catch(() => null);

    if (!apiResponse.ok) {
      const apiError =
        typeof payload === "object" &&
        payload !== null &&
        "error" in payload &&
        typeof payload.error === "string"
          ? payload.error
          : "AI Plan Review could not load.";
      throw new Error(apiError);
    }

    return payload as AssistantPlanReviewResponse;
  }

  useEffect(() => {
    if (!isSupabaseConfigured()) {
      setStatus("signed_out");
      setError("Supabase is not configured yet.");
      return;
    }

    let isActive = true;
    const controller = new AbortController();

    async function loadContext() {
      try {
        const nextResponse = await requestPlanReview(
          "GET",
          undefined,
          controller.signal,
        );

        if (!isActive) {
          return;
        }

        setResponse(nextResponse);
        setDecisions(createInitialDecisions(nextResponse.suggestions));
        setMessage(nextResponse.message);
        setError(null);
        setStatus("ready");
      } catch (loadError) {
        if (!isActive || controller.signal.aborted) {
          return;
        }

        if (
          loadError instanceof Error &&
          loadError.name === "SignedOutError"
        ) {
          setStatus("signed_out");
          setMessage(null);
          setError(null);
          return;
        }

        setStatus("error");
        setError(getErrorMessage(loadError));
      }
    }

    void loadContext();

    return () => {
      isActive = false;
      controller.abort();
    };
  }, []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const trimmedPrompt = prompt.trim();

    if (!trimmedPrompt) {
      setError("Describe what you want help planning.");
      return;
    }

    setIsSubmitting(true);
    setError(null);
    setMessage(null);

    try {
      const nextResponse = await requestPlanReview("POST", trimmedPrompt);
      setResponse(nextResponse);
      setDecisions(createInitialDecisions(nextResponse.suggestions));
      setMessage(nextResponse.message);
      setStatus("ready");
    } catch (submitError) {
      if (
        submitError instanceof Error &&
        submitError.name === "SignedOutError"
      ) {
        setStatus("signed_out");
        setError(null);
        setMessage(null);
        return;
      }

      setError(getErrorMessage(submitError));
    } finally {
      setIsSubmitting(false);
    }
  }

  function updateDecision(suggestionId: string, decision: ReviewDecision) {
    setDecisions((current) => ({
      ...current,
      [suggestionId]: current[suggestionId] === decision ? "pending" : decision,
    }));
  }

  const context = response?.context;
  const hasSuggestions = Boolean(response?.suggestions.length);

  return (
    <div className="px-3 pb-28 pt-4 sm:px-6 sm:pt-6 md:pb-10 lg:px-8 lg:pt-10">
      <div className="app-shell flex flex-col gap-5 sm:gap-6">
        <SchedulerNav />

        <section className="panel-strong overflow-hidden bg-dashboard-radial p-5 sm:p-8 lg:p-10">
          <div className="grid gap-5 lg:grid-cols-[minmax(0,1.35fr)_360px] lg:items-end">
            <div className="max-w-3xl">
              <div className="eyebrow-chip">
                <TargetIcon className="h-4 w-4" />
                Assistant
              </div>

              <h1 className="mt-4 text-3xl font-semibold tracking-[-0.04em] text-brand-ink sm:mt-5 sm:text-5xl">
                AI Plan Review
              </h1>

              <p className="mt-3 max-w-2xl text-sm leading-6 text-brand-ink/70 sm:mt-4 sm:text-lg sm:leading-7">
                Describe what you need help planning. Review suggestions before
                applying anything.
              </p>

              <div className="mt-5 flex flex-wrap gap-2.5">
                <Badge>Review-only V1</Badge>
                <Badge variant="subtle">
                  {response?.source === "ai" ? "AI suggestions" : "Safe fallback ready"}
                </Badge>
                <Badge variant="subtle">No calendar edits</Badge>
              </div>
            </div>

            <Card className="rounded-[26px] border-white/70 bg-white/88 sm:rounded-[30px]">
              <CardContent className="p-4 sm:p-5">
                <p className="text-sm font-semibold uppercase tracking-[0.18em] text-brand-ink/45">
                  Safety rule
                </p>
                <p className="mt-3 text-sm leading-6 text-brand-ink/65">
                  The assistant can suggest weekly blocks, next actions, and
                  warnings. It cannot save, overwrite, or create calendar events
                  in this version.
                </p>
              </CardContent>
            </Card>
          </div>
        </section>

        <section className="grid items-start gap-5 sm:gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
          <div className="flex min-w-0 flex-col gap-5 sm:gap-6">
            <Card className="rounded-[30px] border-white/70 bg-white/88">
              <CardContent className="p-5 sm:p-6">
                <div className="flex items-start gap-3">
                  <div className="rounded-2xl bg-brand-teal/10 p-2 text-brand-teal">
                    <FolderStackIcon className="h-5 w-5" />
                  </div>
                  <div>
                    <h2 className="text-xl font-semibold tracking-[-0.03em] text-brand-ink">
                      Ask for a planning review
                    </h2>
                    <p className="mt-1 text-sm leading-6 text-brand-ink/62">
                      Use a practical prompt. The assistant will read your
                      signed-in project and plan context from Supabase.
                    </p>
                  </div>
                </div>

                <form className="mt-5 space-y-4" onSubmit={handleSubmit}>
                  <label className="field-label" htmlFor="assistant-prompt">
                    What do you want help planning?
                  </label>
                  <textarea
                    id="assistant-prompt"
                    className="min-h-36 w-full resize-y rounded-[24px] border border-brand-ink/10 bg-white/78 px-4 py-4 text-base leading-7 text-brand-ink shadow-[0_12px_28px_rgba(18,32,47,0.05)] placeholder:text-brand-ink/36 focus:border-brand-teal/35 focus:bg-white focus:outline-none"
                    maxLength={2000}
                    placeholder={examplePrompts.join("\n")}
                    value={prompt}
                    onChange={(event) => setPrompt(event.target.value)}
                  />

                  <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <p className="text-xs font-semibold uppercase tracking-[0.16em] text-brand-ink/42">
                      {prompt.length}/2000 characters
                    </p>
                    <Button
                      className="w-full sm:w-auto"
                      disabled={
                        isSubmitting ||
                        status === "loading" ||
                        status === "signed_out"
                      }
                      type="submit"
                    >
                      {isSubmitting ? "Reviewing plan..." : "Generate suggestions"}
                    </Button>
                  </div>
                </form>

                {status === "signed_out" ? (
                  <div className="mt-5 rounded-[24px] border border-brand-coral/18 bg-brand-coral/8 p-4">
                    <p className="text-sm font-semibold text-brand-ink">
                      Sign in to use AI Plan Review.
                    </p>
                    <p className="mt-2 text-sm leading-6 text-brand-ink/65">
                      The assistant only reviews the schedule for the currently
                      signed-in Supabase user.
                    </p>
                    <Link
                      href="/"
                      className="mt-3 inline-flex h-11 items-center justify-center rounded-2xl bg-brand-ink px-4 text-sm font-semibold text-white"
                    >
                      Go to sign in
                    </Link>
                  </div>
                ) : null}

                {message ? (
                  <div className="mt-5 rounded-[24px] border border-brand-teal/18 bg-brand-teal/8 p-4 text-sm leading-6 text-brand-teal">
                    {message}
                  </div>
                ) : null}

                {error ? (
                  <div className="mt-5 rounded-[24px] border border-brand-coral/18 bg-brand-coral/8 p-4 text-sm leading-6 text-brand-coral">
                    {error}
                  </div>
                ) : null}
              </CardContent>
            </Card>

            <Card className="rounded-[30px] border-white/70 bg-white/88">
              <CardContent className="p-5 sm:p-6">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <h2 className="text-xl font-semibold tracking-[-0.03em] text-brand-ink">
                      Suggestions panel
                    </h2>
                    <p className="mt-1 text-sm leading-6 text-brand-ink/62">
                      Approve or reject suggestions locally. Applying approved
                      suggestions is intentionally disabled in V1.
                    </p>
                  </div>
                  {hasSuggestions ? (
                    <div className="flex flex-wrap gap-2">
                      <Badge variant="subtle">{approvedCount} approved</Badge>
                      <Badge variant="subtle">{rejectedCount} rejected</Badge>
                    </div>
                  ) : null}
                </div>

                {status === "loading" ? (
                  <div className="mt-5 rounded-[26px] border border-dashed border-brand-ink/12 bg-white/60 p-6 text-sm leading-6 text-brand-ink/58">
                    Loading your planner context...
                  </div>
                ) : null}

                {!hasSuggestions && status !== "loading" ? (
                  <div className="mt-5 rounded-[26px] border border-dashed border-brand-ink/12 bg-white/60 p-6 text-sm leading-6 text-brand-ink/58">
                    Ask for a review to generate structured suggestions for
                    weekly blocks, next actions, workload risks, and unclear
                    project details.
                  </div>
                ) : null}

                {hasSuggestions ? (
                  <div className="mt-5 grid gap-4">
                    {response?.suggestions.map((suggestion) => (
                      <SuggestionCard
                        key={suggestion.id}
                        decision={decisions[suggestion.id] ?? "pending"}
                        suggestion={suggestion}
                        onDecisionChange={(decision) =>
                          updateDecision(suggestion.id, decision)
                        }
                      />
                    ))}
                  </div>
                ) : null}

                <div className="mt-5 rounded-[24px] border border-brand-ink/8 bg-brand-ink/5 p-4">
                  <div className="flex items-start gap-3">
                    <CheckCircleIcon className="mt-0.5 h-5 w-5 text-brand-teal" />
                    <div>
                      <p className="text-sm font-semibold text-brand-ink">
                        Apply approved suggestions
                      </p>
                      <p className="mt-1 text-sm leading-6 text-brand-ink/62">
                        Review-only in V1. Nothing is saved until a future safe
                        apply flow is added.
                      </p>
                    </div>
                  </div>
                  <Button className="mt-4 w-full" disabled>
                    Apply approved suggestions
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>

          <aside className="flex min-w-0 flex-col gap-5 sm:gap-6 lg:sticky lg:top-6">
            <Card className="rounded-[30px] border-white/70 bg-white/88">
              <CardContent className="p-5 sm:p-6">
                <div className="flex items-center gap-3">
                  <div className="rounded-2xl bg-brand-ocean/10 p-2 text-brand-ocean">
                    <CalendarIcon className="h-5 w-5" />
                  </div>
                  <div>
                    <p className="text-sm font-semibold uppercase tracking-[0.18em] text-brand-ink/45">
                      Context summary
                    </p>
                    <p className="text-sm text-brand-ink/60">
                      Loaded from your signed-in scheduler.
                    </p>
                  </div>
                </div>

                <div className="mt-5 grid gap-3">
                  <ContextMetric
                    label="Active projects"
                    value={context?.activeProjectsCount ?? "--"}
                  />
                  <ContextMetric
                    label="Planned weekly work"
                    value={
                      context ? `${context.plannedWeeklyHours} hrs` : "--"
                    }
                  />
                  <ContextMetric
                    label="Weekly blocks"
                    value={context?.weeklyBlocksCount ?? "--"}
                  />
                  <ContextMetric
                    label="Planner type"
                    value={context?.plannerType ?? "--"}
                  />
                </div>
              </CardContent>
            </Card>

            <Card className="rounded-[30px] border-white/70 bg-white/88">
              <CardContent className="p-5 sm:p-6">
                <p className="text-sm font-semibold uppercase tracking-[0.18em] text-brand-ink/45">
                  Good first prompts
                </p>
                <div className="mt-4 grid gap-2">
                  {examplePrompts.map((example) => (
                    <button
                      key={example}
                      className="rounded-[22px] border border-brand-ink/8 bg-white/72 p-3 text-left text-sm leading-6 text-brand-ink/70 hover:-translate-y-0.5 hover:border-brand-teal/20 hover:bg-white hover:text-brand-ink"
                      type="button"
                      onClick={() => setPrompt(example)}
                    >
                      {example}
                    </button>
                  ))}
                </div>
              </CardContent>
            </Card>
          </aside>
        </section>
      </div>
    </div>
  );
}

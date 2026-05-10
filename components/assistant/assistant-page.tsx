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
  type AssistantContextSummary,
  type AssistantApplyResponse,
  type AssistantPlanReviewResponse,
  type AssistantSuggestion,
  type AssistantSuggestionSeverity,
  type AssistantSuggestionType,
} from "@/lib/assistant";
import { getSupabaseBrowserClient, isSupabaseConfigured } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

type ReviewDecision = "pending" | "approved" | "rejected" | "applied";
type AssistantStatus = "loading" | "ready" | "signed_out" | "error";

const examplePrompts = [
  "Plan my week",
  "Find overloaded days in my plan.",
  "Turn projects into work blocks",
  "Suggest my Top 3",
];

const suggestionTypeLabels: Record<AssistantSuggestionType, string> = {
  suggested_weekly_block: "Weekly block suggestion",
  suggested_next_action: "Next action suggestion",
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

  return "Planning Assistant is unavailable right now.";
}

function getDecisionStyles(decision: ReviewDecision) {
  if (decision === "approved") {
    return "border-brand-teal/30 bg-brand-teal/8";
  }

  if (decision === "rejected") {
    return "border-brand-coral/25 bg-brand-coral/5 opacity-75";
  }

  if (decision === "applied") {
    return "border-brand-ocean/24 bg-brand-ocean/8";
  }

  return "border-white/70 bg-white/86";
}

function getDecisionLabel(decision: ReviewDecision) {
  if (decision === "pending") {
    return "Waiting for your choice";
  }

  if (decision === "approved") {
    return "Approved";
  }

  if (decision === "rejected") {
    return "Rejected";
  }

  return "Applied";
}

function getResultStyles(status: AssistantApplyResponse["results"][number]["status"]) {
  if (status === "applied") {
    return "border-brand-teal/18 bg-brand-teal/8 text-brand-teal";
  }

  if (status === "skipped") {
    return "border-brand-ink/10 bg-brand-ink/5 text-brand-ink/68";
  }

  return "border-brand-coral/18 bg-brand-coral/8 text-brand-coral";
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
    <div className="rounded-[18px] border border-brand-ink/8 bg-white/72 p-3 sm:rounded-[22px] sm:p-4">
      <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-brand-ink/42">
        {label}
      </p>
      <p className="mt-1 text-base font-semibold tracking-[-0.02em] text-brand-ink sm:text-lg">
        {value}
      </p>
    </div>
  );
}

function AssistantContextCard({
  context,
}: {
  context?: AssistantContextSummary;
}) {
  return (
    <Card className="rounded-[26px] border-white/70 bg-white/88 sm:rounded-[30px]">
      <CardContent className="p-4 sm:p-5">
        <div className="flex items-center gap-3">
          <div className="rounded-2xl bg-brand-ocean/10 p-2 text-brand-ocean">
            <CalendarIcon className="h-5 w-5" />
          </div>
          <div>
            <p className="text-base font-semibold text-brand-ink">
              What the assistant can see
            </p>
            <p className="text-sm leading-6 text-brand-ink/60">
              A small snapshot of your schedule.
            </p>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-2">
          <ContextMetric
            label="Active projects"
            value={context?.activeProjectsCount ?? "--"}
          />
          <ContextMetric
            label="Planned hours"
            value={context ? `${context.plannedWeeklyHours} hrs` : "--"}
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
        "rounded-[24px] border p-4 shadow-[0_14px_34px_rgba(18,32,47,0.06)] sm:p-5",
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
              {getDecisionLabel(decision)}
            </Badge>
          </div>

          <h3 className="mt-3 text-lg font-semibold tracking-[-0.02em] text-brand-ink">
            {suggestion.title}
          </h3>
          <p className="mt-2 text-sm leading-6 text-brand-ink/70">
            {suggestion.description}
          </p>
          <p className="mt-2 text-xs font-semibold uppercase tracking-[0.14em] text-brand-ink/38">
            Confidence: {Math.round(suggestion.confidence * 100)}%
          </p>
        </div>
      </div>

      <div className="mt-4 grid gap-2 text-sm text-brand-ink/68 sm:grid-cols-2">
        {suggestion.projectName ? (
          <div className="rounded-[18px] border border-brand-ink/8 bg-white/72 p-3">
            <p className="text-[11px] font-semibold uppercase tracking-[0.13em] text-brand-ink/42">
              Project
            </p>
            <p className="mt-1 font-semibold text-brand-ink">
              {suggestion.projectName}
            </p>
          </div>
        ) : null}

        {suggestion.day ? (
          <div className="rounded-[18px] border border-brand-ink/8 bg-white/72 p-3">
            <p className="text-[11px] font-semibold uppercase tracking-[0.13em] text-brand-ink/42">
              Day
            </p>
            <p className="mt-1 font-semibold text-brand-ink">{suggestion.day}</p>
          </div>
        ) : null}

        {suggestion.estimatedHours ? (
          <div className="rounded-[18px] border border-brand-ink/8 bg-white/72 p-3">
            <p className="text-[11px] font-semibold uppercase tracking-[0.13em] text-brand-ink/42">
              Time
            </p>
            <p className="mt-1 font-semibold text-brand-ink">
              {suggestion.estimatedHours}{" "}
              {suggestion.estimatedHours === 1 ? "hr" : "hrs"}
            </p>
          </div>
        ) : null}

        {suggestion.plannedTask ? (
          <div className="rounded-[18px] border border-brand-ink/8 bg-white/72 p-3">
            <p className="text-[11px] font-semibold uppercase tracking-[0.13em] text-brand-ink/42">
              Task
            </p>
            <p className="mt-1 font-semibold text-brand-ink">
              {suggestion.plannedTask}
            </p>
          </div>
        ) : null}

        {suggestion.proposedNextAction ? (
          <div className="rounded-[18px] border border-brand-ink/8 bg-white/72 p-3 sm:col-span-2">
            <p className="text-[11px] font-semibold uppercase tracking-[0.13em] text-brand-ink/42">
              Proposed next action
            </p>
            <p className="mt-1 font-semibold text-brand-ink">
              {suggestion.proposedNextAction}
            </p>
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
          disabled={decision === "applied"}
          onClick={() => onDecisionChange("approved")}
        >
          Approve suggestion
        </Button>
        <Button
          variant={decision === "rejected" ? "secondary" : "outline"}
          disabled={decision === "applied"}
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
  const [isApplying, setIsApplying] = useState(false);
  const [applyResponse, setApplyResponse] =
    useState<AssistantApplyResponse | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const approvedCount = useMemo(
    () =>
      Object.values(decisions).filter((decision) => decision === "approved")
        .length,
    [decisions],
  );
  const approvedSuggestions = useMemo(() => {
    return (
      response?.suggestions.filter(
        (suggestion) => decisions[suggestion.id] === "approved",
      ) ?? []
    );
  }, [decisions, response]);
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
      const signedOutError = new Error("Sign in before using Planning Assistant.");
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
          : "Planning Assistant could not load.";
      throw new Error(apiError);
    }

    return payload as AssistantPlanReviewResponse;
  }

  async function requestApplyApproved(nextApprovedSuggestions: AssistantSuggestion[]) {
    const supabase = getSupabaseBrowserClient();
    const { data, error: sessionError } = await supabase.auth.getSession();

    if (sessionError) {
      throw new Error(sessionError.message);
    }

    const accessToken = data.session?.access_token;

    if (!accessToken) {
      const signedOutError = new Error("Sign in before applying suggestions.");
      signedOutError.name = "SignedOutError";
      throw signedOutError;
    }

    const apiResponse = await fetch("/api/assistant/apply", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        approvedSuggestions: nextApprovedSuggestions,
      }),
    });

    const payload: unknown = await apiResponse.json().catch(() => null);

    if (!apiResponse.ok) {
      const apiError =
        typeof payload === "object" &&
        payload !== null &&
        "error" in payload &&
        typeof payload.error === "string"
          ? payload.error
          : "Approved suggestions could not be applied.";
      throw new Error(apiError);
    }

    return payload as AssistantApplyResponse;
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
        setApplyResponse(null);
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
      setApplyResponse(null);
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
      [suggestionId]:
        current[suggestionId] === "applied"
          ? "applied"
          : current[suggestionId] === decision
            ? "pending"
            : decision,
    }));
  }

  async function handleApplyApproved() {
    if (approvedSuggestions.length === 0) {
      setError("Approve at least one suggestion before applying.");
      return;
    }

    const confirmed = window.confirm(
      `Apply ${approvedSuggestions.length} approved ${
        approvedSuggestions.length === 1 ? "suggestion" : "suggestions"
      }? Only safe additive changes and approved next-action updates will be saved.`,
    );

    if (!confirmed) {
      return;
    }

    setIsApplying(true);
    setError(null);
    setMessage(null);

    try {
      const nextApplyResponse = await requestApplyApproved(approvedSuggestions);
      setApplyResponse(nextApplyResponse);
      setResponse((current) =>
        current
          ? {
              ...current,
              context: nextApplyResponse.context,
            }
          : current,
      );
      setDecisions((current) => {
        const nextDecisions = { ...current };

        nextApplyResponse.results.forEach((result) => {
          if (result.status === "applied") {
            nextDecisions[result.suggestionId] = "applied";
          }
        });

        return nextDecisions;
      });
      setMessage(nextApplyResponse.message);
    } catch (applyError) {
      if (
        applyError instanceof Error &&
        applyError.name === "SignedOutError"
      ) {
        setStatus("signed_out");
        setError(null);
        setMessage(null);
        return;
      }

      setError(getErrorMessage(applyError));
    } finally {
      setIsApplying(false);
    }
  }

  const context = response?.context;
  const hasSuggestions = Boolean(response?.suggestions.length);

  return (
    <div className="px-3 pb-[calc(18rem+env(safe-area-inset-bottom))] pt-4 sm:px-6 sm:pt-6 md:pb-10 lg:px-8 lg:pt-10">
      <div className="app-shell flex flex-col gap-4 sm:gap-6">
        <SchedulerNav />

        <section className="panel-strong overflow-hidden bg-dashboard-radial p-5 sm:p-8 lg:p-10">
          <div className="grid gap-5 lg:grid-cols-[minmax(0,1.35fr)_340px] lg:items-end">
            <div className="max-w-3xl">
              <div className="eyebrow-chip">
                <TargetIcon className="h-4 w-4" />
                Assistant
              </div>

              <h1 className="mt-4 text-3xl font-semibold tracking-[-0.04em] text-brand-ink sm:mt-5 sm:text-5xl">
                Planning Assistant
              </h1>

              <p className="mt-3 max-w-2xl text-sm leading-6 text-brand-ink/70 sm:mt-4 sm:text-lg sm:leading-7">
                Ask for help turning your projects into a realistic plan. You
                stay in control before anything changes.
              </p>

              <p className="mt-4 text-sm font-medium text-brand-ink/58">
                Calendar changes are never made automatically.
              </p>
            </div>

            <Card className="rounded-[26px] border-white/70 bg-white/88 sm:rounded-[30px]">
              <CardContent className="p-4 sm:p-5">
                <p className="text-base font-semibold text-brand-ink">
                  You stay in control
                </p>
                <p className="mt-3 text-sm leading-6 text-brand-ink/65">
                  The assistant can suggest projects, next actions, and weekly
                  blocks. You choose what to approve before anything is added to
                  your schedule.
                </p>
              </CardContent>
            </Card>
          </div>
        </section>

        <section className="grid items-start gap-4 sm:gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
          <div className="flex min-w-0 flex-col gap-5 sm:gap-6">
            <Card className="mb-28 rounded-[30px] border-white/70 bg-white/88 md:mb-0">
              <CardContent className="p-5 sm:p-6">
                <div className="flex items-start gap-3">
                  <div className="rounded-2xl bg-brand-teal/10 p-2 text-brand-teal">
                    <FolderStackIcon className="h-5 w-5" />
                  </div>
                  <div>
                    <h2 className="text-xl font-semibold tracking-[-0.03em] text-brand-ink">
                      What do you want help planning?
                    </h2>
                    <p className="mt-1 text-sm leading-6 text-brand-ink/62">
                      Tell the assistant what you want to organize, then review
                      its suggestions before applying anything.
                    </p>
                  </div>
                </div>

                <form className="mt-5 space-y-4" onSubmit={handleSubmit}>
                  <textarea
                    id="assistant-prompt"
                    className="min-h-36 w-full resize-y rounded-[24px] border border-brand-ink/10 bg-white/78 px-4 py-4 text-base leading-7 text-brand-ink shadow-[0_12px_28px_rgba(18,32,47,0.05)] placeholder:text-brand-ink/36 focus:border-brand-teal/35 focus:bg-white focus:outline-none"
                    maxLength={2000}
                    placeholder="Example: Help me plan this week around my active projects."
                    value={prompt}
                    onChange={(event) => setPrompt(event.target.value)}
                  />

                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.16em] text-brand-ink/42">
                      Try one of these
                    </p>
                    <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
                      {examplePrompts.map((example) => (
                        <button
                          key={example}
                          className="rounded-[18px] border border-brand-ink/8 bg-white/72 px-3 py-3 text-left text-sm font-semibold text-brand-ink/70 hover:-translate-y-0.5 hover:border-brand-teal/20 hover:bg-white hover:text-brand-ink"
                          type="button"
                          onClick={() => setPrompt(example)}
                        >
                          {example}
                        </button>
                      ))}
                    </div>
                  </div>

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
                      {isSubmitting ? "Getting suggestions..." : "Get suggestions"}
                    </Button>
                  </div>
                </form>

                {status === "signed_out" ? (
                  <div className="mt-5 rounded-[24px] border border-brand-coral/18 bg-brand-coral/8 p-4">
                    <p className="text-sm font-semibold text-brand-ink">
                      Sign in to use Planning Assistant.
                    </p>
                    <p className="mt-2 text-sm leading-6 text-brand-ink/65">
                      The assistant reviews only your signed-in schedule.
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

            <div className="lg:hidden">
              <AssistantContextCard context={context} />
            </div>

            <Card className="rounded-[30px] border-white/70 bg-white/88">
              <CardContent className="p-5 sm:p-6">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <h2 className="text-xl font-semibold tracking-[-0.03em] text-brand-ink">
                      Review suggestions
                    </h2>
                    <p className="mt-1 text-sm leading-6 text-brand-ink/62">
                      Approve the ideas you like. Rejected suggestions will not
                      be used.
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
                    Ask for help above to get practical suggestions for weekly
                    blocks, next actions, and workload risks.
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

                {hasSuggestions ? (
                  <div className="mt-5 rounded-[24px] border border-brand-ink/8 bg-brand-ink/5 p-4">
                    <div className="flex items-start gap-3">
                      <CheckCircleIcon className="mt-0.5 h-5 w-5 text-brand-teal" />
                      <div>
                        <p className="text-sm font-semibold text-brand-ink">
                          Apply approved suggestions
                        </p>
                        <p className="mt-1 text-sm leading-6 text-brand-ink/62">
                          Approved weekly blocks and next-action updates can be
                          added to your schedule.
                        </p>
                      </div>
                    </div>
                    <Button
                      className="mt-4 w-full"
                      disabled={approvedSuggestions.length === 0 || isApplying}
                      onClick={() => void handleApplyApproved()}
                    >
                      {isApplying
                        ? "Applying suggestions..."
                        : approvedSuggestions.length > 0
                          ? `Apply ${approvedSuggestions.length} approved`
                          : "Apply approved suggestions"}
                    </Button>

                    {applyResponse ? (
                      <div className="mt-4 grid gap-2">
                        {applyResponse.results.map((result) => (
                          <div
                            key={result.suggestionId}
                            className={cn(
                              "rounded-[18px] border p-3 text-sm leading-6",
                              getResultStyles(result.status),
                            )}
                          >
                            <span className="font-semibold">
                              {result.suggestionTitle}:
                            </span>{" "}
                            {result.message}
                          </div>
                        ))}
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </CardContent>
            </Card>
          </div>

          <aside className="flex min-w-0 flex-col gap-5 sm:gap-6 lg:sticky lg:top-6">
            <div className="hidden lg:block">
              <AssistantContextCard context={context} />
            </div>
          </aside>
        </section>

        <div className="h-44 md:hidden" aria-hidden="true" />
      </div>
    </div>
  );
}

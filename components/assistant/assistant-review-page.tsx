"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import {
  AssistantProposalSeries,
  type AssistantProposalRowState,
} from "@/components/assistant/assistant-proposal-series";
import { SchedulerAppShell } from "@/components/scheduler/app-shell";
import type {
  AssistantApplyResponse,
  AssistantSuggestion,
} from "@/lib/assistant";
import type { LoadedAssistantWorkflow } from "@/lib/assistant-workflow-store";
import {
  getSafeAssistantLabel,
  sanitizeAssistantUserFacingText,
} from "@/lib/assistant-ui-guards";
import { getSupabaseBrowserClient, isSupabaseConfigured } from "@/lib/supabase/client";
import { getUserFacingError } from "@/lib/user-facing-error";

type AssistantReviewPageProps = {
  proposalBatchId: string;
};

type ReviewStatus = "loading" | "ready" | "signed_out" | "missing" | "error";

function isLoadedAssistantWorkflow(
  value: LoadedAssistantWorkflow | { error?: string } | null,
): value is LoadedAssistantWorkflow {
  return Boolean(value && "workflow" in value && "proposals" in value);
}

function isAssistantApplyResponse(
  value: AssistantApplyResponse | { error?: string } | null,
): value is AssistantApplyResponse {
  return Boolean(value && "results" in value && Array.isArray(value.results));
}

async function getAccessToken() {
  const supabase = getSupabaseBrowserClient();
  const { data, error } = await supabase.auth.getSession();
  if (error) throw new Error(error.message);
  return data.session?.access_token ?? null;
}

function mergeApplyResponse(
  current: LoadedAssistantWorkflow,
  response: AssistantApplyResponse,
): LoadedAssistantWorkflow {
  return {
    batch: response.proposalBatch ?? current.batch,
    proposals: response.canonicalProposals ?? current.proposals,
    workflow: response.workflow ?? current.workflow,
  };
}

function formatDateRange(startDate: string, endDate: string) {
  const formatter = new Intl.DateTimeFormat(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
  return `${formatter.format(new Date(`${startDate}T00:00:00`))}–${formatter.format(
    new Date(`${endDate}T00:00:00`),
  )}`;
}

function formatMinutes(minutes: number) {
  if (minutes % 60 === 0) {
    const hours = minutes / 60;
    return `${hours} ${hours === 1 ? "hour" : "hours"}`;
  }
  return `${minutes} minutes`;
}

export function AssistantReviewPage({ proposalBatchId }: AssistantReviewPageProps) {
  const [status, setStatus] = useState<ReviewStatus>(
    isSupabaseConfigured() ? "loading" : "signed_out",
  );
  const [review, setReview] = useState<LoadedAssistantWorkflow | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());
  const [actionStates, setActionStates] = useState<
    Record<string, AssistantProposalRowState>
  >({});
  const [error, setError] = useState<string | null>(null);
  const headingRef = useRef<HTMLHeadingElement | null>(null);
  const selectionStorageKey = `schedule-builder:assistant-review-selection:${proposalBatchId}`;

  useEffect(() => {
    let active = true;

    async function loadReview() {
      try {
        const accessToken = await getAccessToken();
        if (!accessToken) {
          if (active) setStatus("signed_out");
          return;
        }
        const response = await fetch(
          `/api/assistant/proposals?batchId=${encodeURIComponent(proposalBatchId)}`,
          { headers: { Authorization: `Bearer ${accessToken}` } },
        );
        const payload = (await response.json().catch(() => null)) as
          | LoadedAssistantWorkflow
          | { error?: string }
          | null;

        if (!response.ok) {
          if (response.status === 404) {
            if (active) setStatus("missing");
            return;
          }
          throw new Error(
            payload && "error" in payload && payload.error
              ? payload.error
              : "The review plan could not be loaded.",
          );
        }

        if (!active || !isLoadedAssistantWorkflow(payload)) return;
        const pendingIds = payload.workflow.pendingProposalIds;
        let restoredIds: string[] = [];
        try {
          const stored = window.sessionStorage.getItem(selectionStorageKey);
          const parsed = stored ? (JSON.parse(stored) as unknown) : null;
          restoredIds = Array.isArray(parsed)
            ? parsed.filter(
                (id): id is string =>
                  typeof id === "string" && pendingIds.includes(id),
              )
            : [];
        } catch {
          restoredIds = [];
        }

        setReview(payload);
        setSelectedIds(new Set(restoredIds.length > 0 ? restoredIds : pendingIds));
        setActionStates(
          Object.fromEntries(
            payload.proposals.map((proposal) => [
              proposal.id,
              {
                editing: false,
                status:
                  proposal.approvalStatus === "applied"
                    ? ("applied" as const)
                    : ("pending" as const),
              },
            ]),
          ),
        );
        setStatus("ready");
        window.requestAnimationFrame(() => headingRef.current?.focus());
      } catch (loadError) {
        if (!active) return;
        setError(getUserFacingError(loadError, "The review plan could not be loaded."));
        setStatus("error");
      }
    }

    void loadReview();
    return () => {
      active = false;
    };
  }, [proposalBatchId, selectionStorageKey]);

  useEffect(() => {
    if (status !== "ready") return;
    window.sessionStorage.setItem(
      selectionStorageKey,
      JSON.stringify([...selectedIds]),
    );
  }, [selectedIds, selectionStorageKey, status]);

  function updateSuggestion(
    suggestionId: string,
    patch: Partial<AssistantSuggestion>,
  ) {
    setReview((current) =>
      current
        ? {
            ...current,
            proposals: current.proposals.map((proposal) =>
              proposal.id === suggestionId
                ? {
                    ...proposal,
                    suggestion: { ...proposal.suggestion, ...patch },
                  }
                : proposal,
            ),
          }
        : current,
    );
  }

  async function updateProposal(suggestion: AssistantSuggestion) {
    if (!review) return;
    const currentState = actionStates[suggestion.id] ?? {
      editing: false,
      status: "pending" as const,
    };

    if (!currentState.editing) {
      setActionStates((current) => ({
        ...current,
        [suggestion.id]: { ...currentState, editing: true },
      }));
      return;
    }

    try {
      const accessToken = await getAccessToken();
      if (!accessToken) throw new Error("Sign in before changing a proposal.");
      const response = await fetch("/api/assistant/proposals", {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          action: "update",
          proposalId: suggestion.id,
          suggestion,
          workflowId: review.workflow.workflowId,
        }),
      });
      const payload = (await response.json().catch(() => null)) as
        | LoadedAssistantWorkflow
        | { error?: string }
        | null;
      if (!response.ok || !isLoadedAssistantWorkflow(payload)) {
        throw new Error(
          payload && "error" in payload && payload.error
            ? payload.error
            : "The proposal could not be updated.",
        );
      }
      setReview(payload);
      setActionStates((current) => ({
        ...current,
        [suggestion.id]: {
          editing: false,
          message: "Proposal updated.",
          status: "pending",
        },
      }));
    } catch (updateError) {
      setActionStates((current) => ({
        ...current,
        [suggestion.id]: {
          ...currentState,
          editing: true,
          message: getUserFacingError(updateError, "The proposal could not be updated."),
          status: "error",
        },
      }));
    }
  }

  async function removeProposal(proposalId: string) {
    if (!review) return;
    try {
      const accessToken = await getAccessToken();
      if (!accessToken) throw new Error("Sign in before changing a proposal.");
      const response = await fetch("/api/assistant/proposals", {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          action: "reject",
          proposalId,
          workflowId: review.workflow.workflowId,
        }),
      });
      const payload = (await response.json().catch(() => null)) as
        | LoadedAssistantWorkflow
        | { error?: string }
        | null;
      if (!response.ok || !isLoadedAssistantWorkflow(payload)) {
        throw new Error(
          payload && "error" in payload && payload.error
            ? payload.error
            : "The proposal could not be removed.",
        );
      }
      setReview(payload);
      setSelectedIds((current) => {
        const next = new Set(current);
        next.delete(proposalId);
        return next;
      });
      setActionStates((current) => ({
        ...current,
        [proposalId]: { editing: false, status: "removed" },
      }));
    } catch (removeError) {
      setActionStates((current) => ({
        ...current,
        [proposalId]: {
          editing: false,
          message: getUserFacingError(removeError, "The proposal could not be removed."),
          status: "error",
        },
      }));
    }
  }

  async function applyProposals(suggestions: AssistantSuggestion[]) {
    if (!review || suggestions.length === 0) return;
    suggestions.forEach((suggestion) => {
      setActionStates((current) => ({
        ...current,
        [suggestion.id]: { editing: false, status: "applying" },
      }));
    });

    try {
      const accessToken = await getAccessToken();
      if (!accessToken) throw new Error("Sign in before applying this plan.");
      const response = await fetch("/api/assistant/apply", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          proposalIds: suggestions.map((suggestion) => suggestion.id),
          workflowId: review.workflow.workflowId,
        }),
      });
      const payload = (await response.json().catch(() => null)) as
        | AssistantApplyResponse
        | { error?: string }
        | null;
      if (!response.ok || !isAssistantApplyResponse(payload)) {
        throw new Error(
          payload && "error" in payload && payload.error
            ? payload.error
            : "The selected proposals could not be applied.",
        );
      }

      setReview((current) => (current ? mergeApplyResponse(current, payload) : current));
      payload.results.forEach((result) => {
        setActionStates((current) => ({
          ...current,
          [result.suggestionId]: {
            editing: false,
            message: result.message,
            result,
            status: result.status === "applied" ? "applied" : "error",
          },
        }));
      });
      setSelectedIds((current) => {
        const next = new Set(current);
        payload.results
          .filter((result) => result.status === "applied")
          .forEach((result) => next.delete(result.suggestionId));
        return next;
      });
      window.dispatchEvent(new CustomEvent("schedule-builder:data-changed"));
    } catch (applyError) {
      const message = getUserFacingError(
        applyError,
        "The selected proposals could not be applied.",
      );
      suggestions.forEach((suggestion) => {
        setActionStates((current) => ({
          ...current,
          [suggestion.id]: {
            editing: false,
            message,
            status: "error",
          },
        }));
      });
    }
  }

  return (
    <SchedulerAppShell navigationVariant="top" className="bg-transparent">
      <div className="mx-auto w-full max-w-[980px] py-2 sm:py-4">
        <Link
          className="inline-flex min-h-10 items-center text-sm font-semibold text-brand-teal underline decoration-brand-teal/25 underline-offset-4"
          href="/assistant"
        >
          ← Back to conversation
        </Link>

        {status === "loading" ? (
          <div className="mt-8 rounded-[24px] bg-white/70 p-6 text-sm text-brand-ink/58">
            Loading your review…
          </div>
        ) : status === "signed_out" ? (
          <div className="mt-8 rounded-[24px] bg-white/70 p-6">
            <h1 className="text-xl font-semibold">Sign in to review this plan</h1>
            <Link className="mt-4 inline-flex font-semibold text-brand-teal" href="/">
              Sign in
            </Link>
          </div>
        ) : status === "missing" ? (
          <div className="mt-8 rounded-[24px] bg-white/70 p-6">
            <h1 className="text-xl font-semibold">This review is unavailable</h1>
            <p className="mt-2 text-sm text-brand-ink/58">
              It may have been removed, replaced, or belong to another account.
            </p>
          </div>
        ) : status === "error" ? (
          <div className="mt-8 rounded-[24px] bg-brand-coral/10 p-6" role="alert">
            <h1 className="text-xl font-semibold text-brand-coral">Review could not load</h1>
            <p className="mt-2 text-sm text-brand-coral">{error}</p>
          </div>
        ) : review ? (
          <>
            <header className="mb-5 mt-3">
              <h1
                ref={headingRef}
                className="text-2xl font-semibold tracking-[-0.035em] text-brand-ink sm:text-3xl"
                tabIndex={-1}
              >
                {getSafeAssistantLabel(review.batch?.title, "Review plan")}
              </h1>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-brand-ink/58">
                {sanitizeAssistantUserFacingText(
                  review.workflow.context?.seriesProposal?.purpose ??
                    "Review every proposed change before applying it.",
                )}
              </p>
              <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-xs font-semibold text-brand-ink/48">
                <span>{review.proposals.length} total changes</span>
                <span>{review.workflow.pendingProposalIds.length} awaiting approval</span>
                <span>{review.workflow.appliedProposalIds.length} applied</span>
                {review.workflow.context?.seriesProposal ? (
                  <>
                    <span>
                      {formatMinutes(
                        review.workflow.context.seriesProposal.weeklyTotalMinutes,
                      )} weekly
                    </span>
                    <span>
                      {formatDateRange(
                        review.workflow.context.seriesProposal.planningHorizon.startDate,
                        review.workflow.context.seriesProposal.planningHorizon.endDate,
                      )}
                    </span>
                  </>
                ) : null}
              </div>
            </header>

            <AssistantProposalSeries
              actionStates={actionStates}
              appliedProposalIds={review.workflow.appliedProposalIds}
              pendingProposalIds={review.workflow.pendingProposalIds}
              reviewMode
              selectedProposalIds={selectedIds}
              series={review.workflow.context?.seriesProposal ?? null}
              suggestions={review.proposals.map((proposal) => proposal.suggestion)}
              onApplySelected={(suggestions) => void applyProposals(suggestions)}
              onIgnore={(proposalId) => void removeProposal(proposalId)}
              onSelectionChange={(proposalId, selected) =>
                setSelectedIds((current) => {
                  const next = new Set(current);
                  if (selected) next.add(proposalId);
                  else next.delete(proposalId);
                  return next;
                })
              }
              onToggleEdit={(suggestion) => void updateProposal(suggestion)}
              onUpdate={updateSuggestion}
            />
          </>
        ) : null}
      </div>
    </SchedulerAppShell>
  );
}

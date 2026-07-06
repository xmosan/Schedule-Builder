import type { AssistantSuggestion } from "@/lib/assistant";
import type { RecurringSeriesProposal } from "@/lib/assistant-semantics";

export type PlanPresentationKind =
  | "single_item"
  | "recurring_series"
  | "multi_item_week"
  | "routine"
  | "linked_changes"
  | "applied_result";

const routineTitlePattern = /\b(workout|exercise|routine|training|practice)\b/i;

export function getPlanPresentationKind({
  appliedCount,
  pendingCount,
  series,
  suggestions,
}: {
  appliedCount: number;
  pendingCount: number;
  series?: RecurringSeriesProposal | null;
  suggestions: AssistantSuggestion[];
}): PlanPresentationKind {
  if (pendingCount === 0 && appliedCount > 0) return "applied_result";
  if (suggestions.length <= 1) return "single_item";

  const suggestionTypes = new Set(suggestions.map((suggestion) => suggestion.type));
  if (suggestionTypes.size > 1) return "linked_changes";

  const titles = new Set(
    suggestions.map((suggestion) =>
      (suggestion.projectName || suggestion.title).trim().toLowerCase(),
    ),
  );
  const title = suggestions[0]?.projectName || suggestions[0]?.title || "";

  if (series && routineTitlePattern.test(title)) return "routine";
  if (series || titles.size === 1) return "recurring_series";
  return "multi_item_week";
}

export function getPlanReviewLabel(kind: PlanPresentationKind) {
  switch (kind) {
    case "single_item":
      return "Edit";
    case "multi_item_week":
      return "Review week";
    case "routine":
      return "Review routine";
    case "linked_changes":
      return "Review changes";
    default:
      return "Review plan";
  }
}

export function getPlanApplyLabel(
  kind: PlanPresentationKind,
  pendingCount: number,
) {
  if (kind === "single_item") return "Apply";
  if (kind === "linked_changes" && pendingCount === 2) return "Apply both";
  if (kind === "multi_item_week") return "Apply plan";
  if (kind === "routine") return "Apply";
  return `Apply all ${pendingCount}`;
}

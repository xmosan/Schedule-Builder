"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";

export type AssistantClarificationChoice = {
  id: string;
  label: string;
  prompt: string;
};

type AssistantClarificationPanelProps = {
  choices: AssistantClarificationChoice[];
  disabled: boolean;
  kind: "duration" | "opening";
  onSelect: (prompt: string) => void;
  question?: string | null;
};

const visibleChoiceLimit = 6;
const genericOpeningQuestionPattern =
  /^(?:No problem\. )?Which opening should I use(?: instead)?\? Choose a day or one of the openings below\.$/i;

function getPanelTitle(
  kind: AssistantClarificationPanelProps["kind"],
  question?: string | null,
) {
  if (kind === "duration") {
    return question || "How much time should I reserve?";
  }

  if (question && !genericOpeningQuestionPattern.test(question)) {
    return question;
  }

  return question?.startsWith("No problem")
    ? "Choose another opening"
    : "Choose an opening";
}

export function AssistantClarificationPanel({
  choices,
  disabled,
  kind,
  onSelect,
  question,
}: AssistantClarificationPanelProps) {
  const [showAll, setShowAll] = useState(false);
  const visibleChoices = showAll
    ? choices
    : choices.slice(0, visibleChoiceLimit);
  const hiddenChoiceCount = choices.length - visibleChoices.length;
  const title = getPanelTitle(kind, question);

  if (choices.length === 0) {
    return null;
  }

  return (
    <section
      aria-labelledby="assistant-clarification-title"
      className="animate-assistant-details rounded-[20px] border border-brand-teal/14 bg-brand-teal/[0.045] p-3.5 sm:p-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2
          id="assistant-clarification-title"
          className="text-sm font-semibold text-brand-ink"
        >
          {title}
        </h2>
        {kind === "opening" ? (
          <span className="text-[11px] font-semibold text-brand-ink/42">
            {choices.length} available
          </span>
        ) : null}
      </div>
      {kind === "opening" ? (
        <p className="mt-1 text-xs leading-5 text-brand-ink/52">
          Every available option can be selected.
        </p>
      ) : null}
      <div className="mt-3 flex flex-wrap gap-2">
        {visibleChoices.map((choice) => (
          <button
            key={choice.id}
            className="min-h-10 rounded-full border border-brand-ink/10 bg-white px-3.5 py-2 text-xs font-semibold text-brand-ink/66 shadow-sm hover:-translate-y-0.5 hover:border-brand-teal/30 hover:text-brand-ink disabled:cursor-not-allowed disabled:opacity-50"
            disabled={disabled}
            type="button"
            onClick={() => onSelect(choice.prompt)}
          >
            {choice.label}
          </button>
        ))}
        {hiddenChoiceCount > 0 ? (
          <button
            aria-expanded={showAll}
            className="min-h-10 rounded-full px-3.5 py-2 text-xs font-semibold text-brand-teal underline decoration-brand-teal/25 underline-offset-4"
            type="button"
            onClick={() => setShowAll(true)}
          >
            Show {hiddenChoiceCount} more {hiddenChoiceCount === 1 ? "opening" : "openings"}
          </button>
        ) : null}
        {showAll && choices.length > visibleChoiceLimit ? (
          <button
            className={cn(
              "min-h-10 rounded-full px-3.5 py-2 text-xs font-semibold",
              "text-brand-ink/52 underline decoration-brand-ink/20 underline-offset-4",
            )}
            type="button"
            onClick={() => setShowAll(false)}
          >
            Show fewer
          </button>
        ) : null}
      </div>
    </section>
  );
}

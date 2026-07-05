import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AssistantProposalSeries } from "../components/assistant/assistant-proposal-series";
import type { AssistantSuggestion } from "../lib/assistant";
import type { RecurringSeriesProposal } from "../lib/assistant-semantics";

const suggestions: AssistantSuggestion[] = [
  ["proposal-1", "2026-07-05", "Sunday", "08:00"],
  ["proposal-2", "2026-07-08", "Wednesday", "17:00"],
  ["proposal-3", "2026-07-10", "Friday", "11:00"],
].map(([id, itemDate, day, startTime]) => ({
  confidence: 1,
  day: day as AssistantSuggestion["day"],
  description: "A validated reading session.",
  estimatedHours: 1,
  id,
  itemDate,
  plannedTask: "Prepare for the masjid halaqah.",
  projectName: "Read The Sealed Nectar",
  rationale: "Fits an open schedule window.",
  severity: "info",
  startTime,
  summary: "One-hour reading session",
  title: "Read The Sealed Nectar",
  type: "suggested_weekly_block",
}));

const series: RecurringSeriesProposal = {
  assumptions: [],
  conflicts: [],
  id: "sealed-nectar-series",
  occurrenceProposalIds: suggestions.map((suggestion) => suggestion.id),
  pattern: {
    durationMinutes: 60,
    preferredWeekdays: ["Sunday", "Wednesday", "Friday"],
    sessionsPerWeek: 3,
    typicalTimes: ["08:00", "17:00", "11:00"],
  },
  planningHorizon: {
    endDate: "2026-07-11",
    startDate: "2026-07-05",
    weeks: 1,
  },
  purpose: "Prepare for the masjid halaqah.",
  status: "pending",
  title: "Sealed Nectar Reading Plan",
  totalOccurrences: 3,
  weeklyTotalMinutes: 180,
  workflowId: "workflow-1",
};

const noOp = () => undefined;

function renderSeries({
  appliedIds = [],
  pendingIds = suggestions.map((suggestion) => suggestion.id),
  selectedIds = pendingIds,
}: {
  appliedIds?: string[];
  pendingIds?: string[];
  selectedIds?: string[];
} = {}) {
  const actionStates = Object.fromEntries(
    suggestions.map((suggestion) => [
      suggestion.id,
      {
        editing: false,
        status: appliedIds.includes(suggestion.id)
          ? ("applied" as const)
          : ("pending" as const),
      },
    ]),
  );

  return renderToStaticMarkup(
    <AssistantProposalSeries
      actionStates={actionStates}
      appliedProposalIds={appliedIds}
      pendingProposalIds={pendingIds}
      selectedProposalIds={new Set(selectedIds)}
      series={series}
      suggestions={suggestions}
      onApplySelected={noOp}
      onIgnore={noOp}
      onSelectionChange={noOp}
      onToggleEdit={noOp}
      onUpdate={noOp}
    />,
  );
}

function countMatches(value: string, pattern: RegExp) {
  return value.match(pattern)?.length ?? 0;
}

function runSeriesReviewCases() {
  const allSelected = renderSeries();
  assert.equal(
    countMatches(allSelected, />Sealed Nectar Reading Plan</g),
    1,
    "A recurring batch renders one parent title",
  );
  assert.equal(
    countMatches(allSelected, /type="checkbox"/g),
    3,
    "Three occurrences render as three selectable compact rows",
  );
  assert.match(allSelected, /Apply all 3/);
  assert.equal(countMatches(allSelected, /Apply all 3/g), 1);
  assert.doesNotMatch(allSelected, /Apply series/);
  assert.match(allSelected, /aria-expanded="false"/);
  assert.match(allSelected, /Sunday, July 5/);
  assert.match(allSelected, /Wednesday, July 8/);
  assert.match(allSelected, /Friday, July 10/);

  const twoSelected = renderSeries({
    selectedIds: ["proposal-1", "proposal-2"],
  });
  assert.match(twoSelected, /Apply selected \(2\)/);

  const applied = renderSeries({
    appliedIds: suggestions.map((suggestion) => suggestion.id),
    pendingIds: [],
    selectedIds: [],
  });
  assert.match(applied, /Applied · 3 sessions · 3 hours/);
  assert.match(applied, /View in Weekly Plan/);
  assert.match(applied, /View in Calendar/);
  assert.doesNotMatch(applied, /Apply all|Apply selected|Remove occurrence/);
}

function runWorkspaceSourceCases() {
  const assistantPage = readFileSync(
    new URL("../components/assistant/assistant-page.tsx", import.meta.url),
    "utf8",
  );
  const contextPanel = readFileSync(
    new URL("../components/assistant/assistant-context-panel.tsx", import.meta.url),
    "utf8",
  );
  const schedulerNav = readFileSync(
    new URL("../components/scheduler/scheduler-nav.tsx", import.meta.url),
    "utf8",
  );
  const globals = readFileSync(
    new URL("../app/globals.css", import.meta.url),
    "utf8",
  );
  const topNavigationBranch = schedulerNav.slice(
    schedulerNav.indexOf('if (variant === "top")'),
    schedulerNav.indexOf("return (\n    <>", schedulerNav.indexOf('if (variant === "top")')),
  );

  assert.equal(
    countMatches(topNavigationBranch, /<nav\b/g),
    1,
    "The Assistant top shell renders one navigation landmark",
  );
  assert.equal(
    countMatches(assistantPage, /<h1\b/g),
    1,
    "The Assistant workspace renders one page title",
  );
  assert.match(assistantPage, /isTrueEmptyState/);
  assert.match(assistantPage, /showsActiveClarification/);
  assert.doesNotMatch(assistantPage, /Apply series/);
  assert.doesNotMatch(assistantPage, /Suggested next steps/);
  assert.match(assistantPage, /sticky bottom-0/);
  assert.match(assistantPage, /aria-label="Conversation options"/);
  assert.match(contextPanel, /aria-modal="true"/);
  assert.match(contextPanel, /xl:hidden/);
  assert.match(contextPanel, /hidden[^\n]*xl:sticky/);
  assert.match(contextPanel, /Pending review/);
  assert.match(globals, /prefers-reduced-motion/);
}

runSeriesReviewCases();
runWorkspaceSourceCases();

console.log("Assistant UI tests passed: 20 focused cases");

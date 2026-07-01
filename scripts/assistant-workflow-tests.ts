import assert from "node:assert/strict";
import {
  advanceAssistantSchedulingConversation,
  createDeterministicScheduleAnswer,
  normalizeAssistantSchedulingContext,
  type AssistantScheduleAnalysisInput,
  type AssistantSchedulingConversationTurn,
} from "../lib/assistant-schedule-analysis";

const emptyWeek: AssistantScheduleAnalysisInput = {
  importedCalendarEvents: [],
  scheduledItems: [],
  timezone: "America/Detroit",
  weekStartDate: "2026-06-29",
  weeklyPlanBlocks: [],
  workShifts: [],
};

function advance(
  prompt: string,
  previous?: AssistantSchedulingConversationTurn | null,
  input = emptyWeek,
) {
  const turn = advanceAssistantSchedulingConversation({
    activeContext: previous?.context ?? null,
    input,
    prompt,
  });

  assert.ok(turn, `Expected the workflow to handle: ${prompt}`);
  return turn;
}

function runExactMsaWorkflow() {
  const initial = advance(
    "I need to make some time for planning MSA meetings. Can you plug it into one of my available spots?",
  );
  assert.equal(initial.context.state, "awaiting_window_selection");
  assert.equal(initial.context.purpose, "MSA meetings");
  assert.ok(initial.context.candidateWindows.every((window) => window.id));

  const selected = advance("Lets do wed", initial);
  assert.equal(selected.context.state, "awaiting_duration");
  assert.equal(selected.context.selectedDate, "2026-07-01");
  assert.match(selected.message, /How much time/i);

  const stillMissing = advance("sure", selected);
  assert.equal(stillMissing.context.state, "awaiting_duration");
  assert.equal(stillMissing.proposal, null);
  assert.match(stillMissing.message, /How much time/i);

  const ready = advance("one hour", stillMissing);
  assert.equal(ready.context.state, "awaiting_apply");
  assert.equal(ready.proposal?.title, "Plan MSA meetings");
  assert.equal(ready.proposal?.date, "2026-07-01");
  assert.equal(ready.proposal?.startTime, "08:00");
  assert.equal(ready.proposal?.durationMinutes, 60);
}

function runCorrectionAndValidationCases() {
  const initial = advance("Make some time for weekly planning in an open spot");
  const wednesday = advance("Wednesday", initial);
  const thursday = advance("Thursday instead", wednesday);
  assert.equal(thursday.context.selectedDate, "2026-07-02");
  assert.equal(thursday.context.state, "awaiting_duration");

  const tooLong = advance("20 hours", thursday);
  assert.equal(tooLong.context.state, "awaiting_duration");
  assert.match(tooLong.message, /fit up to/i);

  const ready = advance("two hours", tooLong);
  assert.equal(ready.context.state, "awaiting_apply");
  assert.equal(ready.proposal?.durationMinutes, 120);

  const persisted = normalizeAssistantSchedulingContext(
    JSON.parse(JSON.stringify(ready.context)),
  );
  assert.equal(persisted?.state, "awaiting_apply");
  assert.equal(persisted?.selectedWindowId, ready.context.selectedWindowId);
}

function runUnavailableAndBoundaryCases() {
  const blockedWednesday: AssistantScheduleAnalysisInput = {
    ...emptyWeek,
    workShifts: [
      {
        id: "work-wed",
        day: "Wednesday",
        startTime: "08:00",
        endTime: "22:00",
        location: "",
        notes: "",
        recurring: true,
      },
    ],
  };
  const initial = advance(
    "Make some time for MSA meetings in an available spot",
    null,
    blockedWednesday,
  );
  const unavailable = advance("wed", initial, blockedWednesday);
  assert.equal(unavailable.context.state, "needs_clarification");
  assert.match(unavailable.message, /don.t see a usable opening/i);

  const boundaryAnswer = createDeterministicScheduleAnswer({
    input: emptyWeek,
    prompt: "Find open time before Friday",
  });
  assert.ok(boundaryAnswer);
  assert.doesNotMatch(boundaryAnswer, /Friday:/i);
}

runExactMsaWorkflow();
runCorrectionAndValidationCases();
runUnavailableAndBoundaryCases();

console.log("Assistant workflow tests passed (3 suites, 18 assertions).\n");

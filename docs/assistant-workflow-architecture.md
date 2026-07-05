# Assistant scheduling workflow

## Request-to-record path

1. `components/assistant/assistant-page.tsx` submits the user message with a stable thread ID and persists chat messages separately from scheduling state.
2. `app/api/assistant/plan/route.ts` authenticates the user and loads projects, work shifts, exceptions, Weekly Plan blocks, scheduled items, and read-only imported events.
3. The route loads the latest `assistant_workflows` record for the signed-in user and thread. Browser-supplied workflow state is not authoritative.
4. Status questions are answered from the persisted workflow/proposals and verified saved Weekly Plan record IDs.
5. `lib/assistant-schedule-analysis.ts` interprets explicit scheduling requests and contextual follow-ups before any generic or model fallback.
6. `lib/assistant-intelligence.ts` preserves extracted activity, purpose, recurrence, explicit duration, explicit count, and missing fields.
7. Missing required fields produce one deterministic clarification and persist the workflow in `awaiting_clarification`.
8. Complete requests use deterministic candidate windows calculated from recurring work, date exceptions, Weekly Plan blocks, tasks/appointments, imported events, deadlines, and timezone.
9. The model may explain or rank validated options, but it does not create candidate times.
10. `lib/assistant-workflow.ts` rejects observations and validates every mutation before it becomes a proposal.
11. `lib/assistant-workflow-store.ts` atomically persists workflow state, proposal batch, and proposals through `persist_assistant_workflow`.
12. The plan route returns review actions only after persistence succeeds. A persistence failure returns zero actions and an explicit “nothing scheduled” response.
13. The Assistant UI renders only proposal IDs listed in the persisted workflow’s `pendingProposalIds`.
14. The visible count, context count, review queue, status answer, and apply request all use those same pending IDs.
15. `app/api/assistant/apply/route.ts` accepts workflow/proposal IDs, reloads the persisted records, and rejects missing, foreign, or already handled proposals.
16. The apply route revalidates each time against current server-loaded constraints before writing. It records saved IDs on applied proposals; timed blocks are rolled back if workflow-result persistence fails.
17. Apply and status responses use saved server records. Google Calendar and other imports remain read-only and are never mutated by this flow.

## Production failure root causes

- The original extraction trigger recognized “time for” and open/free-time wording, but not the production phrase “find time to read”; the activity never entered a persistent workflow.
- `createFallbackAssistantResponse` emitted the “highest-impact next steps” sentence whenever generic workload warnings existed. The plan route preferred this fallback before structured scheduling handling.
- The client appended “You’re all set” when local cards appeared handled; that condition had no relationship to server writes.
- “Put it on the schedule” was evaluated as a new prompt because active scheduling context existed only in a debounced client/thread snapshot and the failed first turn had created none.
- Workload warnings and model suggestions shared one `actions`/`suggestions` shape. The UI treated observations such as “Monday has work plus project blocks” as reviewable mutations.
- The collapsed proposal count counted all visible local action cards, while Planning context independently counted only actionable pending cards, producing 2 versus 0.
- There were two proposal systems: local chat/action-state cards and a separate scheduling-context pending proposal. Neither was a durable, authoritative review queue.
- Client normalization rewrote proposal IDs using message IDs, while apply accepted full browser-supplied suggestion payloads. Proposal identity was therefore not server-authoritative.
- Generic fallback responses bypassed mutation schema validation because no persisted proposal layer sat between response generation and rendering.

## Required invariants

- Explicit scheduling ends only in clarification, a persisted proposal, verified applied records, or a clear failure.
- `visible count = pendingProposalIds = persisted pending rows = review queue count`.
- A response cannot claim completion unless `completionStatus` and saved records support it.
- No proposal can apply without review approval and server-side revalidation.

## Semantic and recurring-series layer

- `lib/assistant-semantics.ts` separates activity title and purpose from scheduling commands, horizon, interval, duration, and weekly limits.
- Constraint contradictions are persisted in workflow context and require an explicit resolution before proposal generation.
- Multi-week series are expanded into date-specific canonical proposals. Weekly Plan records keep `scheduled_date` and `series_id`, so occurrences render only in their intended weeks.
- Response plans gate unrelated observations, select a concise mode, and expose raw availability only when the user asks for every option.

## Weekly-commitment follow-up fixes

- “At least three hours every week” previously matched neither the recurring-intent pattern nor the explicit scheduling pattern. The generic response path therefore ran before canonical workflow creation.
- The duration parser treated the weekly aggregate as one session duration. Weekly commitments are now extracted separately from per-session duration and persisted as `weeklyGoal.weeklyMinutes`.
- Split-session judgment is persisted as a pending recommendation. A contextual acceptance such as “Yes, let’s do that,” “Draft it,” or “Put it on the schedule” accepts that recommendation and immediately calculates proposals; it cannot trigger another permission question.
- A recurring goal with no horizon creates review proposals for one rolling planning week and records that bounded horizon. It never silently creates an indefinite series.
- Series weekly time is calculated from its dated occurrence proposals, not a project’s unrelated `weeklyHours` field.
- Normal work shifts remain internal constraints. Only a conflict, impossible deadline, missing critical source, or decision-changing issue can enter `Needs your attention`; acknowledgments and dismissals persist with the chat snapshot.
- The plan route does not construct the generic fallback until deterministic scheduling, clarification, status, and active-workflow paths have all declined the turn, so fallback workload notes cannot run ahead of intent understanding.
- Empty `schedule_exceptions` results are successful loads. The main schema now includes the table, indexes, trigger, RLS, and ownership policies; an existing production project must still run `supabase/schedule-exceptions.sql` once.
- Conversational normalization treats `everyweek` as `every week`, preserves bounded horizons such as `3-5 weeks`, and recognizes `three days of the week` as three sessions rather than an availability-only request.
- A request for one consecutive block repeated weekly keeps one deterministic weekday/start time across the selected horizon. A later split-session correction replaces that pattern while preserving the activity, purpose, workflow, and horizon.
- “Scan my schedule and choose” authorizes deterministic selection; it does not dump every opening or ask the user to choose again. Explicit weekday/time corrections are applied to the recurring pattern and propagated across its weeks.

# Assistant scheduling reliability

## Runtime architecture

- The assistant route is `app/api/assistant/plan/route.ts`.
- OpenAI calls use the official JavaScript SDK and the Responses API.
- `OPENAI_ASSISTANT_MODEL` selects the production model. `AI_MODEL` remains a legacy fallback. The default is `gpt-4o-mini`.
- The route makes a streamed plain-text call for conversational responses and a strict JSON-schema call when a request may need reviewable action cards.
- Availability, conflicts, candidate windows, and workflow progression are computed in `lib/assistant-schedule-analysis.ts`, not by the model.
- Conversation messages and the active scheduling context are persisted through `lib/assistant-conversation.ts` and `/api/assistant/conversation`.

## Scheduling workflow

The canonical state machine uses these states:

1. `idle`
2. `calculating_availability`
3. `awaiting_window_selection`
4. `awaiting_duration`
5. `awaiting_title`
6. `proposal_ready`
7. `awaiting_apply`
8. `applied`
9. `needs_clarification`
10. `failed`

Candidate windows receive deterministic IDs derived from their exact start and end timestamps. A selected candidate is stored by ID, so short replies and later corrections do not depend on reinterpreting free-form model text.

The workflow does not create a proposal until it has a title, date, start time, positive duration, and a candidate window that can fit that duration. Applying the resulting card remains a separate user action.

## Model boundary

Structured model output declares:

- response text
- intent
- workflow transition
- extracted scheduling fields
- missing fields
- whether an action card is ready

The server discards model-generated action cards when `actionCardReady` is false. The deterministic workflow handles open-window selection and duration collection before model generation can intervene.

The model must not calculate availability, invent conflicts, save changes, or write to Google Calendar.

## Repeatable verification

Run deterministic workflow regression tests:

```bash
npm run test:assistant-workflow
```

The suite includes the MSA planning conversation, abbreviated weekday selection, ambiguous confirmation while duration is missing, corrections, oversized durations, blocked days, date boundaries, and persisted-state normalization.

Run an optional model comparison:

```bash
OPENAI_API_KEY=... \
OPENAI_ASSISTANT_MODEL=gpt-4o-mini \
OPENAI_ASSISTANT_EVAL_MODEL=... \
npm run eval:assistant-models
```

The harness runs the same fixed prompts against both models and reports completion, elapsed time, and token usage. It does not change the production model. Do not recommend a model switch without recording live comparison results and reviewing correctness as well as latency and cost.

## Current model decision

Keep `gpt-4o-mini` as the default until the comparison harness produces evidence that another configured model materially improves multi-turn correctness without unacceptable latency or cost. The deterministic state machine, not a larger model, is the primary fix for the observed confirmation loop.

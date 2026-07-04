import OpenAI from "openai";

const primaryModel =
  process.env.OPENAI_ASSISTANT_MODEL?.trim() ||
  process.env.AI_MODEL?.trim() ||
  "gpt-4o-mini";
const evaluationModel = process.env.OPENAI_ASSISTANT_EVAL_MODEL?.trim();
const apiKey = process.env.OPENAI_API_KEY?.trim();

const cases = [
  "Find me open time",
  "Plan my week",
  "Is my plan ready to sync?",
  "I need to make some time for planning MSA meetings. Can you plug it into one of my available spots?",
  "Lets do wed",
  "sure",
  "one hour",
  "I need to prepare for weekly halaqahs. Find me time throughout the week to read The Sealed Nectar.",
  "Three sessions, 45 minutes each.",
  "Is it on the schedule?",
  "I have an assignment due Thursday, a work report due Friday, MSA preparation, groceries, and two workouts. Plan them around my week.",
];

if (!apiKey || !evaluationModel) {
  console.log(
    [
      "Model comparison was not run.",
      `Primary model: ${primaryModel}`,
      `OPENAI_API_KEY: ${apiKey ? "configured" : "missing"}`,
      `OPENAI_ASSISTANT_EVAL_MODEL: ${evaluationModel ?? "missing"}`,
      "Configure both variables to compare the same fixed cases without changing the production model.",
    ].join("\n"),
  );
  process.exit(0);
}

const client = new OpenAI({ apiKey });

async function evaluate(model: string) {
  const startedAt = Date.now();
  let completed = 0;
  let inputTokens = 0;
  let outputTokens = 0;

  for (const prompt of cases) {
    const response = await client.responses.create({
      model,
      instructions:
        "Classify the user message as question, analysis, planning_change, sync, open_time, greeting, or vague. Reply in one concise sentence and never claim a schedule change was saved.",
      input: prompt,
      max_output_tokens: 120,
    });
    assertResponse(response.output_text, model, prompt);
    completed += 1;
    inputTokens += response.usage?.input_tokens ?? 0;
    outputTokens += response.usage?.output_tokens ?? 0;
  }

  return {
    model,
    completed: `${completed}/${cases.length}`,
    elapsedMs: Date.now() - startedAt,
    inputTokens,
    outputTokens,
  };
}

function assertResponse(output: string, model: string, prompt: string) {
  if (!output.trim()) {
    throw new Error(`${model} returned an empty response for: ${prompt}`);
  }
}

async function main() {
  const results = [];

  for (const model of [primaryModel, evaluationModel]) {
    results.push(await evaluate(model));
  }

  console.table(results);
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});

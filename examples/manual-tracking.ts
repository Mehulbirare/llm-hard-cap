/**
 * Example: using `check` after you already have token counts
 * (e.g. from a custom client, Bedrock, Ollama, etc).
 */
import { BudgetGuard } from "llm-budget-guard";

const guard = new BudgetGuard({
  limits: { daily: 1 },
  pricing: {
    // Add your own model
    "my-fine-tune-v1": { input: 0.4, output: 1.2 },
  },
});

async function afterEachCall(usage: { prompt_tokens: number; completion_tokens: number }) {
  const { costUsd, summary } = await guard.check({
    model: "my-fine-tune-v1",
    inputTokens: usage.prompt_tokens,
    outputTokens: usage.completion_tokens,
  });
  console.log(`Cost: $${costUsd.toFixed(6)} | today: $${summary.day.toFixed(4)}`);
}

afterEachCall({ prompt_tokens: 250_000, completion_tokens: 100_000 });

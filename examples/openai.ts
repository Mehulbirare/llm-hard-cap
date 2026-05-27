/**
 * Example: protect an OpenAI call with a daily spend cap.
 * Run: `OPENAI_API_KEY=sk-... npx tsx examples/openai.ts`
 */
import OpenAI from "openai";
import { BudgetGuard, FileStorage } from "llm-hard-cap";

const openai = new OpenAI();

const guard = new BudgetGuard({
  limits: { daily: 5, monthly: 50, perRequest: 0.25 },
  storage: new FileStorage("./.llm-hard-cap.json"),
  onSpend: (e) => console.log(`spent $${e.costUsd.toFixed(4)} on ${e.model}`),
});

async function main() {
  const response = await guard.wrap(
    { model: "gpt-4o-mini", estimatedInputTokens: 500, estimatedOutputTokens: 300 },
    () =>
      openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [{ role: "user", content: "Write a haiku about budgets." }],
      }),
  );

  console.log(response.choices[0]?.message?.content);
  console.log("Today so far:", await guard.usage());
}

main().catch((err) => {
  if (err.code === "BUDGET_EXCEEDED") {
    console.error("Refusing to call OpenAI:", err.message);
    process.exit(1);
  }
  throw err;
});

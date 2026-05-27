/**
 * Example: protect Anthropic Claude calls with budget caps.
 * Run: `ANTHROPIC_API_KEY=... npx tsx examples/anthropic.ts`
 */
import Anthropic from "@anthropic-ai/sdk";
import { BudgetGuard } from "llm-hard-cap";

const client = new Anthropic();
const guard = new BudgetGuard({ limits: { daily: 10 } });

async function main() {
  const result = await guard.wrap(
    {
      model: "claude-sonnet-4-6",
      estimatedInputTokens: 1000,
      estimatedOutputTokens: 500,
    },
    () =>
      client.messages.create({
        model: "claude-sonnet-4-6",
        max_tokens: 1024,
        messages: [{ role: "user", content: "Summarize prompt caching in two sentences." }],
      }),
  );

  console.log(result.content);
  console.log("Usage:", await guard.usage());
}

main();

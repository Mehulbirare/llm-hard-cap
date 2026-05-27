/**
 * Example: per-user budget enforcement in an Express API.
 * Free users get $0.10/day, paid users get $5/day.
 */
import express from "express";
import OpenAI from "openai";
import { BudgetGuard, BudgetExceededError } from "llm-budget-guard";

const app = express();
app.use(express.json());

const openai = new OpenAI();
const guard = new BudgetGuard({
  limits: { daily: 100 }, // global ceiling
});

app.post("/chat", async (req, res) => {
  const userId: string = req.body.userId;
  const plan: "free" | "pro" = req.body.plan ?? "free";
  const dailyLimit = plan === "pro" ? 5 : 0.1;

  const userGuard = guard.for(`user:${userId}`, { daily: dailyLimit });

  try {
    const response = await userGuard.wrap(
      { model: "gpt-4o-mini", estimatedInputTokens: 500, estimatedOutputTokens: 400 },
      () =>
        openai.chat.completions.create({
          model: "gpt-4o-mini",
          messages: [{ role: "user", content: req.body.prompt }],
        }),
    );
    res.json({ reply: response.choices[0]?.message?.content });
  } catch (err) {
    if (err instanceof BudgetExceededError) {
      return res.status(429).json({
        error: "budget_exceeded",
        window: err.window,
        limitUsd: err.limitUsd,
        currentUsd: err.currentUsd,
        upgrade: plan === "free" ? "Upgrade to Pro for higher daily limits." : undefined,
      });
    }
    throw err;
  }
});

app.get("/usage/:userId", async (req, res) => {
  res.json(await guard.usage(`user:${req.params.userId}`));
});

app.listen(3000, () => console.log("listening on :3000"));

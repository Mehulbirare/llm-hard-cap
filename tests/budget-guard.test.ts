import { describe, it, expect, beforeEach } from "vitest";
import {
  BudgetGuard,
  BudgetExceededError,
  MemoryStorage,
  calculateCost,
  getPricing,
} from "../src/index.js";

describe("calculateCost", () => {
  it("computes USD from token counts for a known model", () => {
    // gpt-4o: $2.50 in / $10 out per 1M tokens
    expect(calculateCost("gpt-4o", 1_000_000, 0)).toBeCloseTo(2.5, 6);
    expect(calculateCost("gpt-4o", 0, 1_000_000)).toBeCloseTo(10, 6);
    expect(calculateCost("gpt-4o", 500_000, 200_000)).toBeCloseTo(2.5 * 0.5 + 10 * 0.2, 6);
  });

  it("falls back to a prefix match for snapshot model ids", () => {
    expect(getPricing("gpt-4o-2024-11-20")).toBeDefined();
  });

  it("returns 0 for unknown models", () => {
    expect(calculateCost("does-not-exist-xyz", 1000, 1000)).toBe(0);
  });

  it("respects pricing overrides", () => {
    const cost = calculateCost("custom-model", 1_000_000, 0, {
      "custom-model": { input: 7, output: 14 },
    });
    expect(cost).toBe(7);
  });
});

describe("BudgetGuard.check", () => {
  it("records usage and returns running totals", async () => {
    const guard = new BudgetGuard({ limits: { daily: 10 } });
    const r1 = await guard.check({ model: "gpt-4o-mini", inputTokens: 1_000_000, outputTokens: 0 });
    expect(r1.costUsd).toBeCloseTo(0.15, 6);
    expect(r1.summary.day).toBeCloseTo(0.15, 6);
    expect(r1.summary.requests).toBe(1);

    const r2 = await guard.check({ model: "gpt-4o-mini", inputTokens: 1_000_000, outputTokens: 0 });
    expect(r2.summary.day).toBeCloseTo(0.3, 6);
    expect(r2.summary.requests).toBe(2);
  });

  it("throws BudgetExceededError when daily limit is exceeded", async () => {
    const guard = new BudgetGuard({ limits: { daily: 1 } });
    // gpt-4o input @ $2.50 / 1M -> 1M tokens = $2.50, over $1 limit
    await expect(
      guard.check({ model: "gpt-4o", inputTokens: 1_000_000, outputTokens: 0 }),
    ).rejects.toBeInstanceOf(BudgetExceededError);
  });

  it("does not record usage when a call would exceed the limit", async () => {
    const guard = new BudgetGuard({ limits: { daily: 1 } });
    await expect(
      guard.check({ model: "gpt-4o", inputTokens: 1_000_000, outputTokens: 0 }),
    ).rejects.toThrow();
    const u = await guard.usage();
    expect(u.day).toBe(0);
    expect(u.requests).toBe(0);
  });

  it("enforces a per-request cap", async () => {
    const guard = new BudgetGuard({ limits: { perRequest: 0.05 } });
    // gpt-4o-mini: 1M input = $0.15, over $0.05 cap
    await expect(
      guard.check({ model: "gpt-4o-mini", inputTokens: 1_000_000, outputTokens: 0 }),
    ).rejects.toBeInstanceOf(BudgetExceededError);
  });

  it("warn mode does not throw but logs", async () => {
    const guard = new BudgetGuard({ limits: { daily: 0.01 }, onExceeded: "warn" });
    const r = await guard.check({ model: "gpt-4o-mini", inputTokens: 1_000_000, outputTokens: 0 });
    expect(r.costUsd).toBeCloseTo(0.15, 6);
  });
});

describe("BudgetGuard.estimate", () => {
  it("returns projected cost without recording", async () => {
    const guard = new BudgetGuard({ limits: { daily: 100 } });
    const { projectedUsd } = await guard.estimate({
      model: "gpt-4o-mini",
      estimatedInputTokens: 1_000_000,
    });
    expect(projectedUsd).toBeCloseTo(0.15, 6);
    const u = await guard.usage();
    expect(u.requests).toBe(0);
  });

  it("throws if the estimate would exceed limits", async () => {
    const guard = new BudgetGuard({ limits: { daily: 0.1 } });
    await expect(
      guard.estimate({ model: "gpt-4o-mini", estimatedInputTokens: 1_000_000 }),
    ).rejects.toBeInstanceOf(BudgetExceededError);
  });
});

describe("BudgetGuard.wrap", () => {
  it("auto-extracts OpenAI-style usage", async () => {
    const guard = new BudgetGuard({ limits: { daily: 10 } });
    const fakeOpenAi = async () => ({
      choices: [{ message: { content: "hi" } }],
      usage: { prompt_tokens: 1000, completion_tokens: 500 },
    });
    await guard.wrap({ model: "gpt-4o", estimatedInputTokens: 1000, estimatedOutputTokens: 500 }, fakeOpenAi);
    const u = await guard.usage();
    expect(u.requests).toBe(1);
    expect(u.day).toBeCloseTo(calculateCost("gpt-4o", 1000, 500), 6);
  });

  it("auto-extracts Anthropic-style usage", async () => {
    const guard = new BudgetGuard({ limits: { daily: 10 } });
    const fakeAnthropic = async () => ({
      content: [{ type: "text", text: "hi" }],
      usage: { input_tokens: 800, output_tokens: 400 },
    });
    await guard.wrap(
      { model: "claude-sonnet-4-6", estimatedInputTokens: 800, estimatedOutputTokens: 400 },
      fakeAnthropic,
    );
    const u = await guard.usage();
    expect(u.requests).toBe(1);
  });

  it("prevents the call if estimate exceeds budget", async () => {
    const guard = new BudgetGuard({ limits: { daily: 0.01 } });
    let called = false;
    const fake = async () => {
      called = true;
      return { usage: { prompt_tokens: 1, completion_tokens: 1 } };
    };
    await expect(
      guard.wrap(
        { model: "gpt-4o", estimatedInputTokens: 1_000_000, estimatedOutputTokens: 0 },
        fake,
      ),
    ).rejects.toBeInstanceOf(BudgetExceededError);
    expect(called).toBe(false);
  });
});

describe("scoped guards (per-user limits)", () => {
  it("tracks each scope independently", async () => {
    const guard = new BudgetGuard({ limits: { daily: 1 } });
    const alice = guard.for("user:alice");
    const bob = guard.for("user:bob");

    await alice.check({ model: "gpt-4o-mini", inputTokens: 1_000_000, outputTokens: 0 });
    await bob.check({ model: "gpt-4o-mini", inputTokens: 1_000_000, outputTokens: 0 });

    expect((await alice.usage()).day).toBeCloseTo(0.15, 6);
    expect((await bob.usage()).day).toBeCloseTo(0.15, 6);
    expect((await alice.usage()).requests).toBe(1);
  });

  it("supports per-user override limits stricter than the global default", async () => {
    const guard = new BudgetGuard({ limits: { daily: 100 } });
    const tightUser = guard.for("user:trial", { daily: 0.05 });
    await expect(
      tightUser.check({ model: "gpt-4o-mini", inputTokens: 1_000_000, outputTokens: 0 }),
    ).rejects.toBeInstanceOf(BudgetExceededError);
  });
});

describe("MemoryStorage", () => {
  let storage: MemoryStorage;
  beforeEach(() => {
    storage = new MemoryStorage();
  });

  it("reset clears a single scope", () => {
    storage.record({
      model: "gpt-4o",
      inputTokens: 100,
      outputTokens: 100,
      costUsd: 1,
      scope: "a",
      timestamp: Date.now(),
    });
    storage.record({
      model: "gpt-4o",
      inputTokens: 100,
      outputTokens: 100,
      costUsd: 2,
      scope: "b",
      timestamp: Date.now(),
    });
    storage.reset("a");
    expect(storage.summary("a").total).toBe(0);
    expect(storage.summary("b").total).toBe(2);
  });
});

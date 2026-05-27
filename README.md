# llm-hard-cap

> **Hard spend limits for OpenAI, Anthropic Claude, Google Gemini, and any LLM API.**
> Track token costs in real time, enforce daily / monthly / per-user USD caps, and stop runaway AI bills before they happen.

[![npm](https://img.shields.io/npm/v/llm-hard-cap.svg)](https://www.npmjs.com/package/llm-hard-cap)
[![downloads](https://img.shields.io/npm/dm/llm-hard-cap.svg)](https://www.npmjs.com/package/llm-hard-cap)
[![bundle size](https://img.shields.io/bundlephobia/minzip/llm-hard-cap)](https://bundlephobia.com/package/llm-hard-cap)
[![types](https://img.shields.io/npm/types/llm-hard-cap.svg)](#)
[![license](https://img.shields.io/npm/l/llm-hard-cap.svg)](LICENSE)

```bash
npm install llm-hard-cap
```

`llm-hard-cap` is a zero-dependency TypeScript library that puts a hard ceiling on what your application can spend on LLM APIs. It supports **OpenAI** (GPT-4o, GPT-4-turbo, o1, o3-mini), **Anthropic Claude** (Opus 4.7, Sonnet 4.6, Haiku 4.5), **Google Gemini** (1.5/2.0/2.5), **Mistral**, **DeepSeek**, and any custom model you add.

If you've ever woken up to a $30,000 OpenAI bill from a runaway loop, or shipped an AI feature without per-user limits and learned the hard way that one user can drain your monthly quota in an hour — this is for you.

---

## Why this exists

LLM provider dashboards show you what you spent *yesterday*. Rate limits stop you at 10,000 RPM, not at $500. So when a bug, retry loop, or one heavy user starts burning tokens, you find out from the bill.

`llm-hard-cap` enforces spend at the **call site**, before the request goes out:

- **Hard caps in USD**, not RPM. `daily: 10` means "$10/day, full stop."
- **Per-user / per-route scoping.** Free users get $0.10/day; paid users get $5; an experimental route gets $1.
- **Pre-flight estimate + post-flight reconciliation.** Block expensive calls *before* they hit the API, then record the actual cost from the response.
- **Provider-agnostic.** Built-in pricing for 25+ models; bring your own for fine-tunes, Bedrock, Ollama, etc.
- **Zero dependencies.** ~3 KB gzipped. TypeScript-first. Works in Node 18+, Bun, Deno.

---

## Quick start

```ts
import OpenAI from "openai";
import { BudgetGuard } from "llm-hard-cap";

const openai = new OpenAI();
const guard = new BudgetGuard({
  limits: { daily: 10, monthly: 200 },
});

const response = await guard.wrap(
  { model: "gpt-4o-mini", estimatedInputTokens: 500, estimatedOutputTokens: 300 },
  () =>
    openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: "Hello!" }],
    }),
);
```

If today's spend would push past `$10`, `guard.wrap` throws `BudgetExceededError` **before** the OpenAI call is made. Actual token usage is recorded automatically after the call returns.

---

## Per-user spend limits in 5 lines

Free vs. paid tiers without writing a quota system:

```ts
const guard = new BudgetGuard({ limits: { daily: 100 } }); // global ceiling

const userGuard = guard.for(`user:${userId}`, {
  daily: plan === "pro" ? 5 : 0.1,
});

await userGuard.wrap({ model: "gpt-4o", estimatedInputTokens: 1000 }, callOpenAi);
```

Each scope is tracked independently. Reset a scope when a user upgrades, or query their current usage:

```ts
await guard.usage("user:alice"); // { day: 0.0427, month: 1.13, total: 9.42, requests: 87 }
```

---

## Three modes of use

### 1. `wrap` — protect a single call (recommended)

```ts
const result = await guard.wrap(
  { model: "claude-sonnet-4-6", estimatedInputTokens: 800, estimatedOutputTokens: 400 },
  () => anthropic.messages.create({ /* ... */ }),
);
```

`wrap` runs a pre-flight estimate, executes the call, and then records actual usage from the response. It auto-detects OpenAI-style (`usage.prompt_tokens` / `usage.completion_tokens`) and Anthropic-style (`usage.input_tokens` / `usage.output_tokens`) responses.

For other providers, pass an `extract` function:

```ts
await guard.wrap(
  { model: "gemini-1.5-pro", estimatedInputTokens: 1000 },
  () => gemini.generateContent({ /* ... */ }),
  (r) => ({
    inputTokens: r.usageMetadata.promptTokenCount,
    outputTokens: r.usageMetadata.candidatesTokenCount,
  }),
);
```

### 2. `estimate` — pre-flight check only

```ts
const { projectedUsd } = await guard.estimate({
  model: "gpt-4o",
  estimatedInputTokens: 50_000,
});
// Throws BudgetExceededError if not affordable, otherwise returns the cost.
```

### 3. `check` — record after the fact

When you already have real token counts (custom client, streaming, batch jobs):

```ts
await guard.check({
  model: "gpt-4o",
  inputTokens: response.usage.prompt_tokens,
  outputTokens: response.usage.completion_tokens,
});
```

---

## Limits you can set

```ts
new BudgetGuard({
  limits: {
    perRequest: 0.25, // refuse any single call over $0.25
    daily: 10,        // $10 per UTC day
    monthly: 200,     // $200 per UTC month
    total: 1000,      // $1000 lifetime cap (per scope)
  },
  onExceeded: "throw", // or "warn" / "block"
});
```

Limits are checked in this order: `perRequest`, `daily`, `monthly`, `total`. The first violation throws `BudgetExceededError`, which exposes `.window`, `.limitUsd`, `.currentUsd`, `.projectedUsd`, and `.scope`.

---

## Handling rejected calls

```ts
import { BudgetExceededError } from "llm-hard-cap";

try {
  await guard.wrap({ model: "gpt-4o", estimatedInputTokens: 1000 }, call);
} catch (err) {
  if (err instanceof BudgetExceededError) {
    return res.status(429).json({
      error: "budget_exceeded",
      window: err.window, // "perRequest" | "day" | "month" | "total"
      limitUsd: err.limitUsd,
      currentUsd: err.currentUsd,
    });
  }
  throw err;
}
```

---

## Persistence

The default storage is in-memory — fine for short-lived scripts and tests. For real apps:

```ts
import { BudgetGuard, FileStorage } from "llm-hard-cap";

const guard = new BudgetGuard({
  limits: { daily: 10 },
  storage: new FileStorage("./.llm-hard-cap.json"),
});
```

For distributed / multi-process setups, implement the `Storage` interface against Redis, Postgres, or your existing database:

```ts
import type { Storage, SpendEvent, UsageSummary } from "llm-hard-cap";

class RedisStorage implements Storage {
  async record(event: SpendEvent) { /* INCRBYFLOAT keys */ }
  async summary(scope: string): Promise<UsageSummary> { /* GET keys */ }
  async reset(scope?: string) { /* DEL */ }
}
```

---

## Supported models out of the box

Pricing is built-in for:

| Provider   | Models |
|------------|--------|
| OpenAI     | `gpt-4o`, `gpt-4o-mini`, `gpt-4-turbo`, `gpt-4`, `gpt-3.5-turbo`, `o1`, `o1-mini`, `o3-mini` |
| Anthropic  | `claude-opus-4-7`, `claude-opus-4-6`, `claude-sonnet-4-6`, `claude-sonnet-4`, `claude-haiku-4-5`, plus all Claude 3.x snapshots |
| Google     | `gemini-1.5-pro`, `gemini-1.5-flash`, `gemini-2.0-flash`, `gemini-2.5-pro` |
| Mistral    | `mistral-large-latest`, `mistral-small-latest` |
| DeepSeek   | `deepseek-chat`, `deepseek-reasoner` |

Snapshot IDs like `gpt-4o-2024-11-20` fall back via prefix match. Override or extend at any time:

```ts
new BudgetGuard({
  limits: { daily: 5 },
  pricing: {
    "my-fine-tune": { input: 0.8, output: 2.4 }, // USD per 1M tokens
  },
});
```

---

## FAQ

### How is this different from OpenAI's usage limits in the dashboard?

OpenAI's caps are organization-wide, settle a day later, and don't tell you *who* spent what. `llm-hard-cap` enforces in real time, per scope (user, route, environment), and rejects calls before they leave your server.

### Does this work with streaming responses?

Yes. Use `estimate` before opening the stream, then `check` once you receive the final usage event (OpenAI emits `usage` in the last chunk if you pass `stream_options: { include_usage: true }`).

### Does this work with prompt caching discounts?

Compute the cost yourself with the cached vs. non-cached split and pass it via the `pricing` override or call `calculateCost` and use `check` with the real counts.

### Does it count tokens for me?

No — it expects you to pass token counts (from the API response, or your own pre-flight estimate via tiktoken / `@anthropic-ai/tokenizer`). This keeps the package zero-dependency and accurate.

### What happens on rate limit / 5xx errors?

The wrapped call propagates the error untouched. Nothing is recorded if the response doesn't include usage. This means failed calls don't count against your budget — exactly what you want.

### Is it safe for multi-process servers?

The default `MemoryStorage` is per-process. Use `FileStorage` for single-host setups or implement `Storage` against Redis / Postgres for distributed apps.

---

## API reference

### `new BudgetGuard(options)`

| Option         | Type                              | Default        |
|----------------|-----------------------------------|----------------|
| `limits`       | `BudgetLimits`                    | required       |
| `onExceeded`   | `"throw" \| "warn" \| "block"`    | `"throw"`      |
| `storage`      | `Storage`                         | `MemoryStorage`|
| `pricing`      | `Record<string, ModelPricing>`    | —              |
| `onSpend`      | `(event: SpendEvent) => void`     | —              |

### Methods

- `guard.wrap(args, call, extract?)` — pre-check, run, record. Returns the call's result.
- `guard.estimate(args)` — pre-check only. Throws on violation.
- `guard.check(args)` — record actual usage. Throws on violation.
- `guard.for(scope, limits?)` — scoped child guard (per-user / per-route).
- `guard.usage(scope?)` — current `{ day, month, total, requests }`.
- `guard.reset(scope?)` — clear usage for a scope (or all).

---

## Examples

See [`examples/`](./examples) for runnable scripts:

- [`openai.ts`](./examples/openai.ts) — OpenAI chat completion with file-backed storage
- [`anthropic.ts`](./examples/anthropic.ts) — Claude with default in-memory tracking
- [`express-middleware.ts`](./examples/express-middleware.ts) — per-user free/paid tiers
- [`manual-tracking.ts`](./examples/manual-tracking.ts) — custom models / providers

---

## Comparison

| | `llm-hard-cap` | Provider dashboards | API gateway proxies |
|--|--|--|--|
| Real-time enforcement | ✅ | ❌ (delayed) | ✅ |
| Per-user / per-scope | ✅ | ❌ | partial |
| Zero infrastructure | ✅ | ✅ | ❌ (extra hop) |
| Works across providers | ✅ | one each | ✅ |
| Refuses calls *before* request | ✅ | ❌ | ✅ |
| Bundle size | < 4 KB | n/a | n/a |

---

## Contributing

Issues and PRs welcome. Pricing updates appreciated — providers change rates often.

## License

MIT

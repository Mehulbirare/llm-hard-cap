import { BudgetExceededError, UnknownModelError, pickViolation } from "./errors.js";
import { calculateCost, hasPricing } from "./pricing.js";
import { MemoryStorage } from "./storage.js";
import type {
  BudgetGuardOptions,
  BudgetLimits,
  CheckArgs,
  EstimateArgs,
  ModelPricing,
  OnExceeded,
  SpendEvent,
  Storage,
  UsageSummary,
} from "./types.js";

const DEFAULT_SCOPE = "global";

export class BudgetGuard {
  private readonly defaultLimits: BudgetLimits;
  private readonly onExceeded: OnExceeded;
  private readonly storage: Storage;
  private readonly pricing: Record<string, ModelPricing> | undefined;
  private readonly onUnknownModel: "throw" | "zero";
  private readonly onSpend: ((event: SpendEvent) => void) | undefined;
  /** Per-scope promise chain used to serialise check/record operations (Fix: TOCTOU race). */
  private readonly _pending = new Map<string, Promise<void>>();

  constructor(options: BudgetGuardOptions) {
    this.defaultLimits = options.limits;
    this.onExceeded = options.onExceeded ?? "throw";
    this.storage = options.storage ?? new MemoryStorage();
    this.pricing = options.pricing;
    this.onUnknownModel = options.onUnknownModel ?? "throw";
    this.onSpend = options.onSpend;
  }

  /**
   * Check that a known-cost call is within budget, then record it.
   * Use this AFTER an LLM call returns and you have real token counts.
   */
  async check(
    args: CheckArgs,
  ): Promise<{ costUsd: number; summary: UsageSummary; recorded: boolean }> {
    const scope = args.scope ?? DEFAULT_SCOPE;
    this.assertKnownModel(args.model);
    const inputTokens = args.inputTokens;
    const outputTokens = args.outputTokens ?? 0;
    const cost = calculateCost(args.model, inputTokens, outputTokens, this.pricing);
    const limits = { ...this.defaultLimits, ...(args.limits ?? {}) };

    // Serialise per-scope to prevent TOCTOU races on concurrent requests.
    return this.withScopeLock(scope, async () => {
      const before = await this.storage.summary(scope);
      const error = this.evaluate(before, cost, limits, scope);
      if (error) {
        // "throw" stops here; "block" refuses without recording; "warn"
        // logs but lets the spend through AND records it so totals stay accurate.
        if (this.onExceeded === "throw") throw error;
        console.warn(`[llm-hard-cap] ${error.message}`);
        if (this.onExceeded === "block") {
          return { costUsd: cost, summary: before, recorded: false };
        }
      }

      const event: SpendEvent = {
        model: args.model,
        inputTokens,
        outputTokens,
        costUsd: cost,
        scope,
        timestamp: Date.now(),
      };
      await this.storage.record(event);
      this.onSpend?.(event);
      const after = await this.storage.summary(scope);
      return { costUsd: cost, summary: after, recorded: true };
    });
  }

  /**
   * Check that an *estimated* call would fit in the remaining budget.
   * Use this BEFORE making the LLM call. Nothing is recorded.
   * Returns the projected cost if allowed; throws (or returns)
   * a BudgetExceededError per `onExceeded` policy.
   */
  async estimate(
    args: EstimateArgs,
  ): Promise<{ projectedUsd: number; summary: UsageSummary; allowed: boolean }> {
    const { projectedUsd, summary, allowed } = await this.preCheck(args);
    return { projectedUsd, summary, allowed };
  }

  /**
   * Wrap an async LLM call. Pre-checks against the estimate, runs the
   * call, then records actual usage using the result via `extract`.
   *
   * If `extract` is omitted, expects an OpenAI-style response with
   * `usage: { prompt_tokens, completion_tokens }` OR an Anthropic-style
   * response with `usage: { input_tokens, output_tokens }`.
   */
  async wrap<T>(
    args: EstimateArgs,
    call: () => Promise<T>,
    extract?: (result: T) => { inputTokens: number; outputTokens: number },
  ): Promise<T> {
    const { allowed, error } = await this.preCheck(args);
    if (!allowed) {
      // "block" mode: refuse the call. `wrap` has no value to return
      // without calling, so it surfaces the violation by throwing.
      throw error ?? new Error("[llm-hard-cap] call blocked by budget guard");
    }
    const result = await call();
    const usage = extract ? extract(result) : defaultExtract(result);
    if (usage) {
      // Use recordOnly() — not check() — so a call that already ran and was
      // billed is never rejected by a second budget evaluation (Fix: double-charge).
      await this.recordOnly({
        model: args.model,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        scope: args.scope ?? DEFAULT_SCOPE,
      });
    } else {
      console.warn(
        "[llm-hard-cap] Could not extract usage from LLM response; spend not recorded. " +
          "Provide a custom `extract` function if you are using a non-standard response shape.",
      );
    }
    return result;
  }

  /** Get current usage for a scope (defaults to "global"). */
  usage(scope: string = DEFAULT_SCOPE): Promise<UsageSummary> | UsageSummary {
    return this.storage.summary(scope);
  }

  /** Reset usage for a scope, or all scopes if none given. */
  reset(scope?: string): Promise<void> | void {
    return this.storage.reset(scope);
  }

  /** Create a child guard bound to a specific scope (e.g. per-user). */
  for(scope: string, limits?: BudgetLimits): ScopedGuard {
    return new ScopedGuard(this, scope, limits);
  }

  /** Throw if the model has no pricing and policy is "throw". */
  private assertKnownModel(model: string): void {
    if (this.onUnknownModel === "zero") return;
    if (!hasPricing(model, this.pricing)) throw new UnknownModelError(model);
  }

  /** Build a BudgetExceededError for the first violated limit, or null. */
  private evaluate(
    summary: UsageSummary,
    cost: number,
    limits: BudgetLimits,
    scope: string,
  ): BudgetExceededError | null {
    const v = pickViolation(summary, cost, limits);
    if (!v) return null;
    return new BudgetExceededError({
      window: v.window,
      limitUsd: v.limit,
      currentUsd: v.current,
      projectedUsd: v.projected,
      scope,
    });
  }

  /**
   * Shared pre-flight logic for `estimate` and `wrap`. Applies the
   * `onExceeded` policy: "throw" throws, "block" returns allowed=false,
   * "warn" logs and returns allowed=true.
   */
  private async preCheck(
    args: EstimateArgs,
  ): Promise<{
    projectedUsd: number;
    summary: UsageSummary;
    allowed: boolean;
    error: BudgetExceededError | null;
  }> {
    const scope = args.scope ?? DEFAULT_SCOPE;
    this.assertKnownModel(args.model);
    const cost = calculateCost(
      args.model,
      args.estimatedInputTokens,
      args.estimatedOutputTokens ?? 0,
      this.pricing,
    );
    const limits = { ...this.defaultLimits, ...(args.limits ?? {}) };
    const summary = await this.storage.summary(scope);
    const error = this.evaluate(summary, cost, limits, scope);
    let allowed = true;
    if (error) {
      if (this.onExceeded === "throw") throw error;
      console.warn(`[llm-hard-cap] ${error.message}`);
      if (this.onExceeded === "block") allowed = false;
    }
    return { projectedUsd: cost, summary, allowed, error };
  }

  /**
   * Serialise operations for a given scope using a promise chain so that
   * concurrent check/record calls cannot interleave (Fix: TOCTOU race).
   */
  private withScopeLock<T>(scope: string, fn: () => Promise<T>): Promise<T> {
    const prev = this._pending.get(scope) ?? Promise.resolve();
    let release!: () => void;
    const gate = new Promise<void>((res) => (release = res));
    this._pending.set(scope, gate);
    return prev
      .then(() => fn())
      .finally(() => {
        release();
        // Clean up the map entry once the lock is free and nobody else is queued.
        if (this._pending.get(scope) === gate) this._pending.delete(scope);
      });
  }

  /**
   * Record actual spend for a completed LLM call WITHOUT re-evaluating budget limits.
   * Used by `wrap()` so a call that has already been made and billed is never denied
   * by a second budget check against potentially-stale estimates (Fix: double-charge).
   */
  private async recordOnly(args: {
    model: string;
    inputTokens: number;
    outputTokens: number;
    scope: string;
  }): Promise<void> {
    const cost = calculateCost(args.model, args.inputTokens, args.outputTokens, this.pricing);
    const event: SpendEvent = {
      model: args.model,
      inputTokens: args.inputTokens,
      outputTokens: args.outputTokens,
      costUsd: cost,
      scope: args.scope,
      timestamp: Date.now(),
    };
    await this.withScopeLock(args.scope, async () => {
      await this.storage.record(event);
      try {
        this.onSpend?.(event);
      } catch (err) {
        // Don't let a faulty onSpend callback propagate and corrupt the call result.
        console.error("[llm-hard-cap] onSpend callback threw:", err);
      }
    });
  }
}

export class ScopedGuard {
  constructor(
    private readonly parent: BudgetGuard,
    private readonly scope: string,
    private readonly limits?: BudgetLimits,
  ) {}

  check(args: Omit<CheckArgs, "scope">) {
    return this.parent.check({ ...args, scope: this.scope, limits: { ...this.limits, ...args.limits } });
  }
  estimate(args: Omit<EstimateArgs, "scope">) {
    return this.parent.estimate({
      ...args,
      scope: this.scope,
      limits: { ...this.limits, ...args.limits },
    });
  }
  wrap<T>(
    args: Omit<EstimateArgs, "scope">,
    call: () => Promise<T>,
    extract?: (result: T) => { inputTokens: number; outputTokens: number },
  ) {
    return this.parent.wrap(
      { ...args, scope: this.scope, limits: { ...this.limits, ...args.limits } },
      call,
      extract,
    );
  }
  usage() {
    return this.parent.usage(this.scope);
  }
  reset() {
    return this.parent.reset(this.scope);
  }
}

function defaultExtract(result: unknown): { inputTokens: number; outputTokens: number } | null {
  if (!result || typeof result !== "object") return null;
  const usage = (result as { usage?: Record<string, number> }).usage;
  if (!usage) return null;
  // OpenAI / Mistral / Groq style
  if (typeof usage.prompt_tokens === "number" && typeof usage.completion_tokens === "number") {
    return { inputTokens: usage.prompt_tokens, outputTokens: usage.completion_tokens };
  }
  // Anthropic style
  if (typeof usage.input_tokens === "number" && typeof usage.output_tokens === "number") {
    return { inputTokens: usage.input_tokens, outputTokens: usage.output_tokens };
  }
  return null;
}

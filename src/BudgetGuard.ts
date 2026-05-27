import { BudgetExceededError, pickViolation } from "./errors.js";
import { calculateCost } from "./pricing.js";
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
  private readonly onSpend: ((event: SpendEvent) => void) | undefined;

  constructor(options: BudgetGuardOptions) {
    this.defaultLimits = options.limits;
    this.onExceeded = options.onExceeded ?? "throw";
    this.storage = options.storage ?? new MemoryStorage();
    this.pricing = options.pricing;
    this.onSpend = options.onSpend;
  }

  /**
   * Check that a known-cost call is within budget, then record it.
   * Use this AFTER an LLM call returns and you have real token counts.
   */
  async check(args: CheckArgs): Promise<{ costUsd: number; summary: UsageSummary }> {
    const scope = args.scope ?? DEFAULT_SCOPE;
    const inputTokens = args.inputTokens;
    const outputTokens = args.outputTokens ?? 0;
    const cost = calculateCost(args.model, inputTokens, outputTokens, this.pricing);
    const limits = { ...this.defaultLimits, ...(args.limits ?? {}) };

    const before = await this.storage.summary(scope);
    const violation = pickViolation(before, cost, limits);
    if (violation) {
      this.handleViolation(violation, scope);
      // If we got here with "warn" or "block", do not record.
      if (this.onExceeded !== "throw") {
        return { costUsd: cost, summary: before };
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
    return { costUsd: cost, summary: after };
  }

  /**
   * Check that an *estimated* call would fit in the remaining budget.
   * Use this BEFORE making the LLM call. Nothing is recorded.
   * Returns the projected cost if allowed; throws (or returns)
   * a BudgetExceededError per `onExceeded` policy.
   */
  async estimate(args: EstimateArgs): Promise<{ projectedUsd: number; summary: UsageSummary }> {
    const scope = args.scope ?? DEFAULT_SCOPE;
    const cost = calculateCost(
      args.model,
      args.estimatedInputTokens,
      args.estimatedOutputTokens ?? 0,
      this.pricing,
    );
    const limits = { ...this.defaultLimits, ...(args.limits ?? {}) };
    const summary = await this.storage.summary(scope);
    const violation = pickViolation(summary, cost, limits);
    if (violation) this.handleViolation(violation, scope);
    return { projectedUsd: cost, summary };
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
    await this.estimate(args);
    const result = await call();
    const usage = extract ? extract(result) : defaultExtract(result);
    if (usage) {
      await this.check({
        model: args.model,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        scope: args.scope,
        limits: args.limits,
      });
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

  private handleViolation(
    v: { window: "perRequest" | "day" | "month" | "total"; limit: number; current: number; projected: number },
    scope: string,
  ): void {
    const err = new BudgetExceededError({
      window: v.window,
      limitUsd: v.limit,
      currentUsd: v.current,
      projectedUsd: v.projected,
      scope,
    });
    if (this.onExceeded === "throw" || this.onExceeded === "block") {
      if (this.onExceeded === "throw") throw err;
      // "block" returns silently without recording; caller checks via estimate result
      // Surface via console for visibility.
      console.warn(`[llm-hard-cap] ${err.message}`);
      return;
    }
    // "warn"
    console.warn(`[llm-hard-cap] ${err.message}`);
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

export interface ModelPricing {
  /** USD per 1M input tokens */
  input: number;
  /** USD per 1M output tokens */
  output: number;
}

export interface BudgetLimits {
  /** Hard cap in USD for a single request. */
  perRequest?: number;
  /** Hard cap in USD per calendar day (UTC). */
  daily?: number;
  /** Hard cap in USD per calendar month (UTC). */
  monthly?: number;
  /** Hard cap in USD for the lifetime of this scope. */
  total?: number;
}

export type OnExceeded = "throw" | "block" | "warn";

export interface BudgetGuardOptions {
  /** Spend limits. At least one limit should be set. */
  limits: BudgetLimits;
  /** What to do when a limit would be exceeded. Default: "throw". */
  onExceeded?: OnExceeded;
  /** Storage adapter. Default: in-memory. */
  storage?: Storage;
  /** Override or extend the built-in pricing table. */
  pricing?: Record<string, ModelPricing>;
  /**
   * What to do when a model has no known pricing. `"throw"` (default)
   * fails safe so a typo can't silently disable the budget guard.
   * `"zero"` treats unknown models as free (legacy behavior).
   */
  onUnknownModel?: "throw" | "zero";
  /** Called whenever a request is recorded. */
  onSpend?: (event: SpendEvent) => void;
}

export interface SpendEvent {
  model: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  scope: string;
  timestamp: number;
}

export interface UsageQuery {
  /** Logical scope (e.g. user id, route name). Defaults to "global". */
  scope?: string;
  /** Restrict to a specific window. */
  window?: "day" | "month" | "total";
}

export interface UsageSummary {
  scope: string;
  day: number;
  month: number;
  total: number;
  requests: number;
}

export interface CheckArgs {
  model: string;
  inputTokens: number;
  outputTokens?: number;
  /** Logical scope (e.g. user id). Defaults to "global". */
  scope?: string;
  /** Override limits for this specific call. */
  limits?: BudgetLimits;
}

export interface EstimateArgs {
  model: string;
  /** Worst-case estimate before the call is made. */
  estimatedInputTokens: number;
  estimatedOutputTokens?: number;
  scope?: string;
  limits?: BudgetLimits;
}

export interface Storage {
  record(event: SpendEvent): Promise<void> | void;
  summary(scope: string): Promise<UsageSummary> | UsageSummary;
  reset(scope?: string): Promise<void> | void;
}

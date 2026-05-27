import type { BudgetLimits, UsageSummary } from "./types.js";

export class BudgetExceededError extends Error {
  readonly code = "BUDGET_EXCEEDED";
  readonly window: "perRequest" | "day" | "month" | "total";
  readonly limitUsd: number;
  readonly currentUsd: number;
  readonly projectedUsd: number;
  readonly scope: string;

  constructor(args: {
    window: "perRequest" | "day" | "month" | "total";
    limitUsd: number;
    currentUsd: number;
    projectedUsd: number;
    scope: string;
  }) {
    const overBy = (args.projectedUsd - args.limitUsd).toFixed(4);
    super(
      `Budget exceeded for ${args.scope} (${args.window}): ` +
        `$${args.projectedUsd.toFixed(4)} would exceed $${args.limitUsd.toFixed(4)} limit ` +
        `(over by $${overBy}).`,
    );
    this.name = "BudgetExceededError";
    this.window = args.window;
    this.limitUsd = args.limitUsd;
    this.currentUsd = args.currentUsd;
    this.projectedUsd = args.projectedUsd;
    this.scope = args.scope;
  }
}

export function pickViolation(
  summary: UsageSummary,
  addCost: number,
  limits: BudgetLimits,
):
  | { window: "perRequest" | "day" | "month" | "total"; limit: number; current: number; projected: number }
  | null {
  if (limits.perRequest !== undefined && addCost > limits.perRequest) {
    return { window: "perRequest", limit: limits.perRequest, current: 0, projected: addCost };
  }
  if (limits.daily !== undefined && summary.day + addCost > limits.daily) {
    return { window: "day", limit: limits.daily, current: summary.day, projected: summary.day + addCost };
  }
  if (limits.monthly !== undefined && summary.month + addCost > limits.monthly) {
    return {
      window: "month",
      limit: limits.monthly,
      current: summary.month,
      projected: summary.month + addCost,
    };
  }
  if (limits.total !== undefined && summary.total + addCost > limits.total) {
    return {
      window: "total",
      limit: limits.total,
      current: summary.total,
      projected: summary.total + addCost,
    };
  }
  return null;
}

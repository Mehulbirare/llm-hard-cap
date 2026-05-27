import type { ModelPricing } from "./types.js";

/**
 * Built-in pricing table. Prices are USD per 1M tokens, taken from
 * public provider pricing pages. Prices change; override via
 * `BudgetGuard({ pricing: { 'my-model': { input: 1, output: 2 } } })`.
 */
export const DEFAULT_PRICING: Record<string, ModelPricing> = {
  // OpenAI
  "gpt-4o": { input: 2.5, output: 10 },
  "gpt-4o-2024-08-06": { input: 2.5, output: 10 },
  "gpt-4o-mini": { input: 0.15, output: 0.6 },
  "gpt-4-turbo": { input: 10, output: 30 },
  "gpt-4": { input: 30, output: 60 },
  "gpt-3.5-turbo": { input: 0.5, output: 1.5 },
  "o1": { input: 15, output: 60 },
  "o1-mini": { input: 3, output: 12 },
  "o3-mini": { input: 1.1, output: 4.4 },

  // Anthropic
  "claude-opus-4-7": { input: 15, output: 75 },
  "claude-opus-4-6": { input: 15, output: 75 },
  "claude-opus-4": { input: 15, output: 75 },
  "claude-sonnet-4-6": { input: 3, output: 15 },
  "claude-sonnet-4": { input: 3, output: 15 },
  "claude-haiku-4-5": { input: 0.8, output: 4 },
  "claude-3-5-sonnet-20241022": { input: 3, output: 15 },
  "claude-3-5-haiku-20241022": { input: 0.8, output: 4 },
  "claude-3-opus-20240229": { input: 15, output: 75 },

  // Google Gemini
  "gemini-1.5-pro": { input: 1.25, output: 5 },
  "gemini-1.5-flash": { input: 0.075, output: 0.3 },
  "gemini-2.0-flash": { input: 0.1, output: 0.4 },
  "gemini-2.5-pro": { input: 1.25, output: 10 },

  // Mistral
  "mistral-large-latest": { input: 2, output: 6 },
  "mistral-small-latest": { input: 0.2, output: 0.6 },

  // DeepSeek
  "deepseek-chat": { input: 0.27, output: 1.1 },
  "deepseek-reasoner": { input: 0.55, output: 2.19 },
};

/**
 * Look up pricing for a model name. Falls back to a prefix match so
 * e.g. "gpt-4o-2024-11-20" matches "gpt-4o".
 */
export function getPricing(
  model: string,
  overrides?: Record<string, ModelPricing>,
): ModelPricing | undefined {
  if (overrides && overrides[model]) return overrides[model];
  if (DEFAULT_PRICING[model]) return DEFAULT_PRICING[model];

  const combined = { ...DEFAULT_PRICING, ...(overrides ?? {}) };
  const keys = Object.keys(combined).sort((a, b) => b.length - a.length);
  for (const key of keys) {
    if (model.startsWith(key)) return combined[key];
  }
  return undefined;
}

/**
 * Calculate cost in USD given token counts.
 * Returns 0 if the model is unknown — combine with `hasPricing()`
 * if you want to refuse unknown models.
 */
export function calculateCost(
  model: string,
  inputTokens: number,
  outputTokens: number,
  overrides?: Record<string, ModelPricing>,
): number {
  const pricing = getPricing(model, overrides);
  if (!pricing) return 0;
  return (inputTokens / 1_000_000) * pricing.input + (outputTokens / 1_000_000) * pricing.output;
}

export function hasPricing(model: string, overrides?: Record<string, ModelPricing>): boolean {
  return getPricing(model, overrides) !== undefined;
}

/** Tokens of one provider attempt, split the way they are priced. */
export type AiTokenUsage = {
  /** Input tokens read neither from nor into the prompt cache. */
  inputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  outputTokens: number;
};

type ModelPrice = {
  /** Nano-USD per token for a prompt up to `longPromptTokens`. */
  nanoUsdPerToken: { input: number; cacheRead: number; cacheWrite: number; output: number };
  /** A longer prompt is priced at `longPromptFactor` times every rate. */
  longPromptTokens: number;
  longPromptFactor: number;
};

/**
 * Anthropic's first-party list price of Claude Haiku 5.5: $0.10 input and
 * $0.50 output per million tokens up to a 100K-token prompt, five times that
 * above; cache reads 0.1x and five-minute cache writes 1.25x the input rate.
 * Change it with the model id (`lib/ai/model.ts`).
 */
export const AI_MODEL_PRICE: ModelPrice = {
  nanoUsdPerToken: { input: 100, cacheRead: 10, cacheWrite: 125, output: 500 },
  longPromptTokens: 100_000,
  longPromptFactor: 5,
};

/** The real cost of one attempt in whole micro-USD, rounded up, so the ledger never undercounts. */
export function costMicroUsd(usage: AiTokenUsage, price: ModelPrice): number {
  const rate = price.nanoUsdPerToken;
  const promptTokens = usage.inputTokens + usage.cacheReadTokens + usage.cacheWriteTokens;
  const factor = promptTokens > price.longPromptTokens ? price.longPromptFactor : 1;
  const nanoUsd =
    factor *
    (usage.inputTokens * rate.input +
      usage.cacheReadTokens * rate.cacheRead +
      usage.cacheWriteTokens * rate.cacheWrite +
      usage.outputTokens * rate.output);
  return Math.ceil(nanoUsd / 1000);
}

/** The usage of one finished step as the AI SDK reports it. */
type StreamUsage = {
  inputTokens: number | undefined;
  inputTokenDetails: {
    noCacheTokens: number | undefined;
    cacheReadTokens: number | undefined;
    cacheWriteTokens: number | undefined;
  };
  outputTokens: number | undefined;
};

/** A step's reported usage split the way it is priced, or null when the provider reported none. */
export function reportedUsage(usage: StreamUsage): AiTokenUsage | null {
  if (usage.inputTokens === undefined || usage.outputTokens === undefined) return null;
  const cacheReadTokens = usage.inputTokenDetails.cacheReadTokens ?? 0;
  const cacheWriteTokens = usage.inputTokenDetails.cacheWriteTokens ?? 0;
  const inputTokens =
    usage.inputTokenDetails.noCacheTokens ??
    Math.max(0, usage.inputTokens - cacheReadTokens - cacheWriteTokens);
  return { inputTokens, cacheReadTokens, cacheWriteTokens, outputTokens: usage.outputTokens };
}

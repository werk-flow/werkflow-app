import { AI_MODEL_PRICE, type AiTokenUsage, costMicroUsd } from '@/lib/ai/cost';

/**
 * The hard caps of one WerkFlow KI turn (werk-flow/werkflow-planning#528, B13).
 * Each entry point names its own; the chat page is the first. A turn that
 * reaches a cap stops and says so, never runs on.
 */
export const AI_TURN_LIMITS = {
  chat: {
    /** Model steps per turn. A step that ends in tool calls starts the next one. */
    maxSteps: 8,
    /** Output tokens per step, thinking included. */
    maxOutputTokens: 4096,
    /** Thinking effort, sent explicitly (Claude Haiku 5.5 defaults to `medium`). */
    effort: 'low',
    /** Input tokens per step at their upper bound, well under the 100K prompt price boundary. */
    maxInputTokens: 60_000,
    /** Provider retries per turn, shared by its steps. A spend-limit error is never retried. */
    maxRetries: 2,
    /** The whole turn, all steps and retries included. */
    totalTimeoutMs: 120_000,
    /** One step, from the request to its last chunk. */
    stepTimeoutMs: 60_000,
    /** Silence between two chunks of a streaming answer. */
    chunkTimeoutMs: 20_000,
    /** Characters of one user message. */
    maxMessageCharacters: 8_000,
    /** Bytes of the saved answer's JSON, under the item body cap of 64 KiB. */
    maxAnswerBytes: 48_000,
  },
} as const;

export type AiEntryPoint = keyof typeof AI_TURN_LIMITS;

/**
 * The most a turn can cost: every step and every retry at its input cap,
 * all of it written to the prompt cache (the dearest input), plus its output
 * cap. The run reserves this before its first step, so the hold covers each
 * charge.
 */
export function maxTurnCostMicroUsd(entryPoint: AiEntryPoint): number {
  const limits = AI_TURN_LIMITS[entryPoint];
  const attempt: AiTokenUsage = {
    inputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: limits.maxInputTokens,
    outputTokens: limits.maxOutputTokens,
  };
  return (limits.maxSteps + limits.maxRetries) * costMicroUsd(attempt, AI_MODEL_PRICE);
}

/**
 * An upper bound of a prompt's input tokens: one token per UTF-8 byte. A
 * byte-level tokenizer never makes a token of less than one byte, and the
 * serialized prompt's JSON framing outweighs the tokens the API adds per
 * message. The caps and the reservation hold against this bound.
 */
export function inputTokenCeiling(serializedPrompt: string): number {
  return Buffer.byteLength(serializedPrompt, 'utf8');
}

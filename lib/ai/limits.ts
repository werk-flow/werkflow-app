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
    /**
     * One attempt's cost write, both tries. Past it the turn ends, and the
     * run's reservation stays as its provisional charge.
     */
    costWriteTimeoutMs: 5_000,
    /** One save of the answer: a partial save, or the final save with its tries. */
    answerSaveTimeoutMs: 8_000,
    /** The run's settlement. Past it the reservation stays as the run's provisional charge. */
    settleTimeoutMs: 5_000,
    /** One send on the thread's live channel; a missed one costs only freshness. */
    liveSendTimeoutMs: 1_500,
    /** Model calls the tools of one turn make together: the quarantined extractor's (`AI_EXTRACT_LIMITS`). */
    maxToolModelCalls: 2,
    /**
     * Bytes of all tool results of one turn together, as the model reads them. A call past it
     * gets a short refusal the model can read, so the results never outgrow the next step's input cap.
     */
    maxToolResultBytes: 32_000,
    /**
     * Bytes the thread leaves free besides the tool results: the steps' own tool
     * calls and the short refusals past the result cap. The thread drops its
     * oldest messages until both fit; the input cap still ends a turn past it.
     */
    toolFramingBytes: 4_000,
  },
} as const;

/**
 * The caps of one call of the quarantined extractor (lib/ai/extract/, B9 and B13):
 * a model call with no tools that reads one uploaded document into capped fields.
 */
export const AI_EXTRACT_LIMITS = {
  /**
   * Input tokens of one call: the document as the provider counts it before the
   * call, plus the instructions and the answer's schema at one token per byte.
   * About fifteen PDF pages; a stored page count is never trusted.
   */
  maxInputTokens: 40_000,
  /** Output tokens, thinking included. */
  maxOutputTokens: 8_192,
  effort: 'low',
  stepTimeoutMs: 60_000,
  chunkTimeoutMs: 20_000,
  /** Lines of one Lieferschein the extractor keeps; a longer one is marked as cut, never cut silently. */
  maxLines: 50,
} as const;

export type AiEntryPoint = keyof typeof AI_TURN_LIMITS;

/**
 * The most a turn can cost: every step and every retry at its input cap,
 * all of it written to the prompt cache (the dearest input), plus its output
 * cap, and every model call its tools may make at the extractor's caps. The
 * run reserves this before its first step, so the hold covers each charge.
 */
export function maxTurnCostMicroUsd(entryPoint: AiEntryPoint): number {
  const limits = AI_TURN_LIMITS[entryPoint];
  const attempt: AiTokenUsage = {
    inputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: limits.maxInputTokens,
    outputTokens: limits.maxOutputTokens,
  };
  const steps = (limits.maxSteps + limits.maxRetries) * costMicroUsd(attempt, AI_MODEL_PRICE);
  return steps + limits.maxToolModelCalls * maxExtractionCostMicroUsd();
}

/** The most one extraction can cost: its input and output caps, uncached. */
function maxExtractionCostMicroUsd(): number {
  return costMicroUsd(
    {
      inputTokens: AI_EXTRACT_LIMITS.maxInputTokens,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      outputTokens: AI_EXTRACT_LIMITS.maxOutputTokens,
    },
    AI_MODEL_PRICE,
  );
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

/**
 * The caps of files a person adds to a message (werk-flow/werkflow-planning#534, B13).
 * The ticket and the finalize check each file; the attach checks each message.
 */
export const AI_UPLOAD_LIMITS = {
  /** PDF and the photo types phones send; iOS Safari converts HEIC to JPEG for this list. */
  mimeTypes: ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'],
  maxFileBytes: 10 * 1024 * 1024,
  /** Pages of one PDF, counted on the stored copy. */
  maxPdfPages: 20,
  maxFilesPerMessage: 5,
  maxMessageBytes: 25 * 1024 * 1024,
  /** Uploads a person keeps that no message attached yet; a daily job deletes them after a day. */
  maxUnsentFiles: 10,
} as const;

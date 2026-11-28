import 'server-only';

import { Output, asSchema, streamText } from 'ai';

import { acceptedByProvider, classifyAttemptFailure } from '@/lib/ai/attempt-failure';
import type { AiTokenUsage } from '@/lib/ai/cost';
import { AI_EXTRACT_LIMITS, inputTokenCeiling } from '@/lib/ai/limits';
import {
  type AiDocument,
  type AiModel,
  isAllowedModel,
  resolveAiModel,
  resolveAiTokenCounter,
} from '@/lib/ai/model';
import type { AiModelCallRecord, AiToolRun } from '@/lib/ai/tools/define-tool';
import type { z } from '@/lib/zod';

// The quarantined extractor (B9 of werk-flow/werkflow-planning#20): a model
// call of its own that reads one uploaded document into a fixed schema. It has
// no tools, no conversation and no other document, so text hidden in the
// document can steer nothing but the fields it returns, and the chat agent
// reads only those fields once a capped schema validated them.
// lib/ai/extract/no-tools.test.ts refuses a tool key in this folder, and the
// replay suite proves the provider request carries none.

/** What one extraction asks: the fixed instructions, request and answer schema of one document kind. */
export type ExtractionSpec = {
  instructions: string;
  request: string;
  /** The answer's shape as the provider enforces it; the caller validates the capped fields itself. */
  schema: z.ZodType;
  /** Recorded with the call's ledger row, like the chat's prompt version (B18). */
  promptVersion: string;
};

export type ExtractionResult =
  | { status: 'read'; answer: unknown }
  /**
   * Past the extractor's input cap, or a document the provider will not read:
   * no paid call was made. Also an answer cut at the output cap, which was paid.
   */
  | { status: 'too_long' | 'unreadable' }
  /** The turn's tools made all the model calls it allows. */
  | { status: 'over_cap' }
  /** The turn stopped, lost its author or ran out of time. */
  | { status: 'stopped' }
  | { status: 'failed' };

type StreamUsage = {
  inputTokens: number | undefined;
  inputTokenDetails: { cacheReadTokens: number | undefined; cacheWriteTokens: number | undefined };
  outputTokens: number | undefined;
};

function reportedUsage(usage: StreamUsage): AiTokenUsage | null {
  if (usage.inputTokens === undefined || usage.outputTokens === undefined) return null;
  const cacheReadTokens = usage.inputTokenDetails.cacheReadTokens ?? 0;
  const cacheWriteTokens = usage.inputTokenDetails.cacheWriteTokens ?? 0;
  return {
    inputTokens: Math.max(0, usage.inputTokens - cacheReadTokens - cacheWriteTokens),
    cacheReadTokens,
    cacheWriteTokens,
    outputTokens: usage.outputTokens,
  };
}

/**
 * Anthropic adds a system prompt for a structured output's schema, which its
 * token count of the document does not hold; this covers it with room to spare.
 */
const STRUCTURED_OUTPUT_HEADROOM_TOKENS = 2_000;

type Streamed = {
  text: string;
  usage: AiTokenUsage | null;
  started: boolean;
  error: unknown;
  /** The answer reached the output cap and is cut. */
  cut: boolean;
};

/** The extractor's one call, streamed: its text, the usage the provider reported, whether it began. */
async function streamExtraction(
  model: AiModel,
  spec: ExtractionSpec,
  document: AiDocument,
  run: Pick<AiToolRun, 'signal' | 'progress'>,
): Promise<Streamed> {
  const result = streamText({
    model,
    instructions: spec.instructions,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'file', data: document.bytes, mediaType: document.mimeType },
          { type: 'text', text: spec.request },
        ],
      },
    ],
    output: Output.object({ schema: spec.schema }),
    maxOutputTokens: AI_EXTRACT_LIMITS.maxOutputTokens,
    maxRetries: 0,
    abortSignal: run.signal,
    timeout: { stepMs: AI_EXTRACT_LIMITS.stepTimeoutMs, chunkMs: AI_EXTRACT_LIMITS.chunkTimeoutMs },
    providerOptions: {
      anthropic: {
        thinking: { type: 'adaptive' },
        effort: AI_EXTRACT_LIMITS.effort,
        // The provider's own structured output, never a tool that carries the answer.
        structuredOutputMode: 'outputFormat',
      },
    },
    telemetry: { isEnabled: false, recordInputs: false, recordOutputs: false },
    onError: () => undefined,
  });
  const streamed: Streamed = { text: '', usage: null, started: false, error: null, cut: false };
  try {
    for await (const part of result.fullStream) {
      // Every part, thinking included, lets the turn save, so a stop aborts the call in time.
      run.progress();
      if (part.type === 'text-delta') {
        streamed.started = true;
        streamed.text += part.text;
      } else if (part.type === 'start-step') streamed.started = true;
      else if (part.type === 'finish-step') {
        streamed.usage = reportedUsage(part.usage);
        streamed.cut = part.finishReason === 'length';
      } else if (part.type === 'error') streamed.error = part.error ?? 'error';
      else if (part.type === 'abort') streamed.error = new DOMException('aborted', 'AbortError');
      if (streamed.error !== null) break;
    }
  } catch (thrown) {
    streamed.error = thrown ?? 'error';
  }
  return streamed;
}

/**
 * Runs the call and ledgers it before anything else: at the usage the
 * provider reported, or at the caps the run reserved when it may have taken
 * the call without reporting (B15). Only then does its answer count.
 */
async function ledgeredExtraction(
  model: AiModel,
  spec: ExtractionSpec,
  document: AiDocument,
  run: Pick<AiToolRun, 'signal' | 'progress'>,
  record: AiModelCallRecord,
): Promise<ExtractionResult> {
  const { text, usage, started, error, cut } = await streamExtraction(model, spec, document, run);
  const billed = error === null || started || acceptedByProvider(error);
  const charged = usage ?? {
    inputTokens: billed ? AI_EXTRACT_LIMITS.maxInputTokens : 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    outputTokens: billed ? AI_EXTRACT_LIMITS.maxOutputTokens : 0,
  };
  const stopped = run.signal.aborted;
  const outcome = stopped
    ? 'extract_stopped'
    : error === null
      ? 'extract_completed'
      : `extract_${classifyAttemptFailure(error).outcome}`;
  if (!(await record(charged, outcome, spec.promptVersion))) return { status: 'failed' };
  if (stopped) return { status: 'stopped' };
  if (error !== null) return { status: 'failed' };
  if (cut) return { status: 'too_long' };
  try {
    const answer: unknown = JSON.parse(text);
    return { status: 'read', answer };
  } catch {
    return { status: 'unreadable' };
  }
}

/**
 * Reads one document. The provider counts its tokens first, for free, so a
 * document past the input cap never reaches a paid call, whatever page count
 * it declares. The call runs under the turn's abort signal, within the turn's
 * model-call cap, and is ledgered before the turn may settle.
 */
export async function runExtraction(
  spec: ExtractionSpec,
  document: AiDocument,
  run: Pick<AiToolRun, 'signal' | 'progress' | 'modelCall'>,
): Promise<ExtractionResult> {
  const model = resolveAiModel();
  const countTokens = resolveAiTokenCounter();
  if (model === 'unavailable' || countTokens === 'unavailable' || !isAllowedModel(model)) {
    return { status: 'failed' };
  }
  const counted = await countTokens({ document, system: spec.instructions, text: spec.request }, run.signal);
  if (run.signal.aborted) return { status: 'stopped' };
  if (counted === 'failed') return { status: 'failed' };
  if (counted === 'refused') return { status: 'unreadable' };
  // The schema at one token per byte, and the provider's prompt for it.
  const schema = JSON.stringify(await asSchema(spec.schema).jsonSchema);
  const inputTokens = counted + inputTokenCeiling(schema) + STRUCTURED_OUTPUT_HEADROOM_TOKENS;
  if (inputTokens > AI_EXTRACT_LIMITS.maxInputTokens) return { status: 'too_long' };
  const called = await run.modelCall((record) => ledgeredExtraction(model, spec, document, run, record));
  if (called === 'over_cap' || called === 'stopped') return { status: called };
  return called;
}

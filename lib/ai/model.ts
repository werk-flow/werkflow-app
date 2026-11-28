import 'server-only';

import { createAnthropic } from '@ai-sdk/anthropic';
import type { LanguageModel } from 'ai';

import { AI_REPLAY_PROVIDER, countReplayDocumentTokens, createReplayModel } from '@/lib/ai/replay';
import { logError } from '@/lib/logging';
import { z } from '@/lib/zod';

/** The one model WerkFlow KI runs on (decision 30): the newest Claude Haiku, no picker. */
const AI_MODEL_ID = 'claude-haiku-5-5';

/**
 * The Vercel environment variable that holds the Anthropic key (O1 on
 * werk-flow/werkflow-planning#20). Its own name, not `ANTHROPIC_API_KEY`, so a
 * developer tool's key on an agent machine never reaches the product.
 */
const AI_MODEL_KEY_VARIABLE = 'WERKFLOW_KI_ANTHROPIC_KEY';

/** Fixed, so `ANTHROPIC_BASE_URL` cannot route the model anywhere else. */
const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1';

export type AiModel = Extract<LanguageModel, { specificationVersion: 'v4' }>;

/**
 * Every route a model call may take (B1). Anthropic's first-party API on the
 * one model, and the replay provider off Vercel: tests and local runs replay
 * recorded synthetic streams and never call a model.
 */
export function isAllowedModel(model: Pick<AiModel, 'provider' | 'modelId'>): boolean {
  if (model.modelId !== AI_MODEL_ID) return false;
  if (model.provider === 'anthropic.messages') return true;
  return model.provider === AI_REPLAY_PROVIDER && !process.env.VERCEL;
}

// The SDK writes provider warnings to the console; only their kind may reach the log (B17).
globalThis.AI_SDK_LOG_WARNINGS = (options) => {
  for (const warning of options.warnings) logError('aiModel: provider warning', warning.type);
};

/**
 * The model of one turn. With the key it is Anthropic; without it, a Vercel
 * deployment has no model, and every other machine replays.
 */
export function resolveAiModel(): AiModel | 'unavailable' {
  const apiKey = process.env[AI_MODEL_KEY_VARIABLE];
  if (apiKey) return createAnthropic({ apiKey, baseURL: ANTHROPIC_API_URL })(AI_MODEL_ID);
  if (process.env.VERCEL) return 'unavailable';
  return createReplayModel(AI_MODEL_ID);
}

/** One uploaded document as a model reads it: its bytes and one of the upload's types. */
export type AiDocument = {
  bytes: Uint8Array;
  mimeType: 'application/pdf' | 'image/jpeg' | 'image/png' | 'image/webp';
};

/**
 * The input tokens of one document as the model reads it, counted before any
 * paid call. `refused` when the provider will not read it (past its own page
 * limit, or unreadable); `failed` when the count could not be made.
 */
export type AiDocumentTokenCount = number | 'refused' | 'failed';

const tokenCountSchema = z.object({ input_tokens: z.number().int().nonnegative() });

/** Anthropic's token count of one document: free, and the bound the extractor holds before it pays (B13). */
async function countAnthropicTokens(
  apiKey: string,
  document: AiDocument,
  signal: AbortSignal,
): Promise<AiDocumentTokenCount> {
  const source = {
    type: 'base64',
    media_type: document.mimeType,
    data: Buffer.from(document.bytes).toString('base64'),
  };
  const block =
    document.mimeType === 'application/pdf' ? { type: 'document', source } : { type: 'image', source };
  try {
    const response = await fetch(`${ANTHROPIC_API_URL}/messages/count_tokens`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: AI_MODEL_ID, messages: [{ role: 'user', content: [block] }] }),
      signal,
    });
    // A request the provider refuses names a document it will not read; its body never reaches a log (B17).
    if (response.status === 400 || response.status === 413) return 'refused';
    if (!response.ok) {
      logError('aiModel: token count failed', `status_${response.status}`);
      return 'failed';
    }
    const counted = tokenCountSchema.safeParse(await response.json());
    return counted.success ? counted.data.input_tokens : 'failed';
  } catch (error) {
    logError('aiModel: token count failed', error instanceof Error ? error.name : 'unknown');
    return 'failed';
  }
}

/** The token counter beside the model: Anthropic's with the key, none on Vercel without it, the replay's elsewhere. */
export function resolveAiTokenCounter():
  | ((document: AiDocument, signal: AbortSignal) => Promise<AiDocumentTokenCount>)
  | 'unavailable' {
  const apiKey = process.env[AI_MODEL_KEY_VARIABLE];
  if (apiKey) return (document, signal) => countAnthropicTokens(apiKey, document, signal);
  if (process.env.VERCEL) return 'unavailable';
  return async (document) => countReplayDocumentTokens(document);
}

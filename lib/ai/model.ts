import 'server-only';

import { createAnthropic } from '@ai-sdk/anthropic';
import type { LanguageModel } from 'ai';

import { AI_REPLAY_PROVIDER, createReplayModel } from '@/lib/ai/replay';
import { logError } from '@/lib/logging';

/** The one model WerkFlow KI runs on (decision 30): the newest Claude Haiku, no picker. */
export const AI_MODEL_ID = 'claude-haiku-5-5';

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

import { afterEach, expect, test } from 'bun:test';

const { isAllowedModel, resolveAiModel } = await import('./model');

// The one model of decision 30.
const AI_MODEL_ID = 'claude-haiku-5-5';

const KEY = 'WERKFLOW_KI_ANTHROPIC_KEY';
const saved = { key: process.env[KEY], vercel: process.env.VERCEL };

afterEach(() => {
  for (const [name, value] of [
    [KEY, saved.key],
    ['VERCEL', saved.vercel],
  ] as const) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

test('only the one Claude Haiku model on Anthropic, or the replay off Vercel, is an allowed route', () => {
  expect(isAllowedModel({ provider: 'anthropic.messages', modelId: AI_MODEL_ID })).toBe(true);
  expect(isAllowedModel({ provider: 'anthropic.messages', modelId: 'claude-opus-5-5' })).toBe(false);
  expect(isAllowedModel({ provider: 'gateway', modelId: AI_MODEL_ID })).toBe(false);
  expect(isAllowedModel({ provider: 'openai.chat', modelId: AI_MODEL_ID })).toBe(false);
  expect(isAllowedModel({ provider: 'werkflow.replay', modelId: AI_MODEL_ID })).toBe(true);
  process.env.VERCEL = '1';
  expect(isAllowedModel({ provider: 'werkflow.replay', modelId: AI_MODEL_ID })).toBe(false);
});

test('without the key a machine replays, and a Vercel deployment has no model', () => {
  delete process.env[KEY];
  const local = resolveAiModel();
  expect(local === 'unavailable' ? null : local.provider).toBe('werkflow.replay');
  process.env.VERCEL = '1';
  expect(resolveAiModel()).toBe('unavailable');
});

test('with the key the model is Anthropic first-party, whatever ANTHROPIC_BASE_URL says', () => {
  process.env[KEY] = 'fixture-not-a-key';
  const model = resolveAiModel();
  expect(model === 'unavailable' ? null : [model.provider, model.modelId]).toEqual([
    'anthropic.messages',
    AI_MODEL_ID,
  ]);
});

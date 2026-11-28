import { afterEach, expect, test } from 'bun:test';

const { isAllowedModel, resolveAiModel, resolveAiTokenCounter } = await import('./model');

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

test('with the key the extractor’s token count sends Anthropic the whole request it will bill, and reads only the count', async () => {
  process.env[KEY] = 'fixture-not-a-key';
  const sent: Array<{ url: string; init: RequestInit | undefined }> = [];
  const original = globalThis.fetch;
  globalThis.fetch = Object.assign(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      sent.push({ url: String(input), init });
      return Response.json({ input_tokens: 1234 });
    },
    { preconnect: original.preconnect },
  );
  try {
    const count = resolveAiTokenCounter();
    if (count === 'unavailable') throw new Error('a machine with the key counts');
    const schema = { type: 'object', properties: { lieferant: { type: ['string', 'null'] } } };
    const counted = await count(
      {
        document: { bytes: new Uint8Array([0x25, 0x50, 0x44, 0x46]), mimeType: 'application/pdf' },
        system: 'Anweisungen',
        text: 'Lies das.',
        schema,
      },
      new AbortController().signal,
    );
    expect(counted).toBe(1234);
    expect(sent.map((request) => request.url)).toEqual([
      'https://api.anthropic.com/v1/messages/count_tokens',
    ]);
    expect(JSON.parse(String(sent[0]?.init?.body))).toEqual({
      model: AI_MODEL_ID,
      system: 'Anweisungen',
      messages: [
        {
          role: 'user',
          content: [
            { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: 'JVBERg==' } },
            { type: 'text', text: 'Lies das.' },
          ],
        },
      ],
      output_config: { format: { type: 'json_schema', schema } },
    });
  } finally {
    globalThis.fetch = original;
  }
});

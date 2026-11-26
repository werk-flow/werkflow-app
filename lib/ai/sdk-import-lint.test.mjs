import { expect, test } from 'bun:test';
import { createProbeLinter } from '../../eslint-rules/probe-linter.mjs';

// Tier 2 probe for aiSdkPattern in eslint.config.mjs (B2): product code
// reaches a model only through lib/ai/, never through the AI SDK directly.
const eslint = createProbeLinter();

async function sdkMessages(source, filePath) {
  const [result] = await eslint.lintText(source, { filePath });
  return result.messages.filter(
    ({ ruleId, message }) => ruleId === 'no-restricted-imports' && /only in lib\/ai\//.test(message),
  );
}

test('an AI SDK import outside lib/ai/ is rejected', async () => {
  const probes = [
    ['components/ai-probe.tsx', "import { streamText } from 'ai';\nexport const p = streamText;"],
    [
      'app/api/ai-probe/route.ts',
      "import { createAnthropic } from '@ai-sdk/anthropic';\nexport const p = createAnthropic;",
    ],
    ['lib/jobs/ai-probe.ts', "import { gateway } from 'ai';\nexport const p = gateway;"],
    ['hooks/ai-probe.ts', "import { useChat } from '@ai-sdk/react';\nexport const p = useChat;"],
    [
      'lib/jobs/ai-probe.ts',
      "import { MockLanguageModelV4 } from 'ai/test';\nexport const p = MockLanguageModelV4;",
    ],
  ];
  for (const [filePath, source] of probes) {
    expect(await sdkMessages(source, filePath), `${filePath}: ${source}`).toHaveLength(1);
  }
});

test('lib/ai/ imports the SDK, and every other module imports lib/ai/', async () => {
  expect(
    await sdkMessages("import { streamText } from 'ai';\nexport const p = streamText;", 'lib/ai/probe.ts'),
  ).toEqual([]);
  expect(
    await sdkMessages(
      "import { startAiTurn } from '@/lib/ai/turn';\nexport const p = startAiTurn;",
      'app/api/ki/probe.ts',
    ),
  ).toEqual([]);
});

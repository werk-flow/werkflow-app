import { expect, test } from 'bun:test';
import { createProbeLinter } from '../../../eslint-rules/probe-linter.mjs';

// Tier 2 probe for aiToolHelperPath in eslint.config.mjs (B2): a WerkFlow KI tool is registered only
// through defineTool, the one module that may import the AI SDK's tool helpers.
const eslint = createProbeLinter();

async function registrationMessages(source, filePath) {
  const [result] = await eslint.lintText(source, { filePath });
  const unlinted = result.messages.filter(({ fatal, ruleId }) => fatal || ruleId === null);
  if (unlinted.length > 0) {
    throw new Error(`${filePath} was not linted: ${unlinted.map(({ message }) => message).join('; ')}`);
  }
  return result.messages.filter(
    ({ ruleId, message }) => ruleId === 'no-restricted-imports' && /defineTool/.test(message),
  );
}

test('a tool helper of the AI SDK outside defineTool is rejected', async () => {
  const probes = [
    ['lib/ai/tools/probe.ts', "import { tool } from 'ai';\nexport const p = tool;"],
    ['lib/ai/turn-probe.ts', "import { dynamicTool } from 'ai';\nexport const p = dynamicTool;"],
  ];
  for (const [filePath, source] of probes) {
    expect(await registrationMessages(source, filePath), `${filePath}: ${source}`).toHaveLength(1);
  }
});

test('defineTool imports the helper, and lib/ai/ keeps the rest of the SDK', async () => {
  expect(
    await registrationMessages(
      "import { tool } from 'ai';\nexport const p = tool;",
      'lib/ai/tools/define-tool.ts',
    ),
  ).toEqual([]);
  expect(
    await registrationMessages(
      "import { streamText } from 'ai';\nexport const p = streamText;",
      'lib/ai/turn-probe.ts',
    ),
  ).toEqual([]);
});

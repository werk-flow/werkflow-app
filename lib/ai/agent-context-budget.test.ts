// Rule test: the agent context budget (check 2 of werk-flow/werkflow-planning#20) holds the measured
// byte sizes of what every turn sends before the thread. Growth over the merge base with main fails
// the shrink-only gate unless the owner adds `approved: context growth` (docs/technical/testing.md).
import { expect, mock, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { buildAiContext } from '@/lib/ai/context';
import { AI_SYSTEM_PROMPT } from '@/lib/ai/prompt/system-prompt';
import { ROLE_LABELS, isOrgRole } from '@/lib/roles';
import { growthProblems, listEntries, SHRINK_ONLY_LISTS } from '@/lib/testing/publication/shrink-only-lists';

// The registry's readers are server-only; the stub lets the unit tier load them.
mock.module('server-only', () => ({}));
const { aiToolsFor } = await import('@/lib/ai/tools/registry');

const BUDGET_FILE = 'lib/ai/agent-context-budget.json';
const budgetText = readFileSync(resolve(import.meta.dir, '../..', BUDGET_FILE), 'utf8');

async function measuredBudget(): Promise<unknown> {
  const roles = Object.keys(ROLE_LABELS).filter(isOrgRole).toSorted();
  const toolDefinitions = await Promise.all(
    roles.map(async (role) => {
      const context = await buildAiContext({ tools: aiToolsFor(role), thread: [], inputTokenCap: 0 });
      return [role, Buffer.byteLength(context.toolDefinitions, 'utf8')] as const;
    }),
  );
  return {
    systemPrompt: Buffer.byteLength(AI_SYSTEM_PROMPT, 'utf8'),
    toolDefinitions: Object.fromEntries(toolDefinitions),
  };
}

test('the agent context budget holds the measured sizes of the system prompt and each role’s tools', async () => {
  expect(
    JSON.parse(budgetText),
    `Write the measured sizes into ${BUDGET_FILE}. More bytes than main needs the owner's \`approved: context growth\`.`,
  ).toEqual(await measuredBudget());
});

test('one more byte in the agent context is growth the shrink-only gate refuses without the owner’s label', () => {
  const list = SHRINK_ONLY_LISTS.find((candidate) => candidate.file === BUDGET_FILE);
  if (!list) throw new Error(`${BUDGET_FILE} is no shrink-only list`);
  expect(list.approval).toBe('approved: context growth');
  const base = listEntries(list, budgetText);
  if (!base) throw new Error(`${BUDGET_FILE} holds no budget`);
  const grown: unknown = JSON.parse(budgetText, (key, value: unknown) =>
    key === 'systemPrompt' && typeof value === 'number' ? value + 1 : value,
  );
  const current = listEntries(list, JSON.stringify(grown));
  if (!current) throw new Error('the grown budget holds no entries');
  expect(growthProblems(list, base, current)).toEqual([expect.stringContaining('raised "systemPrompt"')]);
  expect(growthProblems(list, base, current, { growthApproved: true })).toEqual([]);
});

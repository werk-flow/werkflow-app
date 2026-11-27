import { expect, mock, test } from 'bun:test';
import { resolve } from 'node:path';
import { toJSONSchema } from 'zod';

import type { ActionContext } from '@/lib/org/action-context';
import { aiToolSchemaProblems, missingBoundaryCases } from '@/lib/testing/ai-tool-walk';
import { uuidSchema } from '@/lib/validation/uuid';
import { z } from '@/lib/zod';

// Tier 2 registry walks for WerkFlow KI's tools (B2, B3, B5 and B6 of
// werk-flow/werkflow-planning#20). The tools' readers are server-only; the stub lets the unit tier load them.
mock.module('server-only', () => ({}));
const { AI_TOOLS, aiToolsFor } = await import('@/lib/ai/tools/registry');
const { defineTool } = await import('@/lib/ai/tools/define-tool');

type Defined = ReturnType<typeof defineTool>;

const walked = (tools: readonly Defined[]) =>
  Promise.all(
    tools.map(async (tool) => ({
      ...tool,
      inputJsonSchema: toJSONSchema(tool.inputSchema, { io: 'input' }),
    })),
  );

function planted(input: z.ZodType, ran: string[] = []): Defined {
  return defineTool({
    name: 'geplant',
    label: 'Geplant',
    description: 'Ein Werkzeug nur für diesen Test.',
    input,
    roles: ['admin'],
    control: 'read',
    audit: 'ledger',
    idempotency: 'not_needed',
    dataClasses: ['work'],
    writesMemory: false,
    async execute() {
      ran.push('geplant');
      return { status: 'ok', value: null };
    },
  });
}

const caller = (role: ActionContext['role']): ActionContext => ({
  userId: '30000000-0000-4000-8000-000000000001',
  orgId: '20000000-0000-4000-8000-00000000000a',
  role,
  isManagerOrAbove: role !== 'employee',
});

test('every tool takes a closed, capped input without an organization, user, membership or role key', async () => {
  expect(aiToolSchemaProblems(await walked(AI_TOOLS))).toEqual([]);
});

test('the schema walk fails on a planted tool with an organizationId input, an open object or an uncapped string', async () => {
  const identity = planted(z.strictObject({ organizationId: uuidSchema, suche: z.string().max(10) }));
  expect(aiToolSchemaProblems(await walked([identity]))).toEqual([
    'geplant: input.organizationId names an identity',
  ]);
  const uncapped = planted(z.strictObject({ suche: z.string(), orte: z.array(z.string().max(10)) }));
  expect(aiToolSchemaProblems(await walked([uncapped]))).toEqual([
    'geplant: input.suche has no length cap',
    'geplant: input.orte has no item cap',
  ]);
  const open = planted(z.object({ suche: z.string().max(10) }));
  expect(aiToolSchemaProblems(await walked([open]))).toEqual(['geplant: input takes keys it does not name']);
});

test('the boundary walk fails on a planted tool without its foreign-organization, lower-role and suspended-member cases', () => {
  expect(missingBoundaryCases(['geplant'], {})).toEqual([
    'geplant: no foreignOrganization boundary case',
    'geplant: no lowerRole boundary case',
    'geplant: no suspendedMember boundary case',
  ]);
  const run = async () => undefined;
  expect(
    missingBoundaryCases(['geplant'], {
      geplant: { foreignOrganization: run, lowerRole: run, suspendedMember: run },
    }),
  ).toEqual([]);
});

test('a tool refuses a role it does not serve and an input with an extra key before its reader runs', async () => {
  const ran: string[] = [];
  const tool = planted(z.strictObject({ suche: z.string().max(10) }), ran);
  expect(await tool.execute({ suche: 'Rohr' }, caller('employee'))).toEqual({ status: 'refused' });
  expect(
    await tool.execute({ suche: 'Rohr', organizationId: caller('admin').orgId }, caller('admin')),
  ).toEqual({
    status: 'refused',
  });
  expect(ran).toEqual([]);
  expect(await tool.execute({ suche: 'Rohr' }, caller('admin'))).toEqual({ status: 'ok', value: null });
});

test('an employee gets only the job search; customers and articles stay with Admin and Büro (B6)', () => {
  const names = (role: ActionContext['role']) => aiToolsFor(role).map((tool) => tool.name);
  expect(names('employee')).toEqual(['auftraege_finden']);
  expect(names('buero')).toEqual(['auftraege_finden', 'kunden_finden', 'artikel_finden']);
  expect(names('admin')).toEqual(names('buero'));
  expect(AI_TOOLS.every((tool) => tool.control === 'read' && !tool.writesMemory)).toBe(true);
});

// The tools' boundary cases and the injection replays need module mocks for identity, the database
// and `after()`, which would leak into other test files; each fixture runs in its own process.
async function runFixture(name: string): Promise<void> {
  const child = Bun.spawn([process.execPath, resolve(import.meta.dir, `../../testing/fixtures/${name}.ts`)], {
    cwd: resolve(import.meta.dir, '../../..'),
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const [code, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  expect(code, `${stdout}\n${stderr}`).toBe(0);
}

test('every tool refuses a foreign organization, a lower role and a suspended member through the real turn path', async () => {
  await runFixture('ai-tool-boundaries');
});

test('poisoned record text reaches the model labelled, and the turn then has no write or memory tool', async () => {
  await runFixture('ai-tool-injection');
});

// Every WerkFlow KI tool's boundary cases (B5 and check 3 of werk-flow/werkflow-planning#20),
// through the real turn route, harness and page reader: the model names another organization's
// record and the domain read returns nothing of it; a lower role gets no tool it may not use, or
// only its own work; a suspended member's turn never starts. The walk at the end fails when a
// registered tool has no case.
import assert from 'node:assert/strict';
import type { AI_TOOLS as RegisteredTools } from '@/lib/ai/tools/registry';
import { missingBoundaryCases } from '@/lib/testing/ai-tool-walk';
import { CALLER_ID, ORGANIZATION_A, signInAs, tableRows } from './action-boundary-world';
import { THREAD_ID, postTurn, readTurn, resetAiTables, toolCallOutcomes } from './ai-turn-world';
import { IDS, SALE_PRICE_CENTS, callTool, installAiToolWorld, offeredTools } from './ai-tool-world';

type Input = Record<string, unknown>;
type AiToolName = (typeof RegisteredTools)[number]['name'];

const world = await installAiToolWorld();
const { AI_TOOLS } = await import('@/lib/ai/tools/registry');

const readerCalls = (name: string) => world.rpcCalls.filter((call) => call.name === name);
const shows = (output: unknown, text: string) => JSON.stringify(output).includes(text);

/** The tool's reader ran once, for the caller's organization only. */
function assertReadAsCaller(reader: string): void {
  const calls = readerCalls(reader);
  assert.equal(calls.length, 1, `${reader} must run once`);
  assert.equal(
    calls[0]?.args.p_organization_id,
    ORGANIZATION_A,
    `${reader} must read the caller's organization`,
  );
}

async function call(tool: AiToolName, input: Input) {
  world.rpcCalls.length = 0;
  return callTool(world, tool, input);
}

/** A suspended member's turn is refused at the route: no tool runs and no reader is reached. */
async function suspendedMember(tool: AiToolName, input: Input, reader: string): Promise<void> {
  signInAs(world, 'admin');
  world.memberships = [{ orgId: ORGANIZATION_A, role: 'admin', accessState: 'suspended' }];
  const { status } = await call(tool, input);
  assert.equal(status, 403, `${tool}: a suspended member's turn must be refused`);
  assert.equal(readerCalls(reader).length, 0, `${tool}: no reader may run for a suspended member`);
  assert.equal(tableRows(world, 'ai_runs').length, 0, `${tool}: no run may start for a suspended member`);
}

/** A tool the role does not have is neither offered nor run, and its call is ledgered as not run. */
async function notOfferedTo(tool: AiToolName, input: Input, reader: string): Promise<void> {
  signInAs(world, 'employee');
  const { status, output } = await call(tool, input);
  assert.equal(status, 200);
  assert.equal(
    offeredTools(world.streamRequests[0]).includes(tool),
    false,
    `${tool}: an employee is offered it`,
  );
  assert.equal(readerCalls(reader).length, 0, `${tool}: its reader must not run for an employee`);
  assert.deepEqual(
    toolCallOutcomes(world),
    [`tool_call_${tool}_not_run`],
    `${tool}: the refused call is ledgered`,
  );
  assert.equal(JSON.stringify(output).includes('Müller'), false);
}

/**
 * Posts a turn in which the model calls a harness tool. It reads and changes
 * nothing outside the thread, so the model can name no record of anyone.
 */
async function callHarnessTool(tool: AiToolName, input: Input): Promise<number> {
  const { callerId, memberships, activeOrganizationCookie } = world;
  resetAiTables(world);
  Object.assign(world, { callerId, memberships, activeOrganizationCookie });
  world.rpcCalls.length = 0;
  const response = await postTurn(`[replay:werkzeug] ${JSON.stringify({ name: tool, input })}`);
  if (response.status === 200) await readTurn(world, response);
  return response.status;
}

/** A harness tool's row lands only in the caller's own thread and organization, for every role (B3, B6). */
async function ownThreadOnly(
  tool: AiToolName,
  input: Input,
  kind: string,
  role: 'admin' | 'employee',
): Promise<void> {
  signInAs(world, role);
  assert.equal(await callHarnessTool(tool, input), 200);
  assert.equal(
    offeredTools(world.streamRequests[0]).includes(tool),
    true,
    `${tool}: every role is offered it`,
  );
  const rows = tableRows(world, 'ai_thread_items').filter((row) => row.kind === kind);
  assert.deepEqual(
    rows.map((row) => [row.organization_id, row.thread_id]),
    [[ORGANIZATION_A, THREAD_ID]],
    `${tool}: its row must land in the caller's own thread`,
  );
  assert.deepEqual(toolCallOutcomes(world), [`tool_call_${tool}_ok`]);
}

/** A suspended member's turn never starts, so no harness tool writes a row. */
async function suspendedHarness(tool: AiToolName, input: Input): Promise<void> {
  signInAs(world, 'admin');
  world.memberships = [{ orgId: ORGANIZATION_A, role: 'admin', accessState: 'suspended' }];
  assert.equal(await callHarnessTool(tool, input), 403, `${tool}: a suspended member's turn must be refused`);
  assert.equal(readerCalls('record_ai_tool_item').length, 0, `${tool}: no row may be written`);
}

const QUESTION = { frage: 'Welchen Kunden meinst du?', optionen: ['Müller Haustechnik', 'Müller Bau'] };
const PLAN = { schritte: [{ text: 'Aufträge suchen', erledigt: false }] };

const CASES = {
  auftraege_finden: {
    // The model names org B's customer: the list reads A only and finds nothing; a search never shows B's job.
    async foreignOrganization() {
      signInAs(world, 'admin');
      const named = await call('auftraege_finden', { kundeId: IDS.foreignClient });
      assertReadAsCaller('list_job_entries_page');
      assert.deepEqual(named.output, { type: 'json', value: { auftraege: [], gesamt: 0 } });
      const searched = await call('auftraege_finden', { suche: 'Heizung' });
      assert.equal(
        shows(searched.output, 'Heizung Keller tauschen'),
        true,
        'the office finds all of its work',
      );
      assert.equal(
        shows(searched.output, 'Fremdfirma'),
        false,
        "another organization's job must stay hidden",
      );
      assert.deepEqual(toolCallOutcomes(world), ['tool_call_auftraege_finden_ok']);
    },
    // An employee finds only assigned work: the list reads with the caller's id as no manager.
    async lowerRole() {
      signInAs(world, 'employee');
      const { output } = await call('auftraege_finden', { suche: 'Heizung' });
      const [list] = readerCalls('list_job_entries_page');
      assert.equal(list?.args.p_is_manager, false);
      assert.equal(list?.args.p_user_id, CALLER_ID);
      assert.equal(shows(output, 'Heizung Müller warten'), true, 'an employee finds assigned work');
      assert.equal(shows(output, 'Heizung Keller tauschen'), false, "a coworker's job must stay hidden");
    },
    suspendedMember: () => suspendedMember('auftraege_finden', { suche: 'Heizung' }, 'list_job_entries_page'),
  },
  kunden_finden: {
    async foreignOrganization() {
      signInAs(world, 'buero');
      const { output } = await call('kunden_finden', { suche: 'Müller' });
      assertReadAsCaller('list_customer_page');
      assert.equal(shows(output, 'Müller Haustechnik'), true);
      assert.equal(shows(output, 'Müller Bau'), false, "another organization's customer must stay hidden");
    },
    lowerRole: () => notOfferedTo('kunden_finden', { suche: 'Müller' }, 'list_customer_page'),
    suspendedMember: () => suspendedMember('kunden_finden', { suche: 'Müller' }, 'list_customer_page'),
  },
  artikel_finden: {
    // Reads A's articles only, with supplier terms and no price, and writes no default.
    async foreignOrganization() {
      signInAs(world, 'admin');
      const { output } = await call('artikel_finden', { suche: 'Kupferrohr' });
      assertReadAsCaller('list_inventory_page');
      assert.equal(shows(output, 'Kupferrohr 15 mm'), true);
      assert.equal(shows(output, 'GC-15015'), true, 'the supplier article number reaches the model');
      assert.equal(
        shows(output, 'Kupferrohr 18 mm'),
        false,
        "another organization's article must stay hidden",
      );
      assert.equal(shows(output, String(SALE_PRICE_CENTS)), false, 'no price may reach the model');
      assert.equal(readerCalls('ensure_inventory_defaults').length, 0, 'a read tool writes no default');
    },
    lowerRole: () => notOfferedTo('artikel_finden', { suche: 'Kupferrohr' }, 'list_inventory_page'),
    suspendedMember: () => suspendedMember('artikel_finden', { suche: 'Kupferrohr' }, 'list_inventory_page'),
  },
  frage_stellen: {
    foreignOrganization: () => ownThreadOnly('frage_stellen', QUESTION, 'question', 'admin'),
    lowerRole: () => ownThreadOnly('frage_stellen', QUESTION, 'question', 'employee'),
    suspendedMember: () => suspendedHarness('frage_stellen', QUESTION),
  },
  plan_zeigen: {
    foreignOrganization: () => ownThreadOnly('plan_zeigen', PLAN, 'todo_list', 'admin'),
    lowerRole: () => ownThreadOnly('plan_zeigen', PLAN, 'todo_list', 'employee'),
    suspendedMember: () => suspendedHarness('plan_zeigen', PLAN),
  },
} satisfies Record<
  AiToolName,
  Record<'foreignOrganization' | 'lowerRole' | 'suspendedMember', () => Promise<void>>
>;

assert.deepEqual(
  missingBoundaryCases(
    AI_TOOLS.map((tool) => tool.name),
    CASES,
  ),
  [],
  'every registered tool needs all three boundary cases',
);
for (const cases of Object.values(CASES)) {
  await cases.foreignOrganization();
  await cases.lowerRole();
  await cases.suspendedMember();
}

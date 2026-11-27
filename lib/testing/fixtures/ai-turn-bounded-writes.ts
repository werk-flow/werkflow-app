// Replays turns whose ledger, answer or settlement write, or whose switch
// read, hangs (B13-B15 of werk-flow/werkflow-planning#20,
// werk-flow/werkflow-planning#559). The write limits and the turn's total time
// are cut here, so a hanging call ends within the test; every other limit is
// the product's.
import { mock, setSystemTime } from 'bun:test';
import assert from 'node:assert/strict';
import { tableRows } from './action-boundary-world';
import { installAiTurnWorld, postTurn, readTurn, resetAiTables } from './ai-turn-world';

const limits = await import('@/lib/ai/limits');
const WRITE_LIMIT_MS = 50;
const TURN_LIMIT_MS = 2_000;

mock.module('@/lib/ai/limits', () => ({
  ...limits,
  AI_TURN_LIMITS: {
    chat: {
      ...limits.AI_TURN_LIMITS.chat,
      totalTimeoutMs: TURN_LIMIT_MS,
      costWriteTimeoutMs: WRITE_LIMIT_MS,
      answerSaveTimeoutMs: WRITE_LIMIT_MS,
      settleTimeoutMs: WRITE_LIMIT_MS,
    },
  },
}));

const world = await installAiTurnWorld();
// Imported once the world stands in for `server-only` and the database.
const settings = await import('@/lib/ai/settings');
const readSwitch = settings.readAiOrganizationSwitch;
/** Whether the next switch reads hang: a database that stops answering between two steps. */
let switchHangs = false;
mock.module('@/lib/ai/settings', () => ({
  ...settings,
  readAiOrganizationSwitch: (organizationId: string) =>
    switchHangs ? new Promise(() => {}) : readSwitch(organizationId),
}));
const rows = (table: string) => tableRows(world, table);
const answerItem = () => rows('ai_thread_items').find((row) => row.kind === 'assistant_message');
const runStatus = () => rows('ai_runs').map((row) => row.status);
const answerOf = world.rpc;
/** Every call of the named write hangs: it never answers. */
const hang = (name: string, when: (args: Record<string, unknown>) => boolean = () => true) => {
  world.rpc = (call) => (call.name === name && when(call.args) ? new Promise(() => {}) : answerOf(call));
};

// A cost write past its limit ends the turn in German and keeps the run's provisional charge.
{
  resetAiTables(world);
  hang('record_ai_run_attempt');
  const events = await readTurn(world, await postTurn('Hallo'));
  world.rpc = answerOf;
  assert.equal(events.at(-1)?.failure, 'interrupted', 'a hanging cost write must end the turn');
  assert.equal(events.at(-1)?.message, 'Die Antwort wurde unterbrochen. Versuch es noch einmal.');
  assert.deepEqual(runStatus(), ['reserved'], 'a cost write past its limit must keep the provisional charge');
  assert.equal(answerItem()?.status, 'failed');
}

// A final save past its limit ends the turn as interrupted; the run settles at its recorded cost.
{
  resetAiTables(world);
  hang('update_ai_thread_item', (args) => args.p_status !== 'streaming');
  const events = await readTurn(world, await postTurn('Hallo'));
  world.rpc = answerOf;
  assert.equal(events.at(-1)?.failure, 'interrupted', 'a hanging final save must end the turn');
  assert.deepEqual(runStatus(), ['failed'], 'a final save past its limit settles at the recorded cost');
  assert.equal(rows('ai_run_attempts').length, 1);
  // Left streaming, the answer waits for the database job or a retry; neither starts a provider attempt.
  assert.equal(answerItem()?.status, 'streaming');
}

// A settlement past its limit keeps the reservation as the run's provisional charge; the answer stands.
{
  resetAiTables(world);
  hang('settle_ai_run');
  const events = await readTurn(world, await postTurn('Hallo'));
  world.rpc = answerOf;
  assert.deepEqual(events.at(-1), { type: 'end', status: 'complete' });
  assert.equal(answerItem()?.status, 'complete');
  assert.deepEqual(runStatus(), ['reserved'], 'a settlement past its limit must keep the provisional charge');
}

// A switch read that hangs between two steps ends the turn when its time is up, so it still saves and settles (sol-loop S4).
{
  resetAiTables(world);
  world.afterAttempt = () => {
    switchHangs = true;
  };
  const events = await readTurn(world, await postTurn('[replay:zwei-schritte] Lies den Auftrag.'));
  switchHangs = false;
  assert.equal(events.at(-1)?.failure, 'timeout', 'a switch read past the turn time must end the turn');
  assert.equal(answerItem()?.status, 'cancelled');
  assert.deepEqual(runStatus(), ['cancelled'], 'a turn stopped at its time must still settle');
}

// Slow but successful ledger rows of a step's unrun tool calls share one write's limit: the batch
// stops when it is spent and ends the turn, which still saves and settles in time (B13, B19).
// Each tool row moves the clock past the limit, as a slow write that succeeds would.
{
  resetAiTables(world);
  let now = Date.now();
  world.rpc = (call) => {
    if (call.name === 'record_ai_run_attempt' && String(call.args.p_outcome).startsWith('tool_call_')) {
      now += WRITE_LIMIT_MS * 1.2;
      setSystemTime(new Date(now));
    }
    return answerOf(call);
  };
  const events = await readTurn(world, await postTurn('[replay:vergiftet] Was steht an?'));
  world.rpc = answerOf;
  setSystemTime();
  assert.equal(events.at(-1)?.failure, 'interrupted', 'a tool-call batch past its limit must end the turn');
  assert.deepEqual(
    rows('ai_run_attempts').flatMap((row) =>
      String(row.p_outcome).startsWith('tool_call_') ? [row.p_outcome] : [],
    ),
    ['tool_call_auftraege_finden_failed', 'tool_call_unknown_not_run'],
    'the batch must stop at its shared limit',
  );
  assert.deepEqual(runStatus(), ['failed'], 'the run must still settle');
  assert.equal(answerItem()?.status, 'failed');
}

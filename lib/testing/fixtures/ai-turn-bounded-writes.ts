// Replays turns whose ledger, answer or settlement write hangs (B13-B15 of
// werk-flow/werkflow-planning#20, werk-flow/werkflow-planning#559). The write
// limits are cut to milliseconds here, so a hanging write ends within the
// test; every other limit is the product's.
import { mock } from 'bun:test';
import assert from 'node:assert/strict';
import { tableRows } from './action-boundary-world';
import { installAiTurnWorld, postTurn, readTurn, resetAiTables } from './ai-turn-world';

const limits = await import('@/lib/ai/limits');
const WRITE_LIMIT_MS = 50;
mock.module('@/lib/ai/limits', () => ({
  ...limits,
  AI_TURN_LIMITS: {
    chat: {
      ...limits.AI_TURN_LIMITS.chat,
      costWriteTimeoutMs: WRITE_LIMIT_MS,
      answerSaveTimeoutMs: WRITE_LIMIT_MS,
      settleTimeoutMs: WRITE_LIMIT_MS,
    },
  },
}));

const world = await installAiTurnWorld();
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

// A final save past its limit ends the turn as interrupted; the charge is settled at its recorded cost.
{
  resetAiTables(world);
  hang('update_ai_thread_item', (args) => args.p_status !== 'streaming');
  const events = await readTurn(world, await postTurn('Hallo'));
  world.rpc = answerOf;
  assert.equal(events.at(-1)?.failure, 'interrupted', 'a hanging final save must end the turn');
  assert.deepEqual(runStatus(), ['failed']);
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

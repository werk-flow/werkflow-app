// Replays recorded synthetic model streams through the real turn route and
// harness (check 4 and B13-B15, B21 of werk-flow/werkflow-planning#20). Each
// block states one invariant; a failing assert names it.
import assert from 'node:assert/strict';
import { AI_TURN_LIMITS } from '@/lib/ai/limits';
import { ORGANIZATION_B, signInAs, tableRows } from './action-boundary-world';
import {
  OTHER_USER_ID,
  THREAD_ID,
  installAiTurnWorld,
  postTurn,
  readTurn,
  resetAiTables,
} from './ai-turn-world';

const world = installAiTurnWorld();
const rows = (table: string) => tableRows(world, table);
const attempts = () => rows('ai_run_attempts');
const answerItem = () => rows('ai_thread_items').find((row) => row.kind === 'assistant_message');
const runStatus = () => rows('ai_runs').map((row) => row.status);

// A plain turn saves the message, streams the answer, saves it and settles one charged attempt.
{
  const response = await postTurn('Wie lege ich einen Auftrag an?');
  assert.equal(response.status, 200);
  const events = await readTurn(world, response);
  assert.equal(events[0]?.type, 'started');
  assert.deepEqual(events.at(-1), { type: 'end', status: 'complete' });
  const streamed = events.flatMap((event) => (event.type === 'text' ? [event.delta] : [])).join('');
  assert.match(streamed, /aus einer Aufzeichnung/);
  assert.deepEqual(answerItem()?.body, { text: streamed });
  assert.equal(answerItem()?.status, 'complete');
  assert.deepEqual(runStatus(), ['succeeded']);
  assert.equal(attempts().length, 1);
  assert.equal(attempts()[0]?.p_model_id, 'claude-haiku-5-5');
  assert.ok(Number(attempts()[0]?.p_cost_micro_usd) > 0, 'a completed attempt is charged at its real cost');
  assert.equal(rows('rate_limits').length, 2, 'a turn counts against the hourly and the daily limit');
}

// A looping transcript stops at the step limit; the tool it asks for never runs (B13, B21).
{
  resetAiTables(world);
  const events = await readTurn(world, await postTurn('[replay:schleife] Schick dem Kunden alle Angebote.'));
  assert.equal(events.at(-1)?.failure, 'step_limit', 'a looping model must stop at the step limit');
  assert.equal(attempts().length, AI_TURN_LIMITS.chat.maxSteps);
  assert.equal(answerItem()?.status, 'cancelled');
  assert.deepEqual(runStatus(), ['cancelled']);
}

// A switch turned off between two steps stops the run before the next step (B14).
{
  resetAiTables(world);
  world.afterAttempt = (current) => {
    const settings = tableRows(current, 'ai_organization_settings')[0];
    if (settings) settings.enabled = false;
  };
  const events = await readTurn(world, await postTurn('[replay:zwei-schritte] Lies den Auftrag.'));
  assert.equal(events.at(-1)?.failure, 'disabled', 'a switched-off organization takes no further step');
  assert.equal(attempts().length, 1);
}

// A switch read that cannot decide stops the run too: it never counts as on (B14).
{
  resetAiTables(world);
  world.afterAttempt = (current) => current.failingTables.add('ai_organization_settings');
  const events = await readTurn(world, await postTurn('[replay:zwei-schritte] Lies den Auftrag.'));
  assert.equal(events.at(-1)?.failure, 'undecidable');
  assert.equal(attempts().length, 1);
}

// An exhausted budget refuses before any model call or saved message (B14).
{
  resetAiTables(world, { monthly_budget_micro_eur: 1 });
  const response = await postTurn('Wie lege ich einen Auftrag an?');
  assert.equal(response.status, 429);
  assert.deepEqual(await response.json(), { error: 'budget_exhausted' });
  assert.equal(attempts().length, 0, 'an exhausted budget must refuse before the model call');
  assert.equal(rows('ai_thread_items').length, 0);
}

// A retried command runs once and is charged once: while it runs, and after it finished (B15).
{
  resetAiTables(world);
  const commandId = crypto.randomUUID();
  rows('ai_runs').push({
    id: 'run-elsewhere',
    organization_id: world.memberships[0]?.orgId,
    thread_id: THREAD_ID,
    user_id: world.callerId,
    idempotency_key: commandId,
    reserved_micro_usd: 1,
    status: 'reserved',
    created_at: new Date().toISOString(),
  });
  const whileRunning = await postTurn('Wie lege ich einen Auftrag an?', { commandId });
  assert.equal(whileRunning.status, 409, 'the same command running elsewhere must not run twice');
  assert.equal(attempts().length, 0);

  resetAiTables(world);
  const retriedId = crypto.randomUUID();
  await readTurn(world, await postTurn('Wie lege ich einen Auftrag an?', { commandId: retriedId }));
  const retry = await postTurn('Wie lege ich einen Auftrag an?', { commandId: retriedId });
  assert.deepEqual(await retry.json(), { status: 'already_done' });
  assert.equal(attempts().length, 1, 'a retried command must be charged once');
  assert.equal(rows('ai_thread_items').length, 2);
}

// An overloaded provider is retried, and both attempts are ledgered (B15).
{
  resetAiTables(world);
  const events = await readTurn(world, await postTurn('[replay:ueberlastet] Hallo'));
  assert.deepEqual(events.at(-1), { type: 'end', status: 'complete' });
  assert.deepEqual(
    attempts().map((row) => row.p_outcome),
    ['provider_error', 'completed'],
  );
}

// A spend limit is never retried and ends in a stable German message (B15).
for (const transcript of ['ausgabenlimit', 'guthaben-leer']) {
  resetAiTables(world);
  const events = await readTurn(world, await postTurn(`[replay:${transcript}] Hallo`));
  assert.equal(attempts().length, 1, `${transcript} must not be retried`);
  assert.equal(events.at(-1)?.failure, 'provider_refused');
  assert.equal(events.at(-1)?.message, 'WerkFlow KI ist gerade nicht verfügbar. Wir kümmern uns darum.');
  assert.deepEqual(runStatus(), ['failed']);
}
assert.equal(attempts()[0]?.p_outcome, 'provider_refused');

// A stream that breaks after it began keeps what was written, is not retried and is charged at its estimate.
{
  resetAiTables(world);
  const events = await readTurn(world, await postTurn('[replay:abbruch] Hallo'));
  assert.equal(events.at(-1)?.status, 'failed');
  assert.equal(attempts().length, 1);
  assert.ok(Number(attempts()[0]?.p_cost_micro_usd) > 0, 'a broken stream must still be charged');
  assert.equal(answerItem()?.body && JSON.stringify(answerItem()?.body).includes('Ich fange an'), true);
}

// One active run per person: a second turn while an older one is open yields and frees its hold (B13).
{
  resetAiTables(world);
  rows('ai_runs').push({
    id: 'run-older',
    organization_id: world.memberships[0]?.orgId,
    thread_id: THREAD_ID,
    user_id: world.callerId,
    idempotency_key: 'older-command',
    reserved_micro_usd: 1,
    status: 'reserved',
    created_at: new Date(Date.now() - 60_000).toISOString(),
  });
  const response = await postTurn('Wie lege ich einen Auftrag an?');
  assert.equal(response.status, 409);
  assert.deepEqual(runStatus(), ['reserved', 'cancelled']);
  assert.equal(attempts().length, 0);
}

// The per-person limit refuses the 61st turn of an hour (O3).
{
  resetAiTables(world);
  let last = 0;
  for (let turn = 0; turn <= 60; turn += 1) {
    const response = await postTurn('Hallo');
    last = response.status;
    if (response.status === 200) await readTurn(world, response);
  }
  assert.equal(last, 429, 'the 61st turn of an hour must be refused');
}

// The boundary: a foreign organization, a signed-out caller, a cross-site post,
// another person's thread and an unreleased organization run nothing.
{
  resetAiTables(world);
  const rpcCalls = world.rpcCalls.length;
  assert.equal((await postTurn('Hallo', { organizationId: ORGANIZATION_B })).status, 403);
  world.callerId = null;
  assert.equal((await postTurn('Hallo')).status, 401);
  signInAs(world, 'employee');
  assert.equal((await postTurn('Hallo', { headers: { 'sec-fetch-site': 'cross-site' } })).status, 403);
  assert.equal(world.rpcCalls.length, rpcCalls, 'a refused caller must reach no database function');

  rows('ai_threads').push({
    id: THREAD_ID,
    organization_id: world.memberships[0]?.orgId,
    user_id: OTHER_USER_ID,
  });
  assert.equal((await postTurn('Hallo')).status, 404, "another person's thread must stay closed");
  assert.equal(rows('ai_runs').length, 0);

  resetAiTables(world);
  process.env.AI_ORGANIZATION_IDS = ORGANIZATION_B;
  assert.equal((await postTurn('Hallo')).status, 403);
  process.env.AI_ORGANIZATION_IDS = `${world.memberships[0]?.orgId ?? ''},${ORGANIZATION_B}`;
}

// A Vercel deployment without the key has no model: no replay answers a customer (B1).
{
  resetAiTables(world);
  process.env.VERCEL = '1';
  const response = await postTurn('Hallo');
  delete process.env.VERCEL;
  assert.equal(response.status, 503);
  assert.equal(rows('ai_runs').length, 0);
}

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

const world = await installAiTurnWorld();
const rows = (table: string) => tableRows(world, table);
const attempts = () => rows('ai_run_attempts');
const answerItem = () => rows('ai_thread_items').find((row) => row.kind === 'assistant_message');
const runStatus = () => rows('ai_runs').map((row) => row.status);
const TURN_STREAM = 'application/x-ndjson; charset=utf-8';
const streamedText = (events: Awaited<ReturnType<typeof readTurn>>) =>
  events.flatMap((event) => (event.type === 'text' ? [event.delta] : [])).join('');

// A plain turn saves the message, streams the answer, saves it and settles one charged attempt.
{
  const response = await postTurn('Wie lege ich einen Auftrag an?');
  assert.equal(response.status, 200);
  const events = await readTurn(world, response);
  assert.equal(events[0]?.type, 'started');
  assert.deepEqual(events.at(-1), { type: 'end', status: 'complete' });
  const streamed = streamedText(events);
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

// An exhausted budget refuses before any model call or answer; the person's message stays (B14).
{
  resetAiTables(world, { monthly_budget_micro_eur: 1 });
  const response = await postTurn('Wie lege ich einen Auftrag an?');
  assert.equal(response.status, 429);
  assert.deepEqual(await response.json(), { error: 'budget_exhausted' });
  assert.equal(attempts().length, 0, 'an exhausted budget must refuse before the model call');
  assert.deepEqual(
    rows('ai_thread_items').map((row) => row.kind),
    ['user_message'],
  );
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
  assert.equal(rows('ai_runs').length, 1, 'a command running elsewhere must not reserve again');
  assert.equal(attempts().length, 0);

  resetAiTables(world);
  const retriedId = crypto.randomUUID();
  await readTurn(world, await postTurn('Wie lege ich einen Auftrag an?', { commandId: retriedId }));
  const retry = await postTurn('Wie lege ich einen Auftrag an?', { commandId: retriedId });
  assert.deepEqual(await retry.json(), { status: 'already_done' });
  assert.equal(attempts().length, 1, 'a retried command must be charged once');
  assert.equal(rows('ai_thread_items').length, 2);
  // The ledger keeps its rows past the thread's deletion: its keys hold the command id and no value of the message.
  assert.deepEqual(
    [...rows('ai_runs'), ...attempts()].map((row) => row.idempotency_key),
    [retriedId, `${retriedId}:1:0`],
    'a ledger key must name the bare command id',
  );
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
for (const transcript of ['ausgabenlimit', 'vertragslimit', 'guthaben-leer']) {
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

// Overloaded inside the stream before any text is retried like a refused request (B15).
{
  resetAiTables(world);
  const events = await readTurn(world, await postTurn('[replay:ueberlastet-im-strom] Hallo'));
  assert.deepEqual(events.at(-1), { type: 'end', status: 'complete' });
  assert.deepEqual(
    attempts().map((row) => row.p_outcome),
    ['provider_error', 'completed'],
  );
}

// A connection lost under a successful response before any text is retried (sol-loop S16).
{
  resetAiTables(world);
  const events = await readTurn(world, await postTurn('[replay:verbindung-weg] Hallo'));
  assert.deepEqual(events.at(-1), { type: 'end', status: 'complete' });
  assert.equal(attempts().length, 2);
  // The provider accepted the request, so it bills it: the failed attempt is charged at its caps.
  assert.equal(
    attempts()[0]?.p_output_tokens,
    AI_TURN_LIMITS.chat.maxOutputTokens,
    'an attempt the provider accepted must be charged at its output cap',
  );
  assert.ok(Number(attempts()[0]?.p_input_tokens) > 0, 'an accepted attempt must be charged for its prompt');
}

// A command id sent again with other text is refused, and the saved message stays as it was (sol-loop S17).
{
  resetAiTables(world, { monthly_budget_micro_eur: 1 });
  const commandId = crypto.randomUUID();
  assert.equal((await postTurn('[replay:echo] Erste Frage', { commandId })).status, 429);
  // Only the budget changes between the two posts; the thread keeps the saved message.
  const settings = rows('ai_organization_settings')[0];
  if (settings) settings.monthly_budget_micro_eur = 50_000_000;
  const reused = await postTurn('[replay:echo] Zweite Frage', { commandId });
  assert.equal(reused.status, 409, 'a reused command id with other text must be refused');
  assert.deepEqual(await reused.json(), { error: 'command_conflict' });
  assert.deepEqual(
    rows('ai_thread_items').map((row) => row.body),
    [{ text: '[replay:echo] Erste Frage' }],
    'the saved message must stay as it was',
  );
  assert.equal(rows('ai_runs').length, 0, 'a refused reuse must reserve nothing');
  // The same text under the same id is the retry it was: the saved message gets its answer.
  const events = await readTurn(world, await postTurn('[replay:echo] Erste Frage', { commandId }));
  assert.equal(streamedText(events), 'Du hast geschrieben: Erste Frage');
}

// A stream the provider closed before its first event is retried, and the accepted attempt is charged (B15).
{
  resetAiTables(world);
  const events = await readTurn(world, await postTurn('[replay:nur-start] Hallo'));
  assert.deepEqual(events.at(-1), { type: 'end', status: 'complete' });
  assert.deepEqual(
    attempts().map((row) => row.p_outcome),
    ['provider_error', 'completed'],
  );
  assert.ok(Number(attempts()[0]?.p_cost_micro_usd) > 0, 'an accepted request must be charged');
}

// A stream opened under a success status and closed before its first event is retried and charged at its caps (B15).
{
  resetAiTables(world);
  const events = await readTurn(world, await postTurn('[replay:leerer-strom] Hallo'));
  assert.deepEqual(
    events.at(-1),
    { type: 'end', status: 'complete' },
    'an empty accepted stream must be retried',
  );
  assert.deepEqual(
    attempts().map((row) => row.p_outcome),
    ['provider_error', 'completed'],
  );
  assert.equal(
    attempts()[0]?.p_output_tokens,
    AI_TURN_LIMITS.chat.maxOutputTokens,
    'a stream the provider opened must be charged at its output cap',
  );
}

// A new thread's title ends on a whole character, never half of one.
{
  resetAiTables(world);
  const threadId = crypto.randomUUID();
  await readTurn(world, await postTurn(`${'a'.repeat(79)}🔧 Heizung`, { threadId }));
  assert.equal(
    rows('ai_threads').find((row) => row.id === threadId)?.title,
    `${'a'.repeat(79)}🔧`,
    'a thread title must not split a character',
  );
}

// The turn has two retries in all, not two per step (B15).
{
  resetAiTables(world);
  const events = await readTurn(world, await postTurn('[replay:mehrfach-ueberlastet] Lies den Auftrag.'));
  assert.equal(events.at(-1)?.failure, 'provider_unavailable');
  assert.equal(attempts().length, 4, 'a turn must stop after its two retries');
}

// A stream that ends without its final event is no complete answer, and its unknown usage is charged at the caps.
{
  resetAiTables(world);
  const events = await readTurn(world, await postTurn('[replay:unterbrochen] Hallo'));
  assert.equal(events.at(-1)?.status, 'failed', 'an interrupted stream must not count as a complete answer');
  assert.equal(attempts().length, 1);
  assert.ok(
    Number(attempts()[0]?.p_output_tokens) >= AI_TURN_LIMITS.chat.maxOutputTokens,
    'an attempt without reported usage must be charged at its output cap',
  );
}

// The answer cap holds before a delta is shown or saved, measured on the stored JSON (B13).
{
  resetAiTables(world);
  const events = await readTurn(world, await postTurn('[replay:zu-lang] Schreib viel.'));
  assert.equal(events.at(-1)?.failure, 'answer_too_long');
  assert.equal(
    world.streamSignals.at(-1)?.aborted,
    true,
    'an early stop must abort the provider request (sol-loop S18)',
  );
  const streamed = streamedText(events);
  assert.deepEqual(answerItem()?.body, { text: streamed, failure: 'answer_too_long' });
  assert.ok(
    Buffer.byteLength(JSON.stringify(answerItem()?.body)) <= AI_TURN_LIMITS.chat.maxAnswerBytes,
    'the stored answer must fit its cap',
  );
}

// A failed final save never reports a complete answer (sol-loop S1).
{
  resetAiTables(world);
  const answerOf = world.rpc;
  world.rpc = (call) =>
    call.name === 'update_ai_thread_item' && call.args.p_status !== 'streaming'
      ? { data: null, error: { message: 'connection failure' } }
      : answerOf(call);
  const commandId = crypto.randomUUID();
  const events = await readTurn(world, await postTurn('Hallo', { commandId }));
  world.rpc = answerOf;
  assert.equal(events.at(-1)?.failure, 'interrupted');
  assert.deepEqual(runStatus(), ['failed']);
  // A retry finishes the answer the run could not, with what its last partial save held.
  assert.equal(answerItem()?.status, 'streaming');
  assert.deepEqual(await (await postTurn('Hallo', { commandId })).json(), { status: 'already_done' });
  assert.equal(answerItem()?.status, 'failed', 'an answer left streaming must be finished on retry');
  assert.deepEqual(answerItem()?.body, { text: '', failure: 'interrupted' });
}

// An attempt the ledger cannot take keeps its hold: the run is not settled (sol-loop S2).
{
  resetAiTables(world);
  const answerOf = world.rpc;
  world.rpc = (call) =>
    call.name === 'record_ai_run_attempt'
      ? { data: null, error: { message: 'connection failure' } }
      : answerOf(call);
  const events = await readTurn(world, await postTurn('Hallo'));
  world.rpc = answerOf;
  assert.equal(events.at(-1)?.failure, 'interrupted');
  assert.deepEqual(runStatus(), ['reserved'], 'an unledgered charge must keep its hold');
}

// A command refused before its answer existed stays open: a retry under the same id answers it.
{
  resetAiTables(world);
  const commandId = crypto.randomUUID();
  const answerOf = world.rpc;
  world.rpc = (call) =>
    call.name === 'append_ai_thread_item' && call.args.p_kind === 'assistant_message'
      ? { data: null, error: { message: 'connection failure' } }
      : answerOf(call);
  assert.equal((await postTurn('Hallo', { commandId })).status, 503);
  assert.equal((await postTurn('Hallo', { commandId })).status, 503);
  world.rpc = answerOf;
  const retry = await postTurn('Hallo', { commandId });
  assert.equal(
    retry.headers.get('content-type'),
    TURN_STREAM,
    'a command refused before its answer must run on retry',
  );
  const events = await readTurn(world, retry);
  assert.deepEqual(events.at(-1), { type: 'end', status: 'complete' });
  assert.equal(answerItem()?.status, 'complete');
  assert.deepEqual(
    rows('ai_thread_items').map((row) => row.kind),
    ['user_message', 'assistant_message'],
    'the answer belongs to the saved message',
  );
  assert.deepEqual(runStatus(), ['cancelled', 'cancelled', 'succeeded']);
  assert.deepEqual(
    rows('ai_runs').map((row) => row.idempotency_key),
    [commandId, `${commandId}:retry-1`, `${commandId}:retry-2`],
  );
  assert.equal(attempts().length, 1, 'only the run that answered is charged');
  // Once answered, the command is done.
  assert.deepEqual(await (await postTurn('Hallo', { commandId })).json(), { status: 'already_done' });
}

// An identity check that cannot complete is a private failure, never a turn (sol-loop S7).
{
  resetAiTables(world);
  const memberships = world.memberships;
  Object.defineProperty(world, 'memberships', {
    configurable: true,
    get: () => {
      throw new Error('membership read unavailable');
    },
  });
  const response = await postTurn('Hallo');
  Object.defineProperty(world, 'memberships', { configurable: true, writable: true, value: memberships });
  assert.equal(response.status, 503);
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
  assert.equal(rows('ai_runs').length, 0);
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
  const commandId = crypto.randomUUID();
  const response = await postTurn('Wie lege ich einen Auftrag an?', { commandId });
  assert.equal(response.status, 409, 'a second open run of a person must yield');
  assert.deepEqual(runStatus(), ['reserved', 'cancelled']);
  // Once the older run is done, the yielded command runs under its own id.
  const older = rows('ai_runs')[0];
  if (older) older.status = 'succeeded';
  const retry = await postTurn('Wie lege ich einen Auftrag an?', { commandId });
  assert.equal(retry.headers.get('content-type'), TURN_STREAM, 'a yielded command must run on retry');
  const events = await readTurn(world, retry);
  assert.deepEqual(events.at(-1), { type: 'end', status: 'complete' });
  assert.match(streamedText(events), /aus einer Aufzeichnung/);
  // A younger open run blocks too: a run that committed late never passes beside it.
  resetAiTables(world);
  rows('ai_runs').push({
    id: 'run-younger',
    organization_id: world.memberships[0]?.orgId,
    thread_id: THREAD_ID,
    user_id: world.callerId,
    idempotency_key: 'younger-command',
    reserved_micro_usd: 1,
    status: 'reserved',
    created_at: new Date(Date.now() + 60_000).toISOString(),
  });
  assert.equal((await postTurn('Wie lege ich einen Auftrag an?')).status, 409);
  assert.equal(attempts().length, 0);
  // An open run in another organization of the same person blocks too.
  resetAiTables(world);
  rows('ai_runs').push({
    id: 'run-other-organization',
    organization_id: ORGANIZATION_B,
    thread_id: crypto.randomUUID(),
    user_id: world.callerId,
    idempotency_key: 'other-organization-command',
    reserved_micro_usd: 1,
    status: 'reserved',
    created_at: new Date(Date.now() - 60_000).toISOString(),
  });
  assert.equal(
    (await postTurn('Wie lege ich einen Auftrag an?')).status,
    409,
    "a person's open run in another organization must block a second run",
  );
  assert.equal(attempts().length, 0);
}

// The per-person limit lets 60 turns of an hour run and refuses the 61st before any write (O3).
{
  resetAiTables(world);
  for (let turn = 1; turn <= 60; turn += 1) {
    const response = await postTurn('Hallo');
    assert.equal(response.status, 200, `turn ${turn} of an hour must run`);
    await readTurn(world, response);
  }
  const threads = rows('ai_threads').length;
  const refusedThread = crypto.randomUUID();
  const refused = await postTurn('Hallo', { threadId: refusedThread });
  assert.equal(refused.status, 429, 'the 61st turn of an hour must be refused');
  assert.equal(rows('ai_threads').length, threads, 'a turn refused by the limit must create no thread');
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

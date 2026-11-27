// Replays turns the person stops or loses mid-answer (werk-flow/werkflow-planning#609,
// B13 and B14 of werk-flow/werkflow-planning#20): the real stop route, turn
// route, harness, AI SDK and replay provider over the in-memory database.
// Each block states one invariant; a failing assert names it.
import assert from 'node:assert/strict';
import { AI_MODEL_PRICE, costMicroUsd } from '@/lib/ai/cost';
import { AI_TURN_LIMITS } from '@/lib/ai/limits';
import { kiLiveEventSchema } from '@/lib/ai/live/events';
import { z } from '@/lib/zod';
import { ORGANIZATION_A, ORGANIZATION_B, signInAs, tableRows } from './action-boundary-world';
import {
  OTHER_USER_ID,
  THREAD_ID,
  installAiTurnWorld,
  postStop,
  postTurn,
  providerAttempts,
  readTurn,
  resetAiTables,
  stopAnswer,
  toolCallOutcomes,
} from './ai-turn-world';

const world = await installAiTurnWorld();
const rows = (table: string) => tableRows(world, table);
const answerItem = () => rows('ai_thread_items').find((row) => row.kind === 'assistant_message');
const runStatus = () => rows('ai_runs').map((row) => row.status);
const lastAttempt = () => rows('ai_run_attempts').at(-1);
const streamedText = (events: Awaited<ReturnType<typeof readTurn>>) =>
  events.flatMap((event) => (event.type === 'text' ? [event.delta] : [])).join('');
const liveEvents = (sends = world.liveSends) =>
  sends.flatMap((send) => send.events.map((event) => kiLiveEventSchema.parse(event)));
const textOf = (body: unknown): string => z.object({ text: z.string() }).parse(body).text;
/** The whole answer of the `langsam` transcript, had nothing stopped it. */
const FULL_SLOW_ANSWER = 60 * 'Schritt 1: Druck am Manometer prüfen und notieren. '.length;
/** An aborted attempt reports no usage, so it is charged at least every output token it may have used. */
const outputCap = costMicroUsd(
  {
    inputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    outputTokens: AI_TURN_LIMITS.chat.maxOutputTokens,
  },
  AI_MODEL_PRICE,
);

// „Antwort anhalten“ mid-answer: the next partial save refuses, which aborts the provider request.
// The answer keeps the text of its last save, the run settles at what the attempt may have cost, and
// the live channel's end cuts every tab back to the saved text.
{
  const command = crypto.randomUUID();
  const stops: Response[] = [];
  // The stop goes once a live message says a partial save holds text.
  world.onLiveSend = async (events) => {
    const saved = liveEvents([{ topic: '', events }]).some(
      (event) => event.type === 'text' && event.saved > 0,
    );
    if (stops.length === 0 && saved) stops.push(await postStop(command));
  };
  const events = await readTurn(
    world,
    await postTurn('[replay:langsam] Wie prüfe ich den Druck?', { commandId: command }),
  );
  world.onLiveSend = null;
  assert.equal(stops.length, 1, 'the stop was sent while the answer was written');
  assert.deepEqual(await stops[0]?.json(), { verdict: 'stopped' });
  assert.equal(world.streamSignals.at(-1)?.aborted, true, 'a stop must end the provider request');
  assert.deepEqual(events.at(-1), {
    type: 'end',
    status: 'cancelled',
    failure: 'stopped',
    message: 'Du hast die Antwort angehalten.',
  });
  const kept = textOf(answerItem()?.body);
  assert.ok(kept.length > 0, 'the stopped answer keeps the text of its last partial save');
  assert.ok(streamedText(events).startsWith(kept));
  assert.ok(streamedText(events).length < FULL_SLOW_ANSWER, 'the stopped answer was not written to its end');
  assert.equal(answerItem()?.status, 'cancelled');
  assert.deepEqual(runStatus(), ['cancelled'], 'a stopped run settles at once');
  assert.equal(lastAttempt()?.p_outcome, 'stopped');
  assert.ok(
    Number(lastAttempt()?.p_cost_micro_usd) >= outputCap,
    'a stopped attempt is charged never less than it spent',
  );
  const ends = liveEvents().filter((event) => event.type === 'end');
  assert.deepEqual(
    ends.map((event) => event.type === 'end' && [event.status, event.length]),
    [['cancelled', kept.length]],
    'every tab learns the stop once, from the stop itself, at the length the database kept',
  );
  // A repeat, such as a retry after a lost reply, changes nothing and tells every tab again.
  const sendsBefore = world.liveSends.length;
  assert.deepEqual(
    await (await postStop(command)).json(),
    { verdict: 'stopped' },
    'a repeated stop answers again',
  );
  assert.deepEqual(
    liveEvents(world.liveSends.slice(sendsBefore)).map((event) => event.type === 'end' && event.length),
    [kept.length],
    'a repeated stop tells every tab the kept length again',
  );
  assert.equal(textOf(answerItem()?.body), kept, 'a repeated stop changes nothing');
  assert.equal(answerItem()?.status, 'cancelled');
}

// A partial save that landed although its answer was lost: the turn believes less text is saved
// than the database holds. The stop itself tells every tab the saved length, so no tab keeps less.
{
  resetAiTables(world);
  const command = crypto.randomUUID();
  const answer = world.rpc;
  let partialSaves = 0;
  world.rpc = (call) => {
    const outcome = answer(call);
    if (call.name !== 'update_ai_thread_item' || call.args.p_status !== 'streaming') return outcome;
    partialSaves += 1;
    return partialSaves === 2 ? { data: null, error: { message: 'AbortError: aborted' } } : outcome;
  };
  const before = world.liveSends.length;
  world.onLiveSend = async () => {
    if (partialSaves < 2) return;
    world.onLiveSend = null;
    await postStop(command);
  };
  await readTurn(world, await postTurn('[replay:langsam] Und der Vorlauf?', { commandId: command }));
  world.rpc = answer;
  world.onLiveSend = null;
  const kept = textOf(answerItem()?.body);
  const ends = liveEvents(world.liveSends.slice(before)).flatMap((event) =>
    event.type === 'end' ? [event.length] : [],
  );
  assert.equal(answerItem()?.status, 'cancelled');
  assert.equal(ends[0], kept.length, 'the stop must tell every tab the length the database kept');
  assert.deepEqual(
    ends,
    [kept.length],
    'only the stop, which knows the saved length, may end a stopped answer',
  );
}

// A stop while the model still thinks: a save of the unchanged text sees it, so thinking stops too.
{
  resetAiTables(world);
  const command = crypto.randomUUID();
  world.onLiveSend = async () => {
    world.onLiveSend = null;
    await postStop(command);
  };
  const events = await readTurn(
    world,
    await postTurn('[replay:gruebeln] Wie entlüfte ich?', { commandId: command }),
  );
  assert.equal(
    world.streamSignals.at(-1)?.aborted,
    true,
    'a stop while the model thinks must end the request',
  );
  assert.equal(streamedText(events), '', 'a stopped answer writes nothing after the stop');
  assert.equal(events.at(-1)?.failure, 'stopped');
  assert.deepEqual(runStatus(), ['cancelled']);
  assert.ok(Number(lastAttempt()?.p_cost_micro_usd) >= outputCap);
}

// A stop that lands between two model steps: the step gate reads it, and no further step starts.
{
  resetAiTables(world);
  world.afterAttempt = (current) => {
    world.afterAttempt = null;
    const item = tableRows(current, 'ai_thread_items').find((row) => row.kind === 'assistant_message');
    if (item) stopAnswer(item);
  };
  const events = await readTurn(world, await postTurn('[replay:zwei-schritte] Lies den Auftrag.'));
  assert.equal(world.streamRequests.length, 1, 'a stop between two steps must start no further step');
  assert.equal(events.at(-1)?.failure, 'stopped');
  assert.deepEqual(runStatus(), ['cancelled']);
  assert.equal(providerAttempts(world).length, 1, 'the step that ran is in the ledger');
}

// Suspending the author between steps leaves the answer streaming, but access is gone.
{
  resetAiTables(world);
  world.afterAttempt = () => {
    world.afterAttempt = null;
    world.memberships = [{ orgId: ORGANIZATION_A, role: 'employee', accessState: 'suspended' }];
  };
  const events = await readTurn(world, await postTurn('[replay:zwei-schritte] Lies den Auftrag.'));
  assert.equal(world.streamRequests.length, 1, 'a suspended author must start no second provider request');
  assert.equal(events.at(-1)?.failure, 'revoked');
  assert.deepEqual(runStatus(), ['cancelled'], 'a revoked run settles at what was spent');
  assert.equal(providerAttempts(world).length, 1, 'only the step that ran is charged');
}

// An access read that cannot complete refuses the next step too.
{
  resetAiTables(world);
  const answer = world.rpc;
  world.afterAttempt = () => {
    world.afterAttempt = null;
    world.rpc = (call) =>
      call.name === 'read_ai_answer_status'
        ? { data: null, error: { message: 'connection failed' } }
        : answer(call);
  };
  const events = await readTurn(world, await postTurn('[replay:zwei-schritte] Lies den Auftrag.'));
  world.rpc = answer;
  assert.equal(
    world.streamRequests.length,
    1,
    'an undecidable access read must start no second provider request',
  );
  assert.equal(events.at(-1)?.failure, 'undecidable');
  assert.deepEqual(runStatus(), ['cancelled']);
}

// A stop that lands while a tool still reads: the partial save in flight sees it and aborts the
// request with the call still running. The call gets its ledger row before the run settles (B19).
{
  resetAiTables(world);
  const command = crypto.randomUUID();
  const answer = world.rpc;
  const writes: string[] = [];
  let releaseSave: (() => void) | null = null;
  world.rpc = (call) => {
    writes.push(call.name === 'record_ai_run_attempt' ? String(call.args.p_outcome) : call.name);
    if (call.name === 'list_job_entries_page')
      // The person stops while the tool reads, the held partial save then lands, and the tool never answers.
      return (async () => {
        await postStop(command);
        releaseSave?.();
        return new Promise<never>(() => {});
      })();
    if (call.name === 'update_ai_thread_item' && call.args.p_status === 'streaming' && !releaseSave)
      return new Promise((resolve) => {
        releaseSave = () => resolve(answer(call));
      });
    return answer(call);
  };
  const request = JSON.stringify({ name: 'auftraege_finden', input: { suche: 'Heizung' } });
  const events = await readTurn(
    world,
    await postTurn(`[replay:langsam-werkzeug] ${request}`, { commandId: command }),
  );
  world.rpc = answer;
  assert.ok(writes.includes('list_job_entries_page'), 'the tool was reading when the stop landed');
  assert.equal(world.streamSignals.at(-1)?.aborted, true, 'a stop during a tool must end the request');
  assert.equal(events.at(-1)?.failure, 'stopped');
  assert.deepEqual(
    toolCallOutcomes(world),
    ['tool_call_auftraege_finden_failed'],
    'a stopped turn must record the call its tool still ran',
  );
  assert.ok(
    writes.indexOf('tool_call_auftraege_finden_failed') < writes.indexOf('settle_ai_run'),
    "the running call's row must be written before the run settles",
  );
  assert.equal(world.streamRequests.length, 1, 'a stopped turn starts no further step');
  assert.equal(providerAttempts(world).at(-1)?.p_outcome, 'stopped');
  assert.deepEqual(runStatus(), ['cancelled']);
  const toolItem = rows('ai_thread_items').find((row) => row.kind === 'tool_call');
  assert.equal(
    toolItem?.status,
    'failed',
    'a call the stop broke off must end as failed, never stay running',
  );
  const live = liveEvents();
  const liveRows = live.flatMap((event) => (event.type === 'row' ? [event.row] : []));
  assert.equal(liveRows.at(-1)?.status, 'failed', 'every tab must see the broken-off call end');
  assert.deepEqual(
    live.flatMap((event) => (event.type === 'end' ? [event.failure] : [])),
    ['Du hast die Antwort angehalten.'],
    'only the stop route ends the answer on other tabs; the stopped turn sends its rows, no end',
  );
}

// A stop that lands after the answer's last partial save is first seen by the final save: the turn
// ends as stopped with the saved text, never as a whole answer.
{
  resetAiTables(world);
  const answer = world.rpc;
  world.rpc = (call) => {
    if (call.name === 'update_ai_thread_item' && call.args.p_status !== 'streaming') {
      const item = answerItem();
      if (item?.status === 'streaming') stopAnswer(item);
    }
    return answer(call);
  };
  const events = await readTurn(world, await postTurn('Wie lege ich einen Auftrag an?'));
  world.rpc = answer;
  assert.equal(
    events.at(-1)?.failure,
    'stopped',
    'a stop seen only by the final save still ends the answer as stopped',
  );
  assert.deepEqual(answerItem()?.body, { text: '', failure: 'stopped' });
  assert.deepEqual(runStatus(), ['cancelled']);
  assert.ok(Number(lastAttempt()?.p_cost_micro_usd) > 0, 'the finished attempt keeps its real cost');
}

// Only the author stops, in their own organization: a stop that names another organization is
// refused before any database call, a signed-out or cross-site one too, and another person's thread
// stays closed.
{
  resetAiTables(world);
  const command = crypto.randomUUID();
  const calls = world.rpcCalls.length;
  assert.equal((await postStop(command, { organizationId: ORGANIZATION_B })).status, 403);
  world.callerId = null;
  assert.equal((await postStop(command)).status, 401);
  signInAs(world, 'employee');
  assert.equal(world.rpcCalls.length, calls, 'a refused caller must reach no database function');
  rows('ai_threads').push({ id: THREAD_ID, organization_id: ORGANIZATION_A, user_id: OTHER_USER_ID });
  rows('ai_thread_items').push({
    id: 'item-other',
    organization_id: ORGANIZATION_A,
    thread_id: THREAD_ID,
    kind: 'assistant_message',
    status: 'streaming',
    body: { text: 'Erst' },
    idempotency_key: `${command}:assistant`,
  });
  assert.equal((await postStop(command)).status, 404, "another person's answer must not stop");
  assert.equal(answerItem()?.status, 'streaming');
}

// An author who loses access mid-answer: the save's refusal ends the turn at once. The provider
// request aborts, the sending tab gets no text past the refused save, and the run settles at what
// was spent.
{
  resetAiTables(world);
  const callsBefore = world.rpcCalls.length;
  const answer = world.rpc;
  let partialSaves = 0;
  let refusedText: string | null = null;
  world.rpc = (call) => {
    if (call.name === 'update_ai_thread_item' && call.args.p_status === 'streaming') {
      partialSaves += 1;
      if (partialSaves > 1) {
        refusedText ??= textOf(call.args.p_body);
        return { data: null, error: { message: 'ai_actor_without_access' } };
      }
    }
    return answer(call);
  };
  const events = await readTurn(world, await postTurn('[replay:langsam] Und der Rücklauf?'));
  world.rpc = answer;
  assert.ok(refusedText !== null, 'a partial save was refused');
  assert.equal(world.streamSignals.at(-1)?.aborted, true, 'a lost thread must end the provider request');
  assert.ok(
    streamedText(events).length <= String(refusedText).length,
    'a lost thread must stop the sending tab’s stream at once',
  );
  assert.equal(events.at(-1)?.failure, 'revoked');
  assert.equal(
    world.rpcCalls
      .slice(callsBefore)
      .filter((call) => call.name === 'update_ai_thread_item' && call.args.p_status !== 'streaming').length,
    0,
    'a turn whose author lost the thread writes no final answer',
  );
  assert.deepEqual(runStatus(), ['cancelled'], 'a run whose author lost access settles at once');
  assert.equal(lastAttempt()?.p_outcome, 'revoked');
  assert.ok(
    Number(lastAttempt()?.p_cost_micro_usd) >= outputCap,
    'a revoked attempt is charged never less than it spent',
  );
}

// A final save that finds the author lost the thread is not tried again: the run settles at once.
{
  resetAiTables(world);
  const answer = world.rpc;
  let finalSaves = 0;
  world.rpc = (call) => {
    if (call.name === 'update_ai_thread_item' && call.args.p_status !== 'streaming') {
      finalSaves += 1;
      return { data: null, error: { message: 'ai_actor_without_access' } };
    }
    return answer(call);
  };
  const events = await readTurn(world, await postTurn('Wie lege ich einen Auftrag an?'));
  world.rpc = answer;
  assert.equal(finalSaves, 1, 'a lost thread at the final save must not be tried again');
  assert.equal(events.at(-1)?.failure, 'revoked');
  assert.deepEqual(runStatus(), ['cancelled']);
}

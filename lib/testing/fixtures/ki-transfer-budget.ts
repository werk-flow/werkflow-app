// The WerkFlow KI transfer budget (check 1 of werk-flow/werkflow-planning#20,
// werk-flow/werkflow-planning#532): a fixed, synthetic, heavy thread through
// the real turn route, harness, thread reader, live broadcast and the chat's
// follow logic, over the in-memory database. It measures what a client
// receives (bytes and messages) and what the database returns (rows) for
// thread open, one live turn, resume after a reload and an idle reconnect, and
// prints one `TRANSFER` line; lib/ai/live/transfer-budget.test.ts holds the
// ceilings. Each block also states the invariant the numbers stand on.
import assert from 'node:assert/strict';
import { kiLiveEventSchema, type KiLiveEvent } from '@/lib/ai/live/events';
import { applyKiLiveEvents, kiLiveCursor, kiLiveGapFillable, mergeNewer } from '@/lib/ai/live/follow';
import type { AiThreadWindow } from '@/lib/ai/thread-types';
import { signInAs, tableRows } from './action-boundary-world';
import { THREAD_ID, installAiTurnWorld, postTurn, readTurn } from './ai-turn-world';

const world = await installAiTurnWorld();
signInAs(world, 'employee');
const organizationId = world.memberships[0]?.orgId ?? '';
const { getAiThreadWindow } = await import('@/lib/ai/thread-reads');

type Measure = { bytes: number; rows: number; messages: number };
const measured: Record<string, Measure> = {};
const bytesOf = (value: unknown): number => Buffer.byteLength(JSON.stringify(value), 'utf8');

/** Sixty finished turns of a long Kundendienst conversation: short questions, answers of 1 to 12 KB. */
function seedHeavyThread(): void {
  tableRows(world, 'ai_threads').push({
    id: THREAD_ID,
    organization_id: organizationId,
    user_id: world.callerId,
    title: 'Heizungsanlage Familie Beispiel',
    updated_at: '2026-11-27T08:00:00.000Z',
  });
  for (let turn = 1; turn <= 60; turn += 1) {
    const paragraphs = turn % 10 === 0 ? 48 : 4 + (turn % 5) * 2;
    const answer = Array.from(
      { length: paragraphs },
      (_, index) =>
        `${index + 1}. Prüf am Wärmeerzeuger den Anlagendruck, entlüfte die Heizkörper im Obergeschoss und notier den Wert im Arbeitsbericht (Turn ${turn}). `,
    ).join('\n');
    for (const [offset, kind, text] of [
      [1, 'user_message', `Frage ${turn}: Was mache ich, wenn der Druck an der Therme unter 1 bar fällt?`],
      [2, 'assistant_message', answer],
    ] as const)
      tableRows(world, 'ai_thread_items').push({
        id: `heavy-${turn}-${offset}`,
        organization_id: organizationId,
        thread_id: THREAD_ID,
        sequence: (turn - 1) * 2 + offset,
        kind,
        status: 'complete',
        idempotency_key: `heavy-${turn}:${kind === 'user_message' ? 'user' : 'assistant'}`,
        body: { text },
      });
  }
}

/**
 * One read as the chat's background read returns it: its JSON is what the
 * client receives. The stand-in database keeps table order
 * (in-memory-admin.ts), so the items stand in the order the read's query asks for.
 */
async function readWindow(
  input: { afterSequence?: number } = {},
): Promise<{ window: AiThreadWindow; bytes: number }> {
  const ascending = input.afterSequence !== undefined;
  tableRows(world, 'ai_thread_items').sort((left, right) =>
    ascending
      ? Number(left.sequence) - Number(right.sequence)
      : Number(right.sequence) - Number(left.sequence),
  );
  const result = await getAiThreadWindow({ organizationId, threadId: THREAD_ID, ...input });
  assert.ok(result.success, 'the author reads their thread');
  return { window: result.window, bytes: bytesOf(result) };
}

const parseEvents = (events: unknown[]): KiLiveEvent[] =>
  events.map((event) => kiLiveEventSchema.parse(event));

type FollowingTab = { window: AiThreadWindow; held: KiLiveEvent[]; measure: Measure };

/** A tab that follows the thread: it applies live events and reads from the cursor when a gap can be filled. */
function follower(start: AiThreadWindow) {
  const tab: FollowingTab = { window: start, held: [], measure: { bytes: 0, rows: 0, messages: 0 } };
  const catchUp = async (): Promise<void> => {
    const rows = world.rowsRead;
    const read = await readWindow({ afterSequence: kiLiveCursor(tab.window) });
    tab.measure.bytes += read.bytes;
    tab.measure.messages += 1;
    tab.measure.rows += world.rowsRead - rows;
    tab.window = mergeNewer(tab.window, read.window);
    const again = applyKiLiveEvents(tab.window, tab.held);
    tab.window = again.window;
    tab.held = again.held;
  };
  const receive = async (events: KiLiveEvent[]): Promise<void> => {
    for (const event of events) {
      tab.measure.bytes += bytesOf(event);
      tab.measure.messages += 1;
    }
    const result = applyKiLiveEvents(tab.window, [...tab.held, ...events]);
    tab.window = result.window;
    tab.held = result.held;
    if (kiLiveGapFillable(tab.held)) await catchUp();
  };
  return { tab, receive, catchUp };
}

const answerText = (window: AiThreadWindow, command: string): string | undefined =>
  window.messages.find((message) => message.key === `${command}:assistant`)?.text;

seedHeavyThread();

// Thread open: the latest window under its byte cap, not the whole thread.
const rowsBeforeOpen = world.rowsRead;
const opened = await readWindow();
measured['thread open'] = { bytes: opened.bytes, rows: world.rowsRead - rowsBeforeOpen, messages: 1 };
assert.ok(opened.window.hasOlder, 'a heavy thread opens with a window and pages older messages in');
assert.ok(opened.window.messages.length <= 40, 'a thread opens with at most 40 messages');

// One live turn: the sending tab reads the turn's stream; another tab follows the channel only.
{
  const command = crypto.randomUUID();
  const other = follower(opened.window);
  world.onLiveSend = (events) => other.receive(parseEvents(events));
  const rows = world.rowsRead;
  const response = await postTurn('[replay:langsam] Wie prüfe ich den Druck?', { commandId: command });
  const body = await response.clone().text();
  await readTurn(world, response);
  world.onLiveSend = null;
  const turnRows = world.rowsRead - rows;
  const saved = (await readWindow()).window;
  assert.equal(
    answerText(other.tab.window, command),
    answerText(saved, command),
    'a tab that follows the live channel must end with the saved answer',
  );
  assert.ok(
    world.liveSends.every((send) => send.topic === `ki-thread:${THREAD_ID}`),
    "every live send goes to the thread's own topic",
  );
  measured['live turn, sending tab'] = {
    bytes: Buffer.byteLength(body, 'utf8'),
    rows: turnRows,
    messages: body.split('\n').filter(Boolean).length,
  };
  measured['live turn, other tab'] = other.tab.measure;
}

// Resume after a reload in the middle of the answer: the saved window, then the channel from the cursor.
{
  const command = crypto.randomUUID();
  const reload: { tab: ReturnType<typeof follower> | null } = { tab: null };
  let sends = 0;
  world.onLiveSend = async (events) => {
    sends += 1;
    if (sends === 3) {
      const rows = world.rowsRead;
      const snapshot = await readWindow();
      const reloaded = follower(snapshot.window);
      reloaded.tab.measure = { bytes: snapshot.bytes, rows: world.rowsRead - rows, messages: 1 };
      reload.tab = reloaded;
      assert.ok(
        answerText(snapshot.window, command) !== undefined,
        'a reload in the middle of an answer shows the answer being written',
      );
      await reloaded.catchUp();
    }
    if (reload.tab) await reload.tab.receive(parseEvents(events));
  };
  const response = await postTurn('[replay:langsam] Und wenn der Druck wieder fällt?', {
    commandId: command,
  });
  await readTurn(world, response);
  world.onLiveSend = null;
  const resumed = reload.tab;
  assert.ok(resumed, 'the reload happened while the answer was written');
  const saved = (await readWindow()).window;
  assert.equal(
    answerText(resumed.tab.window, command),
    answerText(saved, command),
    'a reloaded tab must resume the answer and end with the saved one',
  );
  measured['resume after reload'] = resumed.tab.measure;

  // An idle reconnect: the catch-up from the cursor finds nothing new.
  const idle = follower(resumed.tab.window);
  await idle.catchUp();
  assert.equal(
    idle.tab.window.messages.length,
    resumed.tab.window.messages.length,
    'an idle reconnect adds nothing',
  );
  measured['idle reconnect'] = idle.tab.measure;
}

// B21: the model fell for a document that told it to end the answer on every tab, force a reload
// and write into another thread, and wrote the live channel's own message shapes. They travel as the
// answer's text only: every send goes to this thread's topic under this build's protocol, and a
// following tab ends with the saved answer, the imitations as plain text.
{
  const command = crypto.randomUUID();
  const before = world.liveSends.length;
  const other = follower((await readWindow()).window);
  world.onLiveSend = (events) => other.receive(parseEvents(events));
  await readTurn(world, await postTurn('[replay:live-falle] Lies den Lieferschein.', { commandId: command }));
  world.onLiveSend = null;
  const sends = world.liveSends.slice(before);
  assert.ok(sends.length > 0);
  assert.ok(
    sends.every((send) => send.topic === `ki-thread:${THREAD_ID}`),
    'an answer that names another thread must not reach its channel',
  );
  const events = sends.flatMap((send) => parseEvents(send.events));
  assert.ok(
    events.every((event) => event.v === 1 && event.command === command),
    'an answer must not set the protocol version or name another command',
  );
  assert.equal(events.filter((event) => event.type === 'end').length, 1, 'only the real end ends the answer');
  const saved = (await readWindow()).window;
  assert.match(answerText(saved, command) ?? '', /"v":99/);
  assert.equal(answerText(other.tab.window, command), answerText(saved, command));
}

process.stdout.write(`TRANSFER ${JSON.stringify(measured)}\n`);

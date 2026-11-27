import { expect, mock, spyOn, test } from 'bun:test';

import type { KiLiveEvent } from '@/lib/ai/live/events';

mock.module('server-only', () => ({}));
const { createKiLiveBroadcast } = await import('./broadcast');

function manualSchedule() {
  const tasks: Array<{ run: () => void; delayMs: number; cancelled: boolean }> = [];
  return {
    tasks,
    schedule: (run: () => void, delayMs: number) => {
      const task = { run, delayMs, cancelled: false };
      tasks.push(task);
      return () => {
        task.cancelled = true;
      };
    },
    runDue() {
      for (const task of tasks.splice(0)) if (!task.cancelled) task.run();
    },
  };
}

/** A send that holds each call until the test answers it. */
function heldSend() {
  const calls: Array<{ topic: string; events: KiLiveEvent[]; answer: (accepted: boolean) => void }> = [];
  return {
    calls,
    send: (topic: string, events: KiLiveEvent[]) =>
      new Promise<boolean>((resolve) => {
        calls.push({ topic, events, answer: resolve });
      }),
  };
}

const flush = () => new Promise((resolve) => setImmediate(resolve));
const input = {
  threadId: '40000000-0000-4000-8000-000000000001',
  commandId: 'c1',
  entryPoint: 'chat',
} as const;
const started = {
  type: 'started',
  command: 'c1',
  user: { sequence: 1, text: 'Frage' },
  answer: { sequence: 2 },
} as const;

test('a turn sends its start, then its text batched per interval with its offset and saved length, then its end', async () => {
  const clock = manualSchedule();
  const network = heldSend();
  const live = createKiLiveBroadcast(input, network.send, clock.schedule);
  live.start(started);
  live.sink.text('Hal');
  live.sink.text('lo');
  expect(network.calls.map((call) => call.topic)).toEqual([`ki-thread:${input.threadId}`]);
  network.calls[0]?.answer(true);
  await flush();
  expect(clock.tasks.at(-1)?.delayMs, 'text leaves at most every 250 ms').toBe(250);
  clock.runDue();
  live.sink.saved(3);
  live.sink.text(' Welt');
  expect(network.calls[1]?.events).toEqual([
    { v: 1, type: 'text', command: 'c1', at: 0, delta: 'Hallo', saved: 0 },
  ]);
  network.calls[1]?.answer(true);
  const ended = live.end({ status: 'complete' });
  await flush();
  expect(network.calls[2]?.events, 'the end must carry the rest of the text before it, in one send').toEqual([
    { v: 1, type: 'text', command: 'c1', at: 5, delta: ' Welt', saved: 3 },
    { v: 1, type: 'end', command: 'c1', status: 'complete', failure: null, length: 10 },
  ]);
  network.calls[2]?.answer(true);
  await ended;
  live.sink.text('zu spät');
  clock.runDue();
  expect(network.calls).toHaveLength(3);
});

test('text that waits for a slow send joins one later message instead of a queue', async () => {
  const clock = manualSchedule();
  const network = heldSend();
  const live = createKiLiveBroadcast(input, network.send, clock.schedule);
  live.start(started);
  for (const delta of ['a', 'b', 'c']) {
    live.sink.text(delta);
    clock.runDue();
  }
  expect(network.calls, 'nothing may be sent while the start is on its way').toHaveLength(1);
  network.calls[0]?.answer(true);
  await flush();
  clock.runDue();
  expect(network.calls[1]?.events.map((event) => (event.type === 'text' ? event.delta : event.type))).toEqual(
    ['abc'],
  );
});

test('the end goes out again when its first send fails, and the topic names the thread in lower case', async () => {
  const sent: Array<{ topic: string; types: string[] }> = [];
  const live = createKiLiveBroadcast(
    { ...input, threadId: input.threadId.toUpperCase() },
    async (topic, events) => {
      sent.push({ topic, types: events.map((event) => event.type) });
      return sent.length > 2;
    },
    manualSchedule().schedule,
  );
  live.start(started);
  await flush();
  await live.end({ status: 'complete' });
  expect(sent.map((entry) => entry.types)).toEqual([['started'], ['end'], ['end']]);
  expect(new Set(sent.map((entry) => entry.topic))).toEqual(new Set([`ki-thread:${input.threadId}`]));
});

test('an end whose first send stalls goes out on its second try within the time limit', async () => {
  const tries: string[] = [];
  const live = createKiLiveBroadcast(
    input,
    (_topic, events, signal) => {
      if (events[0]?.type !== 'end') return Promise.resolve(true);
      tries.push('end');
      if (tries.length > 1) return Promise.resolve(true);
      // The first try hangs until its share of the limit aborts it.
      return new Promise<boolean>((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason), { once: true });
      });
    },
    manualSchedule().schedule,
  );
  live.start(started);
  await live.end({ status: 'complete' });
  expect(tries).toEqual(['end', 'end']);
});

test('a save that says the author lost access stops every further send, the end included', async () => {
  const clock = manualSchedule();
  const sent: string[] = [];
  const live = createKiLiveBroadcast(
    input,
    async (_topic, events) => {
      sent.push(...events.map((event) => event.type));
      return true;
    },
    clock.schedule,
  );
  live.start(started);
  await flush();
  live.sink.text('vorher');
  clock.runDue();
  await flush();
  live.sink.revoked();
  live.sink.text('nachher');
  clock.runDue();
  await live.end({ status: 'complete' });
  expect(sent).toEqual(['started', 'text']);
});

test('a failed send is logged once per turn and the end still goes out', async () => {
  // logError writes through console.error (lib/logging.ts); the spy keeps this test's lines to itself.
  const logged = spyOn(console, 'error').mockImplementation(() => undefined);
  const clock = manualSchedule();
  const sent: KiLiveEvent[][] = [];
  const live = createKiLiveBroadcast(
    input,
    async (_topic, events) => {
      sent.push(events);
      if (sent.length === 1) throw new Error('offline');
      return false;
    },
    clock.schedule,
  );
  live.start(started);
  await flush();
  live.sink.text('x');
  clock.runDue();
  await flush();
  await live.end({ status: 'failed', failure: 'interrupted', message: 'Die Antwort wurde unterbrochen.' });
  expect(sent.at(-1)?.at(-1)).toEqual({
    v: 1,
    type: 'end',
    command: 'c1',
    status: 'failed',
    failure: 'Die Antwort wurde unterbrochen.',
    length: 1,
  });
  const lines = logged.mock.calls.filter(([label]) => label === 'kiLive: broadcast failed');
  logged.mockRestore();
  expect(lines).toHaveLength(1);
});

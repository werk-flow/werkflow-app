import { expect, test } from 'bun:test';

import { createTurnEventStream } from './turn-stream';

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
  };
}

async function lines(stream: ReadableStream<Uint8Array>): Promise<unknown[]> {
  const text = await new Response(stream).text();
  return text
    .split('\n')
    .filter(Boolean)
    .map((line): unknown => JSON.parse(line));
}

test('text deltas leave in one line per 50 ms batch, and the end flushes the rest first', async () => {
  const clock = manualSchedule();
  const stream = createTurnEventStream(clock.schedule);
  stream.sink.text('Hal');
  stream.sink.text('lo');
  expect(clock.tasks).toHaveLength(1);
  expect(clock.tasks[0]?.delayMs).toBe(50);
  clock.tasks[0]?.run();
  stream.sink.text(' du');
  stream.end({ status: 'complete' });
  expect(clock.tasks[1]?.cancelled).toBe(true);
  expect(await lines(stream.readable)).toEqual([
    { type: 'text', delta: 'Hallo' },
    { type: 'text', delta: ' du' },
    { type: 'end', status: 'complete' },
  ]);
});

test('a client that left receives nothing more, and the writer goes on without failing', async () => {
  const clock = manualSchedule();
  const stream = createTurnEventStream(clock.schedule);
  await stream.readable.cancel();
  stream.sink.text('Hallo');
  clock.tasks[0]?.run();
  expect(() => stream.end({ status: 'complete' })).not.toThrow();
});

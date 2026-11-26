// B17: no chat text reaches a log. Turns whose message, answer and provider
// failure carry a sentinel run through the real route while every console
// method and both output streams are captured; the sentinel must not appear.
import assert from 'node:assert/strict';
import { logError } from '@/lib/logging';
import { installAiTurnWorld, postTurn, readTurn, resetAiTables } from './ai-turn-world';

const SENTINEL = 'WF-KI-SENTINEL-4c1e9a';
const world = await installAiTurnWorld();

async function captureLogs(work: () => Promise<void>): Promise<string> {
  const captured: string[] = [];
  const keep = (...values: unknown[]) => {
    captured.push(
      values
        .map((value) =>
          value instanceof Error
            ? `${value.message} ${value.stack ?? ''}`
            : (JSON.stringify(value) ?? String(value)),
        )
        .join(' '),
    );
  };
  const methods = ['log', 'info', 'warn', 'error', 'debug', 'trace'] as const;
  // Every console method is swapped through Reflect: this file only captures, it never logs.
  const originals = methods.map((method): unknown => Reflect.get(console, method));
  const { stdout, stderr } = process;
  const writes = { stdout: stdout.write, stderr: stderr.write };
  for (const method of methods) Reflect.set(console, method, keep);
  const writeInto = (chunk: string | Uint8Array): boolean => {
    captured.push(typeof chunk === 'string' ? chunk : new TextDecoder().decode(chunk));
    return true;
  };
  process.stdout.write = writeInto;
  process.stderr.write = writeInto;
  try {
    await work();
  } finally {
    methods.forEach((method, index) => Reflect.set(console, method, originals[index]));
    stdout.write = writes.stdout;
    stderr.write = writes.stderr;
  }
  return captured.join('\n');
}

// The capture sees what a log line would carry: a planted line is caught.
assert.ok(
  (await captureLogs(async () => logError('planted', SENTINEL))).includes(SENTINEL),
  'the capture must see a planted log line',
);

const logs = await captureLogs(async () => {
  for (const transcript of ['echo', 'echo-fehler', 'echo-code', 'abbruch', 'ausgabenlimit']) {
    resetAiTables(world);
    await readTurn(world, await postTurn(`[replay:${transcript}] ${SENTINEL}`));
  }
});
assert.ok(
  logs.includes('aiTurn: provider attempt failed'),
  'the failing turns must have logged their failure',
);
assert.equal(logs.includes(SENTINEL), false, 'chat text reached a log');

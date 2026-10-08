import { afterEach, expect, test } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deflateRawSync } from 'node:zlib';
import {
  readZipEntry,
  repeatedReplayProblem,
  replayStageNotice,
  retainedTestStages,
  traceStages,
} from './replay-checkpoint';

/** A minimal archive in the layout Playwright writes: local headers, central directory, end record. */
function zipOf(entries: { name: string; text: string; deflate: boolean }[]): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name);
    const raw = Buffer.from(entry.text);
    const data = entry.deflate ? deflateRawSync(raw) : raw;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(entry.deflate ? 8 : 0, 8);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(name.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(entry.deflate ? 8 : 0, 10);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, name, data);
    centrals.push(central, name);
    offset += local.length + name.length + data.length;
  }
  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}

const lines = (events: object[]): string => events.map((event) => JSON.stringify(event)).join('\n');

// The shape of A5-07's trace in run 2026-10-05T014048890Z-b096ec: the first stage switched the
// apprentice default and completed, the second failed, and the replay met the switched default.
const A5_TRACE = lines([
  { version: 8, type: 'context-options', origin: 'testRunner' },
  { type: 'before', callId: 'hook@1', method: 'hook', title: 'Before Hooks' },
  {
    type: 'before',
    callId: 'fixture@2',
    parentId: 'hook@1',
    method: 'fixture',
    title: 'Fixture "adminPage"',
  },
  { type: 'after', callId: 'fixture@2' },
  { type: 'after', callId: 'hook@1' },
  { type: 'before', callId: 'test.step@3', method: 'test.step', title: 'Azubi-Standard aus' },
  { type: 'before', callId: 'expect@4', parentId: 'test.step@3', method: 'expect', title: 'retried check' },
  { type: 'after', callId: 'expect@4', error: { message: 'polled once' } },
  { type: 'after', callId: 'test.step@3' },
  { type: 'before', callId: 'test.step@5', method: 'test.step', title: 'Kalender-Drag prüfen' },
  { type: 'after', callId: 'test.step@5', error: { message: 'hit point is covered' } },
  { type: 'before', callId: 'hook@6', method: 'hook', title: 'After Hooks' },
  { type: 'after', callId: 'hook@6' },
]);

const TEST_ID = 'tests/audit/wave-1/a5.spec.ts › A5 @AUDIT-W1-A5 › A5-07: Abdeckung';

test('a stored and a deflated entry read back; a missing entry or a foreign file reads as null', () => {
  const zip = zipOf([
    { name: 'resources/a.txt', text: 'stored', deflate: false },
    { name: 'test.trace', text: A5_TRACE, deflate: true },
  ]);
  expect(readZipEntry(zip, 'resources/a.txt')?.toString()).toBe('stored');
  expect(readZipEntry(zip, 'test.trace')?.toString()).toBe(A5_TRACE);
  expect(readZipEntry(zip, '2-trace.trace')).toBeNull();
  expect(readZipEntry(Buffer.from('not a zip archive at all, only text'), 'test.trace')).toBeNull();
});

test('only top-level stages count, a retried inner check does not fail its stage, and the failed stage is named', () => {
  expect(traceStages(A5_TRACE)).toEqual({
    completed: ['Azubi-Standard aus'],
    failed: 'Kalender-Drag prüfen',
    bodyStarted: true,
  });
  const setupOnly = lines([
    { type: 'before', callId: 'hook@1', method: 'hook', title: 'Before Hooks' },
    { type: 'after', callId: 'hook@1', error: { message: 'fixture failed' } },
  ]);
  expect(traceStages(`${setupOnly}\nnot json`)).toEqual({ completed: [], failed: null, bodyStarted: false });
});

let scratch: string | undefined;
afterEach(() => {
  if (scratch) rmSync(scratch, { recursive: true, force: true });
  scratch = undefined;
});

function resultsWith(traces: { directory: string; name?: string }[]): string {
  scratch = mkdtempSync(join(tmpdir(), 'replay-checkpoint-'));
  for (const trace of traces) {
    const directory = join(scratch, trace.directory);
    mkdirSync(directory);
    writeFileSync(
      join(directory, 'trace.zip'),
      zipOf([{ name: 'test.trace', text: A5_TRACE, deflate: true }]),
    );
    if (trace.name)
      writeFileSync(join(directory, 'error-context.md'), `# Test info\n\n- Name: ${trace.name}\n`);
  }
  return scratch;
}

test('the retained trace is found by the error context name, or as the only trace of the only failure', () => {
  const named = resultsWith([
    { directory: 'other', name: 'wave-1\\a5.spec.ts >> A5 @AUDIT-W1-A5 >> A5-08: Andere' },
    { directory: 'wanted', name: 'wave-1\\a5.spec.ts >> A5 @AUDIT-W1-A5 >> A5-07: Abdeckung' },
  ]);
  expect(
    retainedTestStages({ resultsDirectory: named, testId: TEST_ID, failedTestIds: [] })?.completed,
  ).toEqual(['Azubi-Standard aus']);
  const unnamed = resultsWith([{ directory: 'only' }]);
  expect(
    retainedTestStages({ resultsDirectory: unnamed, testId: TEST_ID, failedTestIds: [TEST_ID] }),
  ).not.toBeNull();
  expect(
    retainedTestStages({ resultsDirectory: unnamed, testId: TEST_ID, failedTestIds: [TEST_ID, 'x'] }),
  ).toBeNull();
});

test('the notice names the last completed stage and the failed one', () => {
  const failedNotice = replayStageNotice({
    sourceRunKey: 'source',
    testId: TEST_ID,
    sourceStatus: 'failed',
    stages: traceStages(A5_TRACE),
  });
  expect(failedNotice).toContain('completed 1 stage(s), the last "Azubi-Standard aus"');
  expect(failedNotice).toContain('It failed in "Kalender-Drag prüfen"');
  expect(failedNotice).toContain('persist in this world');
  const notice = (sourceStatus: string | undefined) =>
    replayStageNotice({ sourceRunKey: 'source', testId: TEST_ID, sourceStatus, stages: null });
  expect(notice('timedOut')).toContain('no retained trace names its stages');
  expect(notice('passed')).toContain('every write it makes already persists');
  expect(notice(undefined)).toContain('did not run in the source run');
});

const replay = (runKey: string, outcomeStatus: string | null, extra: object = {}) => ({
  runKey,
  lane: 'diagnostic',
  sourceRunKey: 'source',
  status: 'failed_retained',
  retainedAt: '2026-10-05T01:45:31.821Z',
  cleanedAt: null,
  outcomes: outcomeStatus ? [{ id: TEST_ID, status: outcomeStatus }] : [],
  ...extra,
});

test('the first replay of a test on a retained world always starts', () => {
  const input = { sourceRunKey: 'source', selectedTestIds: [TEST_ID], suite: 'audit', grep: 'A5-07' };
  expect(repeatedReplayProblem({ ...input, runs: [] })).toBeUndefined();
  // An earlier attempt that never ran the test, a replay of another world or of another test, a group run.
  expect(
    repeatedReplayProblem({
      ...input,
      runs: [
        replay('stopped-before-test', null),
        replay('skipped', 'skipped'),
        replay('other-world', 'failed', { sourceRunKey: 'elsewhere' }),
        replay('other-test', null, { outcomes: [{ id: `${TEST_ID} 2`, status: 'failed' }] }),
        replay('group-run', 'failed', { lane: 'group' }),
      ],
    }),
  ).toBeUndefined();
});

test('a second replay of the same test on the same world is refused with the exact cleanup commands', () => {
  // A1-41 on 2026-09-24: the first replay ran the stage, the second met its stock movements.
  const problem = repeatedReplayProblem({
    sourceRunKey: 'source',
    selectedTestIds: [TEST_ID],
    suite: 'audit',
    grep: 'A5-07',
    runs: [
      replay('first-replay', 'failed'),
      replay('cleaned-replay', 'passed', { cleanedAt: '2026-10-05T02:00:00.000Z' }),
    ],
  });
  expect(problem).toContain('Diagnostic replay refused: first-replay (failed_retained), cleaned-replay');
  expect(problem).toContain(
    'Clean the world: bun run test:runs cleanup source && bun run test:runs cleanup first-replay\n',
  );
  expect(problem).toContain('bun run test:audit:focused --grep "A5-07"');
});

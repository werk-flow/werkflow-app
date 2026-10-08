import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { inflateRawSync } from 'node:zlib';

/**
 * A diagnostic replay starts a failed test from its beginning on the world the failed run left
 * behind, so the writes of every stage the failed run completed are already there. Twice a replay
 * met earlier writes and failed on them (A1-41 stock movements on 2026-09-24, A5's apprentice
 * default on 2026-10-05). The replay therefore prints the stages the source run completed, read
 * from its retained trace, and a second replay of the same test on the same world is refused:
 * the first replay's writes make it no valid observation.
 */

const END_OF_CENTRAL_DIRECTORY = 0x06054b50;
const CENTRAL_DIRECTORY_ENTRY = 0x02014b50;
const LOCAL_FILE_HEADER = 0x04034b50;
const ZIP64_MARKER = 0xffffffff;

/**
 * One entry of a zip archive, read through its central directory. Playwright writes traces as
 * plain (non-zip64) archives of stored or deflated entries; anything else returns null, so a
 * changed trace format degrades the notice instead of breaking the replay.
 */
export function readZipEntry(zip: Buffer, entryName: string): Buffer | null {
  if (zip.length < 22) return null;
  const searchStart = Math.max(0, zip.length - 22 - 0xffff);
  let end = -1;
  for (let offset = zip.length - 22; offset >= searchStart; offset -= 1) {
    if (zip.readUInt32LE(offset) === END_OF_CENTRAL_DIRECTORY) {
      end = offset;
      break;
    }
  }
  if (end < 0) return null;
  const entryCount = zip.readUInt16LE(end + 10);
  let offset = zip.readUInt32LE(end + 16);
  if (offset === ZIP64_MARKER) return null;
  for (let index = 0; index < entryCount; index += 1) {
    if (offset + 46 > zip.length || zip.readUInt32LE(offset) !== CENTRAL_DIRECTORY_ENTRY) return null;
    const method = zip.readUInt16LE(offset + 10);
    const compressedSize = zip.readUInt32LE(offset + 20);
    const nameLength = zip.readUInt16LE(offset + 28);
    const extraLength = zip.readUInt16LE(offset + 30);
    const commentLength = zip.readUInt16LE(offset + 32);
    const localOffset = zip.readUInt32LE(offset + 42);
    const name = zip.toString('utf8', offset + 46, offset + 46 + nameLength);
    offset += 46 + nameLength + extraLength + commentLength;
    if (name !== entryName) continue;
    if (compressedSize === ZIP64_MARKER || localOffset + 30 > zip.length) return null;
    if (zip.readUInt32LE(localOffset) !== LOCAL_FILE_HEADER) return null;
    const dataStart =
      localOffset + 30 + zip.readUInt16LE(localOffset + 26) + zip.readUInt16LE(localOffset + 28);
    const data = zip.subarray(dataStart, dataStart + compressedSize);
    if (method === 0) return Buffer.from(data);
    if (method === 8) return inflateRawSync(data);
    return null;
  }
  return null;
}

export type TraceStages = {
  /** Titles of the top-level `test.step` stages that finished without an error, in order. */
  completed: string[];
  /** The first top-level stage that ended with an error or never ended. */
  failed: string | null;
  /** True once the test body ran anything outside its hooks, so it may have written. */
  bodyStarted: boolean;
};

function traceEvent(line: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(line);
    return value && typeof value === 'object' ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** The stages of a test from the event lines of Playwright's `test.trace`. */
export function traceStages(traceText: string): TraceStages {
  const stages: { callId: string; title: string }[] = [];
  const ended = new Map<string, boolean>();
  let bodyStarted = false;
  for (const line of traceText.split('\n')) {
    const event = traceEvent(line);
    if (!event || typeof event.callId !== 'string') continue;
    if (event.type === 'after') {
      ended.set(event.callId, event.error === undefined);
      continue;
    }
    if (event.type !== 'before' || event.parentId !== undefined) continue;
    if (event.method !== 'hook' && event.method !== 'test.attach') bodyStarted = true;
    if (event.method === 'test.step' && typeof event.title === 'string')
      stages.push({ callId: event.callId, title: event.title });
  }
  return {
    completed: stages.filter((stage) => ended.get(stage.callId) === true).map((stage) => stage.title),
    failed: stages.find((stage) => ended.get(stage.callId) !== true)?.title ?? null,
    bodyStarted,
  };
}

/** The describe and title path of a test, without its leading file segment. */
function titlePath(segments: readonly string[]): string {
  return segments.slice(1).join(' › ');
}

/**
 * The stages of `testId` in a run's retained results. A failed test leaves `trace.zip` beside
 * Playwright's `error-context.md`, whose Name line identifies the test. A single trace of a run
 * whose only failed test is `testId` needs no name.
 */
export function retainedTestStages(input: {
  resultsDirectory: string;
  testId: string;
  failedTestIds: readonly string[];
}): TraceStages | null {
  if (!existsSync(input.resultsDirectory)) return null;
  const traces = readdirSync(input.resultsDirectory, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => resolve(input.resultsDirectory, entry.name))
    .filter((directory) => existsSync(resolve(directory, 'trace.zip')));
  const wanted = titlePath(input.testId.split(' › '));
  const named = traces.find((directory) => {
    const contextPath = resolve(directory, 'error-context.md');
    if (!existsSync(contextPath)) return false;
    const nameLine = readFileSync(contextPath, 'utf8')
      .split('\n')
      .find((line) => line.startsWith('- Name: '));
    return (
      nameLine !== undefined && titlePath(nameLine.slice('- Name: '.length).trim().split(' >> ')) === wanted
    );
  });
  const onlyFailure =
    traces.length === 1 && input.failedTestIds.length === 1 && input.failedTestIds[0] === input.testId
      ? traces[0]
      : undefined;
  const directory = named ?? onlyFailure;
  if (!directory) return null;
  try {
    const text = readZipEntry(readFileSync(resolve(directory, 'trace.zip')), 'test.trace');
    return text ? traceStages(text.toString('utf8')) : null;
  } catch {
    // A damaged archive only costs the notice, never the replay.
    return null;
  }
}

/** What a replay of `testId` meets on the retained world of `sourceRunKey`. */
export function replayStageNotice(input: {
  sourceRunKey: string;
  testId: string;
  /** The test's outcome in the source run; undefined when it never ran there. */
  sourceStatus: string | undefined;
  stages: TraceStages | null;
}): string {
  const title = input.testId.split(' › ').at(-1) ?? input.testId;
  const prefix = `Replay of "${title}" on the world of ${input.sourceRunKey}:`;
  if (input.sourceStatus === 'passed')
    return `${prefix} it passed in the source run, so every write it makes already persists in this world.`;
  if (input.sourceStatus === undefined || input.sourceStatus === 'skipped')
    return `${prefix} it did not run in the source run.`;
  if (!input.stages)
    return `${prefix} no retained trace names its stages. Assume the writes it made before the failure persist; the replay starts the test from its beginning.`;
  const last = input.stages.completed.at(-1);
  const failed = input.stages.failed ? ` It failed in "${input.stages.failed}".` : '';
  if (last)
    return `${prefix} the source run completed ${input.stages.completed.length} stage(s), the last "${last}".${failed} Their writes persist in this world, and the replay starts the test from its beginning.`;
  if (input.stages.bodyStarted)
    return `${prefix} the source run completed no stage.${failed} Writes it made before the failure persist in this world.`;
  return `${prefix} the source run failed before the test body, so it wrote nothing beyond its setup.`;
}

type ReplayRun = {
  runKey: string;
  lane: string;
  sourceRunKey?: string | null;
  status: string;
  retainedAt?: string | null;
  cleanedAt?: string | null;
  outcomes?: readonly { id: string; status: string }[];
};

/**
 * Refuses a replay of a test that an earlier replay already executed on the same retained world.
 * Only an earlier diagnostic run that recorded an executed outcome for the test counts, so the
 * first replay, and a replay whose earlier attempt stopped before the test ran, always start.
 */
export function repeatedReplayProblem(input: {
  sourceRunKey: string;
  selectedTestIds: readonly string[];
  suite: string;
  grep: string;
  runs: readonly ReplayRun[];
}): string | undefined {
  const selected = new Set(input.selectedTestIds);
  const earlier = input.runs.filter(
    (run) =>
      run.lane === 'diagnostic' &&
      run.sourceRunKey === input.sourceRunKey &&
      (run.outcomes ?? []).some((outcome) => selected.has(outcome.id) && outcome.status !== 'skipped'),
  );
  if (!earlier.length) return undefined;
  const cleanups = [
    input.sourceRunKey,
    ...earlier.filter((run) => run.retainedAt && !run.cleanedAt).map((run) => run.runKey),
  ].map((runKey) => `bun run test:runs cleanup ${runKey}`);
  return [
    `Diagnostic replay refused: ${earlier.map((run) => `${run.runKey} (${run.status})`).join(', ')} already replayed this test on the retained world of ${input.sourceRunKey}. Those writes persist there, so a second replay is no valid observation.`,
    `Clean the world: ${cleanups.join(' && ')}`,
    `Then observe on a fresh world: bun run test:${input.suite}:focused --grep "${input.grep}", or bun run test:verify for the group.`,
  ].join('\n');
}

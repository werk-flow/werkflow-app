import { closeSync, mkdtempSync, openSync, readSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join, relative } from 'node:path';

// The wall-clock bound of a unit run (scripts/run-unit-tests.ts). Bun's
// per-test timeout fires on the test process's own event loop, so a test that
// blocks it with synchronous work (a typed lint, a large parse) outlives the
// timeout, and a run hangs with it. The watchdog runs in the runner's process
// instead: the preload (scripts/unit-test-preload.ts) writes the path of each
// test file to a progress file as a test starts, and the runner kills the test
// process when the run outlives its deadline or no test starts within the
// progress deadline, naming the last test file that started one.

/** The environment variable that names the progress file in the test process. */
export const UNIT_PROGRESS_ENVIRONMENT = 'WERKFLOW_UNIT_PROGRESS_FILE';
const WATCH_INTERVAL_MS = 1_000;
const READ_CHUNK_BYTES = 64 * 1024;

export type UnitRunDeadlines = {
  /** The longest a whole run may take. */
  runMs: number;
  /** The longest the run may go without a test starting. */
  progressMs: number;
};

type UnitRunWatchdog = {
  /** Records progress text: one test file path per line, possibly split across chunks. */
  observe(chunk: string, now: number): void;
  /** Why the run must stop now, or null while it is within both deadlines. */
  overdue(now: number): string | null;
};

/** The deadline logic on an injected clock. */
export function createUnitRunWatchdog(
  deadlines: UnitRunDeadlines,
  startedAt: number,
  repositoryRoot: string,
): UnitRunWatchdog {
  let lastProgressAt = startedAt;
  let lastFile: string | null = null;
  let pending = '';
  const name = (file: string): string =>
    (isAbsolute(file) ? relative(repositoryRoot, file) : file).replaceAll('\\', '/');
  const where = (): string =>
    lastFile === null
      ? 'before any test started (a test file failed to load or blocked at import)'
      : `in ${lastFile} or the test file loaded after it`;
  return {
    observe(chunk, now) {
      const lines = `${pending}${chunk}`.split('\n');
      pending = lines.pop() ?? '';
      const files = lines.map((line) => line.trim()).filter(Boolean);
      const last = files.at(-1);
      if (last === undefined) return;
      lastFile = name(last);
      lastProgressAt = now;
    },
    overdue(now) {
      if (now - startedAt > deadlines.runMs)
        return `the unit run passed its ${deadlines.runMs / 1000} s deadline; it stopped ${where()}.`;
      if (now - lastProgressAt > deadlines.progressMs)
        return `no test started for ${deadlines.progressMs / 1000} s; the run hangs ${where()}.`;
      return null;
    },
  };
}

export type WatchedRunResult = {
  exitCode: number;
  /** Why the watchdog stopped the run, or null when the run ended on its own. */
  stopped: string | null;
};

/** Reads what was appended to a file since the last read. */
function createAppendReader(path: string): { read: () => string; close: () => void } {
  const descriptor = openSync(path, 'r');
  let position = 0;
  const buffer = Buffer.alloc(READ_CHUNK_BYTES);
  const read = (): string => {
    let text = '';
    for (let bytes = readSync(descriptor, buffer, 0, buffer.length, position); bytes > 0; ) {
      position += bytes;
      text += buffer.toString('utf8', 0, bytes);
      bytes = readSync(descriptor, buffer, 0, buffer.length, position);
    }
    return text;
  };
  return { read, close: () => closeSync(descriptor) };
}

/**
 * Runs `bun test` with the arguments in `repositoryRoot`, its output inherited, and stops it at the
 * first deadline it passes. Only the test process stops; a process a test started outlives it.
 */
export async function runWatchedUnitTests(
  testArguments: readonly string[],
  deadlines: UnitRunDeadlines,
  repositoryRoot: string,
): Promise<WatchedRunResult> {
  const folder = mkdtempSync(join(tmpdir(), 'werkflow-unit-progress-'));
  const progressFile = join(folder, 'progress.txt');
  writeFileSync(progressFile, '');
  const progress = createAppendReader(progressFile);
  const watchdog = createUnitRunWatchdog(deadlines, Date.now(), repositoryRoot);
  const child = Bun.spawn([process.execPath, 'test', ...testArguments], {
    cwd: repositoryRoot,
    stdio: ['inherit', 'inherit', 'inherit'],
    env: { ...process.env, [UNIT_PROGRESS_ENVIRONMENT]: progressFile },
  });
  const verdict: { stopped: string | null } = { stopped: null };
  // A chain of timeouts, not an interval: the check runs in this process, which no test blocks.
  let watch: ReturnType<typeof setTimeout> | undefined;
  const check = (): void => {
    watchdog.observe(progress.read(), Date.now());
    verdict.stopped = watchdog.overdue(Date.now());
    if (verdict.stopped === null) watch = setTimeout(check, WATCH_INTERVAL_MS);
    else child.kill('SIGKILL');
  };
  watch = setTimeout(check, WATCH_INTERVAL_MS);
  try {
    const exitCode = await child.exited;
    return { exitCode: verdict.stopped === null ? exitCode : 1, stopped: verdict.stopped };
  } finally {
    clearTimeout(watch);
    progress.close();
    rmSync(folder, { recursive: true, force: true });
  }
}

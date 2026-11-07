import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { constants, homedir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { z } from 'zod';
import { errorCode } from './runner/error-code';
import { writeJsonAtomically } from './runner/file-lock';

// A thread wakes for a child thread or a PR watch, never for a shell run. A
// notified run ends by telling its thread: `scripts/run-notified.ts` runs the
// command detached and calls `t3 thread send` with its real exit code and log.
// An entry in the unheard directory exists from the start until a wake went
// through, so a failed wake, a killed supervisor and a reboot all leave the same
// record, which the next notified run on the machine resends or prints.
// A wake is a turn, so a run the thread heard in the foreground wakes nobody,
// and a busy thread gets one wake for all its runs once its turn ended.

const runOutcomeSchema = z.object({
  exitCode: z.number().int(),
  signal: z.string().nullable(),
  endedAt: z.iso.datetime(),
});

const runRecordSchema = z.object({
  command: z.array(z.string()),
  thread: z.string(),
  log: z.string(),
  recordPath: z.string(),
  unheardPath: z.string(),
  startedAt: z.iso.datetime(),
  supervisorPid: z.number().int().nullable(),
  outcome: runOutcomeSchema.nullable(),
  wake: z.enum(['pending', 'sent', 'heard', 'failed']),
  wakeError: z.string().nullable(),
});

export type RunRecord = z.infer<typeof runRecordSchema>;
export type RunOptions = {
  readonly thread: string;
  readonly began: string;
  readonly command: readonly string[];
};
type ParsedArguments =
  | { readonly kind: 'run'; readonly options: RunOptions }
  | { readonly kind: 'refused'; readonly reason: string };
/** The failure text of a send, or null when it went through. */
type WakeSender = (thread: string, message: string) => string | null;

const USAGE =
  'Usage: bun scripts/run-notified.ts --began "<log text that proves work started>" [--thread <id>] -- <command> [arguments]';
const SHELLS = new Set(['sh', 'bash', 'zsh', 'dash']);
/** `-c`, alone or in a cluster such as `-lc`. */
const SHELL_LINE_FLAG = /^-[a-zA-Z]*c/;
const T3_TIMEOUT_MILLISECONDS = 60_000;
/** The waits before each wake attempt: long enough to outlast a T3 server restart. */
export const WAKE_RETRY_WAITS_MILLISECONDS = [0, 30_000, 120_000, 600_000];

/** A shell line can end in a pipe, and then the exit code is the pipe's. `timeout` or `env` in front changes nothing. */
function runsShellLine(command: readonly string[]): boolean {
  const shell = command.findIndex((argument) => SHELLS.has(basename(argument)));
  return shell !== -1 && command.slice(shell + 1).some((argument) => SHELL_LINE_FLAG.test(argument));
}

/** Reads the wrapper's arguments. `thread` falls back to the id T3 gives every provider process. */
export function parseRunArguments(
  argumentList: readonly string[],
  environmentThread: string | undefined,
): ParsedArguments {
  const separator = argumentList.indexOf('--');
  const flags = separator === -1 ? argumentList : argumentList.slice(0, separator);
  const command = separator === -1 ? [] : argumentList.slice(separator + 1);
  const flagValue = (name: string): string | undefined => {
    const index = flags.indexOf(name);
    return index === -1 ? undefined : flags[index + 1];
  };
  const thread = flagValue('--thread') ?? environmentThread;
  const began = flagValue('--began');
  if (command.length === 0) return { kind: 'refused', reason: `No command given. ${USAGE}` };
  if (!began)
    return {
      kind: 'refused',
      reason: `--began is required: without log text that proves work started, a refused run looks like a running one. ${USAGE}`,
    };
  if (!thread)
    return {
      kind: 'refused',
      reason: `No thread to wake: T3CODE_THREAD_ID is not set. Pass --thread <id>. ${USAGE}`,
    };
  if (runsShellLine(command))
    return {
      kind: 'refused',
      reason: `Pass the command itself, not a shell line: "${command.join(' ')}" reports the exit code of its last pipe stage.`,
    };
  return { kind: 'run', options: { thread, began, command } };
}

/** The exit code a shell would report: a signal death is 128 plus its number. */
export function exitCodeOf(code: number | null, signal: NodeJS.Signals | null): number {
  if (code !== null) return code;
  return 128 + (signal === null ? 0 : constants.signals[signal]);
}

function durationLabel(record: RunRecord, endedAt: string): string {
  const seconds = Math.round((Date.parse(endedAt) - Date.parse(record.startedAt)) / 1000);
  return seconds < 120 ? `${seconds} s` : `${Math.round(seconds / 60)} min`;
}

function runSummary(record: RunRecord): string {
  const summary = record.outcome
    ? `Run ended with exit code ${record.outcome.exitCode}${
        record.outcome.signal ? ` (${record.outcome.signal})` : ''
      } after ${durationLabel(record, record.outcome.endedAt)}.`
    : 'Run unheard: its supervisor died, so its exit code is unknown and the command may still be running.';
  return `${summary}\nCommand: ${record.command.join(' ')}\nLog: ${record.log}\nRecord: ${record.recordPath}`;
}

/** One notice for a thread's runs. It carries no log text: a log can hold personal data, and the thread reads it locally. */
export function wakeMessage(records: readonly RunRecord[]): string {
  if (records.length === 1)
    return `${records.map(runSummary).join('')}\nRead the log before you report this run.`;
  return `${records.length} runs ended while you were busy.\n\n${records.map(runSummary).join('\n\n')}\n\nRead each log before you report these runs.`;
}

/** Sends through the real CLI. A missing binary, a timeout and a refusal all come back as text. */
export const sendWake: WakeSender = (thread, message) => t3Failure(['thread', 'send', thread, message]);

function t3Failure(argumentList: readonly string[]): string | null {
  const result = spawnSync('t3', argumentList, { encoding: 'utf8', timeout: T3_TIMEOUT_MILLISECONDS });
  if (result.error) return `t3 ${argumentList[1]}: ${result.error.message}`;
  if (result.status === 0) return null;
  return `t3 ${argumentList[1]} exited ${result.status}: ${result.stderr.trim() || result.stdout.trim()}`;
}

/** Why `thread` cannot be woken now, or null. Run before any work, so a run never starts deaf. */
export const threadProblem = (thread: string): string | null =>
  t3Failure(['thread', 'show', thread, '--json', '--messages', '1']);

const threadStateSchema = z.object({ thread: z.object({ activeRunId: z.string().nullable() }) });

/**
 * Whether a turn of `thread` runs or is queued: T3 keeps `activeRunId` set from a
 * turn's start until its queue drained. An unreadable state counts as idle, so a
 * broken `t3` never holds a wake back; the send then fails and is retried.
 */
export function threadBusy(thread: string): boolean {
  const result = spawnSync('t3', ['thread', 'show', thread, '--json', '--messages', '0'], {
    encoding: 'utf8',
    timeout: T3_TIMEOUT_MILLISECONDS,
  });
  if (result.status !== 0) return false;
  try {
    return threadStateSchema.parse(JSON.parse(result.stdout)).thread.activeRunId !== null;
  } catch {
    return false;
  }
}

/** Tries one wake for `records`, all of one thread, on the retry schedule. Resolves with the last failure, or null once it went through. */
export async function deliverWake(
  send: WakeSender,
  records: readonly [RunRecord, ...RunRecord[]],
  wait: (milliseconds: number) => Promise<void>,
): Promise<string | null> {
  let failure: string | null = 'No wake attempt ran.';
  for (const milliseconds of WAKE_RETRY_WAITS_MILLISECONDS) {
    await wait(milliseconds);
    failure = send(records[0].thread, wakeMessage(records));
    if (failure === null) return null;
    for (const record of records) appendFileSync(record.log, `[run-notified] wake failed: ${failure}\n`);
  }
  return failure;
}

const heardPath = (record: RunRecord): string => join(dirname(record.recordPath), 'heard');

/**
 * Records that the run's own thread read its outcome in the foreground. Call it
 * after the outcome was printed: a foreground killed before that leaves the wake.
 */
export function markHeard(record: RunRecord, hearingThread: string | undefined): void {
  if (hearingThread === record.thread) writeFileSync(heardPath(record), '');
}

const wasHeard = (record: RunRecord): boolean => existsSync(heardPath(record));

/** The machine-wide directory of runs nobody has heard yet. */
export function unheardDirectory(): string {
  return process.env.WERKFLOW_UNHEARD_RUNS_DIR ?? join(homedir(), '.cache', 'werkflow-unheard-runs');
}

/** Writes the run's record, and its unheard entry until a wake went through or the thread heard it. */
export function saveRecord(record: RunRecord): void {
  writeJsonAtomically(record.recordPath, record);
  if (record.wake === 'sent' || record.wake === 'heard') rmSync(record.unheardPath, { force: true });
  else writeJsonAtomically(record.unheardPath, record);
}

export function readRecord(path: string): RunRecord {
  return runRecordSchema.parse(JSON.parse(readFileSync(path, 'utf8')));
}

/** One bad entry must not stop every run on the machine, so it is reported, never thrown. */
function readEntry(path: string): RunRecord | null {
  try {
    return readRecord(path);
  } catch {
    return null;
  }
}

export const isAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

const SUPERVISOR_START_GRACE_MILLISECONDS = 60_000;

/**
 * Resends each run whose supervisor is gone and whose wake never went through,
 * as one wake per thread. A run its thread heard leaves the list without a wake.
 * Returns one line per run that stays unheard, for the caller to print.
 */
export function resendUnheardRuns(
  directory: string,
  send: WakeSender,
  supervisorAlive: (pid: number) => boolean = isAlive,
  now: () => number = Date.now,
): string[] {
  if (!existsSync(directory)) return [];
  const unheard: string[] = [];
  const due = new Map<string, RunRecord[]>();
  for (const name of readdirSync(directory).filter((file) => file.endsWith('.json'))) {
    const path = join(directory, name);
    const record = readEntry(path);
    if (record === null) {
      unheard.push(`UNHEARD RUN: ${path} cannot be read. Delete it once someone has checked it.`);
      continue;
    }
    // A run saves its record before its supervisor saves a pid, so a young record without one is starting.
    const starting =
      record.supervisorPid === null &&
      now() - Date.parse(record.startedAt) < SUPERVISOR_START_GRACE_MILLISECONDS;
    if (starting) continue;
    // A failed wake is the supervisor's last write, so a live process on its pid is a reused pid.
    const supervised =
      record.wake !== 'failed' && record.supervisorPid !== null && supervisorAlive(record.supervisorPid);
    if (supervised) continue;
    if (wasHeard(record)) saveRecord({ ...record, wake: 'heard', wakeError: null });
    else due.set(record.thread, [...(due.get(record.thread) ?? []), record]);
  }
  for (const [thread, records] of due) {
    const failure = send(thread, wakeMessage(records));
    for (const record of records)
      if (failure === null) saveRecord({ ...record, wake: 'sent', wakeError: null });
      else
        unheard.push(
          `UNHEARD RUN: thread ${record.thread}, exit code ${record.outcome?.exitCode ?? 'unknown'}, log ${record.log}. ${failure}. Delete ${record.unheardPath} once someone has read it.`,
        );
  }
  return unheard;
}

const DEFER_POLL_MILLISECONDS = 5_000;
/** A thread busy for longer still gets its wake, so a stuck turn never swallows it. */
export const MAX_DEFER_MILLISECONDS = 3 * 60 * 60_000;

export type WakeDependencies = {
  readonly send: WakeSender;
  readonly threadBusy: (thread: string) => boolean;
  readonly supervisorAlive: (pid: number) => boolean;
  readonly wait: (milliseconds: number) => Promise<void>;
  readonly now: () => number;
};

const sendLockSchema = z.object({ pid: z.number().int(), recordPath: z.string() });

function sendLockPath(record: RunRecord): string {
  const thread = createHash('sha256').update(record.thread).digest('hex').slice(0, 16);
  return join(dirname(record.unheardPath), `${thread}.send-lock`);
}

/** True once `record`'s supervisor holds its thread's send lock. A lock of a dead supervisor is removed. */
function holdsSendLock(record: RunRecord, supervisorAlive: (pid: number) => boolean): boolean {
  const path = sendLockPath(record);
  try {
    writeFileSync(path, JSON.stringify({ pid: process.pid, recordPath: record.recordPath }), { flag: 'wx' });
    return true;
  } catch (error) {
    if (errorCode(error) !== 'EEXIST') throw error;
  }
  try {
    const holder = sendLockSchema.parse(JSON.parse(readFileSync(path, 'utf8')));
    if (holder.recordPath === record.recordPath) return true;
    if (!supervisorAlive(holder.pid)) rmSync(path, { force: true });
  } catch {
    // Written but not yet filled, or removed meanwhile: the next look decides.
  }
  return false;
}

function releaseSendLock(record: RunRecord): void {
  const path = sendLockPath(record);
  try {
    if (sendLockSchema.parse(JSON.parse(readFileSync(path, 'utf8'))).recordPath === record.recordPath)
      rmSync(path);
  } catch (error) {
    if (errorCode(error) !== 'ENOENT') throw error;
  }
}

/** The ended runs of `thread` that still wait for their wake, other than `own`. */
function otherWaitingRuns(own: RunRecord): RunRecord[] {
  const directory = dirname(own.unheardPath);
  return readdirSync(directory)
    .filter((file) => file.endsWith('.json'))
    .flatMap((name) => {
      const record = readEntry(join(directory, name));
      const waiting =
        record !== null &&
        record.recordPath !== own.recordPath &&
        record.thread === own.thread &&
        record.outcome !== null &&
        record.wake === 'pending';
      return waiting ? [record] : [];
    });
}

/**
 * Settles the wake of a run whose command ended, from its supervisor. A run its
 * thread heard gets none. A busy thread gets none until its turn ended: the
 * supervisor that holds the thread's send lock waits for that, then sends one
 * wake for every ended run of the thread still unheard. The lock keeps it to one
 * sender, so runs that end during one turn give at most one extra turn.
 */
export async function settleWake(recordPath: string, dependencies: WakeDependencies): Promise<void> {
  const deadline = dependencies.now() + MAX_DEFER_MILLISECONDS;
  try {
    for (;;) {
      const own = readRecord(recordPath);
      if (own.wake !== 'pending') return;
      if (wasHeard(own)) {
        saveRecord({ ...own, wake: 'heard' });
        return;
      }
      const sends =
        holdsSendLock(own, dependencies.supervisorAlive) &&
        (dependencies.now() > deadline || !dependencies.threadBusy(own.thread));
      if (sends) {
        await wakeThread(own, dependencies);
        return;
      }
      await dependencies.wait(DEFER_POLL_MILLISECONDS);
    }
  } finally {
    releaseSendLock(readRecord(recordPath));
  }
}

async function wakeThread(own: RunRecord, dependencies: WakeDependencies): Promise<void> {
  const others: RunRecord[] = [];
  for (const record of otherWaitingRuns(own))
    if (wasHeard(record)) saveRecord({ ...record, wake: 'heard' });
    else others.push(record);
  const runs = [own, ...others].sort((first, second) => first.startedAt.localeCompare(second.startedAt));
  const [first = own, ...rest] = runs;
  const failure = await deliverWake(dependencies.send, [first, ...rest], dependencies.wait);
  const settled: Pick<RunRecord, 'wake' | 'wakeError'> =
    failure === null ? { wake: 'sent', wakeError: null } : { wake: 'failed', wakeError: failure };
  for (const record of others) saveRecord({ ...record, ...settled });
  saveRecord({ ...own, ...settled });
}

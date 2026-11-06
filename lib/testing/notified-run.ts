import { spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { constants, homedir } from 'node:os';
import { basename, join } from 'node:path';
import { z } from 'zod';
import { writeJsonAtomically } from './runner/file-lock';

// A thread wakes for a child thread or a PR watch, never for a shell run. A
// notified run ends by telling its thread: `scripts/run-notified.ts` runs the
// command detached and calls `t3 thread send` with its real exit code and log.
// An entry in the unheard directory exists from the start until a wake went
// through, so a failed wake, a killed supervisor and a reboot all leave the same
// record, which the next notified run on the machine resends or prints.

const runOutcomeSchema = z.object({
  exitCode: z.number().int(),
  signal: z.string().nullable(),
  endedAt: z.iso.datetime(),
});

const runRecordSchema = z.object({
  id: z.string(),
  command: z.array(z.string()),
  thread: z.string(),
  log: z.string(),
  recordPath: z.string(),
  unheardPath: z.string(),
  startedAt: z.iso.datetime(),
  supervisorPid: z.number().int().nullable(),
  outcome: runOutcomeSchema.nullable(),
  wake: z.enum(['pending', 'sent', 'failed']),
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
const T3_TIMEOUT_MILLISECONDS = 60_000;
/** The waits before each wake attempt: long enough to outlast a T3 server restart. */
export const WAKE_RETRY_WAITS_MILLISECONDS = [0, 30_000, 120_000, 600_000];

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
  const [program, firstArgument] = command;
  if (program === undefined) return { kind: 'refused', reason: `No command given. ${USAGE}` };
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
  // A shell line can end in a pipe, and then the exit code is the pipe's, not the command's.
  if (SHELLS.has(basename(program)) && firstArgument === '-c')
    return {
      kind: 'refused',
      reason: `Pass the command itself, not a shell line: "${program} -c" reports the exit code of its last pipe stage.`,
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

/** The notice. It carries no log text: a log can hold personal data, and the thread reads it locally. */
export function wakeMessage(record: RunRecord): string {
  const command = record.command.join(' ');
  const summary = record.outcome
    ? `Run ended with exit code ${record.outcome.exitCode}${
        record.outcome.signal ? ` (${record.outcome.signal})` : ''
      } after ${durationLabel(record, record.outcome.endedAt)}.`
    : 'Run unheard: its supervisor died, so its exit code is unknown and the command may still be running.';
  return `${summary}\nCommand: ${command}\nLog: ${record.log}\nRecord: ${record.recordPath}\nRead the log before you report this run.`;
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

/** Tries the wake on the retry schedule. Resolves with the last failure, or null once it went through. */
export async function deliverWake(
  send: WakeSender,
  record: RunRecord,
  wait: (milliseconds: number) => Promise<void>,
): Promise<string | null> {
  let failure: string | null = 'No wake attempt ran.';
  for (const milliseconds of WAKE_RETRY_WAITS_MILLISECONDS) {
    await wait(milliseconds);
    failure = send(record.thread, wakeMessage(record));
    if (failure === null) return null;
    appendFileSync(record.log, `[run-notified] wake failed: ${failure}\n`);
  }
  return failure;
}

/** The machine-wide directory of runs nobody has heard yet. */
export function unheardDirectory(): string {
  return process.env.WERKFLOW_UNHEARD_RUNS_DIR ?? join(homedir(), '.cache', 'werkflow-unheard-runs');
}

/** Writes the run's record, and its unheard entry until a wake went through. */
export function saveRecord(record: RunRecord): void {
  writeJsonAtomically(record.recordPath, record);
  if (record.wake === 'sent') rmSync(record.unheardPath, { force: true });
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

/**
 * Resends each run whose supervisor is gone and whose wake never went through.
 * Returns one line per run that stays unheard, for the caller to print.
 */
export function resendUnheardRuns(
  directory: string,
  send: WakeSender,
  supervisorAlive: (pid: number) => boolean = isAlive,
): string[] {
  if (!existsSync(directory)) return [];
  const unheard: string[] = [];
  for (const name of readdirSync(directory).filter((file) => file.endsWith('.json'))) {
    const path = join(directory, name);
    const record = readEntry(path);
    if (record === null) {
      unheard.push(`UNHEARD RUN: ${path} cannot be read. Delete it once someone has checked it.`);
      continue;
    }
    if (record.supervisorPid !== null && supervisorAlive(record.supervisorPid)) continue;
    const failure = send(record.thread, wakeMessage(record));
    if (failure === null) saveRecord({ ...record, wake: 'sent', wakeError: null });
    else
      unheard.push(
        `UNHEARD RUN: thread ${record.thread}, exit code ${record.outcome?.exitCode ?? 'unknown'}, log ${record.log}. ${failure}. Delete ${path} once someone has read it.`,
      );
  }
  return unheard;
}

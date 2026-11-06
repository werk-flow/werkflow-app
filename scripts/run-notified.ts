import { spawn, spawnSync } from 'node:child_process';
import { appendFileSync, closeSync, existsSync, mkdirSync, openSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { z } from 'zod';
import {
  deliverWake,
  exitCodeOf,
  isAlive,
  parseRunArguments,
  readRecord,
  resendUnheardRuns,
  saveRecord,
  sendWake,
  threadProblem,
  unheardDirectory,
  type RunOptions,
  type RunRecord,
} from '../lib/testing/notified-run';

// Runs a long command detached and wakes the thread that started it when it
// ends (lib/testing/notified-run.ts). The foreground part stays until the log
// shows the command began work, or the command ended, so a refusal is reported
// as a refusal. A harness stops a task by group and by walking its process tree,
// so the supervisor runs in a session of its own, started by a launcher that exits
// at once: it is nobody's child in that tree, also while this foreground waits.

const LAUNCH_FLAG = '--launch';
const SUPERVISE_FLAG = '--supervise';
/** Bounded below a tool call's own limit, so the caller always gets this script's report. */
const BEGIN_WAIT_MILLISECONDS = 300_000;
const POLL_MILLISECONDS = 500;
/** Foreground exit code: the run goes on, and nothing proves it began work. */
const NOT_PROVEN_EXIT_CODE = 75;
const REFUSED_EXIT_CODE = 2;
const SPAWN_FAILED_EXIT_CODE = 127;
const LOG_TAIL_LINES = 20;

const waitFor = (milliseconds: number): Promise<void> =>
  new Promise((resume) => setTimeout(resume, milliseconds));

function logTail(path: string): string {
  return readFileSync(path, 'utf8').trimEnd().split('\n').slice(-LOG_TAIL_LINES).join('\n');
}

async function supervise(recordPath: string): Promise<void> {
  const started = readRecord(recordPath);
  saveRecord({ ...started, supervisorPid: process.pid });
  const log = openSync(started.log, 'a');
  const [program = '', ...programArguments] = started.command;
  const child = spawn(program, programArguments, { stdio: ['ignore', log, log] });
  closeSync(log);
  for (const signal of ['SIGTERM', 'SIGINT', 'SIGHUP'] as const) process.on(signal, () => child.kill(signal));
  const exit = await new Promise<{ code: number; signal: string | null }>((settle) => {
    child.once('error', (error) => {
      appendFileSync(started.log, `[run-notified] the command did not start: ${error.message}\n`);
      settle({ code: SPAWN_FAILED_EXIT_CODE, signal: null });
    });
    child.once('exit', (code, signal) => settle({ code: exitCodeOf(code, signal), signal }));
  });
  const ended: RunRecord = {
    ...readRecord(recordPath),
    outcome: { exitCode: exit.code, signal: exit.signal, endedAt: new Date().toISOString() },
  };
  saveRecord(ended);
  const failure = await deliverWake(sendWake, ended, waitFor);
  saveRecord({ ...ended, wake: failure === null ? 'sent' : 'failed', wakeError: failure });
}

function refuse(reason: string): never {
  console.error(`[run-notified] refused: ${reason}`);
  process.exit(REFUSED_EXIT_CODE);
}

function createRun(options: RunOptions): RunRecord {
  const id = `${new Date().toISOString().replaceAll(/[:.]/g, '-')}-${process.pid}`;
  const directory = resolve('.agent-logs', 'notified-runs', id);
  mkdirSync(directory, { recursive: true });
  return {
    id,
    command: [...options.command],
    thread: options.thread,
    log: join(directory, 'output.log'),
    recordPath: join(directory, 'run.json'),
    unheardPath: join(unheardDirectory(), `${id}.json`),
    startedAt: new Date().toISOString(),
    supervisorPid: null,
    outcome: null,
    wake: 'pending',
    wakeError: null,
  };
}

function reportEnded(record: RunRecord, exitCode: number): never {
  console.log(logTail(record.log));
  console.log(`[run-notified] ended with exit code ${exitCode}. Whole log: ${record.log}`);
  process.exit(exitCode);
}

/** Reports what the run really did: ended, proved it began work, or neither. */
async function watchStart(record: RunRecord, began: string): Promise<never> {
  const deadline = Date.now() + BEGIN_WAIT_MILLISECONDS;
  const pollCommand = `timeout 570 bash -c 'until grep -q "\\"endedAt\\"" "${record.recordPath}"; do read -t 5 < /dev/zero; done'`;
  for (;;) {
    const current = readRecord(record.recordPath);
    if (current.outcome) reportEnded(current, current.outcome.exitCode);
    if (current.supervisorPid !== null && !isAlive(current.supervisorPid)) {
      // It writes the outcome before it exits, so only a read after its death can trust a missing one.
      const last = readRecord(record.recordPath);
      if (last.outcome) reportEnded(last, last.outcome.exitCode);
      console.error(`[run-notified] the supervisor died before the command ended. Log: ${record.log}`);
      process.exit(1);
    }
    if (existsSync(record.log) && readFileSync(record.log, 'utf8').includes(began)) {
      console.log(`[run-notified] began work: the log shows "${began}".`);
      console.log(`[run-notified] When it ends, thread ${record.thread} gets the exit code.`);
      console.log(`[run-notified] Log: ${record.log}\n[run-notified] To wait in this turn: ${pollCommand}`);
      process.exit(0);
    }
    if (Date.now() > deadline) {
      console.error(`[run-notified] NOT PROVEN RUNNING: the log never showed "${began}".`);
      console.error(`${logTail(record.log)}\n[run-notified] It may be waiting or stuck. Log: ${record.log}`);
      console.error(`[run-notified] Its wake still fires. To wait in this turn: ${pollCommand}`);
      process.exit(NOT_PROVEN_EXIT_CODE);
    }
    await waitFor(POLL_MILLISECONDS);
  }
}

async function start(argumentList: readonly string[]): Promise<void> {
  const parsed = parseRunArguments(argumentList, process.env.T3CODE_THREAD_ID);
  if (parsed.kind === 'refused') refuse(parsed.reason);
  const problem = threadProblem(parsed.options.thread);
  if (problem !== null)
    refuse(`Thread ${parsed.options.thread} cannot be woken, so no run starts: ${problem}`);
  for (const line of resendUnheardRuns(unheardDirectory(), sendWake)) console.error(`[run-notified] ${line}`);

  const record = createRun(parsed.options);
  saveRecord(record);
  const launcher = spawnSync(process.execPath, [import.meta.path, LAUNCH_FLAG, record.recordPath], {
    stdio: 'inherit',
  });
  if (launcher.status !== 0) refuse(`The supervisor did not start: launcher exit ${launcher.status}.`);
  await watchStart(record, parsed.options.began);
}

function launch(path: string): void {
  const log = openSync(readRecord(path).log, 'a');
  spawn(process.execPath, [import.meta.path, SUPERVISE_FLAG, path], {
    detached: true,
    stdio: ['ignore', log, log],
  }).unref();
  closeSync(log);
}

const [mode, recordPath] = process.argv.slice(2);
if (mode === LAUNCH_FLAG) launch(z.string().parse(recordPath));
else if (mode === SUPERVISE_FLAG) await supervise(z.string().parse(recordPath));
else await start(process.argv.slice(2));

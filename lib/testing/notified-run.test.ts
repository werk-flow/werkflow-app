import { afterEach, expect, test } from 'bun:test';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import {
  createReadStream,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  deliverWake,
  exitCodeOf,
  markHeard,
  MAX_DEFER_MILLISECONDS,
  parseRunArguments,
  readRecord,
  resendUnheardRuns,
  saveRecord,
  settleWake,
  WAKE_RETRY_WAITS_MILLISECONDS,
  wakeMessage,
  type RunRecord,
  type WakeDependencies,
} from './notified-run';
import { errorCode } from './runner/error-code';

const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function temporaryDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), 'notified-run-'));
  directories.push(directory);
  return directory;
}

function runRecord(
  directory: string,
  unheardDirectory: string,
  changes: Partial<RunRecord> = {},
  entryName = 'run-1',
): RunRecord {
  const log = join(directory, 'output.log');
  writeFileSync(log, '');
  return {
    command: ['bun', 'run', 'test:verify'],
    thread: 'thread-1',
    log,
    recordPath: join(directory, 'run.json'),
    unheardPath: join(unheardDirectory, `${entryName}.json`),
    startedAt: '2026-11-06T10:00:00.000Z',
    supervisorPid: 4242,
    outcome: { exitCode: 3, signal: null, endedAt: '2026-11-06T10:00:30.000Z' },
    wake: 'pending',
    wakeError: null,
    ...changes,
  };
}

const noWait = (): Promise<void> => Promise.resolve();

test('a command gets its flags, and the thread falls back to the environment', () => {
  expect(parseRunArguments(['--began', 'starting', '--', 'bun', 'run', 'x'], 'thread-env')).toEqual({
    kind: 'run',
    options: { thread: 'thread-env', began: 'starting', command: ['bun', 'run', 'x'] },
  });
  const explicit = parseRunArguments(['--began', 'b', '--thread', 'thread-flag', '--', 'x'], 'thread-env');
  expect(explicit.kind === 'run' && explicit.options.thread).toBe('thread-flag');
});

test.each([
  ['no command', ['--began', 'b'], 'thread', 'No command given'],
  ['no proof of work', ['--', 'x'], 'thread', '--began is required'],
  ['no thread to wake', ['--began', 'b', '--', 'x'], undefined, 'No thread to wake'],
  [
    'a shell line that can hide a pipe',
    ['--began', 'b', '--', 'bash', '-c', 'x | tail -1'],
    'thread',
    'shell line',
  ],
  ['a shell line by full path', ['--began', 'b', '--', '/bin/sh', '-c', 'x'], 'thread', 'shell line'],
  ['a clustered login flag', ['--began', 'b', '--', 'bash', '-lc', 'x | tail -1'], 'thread', 'shell line'],
  ['a clustered errexit flag', ['--began', 'b', '--', 'sh', '-ec', 'x | tail -1'], 'thread', 'shell line'],
  [
    'an option before the flag',
    ['--began', 'b', '--', 'bash', '-o', 'pipefail', '-c', 'x'],
    'thread',
    'shell line',
  ],
  [
    'a shell line behind timeout',
    ['--began', 'b', '--', 'timeout', '9', 'bash', '-c', 'x'],
    'thread',
    'shell line',
  ],
  ['a shell line behind env', ['--began', 'b', '--', 'env', 'A=1', 'sh', '-c', 'x'], 'thread', 'shell line'],
])('a run with %s is refused before it starts', (_name, argumentList, thread, reason) => {
  const parsed = parseRunArguments(argumentList, thread);
  expect(parsed.kind).toBe('refused');
  expect(parsed.kind === 'refused' && parsed.reason).toContain(reason);
});

test('a shell script is a command, only a shell line is refused', () => {
  expect(parseRunArguments(['--began', 'b', '--', 'bash', 'scripts/x.sh'], 'thread').kind).toBe('run');
  expect(parseRunArguments(['--began', 'b', '--', 'bash', 'x.sh', '--check'], 'thread').kind).toBe('run');
  expect(parseRunArguments(['--began', 'b', '--', 'bun', 'run', '-c', 'x'], 'thread').kind).toBe('run');
});

test('a signal death reports the shell exit code', () => {
  expect(exitCodeOf(0, null)).toBe(0);
  expect(exitCodeOf(7, null)).toBe(7);
  expect(exitCodeOf(null, 'SIGTERM')).toBe(143);
  expect(exitCodeOf(null, 'SIGKILL')).toBe(137);
});

test('the notice names the exit code, the signal and the log', () => {
  const directory = temporaryDirectory();
  const record = runRecord(directory, directory, {
    outcome: { exitCode: 143, signal: 'SIGTERM', endedAt: '2026-11-06T10:05:00.000Z' },
  });
  const message = wakeMessage([record]);
  expect(message).toContain('exit code 143 (SIGTERM) after 5 min');
  expect(message).toContain(`Log: ${record.log}`);
});

test('a run without an outcome never claims an exit code', () => {
  const directory = temporaryDirectory();
  const message = wakeMessage([runRecord(directory, directory, { outcome: null })]);
  expect(message).toContain('exit code is unknown');
  expect(message).not.toContain('exit code 0');
});

test('a wake stops at the first attempt that goes through', async () => {
  const directory = temporaryDirectory();
  const answers = ['server restarting', null];
  const sent: string[] = [];
  const failure = await deliverWake(
    (thread) => {
      sent.push(thread);
      return answers.shift() ?? null;
    },
    [runRecord(directory, directory)],
    noWait,
  );
  expect(failure).toBeNull();
  expect(sent).toEqual(['thread-1', 'thread-1']);
});

test('a wake that never goes through returns its failure and writes each attempt to the log', async () => {
  const directory = temporaryDirectory();
  const record = runRecord(directory, directory);
  const failure = await deliverWake(() => 'Thread gone', [record], noWait);
  expect(failure).toBe('Thread gone');
  expect(readFileSync(record.log, 'utf8').match(/wake failed: Thread gone/g)).toHaveLength(
    WAKE_RETRY_WAITS_MILLISECONDS.length,
  );
});

test('an unheard entry exists until a wake went through', () => {
  const directory = temporaryDirectory();
  const unheard = temporaryDirectory();
  const record = runRecord(directory, unheard);
  saveRecord(record);
  expect(readRecord(record.unheardPath).outcome?.exitCode, 'the unheard entry keeps the outcome').toBe(3);
  saveRecord({ ...record, wake: 'failed', wakeError: 'Thread gone' });
  expect(readRecord(record.unheardPath).wakeError).toBe('Thread gone');
  saveRecord({ ...record, wake: 'sent' });
  expect(existsSync(record.unheardPath)).toBe(false);
  expect(readRecord(record.recordPath).wake).toBe('sent');
});

test('the next run resends an unheard run, which then leaves the list', () => {
  const directory = temporaryDirectory();
  const unheard = temporaryDirectory();
  const record = runRecord(directory, unheard, { wake: 'failed', wakeError: 'server down' });
  saveRecord(record);
  const sent: string[] = [];
  const lines = resendUnheardRuns(
    unheard,
    (_thread, message) => {
      sent.push(message);
      return null;
    },
    () => false,
  );
  expect(lines).toEqual([]);
  expect(sent[0]).toContain('exit code 3');
  expect(existsSync(record.unheardPath)).toBe(false);
});

test('a run that stays unheard is printed with its log and stays on the list', () => {
  const directory = temporaryDirectory();
  const unheard = temporaryDirectory();
  const record = runRecord(directory, unheard, { wake: 'failed' });
  saveRecord(record);
  const lines = resendUnheardRuns(
    unheard,
    () => 'still down',
    () => false,
  );
  expect(lines).toHaveLength(1);
  expect(lines[0]).toContain('UNHEARD RUN');
  expect(lines[0]).toContain(record.log);
  expect(existsSync(record.unheardPath)).toBe(true);
});

test('a killed supervisor leaves a run that the next run reports as unknown', () => {
  const directory = temporaryDirectory();
  const unheard = temporaryDirectory();
  saveRecord(runRecord(directory, unheard, { outcome: null }));
  const sent: string[] = [];
  resendUnheardRuns(
    unheard,
    (_thread, message) => {
      sent.push(message);
      return null;
    },
    () => false,
  );
  expect(sent[0]).toContain('its supervisor died');
});

test('a run still under its supervisor is left alone', () => {
  const directory = temporaryDirectory();
  const unheard = temporaryDirectory();
  const record = runRecord(directory, unheard, { outcome: null });
  saveRecord(record);
  const lines = resendUnheardRuns(
    unheard,
    () => {
      throw new Error('A live run must not be woken for.');
    },
    () => true,
  );
  expect(lines).toEqual([]);
  expect(existsSync(record.unheardPath)).toBe(true);
});

test('an unreadable entry is reported and stops no other run', () => {
  const directory = temporaryDirectory();
  const unheard = temporaryDirectory();
  writeFileSync(join(unheard, 'broken.json'), '{');
  const record = runRecord(directory, unheard, { wake: 'failed' });
  saveRecord(record);
  const lines = resendUnheardRuns(
    unheard,
    () => null,
    () => false,
  );
  expect(lines).toHaveLength(1);
  expect(lines[0]).toContain('broken.json');
  expect(existsSync(record.unheardPath)).toBe(false);
});

test('a failed wake is resent even when another process took the supervisor pid', () => {
  const unheard = temporaryDirectory();
  saveRecord(runRecord(temporaryDirectory(), unheard, { wake: 'failed', wakeError: 'Thread gone' }));
  const sent: string[] = [];
  const send = (_thread: string, message: string): string | null => {
    sent.push(message);
    return null;
  };
  resendUnheardRuns(unheard, send, () => true);
  expect(sent).toHaveLength(1);
});

test('a record whose supervisor has not saved its pid yet is starting, not dead, for a minute', () => {
  const unheard = temporaryDirectory();
  const startedAt = '2026-11-06T10:00:00.000Z';
  const started = Date.parse(startedAt);
  saveRecord(runRecord(temporaryDirectory(), unheard, { startedAt, supervisorPid: null, outcome: null }));
  const sent: string[] = [];
  const send = (_thread: string, message: string): string | null => {
    sent.push(message);
    return null;
  };
  const dead = (): boolean => false;
  // The 2026-11-06 race: a second run in that gap told the first run's thread it had died.
  resendUnheardRuns(unheard, send, dead, () => started + 59_000);
  expect(sent).toEqual([]);
  resendUnheardRuns(unheard, send, dead, () => started + 61_000);
  expect(sent).toHaveLength(1);
});

test('the next run drops a run its thread heard, and resends the rest as one wake per thread', () => {
  const unheard = temporaryDirectory();
  const dead: Partial<RunRecord> = { wake: 'failed' };
  const heard = runRecord(temporaryDirectory(), unheard, dead, 'run-1');
  markHeard(heard, 'thread-1');
  saveRecord(heard);
  saveRecord(runRecord(temporaryDirectory(), unheard, dead, 'run-2'));
  saveRecord(runRecord(temporaryDirectory(), unheard, dead, 'run-3'));
  saveRecord(runRecord(temporaryDirectory(), unheard, { ...dead, thread: 'thread-2' }, 'run-4'));
  const sent: string[] = [];
  const lines = resendUnheardRuns(
    unheard,
    (thread, message) => {
      sent.push(`${thread}: ${message}`);
      return null;
    },
    () => false,
  );
  expect(lines).toEqual([]);
  expect(sent).toHaveLength(2);
  expect(sent.find((message) => message.startsWith('thread-1'))).toContain('2 runs ended');
  expect(readRecord(heard.recordPath).wake).toBe('heard');
  expect(readdirSync(unheard)).toEqual([]);
});

test('no unheard directory means nothing to resend', () => {
  expect(resendUnheardRuns(join(temporaryDirectory(), 'missing'), () => null)).toEqual([]);
});

/** A supervisor's world: sends are recorded, the thread is busy for its first `busyChecks` looks. */
function wakeWorld(busyChecks: number, changes: Partial<WakeDependencies> = {}) {
  const sent: string[] = [];
  let looks = 0;
  const dependencies: WakeDependencies = {
    send: (_thread, message) => {
      sent.push(message);
      return null;
    },
    threadBusy: () => {
      looks += 1;
      return looks <= busyChecks;
    },
    supervisorAlive: () => true,
    // A macrotask, so concurrent supervisors interleave as separate processes would.
    wait: () => new Promise((resume) => setImmediate(resume)),
    now: Date.now,
    ...changes,
  };
  return { sent, dependencies };
}

/** An ended run of `thread-1` whose supervisor waits to settle its wake. */
function endedRun(unheard: string, entryName: string, exitCode = 1): RunRecord {
  const record = runRecord(
    temporaryDirectory(),
    unheard,
    { outcome: { exitCode, signal: null, endedAt: '2026-11-06T10:00:30.000Z' } },
    entryName,
  );
  saveRecord(record);
  return record;
}

test('an idle thread is woken at once', async () => {
  const unheard = temporaryDirectory();
  const record = endedRun(unheard, 'run-1', 3);
  const { sent, dependencies } = wakeWorld(0);
  await settleWake(record.recordPath, dependencies);
  expect(sent).toHaveLength(1);
  expect(sent[0]).toContain('exit code 3');
  expect(readRecord(record.recordPath).wake).toBe('sent');
  expect(readdirSync(unheard), 'no entry and no send lock is left').toEqual([]);
});

test('a run its own thread heard in the foreground wakes nobody', async () => {
  const unheard = temporaryDirectory();
  const record = endedRun(unheard, 'run-1');
  markHeard(record, 'thread-1');
  const { sent, dependencies } = wakeWorld(0);
  await settleWake(record.recordPath, dependencies);
  expect(sent).toEqual([]);
  expect(readRecord(record.recordPath).wake).toBe('heard');
  expect(existsSync(record.unheardPath)).toBe(false);
});

test('a run heard by another thread or outside T3 still wakes its own thread', async () => {
  const unheard = temporaryDirectory();
  const record = endedRun(unheard, 'run-1');
  markHeard(record, 'thread-2');
  markHeard(record, undefined);
  const { sent, dependencies } = wakeWorld(0);
  await settleWake(record.recordPath, dependencies);
  expect(sent).toHaveLength(1);
});

test('runs that end one after another during one turn give one wake once the turn ended', async () => {
  const unheard = temporaryDirectory();
  const records: RunRecord[] = [];
  const supervisors: Promise<void>[] = [];
  let looks = 0;
  const { sent, dependencies } = wakeWorld(0, {
    threadBusy: () => {
      looks += 1;
      // A second and a third run end while the turn still runs.
      if (looks === 2 || looks === 4) end(`run-${records.length + 1}`);
      return looks <= 6;
    },
  });
  function end(name: string): void {
    const record = endedRun(unheard, name, records.length + 4);
    records.push(record);
    supervisors.push(settleWake(record.recordPath, dependencies));
  }
  end('run-1');
  // A run that ends meanwhile adds its supervisor, so wait until none was added.
  for (let awaited = 0; awaited < supervisors.length; ) {
    awaited = supervisors.length;
    await Promise.all(supervisors);
  }
  expect(records).toHaveLength(3);
  expect(sent).toHaveLength(1);
  expect(sent[0]).toContain('3 runs ended while you were busy');
  for (const record of records) {
    expect(sent[0]).toContain(`Log: ${record.log}`);
    expect(readRecord(record.recordPath).wake).toBe('sent');
  }
  expect(readdirSync(unheard)).toEqual([]);
});

test('the one wake after a turn leaves out the runs the thread heard', async () => {
  const unheard = temporaryDirectory();
  const [heard, first, second] = ['run-1', 'run-2', 'run-3'].map((name) => endedRun(unheard, name));
  if (!heard || !first || !second) throw new Error('Three runs were made.');
  markHeard(heard, 'thread-1');
  const { sent, dependencies } = wakeWorld(3);
  await Promise.all([first, second].map((record) => settleWake(record.recordPath, dependencies)));
  expect(sent).toHaveLength(1);
  expect(sent[0]).toContain('2 runs ended');
  expect(sent[0]).not.toContain(heard.log);
  expect(readRecord(heard.recordPath).wake).toBe('heard');
});

// The race of 2026-11-07: the run ends while the foreground `--wait` still reports it.
test('a run the thread hears while its wake waits for the turn to end wakes nobody', async () => {
  const unheard = temporaryDirectory();
  const record = endedRun(unheard, 'run-1');
  let looks = 0;
  const { sent, dependencies } = wakeWorld(0, {
    threadBusy: () => {
      looks += 1;
      if (looks === 2) markHeard(record, 'thread-1');
      return looks <= 2;
    },
  });
  await settleWake(record.recordPath, dependencies);
  expect(sent).toEqual([]);
  expect(readRecord(record.recordPath).wake).toBe('heard');
});

test('a thread busy past the longest wait still gets its wake', async () => {
  const unheard = temporaryDirectory();
  const record = endedRun(unheard, 'run-1');
  let clock = 0;
  const { sent, dependencies } = wakeWorld(Number.POSITIVE_INFINITY, {
    now: () => clock,
    wait: (milliseconds) => {
      clock += milliseconds;
      return Promise.resolve();
    },
  });
  await settleWake(record.recordPath, dependencies);
  expect(sent).toHaveLength(1);
  expect(clock).toBeGreaterThan(MAX_DEFER_MILLISECONDS);
});

test('a run the thread hears while a failed wake waits for its retry gets no wake', async () => {
  const unheard = temporaryDirectory();
  const record = endedRun(unheard, 'run-1');
  const sent: string[] = [];
  let attempts = 0;
  const { dependencies } = wakeWorld(0, {
    send: (_thread, message) => {
      attempts += 1;
      sent.push(message);
      return 'server restarting';
    },
    wait: (milliseconds) => {
      if (milliseconds > 0) markHeard(record, 'thread-1');
      return Promise.resolve();
    },
  });
  await settleWake(record.recordPath, dependencies);
  expect(attempts, 'only the attempt before the thread heard it').toBe(1);
  expect(readRecord(record.recordPath).wake).toBe('heard');
});

/** Starts a supervisor that takes its thread's send lock, finds the thread busy, and never acts again. */
async function stuckHolder(record: RunRecord): Promise<void> {
  let lockTaken: () => void = () => undefined;
  const holding = new Promise<void>((resume) => {
    lockTaken = resume;
  });
  void settleWake(
    record.recordPath,
    wakeWorld(1, {
      wait: () => {
        lockTaken();
        return new Promise(() => undefined);
      },
    }).dependencies,
  );
  await holding;
}

test('the send lock of a killed supervisor holds no wake back', async () => {
  const unheard = temporaryDirectory();
  const killed = endedRun(unheard, 'run-1', 4);
  const record = endedRun(unheard, 'run-2', 5);
  await stuckHolder(killed);
  const { sent, dependencies } = wakeWorld(0, { supervisorAlive: () => false });
  await settleWake(record.recordPath, dependencies);
  expect(sent).toHaveLength(1);
  expect(sent[0]).toContain('exit code 4');
  expect(sent[0]).toContain('exit code 5');
});

test('a send lock left empty by a crash holds no wake back', async () => {
  const unheard = temporaryDirectory();
  await stuckHolder(endedRun(unheard, 'run-1', 4));
  const [lock = ''] = readdirSync(unheard).filter((name) => name.endsWith('.send-lock'));
  writeFileSync(join(unheard, lock), '');
  const record = endedRun(unheard, 'run-2', 5);
  const { sent, dependencies } = wakeWorld(0);
  await settleWake(record.recordPath, dependencies);
  expect(sent).toHaveLength(1);
});

// A directory in the lock's place fails every read (EISDIR), whatever the process's privileges.
test('a send lock that cannot be read is not taken over, so a live holder keeps its single wake', async () => {
  const unheard = temporaryDirectory();
  await stuckHolder(endedRun(unheard, 'run-1', 4));
  const [lock = ''] = readdirSync(unheard).filter((name) => name.endsWith('.send-lock'));
  rmSync(join(unheard, lock));
  mkdirSync(join(unheard, lock));
  const record = endedRun(unheard, 'run-2', 5);
  let waits = 0;
  const { sent, dependencies } = wakeWorld(0, {
    supervisorAlive: () => false,
    wait: () => {
      waits += 1;
      return waits > 3 ? Promise.reject(new Error('still waiting')) : Promise.resolve();
    },
  });
  await expect(settleWake(record.recordPath, dependencies)).rejects.toThrow('still waiting');
  expect(sent, 'a second sender took the lock').toEqual([]);
});

test('a resend leaves a thread to the supervisor that holds its send lock, whose wake carries every orphaned run once', async () => {
  const unheard = temporaryDirectory();
  const orphan = runRecord(
    temporaryDirectory(),
    unheard,
    { supervisorPid: 999_999, outcome: { exitCode: 7, signal: null, endedAt: '2026-11-06T10:00:30.000Z' } },
    'run-0',
  );
  saveRecord(orphan);
  const failedWake = { exitCode: 8, signal: null, endedAt: '2026-11-06T10:00:30.000Z' };
  saveRecord(runRecord(temporaryDirectory(), unheard, { wake: 'failed', outcome: failedWake }, 'run-a'));
  saveRecord(runRecord(temporaryDirectory(), unheard, { supervisorPid: 999_999, outcome: null }, 'run-b'));
  const record = endedRun(unheard, 'run-1', 5);
  const sent: string[] = [];
  const send = (_thread: string, message: string): string | null => {
    sent.push(message);
    return null;
  };
  let busy = true;
  const supervisor = settleWake(record.recordPath, {
    ...wakeWorld(0).dependencies,
    send,
    threadBusy: () => busy,
    supervisorAlive: (pid) => pid !== 999_999,
  });
  await new Promise((resume) => setImmediate(resume));
  expect(resendUnheardRuns(unheard, send, (pid) => pid !== 999_999)).toEqual([]);
  expect(sent, 'the resend skipped the locked thread').toEqual([]);
  busy = false;
  await supervisor;
  expect(sent).toHaveLength(1);
  expect(sent[0]).toContain('exit code 7');
  expect(sent[0]).toContain('exit code 5');
  expect(sent[0], 'a failed wake').toContain('exit code 8');
  expect(sent[0], 'a supervisor killed before the end').toContain('exit code is unknown');
  expect(readdirSync(unheard)).toEqual([]);
});

const script = resolve(import.meta.dir, '../../scripts/run-notified.ts');

const exited = (child: ChildProcess): Promise<number | null> =>
  new Promise((resolveExit) => child.once('exit', resolveExit));

/** Settles once the unheard directory is empty: the supervisor's last acts drop the entry and its send lock. */
/**
 * The text the fake `t3 send` writes into `fifo`. Reading a FIFO waits for its
 * writer, so the test waits on the wake itself, not on the clock or on file
 * events, which macOS may drop under memory pressure.
 */
function wakeThrough(fifo: string): Promise<string> {
  return new Promise((settle, fail) => {
    let text = '';
    createReadStream(fifo, 'utf8')
      .on('data', (chunk) => (text += chunk))
      .on('end', () => settle(text))
      .on('error', fail);
  });
}

/**
 * Stops the run's detached supervisor once the test read what it needs, so no
 * test waits out its poll. Its command ended, so a signal ends it.
 */
function stopSupervisor(recordPath: string): void {
  const { supervisorPid } = readRecord(recordPath);
  if (supervisorPid === null) return;
  try {
    process.kill(supervisorPid, 'SIGTERM');
  } catch (error) {
    if (errorCode(error) !== 'ESRCH') throw error;
  }
}

/** The supervisor's decision on a run whose thread is idle now: a heard run settles as heard and sends nothing. */
async function settleAsIdle(recordPath: string): Promise<string[]> {
  const sent: string[] = [];
  await settleWake(recordPath, {
    send: (_thread, message) => {
      sent.push(message);
      return null;
    },
    threadBusy: () => false,
    supervisorAlive: () => false,
    wait: () => Promise.resolve(),
    now: Date.now,
  });
  return sent;
}

/** A fake `t3` on PATH: `send` writes the wake to `wakeFile`, `show` reports a busy thread until `idleFile` exists. */
function fakeT3(directory: string): {
  wakeFile: string;
  idleFile: string;
  unheard: string;
  env: NodeJS.ProcessEnv;
} {
  const unheard = join(directory, 'unheard');
  mkdirSync(unheard);
  const wakeFile = join(directory, 'wake.txt');
  const idleFile = join(directory, 'idle');
  const busy = '{"thread":{"activeRunId":"run-1"}}';
  const idle = '{"thread":{"activeRunId":null}}';
  writeFileSync(
    join(directory, 't3'),
    `#!/bin/sh\nif [ "$2" = send ]; then printf '%s' "$4" > "${wakeFile}"; exit 0; fi\n` +
      `if [ -e "${idleFile}" ]; then echo '${idle}'; else echo '${busy}'; fi\n`,
    { mode: 0o755 },
  );
  const env = {
    ...process.env,
    PATH: `${directory}:${process.env.PATH}`,
    T3CODE_THREAD_ID: 'thread-1',
    WERKFLOW_UNHEARD_RUNS_DIR: unheard,
  };
  return { wakeFile, idleFile, unheard, env };
}

function onlyRecordPath(directory: string): string {
  const [runId = ''] = readdirSync(join(directory, '.agent-logs', 'notified-runs'));
  return join(directory, '.agent-logs', 'notified-runs', runId, 'run.json');
}

// Rule test: a harness stops a task by walking its process tree, which `detached` alone does not escape.
test('the real script keeps its supervisor out of the process tree and wakes an idle thread with the exit code', async () => {
  const directory = temporaryDirectory();
  const { wakeFile, idleFile, env } = fakeT3(directory);
  writeFileSync(idleFile, '');
  spawnSync('mkfifo', [wakeFile]);
  const wake = wakeThrough(wakeFile);
  const parentFile = join(directory, 'supervisor-parent.txt');
  const command = join(directory, 'command.sh');
  writeFileSync(
    command,
    `#!/bin/sh\nps -o ppid= -p "$PPID" > "${parentFile}"\necho began\nsleep 1\nexit 6\n`,
    {
      mode: 0o755,
    },
  );

  const foreground = spawn(process.execPath, [script, '--began', 'began', '--', command], {
    cwd: directory,
    env,
    stdio: 'ignore',
  });

  expect(await exited(foreground), 'the foreground leaves once the log shows work began').toBe(0);
  expect(await wake).toContain('exit code 6');
  stopSupervisor(onlyRecordPath(directory));
  expect(Number(readFileSync(parentFile, 'utf8'))).not.toBe(foreground.pid);
  expect(
    await exited(spawn(process.execPath, [script, '--wait', onlyRecordPath(directory)], { stdio: 'ignore' })),
  ).toBe(6);
});

test('the real script sends no wake for a refusal its foreground reported', async () => {
  const directory = temporaryDirectory();
  const { env } = fakeT3(directory);
  const command = join(directory, 'command.sh');
  writeFileSync(command, '#!/bin/sh\necho refused\nexit 2\n', { mode: 0o755 });
  const foreground = spawn(process.execPath, [script, '--began', 'never printed', '--', command], {
    cwd: directory,
    env,
    stdio: 'ignore',
  });
  expect(await exited(foreground)).toBe(2);
  // The thread stays busy, so the supervisor holds its wake; stopped, it leaves the decision to us.
  const recordPath = onlyRecordPath(directory);
  stopSupervisor(recordPath);
  expect(await settleAsIdle(recordPath), 'the refusal the foreground reported counts as heard').toEqual([]);
  expect(readRecord(recordPath).wake).toBe('heard');
});

// The race: the run ends while its thread's `--wait` watches it, in a turn that is still running.
test('the real script sends no wake for a run its busy thread heard through --wait', async () => {
  const directory = temporaryDirectory();
  const { env } = fakeT3(directory);
  const command = join(directory, 'command.sh');
  writeFileSync(command, '#!/bin/sh\necho began\nsleep 1\nexit 4\n', { mode: 0o755 });
  const foreground = spawn(process.execPath, [script, '--began', 'began', '--', command], {
    cwd: directory,
    env,
    stdio: 'ignore',
  });
  expect(await exited(foreground)).toBe(0);
  const wait = spawn(process.execPath, [script, '--wait', onlyRecordPath(directory)], {
    env,
    stdio: 'ignore',
  });
  expect(await exited(wait)).toBe(4);
  const recordPath = onlyRecordPath(directory);
  stopSupervisor(recordPath);
  expect(await settleAsIdle(recordPath), 'the run --wait reported counts as heard').toEqual([]);
  expect(readRecord(recordPath).wake).toBe('heard');
});

test('a wait on a run whose supervisor died fails instead of waiting on', async () => {
  const directory = temporaryDirectory();
  const finished = spawn('true', []);
  await exited(finished);
  const record = runRecord(directory, directory, { outcome: null, supervisorPid: finished.pid ?? null });
  saveRecord(record);
  const wait = spawn(process.execPath, [script, '--wait', record.recordPath], { stdio: 'ignore' });
  expect(await exited(wait)).toBe(1);
});

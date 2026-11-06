import { afterEach, expect, test } from 'bun:test';
import { spawn, type ChildProcess } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  watch,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  deliverWake,
  exitCodeOf,
  parseRunArguments,
  readRecord,
  resendUnheardRuns,
  saveRecord,
  WAKE_RETRY_WAITS_MILLISECONDS,
  wakeMessage,
  type RunRecord,
} from './notified-run';

const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function temporaryDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), 'notified-run-'));
  directories.push(directory);
  return directory;
}

function runRecord(directory: string, unheardDirectory: string, changes: Partial<RunRecord> = {}): RunRecord {
  const log = join(directory, 'output.log');
  writeFileSync(log, '');
  return {
    id: 'run-1',
    command: ['bun', 'run', 'test:verify'],
    thread: 'thread-1',
    log,
    recordPath: join(directory, 'run.json'),
    unheardPath: join(unheardDirectory, 'run-1.json'),
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
])('a run with %s is refused before it starts', (_name, argumentList, thread, reason) => {
  const parsed = parseRunArguments(argumentList, thread);
  expect(parsed.kind).toBe('refused');
  expect(parsed.kind === 'refused' && parsed.reason).toContain(reason);
});

test('a shell script is a command, only a shell line is refused', () => {
  expect(parseRunArguments(['--began', 'b', '--', 'bash', 'scripts/x.sh'], 'thread').kind).toBe('run');
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
  const message = wakeMessage(record);
  expect(message).toContain('exit code 143 (SIGTERM) after 5 min');
  expect(message).toContain(`Log: ${record.log}`);
});

test('a run without an outcome never claims an exit code', () => {
  const directory = temporaryDirectory();
  const message = wakeMessage(runRecord(directory, directory, { outcome: null }));
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
    runRecord(directory, directory),
    noWait,
  );
  expect(failure).toBeNull();
  expect(sent).toEqual(['thread-1', 'thread-1']);
});

test('a wake that never goes through returns its failure and writes each attempt to the log', async () => {
  const directory = temporaryDirectory();
  const record = runRecord(directory, directory);
  const failure = await deliverWake(() => 'Thread gone', record, noWait);
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
  expect(readRecord(record.unheardPath).outcome?.exitCode).toBe(3);
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

test('no unheard directory means nothing to resend', () => {
  expect(resendUnheardRuns(join(temporaryDirectory(), 'missing'), () => null)).toEqual([]);
});

const exited = (child: ChildProcess): Promise<number | null> =>
  new Promise((resolveExit) => child.once('exit', resolveExit));

/** Settles when the wake went through: dropping the unheard entry is the supervisor's last act. */
function wakeDelivered(unheard: string, wakeFile: string): Promise<void> {
  return new Promise((settle) => {
    const watcher = watch(unheard, () => {
      if (!existsSync(wakeFile) || readdirSync(unheard).length > 0) return;
      watcher.close();
      settle();
    });
  });
}

// Rule test: a harness stops a task by walking its process tree, which `detached` alone does not escape.
test('the real script keeps its supervisor out of the process tree and wakes with the exit code', async () => {
  const directory = temporaryDirectory();
  const unheard = join(directory, 'unheard');
  mkdirSync(unheard);
  const wakeFile = join(directory, 'wake.txt');
  const parentFile = join(directory, 'supervisor-parent.txt');
  writeFileSync(
    join(directory, 't3'),
    `#!/bin/sh\n[ "$2" = send ] || exit 0\nprintf '%s' "$4" > "${wakeFile}"\n`,
    { mode: 0o755 },
  );
  const command = join(directory, 'command.sh');
  writeFileSync(command, `#!/bin/sh\nps -o ppid= -p "$PPID" > "${parentFile}"\nexit 6\n`, { mode: 0o755 });

  const delivered = wakeDelivered(unheard, wakeFile);
  const foreground = spawn(
    process.execPath,
    [resolve(import.meta.dir, '../../scripts/run-notified.ts'), '--began', 'never printed', '--', command],
    {
      cwd: directory,
      env: {
        ...process.env,
        PATH: `${directory}:${process.env.PATH}`,
        T3CODE_THREAD_ID: 'thread-1',
        WERKFLOW_UNHEARD_RUNS_DIR: unheard,
      },
      stdio: 'ignore',
    },
  );

  expect(await exited(foreground)).toBe(6);
  await delivered;
  expect(readFileSync(wakeFile, 'utf8')).toContain('exit code 6');
  expect(Number(readFileSync(parentFile, 'utf8'))).not.toBe(foreground.pid);
});

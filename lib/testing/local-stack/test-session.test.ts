import { expect, test } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getEventListeners } from 'node:events';
import { runSessionCommand, withTestSession } from './test-session';

function command(source: string): string[] {
  return [process.execPath, '-e', source];
}
function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
async function waitForFile(path: string): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (!existsSync(path)) {
    if (Date.now() > deadline) throw new Error(`Child did not create ${path}`);
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 10));
  }
}

test('cancellation between commands prevents the next process from starting', async () => {
  const controller = new AbortController();
  let output = '';
  await expect(
    withTestSession(
      async (signal) => {
        expect(await runSessionCommand(command('process.exit(0)'), { signal, stdio: 'ignore' })).toBe(0);
        controller.abort(new Error('Stop between stages'));
        await runSessionCommand(command("console.log('should never run')"), {
          signal,
          onStdout: (chunk) => {
            output += chunk.toString();
          },
        });
      },
      { signal: controller.signal },
    ),
  ).rejects.toThrow('Stop between stages');
  expect(output).toBe('');
});

test('cancellation terminates an owned descendant, not only its launcher', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'werkflow-lease-'));
  const pidFile = join(directory, 'grandchild');
  const controller = new AbortController();
  const descendant = `require('fs').writeFileSync(${JSON.stringify(pidFile)}, String(process.pid)); setInterval(() => {}, 1000);`;
  const launcher = `require('child_process').spawn(process.execPath, ['-e', ${JSON.stringify(descendant)}], {stdio:'ignore'}); setInterval(() => {}, 1000);`;
  const pending = runSessionCommand(command(launcher), { signal: controller.signal, stdio: 'ignore' });
  const settled = pending.then(
    () => null,
    (error: unknown) => error,
  );
  try {
    await waitForFile(pidFile);
    const pid = Number(readFileSync(pidFile, 'utf8'));
    expect(alive(pid)).toBe(true);
    controller.abort(new Error('Cancel tree'));
    expect(await settled).toMatchObject({ message: 'Cancel tree' });
    expect(alive(pid)).toBe(false);
  } finally {
    if (!controller.signal.aborted) controller.abort(new Error('Cancel tree'));
    await settled;
    rmSync(directory, { recursive: true, force: true });
  }
});

test('a session restores signal listeners, also when its operation fails', async () => {
  const listeners = process.listenerCount('SIGHUP');
  expect(await withTestSession(async () => 42)).toBe(42);
  await expect(
    withTestSession(async () => {
      throw new Error('Operation failed');
    }),
  ).rejects.toThrow('Operation failed');
  expect(process.listenerCount('SIGHUP')).toBe(listeners);
});

test('a closed terminal (SIGHUP) cancels the session and stops its owned command', async () => {
  const pending = withTestSession((signal) =>
    runSessionCommand(command('setInterval(() => {}, 1000);'), { signal, stdio: 'ignore' }),
  );
  await new Promise((resolveDelay) => setTimeout(resolveDelay, 100));
  process.emit('SIGHUP', 'SIGHUP');
  await expect(pending).rejects.toThrow('The test session was cancelled.');
});

test('a command spawn error removes its abort listener', async () => {
  const controller = new AbortController();
  await expect(
    runSessionCommand(['werkflow-nonexistent-session-command'], {
      signal: controller.signal,
      stdio: 'ignore',
    }),
  ).rejects.toThrow();
  expect(getEventListeners(controller.signal, 'abort')).toHaveLength(0);
});

test('command output is completely drained before returning', async () => {
  let output = '';
  const code = await runSessionCommand(command("process.stdout.write('x'.repeat(250000));"), {
    signal: new AbortController().signal,
    onStdout: (chunk) => {
      output += chunk.toString();
    },
  });
  expect(code, output.slice(0, 200)).toBe(0);
  expect(output.length).toBe(250000);
});

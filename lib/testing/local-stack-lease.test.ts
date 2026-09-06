import { expect, test } from 'bun:test';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getEventListeners } from 'node:events';
import { runSessionCommand, withLocalStackLease } from './local-stack-lease';

function command(source: string): string[] { return [process.execPath, '-e', source]; }
function alive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch { return false; }
}
async function waitForFile(path: string): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (!existsSync(path)) {
    if (Date.now() > deadline) throw new Error(`Child did not create ${path}`);
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 10));
  }
}

test('completion closes lease stdin and awaits guest exit', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'werkflow-lease-'));
  const exitFile = join(directory, 'exited');
  const listeners = process.listenerCount('SIGTERM');
  try {
    const result = await withLocalStackLease(true, async () => 42, {
      testCommand: command(`process.stdout.write('WERKFLOW_STACK_READY'); process.stdin.resume(); process.stdin.on('end', () => { require('fs').writeFileSync(${JSON.stringify(exitFile)}, 'yes'); });`),
    });
    expect(result).toBe(42);
    expect(readFileSync(exitFile, 'utf8')).toBe('yes');
    expect(process.listenerCount('SIGTERM')).toBe(listeners);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('lease loss cancels a real pending command before any next step', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'werkflow-lease-'));
  const pidFile = join(directory, 'pid');
  let nextStep = false;
  try {
    await expect(withLocalStackLease(true, async (signal) => {
      await runSessionCommand(command(`require('fs').writeFileSync(${JSON.stringify(pidFile)}, String(process.pid)); setInterval(() => {}, 1000);`), { signal, stdio: 'ignore' });
      nextStep = true;
    }, {
      // Fail only after the owned command has started; a fixed delay can kill
      // it before its PID is recorded on a busy workstation.
      testCommand: command(`
        const fs = require('fs');
        const pidFile = ${JSON.stringify(pidFile)};
        const deadline = Date.now() + 5000;
        process.stdout.write('WERKFLOW_STACK_READY');
        const poll = setInterval(() => {
          if (fs.existsSync(pidFile) && /^[1-9][0-9]*$/.test(fs.readFileSync(pidFile, 'utf8'))) {
            clearInterval(poll);
            process.exit(2);
          }
          if (Date.now() >= deadline) {
            clearInterval(poll);
            process.stderr.write('Owned command did not publish its PID before the lease test deadline.');
            process.exit(3);
          }
        }, 10);
      `),
    })).rejects.toThrow('lifetime process exited');
    expect(nextStep).toBe(false);
    expect(alive(Number(readFileSync(pidFile, 'utf8')))).toBe(false);
  } finally { rmSync(directory, { recursive: true, force: true }); }
}, 15_000);

test('cancellation between commands prevents the next process from starting', async () => {
  const controller = new AbortController();
  let output = '';
  await expect(withLocalStackLease(false, async (signal) => {
    expect(await runSessionCommand(command('process.exit(0)'), { signal, stdio: 'ignore' })).toBe(0);
    controller.abort(new Error('Stop between stages'));
    await runSessionCommand(command("console.log('should never run')"), { signal, onStdout: (chunk) => { output += chunk.toString(); } });
  }, { signal: controller.signal })).rejects.toThrow('Stop between stages');
  expect(output).toBe('');
});

test('cancellation terminates an owned descendant, not only its launcher', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'werkflow-lease-'));
  const pidFile = join(directory, 'grandchild');
  const controller = new AbortController();
  const descendant = `require('fs').writeFileSync(${JSON.stringify(pidFile)}, String(process.pid)); setInterval(() => {}, 1000);`;
  const launcher = `require('child_process').spawn(process.execPath, ['-e', ${JSON.stringify(descendant)}], {stdio:'ignore', windowsHide:true}); setInterval(() => {}, 1000);`;
  const pending = runSessionCommand(command(launcher), { signal: controller.signal, stdio: 'ignore' });
  const settled = pending.then(() => null, (error: unknown) => error);
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

test('startup timeout and spawn errors restore signal listeners without running work', async () => {
  const listeners = process.listenerCount('SIGINT');
  let executed = false;
  await expect(withLocalStackLease(true, async () => { executed = true; }, {
    testCommand: command('process.stdin.resume();'), readyTimeoutMs: 40,
  })).rejects.toThrow('startup deadline');
  await expect(withLocalStackLease(true, async () => { executed = true; }, {
    testCommand: ['werkflow-nonexistent-lifetime-command'],
  })).rejects.toThrow();
  expect(executed).toBe(false);
  expect(process.listenerCount('SIGINT')).toBe(listeners);
});

test('a command spawn error removes its abort listener', async () => {
  const controller = new AbortController();
  await expect(runSessionCommand(['werkflow-nonexistent-session-command'], {
    signal: controller.signal, stdio: 'ignore',
  })).rejects.toThrow();
  expect(getEventListeners(controller.signal, 'abort')).toHaveLength(0);
});

test('command output is completely drained before returning', async () => {
  let output = '';
  const code = await runSessionCommand(command("process.stdout.write('x'.repeat(250000));"), {
    signal: new AbortController().signal,
    onStdout: (chunk) => { output += chunk.toString(); },
  });
  expect(code).toBe(0);
  expect(output.length).toBe(250000);
});

import { expect, mock } from 'bun:test';
import { resolve } from 'node:path';

let results = ['starting\nstarting\nstarting\n', 'healthy\nhealthy\nhealthy\n'];
let exitCode = 0;
let calls = 0;
mock.module(resolve(import.meta.dir, '../local-stack/local-stack-lease.ts'), () => ({
  runSessionCommand: async (
    command: string[],
    options: { signal: AbortSignal; onStdout: (chunk: Buffer) => void },
  ) => {
    options.signal.throwIfAborted();
    expect(command[command.indexOf('--format') + 1]).toStartWith(
      '{{if not .State.Running}}{{.State.Status}}',
    );
    calls += 1;
    options.onStdout(Buffer.from(results.shift() ?? 'starting\nstarting\nstarting\n'));
    return exitCode;
  },
}));
const { waitForLocalStackHealth } = await import('../local-stack/local-stack-startup');
await waitForLocalStackHealth(new AbortController().signal);
expect(calls).toBe(2);
exitCode = 1;
await expect(waitForLocalStackHealth(new AbortController().signal)).rejects.toThrow('Cannot inspect');
exitCode = 0;
results = ['exited\nhealthy\nhealthy\n'];
await expect(waitForLocalStackHealth(new AbortController().signal)).rejects.toThrow('cannot finish startup');
results = ['starting\nstarting\nstarting\n'];
const controller = new AbortController();
const beforeCancel = calls;
const pending = waitForLocalStackHealth(controller.signal);
const timer = setTimeout(() => controller.abort(new Error('owner cancelled')), 10);
await expect(pending).rejects.toThrow('owner cancelled');
clearTimeout(timer);
expect(calls).toBe(beforeCancel + 1);

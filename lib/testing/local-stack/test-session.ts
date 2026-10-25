import { spawn, type ChildProcess } from 'node:child_process';
import { errorCode } from '../runner/error-code';

function abortReason(signal: AbortSignal): Error {
  return signal.reason instanceof Error ? signal.reason : new Error('The test session was cancelled.');
}

/** Whether any process of the group still exists; a killed one counts until it has been reaped. */
function groupExists(groupId: number): boolean {
  try {
    process.kill(-groupId, 0);
    return true;
  } catch (error) {
    if (errorCode(error) === 'ESRCH') return false;
    throw error;
  }
}

/**
 * The group outlives an exited launcher while a descendant holds its output
 * open, so it is signalled regardless. SIGKILL returns before the processes
 * are gone, so cancellation waits, bounded, until none of the group remains.
 */
async function terminateTree(child: ChildProcess): Promise<void> {
  if (!child.pid) return;
  const groupId = child.pid;
  try {
    process.kill(-groupId, 'SIGKILL');
  } catch (error) {
    // ESRCH: the whole group already ended.
    if (errorCode(error) === 'ESRCH') return;
    throw error;
  }
  const deadline = Date.now() + 5_000;
  while (groupExists(groupId)) {
    // A member nobody reaps stays visible after it stopped; the cancellation itself stays the outcome.
    if (Date.now() > deadline) {
      console.warn(`[werkflow-test] Process group ${groupId} is still listed 5 s after SIGKILL.`);
      return;
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 20));
  }
}

/** Each command leads its own process group, so cancellation stops the whole tree it started. */
export async function runSessionCommand(
  command: readonly string[],
  options: {
    signal: AbortSignal;
    cwd?: string;
    env?: NodeJS.ProcessEnv;
    stdio?: 'inherit' | 'ignore';
    onStdout?: (chunk: Buffer) => void;
    onStderr?: (chunk: Buffer) => void;
  },
): Promise<number> {
  if (options.signal.aborted) throw abortReason(options.signal);
  const [executable, ...args] = command;
  if (!executable) throw new Error('A test session command requires an executable.');
  const child = spawn(executable, args, {
    cwd: options.cwd,
    env: options.env,
    stdio: options.onStdout || options.onStderr ? ['ignore', 'pipe', 'pipe'] : (options.stdio ?? 'inherit'),
    detached: true,
  });
  if (options.onStdout) child.stdout?.on('data', options.onStdout);
  else child.stdout?.resume();
  if (options.onStderr) child.stderr?.on('data', options.onStderr);
  else child.stderr?.resume();
  let termination: Promise<void> | undefined;
  const onAbort = (): void => {
    termination ??= terminateTree(child);
    // eslint-disable-next-line no-restricted-syntax -- harness teardown on abort: the awaiting caller receives the same rejection
    void termination.catch(() => undefined);
  };
  options.signal.addEventListener('abort', onAbort, { once: true });
  if (options.signal.aborted) onAbort();
  try {
    const code = await new Promise<number>((resolveExit, reject) => {
      child.once('error', reject);
      child.once('close', (exitCode) => resolveExit(exitCode ?? 1));
    });
    if (termination) await termination;
    if (options.signal.aborted) throw abortReason(options.signal);
    return code;
  } finally {
    options.signal.removeEventListener('abort', onAbort);
  }
}

/** Ctrl+C, a closed terminal and a terminating host; each command leads its own group, so none reaches it directly. */
const CANCELLING_SIGNALS = ['SIGINT', 'SIGHUP', 'SIGTERM'] as const;

/**
 * Ctrl+C, a closed terminal, a terminating host and the caller's signal cancel the operation.
 * Operations must pass the signal to subprocesses and check it before each step.
 */
export async function withTestSession<T>(
  operation: (signal: AbortSignal) => Promise<T>,
  options: { signal?: AbortSignal } = {},
): Promise<T> {
  const controller = new AbortController();
  const abort = (): void => {
    controller.abort(new Error('The test session was cancelled.'));
  };
  const forwardAbort = (): void => {
    controller.abort(options.signal?.reason);
  };
  for (const name of CANCELLING_SIGNALS) process.once(name, abort);
  options.signal?.addEventListener('abort', forwardAbort, { once: true });
  if (options.signal?.aborted) forwardAbort();
  try {
    if (controller.signal.aborted) throw abortReason(controller.signal);
    const result = await operation(controller.signal);
    if (controller.signal.aborted) throw abortReason(controller.signal);
    return result;
  } finally {
    for (const name of CANCELLING_SIGNALS) process.removeListener(name, abort);
    options.signal?.removeEventListener('abort', forwardAbort);
  }
}

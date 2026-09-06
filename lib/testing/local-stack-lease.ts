import { spawn, type ChildProcess } from 'node:child_process';

function abortReason(signal: AbortSignal): Error {
  return signal.reason instanceof Error ? signal.reason : new Error('The test session was cancelled.');
}

async function terminateTree(child: ChildProcess): Promise<void> {
  if (!child.pid || child.exitCode !== null || child.signalCode !== null) return;
  if (process.platform === 'win32') {
    await new Promise<void>((resolveExit, reject) => {
      const killer = spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
      killer.once('error', reject);
      killer.once('exit', (code) => {
        if (code === 0 || child.exitCode !== null || child.signalCode !== null) resolveExit();
        else reject(new Error(`Could not terminate test process tree ${child.pid} (taskkill ${code}).`));
      });
    });
    return;
  }
  try { process.kill(-child.pid, 'SIGKILL'); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error; }
}

/** Cancellation waits for the owned process tree to stop before releasing WSL. */
export async function runSessionCommand(
  command: readonly string[],
  options: {
    signal: AbortSignal; cwd?: string; env?: NodeJS.ProcessEnv; stdio?: 'inherit' | 'ignore';
    onStdout?: (chunk: Buffer) => void; onStderr?: (chunk: Buffer) => void;
  },
): Promise<number> {
  if (options.signal.aborted) throw abortReason(options.signal);
  const [executable, ...args] = command;
  if (!executable) throw new Error('A test session command requires an executable.');
  const child = spawn(executable, args, {
    cwd: options.cwd, env: options.env,
    stdio: options.onStdout || options.onStderr ? ['ignore', 'pipe', 'pipe'] : options.stdio ?? 'inherit',
    windowsHide: true, detached: process.platform !== 'win32',
  });
  if (options.onStdout) child.stdout?.on('data', options.onStdout); else child.stdout?.resume();
  if (options.onStderr) child.stderr?.on('data', options.onStderr); else child.stderr?.resume();
  let termination: Promise<void> | undefined;
  const onAbort = (): void => {
    termination ??= terminateTree(child);
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

type LeaseOptions = {
  /** A harmless child substitutes for WSL in lifecycle tests, including on CI. */
  testCommand?: readonly string[];
  readyTimeoutMs?: number;
  signal?: AbortSignal;
};

/** Operations must pass the signal to subprocesses and check it before each step. */
export async function withLocalStackLease<T>(
  enabled: boolean,
  operation: (signal: AbortSignal) => Promise<T>,
  options: LeaseOptions = {},
): Promise<T> {
  const controller = new AbortController();
  const abort = (): void => { controller.abort(new Error('The test session was cancelled.')); };
  const forwardAbort = (): void => { controller.abort(options.signal?.reason); };
  process.once('SIGINT', abort);
  process.once('SIGTERM', abort);
  options.signal?.addEventListener('abort', forwardAbort, { once: true });
  if (options.signal?.aborted) forwardAbort();
  let child: ChildProcess | undefined;
  let closed: Promise<void> | undefined;
  let stopping = false;
  try {
    if (controller.signal.aborted) throw abortReason(controller.signal);
    if (enabled && (process.platform === 'win32' || options.testCommand)) {
      // EOF, including abrupt parent death, ends the guest process. Systemd
      // services alone do not keep WSL alive; no orphan sleep is needed.
      const command = options.testCommand ?? ['wsl.exe', '--exec', 'sh', '-c', "printf 'WERKFLOW_STACK_READY\\n'; cat >/dev/null"];
      const [executable, ...args] = command;
      if (!executable) throw new Error('A local stack lease requires an executable.');
      child = spawn(executable, args, {
        stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true,
        detached: process.platform !== 'win32',
      });
      const leaseChild = child;
      closed = new Promise<void>((resolveClosed) => { leaseChild.once('close', resolveClosed); });
      child.on('error', (error) => { if (!stopping) controller.abort(error); });
      child.once('exit', () => {
        if (!stopping) controller.abort(new Error('The local WSL lifetime process exited. Backend evidence is invalid; inspect the environment before retrying.'));
      });
      child.stderr?.resume();
      await waitForReady(child, controller.signal, options.readyTimeoutMs ?? 30_000);
      child.stdout?.resume();
    }
    const result = await operation(controller.signal);
    if (controller.signal.aborted) throw abortReason(controller.signal);
    return result;
  } finally {
    stopping = true;
    process.removeListener('SIGINT', abort);
    process.removeListener('SIGTERM', abort);
    options.signal?.removeEventListener('abort', forwardAbort);
    if (child && closed) {
      child.stdin?.end();
      let timer: ReturnType<typeof setTimeout> | undefined;
      const ended = await Promise.race([
        closed.then(() => true),
        new Promise<false>((resolveTimeout) => { timer = setTimeout(() => resolveTimeout(false), 2_000); }),
      ]);
      if (timer) clearTimeout(timer);
      if (!ended) await terminateTree(child);
      await closed;
    }
  }
}

function waitForReady(child: ChildProcess, signal: AbortSignal, timeoutMs: number): Promise<void> {
  return new Promise((resolveReady, reject) => {
    let output = '';
    const timer = setTimeout(() => finish(new Error('WSL did not acknowledge the local test session before its startup deadline.')), timeoutMs);
    const onAbort = (): void => finish(abortReason(signal));
    const onStdout = (chunk: Buffer): void => {
      output = `${output}${chunk.toString()}`.slice(-2000);
      if (output.includes('WERKFLOW_STACK_READY')) finish();
    };
    function finish(error?: Error): void {
      clearTimeout(timer);
      signal.removeEventListener('abort', onAbort);
      child.stdout?.removeListener('data', onStdout);
      if (error) reject(error); else resolveReady();
    }
    signal.addEventListener('abort', onAbort, { once: true });
    child.stdout?.on('data', onStdout);
    if (signal.aborted) onAbort();
  });
}

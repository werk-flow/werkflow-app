import { errorCode } from '../runner/error-code';
import { assertAppPortFree } from '../runner/app-port';
import { groupGone } from '../local-stack/test-session';

/** How long a test server has to stop its own commands (test-session.ts) before it is killed. */
const STOP_GRACE_MS = 30_000;

function signalGroup(groupId: number, name: NodeJS.Signals): void {
  try {
    process.kill(-groupId, name);
  } catch (error) {
    // ESRCH: the whole group already ended.
    if (errorCode(error) !== 'ESRCH') throw error;
  }
}

/**
 * Stops a test server started as its own process group and proves its app port free. SIGTERM lets
 * the server stop the commands it started in groups of their own; SIGKILL follows after the grace.
 * A group still listed, or a port still held, throws: the next job on this host would meet it.
 */
export async function stopTestServer(groupId: number | undefined, port: number): Promise<void> {
  if (groupId !== undefined) {
    signalGroup(groupId, 'SIGTERM');
    if (!(await groupGone(groupId, STOP_GRACE_MS))) {
      signalGroup(groupId, 'SIGKILL');
      if (!(await groupGone(groupId)))
        throw new Error(`The test server's process group ${groupId} is still listed after SIGKILL.`);
    }
  }
  try {
    await assertAppPortFree(port);
  } catch (error) {
    throw new Error(
      `Port ${port} is still held after the test server stopped; a process it started outlived it. ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/**
 * The stop of a started test server, awaited once however often it is called. SIGTERM and SIGINT,
 * the executor's cancellation, stop it too, and the process then exits 1: a cancelled job never
 * passes. A server this stop never reached still holds the app port, which the process executor
 * finds free or refuses the host (scripts/ci/process-executor.ts).
 */
export function guardTestServer(groupId: number | undefined, port: number): () => Promise<void> {
  let stopping: Promise<void> | undefined;
  const stop = (): Promise<void> => (stopping ??= stopTestServer(groupId, port));
  const cancel = (): void => {
    stop().then(
      () => process.exit(1),
      (error: unknown) => {
        console.error(`::error title=Test server::${error instanceof Error ? error.message : String(error)}`);
        process.exit(1);
      },
    );
  };
  process.once('SIGTERM', cancel);
  process.once('SIGINT', cancel);
  return stop;
}

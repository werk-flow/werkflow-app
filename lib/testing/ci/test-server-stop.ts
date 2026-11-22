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

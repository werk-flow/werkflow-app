import { errorCode } from '../runner/error-code';
import { awaitAppPortFree } from '../runner/app-port';
import { groupExists, groupGone } from '../local-stack/test-session';
import {
  describeListener,
  getListenerGroup,
  isRecordedGroup,
  type ListenerGroup,
} from '../runner/app-listener';

/** How long a test server has to stop its own commands (test-session.ts) before it is killed. */
const STOP_GRACE_MS = 30_000;
/** How long the app listener's group has to close after SIGTERM, once the server is gone. */
const LISTENER_GRACE_MS = 5_000;

function signalGroup(groupId: number, name: NodeJS.Signals): void {
  try {
    process.kill(-groupId, name);
  } catch (error) {
    // ESRCH: the whole group already ended.
    if (errorCode(error) !== 'ESRCH') throw error;
  }
}

/** SIGTERM, then SIGKILL after `graceMs`; false when the group is still listed after both. */
async function stopGroup(groupId: number, graceMs: number): Promise<boolean> {
  signalGroup(groupId, 'SIGTERM');
  if (await groupGone(groupId, graceMs)) return true;
  signalGroup(groupId, 'SIGKILL');
  return groupGone(groupId);
}

/**
 * Stops a test server started as its own process group and proves its app port free. SIGTERM lets
 * the server stop the commands it started in groups of their own; SIGKILL follows after the grace.
 * The app listener's group, recorded once the server was ready, is stopped next: a server that missed
 * its own cancellation leaves it holding the port. It is signalled only while its leader is the
 * process recorded. A group still listed, or a port still held once its release had time, throws:
 * the next job on this host would meet it. A group no longer listed is never signalled: a new process
 * could take its id.
 */
export async function stopTestServer(
  groupId: number | undefined,
  port: number,
  listener: ListenerGroup | undefined,
): Promise<void> {
  if (groupId !== undefined && groupExists(groupId) && !(await stopGroup(groupId, STOP_GRACE_MS)))
    throw new Error(`The test server's process group ${groupId} is still listed after SIGKILL.`);
  if (
    listener !== undefined &&
    groupExists(listener.groupId) &&
    isRecordedGroup(listener) &&
    !(await stopGroup(listener.groupId, LISTENER_GRACE_MS))
  )
    throw new Error(`The app listener's process group ${listener.groupId} is still listed after SIGKILL.`);
  try {
    await awaitAppPortFree(port);
  } catch (error) {
    throw new Error(
      `Port ${port} is still held after the test server stopped; a process it started outlived it. ${error instanceof Error ? error.message : String(error)} ${describeListener(port)}`,
    );
  }
}

/** The app listener's group, or undefined with one warning when it cannot be identified. */
function observeListener(port: number): ListenerGroup | undefined {
  try {
    const group = getListenerGroup(port);
    if (group) return group;
    console.warn(
      `::warning title=Test server::No process listens on port ${port}; only the server's own group is stopped.`,
    );
  } catch (error) {
    console.warn(
      `::warning title=Test server::The app listener on port ${port} could not be identified; only the server's own group is stopped. ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  return undefined;
}

/**
 * The stop of a started test server, awaited once however often it is called. `observe`, called once
 * the server answers, records the app listener's group: the port was proven free before the server
 * started, so its listener is the server's. SIGTERM and SIGINT, the executor's cancellation, stop it
 * too, and the process then exits 1: a cancelled job never passes. A server this stop never reached
 * still holds the app port, which the process executor finds free or refuses the host
 * (scripts/ci/process-executor.ts).
 */
export function guardTestServer(
  groupId: number | undefined,
  port: number,
): { observe: () => void; stop: () => Promise<void> } {
  let listener: ListenerGroup | undefined;
  let stopping: Promise<void> | undefined;
  const stop = (): Promise<void> => (stopping ??= stopTestServer(groupId, port, listener));
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
  const observe = (): void => {
    listener ??= observeListener(port);
  };
  return { observe, stop };
}

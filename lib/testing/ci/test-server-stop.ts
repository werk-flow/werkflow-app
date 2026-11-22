import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { errorCode } from '../runner/error-code';
import { assertAppPortFree } from '../runner/app-port';
import { groupGone } from '../local-stack/test-session';

/** How long a test server has to stop its own commands (test-session.ts) before it is killed. */
const STOP_GRACE_MS = 30_000;

/**
 * Where a browser job names its running test server, relative to its checkout: `<group id> <port>`.
 * The job removes it once the server stopped; the process executor stops what it still names.
 */
const RECORD = '.agent-logs/test-server.group';

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

/** Names a started test server in the checkout, so the executor stops it if the job cannot. */
export function recordTestServer(checkout: string, groupId: number, port: number): void {
  const path = join(checkout, RECORD);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${groupId} ${port}`);
}

/**
 * The stop of a started test server: awaited once however often it is called, and removing the
 * server's record once it holds. SIGTERM and SIGINT, the executor's cancellation, stop it too, and
 * the process then exits 1: a cancelled job never passes.
 */
export function guardTestServer(
  checkout: string,
  groupId: number | undefined,
  port: number,
): () => Promise<void> {
  let stopping: Promise<void> | undefined;
  const stop = (): Promise<void> =>
    (stopping ??= stopTestServer(groupId, port).then(() => rmSync(join(checkout, RECORD), { force: true })));
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

/**
 * Stops the test server a job's checkout still names once the job ended, and resolves to whether
 * there was one: a job that left it never passes.
 */
export async function stopRecordedTestServer(checkout: string): Promise<boolean> {
  const path = join(checkout, RECORD);
  let recorded: string;
  try {
    recorded = readFileSync(path, 'utf8');
  } catch (error) {
    if (errorCode(error) === 'ENOENT') return false;
    throw error;
  }
  const [groupId, port] = recorded.split(' ').map(Number);
  // Group 0 or 1 would signal this process's own group or every process this user may signal.
  if (
    groupId === undefined ||
    port === undefined ||
    !Number.isInteger(groupId) ||
    groupId <= 1 ||
    !Number.isInteger(port)
  )
    throw new Error(`${path} names no test server: ${JSON.stringify(recorded)}.`);
  await stopTestServer(groupId, port);
  rmSync(path, { force: true });
  return true;
}

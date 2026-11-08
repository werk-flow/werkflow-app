import { randomUUID } from 'node:crypto';

import { type BoatClient, type BoatUsage, BoatError, FAILED_STATES, READY_STATES } from './boat-api';

// One short-lived Boat machine: created, used and always deleted, with its deletion confirmed.

const POLL_MS = 2_000;
/** A deletion is asynchronous; Boat usually completes it in seconds. */
const DELETION_WAIT_MS = 120_000;

const sleep = (milliseconds: number) => new Promise((done) => setTimeout(done, milliseconds));

export type MachineOptions = {
  /** The saved snapshot to start from, or undefined for Boat's base image. */
  from: string | undefined;
  name: string;
  ttlSeconds: number;
  /** False only for a machine that becomes a saved snapshot: without snapshots an auto-stop erases it. */
  snapshots: boolean;
  log: (line: string) => void;
  /** An interruption stops the wait for readiness; the machine is then deleted. */
  signal?: AbortSignal;
};

export type Machine = {
  id: string;
  client: BoatClient;
  log: (line: string) => void;
  /** How often a run reads the command's status; a test's stand-in shortens it. */
  pollMs?: number;
};

/** Creates a large, credential-free machine and waits until it accepts commands. */
export async function createMachine(client: BoatClient, options: MachineOptions): Promise<Machine> {
  const id = await client.create(
    {
      type: 'large',
      noEnv: true,
      snapshots: options.snapshots,
      failFast: true,
      ttlSeconds: options.ttlSeconds,
      name: options.name,
      labels: { purpose: 'werkflow-verify' },
      ...(options.from ? { from: options.from } : {}),
    },
    randomUUID(),
  );
  const machine = { id, client, log: options.log };
  try {
    const deadline = Date.now() + 300_000;
    for (;;) {
      options.signal?.throwIfAborted();
      const state = await client.state(id);
      if (READY_STATES.has(state)) return machine;
      if (FAILED_STATES.has(state) || Date.now() > deadline)
        throw new Error(`Boat machine ${id} did not become ready (state ${state}).`);
      await sleep(POLL_MS);
    }
  } catch (error) {
    await deleteMachine(machine);
    throw error;
  }
}

/**
 * Runs a bash script on the machine and streams its output to `write` until it exits. Boat
 * reports a command it lost, a memory kill or a stop through the status; each is an error here.
 */
export async function runScript(
  machine: Machine,
  script: string,
  write: { stdout: (text: string) => void; stderr: (text: string) => void },
  signal?: AbortSignal,
): Promise<{ exitCode: number; oomKilled: boolean }> {
  const { client, id } = machine;
  const processId = await client.start(id, `bash -lc ${shellQuote(script)}`);
  const offsets = { stdout: 0, stderr: 0 };
  let failures = 0;
  for (;;) {
    if (signal?.aborted) {
      await client
        .stop(id, processId)
        .catch((error: unknown) => machine.log(`Stopping the command on ${id} failed: ${String(error)}.`));
      throw new Error('The run was interrupted.');
    }
    let status;
    try {
      status = await client.status(id, processId, offsets);
      failures = 0;
    } catch (error) {
      // A status read can fail on a network blip; the command keeps running on the machine.
      if (++failures >= 15) throw error;
      await sleep(machine.pollMs ?? POLL_MS);
      continue;
    }
    if (status.stdout) write.stdout(status.stdout);
    if (status.stderr) write.stderr(status.stderr);
    offsets.stdout = status.stdoutNextOffset ?? offsets.stdout + Buffer.byteLength(status.stdout);
    offsets.stderr = status.stderrNextOffset ?? offsets.stderr + Buffer.byteLength(status.stderr);
    if (status.more) continue;
    if (status.status === 'lost') throw new Error(`Boat lost the command on machine ${id}.`);
    if (!status.running) return { exitCode: status.exitCode ?? 1, oomKilled: status.oomKilled ?? false };
    await sleep(machine.pollMs ?? POLL_MS);
  }
}

/** The machine's cost so far, or undefined when Boat does not answer. */
export async function machineUsage(machine: Machine): Promise<BoatUsage | undefined> {
  const usage = await machine.client.usage(machine.id).catch(() => null);
  return usage ?? undefined;
}

/**
 * Deletes the machine and waits until Boat no longer knows it; a failure is logged, never thrown.
 * An organization key may not read the deletion operation (403 api_key_org_forbidden), so a 404
 * on the sandbox confirms the deletion: Boat removes it from every read once the operation exists.
 */
export async function deleteMachine(machine: Machine): Promise<void> {
  const { client, id, log } = machine;
  try {
    await client.delete(id);
    const deadline = Date.now() + DELETION_WAIT_MS;
    for (;;) {
      try {
        const state = await client.state(id);
        if (Date.now() > deadline) {
          log(`Boat machine ${id} is still listed (${state}); its auto-stop erases it at the latest.`);
          return;
        }
      } catch (error) {
        if (error instanceof BoatError && error.status === 404) return;
        throw error;
      }
      await sleep(POLL_MS);
    }
  } catch (error) {
    log(
      `Deleting Boat machine ${id} failed: ${error instanceof Error ? error.message : String(error)}. Its auto-stop erases it.`,
    );
  }
}

/** A string as one single-quoted shell word. */
export function shellQuote(text: string): string {
  return `'${text.replaceAll("'", `'\\''`)}'`;
}

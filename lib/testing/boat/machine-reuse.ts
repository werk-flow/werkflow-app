import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { homedir, hostname } from 'node:os';
import { join, resolve } from 'node:path';

import { z } from '../../zod';

import { type BoatClient, BoatError, READY_STATES, boatClient } from './boat-api';
import { readBoatKey } from './boat-key';
import {
  type Machine,
  createMachine,
  deleteMachine,
  machineUsage,
  runScript,
  shellQuote,
} from './boat-machine';
import { MARK_IDLE, claimKeptMachine, takeIdleMachineElsewhere, workstationLabel } from './machine-eviction';
import { mainWipeScript } from './main-wipe-script';

// One Boat machine serves a checkout's consecutive verification runs, because Boat counts every
// create as a start (docs/technical/boat-verification.md#machine-reuse). After a run the machine is
// wiped back to what the snapshot holds and kept for IDLE_SECONDS; a run in the same checkout takes
// it, or a reaper deletes it. Boat's auto-stop erases it in any case MACHINE_TTL_SECONDS after its
// creation, whatever the workstation does: the key may not move that deadline (no sandbox.update).

/** A machine's whole life: Boat stops it, and without snapshots erases it, this long after its creation. */
const MACHINE_TTL_SECONDS = 3 * 3_600;
/** How long a run waits to see Boat drop a machine it deleted, after Boat accepted the deletion. */
const RUN_DELETION_CONFIRM_MS = 15_000;
/** How long a wiped machine waits for the next run in its checkout before it is deleted. */
const IDLE_SECONDS = 15 * 60;
/** The life a kept machine needs left to take a run, so Boat's auto-stop never cuts one short. */
const RUN_LIFE_SECONDS = 60 * 60;
/** One file per kept machine, named by its checkout; only the workstation's own processes read it. */
const IDLE_RECORDS = join(homedir(), '.cache', 'werkflow-boat', 'idle-machines');

const recordSchema = z.object({ id: z.string().regex(/^bx_[a-z0-9]{8}$/) });

const sleep = (milliseconds: number) => new Promise((done) => setTimeout(done, milliseconds));

/** The label that ties a machine to one checkout on one workstation, without naming either. */
function checkoutLabel(repository: string, host = hostname()): string {
  return createHash('sha256').update(`${host}\0${repository}`).digest('hex').slice(0, 16);
}

/**
 * The machine id in the idle record at `path`, or undefined when another taker was first. A rename
 * hands each record to exactly one taker, a run or the reaper, so two never share a machine.
 */
function takeIdleRecord(path: string): string | undefined {
  const taken = `${path}.taken-${randomUUID()}`;
  try {
    renameSync(path, taken);
  } catch {
    return undefined;
  }
  try {
    return recordSchema.parse(JSON.parse(readFileSync(taken, 'utf8'))).id;
  } catch {
    return undefined;
  } finally {
    rmSync(taken, { force: true });
  }
}

/**
 * Takes every idle record in `folder` that `chosen` picks by name and age, oldest first, and answers
 * their ids. A record a run already took is renamed away, so it is never among them.
 */
function takeIdleRecords(folder: string, chosen: (name: string, ageMs: number) => boolean): string[] {
  let names: string[];
  try {
    names = readdirSync(folder);
  } catch {
    return [];
  }
  return names
    .flatMap((name) => {
      try {
        return name.endsWith('.json')
          ? [{ name, ageMs: Date.now() - statSync(join(folder, name)).mtimeMs }]
          : [];
      } catch {
        return [];
      }
    })
    .sort((a, b) => b.ageMs - a.ageMs)
    .flatMap(({ name, ageMs }) => (chosen(name, ageMs) ? (takeIdleRecord(join(folder, name)) ?? []) : []));
}

/** Asks Boat to delete a machine no run will use; a refusal leaves it to its auto-stop. */
async function deleteLeftover(client: BoatClient, id: string, log: (line: string) => void): Promise<void> {
  await client
    .delete(id)
    .catch((error: unknown) =>
      log(`Deleting the leftover Boat machine ${id} failed (${String(error)}); its auto-stop erases it.`),
    );
}

/** Records machine `id` as idle for `checkout` and answers the record's path. */
function writeIdleRecord(checkout: string, id: string, folder: string): string {
  mkdirSync(folder, { recursive: true, mode: 0o700 });
  const path = join(folder, `${checkout}--${randomUUID()}.json`);
  // A taker reads only names that end in .json, so it never reads a record half written.
  writeFileSync(`${path}.writing`, JSON.stringify({ id }), { mode: 0o600 });
  renameSync(`${path}.writing`, path);
  return path;
}

/**
 * Seconds until Boat stops the machine, or 0 when it is gone, not ready or would never stop by
 * itself. Any other refusal throws, so the run falls back instead of paying for a new machine.
 */
async function lifeLeft(client: BoatClient, id: string): Promise<number> {
  let sandbox;
  try {
    sandbox = await client.sandbox(id);
  } catch (error) {
    if (error instanceof BoatError && error.status === 404) return 0;
    throw error;
  }
  if (!READY_STATES.has(sandbox.state) || !sandbox.archiveAfter) return 0;
  const stopsAt = Date.parse(sandbox.archiveAfter);
  // A deadline that does not parse is no deadline Boat is known to keep.
  return Number.isFinite(stopsAt) ? (stopsAt - Date.now()) / 1_000 : 0;
}

/** Reads the wipe script's text for `repository`: origin/main's copy, or a test's stand-in. */
type WipeScript = (repository: string) => string;

/** The command that runs the wipe script's text `script` with `args`, sent as text. */
function wipeCommand(script: string, args: readonly string[]): string {
  return `set -- ${args.map(shellQuote).join(' ')}\n${script}`;
}

/**
 * Runs the wipe script; a non-zero exit throws with the script's own reason. The login shell may
 * print after it, such as clear_console's complaint about TERM.
 */
async function runWipe(machine: Machine, command: string, signal: AbortSignal): Promise<void> {
  let output = '';
  const collect = (text: string) => {
    output += text;
  };
  const { exitCode } = await runScript(machine, command, { stdout: collect, stderr: collect }, signal);
  if (exitCode === 0) return;
  // Unanchored: stdout and stderr interleave, so the line may follow output without a newline.
  const reason = /\[boat\] wipe failed: ([^\n]*)/.exec(output)?.[1];
  throw new Error(reason ?? `the wipe exited ${exitCode}`);
}

/**
 * This checkout's kept machine with the most life left, when that is a run's life, else a new one
 * from `from`. Every other machine of the checkout is left over, from a killed run or past its use,
 * and is deleted, as is any machine of this workstation whose idle window passed without its reaper.
 * A kept machine another workstation evicted meanwhile is not taken. A start refused at the machine
 * limit evicts this workstation's idle machines, or else one another workstation kept idle for over
 * 10 minutes (machine-eviction.ts), and is tried once more. A new machine first records what its
 * snapshot holds, which every later wipe restores.
 */
export async function acquireMachine(
  client: BoatClient,
  input: {
    repository: string;
    from: string;
    name: string;
    log: (line: string) => void;
    signal: AbortSignal;
    /** The idle records' folder; a test's stand-in. */
    records?: string;
    wipeScript?: WipeScript;
  },
): Promise<{ machine: Machine; reused: boolean }> {
  const checkout = checkoutLabel(input.repository);
  const folder = input.records ?? IDLE_RECORDS;
  // A reaper can die with its workstation process; the next run here deletes what it left.
  for (const id of takeIdleRecords(folder, (_name, ageMs) => ageMs > IDLE_SECONDS * 1_000))
    await deleteLeftover(client, id, input.log);
  let kept: { id: string; life: number } | undefined;
  const taken = takeIdleRecords(folder, (name) => name.startsWith(`${checkout}--`));
  try {
    for (const id of taken) {
      const life = await lifeLeft(client, id);
      if (life >= RUN_LIFE_SECONDS && life > (kept?.life ?? 0)) kept = { id, life };
    }
    if (kept && !(await claimKeptMachine(client, kept.id, input.signal))) {
      input.log(`Boat machine ${kept.id} was taken by another workstation at the machine limit.`);
      kept = undefined;
    }
    // A refused listing throws, as any Boat failure before the run does: the run falls back.
    for (const { id } of await client.list({ purpose: 'werkflow-verify', checkout }))
      if (id !== kept?.id) await deleteLeftover(client, id, input.log);
  } catch (error) {
    // The records are taken, so no reaper deletes these machines any more: this run does.
    for (const id of taken) await deleteLeftover(client, id, input.log);
    throw error;
  }
  if (kept) return { machine: { id: kept.id, client, log: input.log }, reused: true };
  // Read before the start, so a script that cannot be read costs no start.
  const record = wipeCommand((input.wipeScript ?? mainWipeScript)(input.repository), ['record']);
  const create = () =>
    createMachine(client, {
      from: input.from,
      name: input.name,
      ttlSeconds: MACHINE_TTL_SECONDS,
      purpose: 'run',
      labels: { checkout, workstation: workstationLabel() },
      log: input.log,
      signal: input.signal,
    });
  let machine: Machine;
  try {
    machine = await create();
  } catch (error) {
    // Kept machines count toward the machines a member, and the plan, may run at once. At that
    // limit, this workstation's idle ones go, oldest first, or else one another workstation kept
    // idle for long, and the start is tried once more. Boat out of capacity or without a ready
    // machine is no limit of ours: deleting would not help.
    const limit =
      error instanceof BoatError &&
      error.status === 429 &&
      (error.code === 'member_limit_reached' || error.code === 'limit_reached')
        ? error.code
        : undefined;
    const evicted: string[] = [];
    // A record outlives its machine when another workstation evicted it; such a record frees nothing.
    for (const id of limit ? takeIdleRecords(folder, () => true) : [])
      if ((await lifeLeft(client, id).catch(() => 1)) > 0) evicted.push(id);
    if (limit && !evicted.length) evicted.push(...(await takeIdleMachineElsewhere(client, input.signal)));
    if (!evicted.length) throw error;
    for (const id of evicted) {
      input.log(`Boat refused a start at the machine limit (${limit}); deleting the idle machine ${id}.`);
      // Confirmed, so the machine no longer counts when the start is tried again.
      await deleteMachine({ id, client, log: input.log }, RUN_DELETION_CONFIRM_MS);
    }
    machine = await create();
  }
  try {
    await runWipe(machine, record, input.signal);
  } catch (error) {
    await deleteMachine(machine);
    throw error;
  }
  return { machine, reused: false };
}

/**
 * Runs `work` on a started machine, then hands the machine to `keep` when `work` returned a result,
 * and deletes it when `keep` declines or fails, `work` failed or the user interrupted. Its last line
 * says whether the machine was kept or why it was deleted, with its cost so far. A Ctrl-C during that cleanup still stops the run: no fallback to
 * a local run follows an interruption.
 */
export async function withMachine<T>(
  machine: Machine,
  signal: AbortSignal,
  work: () => Promise<T>,
  /** True when it kept the machine, else why not. */
  keep: (result: T) => Promise<true | string> = async () => 'the run keeps no machine',
): Promise<T> {
  let returned: { result: T } | undefined;
  try {
    returned = { result: await work() };
  } finally {
    // Read before the keep, so nothing awaits between the keep's last interruption check and the end.
    const usage = await machineUsage(machine);
    let kept: true | string = signal.aborted ? 'interrupted' : 'the run ended without a result';
    if (returned && !signal.aborted)
      kept = await keep(returned.result).catch(
        (error: unknown) => `wipe failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    // The run's user waits on this deletion, so its confirmation is short.
    if (kept !== true) await deleteMachine(machine, RUN_DELETION_CONFIRM_MS);
    const cost = usage ? `${Math.round(usage.seconds / 2)} s of large, $${usage.dollars.toFixed(4)}` : '';
    machine.log(
      kept === true
        ? `Boat machine ${machine.id} wiped and kept ${IDLE_SECONDS / 60} min for this checkout's next run${cost ? `; ${cost} so far` : ''}.`
        : `Boat machine ${machine.id} deleted: ${kept.replace(/\.$/, '')}${cost ? `; ${cost}` : ''}.`,
    );
  }
  signal.throwIfAborted();
  return returned.result;
}

/** Starts the detached reaper of one idle record (scripts/boat/reap-idle-machine.ts). */
function startReaper(repository: string, record: string): void {
  spawn(process.execPath, [resolve(repository, 'scripts/boat/reap-idle-machine.ts'), record], {
    detached: true,
    stdio: 'ignore',
  }).unref();
}

/**
 * Wipes the machine after a run and keeps it for this checkout's next run, with a reaper that deletes
 * it after IDLE_SECONDS unless a run took it. True when kept, else why not, such as too little of its
 * life left for another run; a failed wipe throws. Unless kept, the caller then deletes the machine.
 */
export async function keepMachine(
  machine: Machine,
  input: {
    repository: string;
    form: 'main' | 'linked';
    signal: AbortSignal;
    records?: string;
    wipeScript?: WipeScript;
  },
  reaper: (repository: string, record: string) => void = startReaper,
): Promise<true | string> {
  if ((await lifeLeft(machine.client, machine.id)) < RUN_LIFE_SECONDS)
    return 'under an hour of its life left';
  const script = (input.wipeScript ?? mainWipeScript)(input.repository);
  await runWipe(
    machine,
    wipeCommand(script, ['wipe', input.repository, input.form]) + MARK_IDLE,
    input.signal,
  );
  // A Ctrl-C deletes the machine: nothing is kept once the user interrupted.
  if (input.signal.aborted) return 'interrupted';
  const checkout = checkoutLabel(input.repository);
  reaper(input.repository, writeIdleRecord(checkout, machine.id, input.records ?? IDLE_RECORDS));
  return true;
}

/**
 * Deletes the machine of the idle record at `record` after `idleMs`, unless a run took the record
 * first. When this process dies, Boat's auto-stop still erases the wiped machine.
 */
export async function reapIdleMachine(
  record: string,
  idleMs = IDLE_SECONDS * 1_000,
  client: () => BoatClient | undefined = () => {
    const key = readBoatKey();
    return key.kind === 'usable' ? boatClient(key.key) : undefined;
  },
): Promise<void> {
  await sleep(idleMs);
  const id = takeIdleRecord(record);
  const signed = id === undefined ? undefined : client();
  if (id === undefined || signed === undefined) return;
  await deleteMachine({ id, client: signed, log: () => undefined });
}

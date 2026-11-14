import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { cpus, homedir, loadavg } from 'node:os';
import { join } from 'node:path';

// Admission by measured memory, and for a thread also by load (owner decision 19,
// werk-flow/werkflow-planning#294).
// No fixed number of threads or commands guards a workstation. Each start asks
// how much memory the machine can still hand over and is refused or delayed
// when its cost does not fit. On 2026-11-11 the PC reached load 68 because no
// start path looked: the heavy slots counted from total memory and never saw
// the 4.4 GiB that 18 agent processes held.
//
// Two owners, no copied threshold. The load watch (`ops/workstation-load.py
// --room` in werk-flow/werkflow-planning) owns the machine's state: what is
// available, the floor that must stay available, and whether the machine takes
// no start at all, and its normal load line. This module owns what a start
// costs. The alert reads the same watch, so the alert and these gates cannot
// disagree.
//
// Only Node built-ins: scripts/setup-worktree.ts imports this before the install.

const GIB = 1024 ** 3;

/**
 * What a start may take from the machine, in bytes.
 * - heavy: the peak of one heavy command, measured on the 16 GB PC: type-aware
 *   eslint 3.3 to 4.1 GiB, tsc 2.2 to 2.9, the build up to 3.
 * - setup: `bun install --frozen-lockfile` in a new worktree, measured on the PC: 19 MB resident
 *   with a warm package cache (0.2 s), 89 MB with an empty one (36 s). So a setup waits for a
 *   blocked machine or one at its floor, hardly ever for memory of its own.
 * - thread: one agent process with its MCP helpers. 18 on the PC held 4.4 GiB;
 *   8 `claude` processes on the Mac held 187 to 353 MB each.
 * - device: booting an iOS Simulator or Android Emulator and opening the web app in it. On the
 *   18 GB Mac on 2026-11-13 (werk-flow/werkflow-app#418) a boot and a sign-in took available
 *   memory from 3.1 to 2.4 GB and swap from 5.0 to 7.9 GB, and the load to 122.
 */
export const START_COST = { heavy: 4 * GIB, setup: 0.1 * GIB, thread: 0.5 * GIB, device: 3.5 * GIB } as const;
export type StartKind = keyof typeof START_COST;
export const isStartKind = (value: unknown): value is StartKind =>
  typeof value === 'string' && Object.hasOwn(START_COST, value);

/** The watch's answer for this machine at this moment, in bytes. */
type MachineRoom = {
  readonly available: number;
  /** What must stay available after a start. The watch raises it while its alert is open or swap fills. */
  readonly floor: number;
  /** Why the machine takes no start of any kind, or null. */
  readonly blocked: string | null;
  readonly alerted: boolean;
  /** The 15-minute load and the logical cores, measured as the watch measures them. */
  readonly load: number;
  readonly cores: number;
  /** The load watch's normal line for this machine: its alert counts a 15-minute load under it as normal. */
  readonly normalLoad: number;
};
/** The 15-minute load and the logical cores: the kernel numbers the load watch reads. */
export type MachineLoad = { readonly load: number; readonly cores: number };
/** A machine without a running watch has no room to read: `unwatched` says why and `fix` how to install it. */
export type RoomReading =
  | { readonly room: MachineRoom }
  | { readonly unwatched: string; readonly fix: string };
export type Admission = {
  readonly admitted: boolean;
  /** False when the start is admitted without the room it costs: on an unwatched machine, or as the only heavy command. */
  readonly measured: boolean;
  /** True on a machine without a running watch, where waiting changes nothing. */
  readonly unwatched: boolean;
  readonly reason: string;
};

type Environment = Readonly<Record<string, string | undefined>>;
type CommandResult = { readonly status: number | null; readonly stdout: string; readonly stderr: string };
type ProcessRow = { readonly pid: number; readonly parent: number; readonly resident: number };

const gib = (bytes: number): string => (bytes / GIB).toFixed(1);

/** The folder of the machine-wide heavy slots; each `slot-<n>` file names the pid of the command that holds it. */
export const heavySlotDirectory = (environment: Environment): string =>
  environment.WERKFLOW_HEAVY_SLOT_DIR ?? join(homedir(), '.cache', 'werkflow-heavy');

const watchScript = (environment: Environment): string =>
  environment.WERKFLOW_LOAD_WATCH ?? join(homedir(), 'code/werkflow-planning/ops/workstation-load.py');

/** How to install the watch on this machine (docs/technical/machine-setup.md, "Set up a new machine"). */
function watchFix(platform: NodeJS.Platform): string {
  const install =
    platform === 'darwin'
      ? 'python3 ops/install-mac.py'
      : 'install -Dm644 -t ~/.config/systemd/user ops/workstation-load.service ops/workstation-load.timer && systemctl --user daemon-reload && systemctl --user enable --now workstation-load.timer';
  return `Install the load watch: in ~/code/werkflow-planning (a clone of werk-flow/werkflow-planning), run \`git pull --ff-only && ${install}\`.`;
}

function runCommand(command: string, args: readonly string[]): CommandResult {
  const result = spawnSync(command, args, { encoding: 'utf8', timeout: 10_000 });
  // A program that is missing or ran out of time has no output to read: its error is the reading.
  if (result.error) return { status: null, stdout: '', stderr: result.error.message };
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

function parsedRoom(text: string): (MachineRoom & { readonly watching: boolean }) | undefined {
  let answer: unknown;
  try {
    answer = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (!answer || typeof answer !== 'object') return undefined;
  const available: unknown = Reflect.get(answer, 'available');
  const floor: unknown = Reflect.get(answer, 'floor');
  const blocked: unknown = Reflect.get(answer, 'blocked');
  const alerted: unknown = Reflect.get(answer, 'alerted');
  const watching: unknown = Reflect.get(answer, 'watching');
  if (typeof available !== 'number' || typeof floor !== 'number') return undefined;
  if (typeof alerted !== 'boolean' || typeof watching !== 'boolean') return undefined;
  if (blocked !== null && typeof blocked !== 'string') return undefined;
  return { available, floor, blocked, alerted, watching };
}

// A load that cannot be read counts as above every line.
const kernelLoad = (): MachineLoad => ({
  load: loadavg().at(2) ?? Number.POSITIVE_INFINITY,
  cores: cpus().length,
});

/**
 * The load watch's normal line per core, read from the watch itself (its
 * CLEAR_LOAD_PER_CORE), or undefined when the script names none.
 */
function normalLoadPerCore(script: string): number | undefined {
  let text: string;
  try {
    text = readFileSync(script, 'utf8');
  } catch {
    return undefined;
  }
  const perCore = /^CLEAR_LOAD_PER_CORE = (\d+(?:\.\d+)?)\s*(?:#.*)?$/m.exec(text)?.[1];
  return perCore === undefined ? undefined : Number(perCore);
}

/** Asks the load watch for this machine's room. Any answer but a complete one from a running watch is "unwatched". */
export function readMachineRoom(
  environment: Environment = process.env,
  run: (command: string, args: readonly string[]) => CommandResult = runCommand,
  platform: NodeJS.Platform = process.platform,
  measureLoad: () => MachineLoad = kernelLoad,
): RoomReading {
  const script = watchScript(environment);
  const fix = watchFix(platform);
  if (!existsSync(script)) return { unwatched: `no load watch at ${script}`, fix };
  const result = run('python3', ['-I', script, '--room']);
  const room = result.status === 0 ? parsedRoom(result.stdout) : undefined;
  if (!room) {
    const detail = result.stderr.trim().split('\n').at(-1) ?? '';
    return {
      unwatched: `the load watch gave no reading (exit ${result.status}${detail && `: ${detail}`})`,
      fix,
    };
  }
  if (!room.watching)
    return { unwatched: 'the load watch has the script but its timer wrote no sample in 5 minutes', fix };
  const perCore = normalLoadPerCore(script);
  if (perCore === undefined)
    return { unwatched: `the load watch at ${script} names no normal load line (CLEAR_LOAD_PER_CORE)`, fix };
  const { load, cores } = measureLoad();
  return {
    room: {
      available: room.available,
      floor: room.floor,
      blocked: room.blocked,
      alerted: room.alerted,
      load,
      cores,
      normalLoad: perCore * cores,
    },
  };
}

/** Every process as pid, parent and resident bytes, from one `ps` call (the columns are the same on Linux and macOS). */
export function processTable(
  run: (command: string, args: readonly string[]) => CommandResult = runCommand,
): ProcessRow[] {
  const rows: ProcessRow[] = [];
  for (const line of run('ps', ['-A', '-o', 'pid=,ppid=,rss=']).stdout.split('\n')) {
    const [pid, parent, kibibytes] = line.trim().split(/\s+/).map(Number);
    if (pid !== undefined && parent !== undefined && kibibytes !== undefined && Number.isInteger(pid))
      rows.push({ pid, parent, resident: kibibytes * 1024 });
  }
  return rows;
}

/**
 * The resident bytes of each running heavy command: the process tree of every
 * live pid a slot file names. A dead owner's file counts for nothing.
 */
export function runningHeavyCommands(directory: string, processes: readonly ProcessRow[]): number[] {
  if (!existsSync(directory)) return [];
  const children = new Map<number, ProcessRow[]>();
  for (const row of processes) children.set(row.parent, [...(children.get(row.parent) ?? []), row]);
  const live = new Map(processes.map((row) => [row.pid, row]));
  const use: number[] = [];
  for (const name of readdirSync(directory)) {
    if (!/^slot-\d+$/.test(name)) continue;
    const owner = live.get(Number.parseInt(readFileSync(join(directory, name), 'utf8'), 10));
    if (!owner) continue;
    let resident = 0;
    const seen = new Set<number>();
    for (let queue = [owner]; queue.length > 0; ) {
      const next: ProcessRow[] = [];
      for (const row of queue) {
        if (seen.has(row.pid)) continue;
        seen.add(row.pid);
        resident += row.resident;
        next.push(...(children.get(row.pid) ?? []));
      }
      queue = next;
    }
    use.push(resident);
  }
  return use;
}

const START_NOUN = { heavy: 'command', setup: 'setup', device: 'device' } as const;

const plural = (count: number, noun: string): string => `${count} ${noun}${count === 1 ? '' : 's'}`;

/**
 * The watch blocks every start on a macOS memory pressure of warn (its
 * `blocked`). Warn alone is no refusal here: on 2026-11-13 the Mac read warn
 * with one agent, load 2.8 on 11 cores and 3.1 GB available, the owner's
 * browsers holding the memory (werk-flow/werkflow-app#454). The measured
 * memory decides instead. Critical and every load block still refuse.
 */
const PRESSURE_WARN = 'macOS reports memory pressure: warn';

/**
 * Whether a start fits this machine now, with the numbers.
 * A macOS memory pressure of warn alone refuses nothing (PRESSURE_WARN).
 *
 * `heavy` is the resident bytes of each running heavy command. A heavy command
 * reserves its whole cost from the moment it starts, so the room for anything
 * new is what is available minus what each has not used yet.
 * - heavy: the first one runs whenever the machine is not blocked, so a machine
 *   full of idle agents still verifies, one command at a time. Each further one
 *   needs its cost in room above the floor.
 * - setup and device: their cost in room above the floor.
 * - thread: the machine, heavy commands aside, must still fit one heavy command
 *   after the thread, because every implementation thread ends in `check:changed`.
 *   A thread that leaves no room for it only adds a waiter. `threads` started in one call
 *   each cost an agent and share that one heavy command, since heavy commands take turns.
 *   Its 15-minute load must also be under the watch's normal line: on 2026-11-14 the VM ran
 *   at 29 to 55 on 16 cores with memory to spare, and a setup there waited an hour.
 * A machine without the watch admits a heavy command, a setup and a device,
 * and refuses a thread.
 */
export function admission(
  start: StartKind,
  reading: RoomReading,
  heavy: readonly number[],
  threads = 1,
): Admission {
  if ('unwatched' in reading) {
    const reason = `This machine's memory is not measured: ${reading.unwatched}. ${reading.fix}`;
    return { admitted: start !== 'thread', measured: false, unwatched: true, reason };
  }
  const { available, floor, load, cores, normalLoad } = reading.room;
  const blocked = reading.room.blocked === PRESSURE_WARN ? null : reading.room.blocked;
  if (blocked)
    return {
      admitted: false,
      measured: false,
      unwatched: false,
      reason: `This machine takes no start now: ${blocked}.`,
    };
  const cost = START_COST[start];
  const running =
    heavy.length === 0 ? 'no heavy command runs' : `${plural(heavy.length, 'heavy command')} running`;
  if (start === 'thread') {
    const held = heavy.reduce((sum, use) => sum + use, 0);
    const needed = floor + START_COST.heavy + cost * threads;
    const fits = available + held >= needed && load < normalLoad;
    return {
      admitted: fits,
      measured: fits,
      unwatched: false,
      reason: `${gib(available)} GiB available plus ${gib(held)} held by heavy commands (${running}); ${threads === 1 ? 'a thread needs' : `${threads} threads need`} ${gib(needed)}: the floor of ${gib(floor)}, ${gib(START_COST.heavy)} for a check:changed and ${gib(cost)} for each agent. The 15-minute load is ${load.toFixed(1)} on ${plural(cores, 'core')}; a thread needs it under ${normalLoad.toFixed(1)}, the load watch's normal line.`,
    };
  }
  const reserved = heavy.reduce((sum, use) => sum + Math.max(0, START_COST.heavy - use), 0);
  const room = available - reserved;
  const numbers = `${gib(room)} GiB of room (${gib(available)} available, ${gib(reserved)} still reserved, ${running}); it needs ${gib(floor + cost)}: the floor of ${gib(floor)} and ${gib(cost)} for the ${START_NOUN[start]}.`;
  const measured = room >= floor + cost;
  if (start === 'heavy' && heavy.length === 0 && !measured)
    return {
      admitted: true,
      measured,
      unwatched: false,
      reason: `${numbers} It is the only heavy command, so it runs without measured room.`,
    };
  return { admitted: measured, measured, unwatched: false, reason: numbers };
}

/**
 * Measures until the start is admitted, and returns that verdict, or the first
 * unwatched one, where waiting changes nothing. `waiting` hears the first
 * refusal; `pause` runs between two measurements.
 */
export async function waitForAdmission(
  measure: () => Admission,
  waiting: (verdict: Admission) => void,
  pause: () => Promise<void>,
): Promise<Admission> {
  for (let first = true; ; first = false) {
    const verdict = measure();
    if (verdict.admitted || verdict.unwatched) return verdict;
    if (first) waiting(verdict);
    await pause();
  }
}

/** The admission of a start on this machine, measured now. */
export function measuredAdmission(
  start: StartKind,
  environment: Environment = process.env,
  threads = 1,
): Admission {
  const reading = readMachineRoom(environment);
  const heavy =
    'room' in reading ? runningHeavyCommands(heavySlotDirectory(environment), processTable()) : [];
  return admission(start, reading, heavy, threads);
}

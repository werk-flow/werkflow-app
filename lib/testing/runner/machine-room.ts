import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

// Admission by measured memory (owner decision 19, werk-flow/werkflow-planning#294).
// No fixed number of threads or commands guards a workstation. Each start asks
// how much memory the machine can still hand over and is refused or delayed
// when its cost does not fit. On 2026-11-11 the PC reached load 68 because no
// start path looked: the heavy slots counted from total memory and never saw
// the 4.4 GiB that 18 agent processes held.
//
// Two owners, no copied threshold. The load watch (`ops/workstation-load.py
// --room` in werk-flow/werkflow-planning) owns the machine's state: what is
// available, the floor that must stay available, and whether the machine takes
// no start at all. This module owns what a start costs. The alert reads the
// same watch, so the alert and these gates cannot disagree.
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
 */
export const START_COST = { heavy: 4 * GIB, setup: 0.1 * GIB, thread: 0.5 * GIB } as const;
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
};
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

/** How to install the watch on this machine (docs/technical/environments.md, "Set up a new machine"). */
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

/** Asks the load watch for this machine's room. Any answer but a complete one from a running watch is "unwatched". */
export function readMachineRoom(
  environment: Environment = process.env,
  run: (command: string, args: readonly string[]) => CommandResult = runCommand,
  platform: NodeJS.Platform = process.platform,
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
  return {
    room: { available: room.available, floor: room.floor, blocked: room.blocked, alerted: room.alerted },
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

const plural = (count: number, noun: string): string => `${count} ${noun}${count === 1 ? '' : 's'}`;

/**
 * Whether a start fits this machine now, with the numbers.
 *
 * `heavy` is the resident bytes of each running heavy command. A heavy command
 * reserves its whole cost from the moment it starts, so the room for anything
 * new is what is available minus what each has not used yet.
 * - heavy: the first one runs whenever the machine is not blocked, so a machine
 *   full of idle agents still verifies, one command at a time. Each further one
 *   needs its cost in room above the floor.
 * - setup: its cost in room above the floor.
 * - thread: the machine, heavy commands aside, must still fit one heavy command
 *   after the thread, because every implementation thread ends in `check:changed`.
 *   A thread that leaves no room for it only adds a waiter.
 * A machine without the watch admits a heavy command and a setup, which keep
 * their own limits, and refuses a thread.
 */
export function admission(start: StartKind, reading: RoomReading, heavy: readonly number[]): Admission {
  if ('unwatched' in reading) {
    const reason = `This machine's memory is not measured: ${reading.unwatched}. ${reading.fix}`;
    return { admitted: start !== 'thread', measured: false, unwatched: true, reason };
  }
  const { available, floor, blocked } = reading.room;
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
    const fits = available + held >= floor + START_COST.heavy + cost;
    return {
      admitted: fits,
      measured: fits,
      unwatched: false,
      reason: `${gib(available)} GiB available plus ${gib(held)} held by heavy commands (${running}); a thread needs ${gib(floor + START_COST.heavy + cost)}: the floor of ${gib(floor)}, ${gib(START_COST.heavy)} for its own check:changed and ${gib(cost)} for its agent.`,
    };
  }
  const reserved = heavy.reduce((sum, use) => sum + Math.max(0, START_COST.heavy - use), 0);
  const room = available - reserved;
  const numbers = `${gib(room)} GiB of room (${gib(available)} available, ${gib(reserved)} still reserved, ${running}); it needs ${gib(floor + cost)}: the floor of ${gib(floor)} and ${gib(cost)} for the ${start === 'heavy' ? 'command' : 'setup'}.`;
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

/** The admission of a start on this machine, measured now. */
export function measuredAdmission(start: StartKind, environment: Environment = process.env): Admission {
  const reading = readMachineRoom(environment);
  const heavy =
    'room' in reading ? runningHeavyCommands(heavySlotDirectory(environment), processTable()) : [];
  return admission(start, reading, heavy);
}

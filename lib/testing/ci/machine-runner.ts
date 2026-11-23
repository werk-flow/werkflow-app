// The machine runner of the owner's machines (decision 0011, the `local` profile): a background
// process on the MacBook and on the PC that claims pull requests on GitHub and runs their PR runs
// by itself. scripts/ci/machine-runner.ts wires it; this module decides. Each tick, every 60 s:
//   1. It resolves the machine's window (windows.ts); a window file that cannot say holds every
//      admission and raises an alert.
//   2. While a run goes, it renews the run's lease as long as the run's process lives, and stops the
//      run when the PR's head moved, the lease is lost, or the window turns `off` before the run
//      can end: the run's Check is then completed as cancelled, never as a pass or a failure.
//   3. When a run ended, it posts the run's verdict, only while the run's lease still holds the head;
//      a stale verdict posts nothing and raises an alert.
//   4. While idle, it resizes the machine to the window's size (only between runs), takes the
//      eligible PRs in order, claims the first it can, admits it by the window, and starts it.
// The claim is the lease (lease.ts): one machine per PR head, the machines share no channel but
// GitHub. A restarted runner takes a new generation and never resumes a run of an older one.
import { z } from 'zod';
import { slotConfigSchema } from './container-slot';
import type { ClaimResult, HeldLease } from './lease';
import { asked, byQueuePlace, type QueuedPull } from './queue';
import { admitRun, resolveWindow } from './windows';

/** How often the runner ticks. */
export const TICK_MS = 60_000;
/** Beyond a run's expected time, so it still ends inside its window (windows.ts, admitRun). */
const RESERVE_MS = 120_000;
/**
 * After SIGTERM, a stopped run's process group gets SIGKILL this late: run-commit stops each job's
 * container meanwhile (60 s of grace, then docker kills it).
 */
export const KILL_AFTER_MS = 2 * 60_000;
/** The time a stopped run takes to end at most: the SIGKILL, and a minute to spare for the containers. */
const STOP_MS = KILL_AFTER_MS + 60_000;
/** Recorded runs below this count admit by the seed instead. */
const MIN_SAMPLES = 5;
/** The recorded durations kept per kind of run. */
const KEPT_SAMPLES = 30;
/** The kinds of run whose durations differ: a plan of every group, or one selected by the diff. */
const RUN_KINDS = ['full', 'selected'] as const;
type RunKind = (typeof RUN_KINDS)[number];

const absolute = z.string().startsWith('/');

/** One machine's configuration: a file outside the repository (ci/machines/*.example.json). */
export const machineConfigSchema = z.strictObject({
  /** The machine's id in its leases: lowercase letters, digits and hyphens. */
  machine: z.string().regex(/^[a-z0-9-]{1,20}$/),
  /** `owner/name` on GitHub. */
  repository: z.string().regex(/^[\w.-]+\/[\w.-]+$/),
  /** The pinned, reviewed clone the runner runs from; never a PR under test. */
  trustedCheckout: absolute,
  /** The runner's own state: its generation, its run, the recorded durations. Outside every slot. */
  stateDir: absolute,
  /** The machine's window file (windows.ts). */
  windowsFile: absolute,
  /** The CI App's private key, PEM, which mints the token the publisher posts `Check` with. */
  appKeyFile: absolute,
  slot: slotConfigSchema,
  /** The machine's sizes the window file names, each with the command that resizes the slot, or null. */
  sizes: z.record(
    z.string().min(1),
    z.strictObject({ resize: z.array(z.string().min(1)).min(1).nullable() }),
  ),
  /** Seconds a run of each kind takes here, until enough runs are recorded. */
  seedSeconds: z.strictObject({ full: z.number().int().positive(), selected: z.number().int().positive() }),
  /** The lease's time to live; a heartbeat renews it every tick. */
  leaseTtlSeconds: z.number().int().min(300).max(1_800).default(600),
});
export type MachineConfig = z.infer<typeof machineConfigSchema>;

const heldSchema = z.strictObject({
  checkRun: z.number().int().positive(),
  lease: z.strictObject({
    machine: z.string(),
    generation: z.number().int().nonnegative(),
    expiresAt: z.number().int().nonnegative(),
  }),
});

const currentSchema = z.strictObject({
  pull: z.number().int().positive(),
  head: z.string().regex(/^[0-9a-f]{40}$/),
  runUrl: z.string().min(1),
  /** The run's folder on the trusted side: run-commit's results and the stop marker. */
  runDir: absolute,
  held: heldSchema,
  startedAt: z.number().int(),
  kind: z.enum(RUN_KINDS),
  /** The run's process group, so a restarted runner can end it. */
  processGroup: z.number().int().positive().nullable(),
  /** Why the runner stopped the run; its end then posts nothing. */
  stopped: z.string().nullable(),
});
export type CurrentRun = z.infer<typeof currentSchema>;

export const runnerStateSchema = z.strictObject({
  current: currentSchema.nullable(),
  /** The size the runner last resized the slot to, or null before the first. */
  size: z.string().nullable(),
  durations: z.strictObject({
    full: z.array(z.number().positive()),
    selected: z.array(z.number().positive()),
  }),
  /** Heads with a verdict or a run that never started twice: no later tick claims them. */
  settled: z.array(z.string()),
  /** Heads whose run never started once: a second such run settles them. */
  unstarted: z.array(z.string()),
  /** The alerts raised and still standing, so each raises once. */
  alerted: z.array(z.string()),
});
export type RunnerState = z.infer<typeof runnerStateSchema>;

export const EMPTY_STATE: RunnerState = {
  current: null,
  size: null,
  durations: { full: [], selected: [] },
  settled: [],
  unstarted: [],
  alerted: [],
};

/** What a verdict's post came to (lease.ts, postVerdict). */
type Posted = 'posted' | 'stale' | { problem: string };

/**
 * A PR run's lease on its head, the CI App's `Check` check run (lease.ts): the claim is the run's
 * queued start, and only while it holds is anything posted on it. Times are epoch seconds.
 */
export type RunLease = {
  claim(run: { pull: QueuedPull; runUrl: string; generation: number }, now: number): Promise<ClaimResult>;
  heartbeat(run: CurrentRun, now: number): Promise<HeldLease | 'lost'>;
  /** Completes the run's Check with its verdict from its results (check-app.ts, checkRunOf). */
  verdict(run: CurrentRun, now: number): Promise<Posted>;
  /** Completes the run's Check as cancelled: never a pass or a failure. */
  cancel(run: CurrentRun, now: number, detail: string): Promise<Posted>;
};

/** A run's process as the runner sees it: alive, or ended with run-commit's exit and its plan's kind. */
export type RunStatus =
  | { state: 'running' }
  | { state: 'ended'; exitCode: number | null; full: boolean | null };

/** Starting, watching and stopping run-commit for one run (scripts/ci/machine-runner.ts). */
type RunControl = {
  start(run: {
    pull: QueuedPull;
    base: string;
    runUrl: string;
    runDir: string;
    generation: number;
  }): Promise<{
    processGroup: number | null;
  }>;
  status(run: CurrentRun): Promise<RunStatus>;
  /** Marks the run stopped, so its publisher posts nothing, then ends its process group. */
  stop(run: CurrentRun): Promise<void>;
};

type Alert = { kind: 'hold' | 'foreign-pending' | 'stale' | 'lost-lease' | 'unstarted'; detail: string };

const postedLine = (posted: Posted): string =>
  typeof posted === 'string' ? posted : `not posted: ${posted.problem}`;

export type RunnerPorts = {
  config: MachineConfig;
  generation: number;
  /** Epoch milliseconds. */
  now(): number;
  /** The machine's window file as JSON, or its text when it is no JSON (windows.ts holds then). */
  windows(): unknown;
  /** Every open PR against main, current (queue-github.ts). */
  pulls(): Promise<readonly QueuedPull[]>;
  /** main's head commit. */
  main(): Promise<string>;
  lease: RunLease;
  runs: RunControl;
  resize(command: readonly string[]): Promise<void>;
  load(): RunnerState;
  save(state: RunnerState): void;
  alert(alert: Alert): Promise<void>;
  log(line: string): void;
};

/** The `p`th percentile of `values`, by nearest rank. */
export function percentile(values: readonly number[], p: number): number {
  const sorted = values.toSorted((left, right) => left - right);
  const rank = Math.max(1, Math.ceil((p / 100) * sorted.length));
  const value = sorted[rank - 1];
  if (value === undefined) throw new Error('No value to take a percentile of.');
  return value;
}

/** How long a run of `kind` is expected to take here: the 90th percentile of its recorded runs, or the seed. */
function expectedMs(config: MachineConfig, state: RunnerState, kind: RunKind): number {
  const recorded = state.durations[kind];
  return (recorded.length >= MIN_SAMPLES ? percentile(recorded, 90) : config.seedSeconds[kind]) * 1_000;
}

/**
 * The PRs a machine may take, in order: ready and not conflicting with main, without a settled
 * verdict on their head. Queued PRs (auto-merge on) first, in the queue's order (queue.ts), then
 * the others by number.
 */
export function eligiblePulls(pulls: readonly QueuedPull[], settled: readonly string[]): QueuedPull[] {
  const open = pulls.filter(
    (pull) =>
      !pull.isDraft &&
      pull.mergeState !== 'DIRTY' &&
      pull.check !== 'SUCCESS' &&
      !settled.includes(pull.headSha),
  );
  return [
    ...open.filter(asked).toSorted(byQueuePlace),
    ...open.filter((pull) => !asked(pull)).toSorted((left, right) => left.number - right.number),
  ];
}

/** Whether the window turns `off` before a run still going now could end its stop. */
export function offEdgeAhead(windowFile: unknown, now: number): boolean {
  const window = resolveWindow(windowFile, new Date(now));
  if (window.kind === 'off') return true;
  if (window.kind !== 'open' || window.until === null) return false;
  if (now + TICK_MS + STOP_MS < window.until.getTime()) return false;
  return resolveWindow(windowFile, window.until).kind === 'off';
}

const keep = (list: readonly string[], item: string): string[] =>
  [...list.filter((entry) => entry !== item), item].slice(-200);
const seconds = (ms: number): number => Math.floor(ms / 1_000);

/** Raises the alert once while it stands: `key` names it. */
async function alertOnce(
  ports: RunnerPorts,
  state: RunnerState,
  key: string,
  alert: Alert,
): Promise<RunnerState> {
  if (state.alerted.includes(key)) return state;
  await ports.alert(alert);
  return { ...state, alerted: keep(state.alerted, key) };
}

/**
 * One tick of the runner. It saves its state after every step that changes it, so a runner that
 * dies between steps restarts from what it did.
 */
export async function tick(ports: RunnerPorts): Promise<string> {
  let state = ports.load();
  const now = ports.now();
  const windowFile = ports.windows();
  const window = resolveWindow(windowFile, new Date(now));
  if (window.kind === 'hold') {
    state = await alertOnce(ports, state, `hold:${window.reason}`, { kind: 'hold', detail: window.reason });
    ports.save(state);
  } else if (state.alerted.some((key) => key.startsWith('hold:'))) {
    state = { ...state, alerted: state.alerted.filter((key) => !key.startsWith('hold:')) };
    ports.save(state);
  }
  if (state.current) return supervise(ports, state, state.current, windowFile);
  if (window.kind !== 'open') return window.kind === 'off' ? 'the window is off' : `held: ${window.reason}`;
  return admitNext(ports, state, windowFile, window.size);
}

/** Stops the run for `reason`; when the runner still holds the lease, its Check ends as cancelled. */
async function stopRun(
  ports: RunnerPorts,
  state: RunnerState,
  run: CurrentRun,
  reason: string,
  cancel: boolean,
): Promise<string> {
  const stopped = { ...run, stopped: reason };
  ports.save({ ...state, current: stopped });
  await ports.runs.stop(stopped);
  const posted = cancel
    ? `; its Check: ${postedLine(await ports.lease.cancel(stopped, seconds(ports.now()), reason))}`
    : '';
  return `stopped #${run.pull}: ${reason}${posted}`;
}

async function supervise(
  ports: RunnerPorts,
  initial: RunnerState,
  run: CurrentRun,
  windowFile: unknown,
): Promise<string> {
  let state = initial;
  const status = await ports.runs.status(run);
  const now = ports.now();
  if (status.state === 'ended') {
    const kind: RunKind = status.full === true ? 'full' : status.full === false ? 'selected' : run.kind;
    let line = `#${run.pull} ended with ${status.exitCode ?? 'a stop'}`;
    state = { ...state, current: null };
    if (run.stopped !== null) line += ` after its stop: ${run.stopped}`;
    else if (status.exitCode === 0 || status.exitCode === 1) {
      const posted = await ports.lease.verdict(run, seconds(now));
      line += `; its verdict: ${postedLine(posted)}`;
      // A posted verdict settles the head and counts the run's duration.
      if (posted === 'posted')
        state = {
          ...state,
          durations: {
            ...state.durations,
            [kind]: [...state.durations[kind], (now - run.startedAt) / 1_000].slice(-KEPT_SAMPLES),
          },
          settled: keep(state.settled, run.head),
        };
      else
        state = await alertOnce(ports, state, `stale:${run.head}:${run.held.checkRun}`, {
          kind: 'stale',
          detail: `#${run.pull}'s run on ${ports.config.machine} ended, but its verdict was not posted: ${postedLine(posted)} (${run.runUrl}).`,
        });
    } else {
      // The run never reached a verdict: its Check ends as cancelled, and a second such run of the
      // head settles it for a person.
      line += `; its Check: ${postedLine(await ports.lease.cancel(run, seconds(now), 'The run ended without a verdict.'))}`;
      if (state.unstarted.includes(run.head)) {
        state = { ...state, settled: keep(state.settled, run.head) };
        state = await alertOnce(ports, state, `unstarted:${run.head}`, {
          kind: 'unstarted',
          detail: `#${run.pull}'s run on ${ports.config.machine} ended twice without a verdict (${run.runUrl}); the machine leaves the head to a person.`,
        });
      } else state = { ...state, unstarted: keep(state.unstarted, run.head) };
    }
    ports.save(state);
    return line;
  }
  if (run.stopped !== null) return `#${run.pull} is stopping: ${run.stopped}`;
  // The run's process lives: that liveness alone renews the lease, before anything else is posted.
  const renewed = await ports.lease.heartbeat(run, seconds(now));
  if (renewed === 'lost') {
    const line = await stopRun(ports, state, run, 'Its lease was lost.', false);
    const after = await alertOnce(ports, ports.load(), `lost:${run.head}:${run.held.checkRun}`, {
      kind: 'lost-lease',
      detail: `#${run.pull}'s run on ${ports.config.machine} lost its lease and was stopped (${run.runUrl}).`,
    });
    ports.save(after);
    return line;
  }
  const held = { ...run, held: renewed };
  ports.save({ ...state, current: held });
  // The window turns off before the run could end: stopped now, it ends before the edge.
  if (offEdgeAhead(windowFile, now))
    return stopRun(ports, state, held, 'The machine’s window turns off.', true);
  const pull = (await ports.pulls()).find((candidate) => candidate.number === run.pull);
  if (!pull || pull.headSha !== run.head || pull.isDraft)
    return stopRun(ports, state, held, `#${run.pull} moved on: its head is no longer ${run.head}.`, true);
  return `#${run.pull} runs; its lease holds until ${new Date(renewed.lease.expiresAt * 1_000).toISOString()}`;
}

async function admitNext(
  ports: RunnerPorts,
  initial: RunnerState,
  windowFile: unknown,
  size: string,
): Promise<string> {
  let state = initial;
  const { config } = ports;
  const sized = config.sizes[size];
  if (!sized) {
    state = await alertOnce(ports, state, `hold:size ${size}`, {
      kind: 'hold',
      detail: `The window names the size ${size}, which ${config.machine}'s configuration lacks.`,
    });
    ports.save(state);
    return `held: no size ${size}`;
  }
  // The slot is resized only here, while no run goes.
  if (state.size !== size) {
    if (sized.resize) await ports.resize(sized.resize);
    state = { ...state, size };
    ports.save(state);
  }
  const now = ports.now();
  const admission = admitRun(windowFile, new Date(now), {
    expectedMs: expectedMs(config, state, 'selected'),
    reserveMs: RESERVE_MS,
  });
  if (!admission.admit) return `not admitted: ${admission.reason}`;
  const pulls = await ports.pulls();
  for (const pull of eligiblePulls(pulls, state.settled)) {
    const name = `pr${pull.number}-${pull.headSha.slice(0, 12)}-${config.machine}-g${ports.generation}`;
    const runUrl = `https://github.com/${config.repository}/commit/${pull.headSha}#${name}`;
    const claimed = await ports.lease.claim({ pull, runUrl, generation: ports.generation }, seconds(now));
    if (!claimed.claimed) {
      if (claimed.reason === 'verdict') {
        state = { ...state, settled: keep(state.settled, pull.headSha) };
        ports.save(state);
      } else if (claimed.reason === 'foreign-pending') {
        state = await alertOnce(ports, state, `foreign:${pull.headSha}`, {
          kind: 'foreign-pending',
          detail: `#${pull.number}'s head ${pull.headSha} has a queued Check that holds no lease, so no machine takes it.`,
        });
        ports.save(state);
      }
      continue;
    }
    const base = await ports.main();
    const runDir = `${config.stateDir}/runs/${name}`;
    const current: CurrentRun = {
      pull: pull.number,
      head: pull.headSha,
      runUrl,
      runDir,
      held: claimed.held,
      startedAt: now,
      kind: 'selected',
      processGroup: null,
      stopped: null,
    };
    // Saved before the start, so a runner that dies during it still knows the run to end.
    ports.save({ ...state, current });
    const { processGroup } = await ports.runs.start({
      pull,
      base,
      runUrl,
      runDir,
      generation: ports.generation,
    });
    ports.save({ ...state, current: { ...current, processGroup } });
    return `started #${pull.number} at ${pull.headSha} (${runUrl})`;
  }
  return 'no eligible pull request';
}

/**
 * Ends a run's process group by the id the runner recorded, never by a name or pattern: SIGTERM now,
 * then SIGKILL after KILL_AFTER_MS when the group still lives. `afterKill` runs once the SIGKILL
 * went out, for the job containers the killed run-commit could not stop.
 */
export function stopProcessGroup(
  group: number,
  signal: (pid: number, name: 'SIGTERM' | 'SIGKILL' | 0) => boolean,
  later: (ms: number, act: () => void) => void,
  afterKill: () => void,
): void {
  if (!signal(-group, 0)) return;
  signal(-group, 'SIGTERM');
  later(KILL_AFTER_MS, () => {
    if (signal(-group, 0) && signal(-group, 'SIGKILL')) afterKill();
  });
}

/**
 * Before its first claim, a restarted runner ends the run an older generation left: its process
 * group, and its Check as cancelled while that lease still holds. It never resumes it.
 */
export async function recover(ports: RunnerPorts): Promise<string | undefined> {
  const state = ports.load();
  const run = state.current;
  if (!run) return undefined;
  const stopped = { ...run, stopped: run.stopped ?? 'The machine runner restarted.' };
  await ports.runs.stop(stopped);
  const posted = await ports.lease.cancel(stopped, seconds(ports.now()), 'The machine runner restarted.');
  ports.save({ ...state, current: null });
  return `ended #${run.pull}'s run of generation ${run.held.lease.generation}; its Check: ${postedLine(posted)}`;
}

// The machine runner of the owner's machines (decision 0011, the `local` profile): a background
// process on the MacBook and on the PC that claims pull requests on GitHub and runs each one's
// integration run, the run that includes the browser groups the plan selects, on the PR's
// up-to-date head. scripts/ci/machine-runner.ts wires it; this module decides. Each tick, every 60 s:
//   1. Before any network call, it stops a run whose window edge is near, from local state alone.
//   2. It retries what it could not deliver: Check completions and alerts.
//   3. While a run goes, it renews the run's lease ref (lease.ts) and stops the run when it outran its
//      ceiling, its PR's head moved or its lease was lost. A stopped run's Check ends cancelled.
//   4. When a run ended, it re-reads the PR's head, approval and the active profile, marks the lease
//      done and only then completes the attempt's own Check with the verdict.
//   5. While idle and clean, it resizes the slot to the window's size (only between runs), takes the
//      eligible PRs in order, claims the first it can, admits it by the window, and starts it.
// A restarted runner takes a new generation and never resumes a run of an older one.
import { z } from 'zod';
import { slotConfigSchema } from './container-slot';
import type { RunnerPull } from './machine-pulls';
import { CI_DAG, CI_JOBS } from './dag';
import { claim, heartbeat, type LeaseRefs, markDone, release } from './lease';
import { asked, byQueuePlace, upToDate } from './queue';
import type { RunPlan } from './results';
import { jobShards } from './run-plan';
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
/** The time a stopped run takes to end at most: the SIGKILL, and a minute for its containers. */
const STOP_MS = KILL_AFTER_MS + 60_000;
/**
 * How long before the window turns off a run is stopped: two ticks, so one slow tick still stops it
 * in time, and the stop itself. The watchdog (scripts/ci/machine-watchdog.ts) stops it at the same
 * instant if the runner does not.
 */
export const EDGE_MARGIN_MS = 2 * TICK_MS + STOP_MS;
/** A job's staging and handoff beyond its own timeout, for the run's ceiling. */
const STAGE_MS = 20 * 60_000;
/** Recorded runs below this count admit by the seed instead. */
const MIN_SAMPLES = 5;
/** The recorded durations kept per kind of run. */
const KEPT_SAMPLES = 30;
type RunKind = 'full' | 'selected';
/** The author associations whose PRs a machine runs: this repository's people, never a stranger's fork. */
const TRUSTED_AUTHORS = ['OWNER', 'MEMBER', 'COLLABORATOR'];

const absolute = z.string().startsWith('/');

/** One machine's configuration: a file outside the repository (ci/machines/*.example.json). */
export const machineConfigSchema = z.strictObject({
  /** The machine's id in its leases: lowercase letters, digits and hyphens. */
  machine: z.string().regex(/^[a-z0-9-]{1,20}$/),
  /** `owner/name` on GitHub. */
  repository: z.string().regex(/^[\w.-]+\/[\w.-]+$/),
  /** The pinned, reviewed clone the runner runs from; never a PR under test. */
  trustedCheckout: absolute,
  /** The runner's own state: its generation, attempts, run, recorded durations. Outside every slot. */
  stateDir: absolute,
  /** The machine's window file (windows.ts). */
  windowsFile: absolute,
  /** The CI App's private key, PEM, mode 600: one file on the runner's side, never in the slot. */
  appKeyFile: absolute,
  slot: slotConfigSchema,
  /** Addresses the slot's jobs must not reach, `host:port`: the start probe tries each. */
  probePorts: z.array(z.string().regex(/^[\w.-]+:[0-9]{1,5}$/)),
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
  oid: z.string().min(1),
  lease: z.strictObject({
    machine: z.string(),
    generation: z.number().int().nonnegative(),
    attempt: z.number().int().nonnegative(),
    expiresAt: z.number().int().nonnegative(),
    state: z.enum(['held', 'done', 'released']),
    approval: z.boolean(),
  }),
});

const currentSchema = z.strictObject({
  pull: z.number().int().positive(),
  head: z.string().regex(/^[0-9a-f]{40}$/),
  /** The approval the run saw. */
  approval: z.boolean(),
  attempt: z.number().int().positive(),
  runUrl: z.string().min(1),
  /** The run's own folder on the trusted side: run-commit's results and its exit. */
  runDir: absolute,
  held: heldSchema,
  /** The attempt's own `Check` check run. */
  checkRun: z.number().int().positive(),
  startedAt: z.number().int(),
  /** When the run must be stopped by, before the window turns off; null when no edge lies ahead. */
  stopBy: z.number().int().nullable(),
  /** The run's process group, so a stop or a restarted runner can end it. */
  processGroup: z.number().int().positive().nullable(),
});
export type CurrentRun = z.infer<typeof currentSchema>;

/** A `Check` completion still owed: its delivery failed and is retried every tick. */
const completionSchema = z.strictObject({
  head: z.string(),
  checkRun: z.number().int().positive(),
  runUrl: z.string(),
  runDir: absolute,
  startedAt: z.number().int(),
  approval: z.boolean(),
  kind: z.enum(['verdict', 'cancelled']),
  reason: z.string(),
});
export type Completion = z.infer<typeof completionSchema>;

const alertSchema = z.strictObject({
  kind: z.enum(['hold', 'untrusted', 'old-head', 'foreign', 'stale', 'lost-lease', 'unstarted', 'dirty']),
  detail: z.string(),
});
type Alert = z.infer<typeof alertSchema>;

export const runnerStateSchema = z.strictObject({
  current: currentSchema.nullable(),
  /** The size the runner last resized the slot to, or null before the first. */
  size: z.string().nullable(),
  durations: z.strictObject({
    full: z.array(z.number().positive()),
    selected: z.array(z.number().positive()),
  }),
  /** Why the slot is not shown clean after a stop: nothing is admitted while it is set. */
  dirty: z.string().nullable(),
  pendingCompletions: z.array(completionSchema),
  pendingAlerts: z.array(alertSchema),
  /** The alerts raised and still standing, so each raises once. */
  alerted: z.array(z.string()),
  /** Heads whose run ended without a verdict once; a second time parks them. */
  unstarted: z.array(z.string()),
  /** Heads this machine leaves to a person. */
  parked: z.array(z.string()),
});
export type RunnerState = z.infer<typeof runnerStateSchema>;

export const EMPTY_STATE: RunnerState = {
  current: null,
  size: null,
  durations: { full: [], selected: [] },
  dirty: null,
  pendingCompletions: [],
  pendingAlerts: [],
  alerted: [],
  unstarted: [],
  parked: [],
};

/** A run's process as the runner sees it. `plan` once Plan wrote it, for the run's ceiling. */
export type RunStatus =
  | { state: 'running'; plan: RunPlan | null }
  | { state: 'ended'; exitCode: number | null; full: boolean | null };

/** The slot shown clean after a stop, or why not. */
type Cleanup = { clean: true } | { clean: false; reason: string };

/** Starting, watching and stopping run-commit for one run (scripts/ci/machine-runner.ts). */
type RunControl = {
  start(run: {
    pull: RunnerPull;
    base: string;
    runUrl: string;
    runDir: string;
    attempt: number;
    stopBy: number | null;
  }): Promise<{ processGroup: number | null }>;
  status(run: CurrentRun): Promise<RunStatus>;
  /** Ends the run's process group, its job and staging containers and any Supabase stack, and verifies it. */
  stop(run: CurrentRun): Promise<Cleanup>;
  /** Whether the slot holds no container of a run. */
  clean(): Promise<Cleanup>;
};

export type RunnerPorts = {
  config: MachineConfig;
  generation: number;
  /** Epoch milliseconds. */
  now(): number;
  /** The machine's window file as JSON, or its text when it is no JSON (windows.ts holds then). */
  windows(): unknown;
  /** The CI profile main's switch names (profiles.ts, activeProfile). */
  profile(): Promise<string>;
  pulls(): Promise<readonly RunnerPull[]>;
  /** main's head commit. */
  main(): Promise<string>;
  /** Whether `sha` holds `base` (up to date with main) and reads GitHub from a snapshot (github-snapshot.ts). */
  head(sha: string, base: string): Promise<{ upToDate: boolean; snapshotReader: boolean }>;
  /** The image's immutable id is still the one verified at start, or why not. */
  image(): Promise<string | undefined>;
  refs: LeaseRefs & { list(): Promise<{ sha: string; oid: string }[]> };
  checks: {
    /** The attempt's own queued `Check` check run (check-app.ts, queuedCheckRunOf); its id. */
    start(run: { head: string; runUrl: string }): Promise<number>;
    /** Completes check run `checkRun` by its id: the verdict from the run's results, or cancelled. */
    complete(completion: Completion): Promise<void>;
  };
  runs: RunControl;
  /** The next attempt number, durable before it is returned (lease.ts, nextGeneration). */
  nextAttempt(): number;
  resize(command: readonly string[]): Promise<void>;
  load(): RunnerState;
  save(state: RunnerState): void;
  /** Files the alert; false when it could not be delivered. */
  alert(alert: Alert): Promise<boolean>;
  log(line: string): void;
};

/**
 * Ends a run's process group by the id the runner recorded, never by a name or pattern: SIGTERM, up
 * to KILL_AFTER_MS for it to end, then SIGKILL. True once the group is gone.
 */
export async function endProcessGroup(
  group: number,
  signal: (pid: number, name: 'SIGTERM' | 'SIGKILL' | 0) => boolean,
  wait: (ms: number) => Promise<void>,
): Promise<boolean> {
  if (!signal(-group, 0)) return true;
  signal(-group, 'SIGTERM');
  for (let waited = 0; waited < KILL_AFTER_MS; waited += 2_000) {
    await wait(2_000);
    if (!signal(-group, 0)) return true;
  }
  signal(-group, 'SIGKILL');
  for (let waited = 0; waited < 10_000; waited += 1_000) {
    await wait(1_000);
    if (!signal(-group, 0)) return true;
  }
  return false;
}

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

/** The longest a run of `plan` may take: each unit's timeout and its staging; before Plan, Plan's. */
export function ceilingMs(plan: RunPlan | null): number {
  if (plan === null) return CI_DAG.plan.timeoutMinutes * 60_000 + STAGE_MS;
  return CI_JOBS.filter((job) => job === 'plan' || plan.jobs.includes(job)).reduce(
    (sum, job) =>
      sum + (jobShards(job, plan)?.length ?? 1) * (CI_DAG[job].timeoutMinutes * 60_000 + STAGE_MS),
    0,
  );
}

/** Whether this repository's people opened the PR: no fork, no stranger. */
const trustedPull = (pull: RunnerPull): boolean =>
  pull.sameRepository && TRUSTED_AUTHORS.includes(pull.association);

/**
 * The PRs a machine may take, in order: ready, up to date with main and not conflicting, opened by
 * this repository's people, not parked here. Queued PRs (auto-merge on) first, in the queue's order
 * (queue.ts), then the others by number.
 */
function eligiblePulls(pulls: readonly RunnerPull[], parked: readonly string[]): RunnerPull[] {
  const open = pulls.filter(
    (pull) => !pull.isDraft && upToDate(pull) && trustedPull(pull) && !parked.includes(pull.headSha),
  );
  return [
    ...open.filter(asked).toSorted(byQueuePlace),
    ...open.filter((pull) => !asked(pull)).toSorted((left, right) => left.number - right.number),
  ];
}

/** The next instant the window turns off, from `now`; null when none lies ahead or the file holds. */
export function nextOffEdge(windowFile: unknown, now: number): number | null {
  let at = now;
  for (let step = 0; step < 64; step++) {
    const window = resolveWindow(windowFile, new Date(at));
    if (window.kind === 'off') return at;
    if (window.kind !== 'open' || window.until === null) return null;
    at = window.until.getTime();
  }
  return null;
}

const stopByOf = (edge: number | null): number | null => (edge === null ? null : edge - EDGE_MARGIN_MS);
const keep = (list: readonly string[], item: string): string[] =>
  [...list.filter((entry) => entry !== item), item].slice(-200);
const seconds = (ms: number): number => Math.floor(ms / 1_000);
const message = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/** Queues the alert once while it stands (`key` names it); `deliver` files it. */
function alertOnce(state: RunnerState, key: string, alert: Alert): RunnerState {
  if (state.alerted.includes(key)) return state;
  return { ...state, alerted: keep(state.alerted, key), pendingAlerts: [...state.pendingAlerts, alert] };
}

/** Files the queued alerts and completes the owed Checks; what fails stays queued for the next tick. */
async function deliver(ports: RunnerPorts, initial: RunnerState): Promise<RunnerState> {
  let state = initial;
  const alerts: Alert[] = [];
  for (const alert of state.pendingAlerts)
    if (!(await ports.alert(alert).catch(() => false))) alerts.push(alert);
  const completions: Completion[] = [];
  for (const completion of state.pendingCompletions)
    await ports.checks.complete(completion).catch((error: unknown) => {
      ports.log(`[runner] check run ${completion.checkRun} stays owed: ${message(error)}`);
      completions.push(completion);
    });
  state = { ...state, pendingAlerts: alerts, pendingCompletions: completions };
  ports.save(state);
  return state;
}

/** Owes the run's Check its completion and tries to deliver it now. */
const owe = (state: RunnerState, run: CurrentRun, kind: Completion['kind'], reason: string): RunnerState => ({
  ...state,
  pendingCompletions: [
    ...state.pendingCompletions,
    {
      head: run.head,
      checkRun: run.checkRun,
      runUrl: run.runUrl,
      runDir: run.runDir,
      startedAt: run.startedAt,
      approval: run.approval,
      kind,
      reason,
    },
  ],
});

/**
 * One tick of the runner. It saves its state after every step that changes it, so a runner that
 * dies between steps restarts from what it did.
 */
export async function tick(ports: RunnerPorts): Promise<string> {
  const line = await step(ports);
  // What the step queued goes out at once; what fails waits for the next tick.
  await deliver(ports, ports.load());
  return line;
}

async function step(ports: RunnerPorts): Promise<string> {
  let state = ports.load();
  const current = state.current;
  // The edge first, from local state only: no answer from GitHub may delay this stop.
  if (current && current.stopBy !== null && ports.now() >= current.stopBy)
    return stopRun(ports, state, current, 'The machine’s window turns off.', true);
  state = await deliver(ports, state);
  const now = ports.now();
  const windowFile = ports.windows();
  const window = resolveWindow(windowFile, new Date(now));
  if (window.kind === 'hold')
    state = alertOnce(state, `hold:${window.reason}`, { kind: 'hold', detail: window.reason });
  else state = { ...state, alerted: state.alerted.filter((key) => !key.startsWith('hold:')) };
  ports.save(state);
  if (state.current) return supervise(ports, state, state.current, windowFile);
  if (state.dirty !== null) {
    const cleanup = await ports.runs.clean();
    if (!cleanup.clean) {
      ports.save(
        alertOnce(state, `dirty:${cleanup.reason}`, {
          kind: 'dirty',
          detail: `${ports.config.machine}'s slot is not clean, so it admits nothing: ${cleanup.reason}`,
        }),
      );
      return `held: the slot is not clean: ${cleanup.reason}`;
    }
    state = { ...state, dirty: null };
    ports.save(state);
  }
  const profile = await ports.profile();
  if (profile !== 'local') {
    ports.save(
      alertOnce(state, `profile:${profile}`, {
        kind: 'hold',
        detail: `main's CI profile is ${profile}, so ${ports.config.machine} runs nothing.`,
      }),
    );
    return `held: the active profile is ${profile}`;
  }
  if (window.kind !== 'open') return window.kind === 'off' ? 'the window is off' : `held: ${window.reason}`;
  const admitted = await admitNext(ports, state, windowFile, window.size);
  if (admitted === 'no eligible pull request') await sweep(ports);
  return admitted;
}

/**
 * Stops the run and verifies the slot clean, all before any network call; then hands its lease back
 * (when it still holds it) and owes its Check a cancelled completion. A slot not shown clean holds
 * every admission and raises an alert.
 */
async function stopRun(
  ports: RunnerPorts,
  initial: RunnerState,
  run: CurrentRun,
  reason: string,
  handBack: boolean,
): Promise<string> {
  const cleanup = await ports.runs.stop(run);
  let state: RunnerState = { ...initial, current: null };
  if (!cleanup.clean)
    state = alertOnce({ ...state, dirty: cleanup.reason }, `dirty:${cleanup.reason}`, {
      kind: 'dirty',
      detail: `${ports.config.machine} stopped #${run.pull}'s run but could not show its slot clean: ${cleanup.reason}`,
    });
  state = owe(state, run, 'cancelled', reason);
  ports.save(state);
  if (handBack) await release(ports.refs, run.head, run.held).catch(() => false);
  await deliver(ports, state);
  return `stopped #${run.pull}: ${reason}`;
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
  if (status.state === 'ended') return finish(ports, state, run, status);
  if (now > run.startedAt + ceilingMs(status.plan))
    return stopRun(ports, state, run, 'The run outran the sum of its jobs’ timeouts.', true);
  // A window file that changed validly may bring the edge closer, never push it away; one that
  // breaks keeps the edge the run was admitted with.
  const edge = stopByOf(nextOffEdge(windowFile, now));
  const stopBy = edge === null ? run.stopBy : run.stopBy === null ? edge : Math.min(run.stopBy, edge);
  const renewed = await heartbeat(ports.refs, run.head, run.held, seconds(now), ports.config.leaseTtlSeconds);
  if (renewed === 'lost') {
    const line = await stopRun(ports, state, run, 'Its lease was lost.', false);
    ports.save(
      alertOnce(ports.load(), `lost:${run.head}:${run.attempt}`, {
        kind: 'lost-lease',
        detail: `#${run.pull}'s run on ${ports.config.machine} lost its lease and was stopped (${run.runUrl}).`,
      }),
    );
    return line;
  }
  const held: CurrentRun = { ...run, held: renewed, stopBy };
  state = { ...state, current: held };
  ports.save(state);
  const pull = (await ports.pulls()).find((candidate) => candidate.number === run.pull);
  if (!pull || pull.headSha !== run.head || pull.isDraft)
    return stopRun(ports, state, held, `#${run.pull} moved on: its head is no longer ${run.head}.`, true);
  return `#${run.pull} runs; its lease holds until ${new Date(renewed.lease.expiresAt * 1_000).toISOString()}`;
}

/** A run whose process ended: its verdict while every input still holds, otherwise cancelled. */
async function finish(
  ports: RunnerPorts,
  initial: RunnerState,
  run: CurrentRun,
  status: Extract<RunStatus, { state: 'ended' }>,
): Promise<string> {
  let state: RunnerState = { ...initial, current: null };
  const now = ports.now();
  const cancel = async (reason: string, handBack: boolean): Promise<string> => {
    state = owe(state, run, 'cancelled', reason);
    ports.save(state);
    if (handBack) await release(ports.refs, run.head, run.held).catch(() => false);
    await deliver(ports, state);
    return `#${run.pull} ended without a verdict: ${reason}`;
  };
  if (status.exitCode !== 0 && status.exitCode !== 1) {
    if (state.unstarted.includes(run.head))
      state = alertOnce({ ...state, parked: keep(state.parked, run.head) }, `unstarted:${run.head}`, {
        kind: 'unstarted',
        detail: `#${run.pull}'s run on ${ports.config.machine} ended twice without a verdict (${run.runUrl}); the machine leaves the head to a person.`,
      });
    else state = { ...state, unstarted: keep(state.unstarted, run.head) };
    return cancel(`The run ended with ${status.exitCode ?? 'a stop'}, before its verdict.`, true);
  }
  // Right before the verdict: the head, its approval and the active profile must still be the run's.
  const pull = (await ports.pulls()).find((candidate) => candidate.number === run.pull);
  if (!pull || pull.headSha !== run.head || pull.isDraft)
    return cancel(`#${run.pull} moved on before its verdict.`, true);
  if (pull.listGrowthApproved !== run.approval)
    return cancel('The list-growth approval changed while the run went; the head runs again.', true);
  const profile = await ports.profile();
  if (profile !== 'local') return cancel(`main's CI profile turned ${profile} while the run went.`, true);
  const done = await markDone(ports.refs, run.head, run.held, seconds(now));
  if (done === 'stale') {
    state = alertOnce(state, `stale:${run.head}:${run.attempt}`, {
      kind: 'stale',
      detail: `#${run.pull}'s run on ${ports.config.machine} ended, but its lease no longer held, so its verdict was not posted (${run.runUrl}).`,
    });
    return cancel('Its lease no longer held at its verdict.', false);
  }
  const kind: RunKind = status.full === true ? 'full' : 'selected';
  state = owe(
    {
      ...state,
      durations: {
        ...state.durations,
        [kind]: [...state.durations[kind], (now - run.startedAt) / 1_000].slice(-KEPT_SAMPLES),
      },
    },
    run,
    'verdict',
    '',
  );
  ports.save(state);
  await deliver(ports, state);
  return `#${run.pull} ended with ${status.exitCode}; its verdict is posted or owed`;
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
    ports.save(
      alertOnce(state, `hold:size ${size}`, {
        kind: 'hold',
        detail: `The window names the size ${size}, which ${config.machine}'s configuration lacks.`,
      }),
    );
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
  const imageProblem = await ports.image();
  if (imageProblem !== undefined) {
    ports.save(alertOnce(state, `image:${imageProblem}`, { kind: 'hold', detail: imageProblem }));
    return `held: ${imageProblem}`;
  }
  const pulls = await ports.pulls();
  for (const pull of pulls.filter((candidate) => !candidate.isDraft && !trustedPull(candidate)))
    state = alertOnce(state, `untrusted:${pull.number}`, {
      kind: 'untrusted',
      detail: `#${pull.number} comes from a fork or an author outside the repository, so no machine runs it.`,
    });
  ports.save(state);
  const base = await ports.main();
  for (const pull of eligiblePulls(pulls, state.parked)) {
    const started = await startPull(ports, pull, base, windowFile, now);
    if (started !== undefined) return started;
  }
  return 'no eligible pull request';
}

/**
 * Claims and starts `pull`'s run, or says nothing when this machine does not take it now: an older
 * head, one behind main, a lease another holds, a Check that cannot start.
 */
async function startPull(
  ports: RunnerPorts,
  pull: RunnerPull,
  base: string,
  windowFile: unknown,
  now: number,
): Promise<string | undefined> {
  const { config } = ports;
  let state = ports.load();
  const head = await ports.head(pull.headSha, base);
  if (!head.snapshotReader) {
    state = alertOnce(state, `old-head:${pull.headSha}`, {
      kind: 'old-head',
      detail: `#${pull.number}'s head predates the GitHub snapshot its jobs need here; update it from main.`,
    });
    ports.save(state);
    return undefined;
  }
  if (!head.upToDate) return undefined;
  const attempt = ports.nextAttempt();
  const claimed = await claim(
    ports.refs,
    pull.headSha,
    { machine: config.machine, generation: ports.generation, attempt, approval: pull.listGrowthApproved },
    seconds(now),
    config.leaseTtlSeconds,
  );
  if (!claimed.claimed) {
    if (claimed.reason === 'foreign') {
      state = alertOnce(state, `foreign:${pull.headSha}`, {
        kind: 'foreign',
        detail: `#${pull.number}'s lease ref holds no lease, so no machine takes it.`,
      });
      ports.save(state);
    }
    return undefined;
  }
  const name = `${config.machine}-a${attempt}`;
  const runUrl = `https://github.com/${config.repository}/commit/${pull.headSha}#${name}`;
  let checkRun: number;
  try {
    checkRun = await ports.checks.start({ head: pull.headSha, runUrl });
  } catch (error) {
    await release(ports.refs, pull.headSha, claimed.held).catch(() => false);
    ports.log(
      `[runner] #${pull.number}: its Check could not start, the lease is handed back: ${message(error)}`,
    );
    return undefined;
  }
  const runDir = `${config.stateDir}/runs/${name}`;
  const current: CurrentRun = {
    pull: pull.number,
    head: pull.headSha,
    approval: pull.listGrowthApproved,
    attempt,
    runUrl,
    runDir,
    held: claimed.held,
    checkRun,
    startedAt: now,
    stopBy: stopByOf(nextOffEdge(windowFile, now)),
    processGroup: null,
  };
  // Saved before the start, so a runner that dies during it still knows the run to end.
  ports.save({ ...state, current });
  const { processGroup } = await ports.runs.start({
    pull,
    base,
    runUrl,
    runDir,
    attempt,
    stopBy: current.stopBy,
  });
  ports.save({ ...state, current: { ...current, processGroup } });
  return `started #${pull.number} at ${pull.headSha} (${runUrl})`;
}

/** Deletes the lease refs of heads no open PR has any more, each only while it holds the value read. */
async function sweep(ports: RunnerPorts): Promise<void> {
  const open = new Set((await ports.pulls()).map((pull) => pull.headSha));
  for (const { sha, oid } of await ports.refs.list()) if (!open.has(sha)) await ports.refs.remove(sha, oid);
}

/**
 * Before its first claim, a restarted runner ends the run an older generation left: its process
 * group and containers, verified, then its lease handed back and its Check cancelled. It never
 * resumes it.
 */
export async function recover(ports: RunnerPorts): Promise<string | undefined> {
  const run = ports.load().current;
  if (!run) return undefined;
  await stopRun(ports, ports.load(), run, 'The machine runner restarted.', true);
  return `ended #${run.pull}'s attempt ${run.attempt}: the runner restarted`;
}

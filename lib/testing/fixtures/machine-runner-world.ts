// A world of machine runners for lib/testing/ci/machine-runner.test.ts: a fake GitHub (lease refs
// that swap atomically, the App's check runs, the open PRs), a fake run-commit and slot, and an
// injected clock. No network, no sleep.
import { type MachineConfig } from '../ci/machine-config';
import { BERLIN_TIME_ZONE } from '../../date-time/berlin';
import { type LeaseRefs, parseLease } from '../ci/lease';
import type { RunnerPull } from '../ci/machine-pulls';
import { EMPTY_STATE, type RunnerPorts, type RunnerState, type RunStatus, tick } from '../ci/machine-runner';
import { MAC_STANDING, PC_STANDING } from '../ci/windows';

export const PC_WINDOWS = { timezone: BERLIN_TIME_ZONE, standing: PC_STANDING };
export const MAC_WINDOWS = { timezone: BERLIN_TIME_ZONE, standing: MAC_STANDING };
/** Monday 23 November 2026, 03:00 Berlin (02:00 UTC): the PC's window is open until 06:00 Berlin. */
export const MONDAY_NIGHT = Date.parse('2026-11-23T02:00:00Z');
export const MAIN = 'b'.repeat(40);

export const head = (n: number): string => n.toString(16).padStart(40, 'a');
export const pull = (number: number, extra: Partial<RunnerPull> = {}): RunnerPull => ({
  number,
  headSha: head(number),
  isDraft: false,
  queuedAt: null,
  mergeState: 'BLOCKED',
  sameRepository: true,
  association: 'OWNER',
  listGrowthApproved: false,
  ...extra,
});

/** GitHub as every machine sees it: lease refs swapped atomically, the App's check runs. */
export function fakeGitHub() {
  const refs = new Map<string, { oid: string; message: string }>();
  let nextOid = 1;
  const store: LeaseRefs & { list(): Promise<{ sha: string; oid: string }[]> } = {
    read: async (sha) => refs.get(sha) ?? null,
    swap: async (sha, expected, message) => {
      // Another machine may push between this machine's read and its push.
      await Promise.resolve();
      if ((refs.get(sha)?.oid ?? null) !== expected) return null;
      const value = { oid: `oid${nextOid++}`, message };
      refs.set(sha, value);
      return value;
    },
    remove: async (sha, expected) => refs.get(sha)?.oid === expected && refs.delete(sha),
    list: async () => [...refs].map(([sha, value]) => ({ sha, oid: value.oid })),
  };
  const checkRuns: { id: number; head: string; runUrl: string; conclusion: string | null }[] = [];
  /** The head's lease state each time a Check was completed. */
  const atCompletion: (string | undefined)[] = [];
  return { refs, store, checkRuns, atCompletion };
}
export type GitHub = ReturnType<typeof fakeGitHub>;

const config = (machine: string, sizes: MachineConfig['sizes']): MachineConfig => ({
  machine,
  repository: 'werk-flow/werkflow-app',
  trustedCheckout: '/trusted',
  stateDir: `/state/${machine}`,
  windowsFile: '/windows.json',
  appKeyFile: '/key/ci-app.pem',
  slot: {
    prefix: [],
    dockerHost: null,
    socket: '/var/run/docker.sock',
    root: '/slot',
    image: 'werkflow-ci:test',
    containerUser: 'image',
  },
  probePorts: [],
  reset: ['true'],
  sizes,
  seedSeconds: { full: 3 * 3_600, selected: 30 * 60 },
  leaseTtlSeconds: 600,
});

export type World = {
  clock: { now: number };
  github: GitHub;
  pulls: RunnerPull[];
  windows: unknown;
  profile?: string;
  /** GitHub does not answer: every network port throws. */
  offline?: boolean;
};

type Faults = {
  complete: number;
  alert: number;
  dirty: string | null;
  image: string | undefined;
  /** The next Check start is created on GitHub, but its answer is lost. */
  lostStart: boolean;
  /** The next verdict cannot be built from the run's results. */
  noVerdict: boolean;
  /** Milliseconds the next Check start takes on GitHub. */
  startDelay: number;
  /** Lookups of a start by its URL that come back empty first, as GitHub's lag. */
  findLag: number;
  /** Runs while the next Check start is on its way. */
  onStart: (() => void) | null;
  /** The reason every slot reset fails with, or null. */
  reset: string | null;
};

const noFaults = (): Faults => ({
  complete: 0,
  alert: 0,
  dirty: null,
  image: undefined,
  lostStart: false,
  noVerdict: false,
  startDelay: 0,
  findLag: 0,
  onStart: null,
  reset: null,
});

/** The machine's GitHub ports over the shared world; every call fails while the world is offline. */
function githubPorts(
  world: World,
  faults: Faults,
): Pick<RunnerPorts, 'profile' | 'pulls' | 'main' | 'refs' | 'checks'> {
  const online = <T>(value: () => T | Promise<T>): Promise<T> =>
    world.offline ? Promise.reject(new Error('GitHub does not answer')) : Promise.resolve().then(value);
  return {
    profile: () => online(() => world.profile ?? 'local'),
    pulls: () => online(() => world.pulls),
    main: () => online(() => MAIN),
    refs: {
      read: (sha) => online(() => world.github.store.read(sha)),
      swap: (sha, expected, message) => online(() => world.github.store.swap(sha, expected, message)),
      remove: (sha, expected) => online(() => world.github.store.remove(sha, expected)),
      list: () => online(() => world.github.store.list()),
    },
    checks: {
      start: ({ head: sha, runUrl }) =>
        online(() => {
          const id = world.github.checkRuns.length + 1;
          world.github.checkRuns.push({ id, head: sha, runUrl, conclusion: null });
          world.clock.now += faults.startDelay;
          faults.onStart?.();
          faults.onStart = null;
          if (faults.lostStart) {
            faults.lostStart = false;
            throw new Error('the answer was lost');
          }
          return id;
        }),
      find: ({ runUrl }) =>
        online(() => {
          if (faults.findLag > 0) {
            faults.findLag--;
            return null;
          }
          return world.github.checkRuns.find((run) => run.runUrl === runUrl)?.id ?? null;
        }),
      complete: (completion) =>
        online(() => {
          if (faults.complete > 0) {
            faults.complete--;
            throw new Error('GitHub answered 502');
          }
          const own = world.github.checkRuns.find((run) => run.id === completion.checkRun);
          // GitHub refuses a completion of a check run that is not this head's.
          if (!own || own.head !== completion.head) throw new Error('GitHub answered 404');
          world.github.atCompletion.push(
            parseLease(world.github.refs.get(completion.head)?.message ?? '')?.state,
          );
          const verdict = completion.kind === 'verdict' && !faults.noVerdict;
          faults.noVerdict = false;
          // As check-app.ts's verdictOrCancelled: a pass needs run-commit's exit 0 as well.
          own.conclusion = verdict ? (completion.exitCode === 0 ? 'success' : 'failure') : 'cancelled';
          return completion.kind === 'verdict' && !verdict ? 'cancelled' : 'completed';
        }),
    },
  };
}

type SlotRecords = {
  stopped: string[];
  cleaned: string[];
  resets: string[];
  rearmed: { pull: number; stopBy: number }[];
};
const slotRecords = (): SlotRecords => ({ stopped: [], cleaned: [], resets: [], rearmed: [] });

/** The slot side of the fake run control: each stop, emptying, reset and re-arm is recorded. */
function slotControl(
  world: World,
  faults: Faults,
  records: SlotRecords,
  ended: () => void,
): Pick<RunnerPorts['runs'], 'stop' | 'clean' | 'reset' | 'rearm'> {
  const at = () => new Date(world.clock.now).toISOString();
  const dirty = (): { clean: true } | { clean: false; reason: string } =>
    faults.dirty === null ? { clean: true } : { clean: false, reason: faults.dirty };
  return {
    stop: async () => {
      records.stopped.push(at());
      ended();
      return dirty();
    },
    clean: async () => {
      records.cleaned.push(at());
      return dirty();
    },
    reset: async () => {
      records.resets.push(at());
      return faults.reset === null ? { clean: true } : { clean: false, reason: faults.reset };
    },
    rearm: async (run, stopBy) => void records.rearmed.push({ pull: run.pull, stopBy }),
  };
}

export function machine(
  name: string,
  world: World,
  options: { sizes?: MachineConfig['sizes']; generation?: number; state?: RunnerState } = {},
) {
  let state: RunnerState = options.state ?? EMPTY_STATE;
  let status: RunStatus = { state: 'running', plan: null };
  let attempts = 0;
  const started: { pull: number; runUrl: string; runDir: string; base: string; stopBy: number | null }[] = [];
  const records = slotRecords();
  const { stopped, cleaned, resets, rearmed } = records;
  const logs: string[] = [];
  const resized: string[] = [];
  const alerts: string[] = [];
  const details: string[] = [];
  const faults = noFaults();
  const headInfo = new Map<string, { upToDate: boolean; snapshotReader: boolean }>();
  const ports: RunnerPorts = {
    config: config(name, options.sizes ?? { full: { resize: null } }),
    generation: options.generation ?? 1,
    now: () => world.clock.now,
    windows: () => world.windows,
    ...githubPorts(world, faults),
    head: (sha) => Promise.resolve(headInfo.get(sha) ?? { upToDate: true, snapshotReader: true }),
    image: async () => faults.image,
    runs: {
      start: async (run) => {
        started.push({
          pull: run.pull.number,
          runUrl: run.runUrl,
          runDir: run.runDir,
          base: run.base,
          stopBy: run.stopBy,
        });
        status = { state: 'running', plan: null };
        return { processGroup: 4_242 };
      },
      status: async () => status,
      ...slotControl(world, faults, records, () => (status = { state: 'ended', exitCode: null, full: null })),
    },
    nextAttempt: () => ++attempts,
    resize: async (command) => void resized.push(command.join(' ')),
    load: () => state,
    save: (saved) => (state = saved),
    alert: async (alert) => {
      if (faults.alert > 0) {
        faults.alert--;
        return false;
      }
      alerts.push(alert.kind);
      details.push(alert.detail);
      return true;
    },
    log: (line) => void logs.push(line),
  };
  return {
    ports,
    state: () => state,
    started,
    stopped,
    cleaned,
    resets,
    rearmed,
    logs,
    resized,
    alerts,
    details,
    faults,
    headInfo,
    setStatus: (next: RunStatus) => (status = next),
    end: (exitCode: number | null) => (status = { state: 'ended', exitCode, full: false }),
  };
}

export const world = (extra: Partial<World> = {}): World => ({
  clock: { now: MONDAY_NIGHT },
  github: fakeGitHub(),
  pulls: [pull(1)],
  windows: PC_WINDOWS,
  ...extra,
});
/** Ticks once a minute until `until`, as the runner does, so each run's lease is renewed. */
export async function tickUntil(
  runner: ReturnType<typeof machine>,
  shared: World,
  until: number,
): Promise<void> {
  while (shared.clock.now + 60_000 <= until) {
    shared.clock.now += 60_000;
    await tick(runner.ports);
  }
  shared.clock.now = until;
}
export const leaseOf = (github: GitHub, sha: string) => parseLease(github.refs.get(sha)?.message ?? '');

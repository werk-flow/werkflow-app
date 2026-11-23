// The machine runner's decisions (machine-runner.ts) against a fake GitHub that keeps the CI App's
// `Check` check runs the way lease.ts reads them, a fake run-commit and an injected clock: no
// network, no sleep. Each test names the invariant it holds.
import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { claim, heartbeat, type LeaseApi, postVerdict } from './lease';
import {
  type CurrentRun,
  EMPTY_STATE,
  eligiblePulls,
  KILL_AFTER_MS,
  type MachineConfig,
  machineConfigSchema,
  offEdgeAhead,
  percentile,
  recover,
  type RunLease,
  type RunnerPorts,
  type RunnerState,
  type RunStatus,
  stopProcessGroup,
  tick,
} from './machine-runner';
import type { QueuedPull } from './queue';
import { MAC_STANDING, PC_STANDING, resolveWindow } from './windows';

const PC_WINDOWS = { timezone: 'Europe/Berlin', standing: PC_STANDING };
const MAC_WINDOWS = { timezone: 'Europe/Berlin', standing: MAC_STANDING };
/** Monday 23 November 2026, 03:00 Berlin (02:00 UTC): the PC's window is open until 06:00 Berlin. */
const MONDAY_NIGHT = Date.parse('2026-11-23T02:00:00Z');

const head = (n: number): string => n.toString(16).padStart(40, 'a');
const pull = (number: number, extra: Partial<QueuedPull> = {}): QueuedPull => ({
  number,
  title: `PR ${number}`,
  headSha: head(number),
  isDraft: false,
  queuedAt: null,
  check: 'MISSING',
  mergeState: 'BLOCKED',
  listGrowthApproved: false,
  ...extra,
});

/** GitHub's App `Check` check runs, numbered in creation order, shared by every machine. */
function fakeGitHub() {
  const runs: { id: number; sha: string; title: string | null; conclusion: string | null }[] = [];
  let next = 1;
  const api: LeaseApi = {
    checkRuns: async (sha) =>
      runs
        .filter((run) => run.sha === sha && run.conclusion !== 'cancelled')
        .map((run) => ({ id: run.id, completed: run.conclusion !== null, title: run.title })),
    start: async (sha, title) => {
      runs.push({ id: next, sha, title, conclusion: null });
      return next++;
    },
    renew: async (id, title) => {
      const found = runs.find((run) => run.id === id);
      if (found) found.title = title;
    },
    // Another machine may act while this one waits out the settle delay.
    wait: async () => {
      await Promise.resolve();
      await Promise.resolve();
    },
  };
  const complete = (current: CurrentRun, conclusion: string) => async () => {
    const own = runs.find((run) => run.id === current.held.checkRun);
    if (!own) return { problem: 'no start' };
    own.conclusion = conclusion;
    return { id: own.id };
  };
  const lease = (machine: string, ttl: number): RunLease => ({
    claim: ({ pull: claimed, generation }, now) =>
      claim(api, claimed.headSha, { machine, generation }, now, ttl),
    heartbeat: (current, now) => heartbeat(api, current.head, current.held, now, ttl),
    verdict: (current, now) =>
      postVerdict(api, current.head, current.held, now, complete(current, 'success')),
    cancel: (current, now) =>
      postVerdict(api, current.head, current.held, now, complete(current, 'cancelled')),
  });
  return { runs, lease };
}

const config = (machine: string, sizes: MachineConfig['sizes']): MachineConfig => ({
  machine,
  repository: 'werk-flow/werkflow-app',
  trustedCheckout: '/trusted',
  stateDir: `/state/${machine}`,
  windowsFile: '/windows.json',
  appKeyFile: '/key.pem',
  slot: {
    prefix: [],
    dockerHost: null,
    socket: '/var/run/docker.sock',
    root: '/slot',
    image: 'werkflow-ci:test',
    containerUser: 'image',
  },
  sizes,
  seedSeconds: { full: 3 * 3_600, selected: 30 * 60 },
  leaseTtlSeconds: 600,
});

type Machine = {
  ports: RunnerPorts;
  state(): RunnerState;
  started: number[];
  stopped: string[];
  resized: string[];
  alerts: string[];
  /** The run's process ends with this exit code. */
  end(exitCode: number | null): void;
};

function machine(
  name: string,
  world: {
    clock: { now: number };
    github: ReturnType<typeof fakeGitHub>;
    pulls: QueuedPull[];
    windows: unknown;
  },
  options: { sizes?: MachineConfig['sizes']; generation?: number } = {},
): Machine {
  let state: RunnerState = EMPTY_STATE;
  let status: RunStatus = { state: 'running' };
  const started: number[] = [];
  const stopped: string[] = [];
  const resized: string[] = [];
  const alerts: string[] = [];
  const ports: RunnerPorts = {
    config: config(name, options.sizes ?? { full: { resize: null } }),
    generation: options.generation ?? 1,
    now: () => world.clock.now,
    windows: () => world.windows,
    pulls: async () => world.pulls,
    main: async () => 'b'.repeat(40),
    lease: world.github.lease(name, 600),
    runs: {
      start: async ({ pull: started_ }) => {
        started.push(started_.number);
        status = { state: 'running' };
        return { processGroup: 4_242 };
      },
      status: async () => status,
      stop: async (current) => {
        stopped.push(current.stopped ?? '');
        status = { state: 'ended', exitCode: null, full: null };
      },
    },
    resize: async (command) => void resized.push(command.join(' ')),
    load: () => state,
    save: (saved) => (state = saved),
    alert: async (alert) => void alerts.push(alert.kind),
    log: () => undefined,
  };
  return {
    ports,
    state: () => state,
    started,
    stopped,
    resized,
    alerts,
    end: (exitCode) => (status = { state: 'ended', exitCode, full: false }),
  };
}

test('two runners against one queue never run the same PR', async () => {
  const github = fakeGitHub();
  const world = { clock: { now: MONDAY_NIGHT }, github, pulls: [pull(1), pull(2)], windows: PC_WINDOWS };
  const mac = machine('mac', world);
  const pc = machine('pc', world);
  // Both tick at once: both start a lease on #1, and only the newest start holds it.
  await Promise.all([tick(mac.ports), tick(pc.ports)]);
  await Promise.all([tick(mac.ports), tick(pc.ports)]);
  const all = [...mac.started, ...pc.started];
  expect(all.toSorted()).toEqual([1, 2]);
  expect(new Set(all).size).toBe(all.length);
});

test('a runner killed mid-run loses its PR once the lease expired, and its late verdict is stale', async () => {
  const github = fakeGitHub();
  const world = { clock: { now: MONDAY_NIGHT }, github, pulls: [pull(1)], windows: PC_WINDOWS };
  const dead = machine('mac', world);
  const pc = machine('pc', world);
  await tick(dead.ports);
  expect(dead.started).toEqual([1]);
  // Within the lease's life the PR stays the dead runner's.
  world.clock.now += 5 * 60_000;
  await tick(pc.ports);
  expect(pc.started).toEqual([]);
  // Past its expiry and the margin, the other runner takes the PR.
  world.clock.now += 6 * 60_000 + 1_000;
  await tick(pc.ports);
  expect(pc.started).toEqual([1]);
  // The dead runner comes back: its run's end posts nothing.
  dead.end(0);
  await tick(dead.ports);
  expect(dead.alerts).toEqual(['stale']);
  expect(github.runs.filter((run) => run.conclusion !== null)).toEqual([]);
});

test("a run never crosses the window's off edge: it is stopped before it, and its Check ends as cancelled", async () => {
  const github = fakeGitHub();
  const world = { clock: { now: MONDAY_NIGHT }, github, pulls: [pull(1)], windows: PC_WINDOWS };
  const pc = machine('pc', world);
  await tick(pc.ports);
  expect(pc.started).toEqual([1]);
  // 05:57:30 Berlin: the window turns off at 06:00, before a stop begun at the next tick could end.
  world.clock.now = Date.parse('2026-11-23T04:57:30Z');
  await tick(pc.ports);
  expect(pc.stopped).toEqual(['The machine’s window turns off.']);
  expect(github.runs.map((run) => run.conclusion)).toEqual(['cancelled']);
  // Inside the off window nothing starts, and a run admitted later ends before the edge.
  world.clock.now = Date.parse('2026-11-23T05:30:00Z');
  await tick(pc.ports);
  await tick(pc.ports);
  expect(pc.started).toEqual([1]);
  expect(offEdgeAhead(PC_WINDOWS, Date.parse('2026-11-23T04:57:30Z'))).toBe(true);
  expect(offEdgeAhead(PC_WINDOWS, Date.parse('2026-11-23T04:55:00Z'))).toBe(false);
});

test('a run is admitted only when its 90th-percentile time and the reserve end before the window turns off', async () => {
  const github = fakeGitHub();
  // 05:20 Berlin: 40 minutes before the PC's quiet hours, the seed of a selected run (30 min) plus
  // the reserve fits; at 05:35 it does not.
  const world = {
    clock: { now: Date.parse('2026-11-23T04:35:00Z') },
    github,
    pulls: [pull(1)],
    windows: PC_WINDOWS,
  };
  const pc = machine('pc', world);
  await tick(pc.ports);
  expect(pc.started).toEqual([]);
  world.clock.now = Date.parse('2026-11-23T04:20:00Z');
  await tick(pc.ports);
  expect(pc.started).toEqual([1]);
  expect(percentile([10, 20, 30, 40, 50, 60, 70, 80, 90, 100], 90)).toBe(90);
});

test("the Mac's resize happens only between runs", async () => {
  const github = fakeGitHub();
  // 19:50 Berlin: the 4/6 day size; the night size 8/8 begins at 20:00.
  const world = {
    clock: { now: Date.parse('2026-11-23T18:50:00Z') },
    github,
    pulls: [pull(1), pull(2)],
    windows: MAC_WINDOWS,
  };
  const mac = machine('mac', world, {
    sizes: { '4/6': { resize: ['colima', 'resize', '4/6'] }, '8/8': { resize: ['colima', 'resize', '8/8'] } },
  });
  world.clock.now = Date.parse('2026-11-23T18:00:00Z');
  await tick(mac.ports);
  expect(mac.resized).toEqual(['colima resize 4/6']);
  expect(mac.started).toEqual([1]);
  // The night size begins while #1 runs: nothing resizes until it ended.
  world.clock.now = Date.parse('2026-11-23T19:05:00Z');
  await tick(mac.ports);
  expect(mac.resized).toEqual(['colima resize 4/6']);
  mac.end(0);
  await tick(mac.ports);
  await tick(mac.ports);
  expect(mac.resized).toEqual(['colima resize 4/6', 'colima resize 8/8']);
  expect(mac.started).toEqual([1, 2]);
});

test('a run whose PR moved on is stopped, and its Check ends as cancelled', async () => {
  const github = fakeGitHub();
  const world = { clock: { now: MONDAY_NIGHT }, github, pulls: [pull(1)], windows: PC_WINDOWS };
  const pc = machine('pc', world);
  await tick(pc.ports);
  world.pulls = [pull(1, { headSha: 'c'.repeat(40) })];
  await tick(pc.ports);
  expect(pc.stopped).toEqual([`#1 moved on: its head is no longer ${head(1)}.`]);
  expect(github.runs.map((run) => run.conclusion)).toEqual(['cancelled']);
});

test('a held window file admits nothing and raises one alert', async () => {
  const github = fakeGitHub();
  const world = { clock: { now: MONDAY_NIGHT }, github, pulls: [pull(1)], windows: 'not json' };
  const pc = machine('pc', world);
  await tick(pc.ports);
  await tick(pc.ports);
  expect(pc.started).toEqual([]);
  expect(pc.alerts).toEqual(['hold']);
});

test("a restarted runner ends the older generation's run and never resumes it", async () => {
  const github = fakeGitHub();
  const world = { clock: { now: MONDAY_NIGHT }, github, pulls: [pull(1)], windows: PC_WINDOWS };
  const before = machine('pc', world);
  await tick(before.ports);
  const after = machine('pc', world, { generation: 2 });
  after.ports.save(before.state());
  expect(await recover(after.ports)).toContain('generation 1');
  expect(after.state().current).toBeNull();
  expect(github.runs.map((run) => run.conclusion)).toEqual(['cancelled']);
});

test('eligible PRs: ready, not conflicting, without a verdict; queued ones first in queue order', () => {
  const pulls = [
    pull(5),
    pull(4, { queuedAt: '2026-11-23T02:00:00Z' }),
    pull(3, { queuedAt: '2026-11-23T01:00:00Z' }),
    pull(2, { isDraft: true }),
    pull(1, { mergeState: 'DIRTY' }),
    pull(6, { check: 'SUCCESS' }),
    pull(7),
  ];
  expect(eligiblePulls(pulls, [head(7)]).map((candidate) => candidate.number)).toEqual([3, 4, 5]);
});

test("the example machine configurations and window files parse, and the windows are the owner's standing rules", () => {
  const read = (name: string): unknown =>
    JSON.parse(readFileSync(join(import.meta.dir, '../../../ci/machines', name), 'utf8'));
  for (const name of ['mac.example.json', 'pc.example.json'])
    expect(() => machineConfigSchema.parse(read(name))).not.toThrow();
  for (const [name, standing] of [
    ['pc.windows.example.json', PC_STANDING],
    ['mac.windows.example.json', MAC_STANDING],
  ] as const) {
    expect(resolveWindow(read(name), new Date(MONDAY_NIGHT)).kind).not.toBe('hold');
    expect(read(name)).toEqual({ timezone: 'Europe/Berlin', standing, exceptions: [] });
  }
});

test("the hard stop takes effect before 06:00 Berlin on Monday and on Friday, and signals only the run's process group", async () => {
  // Monday 23 and Friday 27 November 2026: the PC's quiet hours begin at 06:00 Berlin (05:00 UTC).
  for (const day of ['2026-11-23', '2026-11-27']) {
    const github = fakeGitHub();
    const edge = Date.parse(`${day}T05:00:00Z`);
    const world = {
      clock: { now: Date.parse(`${day}T02:00:00Z`) },
      github,
      pulls: [pull(1)],
      windows: PC_WINDOWS,
    };
    const pc = machine('pc', world);
    await tick(pc.ports);
    expect(pc.started).toEqual([1]);
    // One tick a minute, at any second of the minute: the first stop leaves the SIGKILL before the edge.
    let stoppedAt: number | undefined;
    for (
      world.clock.now = Date.parse(`${day}T04:50:37Z`);
      stoppedAt === undefined && world.clock.now < edge;
      world.clock.now += 60_000
    ) {
      await tick(pc.ports);
      if (pc.stopped.length) stoppedAt = world.clock.now;
    }
    expect(stoppedAt).toBeDefined();
    expect((stoppedAt ?? edge) + KILL_AFTER_MS).toBeLessThan(edge);
    expect(github.runs.map((run) => run.conclusion)).toEqual(['cancelled']);
  }
  // The stop signals the recorded group by its id, never a name: SIGTERM, then SIGKILL after the grace.
  const signals: [number, string | 0][] = [];
  const pending: { ms: number; act: () => void }[] = [];
  let containersStopped = false;
  stopProcessGroup(
    4_242,
    (pid, name) => (signals.push([pid, name]), true),
    (ms, act) => void pending.push({ ms, act }),
    () => (containersStopped = true),
  );
  expect(signals).toEqual([
    [-4_242, 0],
    [-4_242, 'SIGTERM'],
  ]);
  expect(pending.map((later) => later.ms)).toEqual([KILL_AFTER_MS]);
  pending[0]?.act();
  expect(signals.slice(2)).toEqual([
    [-4_242, 0],
    [-4_242, 'SIGKILL'],
  ]);
  expect(containersStopped).toBe(true);
  // A group that is gone gets no signal at all.
  const none: [number, string | 0][] = [];
  stopProcessGroup(
    4_243,
    (pid, name) => (none.push([pid, name]), false),
    () => undefined,
    () => undefined,
  );
  expect(none).toEqual([[-4_243, 0]]);
});

test('a stopped run never leaves a pending Check that blocks its PR: it ends cancelled, or its lease lapses to the next claimer', async () => {
  /** The newest App Check on a head, as GitHub's merge gate and the next claimer read it. */
  const newest = (github: ReturnType<typeof fakeGitHub>, sha: string) =>
    github.runs.filter((run) => run.sha === sha).toSorted((one, other) => other.id - one.id)[0];
  const setUp = () => {
    const github = fakeGitHub();
    const world = { clock: { now: MONDAY_NIGHT }, github, pulls: [pull(1)], windows: PC_WINDOWS };
    return { github, world, pc: machine('pc', world) };
  };
  // The window's edge, a moved head and a restart each complete the run's own Check as cancelled.
  {
    const { github, world, pc } = setUp();
    await tick(pc.ports);
    world.clock.now = Date.parse('2026-11-23T04:57:30Z');
    await tick(pc.ports);
    expect(newest(github, head(1))?.conclusion).toBe('cancelled');
  }
  {
    const { github, world, pc } = setUp();
    await tick(pc.ports);
    world.pulls = [pull(1, { headSha: 'c'.repeat(40) })];
    await tick(pc.ports);
    expect(newest(github, head(1))?.conclusion).toBe('cancelled');
  }
  {
    const { github, world, pc } = setUp();
    await tick(pc.ports);
    const restarted = machine('pc', world, { generation: 2 });
    restarted.ports.save(pc.state());
    await recover(restarted.ports);
    expect(newest(github, head(1))?.conclusion).toBe('cancelled');
  }
  // A cancelled Check leaves the PR eligible: the next tick claims it again.
  {
    const { github, world, pc } = setUp();
    await tick(pc.ports);
    world.clock.now = Date.parse('2026-11-23T04:57:30Z');
    await tick(pc.ports);
    await tick(pc.ports);
    world.clock.now = Date.parse('2026-11-23T16:00:00Z');
    await tick(pc.ports);
    expect(pc.started).toEqual([1, 1]);
    expect(newest(github, head(1))?.conclusion).toBeNull();
  }
  // A runner that dies posts nothing: its lease lapses, and by P5's rules the next claimer takes the head.
  {
    const { github, world, pc } = setUp();
    await tick(pc.ports);
    const mac = machine('mac', world);
    world.clock.now += (600 + 60) * 1_000 + 1_000;
    await tick(mac.ports);
    expect(mac.started).toEqual([1]);
    expect(newest(github, head(1))?.title).toContain('m=mac');
  }
});

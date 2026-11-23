// The machine runner's decisions (machine-runner.ts) in a world of fake GitHub, run-commit, slot
// and clock (lib/testing/fixtures/machine-runner-world.ts). Each test names the invariant it holds.
import { BERLIN_TIME_ZONE } from '../../date-time/berlin';
import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  head,
  leaseOf,
  MAC_WINDOWS,
  machine,
  MAIN,
  MONDAY_NIGHT,
  PC_WINDOWS,
  pull,
  tickUntil,
  world,
} from '../fixtures/machine-runner-world';
import {
  ceilingMs,
  EDGE_MARGIN_MS,
  endProcessGroup,
  KILL_AFTER_MS,
  machineConfigSchema,
  nextOffEdge,
  percentile,
  recover,
  tick,
} from './machine-runner';
import { runnerPullsFromGitHub } from './machine-pulls';
import type { RunPlan } from './results';
import { MAC_STANDING, PC_STANDING, resolveWindow } from './windows';

test('F1: two runners against one queue never run the same PR, and a loser leaves no Check behind', async () => {
  const shared = world({ pulls: [pull(1), pull(2)] });
  const mac = machine('mac', shared);
  const pc = machine('pc', shared);
  await Promise.all([tick(mac.ports), tick(pc.ports)]);
  await Promise.all([tick(mac.ports), tick(pc.ports)]);
  const all = [...mac.started, ...pc.started].map((run) => run.pull);
  expect(all.toSorted()).toEqual([1, 2]);
  // Only a winning claim creates its Check: one start per PR.
  expect(shared.github.checkRuns.map((run) => run.head).toSorted()).toEqual([head(1), head(2)]);
});

test('F1: a runner killed mid-run loses its PR once the lease expired, and its late verdict is never posted', async () => {
  const shared = world();
  const dead = machine('mac', shared);
  const pc = machine('pc', shared);
  await tick(dead.ports);
  shared.clock.now += 5 * 60_000;
  await tick(pc.ports);
  expect(pc.started).toEqual([]);
  shared.clock.now += 6 * 60_000 + 1_000;
  await tick(pc.ports);
  expect(pc.started.map((run) => run.pull)).toEqual([1]);
  expect(leaseOf(shared.github, head(1))?.machine).toBe('pc');
  // The dead runner comes back with a passed run: its done swap fails, so its Check ends cancelled.
  dead.end(0);
  await tick(dead.ports);
  expect(dead.alerts).toContain('stale');
  expect(shared.github.checkRuns.map((run) => run.conclusion)).toEqual(['cancelled', null]);
  expect(leaseOf(shared.github, head(1))).toMatchObject({ machine: 'pc', state: 'held' });
});

test("F1: a verdict is posted only after the lease ref turned done, on the attempt's own Check", async () => {
  const shared = world();
  const pc = machine('pc', shared);
  await tick(pc.ports);
  pc.end(0);
  await tick(pc.ports);
  expect(leaseOf(shared.github, head(1))?.state).toBe('done');
  expect(shared.github.checkRuns.map(({ id, conclusion }) => ({ id, conclusion }))).toEqual([
    { id: 1, conclusion: 'success' },
  ]);
  expect(shared.github.checkRuns[0]?.runUrl).toContain('#pc-a1');
  // A done head under the same approval is not claimed again.
  await tick(pc.ports);
  expect(pc.started).toHaveLength(1);
});

test('F1: an idle tick deletes the lease refs of heads no open PR has', async () => {
  const shared = world();
  const pc = machine('pc', shared);
  await tick(pc.ports);
  pc.end(0);
  await tick(pc.ports);
  shared.pulls = [];
  await tick(pc.ports);
  expect(shared.github.refs.size).toBe(0);
});

test("F2: a fork's or a stranger's PR is never claimed, and raises one alert per PR", async () => {
  const shared = world({
    pulls: [
      pull(1, { sameRepository: false }),
      pull(2, { association: 'CONTRIBUTOR' }),
      pull(3, { association: 'NONE' }),
    ],
  });
  const pc = machine('pc', shared);
  await tick(pc.ports);
  await tick(pc.ports);
  expect(pc.started).toEqual([]);
  expect(pc.alerts).toEqual(['untrusted', 'untrusted', 'untrusted']);
});

test('F4: the edge stop needs no answer from GitHub, and on Monday and Friday its SIGKILL lands before 06:00 Berlin', async () => {
  for (const day of ['2026-11-23', '2026-11-27']) {
    const edge = Date.parse(`${day}T05:00:00Z`);
    const shared = world({ clock: { now: Date.parse(`${day}T02:00:00Z`) } });
    const pc = machine('pc', shared);
    await tick(pc.ports);
    expect(pc.started[0]?.stopBy).toBe(edge - EDGE_MARGIN_MS);
    // GitHub stops answering; a tick a minute at any second of the minute.
    shared.offline = true;
    for (
      shared.clock.now = Date.parse(`${day}T04:40:37Z`);
      !pc.stopped.length && shared.clock.now < edge;
      shared.clock.now += 60_000
    )
      // Every tick but the stopping one fails on the outage; that is the point.
      await tick(pc.ports).catch((error: unknown) => String(error));
    const stoppedAt = Date.parse(pc.stopped[0] ?? '');
    expect(stoppedAt + KILL_AFTER_MS + 60_000).toBeLessThan(edge);
    // The cancellation waits for GitHub and is delivered once it answers again.
    expect(pc.state().pendingCompletions.map((completion) => completion.kind)).toEqual(['cancelled']);
    shared.offline = false;
    shared.clock.now = edge + 12 * 3_600_000;
    await tick(pc.ports);
    expect(shared.github.checkRuns[0]?.conclusion).toBe('cancelled');
  }
});

test('F4: a window file that breaks mid-run keeps the edge the run was admitted with', async () => {
  const shared = world();
  const pc = machine('pc', shared);
  await tick(pc.ports);
  pc.setStatus({
    state: 'running',
    plan: {
      jobs: ['plan', 'fast', 'browser'],
      skips: {},
      shards: [1, 2, 3].map((shard) => ({ shard, groups: 'golden:a' })),
      outputs: {},
    },
  });
  // The runner supervises the run for a while under the broken file, then the edge comes.
  shared.windows = 'not json';
  await tickUntil(pc, shared, Date.parse('2026-11-23T04:56:00Z'));
  await tick(pc.ports);
  expect(pc.stopped).toEqual(['2026-11-23T04:55:00.000Z']);
});

test('F4: a slot not shown clean after a stop admits nothing and alerts, until it is clean', async () => {
  const shared = world();
  const pc = machine('pc', shared);
  await tick(pc.ports);
  pc.faults.dirty = 'a Supabase container stays';
  shared.pulls = [pull(1, { headSha: 'c'.repeat(40) })];
  await tick(pc.ports);
  shared.pulls = [pull(2)];
  await tick(pc.ports);
  await tick(pc.ports);
  expect(pc.started.map((run) => run.pull)).toEqual([1]);
  expect(pc.alerts.filter((kind) => kind === 'dirty')).toHaveLength(1);
  pc.faults.dirty = null;
  await tick(pc.ports);
  expect(pc.started.map((run) => run.pull)).toEqual([1, 2]);
});

test('F4: a stop signals only the recorded process group: SIGTERM, then SIGKILL after the grace', async () => {
  const signals: [number, string | 0][] = [];
  let elapsed = 0;
  let alive = true;
  const gone = await endProcessGroup(
    4_242,
    (pid, name) => {
      signals.push([pid, name]);
      if (name === 'SIGKILL') alive = false;
      return name === 0 ? alive : true;
    },
    async (ms) => void (elapsed += ms),
  );
  expect(gone).toBe(true);
  expect(signals.every(([pid]) => pid === -4_242)).toBe(true);
  expect(signals.filter(([, name]) => name !== 0)).toEqual([
    [-4_242, 'SIGTERM'],
    [-4_242, 'SIGKILL'],
  ]);
  expect(elapsed).toBeGreaterThanOrEqual(KILL_AFTER_MS);
  expect(elapsed).toBeLessThan(KILL_AFTER_MS + 5_000);
});

test("F5: a run past the sum of its jobs' timeouts is stopped, and its Check ends cancelled", async () => {
  const shared = world();
  const pc = machine('pc', shared);
  await tick(pc.ports);
  const plan = {
    jobs: ['plan', 'fast', 'check'],
    skips: {},
    shards: [],
    outputs: {},
  } as const satisfies RunPlan;
  pc.setStatus({ state: 'running', plan: { ...plan, jobs: [...plan.jobs] } });
  await tickUntil(pc, shared, MONDAY_NIGHT + ceilingMs({ ...plan, jobs: [...plan.jobs] }) - 60_000);
  await tick(pc.ports);
  expect(pc.stopped).toEqual([]);
  await tickUntil(pc, shared, shared.clock.now + 120_000);
  await tick(pc.ports);
  expect(pc.stopped).toHaveLength(1);
  expect(shared.github.checkRuns[0]?.conclusion).toBe('cancelled');
});

test('F5: a verdict is never posted when the approval or the profile changed while the run went; the head runs again', async () => {
  for (const change of ['approval', 'profile'] as const) {
    const shared = world();
    const pc = machine('pc', shared);
    await tick(pc.ports);
    if (change === 'approval') shared.pulls = [pull(1, { listGrowthApproved: true })];
    else shared.profile = 'fleet';
    pc.end(0);
    await tick(pc.ports);
    expect(shared.github.checkRuns[0]?.conclusion).toBe('cancelled');
    expect(leaseOf(shared.github, head(1))?.state).toBe('released');
    if (change === 'profile') {
      // Under any profile but local nothing starts.
      await tick(pc.ports);
      expect(pc.started).toHaveLength(1);
    } else {
      await tick(pc.ports);
      expect(pc.started).toHaveLength(2);
    }
  }
});

test('F5: a verdict records the approval it saw, and a changed approval makes the head eligible again', async () => {
  const shared = world();
  const pc = machine('pc', shared);
  await tick(pc.ports);
  pc.end(0);
  await tick(pc.ports);
  expect(leaseOf(shared.github, head(1))).toMatchObject({ state: 'done', approval: false });
  shared.pulls = [pull(1, { listGrowthApproved: true })];
  await tick(pc.ports);
  expect(pc.started).toHaveLength(2);
  expect(leaseOf(shared.github, head(1))).toMatchObject({ state: 'held', approval: true });
});

test('F6: an attempt after a cancelled run that wrote Plan gets its own run URL and folder', async () => {
  const shared = world();
  const pc = machine('pc', shared);
  await tick(pc.ports);
  pc.setStatus({ state: 'running', plan: { jobs: ['plan'], skips: {}, shards: [], outputs: {} } });
  shared.windows = { timezone: BERLIN_TIME_ZONE, standing: PC_STANDING };
  shared.clock.now = Date.parse('2026-11-23T04:56:00Z');
  await tick(pc.ports);
  shared.clock.now = Date.parse('2026-11-23T16:30:00Z');
  await tick(pc.ports);
  const [first, second] = pc.started;
  expect(second?.runUrl).not.toBe(first?.runUrl);
  expect(second?.runDir).not.toBe(first?.runDir);
});

test('F7: a cancellation GitHub refused is owed and retried until the Check is completed', async () => {
  const shared = world();
  const pc = machine('pc', shared);
  await tick(pc.ports);
  pc.faults.complete = 2;
  shared.pulls = [pull(1, { headSha: 'c'.repeat(40) })];
  await tick(pc.ports);
  expect(shared.github.checkRuns[0]?.conclusion).toBeNull();
  expect(pc.state().pendingCompletions).toHaveLength(1);
  await tick(pc.ports);
  expect(shared.github.checkRuns[0]?.conclusion).toBe('cancelled');
  expect(pc.state().pendingCompletions).toEqual([]);
});

test('F8: intake reads no commit status: a head whose legacy status says success is still claimed', async () => {
  const page = {
    data: {
      repository: {
        pullRequests: {
          totalCount: 1,
          nodes: [
            {
              number: 1,
              isDraft: false,
              headRefOid: head(1),
              mergeStateStatus: 'CLEAN',
              isCrossRepository: false,
              authorAssociation: 'OWNER',
              autoMergeRequest: null,
              labels: { totalCount: 0, nodes: [] },
              commits: {
                nodes: [{ commit: { status: { contexts: [{ context: 'Check', state: 'SUCCESS' }] } } }],
              },
            },
          ],
        },
      },
    },
  };
  const shared = world({ pulls: runnerPullsFromGitHub([page]) });
  const pc = machine('pc', shared);
  await tick(pc.ports);
  expect(pc.started.map((run) => run.pull)).toEqual([1]);
});

test('F10: a head older than the snapshot reader is skipped with one alert', async () => {
  const shared = world();
  const pc = machine('pc', shared);
  pc.headInfo.set(head(1), { upToDate: true, snapshotReader: false });
  await tick(pc.ports);
  await tick(pc.ports);
  expect(pc.started).toEqual([]);
  expect(pc.alerts).toEqual(['old-head']);
});

test('F12: an image that changed on the slot since the start admits nothing', async () => {
  const shared = world();
  const pc = machine('pc', shared);
  pc.faults.image = 'werkflow-ci:test changed on the slot';
  await tick(pc.ports);
  expect(pc.started).toEqual([]);
  expect(pc.alerts).toEqual(['hold']);
});

test('F13: an alert that could not be delivered stays pending and is delivered on a later tick', async () => {
  const shared = world({ pulls: [pull(1, { sameRepository: false })] });
  const pc = machine('pc', shared);
  pc.faults.alert = 1;
  await tick(pc.ports);
  expect(pc.alerts).toEqual([]);
  expect(pc.state().pendingAlerts).toHaveLength(1);
  await tick(pc.ports);
  expect(pc.alerts).toEqual(['untrusted']);
  expect(pc.state().pendingAlerts).toEqual([]);
});

test('F14: only a head up to date with main is claimed, and its run diffs against main', async () => {
  const shared = world({ pulls: [pull(1, { mergeState: 'BEHIND' }), pull(2), pull(3)] });
  const pc = machine('pc', shared);
  pc.headInfo.set(head(2), { upToDate: false, snapshotReader: true });
  await tick(pc.ports);
  expect(pc.started.map((run) => [run.pull, run.base])).toEqual([[3, MAIN]]);
});

test("the Mac's resize happens only between runs", async () => {
  const shared = world({
    clock: { now: Date.parse('2026-11-23T18:00:00Z') },
    pulls: [pull(1), pull(2)],
    windows: MAC_WINDOWS,
  });
  const mac = machine('mac', shared, {
    sizes: { '4/6': { resize: ['colima', 'resize', '4/6'] }, '8/8': { resize: ['colima', 'resize', '8/8'] } },
  });
  await tick(mac.ports);
  expect(mac.resized).toEqual(['colima resize 4/6']);
  mac.setStatus({
    state: 'running',
    plan: {
      jobs: ['plan', 'fast', 'browser'],
      skips: {},
      shards: [1, 2, 3].map((shard) => ({ shard, groups: 'golden:a' })),
      outputs: {},
    },
  });
  await tickUntil(mac, shared, Date.parse('2026-11-23T19:05:00Z'));
  await tick(mac.ports);
  expect(mac.resized).toEqual(['colima resize 4/6']);
  mac.end(0);
  await tick(mac.ports);
  await tick(mac.ports);
  expect(mac.resized).toEqual(['colima resize 4/6', 'colima resize 8/8']);
  expect(mac.started.map((run) => run.pull)).toEqual([1, 2]);
});

test('a run is admitted only when its 90th-percentile time and the reserve end before the window turns off', async () => {
  const shared = world({ clock: { now: Date.parse('2026-11-23T04:35:00Z') } });
  const pc = machine('pc', shared);
  await tick(pc.ports);
  expect(pc.started).toEqual([]);
  shared.clock.now = Date.parse('2026-11-23T04:20:00Z');
  await tick(pc.ports);
  expect(pc.started).toHaveLength(1);
  expect(percentile([10, 20, 30, 40, 50, 60, 70, 80, 90, 100], 90)).toBe(90);
});

test("a restarted runner ends the older generation's run, hands its lease back and never resumes it", async () => {
  const shared = world();
  const before = machine('pc', shared);
  await tick(before.ports);
  const after = machine('pc', shared, { generation: 2, state: before.state() });
  expect(await recover(after.ports)).toContain('attempt 1');
  expect(after.state().current).toBeNull();
  expect(shared.github.checkRuns[0]?.conclusion).toBe('cancelled');
  expect(leaseOf(shared.github, head(1))?.state).toBe('released');
});

test('the next off edge is found across size changes, and none ahead of a window that never turns off', () => {
  expect(nextOffEdge(PC_WINDOWS, MONDAY_NIGHT)).toBe(Date.parse('2026-11-23T05:00:00Z'));
  expect(nextOffEdge(MAC_WINDOWS, MONDAY_NIGHT)).toBeNull();
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
    expect(read(name)).toEqual({ timezone: BERLIN_TIME_ZONE, standing, exceptions: [] });
  }
});

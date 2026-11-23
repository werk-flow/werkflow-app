// The machine runner's decisions (machine-runner.ts) in a world of fake GitHub, run-commit, slot
// and clock (lib/testing/fixtures/machine-runner-world.ts). Each test names the invariant it holds.
import { machineConfigSchema } from './machine-config';
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
import { EDGE_MARGIN_MS, KILL_AFTER_MS, recover, runnerStateSchema, tick } from './machine-runner';
import { endProcessGroup } from '../../../scripts/ci/machine-watchdog';
import { runnerPullsFromGitHub } from './machine-pulls';
import type { RunPlan } from './results';
import { ceilingMs, percentile } from './run-ceiling';
import { MAC_STANDING, nextOffEdge, PC_STANDING, resolveWindow } from './windows';

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
  // CR 927: the lease was already done when the Check was completed.
  expect(shared.github.atCompletion).toEqual(['done']);
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
  expect(pc.stopped).toEqual(['2026-11-23T04:53:00.000Z']);
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
  for (const name of ['mac.example.json', 'pc.example.json']) {
    const config = machineConfigSchema.parse(read(name));
    // S4: the probe tries every port the agents' stacks and T3 listen on, not one of each.
    const ports = config.probePorts.map((target) => Number(target.split(':')[1]));
    for (const port of [54321, 54322, 54323, 54324, 54325, 54326, 54327, 3773]) expect(ports).toContain(port);
  }
  for (const [name, standing] of [
    ['pc.windows.example.json', PC_STANDING],
    ['mac.windows.example.json', MAC_STANDING],
  ] as const) {
    expect(resolveWindow(read(name), new Date(MONDAY_NIGHT)).kind).not.toBe('hold');
    expect(read(name)).toEqual({ timezone: BERLIN_TIME_ZONE, standing, exceptions: [] });
  }
});

test('S16, S7: a verdict whose first delivery failed is checked again at its retry, and a changed approval cancels it', async () => {
  const shared = world();
  const pc = machine('pc', shared);
  await tick(pc.ports);
  pc.faults.complete = 2;
  pc.end(0);
  await tick(pc.ports);
  expect(pc.state().pendingCompletions.map((completion) => completion.kind)).toEqual(['verdict']);
  // Behind main now, the head is not claimed again in this tick: only the approval decides.
  shared.pulls = [pull(1, { listGrowthApproved: true, mergeState: 'BEHIND' })];
  await tick(pc.ports);
  expect(shared.github.checkRuns[0]?.conclusion).toBe('cancelled');
  expect(leaseOf(shared.github, head(1))).toMatchObject({ attempt: 1, state: 'released' });
});

test('S17: a verdict that cannot be built from the results ends cancelled and hands the head back', async () => {
  const shared = world();
  const pc = machine('pc', shared);
  await tick(pc.ports);
  pc.faults.noVerdict = true;
  pc.end(0);
  await tick(pc.ports);
  expect(shared.github.checkRuns[0]?.conclusion).toBe('cancelled');
  expect(leaseOf(shared.github, head(1))?.state).toBe('released');
});

test('S18: a Check start whose answer was lost is found by its run URL, cancelled, and the lease handed back', async () => {
  const shared = world();
  const pc = machine('pc', shared);
  pc.faults.lostStart = true;
  await tick(pc.ports);
  expect(pc.started).toEqual([]);
  expect(shared.github.checkRuns.map((run) => run.conclusion)).toEqual(['cancelled']);
  expect(leaseOf(shared.github, head(1))?.state).toBe('released');
  expect(pc.state().starting).toBeNull();
});

test('S19: the window is read again at launch, and a run that no longer fits does not start', async () => {
  // 05:20 Berlin: a 30 min run fits until the claim; the Check start then takes 15 min.
  const shared = world({ clock: { now: Date.parse('2026-11-23T04:20:00Z') } });
  const pc = machine('pc', shared);
  pc.faults.startDelay = 15 * 60_000;
  await tick(pc.ports);
  expect(pc.started).toEqual([]);
  expect(shared.github.checkRuns[0]?.conclusion).toBe('cancelled');
  expect(leaseOf(shared.github, head(1))?.state).toBe('released');
});

test('S19: the slot is emptied after every run, and a slot not shown empty admits nothing', async () => {
  const shared = world({ pulls: [pull(1), pull(2)] });
  const pc = machine('pc', shared);
  await tick(pc.ports);
  pc.faults.dirty = 'a volume stays';
  pc.end(0);
  await tick(pc.ports);
  expect(pc.cleaned.length).toBeGreaterThan(0);
  await tick(pc.ports);
  expect(pc.started.map((run) => run.pull)).toEqual([1]);
  expect(pc.alerts).toContain('dirty');
});

test("S23: the sweep never deletes an unexpired held lease, even of a closed PR's head", async () => {
  const shared = world();
  const pc = machine('pc', shared);
  await tick(pc.ports);
  const other = machine('mac', world({ ...shared, pulls: [] }));
  await tick(other.ports);
  expect(leaseOf(shared.github, head(1))?.state).toBe('held');
});

test('CR 213: a window file that cannot be read mid-run still renews the lease and stops a moved head, and admits nothing new', async () => {
  const shared = world({ pulls: [pull(1), pull(2)] });
  const pc = machine('pc', shared);
  await tick(pc.ports);
  pc.ports.windows = () => {
    throw new Error('ENOENT');
  };
  await tickUntil(pc, shared, MONDAY_NIGHT + 15 * 60_000);
  expect(leaseOf(shared.github, head(1))?.expiresAt).toBeGreaterThan(MONDAY_NIGHT / 1_000 + 600);
  shared.pulls = [pull(1, { headSha: 'c'.repeat(40) }), pull(2)];
  await tick(pc.ports);
  await tick(pc.ports);
  expect(pc.stopped).toHaveLength(1);
  expect(pc.started.map((run) => run.pull)).toEqual([1]);
});

test('CR 122: a window size the configuration lacks raises one alert across ticks, and again only after the size was found', async () => {
  const shared = world({
    windows: MAC_WINDOWS,
    clock: { now: Date.parse('2026-11-23T18:00:00Z') },
    pulls: [],
  });
  const sizes: Record<string, { resize: string[] | null }> = {};
  const mac = machine('mac', shared, { sizes });
  await tick(mac.ports);
  await tick(mac.ports);
  expect(mac.alerts).toEqual(['hold']);
  sizes['4/6'] = { resize: null };
  await tick(mac.ports);
  delete sizes['4/6'];
  await tick(mac.ports);
  expect(mac.alerts).toEqual(['hold', 'hold']);
});

test('CR 143: a head whose Plan selected every group, once stopped at the edge, is admitted again only by the full estimate', async () => {
  const shared = world();
  const pc = machine('pc', shared);
  await tick(pc.ports);
  pc.setStatus({
    state: 'running',
    plan: { jobs: ['plan'], skips: {}, shards: [], outputs: { full: 'true' } },
  });
  await tick(pc.ports);
  shared.clock.now = Date.parse('2026-11-23T04:53:00Z');
  await tick(pc.ports);
  // Friday 03:00 Berlin: a 30 min run fits before 06:00, a 3 h full run does not; at 19:00 it does.
  shared.clock.now = Date.parse('2026-11-27T02:00:00Z');
  await tick(pc.ports);
  expect(pc.started).toHaveLength(1);
  shared.clock.now = Date.parse('2026-11-27T18:00:00Z');
  await tick(pc.ports);
  expect(pc.started).toHaveLength(2);
});

test("CR 152: a resize that crosses a size change starts no run until the slot has the window's size", async () => {
  const shared = world({ windows: MAC_WINDOWS, clock: { now: Date.parse('2026-11-23T18:58:00Z') } });
  const mac = machine('mac', shared, {
    sizes: { '4/6': { resize: ['resize', '4/6'] }, '8/8': { resize: ['resize', '8/8'] } },
  });
  // The resize takes minutes: the night size begins while it runs.
  mac.ports.resize = async (command) => {
    mac.resized.push(command.join(' '));
    shared.clock.now += 5 * 60_000;
  };
  await tick(mac.ports);
  expect(mac.started).toEqual([]);
  await tick(mac.ports);
  expect(mac.resized).toEqual(['resize 4/6', 'resize 8/8']);
  expect(mac.started).toHaveLength(1);
});

test("CR 132: a clock that stepped back past a run's start still owes its verdict and leaves the state loadable", async () => {
  const shared = world();
  const pc = machine('pc', shared);
  await tick(pc.ports);
  shared.clock.now -= 60_000;
  pc.end(0);
  await tick(pc.ports);
  expect(() => runnerStateSchema.parse(pc.state())).not.toThrow();
  expect(shared.github.checkRuns[0]?.conclusion).toBe('success');
});

test('S18: a start intent whose lookup comes back empty is kept and reconciled on a later tick, not dropped', async () => {
  const shared = world();
  const pc = machine('pc', shared);
  pc.faults.lostStart = true;
  pc.faults.findLag = 1;
  await tick(pc.ports);
  expect(pc.state().starting).not.toBeNull();
  expect(leaseOf(shared.github, head(1))?.state).toBe('held');
  await tick(pc.ports);
  expect(shared.github.checkRuns[0]?.conclusion).toBe('cancelled');
  // Attempt 1's lease was handed back, so the same tick could claim the head anew.
  expect(leaseOf(shared.github, head(1))?.attempt).toBe(2);
});

test('S19: the window file is read again right before launch, and a window that turned off starts no run', async () => {
  const shared = world();
  const pc = machine('pc', shared);
  pc.faults.onStart = () => {
    shared.windows = {
      timezone: BERLIN_TIME_ZONE,
      standing: [
        { days: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'], from: '00:00', to: '00:00', size: 'off' },
      ],
    };
  };
  await tick(pc.ports);
  expect(pc.started).toEqual([]);
  expect(shared.github.checkRuns[0]?.conclusion).toBe('cancelled');
});

test('CR 951: only a delivered verdict teaches admission a duration; a run without one does not', async () => {
  const shared = world({ pulls: [pull(1), pull(2)] });
  const pc = machine('pc', shared);
  await tick(pc.ports);
  pc.faults.noVerdict = true;
  shared.clock.now += 60_000;
  pc.end(1);
  await tick(pc.ports);
  expect(pc.state().durations.selected).toEqual([]);
  // The next run ends with a failing verdict that is delivered: its duration counts.
  await tick(pc.ports);
  shared.clock.now += 60_000;
  pc.end(1);
  await tick(pc.ports);
  expect(pc.started).toHaveLength(2);
  expect(pc.state().durations.selected).toEqual([60]);
});

test('CR 958: a run is admitted only if it ends before its stop-by instant, not only before the window turns off', async () => {
  // 05:25 Berlin: a 30 min run and the reserve end before 06:00, but past the stop at 05:53.
  const shared = world({ clock: { now: Date.parse('2026-11-23T04:25:00Z') } });
  const pc = machine('pc', shared);
  await tick(pc.ports);
  expect(pc.started).toEqual([]);
});

test('CR 965: a claim whose lease expired while the Check start took long starts no run', async () => {
  const shared = world();
  const pc = machine('pc', shared);
  pc.faults.startDelay = 11 * 60_000;
  await tick(pc.ports);
  expect(pc.started).toEqual([]);
  expect(shared.github.checkRuns[0]?.conclusion).toBe('cancelled');
});

test('CR 970: the sweep leaves a ref that holds no lease alone, as the claim does', async () => {
  const shared = world({ pulls: [] });
  shared.github.refs.set(head(9), { oid: 'hand', message: 'made by hand' });
  const pc = machine('pc', shared);
  await tick(pc.ports);
  expect(shared.github.refs.get(head(9))?.oid).toBe('hand');
});

test('CR 934: a failed delivery is logged by its error code or name only, never its message', async () => {
  const shared = world();
  const pc = machine('pc', shared);
  await tick(pc.ports);
  pc.ports.checks.complete = async () => {
    throw new Error('GitHub answered 502 for /home/owner/ci-runner with ghp_secrettoken');
  };
  shared.pulls = [pull(1, { headSha: 'c'.repeat(40) })];
  await tick(pc.ports);
  expect(pc.logs.some((line) => line.includes('stays owed (Error)'))).toBe(true);
  expect(pc.logs.join('\n')).not.toMatch(/ghp_|\/home\/owner/);
});

test("S1 (CI lead): the verdict carries run-commit's exit, so a run that did not exit 0 posts no pass", async () => {
  const shared = world();
  const pc = machine('pc', shared);
  await tick(pc.ports);
  pc.end(1);
  await tick(pc.ports);
  expect(pc.state().pendingCompletions).toEqual([]);
  expect(shared.github.checkRuns[0]?.conclusion).toBe('failure');
});

test('S2 (CI lead): a verdict of a head that fell behind main while the run went is cancelled, and the head runs again', async () => {
  const shared = world();
  const pc = machine('pc', shared);
  await tick(pc.ports);
  pc.headInfo.set(head(1), { upToDate: false, snapshotReader: true });
  pc.end(0);
  await tick(pc.ports);
  expect(shared.github.checkRuns[0]?.conclusion).toBe('cancelled');
  expect(leaseOf(shared.github, head(1))?.state).toBe('released');
});

test('S3 (CI lead): a window file that brings the edge closer mid-run restarts the watchdog at the new stop-by', async () => {
  const shared = world();
  const pc = machine('pc', shared);
  await tick(pc.ports);
  shared.windows = {
    timezone: BERLIN_TIME_ZONE,
    standing: [
      { days: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'], from: '00:00', to: '05:00', size: 'full' },
      { days: ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'], from: '05:00', to: '00:00', size: 'off' },
    ],
  };
  await tick(pc.ports);
  const stopBy = Date.parse('2026-11-23T04:00:00Z') - EDGE_MARGIN_MS;
  expect(pc.rearmed).toEqual([{ pull: 1, stopBy }]);
  await tick(pc.ports);
  expect(pc.rearmed).toHaveLength(1);
});

test('B2 (CI lead): the slot is reset after every run, and a reset that fails admits nothing and alerts with its output quoted', async () => {
  const shared = world({ pulls: [pull(1), pull(2)] });
  const pc = machine('pc', shared);
  await tick(pc.ports);
  pc.end(0);
  await tick(pc.ports);
  // The reset, which may take minutes, waits until the verdict went out on the next tick.
  expect(pc.resets).toEqual([]);
  await tick(pc.ports);
  expect(shared.github.checkRuns[0]?.conclusion).toBe('success');
  expect(pc.resets).toHaveLength(1);
  expect(pc.started.map((run) => run.pull)).toEqual([1, 2]);
  pc.faults.reset = 'docker load: no space left on device\n';
  pc.end(0);
  await tick(pc.ports);
  await tick(pc.ports);
  expect(pc.started.map((run) => run.pull)).toEqual([1, 2]);
  expect(pc.alerts).toContain('dirty');
  expect(pc.details.find((detail) => detail.includes('no space'))).toMatch(
    /\n```\ndocker load: no space left on device\n```$/,
  );
  pc.faults.reset = null;
  shared.pulls = [pull(3)];
  await tick(pc.ports);
  expect(pc.started.map((run) => run.pull)).toEqual([1, 2, 3]);
});

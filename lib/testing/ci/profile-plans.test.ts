// P2 of werk-flow/werkflow-planning#503: each profile still runs everything while no machine uses
// it. The plans of a docs-only PR, a code PR, a tooling PR, a queue batch of four, the push that
// lands it and a full run of main are computed dry, by the planner and the DAG with fixture groups,
// once for both profiles: a profile only places them. Across those runs and a week of schedules,
// each profile places every inventory item, and every plan is well formed.
import { expect, test } from 'bun:test';
import { resolve } from 'node:path';
import {
  addLocalDays,
  formatBerlinLocalDateTime,
  getLocalWeekday,
  resolveBerlinWallTime,
} from '../../date-time/berlin';
import { ciBrowserHoldUntil } from '../runner/group-schedule';
import {
  type CiGroup,
  ciPlan,
  componentShards,
  MAX_SHARDS,
  plannerOutputs,
  runnerModules,
} from '../selection/ci-plan';
import { E_INVOICE_STEP, eInvoiceReason } from '../selection/e-invoice-selection';
import { fastTierPlan } from '../selection/fast-tier';
import type { GroupDurations } from '../selection/group-durations';
import { getTestGroups, type TestGroup } from '../selection/test-groups';
import { CI_DAG, CI_EVENTS, CI_JOBS, type CiEvent } from './dag';
import {
  GROUP_KIND_JOBS,
  INVENTORY_KEYS,
  type InventoryKey,
  SCHEDULE_NAMES,
  type ScheduleTrigger,
  SCHEDULES,
} from './inventory';
import { CI_PROFILES, type CiProfile, placementOf, type Timing } from './profiles';
import type { RunPlan } from './results';
import { isStep, planRun } from './run-plan';

const repositoryRoot = resolve(import.meta.dir, '../../..');

/** A planner group that keeps its registry kind. */
type FixtureGroup = CiGroup & { kind: TestGroup['kind'] };

const group = (
  id: string,
  kind: TestGroup['kind'],
  file: string,
  trigger?: CiGroup['trigger'],
): FixtureGroup => ({
  id,
  kind,
  files: [file],
  scopes: ['*'],
  executionInputs: [file],
  trigger,
});

/** One group or more of every kind, browser groups of every shard kind among them. */
const GROUPS: readonly FixtureGroup[] = [
  group('static:lint', 'static', 'eslint.config.mjs'),
  group('static:typecheck', 'static', 'tsconfig.json'),
  group('static:docs', 'static', 'scripts/check-docs.ts'),
  group('static:coverage', 'static', 'scripts/check-test-coverage.ts'),
  group('static:dependencies', 'static', 'scripts/check-dependency-security.ts'),
  group('unit:all', 'unit', 'lib/jobs/status.test.ts'),
  group('sql:grants', 'sql', 'supabase/tests/grants.sql'),
  group('ui:contracts:work', 'ui', 'tests/ui-contracts/work.spec.ts'),
  group('golden:gg-00', 'golden', 'tests/golden/gg-00.spec.ts', 'critical'),
  group('golden:p1-04', 'golden', 'tests/golden/p1-04.spec.ts', 'own-test'),
  group('audit:lab:calendar', 'audit', 'tests/audit/lab/calendar.spec.ts', 'product'),
  group('audit:layout:work', 'audit', 'tests/audit/layout/work.spec.ts', 'scope'),
  group('audit:visual', 'audit', 'tests/audit/visual/references.spec.ts', 'release-only'),
  group('audit:performance:calendar', 'audit', 'tests/audit/performance/calendar.spec.ts', 'release-only'),
  group('canary:providers', 'canary', 'tests/canary/canary.spec.ts'),
];
const GRAPH = new Map<string, string[]>([
  ['tests/ui-contracts/work.spec.ts', ['components/work/card.tsx']],
  ['tests/golden/gg-00.spec.ts', ['components/work/card.tsx']],
  ['components/work/card.tsx', ['lib/jobs/status.ts']],
  ['scripts/verify.ts', ['lib/testing/selection/group-selection.ts']],
]);
const DURATIONS: GroupDurations = { source: 'test', defaultSeconds: 300, groups: {} };
const TREE = 'a'.repeat(40);
const BASE = 'b'.repeat(40);

type DryRun = {
  name: string;
  event: CiEvent;
  plan: RunPlan;
  /** The CI events besides runs that this case raises, such as a closed pull request. */
  raises: readonly string[];
};

/** The plan of one run, as scripts/ci-plan.ts and scripts/ci/job.ts plan would make it. */
function dryRun(input: {
  name: string;
  event: CiEvent;
  /** The registry the planner reads: the fixture groups unless a case passes the real one. */
  groups?: readonly FixtureGroup[];
  changedFiles?: readonly string[];
  fullRun?: string;
  at?: Date;
  passedTree?: string;
  raises?: readonly string[];
}): DryRun {
  const groups = input.groups ?? GROUPS;
  const changedFiles = input.fullRun === undefined ? input.changedFiles : [];
  const browser = ciPlan({
    groups,
    changedFiles,
    fullRun: input.fullRun,
    runnerModules: runnerModules(GRAPH, []),
    rowChanges: [],
    dependencies: {},
    actionJobs: {},
    durations: DURATIONS,
  });
  const fast = fastTierPlan({
    groups,
    graph: GRAPH,
    changedFiles,
    fullReason: browser.fullReason,
    everyGroupOf: browser.tooling.fast,
    rowChanges: [],
    tailwindScans: (file) => file.endsWith('.tsx'),
  });
  const invoices = eInvoiceReason({
    graph: GRAPH,
    changedFiles,
    lintOnly: browser.tooling.lintOnly,
    fullReason: browser.fullReason,
    toolingReason: browser.tooling.invoices,
  });
  const hold =
    input.at && input.event !== 'pr' && browser.shards.length ? ciBrowserHoldUntil(input.at) : undefined;
  const outputs = plannerOutputs({
    groups,
    plan: browser,
    fast,
    selectedInvoices: invoices ? E_INVOICE_STEP : '',
    midnightUntil: hold ? hold.toISOString() : '',
    componentShards: componentShards(fast.components, DURATIONS),
  });
  const plan = planRun({
    event: input.event,
    tree: TREE,
    base: input.event === 'full' ? null : BASE,
    listGrowthApproved: false,
    outputs,
    passedTree: input.passedTree,
    reused: () => undefined,
  });
  return { name: input.name, event: input.event, plan, raises: input.raises ?? [] };
}

const DOCS = ['docs/technical/testing.md'];
const CODE = ['components/work/card.tsx', 'lib/jobs/status.ts', 'supabase/migrations/20261122000000_x.sql'];
const TOOLING = ['scripts/ci/job.ts'];
const PRODUCT = ['app/(app)/auftraege/page.tsx'];
/** 23:50 Berlin: inside the midnight start window, so the full run's shards wait. */
const LATE_EVENING = new Date('2026-11-23T22:50:00Z');

const RUNS: readonly DryRun[] = [
  dryRun({ name: 'docs-only PR', event: 'pr', changedFiles: DOCS, raises: ['pull-request-closed'] }),
  dryRun({ name: 'code PR', event: 'pr', changedFiles: CODE }),
  dryRun({ name: 'tooling PR', event: 'pr', changedFiles: TOOLING, raises: ['list-growth-label'] }),
  dryRun({
    name: 'queue batch of 4',
    event: 'integration',
    changedFiles: [...DOCS, ...CODE, ...TOOLING, ...PRODUCT],
    raises: ['queue-run-completed'],
  }),
  dryRun({
    name: 'push that lands the batch',
    event: 'main',
    changedFiles: [...DOCS, ...CODE, ...TOOLING, ...PRODUCT],
    passedTree: 'https://ci.example/runs/batch',
    raises: ['main-run-completed'],
  }),
  dryRun({ name: 'full run of main', event: 'full', fullRun: 'Full run on main', at: LATE_EVENING }),
];

/** The instants a timing fires in the week from Monday 2026-11-23, Berlin time. */
function firings(timing: Timing): Date[] {
  const days = Array.from({ length: 7 }, (_, offset) => addLocalDays('2026-11-23', offset));
  const berlin = (date: string, time: string): Date => {
    const resolved = resolveBerlinWallTime(`${date}T${time}`);
    if (!resolved) throw new Error(`${date}T${time} is no Berlin wall time.`);
    return resolved.instant;
  };
  if (timing.kind === 'clock')
    return days.flatMap((date) => {
      const weekday = getLocalWeekday(date);
      if (!timing.weekdays.some((day) => day === weekday)) return [];
      return [timing.zone === 'UTC' ? new Date(`${date}T${timing.at}:00Z`) : berlin(date, timing.at)];
    });
  return days.flatMap((date) => {
    const [from, to] = [berlin(date, timing.from), berlin(date, timing.to)];
    const slots: Date[] = [];
    for (let at = from.getTime(); at < to.getTime(); at += timing.everyMinutes * 60_000)
      slots.push(new Date(at));
    return slots;
  });
}

/** Whether a Berlin wall time `HH:MM` falls in a window, which may span midnight. */
const inWindow = (clock: string, window: { from: string; to: string }): boolean =>
  window.from <= window.to
    ? clock >= window.from && clock < window.to
    : clock >= window.from || clock < window.to;

/** The inventory items a profile places across the dry runs and a week of schedules. */
function placed(profile: CiProfile): Set<InventoryKey> {
  const keys = new Set<InventoryKey>();
  const place = (key: InventoryKey): void => {
    expect(placementOf(profile, key).executor, `${profile.name} ${key}`).toBeDefined();
    keys.add(key);
  };
  for (const run of RUNS) {
    place(`run:${run.event}`);
    for (const job of run.plan.jobs) place(`job:${job}`);
  }
  const raised = new Set(RUNS.flatMap((run) => run.raises));
  for (const name of SCHEDULE_NAMES) {
    const trigger = SCHEDULES[name].trigger;
    const placement = profile.schedules[name];
    if (
      trigger.on === 'event'
        ? raised.has(trigger.event)
        : 'timing' in placement && firings(placement.timing).length
    )
      place(`schedule:${name}`);
  }
  return keys;
}

for (const profile of Object.values(CI_PROFILES))
  test(`the ${profile.name} profile places every inventory item across the dry runs and a week`, () => {
    expect([...placed(profile)].toSorted()).toEqual([...INVENTORY_KEYS].sort());
  });

// A cron run that holds only waits until its hold ends (inventory.ts), so its work starts then.
test("the local profile's timed schedules start their work inside its night window", () => {
  const { window } = CI_PROFILES.local;
  if (!window) throw new Error('The local profile has no window.');
  const outside = SCHEDULE_NAMES.flatMap((name) => {
    const placement = CI_PROFILES.local.schedules[name];
    if (!('timing' in placement)) return [];
    const trigger: ScheduleTrigger = SCHEDULES[name].trigger;
    if (trigger.on === 'time' && trigger.hold && placement.clock === 'workflow')
      return inWindow(trigger.hold.until, window) ? [] : [`${name} holds until ${trigger.hold.until}`];
    return firings(placement.timing)
      .map((at) => formatBerlinLocalDateTime(at).slice(11))
      .filter((clock) => !inWindow(clock, window))
      .map((clock) => `${name} at ${clock}`);
  });
  expect(outside).toEqual([]);
});

test('every dry plan is well formed: its event runs each job, each need ran or says why not, shards are whole', () => {
  for (const { name, event, plan } of RUNS) {
    for (const job of plan.jobs) {
      expect(CI_DAG[job].events, `${name}: ${job}`).toContain(event);
      for (const need of CI_DAG[job].needs) {
        expect(CI_JOBS.indexOf(need), `${name}: ${job} needs ${need}`).toBeLessThan(CI_JOBS.indexOf(job));
        expect(
          plan.jobs.includes(need) || plan.skips[need] !== undefined,
          `${name}: ${job} needs ${need}`,
        ).toBe(true);
      }
    }
    for (const job of CI_JOBS)
      expect(
        plan.jobs.includes(job) !== (plan.skips[job] !== undefined),
        `${name}: ${job} runs or says why not`,
      ).toBe(true);
    for (const [key, most] of [
      ['shards', MAX_SHARDS],
      ['component_shards', 2],
    ] as const) {
      const shards: unknown = JSON.parse(plan.outputs[key] ?? '[]');
      expect(Array.isArray(shards), `${name}: ${key}`).toBe(true);
      const list = Array.isArray(shards) ? shards : [];
      expect(list.length, `${name}: ${key}`).toBeLessThanOrEqual(most);
      expect(
        list.map((entry: unknown) =>
          typeof entry === 'object' && entry !== null && 'shard' in entry ? entry.shard : 0,
        ),
        `${name}: ${key} are numbered from 1`,
      ).toEqual(list.map((_, index) => index + 1));
    }
  }
});

const runOf = (name: string): DryRun => {
  const run = RUNS.find((candidate) => candidate.name === name);
  if (!run) throw new Error(`No dry run ${name}.`);
  return run;
};

test('the dry runs keep the fleet design: a PR runs the fast tier, the queue the browser groups once, the landing nothing', () => {
  expect(runOf('docs-only PR').plan.jobs).toEqual(['plan', 'fast', 'check']);
  expect(runOf('code PR').plan.jobs).toEqual(['plan', 'fast', 'sql', 'components', 'check']);
  expect(runOf('tooling PR').plan.jobs).toEqual(['plan', 'fast', 'sql', 'components', 'invoices', 'check']);
  for (const name of ['docs-only PR', 'code PR', 'tooling PR']) expect(runOf(name).plan.shards).toEqual([]);
  expect(runOf('queue batch of 4').plan.shards.length).toBeGreaterThan(0);
  expect(runOf('push that lands the batch').plan.jobs).toEqual(['plan', 'check']);
  expect(runOf('full run of main').plan.jobs).toEqual([...CI_JOBS]);
});

test("the full run's work holds every fixture group in the job its kind names, and no group CI never runs", () => {
  const work = runOf('full run of main').plan.work ?? [];
  for (const { id, kind } of GROUPS) {
    const carrier = GROUP_KIND_JOBS[kind];
    if (typeof carrier === 'string') expect(work, id).toContain(`${carrier}:${id}`);
    else
      expect(
        work.filter((entry) => entry.endsWith(`:${id}`)),
        id,
      ).toEqual([]);
  }
});

/** The real registry, as scripts/ci-plan.ts hands it to the planner. */
const REGISTERED: readonly FixtureGroup[] = getTestGroups(repositoryRoot).map((registered) => ({
  id: registered.id,
  kind: registered.kind,
  files: registered.files,
  scopes: registered.scopes,
  executionInputs: registered.files,
  trigger: registered.changeTrigger,
}));

for (const profile of Object.values(CI_PROFILES))
  test(`the ${profile.name} profile's full run of main does every registered group in the job its kind names, and nothing else`, () => {
    const { plan } = dryRun({
      name: `${profile.name} full run of the registry`,
      event: 'full',
      fullRun: 'Full run on main',
      at: LATE_EVENING,
      groups: REGISTERED,
    });
    const work = plan.work ?? [];
    // Every job of a full run in the DAG runs, the midnight hold too, and the profile places each.
    expect(plan.jobs).toEqual(CI_JOBS.filter((job) => CI_DAG[job].events.includes('full')));
    for (const job of plan.jobs) expect(placementOf(profile, `job:${job}`), job).toBeDefined();
    const expected = REGISTERED.flatMap(({ id, kind }) => {
      const carrier = GROUP_KIND_JOBS[kind];
      return typeof carrier === 'string' ? [`${carrier}:${id}`] : [];
    });
    expect(expected.length).toBeGreaterThan(0);
    const groupWork = work.filter((entry) => !isStep(entry.slice(entry.indexOf(':') + 1)));
    expect(groupWork.toSorted()).toEqual(expected.toSorted());
  });

test('the runs cover every kind of run', () => {
  expect([...new Set(RUNS.map((run) => run.event))].toSorted()).toEqual([...CI_EVENTS].sort());
});

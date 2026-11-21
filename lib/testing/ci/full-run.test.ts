// Main gets a full run when something untested landed: at once after a tooling change, otherwise in
// a daytime slot every 3 hours. Requests for one commit, or while one runs, start none
// (lib/testing/ci/full-run.ts).
import { expect, test } from 'bun:test';
import {
  type FullRun,
  fullRunDue,
  fullRunsInLedger,
  landedSelections,
  type Landed,
  treesSinceFullRun,
  unselectedFailures,
} from './full-run';
import type { CiResult } from './results';
import { planRun } from './run-plan';

const HISTORY = ['c3', 'c2', 'c1', 'c0'];
// 12:00 Berlin in winter (UTC+1).
const NOON = new Date('2026-11-21T11:00:00Z');
const hoursBefore = (at: Date, hours: number): Date => new Date(at.getTime() - hours * 3600_000);
const ended = (commit: string, startedAt: Date): FullRun => ({ commit, startedAt, ended: true });
const landed = (files: string[], tooling?: string): Landed => ({
  files,
  tooling: () => tooling,
  isDocs: (file) => file.endsWith('.md'),
});
const decide = (
  runs: FullRun[],
  options: { now?: Date; landed?: Landed | undefined } = {},
): ReturnType<typeof fullRunDue> =>
  fullRunDue({
    now: options.now ?? NOON,
    history: HISTORY,
    runs,
    landedSince: () => ('landed' in options ? options.landed : landed(['lib/jobs/status.ts'])),
  });

test('requests for a commit that has a full run, or while the newest one runs, start none', () => {
  expect(decide([ended('c3', hoursBefore(NOON, 5))])).toEqual({
    run: false,
    reason: 'c3 already has a full run.',
  });
  const running = decide([{ commit: 'c1', startedAt: hoursBefore(NOON, 5), ended: false }], {
    landed: landed(['scripts/ci/job.ts'], 'Tooling input changed: scripts/ci/job.ts'),
  });
  expect(running.run).toBe(false);
  expect(running.reason).toContain('still running');
  // A full run still running on an older commit holds the next back too, whatever ended since.
  const older = decide([
    ended('c2', hoursBefore(NOON, 4)),
    { commit: 'c0', startedAt: hoursBefore(NOON, 1), ended: false },
  ]);
  expect(older).toEqual({
    run: false,
    reason: 'The full run on c0 is still running; a later request takes the newer commits.',
  });
  // One on a commit outside main's history is none of main's.
  expect(
    decide([
      ended('c2', hoursBefore(NOON, 4)),
      { commit: 'x9', startedAt: hoursBefore(NOON, 1), ended: false },
    ]).run,
  ).toBe(true);
  expect(decide([]).reason).toBe('No full run on the last 4 commits of main.');
  expect(decide([]).run).toBe(true);
});

test('a slot starts no full run when only documentation, or nothing, landed since the newest full run', () => {
  const stale = [ended('c1', hoursBefore(NOON, 9))];
  expect(decide(stale, { landed: landed(['docs/README.md', 'AGENTS.md']) })).toEqual({
    run: false,
    reason: 'Only documentation landed since the full run on c1.',
  });
  expect(decide(stale, { landed: landed([]) }).run).toBe(false);
  expect(decide(stale).run).toBe(true);
});

test('a daytime slot starts a full run 3 hours after the last one, and never at night', () => {
  expect(decide([ended('c1', hoursBefore(NOON, 3))])).toEqual({
    run: true,
    reason: 'main moved 2 commits since the full run on c1.',
  });
  expect(decide([ended('c1', hoursBefore(NOON, 2))])).toEqual({
    run: false,
    reason: 'The full run on c1 started 120 min ago; the next slot is at 13:00 Berlin time.',
  });
  const night = new Date('2026-11-21T21:30:00Z');
  expect(decide([ended('c1', hoursBefore(night, 9))], { now: night }).reason).toBe(
    'It is 22:30 in Berlin; daytime full runs start from 06:00 to 20:00.',
  );
});

test("a slot follows Berlin's clock in winter and in summer", () => {
  const at = (iso: string) =>
    decide([ended('c1', hoursBefore(new Date(iso), 9))], { now: new Date(iso) }).run;
  // 04:30 UTC is 05:30 Berlin in winter and 06:30 in summer.
  expect(at('2026-01-15T04:30:00Z')).toBe(false);
  expect(at('2026-07-15T04:30:00Z')).toBe(true);
  // 18:30 UTC is 19:30 Berlin in winter and 20:30 in summer.
  expect(at('2026-01-15T18:30:00Z')).toBe(true);
  expect(at('2026-07-15T18:30:00Z')).toBe(false);
});

test('a tooling change starts a full run right after it landed, by day or night, and an unreadable diff counts as one', () => {
  const recent = [ended('c1', hoursBefore(NOON, 1))];
  const tooling = landed(['scripts/ci/job.ts'], 'Tooling input changed: scripts/ci/job.ts');
  expect(decide(recent, { landed: tooling })).toEqual({
    run: true,
    reason: 'A tooling change landed since the full run on c1: Tooling input changed: scripts/ci/job.ts.',
  });
  const night = new Date('2026-11-21T01:00:00Z');
  expect(decide([ended('c1', hoursBefore(night, 1))], { now: night, landed: tooling }).run).toBe(true);
  expect(decide(recent, { landed: undefined }).reason).toBe(
    'A tooling change landed since the full run on c1: the diff since that run cannot be read.',
  );
  // A due slot never asks the planner.
  let asked = 0;
  const counted: Landed = { ...tooling, tooling: () => `asked ${++asked}` };
  expect(decide([ended('c1', hoursBefore(NOON, 4))], { landed: counted }).run).toBe(true);
  expect(asked).toBe(0);
});

const RUN = (n: number): string => `https://ci.example/runs/${n}`;
const receipt = (overrides: Partial<CiResult>): CiResult => ({
  version: 1,
  job: 'plan',
  shard: null,
  event: 'full',
  tree: 'a'.repeat(40),
  commit: 'c'.repeat(40),
  base: null,
  status: 'passed',
  groups: [],
  planReason: 'Full run on main',
  reusedFrom: null,
  listGrowthApproved: false,
  producer: 'mac-standin',
  runUrl: RUN(1),
  startedAt: '2026-11-21T09:00:00.000Z',
  completedAt: '2026-11-21T09:01:00.000Z',
  ...overrides,
});

test("a ledger's full run runs until its final Check, and a stale one without it is no full run", () => {
  const ledger = [
    receipt({ event: 'integration', runUrl: RUN(9) }),
    receipt({ runUrl: null }),
    receipt({}),
    receipt({ job: 'browser', startedAt: '2026-11-21T09:30:00.000Z' }),
    receipt({ job: 'check', status: 'running', completedAt: null, startedAt: '2026-11-21T09:40:00.000Z' }),
    receipt({ runUrl: RUN(2), commit: 'd'.repeat(40), startedAt: '2026-11-21T10:00:00.000Z' }),
    receipt({
      runUrl: RUN(2),
      job: 'check',
      status: 'failed',
      commit: 'd'.repeat(40),
      startedAt: '2026-11-21T10:40:00.000Z',
    }),
  ];
  expect(fullRunsInLedger(ledger, NOON)).toEqual([
    { commit: 'c'.repeat(40), startedAt: new Date('2026-11-21T09:00:00.000Z'), ended: false },
    { commit: 'd'.repeat(40), startedAt: new Date('2026-11-21T10:00:00.000Z'), ended: true },
  ]);
  // A run whose runner died tested nothing: 4 hours after its newest receipt it neither holds the
  // next back nor counts.
  expect(fullRunsInLedger(ledger, new Date('2026-11-21T13:40:00Z'))).toEqual([
    { commit: 'd'.repeat(40), startedAt: new Date('2026-11-21T10:00:00.000Z'), ended: true },
  ]);
});

test('a rerun of an ended full run runs again until its own final Check, and goes stale from its own start', () => {
  const first = [
    receipt({}),
    receipt({ job: 'check', status: 'failed', startedAt: '2026-11-21T09:40:00.000Z' }),
  ];
  // The rerun's first job starts before its Check writes any receipt.
  const rerun = [...first, receipt({ job: 'browser', attempt: 2, startedAt: '2026-11-21T10:30:00.000Z' })];
  const run = (ended: boolean): FullRun => ({
    commit: 'c'.repeat(40),
    startedAt: new Date('2026-11-21T09:00:00.000Z'),
    ended,
  });
  expect(fullRunsInLedger(first, NOON)).toEqual([run(true)]);
  expect(fullRunsInLedger(rerun, NOON)).toEqual([run(false)]);
  const checking = [
    ...rerun,
    receipt({ job: 'check', status: 'running', attempt: 2, startedAt: '2026-11-21T10:50:00.000Z' }),
  ];
  expect(fullRunsInLedger(checking, NOON)).toEqual([run(false)]);
  // 4 hours after the first attempt's start, the rerun that started later still runs.
  expect(fullRunsInLedger(checking, new Date('2026-11-21T13:10:00Z'))).toEqual([run(false)]);
  const done = [
    ...checking,
    receipt({ job: 'check', status: 'passed', attempt: 2, startedAt: '2026-11-21T10:50:00.000Z' }),
  ];
  expect(fullRunsInLedger(done, NOON)).toEqual([run(true)]);
});

test('a full-run failure counts as unselected unless CI selected its group on a landed tree, reused shards included', () => {
  const landedTree = 'e'.repeat(40);
  const outputs: Record<string, string> = {
    browser: 'true',
    full: 'false',
    full_reason: '',
    tooling_reason: '',
    shards: JSON.stringify([
      { shard: 1, groups: 'golden:gg-00,golden:p1-21' },
      { shard: 2, groups: 'audit:layout:job' },
    ]),
    midnight_until: '',
    static: 'static:typecheck',
    sql: 'sql:grants',
    selected_lint: 'static:lint',
    selected_static: 'static:typecheck',
    selected_unit: 'unit:all',
    selected_sql: 'sql:grants',
    selected_components: 'ui:contracts:work,ui:contracts:time',
    component_shards: JSON.stringify([
      { shard: 1, groups: 'ui:contracts:work' },
      { shard: 2, groups: 'ui:contracts:time' },
    ]),
    selected_invoices: '',
  };
  // The integration run reuses the second component shard and the second browser shard.
  const runPlan = planRun({
    event: 'integration',
    tree: landedTree,
    base: null,
    listGrowthApproved: false,
    outputs,
    passedTree: undefined,
    reused: (key) => (key.shard === 2 && key.job !== 'fast' ? RUN(7) : undefined),
  });
  expect(runPlan.outputs.component_shards).not.toContain('ui:contracts:time');
  expect(runPlan.shards.map((shard) => shard.groups)).toEqual(['golden:gg-00,golden:p1-21']);
  const ledger = [
    receipt({
      event: 'integration',
      runUrl: RUN(7),
      job: 'browser',
      shard: 2,
      tree: landedTree,
      groups: [{ id: 'audit:layout:job', outcome: 'passed', durationMs: 1 }],
    }),
    receipt({ event: 'integration', tree: landedTree, plan: runPlan }),
    // A pull request's run, a failed plan, another tree's plan and a full run select nothing.
    receipt({
      event: 'pr',
      tree: landedTree,
      plan: { ...runPlan, outputs: { ...outputs, selected_sql: 'sql:pr-only' } },
    }),
    receipt({
      event: 'integration',
      tree: landedTree,
      status: 'failed',
      plan: { ...runPlan, outputs: { ...outputs, selected_sql: 'sql:failed-plan' } },
    }),
    receipt({
      event: 'main',
      tree: 'f'.repeat(40),
      plan: { ...runPlan, outputs: { ...outputs, selected_sql: 'sql:other-tree' } },
    }),
    receipt({
      event: 'full',
      job: 'browser',
      tree: landedTree,
      groups: [{ id: 'audit:visual', outcome: 'failed', durationMs: 1 }],
    }),
  ];
  const selected = landedSelections(ledger, new Set([landedTree]));
  expect(
    unselectedFailures(
      [
        'golden:p1-21',
        'audit:layout:job',
        'ui:contracts:time',
        'sql:grants',
        'static:typecheck',
        'sql:pr-only',
        'sql:failed-plan',
        'sql:other-tree',
        'audit:visual',
        'audit:performance:field',
        'audit:visual',
        'step:server',
        'step:build',
      ],
      selected,
    ),
  ).toEqual(['sql:pr-only', 'sql:failed-plan', 'sql:other-tree', 'audit:visual', 'audit:performance:field']);
});

test("the trees landed since the previous full run end before that run's commit, and always hold the full run's own", () => {
  const history = HISTORY.map((commit) => ({ commit, tree: `tree-${commit}` }));
  // The full run's own commit c3 is in the ledger as well; only an older commit's run ends the walk.
  const runs = [ended('c3', NOON), ended('c1', hoursBefore(NOON, 5))];
  expect([...treesSinceFullRun(history, runs)]).toEqual(['tree-c3', 'tree-c2']);
  expect([...treesSinceFullRun(history, [])]).toEqual(['tree-c3', 'tree-c2', 'tree-c1', 'tree-c0']);
});

test('an unfinished full run on an older commit does not end the landed window', () => {
  const history = HISTORY.map((commit) => ({ commit, tree: `tree-${commit}` }));
  const runs = [
    ended('c3', NOON),
    { commit: 'c2', startedAt: hoursBefore(NOON, 1), ended: false },
    ended('c1', hoursBefore(NOON, 5)),
  ];
  expect([...treesSinceFullRun(history, runs)]).toEqual(['tree-c3', 'tree-c2']);
});

test("only a head's ended full run that tested something lets the nightly skip it; one that ended before any group ran does not", () => {
  const failedBeforeTests = [
    receipt({ status: 'failed' }),
    receipt({ job: 'check', status: 'failed', startedAt: '2026-11-21T09:05:00.000Z' }),
  ];
  const tested = [
    receipt({}),
    receipt({
      job: 'browser',
      shard: 1,
      status: 'failed',
      groups: [{ id: 'golden:p1-01', outcome: 'failed', durationMs: 1 }],
      startedAt: '2026-11-21T09:30:00.000Z',
    }),
    receipt({ job: 'check', status: 'failed', startedAt: '2026-11-21T09:40:00.000Z' }),
  ];
  const head = (ledger: CiResult[]) =>
    fullRunDue({
      now: NOON,
      history: ['c'.repeat(40)],
      runs: fullRunsInLedger(ledger, NOON),
      landedSince: () => landed([]),
    });
  expect(head(failedBeforeTests)).toEqual({
    run: false,
    reason: `${'c'.repeat(40)} already has a full run.`,
  });
  expect(head(tested)).toMatchObject({ run: false, headHasFullRun: true });
});

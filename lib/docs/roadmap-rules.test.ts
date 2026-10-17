import { describe, expect, test } from 'bun:test';
import {
  checkRoadmapRows,
  findRoadmapCounterProblems,
  findStaleSpecReviews,
  logRecordsAcceptance,
  primarySpecsOf,
  readLogEntries,
  readRoadmapRows,
} from './roadmap-rules';

const header =
  '| ID | Status | Bounded outcome | Direct dependencies | Primary / connected specs | Exit evidence and gate |';

describe('roadmap rows', () => {
  test('reads a row with a defined status, its dependencies and its spec cell', () => {
    const { rows, problems } = readRoadmapRows(
      [
        header,
        '| `P1-02` | `complete` | Requests | `P1-00a`, `P1-01` | Customers/CRM; jobs | Accepted |',
      ].join('\n'),
    );
    expect(problems).toEqual([]);
    expect(rows).toEqual([
      {
        line: 2,
        id: 'P1-02',
        status: 'complete',
        dependencies: ['P1-00a', 'P1-01'],
        specs: 'Customers/CRM; jobs',
        exitEvidence: 'Accepted',
      },
    ]);
  });

  test('rejects a status the protocol does not define and a row that lost its shape', () => {
    const { rows, problems } = readRoadmapRows(
      [
        '| `P1-03` | `done` | People | `P1-00` | Employee management | Tests pass |',
        '| `P1-04` | complete | Schedules | `P1-00` | Employee management | Tests pass |',
        '| `P1-05` | `planned` | Missing a cell | Employee management | Tests pass |',
      ].join('\n'),
    );
    expect(rows.map((row) => row.id)).toEqual(['P1-03']);
    expect(problems).toEqual([
      expect.stringContaining('line 1: P1-03 has the status `done`'),
      expect.stringContaining('line 2: the P1-04 row needs 6 cells'),
      expect.stringContaining('line 3: the P1-05 row needs 6 cells'),
    ]);
  });
});

describe('progress-log entry of an accepted slice', () => {
  const log = [
    '# Phase 1 Progress Log',
    '',
    '**2026-09-24 — `P1-24a` accepted complete.** See the [record](slices/p1-24a-plantafel.md).',
    '',
    '**2026-09-02 — `P1-24` implementation authorized.** Discovery is done.',
    '| 2026-08-29 | `P1-18` | Accepted **complete**. Sites own equipment. |',
  ].join('\n');
  const entries = readLogEntries(log);

  test('finds the entry by its record link or by the accepted-complete phrase', () => {
    expect(entries).toHaveLength(3);
    expect(logRecordsAcceptance(entries, 'P1-24a', 'slices/p1-24a-plantafel.md')).toBe(true);
    expect(logRecordsAcceptance(entries, 'P1-18', 'slices/p1-18-installed-equipment.md')).toBe(true);
  });

  test('an authorization entry or a longer id does not stand in for the acceptance', () => {
    expect(logRecordsAcceptance(entries, 'P1-24', 'slices/p1-24-controlled-people-lifecycle.md')).toBe(false);
  });
});

describe('primary spec of a row', () => {
  const allSpecs = ['features/a.md', 'features/b.md'];

  test('maps the first name of the spec cell', () => {
    expect(primarySpecsOf('Service/maintenance; CRM; jobs', allSpecs)).toEqual([
      'features/service-and-maintenance.md',
    ]);
    expect(primarySpecsOf('Time tracking; employee', allSpecs)).toEqual(['features/time-tracking.md']);
    expect(primarySpecsOf('All feature specs; technical architecture', allSpecs)).toEqual(allSpecs);
  });

  test('a name that maps to no spec returns null', () => {
    expect(primarySpecsOf('Technical docs; all feature specs', allSpecs)).toBeNull();
  });
});

describe('spec review date against slice acceptance', () => {
  const reviewedOn = new Map<string, string | null>([
    ['features/time-tracking.md', '2026-09-01'],
    ['features/inventory.md', '2026-08-01'],
  ]);

  test('passes when the spec was reviewed on or after the latest acceptance', () => {
    expect(
      findStaleSpecReviews(
        [
          { id: 'P1-21', acceptedOn: '2026-08-20', primarySpecs: ['features/time-tracking.md'] },
          { id: 'P1-22', acceptedOn: '2026-09-01', primarySpecs: ['features/time-tracking.md'] },
        ],
        reviewedOn,
      ),
    ).toEqual([]);
  });

  test('reports a spec reviewed before the acceptance and a spec that does not exist', () => {
    expect(
      findStaleSpecReviews(
        [
          { id: 'P1-25', acceptedOn: '2026-10-02', primarySpecs: ['features/inventory.md'] },
          { id: 'P1-99', acceptedOn: '2026-10-02', primarySpecs: ['features/gone.md'] },
        ],
        reviewedOn,
      ),
    ).toEqual([
      expect.stringContaining('docs/features/inventory.md was last reviewed 2026-08-01, before P1-25'),
      'P1-99 names features/gone.md as its primary spec, which does not exist',
    ]);
  });
});

describe('roadmap counter and rows', () => {
  const rows = readRoadmapRows(
    [
      header,
      '| `P1-01` | `complete` | Sites | `P1-00` | Customers/CRM | Accepted `complete` 2026-08-04 ([record](slices/p1-01-sites.md)) |',
      '| `P1-02` | `planned` | Requests | `P1-01` | Customers/CRM | Open |',
      '| `P1-03` | `ready` | People | `P1-02` | Employee management | Open |',
    ].join('\n'),
  ).rows;

  test('probe: a counter that disagrees with the rows fails', () => {
    expect(findRoadmapCounterProblems('**Formally accepted roadmap slices:** 1 of 3 accepted', rows)).toEqual(
      [],
    );
    expect(findRoadmapCounterProblems('**Formally accepted roadmap slices:** 2 of 4 accepted', rows)).toEqual(
      [
        'the counter says 2 accepted but the slice index has 1 complete rows',
        'the counter says 4 slices but the slice index has 3 rows',
      ],
    );
    expect(findRoadmapCounterProblems('no counter', rows)).toEqual([
      'the accepted-slices counter line is missing',
    ]);
  });

  test('probe: a stale ready set, a record closed on another day and a missing log entry fail', () => {
    const { problems, accepted } = checkRoadmapRows(rows, {
      statuses: new Map([['plans/phase-1/slices/p1-01-sites.md', { kind: 'closed', date: '2026-08-05' }]]),
      logEntries: [],
      featureSpecs: ['features/customers-and-crm.md'],
    });
    expect(problems).toEqual([
      'P1-01 row says accepted 2026-08-04 but slices/p1-01-sites.md is closed (2026-08-05)',
      expect.stringContaining('P1-01 is complete but docs/plans/phase-1/log.md has no entry'),
      'P1-02 is planned but every direct prerequisite is complete; recompute the ready set (protocol.md status model)',
      'P1-03 is ready but a direct prerequisite is not complete',
    ]);
    expect(accepted).toEqual([
      { id: 'P1-01', acceptedOn: '2026-08-05', primarySpecs: ['features/customers-and-crm.md'] },
    ]);
  });
});

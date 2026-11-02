// Rule test: a hard-coded date in an SQL test that the clock will reach is clock-relative, in 2037, or reviewed here.
import { expect, test } from 'bun:test';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { repositoryRoot } from './product-sources';

// Tier 2 for SQL test dates (testing.md, "Never": read the wall clock). On
// 2026-11-01 every run went red because supabase/tests/unpark_into_schedule.sql
// planned a visit on a fixed 2026-11-01 and the database stopped treating it as
// upcoming (werk-flow/werkflow-app#148). A fixed date between the cutoff and
// 2037 becomes "today" during the product's life. Compute such a date from the
// clock (`(now() at time zone 'Europe/Berlin')::date + 30`), move it into 2037
// with the same month and day (2037 keeps 2026's weekdays), or list it below
// with the reason no code compares it with the clock. The check cannot see a
// past date inside a clock window ("not older than 30 days"); review owns that.
const CUTOFF = '2026-11-02';
const SAFE_YEAR = '2037';
const DATE = /\b20[2-3]\d-[01]\d-[0-3]\d\b/g;

type ReviewedDates = { readonly dates: readonly string[]; readonly reason: string };

// Near-future dates that are compared only with other fixed dates or with an
// injected "today", never with the clock.
const REVIEWED_NEAR_FUTURE_DATES: Readonly<Record<string, ReviewedDates>> = {
  'attention_read_writes.sql': {
    dates: ['2026-11-02', '2026-11-03'],
    reason: 'Stored vacation sources; the read-marker functions compare no date with the clock.',
  },
  'client_read_boundaries.sql': {
    dates: ['2026-11-02', '2026-12-24'],
    reason:
      'Rows inserted with triggers off; the read policies under test compare none of them with the clock.',
  },
  'employee_capability_history_writes.sql': {
    dates: ['2026-11-30', '2026-12-31', '2027-01-01'],
    reason: 'Validity and renewal dates are compared only with each other.',
  },
  'maintenance_list_pages.sql': {
    dates: ['2027-01-01', '2030-01-01', '2031-01-01'],
    reason: 'list_maintenance_workspace_page reads the injected p_due_through, never the clock.',
  },
  'people_boundaries.sql': {
    dates: ['2026-12-01', '2026-12-02'],
    reason: 'Stored fixture dates; the test checks which rows each role sees.',
  },
  'personnel_history_writes.sql': {
    dates: ['2026-12-31', '2027-01-01'],
    reason: 'Entry, exit and valid-from dates are compared only with each other.',
  },
  'qualification_history_writes.sql': {
    dates: ['2026-12-31'],
    reason: 'Team membership dates are compared only with each other.',
  },
  'service_boundaries.sql': {
    dates: ['2027-12-31'],
    reason: 'A stored coverage end; no maintenance function compares it with the clock.',
  },
  'service_list_pages.sql': {
    dates: ['2027-01-01'],
    reason: 'An updated_at that only orders the page.',
  },
  'sickness_report_writes.sql': {
    dates: ['2027-09-03'],
    reason: 'The 366-day range limit counts from the fixed start date.',
  },
  'time_correction_history_pages.sql': {
    dates: ['2027-01-01'],
    reason: 'A created_at that only orders the page.',
  },
  'vacation_history_writes.sql': {
    dates: [
      '2026-11-02',
      '2026-11-04',
      '2026-11-06',
      '2026-11-10',
      '2026-12-01',
      '2026-12-02',
      '2027-01-04',
      '2027-01-05',
      '2027-02-01',
      '2027-03-01',
    ],
    reason:
      'The vacation functions check status, ownership and overlap between fixed dates, never the clock.',
  },
  'work_atomic_writes.sql': {
    dates: ['2026-11-02'],
    reason: 'A stored planned_date; the planning projection it reaches is asserted only to exist.',
  },
};

const testsDirectory = resolve(repositoryRoot, 'supabase/tests');

function nearFutureDates(source: string): Set<string> {
  return new Set(
    Array.from(source.matchAll(DATE), (match) => match[0]).filter(
      (date) => date >= CUTOFF && date < `${SAFE_YEAR}-01-01`,
    ),
  );
}

function sqlTestDates(): ReadonlyMap<string, Set<string>> {
  return new Map(
    readdirSync(testsDirectory)
      .filter((name) => name.endsWith('.sql'))
      .map((name) => [name, nearFutureDates(readFileSync(resolve(testsDirectory, name), 'utf8'))]),
  );
}

test('the near-future window catches dates the clock will reach and spares 2037 and the past', () => {
  expect([...nearFutureDates("start_date => '2026-11-02', p_through_date => '2036-12-31'")]).toEqual([
    '2026-11-02',
    '2036-12-31',
  ]);
  expect([...nearFutureDates("'2037-11-01', '2026-06-30', '1900-01-01', 'PRJ-2026-1051'")]).toEqual([]);
});

test('SQL tests hard-code no unreviewed date the clock will reach', () => {
  const unreviewed = [...sqlTestDates()].flatMap(([file, dates]) => {
    const reviewed = new Set(REVIEWED_NEAR_FUTURE_DATES[file]?.dates ?? []);
    return [...dates].filter((date) => !reviewed.has(date)).map((date) => `supabase/tests/${file}: ${date}`);
  });
  expect(
    unreviewed,
    `Compute these dates from the clock, move them into ${SAFE_YEAR}, or review them in REVIEWED_NEAR_FUTURE_DATES.`,
  ).toEqual([]);
});

test('every reviewed near-future date still appears in its SQL test', () => {
  const dates = sqlTestDates();
  const stale = Object.entries(REVIEWED_NEAR_FUTURE_DATES).flatMap(([file, entry]) =>
    entry.dates
      .filter((date) => !dates.get(file)?.has(date))
      .map((date) => `supabase/tests/${file}: ${date}`),
  );
  expect(stale, 'Remove reviewed dates the SQL test no longer uses.').toEqual([]);
});

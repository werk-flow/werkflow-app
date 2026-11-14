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
// Digit lookarounds, not \b: a timestamp's date ends in a digit followed by `T`.
const DATE = /(?<!\d)20[2-3]\d-[01]\d-[0-3]\d(?!\d)/g;

type ReviewedDates = {
  /** Each date with the number of times the file names it: every use is reviewed. */
  readonly dates: Readonly<Record<string, number>>;
  readonly reason: string;
};

// Near-future dates that are compared only with other fixed dates or with an
// injected "today", never with the clock.
const REVIEWED_NEAR_FUTURE_DATES: Readonly<Record<string, ReviewedDates>> = {
  'attention_read_writes.sql': {
    dates: { '2026-11-02': 3, '2026-11-03': 3 },
    reason: 'Stored vacation sources; the read-marker functions compare no date with the clock.',
  },
  'client_read_boundaries.sql': {
    dates: { '2026-11-02': 6, '2026-12-24': 1 },
    reason:
      'Rows inserted with triggers off; the read policies under test compare none of them with the clock.',
  },
  'document_retention.sql': {
    dates: { '2035-12-31': 2, '2036-12-31': 2 },
    reason:
      'Expected retention ends computed from fixed past document dates; nothing compares them with the clock.',
  },
  'employee_capability_history_writes.sql': {
    dates: { '2026-11-30': 1, '2026-12-31': 3, '2027-01-01': 8 },
    reason: 'Validity and renewal dates are compared only with each other.',
  },
  'maintenance_list_pages.sql': {
    dates: { '2027-01-01': 2, '2030-01-01': 5, '2031-01-01': 4 },
    reason:
      'list_maintenance_workspace_page lists by the injected p_due_through; the clock decides only the overdue count, which the file never reads.',
  },
  'people_boundaries.sql': {
    dates: { '2026-12-01': 2, '2026-12-02': 2 },
    reason: 'Stored fixture dates; the test checks which rows each role sees.',
  },
  'personnel_history_writes.sql': {
    dates: { '2026-12-31': 3, '2027-01-01': 11 },
    reason: 'Entry, exit and valid-from dates are compared only with each other.',
  },
  'qualification_history_writes.sql': {
    dates: { '2026-12-31': 3 },
    reason: 'Team membership dates are compared only with each other.',
  },
  'service_boundaries.sql': {
    dates: { '2027-12-31': 1 },
    reason: 'A stored coverage end; no maintenance function compares it with the clock.',
  },
  'service_list_pages.sql': {
    dates: { '2027-01-01': 2 },
    reason: 'An updated_at that only orders the page.',
  },
  'sickness_report_writes.sql': {
    dates: { '2027-09-03': 1 },
    reason: 'The 366-day range limit counts from the fixed start date.',
  },
  'time_correction_history_pages.sql': {
    dates: { '2027-01-01': 2 },
    reason: 'A created_at that only orders the page.',
  },
  'vacation_history_writes.sql': {
    dates: {
      '2026-11-02': 4,
      '2026-11-04': 3,
      '2026-11-06': 1,
      '2026-11-10': 4,
      '2026-12-01': 2,
      '2026-12-02': 2,
      '2027-01-04': 4,
      '2027-01-05': 4,
      '2027-02-01': 8,
      '2027-03-01': 4,
    },
    reason:
      'The vacation functions check status, ownership and overlap between fixed dates, never the clock.',
  },
  'work_atomic_writes.sql': {
    dates: { '2026-11-02': 5 },
    reason: 'A stored planned_date; the planning projection it reaches is asserted only to exist.',
  },
};

const testsDirectory = resolve(repositoryRoot, 'supabase/tests');

/** How often the source names each date between the cutoff and the safe year. */
function nearFutureDates(source: string): Map<string, number> {
  const counts = new Map<string, number>();
  for (const [date] of source.matchAll(DATE)) {
    if (date >= CUTOFF && date < `${SAFE_YEAR}-01-01`) counts.set(date, (counts.get(date) ?? 0) + 1);
  }
  return counts;
}

function sqlTestDates(): ReadonlyMap<string, Map<string, number>> {
  return new Map(
    readdirSync(testsDirectory)
      .filter((name) => name.endsWith('.sql'))
      .map((name) => [name, nearFutureDates(readFileSync(resolve(testsDirectory, name), 'utf8'))]),
  );
}

test('the near-future window counts dates the clock will reach and spares 2037 and the past', () => {
  expect(
    Object.fromEntries(
      nearFutureDates(
        "start_date => '2026-11-02', end_date => '2026-11-02', start_at => '2036-12-31T08:00:00Z'",
      ),
    ),
  ).toEqual({ '2026-11-02': 2, '2036-12-31': 1 });
  expect(nearFutureDates("'2037-11-01', '2026-06-30', '1900-01-01', 'PRJ-2026-1051'").size).toBe(0);
});

test('SQL tests hard-code no unreviewed use of a date the clock will reach', () => {
  const unreviewed = [...sqlTestDates()].flatMap(([file, dates]) =>
    [...dates]
      .filter(([date, count]) => count > (REVIEWED_NEAR_FUTURE_DATES[file]?.dates[date] ?? 0))
      .map(([date, count]) => `supabase/tests/${file}: ${date} (${count} uses)`),
  );
  expect(
    unreviewed,
    `Compute these dates from the clock, move them into ${SAFE_YEAR}, or review each use in REVIEWED_NEAR_FUTURE_DATES.`,
  ).toEqual([]);
});

test('every reviewed use of a near-future date still appears in its SQL test', () => {
  const dates = sqlTestDates();
  const stale = Object.entries(REVIEWED_NEAR_FUTURE_DATES).flatMap(([file, entry]) =>
    Object.entries(entry.dates)
      .filter(([date, count]) => (dates.get(file)?.get(date) ?? 0) < count)
      .map(([date, count]) => `supabase/tests/${file}: ${date} (${count} reviewed)`),
  );
  expect(stale, 'Lower or remove reviewed uses the SQL test no longer has.').toEqual([]);
});

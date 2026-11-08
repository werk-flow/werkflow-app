import { expect, test } from 'bun:test';
import { addLocalDays } from '../date-time/berlin';
import { agentHosts, askedDay, failedBrowserDates, lookaheadDays, lookaheadLegs } from './date-lookahead';

const input = {
  sql: 'sql:planning,sql:security',
  shards: [
    { shard: 1, groups: 'audit:visual' },
    { shard: 2, groups: 'golden:p1-06,audit:wave-1:a4' },
  ],
  certificateExpiry: new Date('2027-06-30T23:59:59Z'),
};

function labelled(runDay: string, label: string) {
  return lookaheadDays(runDay).filter((day) => day.label === label);
}

function browserDates(runDay: string, failedDates: string[] = []) {
  return lookaheadDays(runDay, failedDates)
    .filter((day) => day.browser)
    .map((day) => `${day.date} ${day.label}`);
}

function isMonthEnd(date: string) {
  return addLocalDays(date, 1).slice(0, 7) !== date.slice(0, 7);
}

test('a run day looks at its next 14 days, then the next month end and year end', () => {
  const days = lookaheadDays('2026-11-06');

  expect(days.map((day) => `${day.date} ${day.label}`)).toEqual([
    ...Array.from({ length: 13 }, (_, index) => `${addLocalDays('2026-11-06', index + 1)} window`),
    '2026-11-20 day 14',
    '2026-11-30 month end',
    '2026-12-31 year end',
    '2026-12-31 year turn',
  ]);
});

test('a month end or a year end inside the window is replaced by the next one past it', () => {
  expect(labelled('2026-12-20', 'month end').map((day) => day.date)).toEqual(['2027-01-31']);
  expect(labelled('2026-12-20', 'year end').map((day) => day.date)).toEqual(['2027-12-31']);
  expect(labelled('2026-12-17', 'year end').map((day) => day.date)).toEqual(['2027-12-31']);
  expect(labelled('2026-12-16', 'year end').map((day) => day.date)).toEqual(['2026-12-31']);
});

test('a month end that is the year end is one date, and February ends on its leap day', () => {
  expect(labelled('2026-11-25', 'month end')).toEqual([]);
  expect(labelled('2026-11-25', 'year end').map((day) => day.date)).toEqual(['2026-12-31']);
  expect(labelled('2028-02-10', 'month end').map((day) => day.date)).toEqual(['2028-02-29']);
  expect(labelled('2027-02-10', 'month end').map((day) => day.date)).toEqual(['2027-02-28']);
});

test('the year turn is the new year in Berlin while UTC still shows the old year', () => {
  const [turn] = labelled('2026-11-06', 'year turn');

  expect(turn?.instant).toBe('2026-12-31T23:30:00Z');
  expect(
    new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Berlin' }).format(new Date(turn?.instant ?? '')),
  ).toBe('2027-01-01');
});

test('browser groups run on day 14, and on a Sunday also on the month end and the year end', () => {
  expect(browserDates('2026-11-06')).toEqual(['2026-11-20 day 14']);
  expect(browserDates('2026-11-08')).toEqual([
    '2026-11-22 day 14',
    '2026-11-30 month end',
    '2026-12-31 year end',
  ]);
});

test('a date whose browser leg failed keeps it until it arrives, so a green run cannot skip it', () => {
  // Failed as day 14 on 11-06; the next nights hold it in the window.
  expect(browserDates('2026-11-07', ['2026-11-20'])).toEqual(['2026-11-20 window', '2026-11-21 day 14']);
  expect(browserDates('2026-11-19', ['2026-11-20'])).toEqual(['2026-11-20 window', '2026-12-03 day 14']);
  // Arrived: the real clock's nightly owns it now.
  expect(browserDates('2026-11-20', ['2026-11-20'])).toEqual(['2026-12-04 day 14']);
  // A year end that failed keeps its browser leg on a weekday, and the year turn stays browser-free.
  expect(browserDates('2026-11-09', ['2026-12-31'])).toEqual(['2026-11-23 day 14', '2026-12-31 year end']);
});

test('the open alert names a date only for a failed browser leg', () => {
  const body = [
    'The run failed. Failed jobs:',
    '',
    '- 2026-11-30 month end / Browser 3: Run the groups on the shifted clock',
    '- 2026-12-31 year end / Browser 14: Run the groups on the shifted clock',
    '- 2026-11-12 window / Suite: Run the groups on the shifted clock',
    '- Plan: Plan the dates',
    '',
    'Run: https://github.test/owner/repo/actions/runs/7',
  ].join('\n');

  expect(failedBrowserDates(body)).toEqual(['2026-11-30', '2026-12-31']);
  expect(failedBrowserDates('')).toEqual([]);
});

test('every run day through 2037 keeps the plan whole', () => {
  for (let runDay = '2026-01-01'; runDay <= '2037-12-31'; runDay = addLocalDays(runDay, 1)) {
    const days = lookaheadDays(runDay);
    const dates = days.filter((day) => day.label !== 'year turn').map((day) => day.date);
    const lastWindowDay = addLocalDays(runDay, 14);

    expect(new Set(dates).size).toBe(dates.length);
    expect(dates.toSorted()).toEqual(dates);
    expect(dates.at(13)).toBe(lastWindowDay);
    expect(dates.slice(14).every((date) => date > lastWindowDay && isMonthEnd(date))).toBe(true);
    expect(dates.at(-1)?.slice(5)).toBe('12-31');
    // Every date reaches day 14 once, so a browser leg sees it two weeks before it arrives.
    expect(days.filter((day) => day.browser).map((day) => day.date)).toContain(lastWindowDay);
    // A date that failed stays planned: it can keep its browser leg until it arrives.
    expect(days.map((day) => day.date)).toEqual(
      expect.arrayContaining(
        lookaheadDays(addLocalDays(runDay, -1)).flatMap((day) => (day.date > runDay ? [day.date] : [])),
      ),
    );
  }
});

test('every leg starts away from the midnight window, except the year turn, which runs no browser', () => {
  for (const day of lookaheadDays('2026-11-06')) {
    if (day.label === 'year turn') expect(day.browser).toBe(false);
    else expect(day.instant).toBe(`${day.date}T11:00:00Z`);
  }
});

test('a day runs the suite, and a browser day also runs every shard, each named for its date', () => {
  const legs = lookaheadLegs(
    [
      { date: '2026-11-07', label: 'window', instant: '2026-11-07T11:00:00Z', browser: false },
      askedDay('2026-11-30'),
    ],
    input,
  );

  expect(legs).toEqual([
    {
      name: '2026-11-07 window / Suite',
      slug: '2026-11-07-window-suite',
      instant: '2026-11-07T11:00:00Z',
      groups: 'unit:all,ui:contracts,sql:planning,sql:security',
      browser: false,
    },
    {
      name: '2026-11-30 asked / Suite',
      slug: '2026-11-30-asked-suite',
      instant: '2026-11-30T11:00:00Z',
      groups: 'unit:all,ui:contracts,sql:planning,sql:security',
      browser: false,
    },
    {
      name: '2026-11-30 asked / Browser 1',
      slug: '2026-11-30-asked-browser-1',
      instant: '2026-11-30T11:00:00Z',
      groups: 'audit:visual',
      browser: true,
    },
    {
      name: '2026-11-30 asked / Browser 2',
      slug: '2026-11-30-asked-browser-2',
      instant: '2026-11-30T11:00:00Z',
      groups: 'golden:p1-06,audit:wave-1:a4',
      browser: true,
    },
  ]);
});

test("a browser leg runs only on a date that ends a day before the runner agent's certificate expires", () => {
  const certificateExpiry = new Date('2026-12-22T23:59:59Z');
  const legs = lookaheadLegs([askedDay('2026-12-21'), askedDay('2026-12-22'), askedDay('2026-12-31')], {
    ...input,
    certificateExpiry,
  });

  // Past the expiry GitHub shuts the runner down within 13 to 20 minutes; the suite ends first.
  expect(legs.map((leg) => leg.name)).toEqual([
    '2026-12-21 asked / Suite',
    '2026-12-21 asked / Browser 1',
    '2026-12-21 asked / Browser 2',
    '2026-12-22 asked / Suite',
    '2026-12-31 asked / Suite',
  ]);
});

test('a browser leg keeps a whole day between its midday start and the expiry', () => {
  const browserLegs = (certificateExpiry: string) =>
    lookaheadLegs([askedDay('2026-12-21')], {
      ...input,
      certificateExpiry: new Date(certificateExpiry),
    }).filter((leg) => leg.browser).length;

  expect(browserLegs('2026-12-22T11:00:00.000Z')).toBe(2);
  expect(browserLegs('2026-12-22T10:59:59.999Z')).toBe(0);
});

test("the runner agent's hosts are read from its journal, each once", () => {
  const journal = [
    '{"level":"INFO","msg":"hca platform and download urls","url":"https://github.com/actions/runner"}',
    'Post "https://hosted-compute-request-orchestrator-prod-iad-02.githubapp.com/v1/trace": EOF',
    'Post "https://hosted-compute-request-orchestrator-prod-iad-02.githubapp.com/v1/finish": EOF',
    'Starting runner process',
  ].join('\n');

  expect(agentHosts(journal)).toEqual([
    'github.com',
    'hosted-compute-request-orchestrator-prod-iad-02.githubapp.com',
  ]);
  expect(agentHosts('')).toEqual([]);
});

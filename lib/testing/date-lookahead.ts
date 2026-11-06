import { addLocalDays, getLocalWeekday } from '../date-time/berlin';

/** Every run day's window, so a date is seen at least this many days before it arrives. */
const WINDOW_DAYS = 14;

/** The run day that also takes browser groups to the month end and the year end. */
const SUNDAY = 6;

/**
 * A leg's clock start. 11:00 UTC is midday in Berlin all year, far from the runner's midnight start
 * window (lib/testing/runner/group-schedule.ts), so a browser group can start and finish on its date.
 */
const MIDDAY_UTC = 'T11:00:00Z';

/** 00:30 in Berlin on January 1 while UTC still shows December 31: the new year on one clock only. */
const YEAR_TURN_UTC = 'T23:30:00Z';

export type LookaheadDay = {
  date: string;
  label: string;
  /** The instant the leg's clock starts at. */
  instant: string;
  /** Browser groups run on it. They cost as much as a nightly per date, so only few dates carry them. */
  browser: boolean;
};

export type LookaheadShard = { shard: number; groups: string };

/** One job of the look-ahead: `groups` on a shifted clock, named for the issue a failure opens. */
export type LookaheadLeg = {
  name: string;
  /** A name an artifact accepts. */
  slug: string;
  instant: string;
  groups: string;
  browser: boolean;
};

function midday(date: string, label: string, browser: boolean): LookaheadDay {
  return { date, label, instant: `${date}${MIDDAY_UTC}`, browser };
}

function nextMonthEndAfter(day: string): string {
  let candidate = addLocalDays(day, 1);
  while (addLocalDays(candidate, 1).slice(0, 7) === candidate.slice(0, 7))
    candidate = addLocalDays(candidate, 1);
  return candidate;
}

function nextYearEndAfter(day: string): string {
  const year = Number(day.slice(0, 4));
  const yearEnd = `${year}-12-31`;
  return day < yearEnd ? yearEnd : `${year + 1}-12-31`;
}

/**
 * The dates whose browser legs the open alert names, from the job list of
 * .github/scripts/alert-issue.sh: `- <date> <label> / Browser <shard>: <steps>`.
 */
export function failedBrowserDates(alertBody: string): string[] {
  return [...alertBody.matchAll(/^- (\d{4}-\d{2}-\d{2}) .+ \/ Browser \d+:/gm)].flatMap(
    (match) => match[1] ?? [],
  );
}

/**
 * The dates one run day looks at: the next 14 days, then the first month end and year end past them,
 * so a run always sees weeks further than its window.
 *
 * Browser groups run on day 14, which every date reaches once, and on Sundays also on the two ends.
 * A date whose browser leg failed keeps it: the next run would otherwise pass without that date, and
 * the green run would close the alert with the failure still ahead. Such a date stays in the plan
 * until it arrives, because the window, the month end and the year end all hold it.
 */
export function lookaheadDays(runDay: string, failedDates: readonly string[] = []): LookaheadDay[] {
  const window = Array.from({ length: WINDOW_DAYS }, (_, index) => addLocalDays(runDay, index + 1));
  const lastDay = window.at(-1) ?? runDay;
  const monthEnd = nextMonthEndAfter(lastDay);
  const yearEnd = nextYearEndAfter(lastDay);
  const sunday = getLocalWeekday(runDay) === SUNDAY;
  const planned = (date: string, label: string, browser: boolean) =>
    midday(date, label, browser || failedDates.includes(date));
  return [
    ...window.map((date) => planned(date, date === lastDay ? 'day 14' : 'window', date === lastDay)),
    ...(monthEnd === yearEnd ? [] : [planned(monthEnd, 'month end', sunday)]),
    planned(yearEnd, 'year end', sunday),
    { date: yearEnd, label: 'year turn', instant: `${yearEnd}${YEAR_TURN_UTC}`, browser: false },
  ];
}

/** One date a person asks for, to reproduce a failure or to prove the look-ahead. */
export function askedDay(date: string): LookaheadDay {
  return midday(date, 'asked', true);
}

/** Every day's suite leg and, on a browser day, one leg per shard of the full run. */
export function lookaheadLegs(
  days: readonly LookaheadDay[],
  input: { sql: string; shards: readonly LookaheadShard[] },
): LookaheadLeg[] {
  return days.flatMap((day) => {
    const name = `${day.date} ${day.label}`;
    const slug = name.replaceAll(' ', '-');
    return [
      {
        name: `${name} / Suite`,
        slug: `${slug}-suite`,
        instant: day.instant,
        groups: `unit:all,ui:contracts,${input.sql}`,
        browser: false,
      },
      ...(day.browser ? input.shards : []).map(({ shard, groups }) => ({
        name: `${name} / Browser ${shard}`,
        slug: `${slug}-browser-${shard}`,
        instant: day.instant,
        groups,
        browser: true,
      })),
    ];
  });
}

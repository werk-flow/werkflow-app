import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';

import { HoursDisplay } from '@/components/mitarbeiter/hours-display';
import { MitarbeiterDetailTimeCards } from '@/components/mitarbeiter/mitarbeiter-detail-time-cards';
import type { MitarbeiterDetailLiveTime } from '@/components/mitarbeiter/use-mitarbeiter-detail-live-time';
import { EMPTY_HOLIDAY_CALENDAR, resolveDailyTargets, type DailyTarget } from '@/lib/personnel/targets';
import { getBusinessWeekDates } from '@/lib/personnel/schedule';
import { computeWeekLabel, getTodayIndex, getWeekBounds } from '@/lib/time-tracking/weekly';

// werk-flow/werkflow-planning#53: the detail page's status card measured the
// day against 8 h while the Wochenplan said 8,5 h, because no resolved target
// reached it before its client read of the week. The page now passes the
// server's week (a required prop), and neither surface invents 8 h.

const HALF_PAST_EIGHT = 510;
const weekTargets = resolveDailyTargets(getBusinessWeekDates(), {
  schedules: [
    {
      id: 'schedule-1',
      organizationId: 'org-1',
      employeeRecordId: 'record-1',
      validFrom: '2020-01-01',
      dayMinutes: Array(7).fill(HALF_PAST_EIGHT),
      note: null,
      createdBy: null,
      createdAt: '2020-01-01T00:00:00Z',
      updatedAt: '2020-01-01T00:00:00Z',
    },
  ],
  conditions: [],
  calendar: EMPTY_HOLIDAY_CALENDAR,
  employment: { entryDate: null, exitDate: null },
});
const todayTarget = weekTargets[getTodayIndex()];

/** The hook's result for a member who has not worked yet today, after the week's read settled. */
function liveTimeWith(
  target: DailyTarget | undefined,
  overrides: Partial<MitarbeiterDetailLiveTime>,
): MitarbeiterDetailLiveTime {
  return {
    status: undefined,
    statusError: null,
    statusStale: false,
    refetchStatus: async () => {},
    weekData: [],
    weekLoading: false,
    weekStale: false,
    weekError: null,
    targetsStale: false,
    refetchWeek: async () => {},
    weekTargets: target ? weekTargets : undefined,
    todayIndex: getTodayIndex(),
    weekLabel: computeWeekLabel(getWeekBounds().monday),
    liveTotalMinutes: 0,
    todayTarget: target,
    todayTargetMinutes: target?.targetMinutes ?? 0,
    todayTargetHint: null,
    memberBreakdown: { workMinutes: 0, breakMinutes: 0, overtimeMinutes: 0 },
    dailyPercentage: 0,
    ...overrides,
  };
}

function renderCard(
  target: DailyTarget | undefined,
  overrides: Partial<MitarbeiterDetailLiveTime> = {},
): string {
  return renderToStaticMarkup(
    <MitarbeiterDetailTimeCards
      liveTime={liveTimeWith(target, overrides)}
      breakMode="automatic"
      autoBreakThresholdMinutes={360}
      autoBreakDurationMinutes={30}
    />,
  );
}

describe('the personnel detail status card', () => {
  test('measures the day against the Wochenplan target, not 8 h', () => {
    const markup = renderCard(todayTarget);
    expect(markup).toContain('0 Min. / 8 Std. 30 Min. (0%)');
    expect(markup).not.toContain('Das Tagesziel konnte nicht geladen werden.');
  });

  test('while the week loads it shows the worked time only', () => {
    const markup = renderCard(undefined, { weekLoading: true });
    expect(markup).not.toContain('/ 8 Std.');
    expect(markup).not.toContain('Das Tagesziel konnte nicht geladen werden.');
  });

  test('a failed target read shows the worked time only and offers a retry', () => {
    const markup = renderCard(undefined);
    expect(markup).not.toContain('/ 8 Std.');
    expect(markup).toContain('Das Tagesziel konnte nicht geladen werden.');
    expect(markup).toContain('Erneut laden');
  });

  // CodeRabbit on werk-flow/werkflow-app#112: a failed target refresh kept the
  // last-known target and reported a successful week, so outdated progress
  // showed without a stale mark or retry.
  test('a failed target refresh keeps the last-known target, marked stale with a retry', () => {
    const markup = renderCard(todayTarget, { targetsStale: true });
    expect(markup).toContain('0 Min. / 8 Std. 30 Min. (0%)');
    expect(markup).toContain('Das Tagesziel konnte nicht aktualisiert werden');
    expect(markup).toContain('data-stale="true"');
    expect(markup.split('Erneut laden')).toHaveLength(2);
  });

  // Sol on werk-flow/werkflow-app#112: after a failed target refresh, a failed
  // week refresh marked both cards stale.
  test('a stale week owns the stale notice, also when the targets are stale', () => {
    const markup = renderCard(todayTarget, { targetsStale: true, weekStale: true });
    expect(markup).not.toContain('Das Tagesziel konnte nicht aktualisiert werden');
    const failed = renderCard(todayTarget, { targetsStale: true, weekError: 'load_failed' });
    expect(failed).not.toContain('Das Tagesziel konnte nicht aktualisiert werden');
  });

  // CodeRabbit on werk-flow/werkflow-app#112: a failed week read showed its
  // failure twice, in the week card and again as a target error.
  test('a failed week read shows one failure, in the week card', () => {
    const markup = renderCard(undefined, { weekError: 'load_failed' });
    expect(markup).toContain('Die Stunden dieser Woche konnten nicht geladen werden.');
    expect(markup).not.toContain('Das Tagesziel konnte nicht geladen werden.');
    expect(markup.split('Erneut laden')).toHaveLength(2);
  });
});

describe('the member list progress', () => {
  test('without a resolved target the row shows no progress against 8 h', () => {
    const markup = renderToStaticMarkup(
      <HoursDisplay isClockedIn={false} statusStartedAt={null} workMinutes={240} />,
    );
    expect(markup).toContain('Tagesfortschritt: Tagesziel nicht geladen');
    expect(markup).not.toContain('50%');
  });

  test('a resolved 8,5-hour day measures against 8,5 hours', () => {
    const markup = renderToStaticMarkup(
      <HoursDisplay isClockedIn={false} statusStartedAt={null} workMinutes={255} target={todayTarget} />,
    );
    expect(markup).toContain('Tagesfortschritt: 50%');
  });
});

describe('the member list marker for a person without Wochenplan', () => {
  const unconfigured = (dateIso: string, exitDate: string | null) =>
    resolveDailyTargets([dateIso], {
      schedules: [],
      conditions: [],
      calendar: EMPTY_HOLIDAY_CALENDAR,
      employment: { entryDate: null, exitDate },
    })[0];

  // The audit run at 00:43 on Saturday 31.10.2026 found no marker: the
  // weekend row took the no-target branch, which did not render it.
  test('stays on the weekend, when the default owes no target', () => {
    const markup = renderToStaticMarkup(
      <HoursDisplay
        isClockedIn={false}
        statusStartedAt={null}
        workMinutes={0}
        target={unconfigured('2026-10-31', null)}
      />,
    );
    expect(markup).toContain('Tagesfortschritt: Wochenende');
    expect(markup).toContain('aria-label="Kein Arbeitszeitmodell hinterlegt"');
  });

  test('is gone after the exit date', () => {
    const markup = renderToStaticMarkup(
      <HoursDisplay
        isClockedIn={false}
        statusStartedAt={null}
        workMinutes={0}
        target={unconfigured('2026-10-30', '2026-10-29')}
      />,
    );
    expect(markup).toContain('Tagesfortschritt: Ausgeschieden');
    expect(markup).not.toContain('Kein Arbeitszeitmodell hinterlegt');
  });
});

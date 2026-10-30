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
function liveTimeWith(target: DailyTarget | undefined, weekLoading = false): MitarbeiterDetailLiveTime {
  return {
    status: undefined,
    statusError: null,
    statusStale: false,
    refetchStatus: async () => {},
    weekData: [],
    weekLoading,
    weekStale: false,
    weekError: null,
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
  };
}

function renderCard(target: DailyTarget | undefined, weekLoading = false): string {
  return renderToStaticMarkup(
    <MitarbeiterDetailTimeCards
      liveTime={liveTimeWith(target, weekLoading)}
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
    const markup = renderCard(undefined, true);
    expect(markup).not.toContain('/ 8 Std.');
    expect(markup).not.toContain('Das Tagesziel konnte nicht geladen werden.');
  });

  test('a failed target read shows the worked time only and offers a retry', () => {
    const markup = renderCard(undefined);
    expect(markup).not.toContain('/ 8 Std.');
    expect(markup).toContain('Das Tagesziel konnte nicht geladen werden.');
    expect(markup).toContain('Erneut laden');
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

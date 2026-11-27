import { afterAll, describe, expect, setSystemTime, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';

import { ZeiterfassungDashboardHero } from '@/components/zeiterfassung/zeiterfassung-dashboard-hero';
import { ZeiterfassungDashboardStatusCard } from '@/components/zeiterfassung/zeiterfassung-dashboard-status-card';
import { getBusinessWeekDates } from '@/lib/personnel/schedule';
import { EMPTY_HOLIDAY_CALENDAR, resolveDailyTargets, type DailyTarget } from '@/lib/personnel/targets';
import { computeZeiterfassungLiveTotals } from '@/lib/time-tracking/live-totals';
import type { LiveClockState } from '@/lib/time-tracking/types';
import {
  buildWeeklyTimeData,
  computeWeekLabel,
  getTodayIndex,
  getWeekBounds,
} from '@/lib/time-tracking/weekly';

// werk-flow/werkflow-planning#589: when the targets read failed, the
// Zeiterfassung kept the last target in the hero and the week without a word.
// Both now say so and offer the week's read again, as the Mitarbeiter detail
// does; a failed week read keeps its own notice.

const TARGET_NOTICE = 'Das Tagesziel konnte nicht aktualisiert werden';
const WEEK_TARGETS_NOTICE = 'Die Sollzeiten der Woche konnten nicht aktualisiert werden';
const WEEK_NOTICE = 'Diese Angaben konnten nicht aktualisiert werden';

const breakPolicy = {
  breakMode: 'manual',
  autoBreakThresholdMinutes: 360,
  autoBreakDurationMinutes: 30,
  secondStep: null,
} as const satisfies LiveClockState['breakPolicy'];

const idle: LiveClockState = {
  organizationId: 'org-1',
  breakPolicy,
  status: 'clocked_out',
  isClockedIn: false,
  isOnBreak: false,
  clockInTime: null,
  statusStartedAt: null,
  breakStartTime: null,
  todayMinutes: 0,
  workMinutes: 0,
  breakMinutes: 0,
  timelineSegments: [],
  activeJobId: null,
  activeJobInfo: null,
  captureModel: 'canonical',
  sessionId: null,
  sessionVersion: null,
  currentSegmentId: null,
  currentActivity: null,
  resumeActivity: null,
  resumeJobInfo: null,
  recoveryReason: null,
  legacyOpen: false,
  standbyMinutes: 0,
  travelMinutes: 0,
  calloutMinutes: 0,
  internalMinutes: 0,
  fetchedAt: '2026-11-27T06:00:00.000Z',
};

// A Wednesday morning in Berlin: today is a working day of the week.
const NOW = new Date('2026-11-25T08:00:00Z');
setSystemTime(NOW);
afterAll(() => setSystemTime());

const weekTargets = resolveDailyTargets(getBusinessWeekDates(), {
  schedules: [],
  conditions: [],
  calendar: EMPTY_HOLIDAY_CALENDAR,
  employment: { entryDate: null, exitDate: null },
});
const todayIndex = getTodayIndex();
const todayTarget = weekTargets[todayIndex];
const { monday } = getWeekBounds();
const totals = computeZeiterfassungLiveTotals(idle, 0, todayTarget?.targetMinutes, NOW.getTime());
const retry = async () => {};

function renderHero(targetsStale: boolean, target: DailyTarget | undefined) {
  return renderToStaticMarkup(
    <ZeiterfassungDashboardHero
      effectiveState={idle}
      liveTime="0:00"
      liveTotalMinutes={0}
      todayTarget={target}
      todayTargetMinutes={target?.targetMinutes}
      todayTargetHint={null}
      targetsStale={targetsStale}
      onRetryTargets={retry}
      totals={totals}
    />,
  );
}

function renderWeek({ isStale, targetsStale }: { isStale: boolean; targetsStale: boolean }) {
  return renderToStaticMarkup(
    <ZeiterfassungDashboardStatusCard
      effectiveState={idle}
      weekData={buildWeeklyTimeData([], monday, { ...breakPolicy, breakPolicyHistory: [] }, weekTargets)}
      weekTargets={weekTargets}
      targetsStale={targetsStale}
      todayIndex={todayIndex}
      weekLabel={computeWeekLabel(monday)}
      isStale={isStale}
      refetch={retry}
      liveTotalMinutes={0}
      liveBreakdown={totals.breakdown}
    />,
  );
}

describe("the Zeiterfassung's target after a failed targets read", () => {
  test('the hero marks the last known target stale and offers the read again', () => {
    const stale = renderHero(true, todayTarget);
    expect(stale).toContain(TARGET_NOTICE);
    expect(stale).toContain('Erneut laden');
    expect(stale).toContain('data-stale="true"');
    expect(renderHero(false, todayTarget)).not.toContain(TARGET_NOTICE);
  });

  test('the hero says nothing about a target it never had', () => {
    expect(renderHero(true, undefined)).not.toContain(TARGET_NOTICE);
  });

  test("the week card marks the week's targets stale, and a failed week read keeps its own notice", () => {
    const targetsOnly = renderWeek({ isStale: false, targetsStale: true });
    expect(targetsOnly).toContain(WEEK_TARGETS_NOTICE);
    expect(targetsOnly).toContain('Erneut laden');
    const weekFailed = renderWeek({ isStale: true, targetsStale: true });
    expect(weekFailed).toContain(WEEK_NOTICE);
    expect(weekFailed).not.toContain(WEEK_TARGETS_NOTICE);
    const current = renderWeek({ isStale: false, targetsStale: false });
    expect(current).not.toContain(WEEK_TARGETS_NOTICE);
    expect(current).not.toContain(WEEK_NOTICE);
  });
});

'use client';

import { ErrorText } from '@/components/ui/error-text';
import { ClockActionList } from '@/components/clock-action-list';
import { getTargetSourceHint } from '@/lib/personnel/targets';
import { useWeeklyTimeData } from '@/hooks/use-weekly-time-data';
import { useClockState } from '@/components/clock-state-context';
import { VacationSection } from './vacation-section';
import { SicknessSection } from './sickness-section';
import type { ZeiterfassungOverview } from '@/lib/time-tracking/types';
import { useZeiterfassungLiveTime } from './use-zeiterfassung-dashboard-live-time';
import { ZeiterfassungDashboardHero } from './zeiterfassung-dashboard-hero';
import { computeZeiterfassungLiveTotals } from '@/lib/time-tracking/live-totals';
import { ZeiterfassungDashboardStatusCard } from './zeiterfassung-dashboard-status-card';

interface ZeiterfassungDashboardProps {
  organizationId: string;
  userId: string;
  initialOverview: ZeiterfassungOverview;
}

export function ZeiterfassungDashboard({
  organizationId,
  userId,
  initialOverview,
}: ZeiterfassungDashboardProps) {
  const { state, statusError } = useClockState();
  const effectiveState =
    state && state.organizationId === organizationId ? state : initialOverview.clockState;

  const week = useWeeklyTimeData({
    organizationId,
    userId,
    // The server's rule with its versions: past days resolve against them, and
    // today's bar takes the live rule of the clock state.
    breakPolicy: initialOverview.breakPolicy,
    initialWeekData: initialOverview.weekData,
    initialTodayIndex: initialOverview.todayIndex,
    initialWeekLabel: initialOverview.weekLabel,
    initialWeekTargets: initialOverview.weekTargets,
  });

  const { liveTime, liveTotalMinutes, nowMs } = useZeiterfassungLiveTime(effectiveState);

  // Today's resolved target (P1-04): schedule → derived → labeled default.
  const todayTarget = week.weekTargets?.[week.todayIndex];
  const todayTargetMinutes = todayTarget?.targetMinutes;
  const todayTargetHint = todayTarget ? getTargetSourceHint(todayTarget) : null;

  const totals = computeZeiterfassungLiveTotals(effectiveState, liveTotalMinutes, todayTargetMinutes, nowMs);

  return (
    <div className="space-y-6 pb-32">
      {/* Hero Section */}
      <ZeiterfassungDashboardHero
        effectiveState={effectiveState}
        liveTime={liveTime}
        liveTotalMinutes={liveTotalMinutes}
        todayTarget={todayTarget}
        todayTargetMinutes={todayTargetMinutes}
        todayTargetHint={todayTargetHint}
        targetsStale={week.targetsStale}
        onRetryTargets={week.refetch}
        totals={totals}
      />

      {/* Next clock actions: the same list the clock button's sheet renders. */}
      <div className="space-y-3">
        <h2 className="text-sm font-medium text-muted-foreground px-1">Schnellzugriff</h2>
        <ClockActionList organizationId={organizationId} />
      </div>

      {/* Vacation balance, requests, and entry point (P1-06) */}
      <VacationSection />

      {/* Sickness self-report and own reports (P1-08) */}
      <SicknessSection />

      {/* Working Time Status + Weekly Chart */}
      <div className="space-y-3">
        <h2 className="text-sm font-medium text-muted-foreground px-1">Status</h2>

        <ZeiterfassungDashboardStatusCard
          effectiveState={effectiveState}
          weekData={week.weekData}
          weekTargets={week.weekTargets}
          targetsStale={week.targetsStale}
          todayIndex={week.todayIndex}
          weekLabel={week.weekLabel}
          isStale={week.isStale}
          refetch={week.refetch}
          liveTotalMinutes={liveTotalMinutes}
          liveBreakdown={totals.breakdown}
        />
      </div>

      <ErrorText className="text-center text-xs">{statusError}</ErrorText>
    </div>
  );
}

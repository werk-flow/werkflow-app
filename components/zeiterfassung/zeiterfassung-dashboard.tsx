'use client';

import { StaleRegion } from '@/components/shared/stale-region';
import { ErrorText } from '@/components/ui/error-text';
import { ClockActionList } from '@/components/clock-action-list';
import { getTargetSourceHint } from '@/lib/personnel/targets';
import dynamic from 'next/dynamic';
import { useWeeklyTimeData } from '@/hooks/use-weekly-time-data';
import { useClockState } from '@/components/clock-state-provider';
import { VacationSection } from './vacation-section';
import { SicknessSection } from './sickness-section';
import type { ZeiterfassungOverview } from '@/lib/time-tracking/types';
import { useZeiterfassungLiveTime } from './use-zeiterfassung-dashboard-live-time';
import { ZeiterfassungDashboardHero } from './zeiterfassung-dashboard-hero';
import { computeZeiterfassungLiveTotals } from './zeiterfassung-dashboard-live-totals';
import { ZeiterfassungDashboardStatusCard } from './zeiterfassung-dashboard-status-card';

// Loaded on its own: in the page's first bundle it regroups the chunks that
// other routes share, and their payloads grow (lab counts).
const LiveRouteRefresh = dynamic(
  () => import('@/components/shared/live-route-refresh').then((mod) => mod.LiveRouteRefresh),
  { ssr: false },
);

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

  const {
    weekData,
    weekTargets,
    todayIndex,
    weekLabel,
    isStale: weekStale,
    refetch: refetchWeek,
  } = useWeeklyTimeData({
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
  const todayTarget = weekTargets?.[todayIndex];
  const todayTargetMinutes = todayTarget?.targetMinutes;
  const todayTargetHint = todayTarget ? getTargetSourceHint(todayTarget) : null;

  const totals = computeZeiterfassungLiveTotals(effectiveState, liveTotalMinutes, todayTargetMinutes, nowMs);

  return (
    <div className="space-y-6 pb-32">
      {/* A saved break rule renders the page again, so the week resolves its
          past days against the new versions without a remount (catch-up included). */}
      <LiveRouteRefresh tables={['organization_settings']} />
      {/* Hero Section */}
      <ZeiterfassungDashboardHero
        effectiveState={effectiveState}
        liveTime={liveTime}
        liveTotalMinutes={liveTotalMinutes}
        todayTarget={todayTarget}
        todayTargetMinutes={todayTargetMinutes}
        todayTargetHint={todayTargetHint}
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

        <StaleRegion stale={weekStale} onRetry={refetchWeek}>
          <ZeiterfassungDashboardStatusCard
            effectiveState={effectiveState}
            weekData={weekData}
            weekTargets={weekTargets}
            todayIndex={todayIndex}
            weekLabel={weekLabel}
            liveTotalMinutes={liveTotalMinutes}
            liveBreakMinutes={totals.liveBreakMinutes}
          />
        </StaleRegion>
      </div>

      <ErrorText className="text-center text-xs">{statusError}</ErrorText>
    </div>
  );
}

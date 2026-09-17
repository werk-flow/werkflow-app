'use client';

import { useState, useEffect } from 'react';
import { Car, Clock } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { ErrorText } from '@/components/ui/error-text';
import { cn } from '@/lib/utils';
import { TimeProgressRing } from './time-progress-ring';
import { ClockActionList } from '@/components/clock-action-list';
import {
  formatDuration,
  getNonNegativeElapsedMs,
} from '@/lib/time-tracking/helpers';
import { computeBreakdownForSettings } from '@/lib/time-tracking/settings';
import { DEFAULT_DAILY_TARGET_MINUTES, getTargetSourceHint } from '@/lib/personnel/targets';
import { useWeeklyTimeData } from '@/hooks/use-weekly-time-data';
import { WeeklyHoursChart } from './weekly-hours-chart';
import { useClockState } from '@/components/clock-state-provider';
import { VacationSection } from './vacation-section';
import { SicknessSection } from './sickness-section';
import type {
  ClockTimelineSegment,
  ZeiterfassungOverview
} from '@/lib/time-tracking/types';
import { ZeiterfassungDashboardSkeleton } from '@/components/loading-states/zeiterfassung-dashboard-skeleton';

interface ZeiterfassungDashboardProps {
  organizationId: string;
  userId: string;
  initialOverview: ZeiterfassungOverview;
}

function formatLiveTime(
  baseMinutes: number,
  statusStartedAt: string | null,
  isClockedIn: boolean
): string {
  let totalMs = baseMinutes * 60 * 1000;

  if (isClockedIn && statusStartedAt) {
    totalMs += getNonNegativeElapsedMs(statusStartedAt);
  }

  const hours = Math.floor(totalMs / (1000 * 60 * 60));
  const minutes = Math.floor((totalMs % (1000 * 60 * 60)) / (1000 * 60));
  const seconds = Math.floor((totalMs % (1000 * 60)) / 1000);

  return `${hours.toString().padStart(2, '0')}:${minutes
    .toString()
    .padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
}

function calculateLiveTotalMinutes(
  baseMinutes: number,
  statusStartedAt: string | null,
  isClockedIn: boolean
): number {
  let totalMinutes = baseMinutes;

  if (isClockedIn && statusStartedAt) {
    totalMinutes += getNonNegativeElapsedMs(statusStartedAt) / (1000 * 60);
  }

  return totalMinutes;
}

export function ZeiterfassungDashboard({
  organizationId,
  userId,
  initialOverview
}: ZeiterfassungDashboardProps) {
  const {
    state,
    isLoading,
    statusError,
  } = useClockState();
  const effectiveState =
    state && state.organizationId === organizationId
      ? state
      : initialOverview.clockState;

  const {
    weekData,
    weekTargets,
    todayIndex,
    weekLabel,
  } = useWeeklyTimeData({
    organizationId,
    userId,
    breakMode: effectiveState.breakMode,
    autoBreakThresholdMinutes: effectiveState.autoBreakThresholdMinutes,
    autoBreakDurationMinutes: effectiveState.autoBreakDurationMinutes,
    initialWeekData: initialOverview.weekData,
    initialTodayIndex: initialOverview.todayIndex,
    initialWeekLabel: initialOverview.weekLabel,
    initialWeekTargets: initialOverview.weekTargets,
  });

  const [liveTime, setLiveTime] = useState('00:00:00');
  const [liveTotalMinutes, setLiveTotalMinutes] = useState(0);

  const liveTimelineSegments: ClockTimelineSegment[] = (() => {
    const segments = [...(effectiveState.timelineSegments ?? [])];
    if (!effectiveState.isClockedIn || !effectiveState.statusStartedAt) {
      return segments;
    }

    const liveMinutes =
      getNonNegativeElapsedMs(effectiveState.statusStartedAt) / (1000 * 60);
    if (liveMinutes <= 0) {
      return segments;
    }

    segments.push({
      type: effectiveState.status === 'on_break' ? 'break' : 'work',
      minutes: liveMinutes
    });
    return segments;
  })();

  useEffect(() => {
    const updateLiveValues = () => {
      setLiveTime(
        formatLiveTime(
          effectiveState.todayMinutes,
          effectiveState.statusStartedAt,
          effectiveState.isClockedIn
        )
      );
      setLiveTotalMinutes(
        calculateLiveTotalMinutes(
          effectiveState.todayMinutes,
          effectiveState.statusStartedAt,
          effectiveState.isClockedIn
        )
      );
    };

    updateLiveValues();

    // eslint-disable-next-line no-restricted-syntax -- wall-clock render tick, no data polling
    const interval = setInterval(updateLiveValues, 1000);
    return () => clearInterval(interval);
  }, [
    effectiveState.todayMinutes,
    effectiveState.statusStartedAt,
    effectiveState.isClockedIn,
  ]);

  const trackedLiveBreakMinutes =
    effectiveState.breakMode === 'manual'
      ? effectiveState.breakMinutes +
        (effectiveState.status === 'on_break' && effectiveState.statusStartedAt
          ? getNonNegativeElapsedMs(effectiveState.statusStartedAt) / (1000 * 60)
          : 0)
      : effectiveState.breakMinutes;
  // Today's resolved target (P1-04): schedule → derived → labeled default.
  const todayTarget = weekTargets?.[todayIndex];
  const todayTargetMinutes = todayTarget?.targetMinutes;
  const todayTargetHint = todayTarget ? getTargetSourceHint(todayTarget) : null;

  const breakdown = computeBreakdownForSettings(
    liveTotalMinutes,
    trackedLiveBreakMinutes,
    effectiveState,
    todayTargetMinutes
  );
  const liveWorkMinutes = breakdown.workMinutes;
  const liveBreakMinutes = breakdown.breakMinutes;
  const workPercentage =
    todayTargetMinutes !== undefined && todayTargetMinutes > 0
      ? Math.min(Math.round((liveWorkMinutes / todayTargetMinutes) * 100), 100)
      : null;
  const ringTimelineSegments =
    effectiveState.breakMode === 'manual' ? liveTimelineSegments : undefined;
  const currentActivityMinutes =
    effectiveState.isClockedIn && effectiveState.statusStartedAt
      ? getNonNegativeElapsedMs(effectiveState.statusStartedAt) / (1000 * 60)
      : 0;
  const liveTravelMinutes = effectiveState.travelMinutes +
    (effectiveState.currentActivity?.kind === 'travel' ? currentActivityMinutes : 0);
  const liveStandbyMinutes = effectiveState.standbyMinutes +
    (effectiveState.currentActivity?.kind === 'standby' ? currentActivityMinutes : 0);
  const liveCalloutMinutes = effectiveState.calloutMinutes +
    (effectiveState.currentActivity?.kind === 'callout' ? currentActivityMinutes : 0);
  const liveInternalMinutes = effectiveState.internalMinutes +
    (effectiveState.currentActivity?.kind === 'internal_activity' ? currentActivityMinutes : 0);

  if (isLoading && !effectiveState) {
    return <ZeiterfassungDashboardSkeleton />;
  }

  if (!effectiveState) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-destructive/10">
          <Clock className="h-6 w-6 text-destructive" />
        </div>
        <p className="text-sm text-muted-foreground">
          Fehler beim Laden der Daten
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6 pb-32">
      {/* Hero Section */}
      <div className="flex flex-col items-center py-8">
        <TimeProgressRing
          totalMinutes={liveTotalMinutes}
          breakMinutes={liveBreakMinutes}
          timelineSegments={ringTimelineSegments}
          targetMinutes={todayTargetMinutes}
          size={260}
          strokeWidth={14}
          isActive={effectiveState.isClockedIn}
          glowVariant={effectiveState.isOnBreak ? 'break' : 'work'}
        >
          <span className="text-4xl font-bold tabular-nums tracking-tight">
            {liveTime}
          </span>
          <span className="mt-1 text-sm text-muted-foreground">Gesamtzeit</span>
        </TimeProgressRing>

        <p
          className={cn(
            'mt-6 text-lg font-medium',
            effectiveState.status === 'working'
              ? 'text-success-text'
              : effectiveState.status === 'on_break'
                ? 'text-warning-text'
                : 'text-muted-foreground'
          )}
        >
          {effectiveState.status === 'working'
            ? 'Du arbeitest gerade.'
            : effectiveState.status === 'on_break'
              ? 'Du machst gerade Pause.'
              : 'Du bist nicht eingestempelt.'}
        </p>

        {effectiveState.breakMode === 'automatic' ? (
          <p className="mt-1 text-sm text-muted-foreground">
            Pausen werden in dieser Organisation automatisch abgezogen.
          </p>
        ) : null}

        {todayTarget?.isHoliday ? (
          <p className="mt-1 text-sm text-muted-foreground">
            Feiertag: {todayTarget.holidayName} – heute keine Sollarbeitszeit.
          </p>
        ) : todayTarget?.isClosureDay ? (
          <p className="mt-1 text-sm text-muted-foreground">
            Betriebsruhe
            {todayTarget.closureLabel ? ` (${todayTarget.closureLabel})` : ''} –
            heute keine Sollarbeitszeit.
          </p>
        ) : todayTarget?.absence?.portion === 'full' ? (
          <p className="mt-1 text-sm text-muted-foreground">
            {todayTarget.absence.type === 'sickness'
              ? 'Krankmeldung – heute keine Sollarbeitszeit.'
              : 'Urlaub genehmigt – heute keine Sollarbeitszeit.'}
          </p>
        ) : todayTarget?.absence?.portion === 'half_day' ? (
          <p className="mt-1 text-sm text-muted-foreground">
            {todayTarget.absence.type === 'sickness'
              ? 'Halber Tag Krankmeldung – Tagesziel: '
              : 'Halber Urlaubstag – Tagesziel: '}
            {formatDuration(todayTargetMinutes ?? 0)} Arbeitszeit
          </p>
        ) : todayTarget && todayTarget.targetMinutes === 0 ? (
          <p className="mt-1 text-sm text-muted-foreground">
            Laut Arbeitszeitmodell heute kein Arbeitstag.
          </p>
        ) : (
          <p className="mt-1 text-sm text-muted-foreground">
            Tagesziel: {formatDuration(todayTargetMinutes ?? DEFAULT_DAILY_TARGET_MINUTES)} Arbeitszeit
            {workPercentage !== null ? ` (${workPercentage}% erreicht)` : ''}
          </p>
        )}
        {todayTargetHint && (
          <p className="mt-1 max-w-sm text-center text-xs text-muted-foreground/80">
            {todayTargetHint}
          </p>
        )}

        {/* Time breakdown indicators */}
        <div className="mt-4 flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-xs">
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-2 w-2 rounded-full bg-success" />
            <span className="text-muted-foreground">Arbeitszeit</span>
            <span className="font-medium tabular-nums">
              {formatDuration(breakdown.workMinutes)}
            </span>
          </span>
          {liveTravelMinutes > 0 && (
            <span className="flex items-center gap-1.5">
              <Car className="size-3.5 text-muted-foreground" />
              <span className="text-muted-foreground">Fahrt</span>
              <span className="font-medium tabular-nums">{formatDuration(liveTravelMinutes)}</span>
            </span>
          )}
          {liveStandbyMinutes > 0 && (
            <span className="flex items-center gap-1.5">
              <span className="text-muted-foreground">Bereitschaft</span>
              <span className="font-medium tabular-nums">{formatDuration(liveStandbyMinutes)}</span>
            </span>
          )}
          {liveCalloutMinutes > 0 && (
            <span className="flex items-center gap-1.5">
              <span className="text-muted-foreground">Notdienst</span>
              <span className="font-medium tabular-nums">{formatDuration(liveCalloutMinutes)}</span>
            </span>
          )}
          {liveInternalMinutes > 0 && (
            <span className="flex items-center gap-1.5">
              <span className="text-muted-foreground">Intern</span>
              <span className="font-medium tabular-nums">{formatDuration(liveInternalMinutes)}</span>
            </span>
          )}
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-2 w-2 rounded-full bg-warning" />
            <span className="text-muted-foreground">Pause</span>
            <span className="font-medium tabular-nums">
              {breakdown.breakMinutes > 0
                ? formatDuration(breakdown.breakMinutes)
                : '0 Min.'}
            </span>
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-2 w-2 rounded-full bg-info" />
            <span className="text-muted-foreground">Überstunden heute</span>
            <span className="font-medium tabular-nums">
              {breakdown.overtimeMinutes > 0
                ? formatDuration(breakdown.overtimeMinutes)
                : '0 Min.'}
            </span>
          </span>
        </div>
      </div>

      {/* Next clock actions: the same list the clock button's sheet renders. */}
      <div className="space-y-3">
        <h3 className="text-sm font-medium text-muted-foreground px-1">
          Schnellzugriff
        </h3>
        <ClockActionList organizationId={organizationId} />
      </div>

      {/* Vacation balance, requests, and entry point (P1-06) */}
      <VacationSection />

      {/* Sickness self-report and own reports (P1-08) */}
      <SicknessSection />

      {/* Working Time Status + Weekly Chart */}
      <div className="space-y-3">
        <h3 className="text-sm font-medium text-muted-foreground px-1">
          Status
        </h3>

        <Card>
          <CardContent className="p-4 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div
                  className={cn(
                    'flex h-10 w-10 items-center justify-center rounded-full',
                    effectiveState.status === 'working'
                      ? 'bg-success-soft'
                      : effectiveState.status === 'on_break'
                        ? 'bg-warning-soft'
                        : 'bg-muted'
                  )}
                >
                  <Clock
                    className={cn(
                      'h-5 w-5',
                      effectiveState.status === 'working'
                        ? 'text-success-soft-foreground'
                        : effectiveState.status === 'on_break'
                          ? 'text-warning-soft-foreground'
                          : 'text-muted-foreground'
                    )}
                  />
                </div>
                <div>
                  <p className="font-medium">Arbeitszeit</p>
                  <p className="text-xs text-muted-foreground">
                    {effectiveState.isClockedIn
                      ? `Seit ${new Date(
                          effectiveState.clockInTime!
                        ).toLocaleTimeString('de-DE', {
                          hour: '2-digit',
                          minute: '2-digit'
                        })} Uhr`
                      : 'Nicht aktiv'}
                  </p>
                </div>
              </div>
              <span
                className={cn(
                  'rounded-full px-3 py-1 text-xs font-medium',
                  effectiveState.status === 'working'
                    ? 'bg-success-soft text-success-soft-foreground'
                    : effectiveState.status === 'on_break'
                      ? 'bg-warning-soft text-warning-soft-foreground'
                      : 'bg-muted text-muted-foreground'
                )}
              >
                {effectiveState.status === 'working'
                  ? 'arbeitet'
                  : effectiveState.status === 'on_break'
                    ? 'Pause'
                    : 'inaktiv'}
              </span>
            </div>

            {weekData.length > 0 && (
              <>
                <div className="border-t border-border" />
                <WeeklyHoursChart
                  weekData={weekData}
                  todayIndex={todayIndex}
                  liveTodayMinutes={liveTotalMinutes}
                  liveTodayBreakMinutes={liveBreakMinutes}
                  liveTodayBreakMode={effectiveState.breakMode}
                  liveAutoBreakThresholdMinutes={effectiveState.autoBreakThresholdMinutes}
                  liveAutoBreakDurationMinutes={effectiveState.autoBreakDurationMinutes}
                  narrowBars
                  weekLabel={weekLabel}
                  weekTargets={weekTargets}
                />
              </>
            )}
          </CardContent>
        </Card>
      </div>

      <ErrorText className="text-center text-xs">{statusError}</ErrorText>
    </div>
  );
}


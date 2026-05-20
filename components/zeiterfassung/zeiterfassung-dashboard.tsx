'use client';

import { useState, useEffect } from 'react';
import {
  Briefcase,
  Coffee,
  Car,
  Clock,
  Palmtree,
  ChevronRight,
} from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import { TimeProgressRing } from './time-progress-ring';
import { JobPickerModal } from '@/components/job-picker-modal';
import {
  formatDuration,
  getNonNegativeElapsedMs,
  WORK_GOAL_MINUTES,
} from '@/lib/time-tracking/helpers';
import { computeBreakdownForSettings } from '@/lib/time-tracking/settings';
import { useWeeklyTimeData } from '@/hooks/use-weekly-time-data';
import { WeeklyHoursChart } from './weekly-hours-chart';
import { useClockState } from '@/components/clock-state-provider';
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
    isPending,
    statusError,
    startBreak,
    endBreak,
    switchJob,
  } = useClockState();
  const effectiveState =
    state && state.organizationId === organizationId
      ? state
      : initialOverview.clockState;

  const {
    weekData,
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
  });

  const [liveTime, setLiveTime] = useState('00:00:00');
  const [liveTotalMinutes, setLiveTotalMinutes] = useState(0);
  const [showJobPicker, setShowJobPicker] = useState(false);
  const [pickerMode, setPickerMode] = useState<'switch' | 'resume'>('switch');

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

  const handlePickerConfirm = async (jobId: string | null) => {
    if (!effectiveState.isClockedIn) {
      setShowJobPicker(false);
      return;
    }

    try {
      if (pickerMode === 'resume') {
        await endBreak(jobId);
      } else {
        await switchJob(jobId);
      }
    } catch (err) {
      console.error('Error updating active job state:', err);
    } finally {
      setShowJobPicker(false);
    }
  };

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
  const breakdown = computeBreakdownForSettings(
    liveTotalMinutes,
    trackedLiveBreakMinutes,
    effectiveState
  );
  const liveWorkMinutes = breakdown.workMinutes;
  const liveBreakMinutes = breakdown.breakMinutes;
  const workPercentage = Math.min(
    Math.round((liveWorkMinutes / WORK_GOAL_MINUTES) * 100),
    100
  );
  const ringTimelineSegments =
    effectiveState.breakMode === 'manual' ? liveTimelineSegments : undefined;

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
              ? 'text-green-600 dark:text-green-400'
              : effectiveState.status === 'on_break'
                ? 'text-yellow-600 dark:text-yellow-300'
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

        <p className="mt-1 text-sm text-muted-foreground">
          Tagesziel: 8 Stunden Arbeitszeit ({workPercentage}% erreicht)
        </p>

        {/* Time breakdown indicators */}
        <div className="mt-4 flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-xs">
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-2 w-2 rounded-full bg-green-500" />
            <span className="text-muted-foreground">Arbeitszeit</span>
            <span className="font-medium tabular-nums">
              {formatDuration(breakdown.workMinutes)}
            </span>
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-2 w-2 rounded-full bg-yellow-500" />
            <span className="text-muted-foreground">Pause</span>
            <span className="font-medium tabular-nums">
              {breakdown.breakMinutes > 0
                ? formatDuration(breakdown.breakMinutes)
                : '0 Min.'}
            </span>
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-2 w-2 rounded-full bg-blue-500" />
            <span className="text-muted-foreground">Überstunden heute</span>
            <span className="font-medium tabular-nums">
              {breakdown.overtimeMinutes > 0
                ? formatDuration(breakdown.overtimeMinutes)
                : '0 Min.'}
            </span>
          </span>
        </div>
      </div>

      {/* Quick Actions */}
      <div className="space-y-3">
        <h3 className="text-sm font-medium text-muted-foreground px-1">
          Schnellzugriff
        </h3>

        <MenuCard
          icon={Briefcase}
          title="Auftrag auswählen"
          subtitle={
            effectiveState.activeJobInfo?.title
              ? effectiveState.activeJobInfo.title
              : effectiveState.status === 'on_break'
                ? 'Während der Pause nicht aktiv'
                : effectiveState.isClockedIn
                ? 'Kein Auftrag gewählt'
                : 'Auftrag für nächste Schicht'
          }
          onClick={() => {
            setPickerMode('switch');
            setShowJobPicker(true);
          }}
          active={
            !!effectiveState.activeJobId &&
            effectiveState.isClockedIn &&
            !effectiveState.isOnBreak
          }
          disabled={!effectiveState.isClockedIn || effectiveState.isOnBreak}
          disabledHint={
            !effectiveState.isClockedIn ? 'Stemple zuerst ein' : 'Während der Pause gesperrt'
          }
        />

        {effectiveState.breakMode === 'manual' ? (
          <MenuCard
            icon={Coffee}
            title={effectiveState.isOnBreak ? 'Arbeit fortsetzen' : 'Pause'}
            subtitle={
              effectiveState.isOnBreak
                ? 'Auftrag für die Fortsetzung wählen'
                : 'Pause jetzt starten'
            }
            active={effectiveState.isOnBreak}
            disabled={!effectiveState.isClockedIn}
            disabledHint="Stemple zuerst ein"
            onClick={() => {
              if (!effectiveState.isClockedIn) return;
              if (effectiveState.isOnBreak) {
                setPickerMode('resume');
                setShowJobPicker(true);
              } else {
                void startBreak();
              }
            }}
          />
        ) : null}

        <MenuCard
          icon={Car}
          title="Fahrzeit"
          subtitle="Fahrzeiten dokumentieren"
          disabled
        />
      </div>

      {/* Vacation Widget */}
      <div className="space-y-3">
        <h3 className="text-sm font-medium text-muted-foreground px-1">
          Urlaub & Abwesenheit
        </h3>

        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-4">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-brand-purple/10">
                <Palmtree className="h-6 w-6 text-brand-purple" />
              </div>
              <div className="flex-1">
                <div className="flex items-baseline justify-between">
                  <span className="text-sm font-medium">Urlaubstage</span>
                  <span className="text-xs text-muted-foreground">
                    9 von 30 genutzt
                  </span>
                </div>
                <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-brand-purple transition-all"
                    style={{ width: '30%' }}
                  />
                </div>
                <div className="mt-2 flex items-center justify-between text-xs text-muted-foreground">
                  <span>
                    <span className="inline-block h-2 w-2 rounded-full bg-brand-purple mr-1" />
                    9 Verbrauchte Tage
                  </span>
                  <span className="font-semibold text-foreground">
                    21 <span className="font-normal">Tage übrig</span>
                  </span>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

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
                      ? 'bg-green-500/10'
                      : effectiveState.status === 'on_break'
                        ? 'bg-yellow-500/10'
                        : 'bg-muted'
                  )}
                >
                  <Clock
                    className={cn(
                      'h-5 w-5',
                      effectiveState.status === 'working'
                        ? 'text-green-600 dark:text-green-400'
                        : effectiveState.status === 'on_break'
                          ? 'text-yellow-600 dark:text-yellow-300'
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
                    ? 'bg-green-500/10 text-green-600 dark:text-green-400'
                    : effectiveState.status === 'on_break'
                      ? 'bg-yellow-500/10 text-yellow-700 dark:text-yellow-300'
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
                />
              </>
            )}
          </CardContent>
        </Card>
      </div>

      <JobPickerModal
        open={showJobPicker}
        onClose={() => setShowJobPicker(false)}
        onConfirm={handlePickerConfirm}
        organizationId={organizationId}
        mode={pickerMode}
        currentJobId={effectiveState.activeJobId}
        isPending={isPending}
      />

      {statusError && (
        <p className="text-center text-xs text-destructive">{statusError}</p>
      )}
    </div>
  );
}

interface MenuCardProps {
  icon: React.ElementType;
  title: string;
  subtitle: string;
  disabled?: boolean;
  disabledHint?: string;
  active?: boolean;
  onClick?: () => void;
}

function MenuCard({
  icon: Icon,
  title,
  subtitle,
  disabled,
  disabledHint,
  active,
  onClick
}: MenuCardProps) {
  return (
    <Card
      className={cn(
        'transition-colors',
        disabled
          ? 'opacity-60 cursor-not-allowed'
          : 'cursor-pointer hover:bg-accent/50',
        active && 'ring-1 ring-primary/30'
      )}
      onClick={disabled ? undefined : onClick}
    >
      <CardContent className="flex items-center justify-between p-4">
        <div className="flex items-center gap-3">
          <div
            className={cn(
              'flex h-10 w-10 items-center justify-center rounded-full',
              active ? 'bg-primary/10' : 'bg-brand-purple/10'
            )}
          >
            <Icon
              className={cn(
                'h-5 w-5',
                active ? 'text-primary' : 'text-brand-purple'
              )}
            />
          </div>
          <div>
            <p className="font-medium">{title}</p>
            <p
              className="text-xs text-muted-foreground truncate max-w-[200px]"
              title={disabled && disabledHint ? disabledHint : subtitle}
            >
              {disabled && disabledHint ? disabledHint : subtitle}
            </p>
          </div>
        </div>
        <ChevronRight className="h-5 w-5 text-muted-foreground" />
      </CardContent>
    </Card>
  );
}


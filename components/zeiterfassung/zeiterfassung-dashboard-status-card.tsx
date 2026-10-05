'use client';

import { Clock } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { cn } from '@/lib/utils';
import type { useWeeklyTimeData } from '@/hooks/use-weekly-time-data';
import { WeeklyHoursChart } from './weekly-hours-chart';
import type { LiveClockState } from '@/lib/time-tracking/types';

type ZeiterfassungDashboardStatusCardProps = Pick<
  ReturnType<typeof useWeeklyTimeData>,
  'weekData' | 'weekTargets' | 'todayIndex' | 'weekLabel'
> & {
  effectiveState: LiveClockState;
  liveTotalMinutes: number;
  liveBreakMinutes: number;
};

// Working time status and the weekly chart
export function ZeiterfassungDashboardStatusCard({
  effectiveState,
  weekData,
  weekTargets,
  todayIndex,
  weekLabel,
  liveTotalMinutes,
  liveBreakMinutes,
}: ZeiterfassungDashboardStatusCardProps) {
  return (
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
                    : 'bg-muted',
              )}
            >
              <Clock
                className={cn(
                  'h-5 w-5',
                  effectiveState.status === 'working'
                    ? 'text-success-soft-foreground'
                    : effectiveState.status === 'on_break'
                      ? 'text-warning-soft-foreground'
                      : 'text-muted-foreground',
                )}
              />
            </div>
            <div>
              <p className="font-medium">Arbeitszeit</p>
              <p className="text-xs text-muted-foreground">
                {effectiveState.isClockedIn && effectiveState.clockInTime
                  ? `Seit ${new Date(effectiveState.clockInTime).toLocaleTimeString('de-DE', {
                      hour: '2-digit',
                      minute: '2-digit',
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
                  : 'bg-muted text-muted-foreground',
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
  );
}

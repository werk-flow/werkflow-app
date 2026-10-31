'use client';

import { Clock } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { cn, formatBerlinTime } from '@/lib/utils';
import type { useWeeklyTimeData } from '@/hooks/use-weekly-time-data';
import { WeeklyHoursChart } from './weekly-hours-chart';
import { describeClockActivity, type ClockActivityTone } from '@/lib/time-tracking/clock-day-summary';
import type { LiveClockState } from '@/lib/time-tracking/types';

type ZeiterfassungDashboardStatusCardProps = Pick<
  ReturnType<typeof useWeeklyTimeData>,
  'weekData' | 'weekTargets' | 'todayIndex' | 'weekLabel'
> & {
  effectiveState: LiveClockState;
  liveTotalMinutes: number;
  liveBreakMinutes: number;
};

const ACTIVITY_TONE_CLASSES = {
  active: {
    circle: 'bg-success-soft',
    icon: 'text-success-soft-foreground',
    badge: 'bg-success-soft text-success-soft-foreground',
  },
  break: {
    circle: 'bg-warning-soft',
    icon: 'text-warning-soft-foreground',
    badge: 'bg-warning-soft text-warning-soft-foreground',
  },
  idle: { circle: 'bg-muted', icon: 'text-muted-foreground', badge: 'bg-muted text-muted-foreground' },
} as const satisfies Record<ClockActivityTone, { circle: string; icon: string; badge: string }>;

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
  const activity = describeClockActivity(effectiveState);
  return (
    <Card>
      <CardContent className="p-4 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div
              className={cn(
                'flex h-10 w-10 items-center justify-center rounded-full',
                ACTIVITY_TONE_CLASSES[activity.tone].circle,
              )}
            >
              <Clock className={cn('h-5 w-5', ACTIVITY_TONE_CLASSES[activity.tone].icon)} />
            </div>
            <div>
              <p className="font-medium">Arbeitszeit</p>
              <p className="text-xs text-muted-foreground">
                {effectiveState.isClockedIn && effectiveState.clockInTime
                  ? `Seit ${formatBerlinTime(effectiveState.clockInTime)} Uhr`
                  : 'Nicht aktiv'}
              </p>
            </div>
          </div>
          <span
            className={cn(
              'rounded-full px-3 py-1 text-xs font-medium',
              ACTIVITY_TONE_CLASSES[activity.tone].badge,
            )}
          >
            {activity.badge}
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

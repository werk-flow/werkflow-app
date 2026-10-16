'use client';

import { DEFAULT_DAILY_TARGET_MINUTES } from '@/lib/personnel/targets';
import { useMemo } from 'react';
import { Progress } from '@/components/ui/progress';
import { useMountedWallClockTick } from '@/hooks/use-wall-clock-tick';
import { liveMinutes } from '@/lib/time-tracking/helpers';
import { cn } from '@/lib/utils';
import type { DailyTarget } from '@/lib/personnel/targets';

interface HoursDisplayProps {
  status?: 'clocked_out' | 'working' | 'on_break' | undefined;
  isClockedIn: boolean;
  statusStartedAt: string | null;
  workMinutes: number;
  /** Whether the viewer has permission to see this member's progress */
  canViewStatus?: boolean | undefined;
  /** Resolved daily target (P1-04); without it the legacy 8h goal applies. */
  target?: DailyTarget | undefined;
}

/**
 * Calculate percentage towards the daily goal (capped at 100%)
 */
function calculatePercentage(totalMinutes: number, goalMinutes: number): number {
  if (goalMinutes <= 0) return 0;
  const percentage = (totalMinutes / goalMinutes) * 100;
  return Math.min(percentage, 100);
}

/**
 * Format percentage for display
 */
function formatPercentage(percentage: number): string {
  return `${Math.round(percentage)}%`;
}

export function HoursDisplay({
  isClockedIn,
  status,
  statusStartedAt,
  workMinutes,
  canViewStatus = true,
  target,
}: HoursDisplayProps) {
  const effectiveStatus = status ?? (isClockedIn ? 'working' : 'clocked_out');
  // Only a working member's minutes grow; the server and the hydrating render
  // show the recorded minutes, the tick adds the running ones after mount.
  const runningSince = effectiveStatus === 'working' ? statusStartedAt : null;
  const nowMs = useMountedWallClockTick(60_000, runningSince !== null);
  const totalMinutes = nowMs === null ? workMinutes : liveMinutes(workMinutes, runningSince, nowMs);

  // Without a resolved target the labeled `default` target source applies.
  const goalMinutes = target?.targetMinutes ?? DEFAULT_DAILY_TARGET_MINUTES;
  // Visible exception, not a silent assumption: mark unconfigured members.
  const goalHint =
    target?.source === 'default'
      ? 'Kein Arbeitszeitmodell hinterlegt – Standardziel 8 Stunden'
      : target?.source === 'derived'
        ? 'Ziel aus den Wochenstunden der Beschäftigung abgeleitet'
        : undefined;
  const zeroTargetReason =
    target && target.targetMinutes === 0
      ? target.isHoliday
        ? `Feiertag: ${target.holidayName}`
        : target.isClosureDay
          ? 'Betriebsruhe'
          : 'Kein Arbeitstag laut Wochenplan'
      : undefined;

  const percentage = useMemo(
    () => calculatePercentage(totalMinutes, goalMinutes),
    [goalMinutes, totalMinutes],
  );

  // Determine indicator color based on progress
  const getIndicatorColor = () => {
    if (percentage >= 100) return 'bg-success';
    return 'bg-brand-purple';
  };

  // Show "Nicht verfügbar" for members the current user can't view
  if (!canViewStatus) {
    return (
      <div className="flex items-center gap-2 min-w-[100px]">
        <Progress
          value={0}
          label="Tagesfortschritt nicht verfügbar"
          className="h-2 flex-1 bg-muted/30"
          indicatorClassName="bg-muted-foreground/30"
        />
        <span className="text-xs font-medium text-muted-foreground w-8 text-right">—</span>
      </div>
    );
  }

  if (zeroTargetReason) {
    return (
      <div className="flex items-center gap-2 min-w-[100px]" title={zeroTargetReason}>
        <Progress
          value={0}
          label={`Tagesfortschritt: ${zeroTargetReason}`}
          className="h-2 flex-1 bg-muted/30"
          indicatorClassName="bg-muted-foreground/30"
        />
        <span className="truncate text-xs font-medium text-muted-foreground">{zeroTargetReason}</span>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 min-w-[100px]" title={goalHint}>
      <Progress
        value={percentage}
        label={`Tagesfortschritt: ${formatPercentage(percentage)}`}
        className={cn('h-2 flex-1 bg-muted/50')}
        indicatorClassName={cn(getIndicatorColor(), effectiveStatus === 'working' && 'opacity-80')}
      />
      <span
        className={cn(
          'text-xs font-medium tabular-nums w-8 text-right',
          percentage >= 100 ? 'text-success-text' : 'text-muted-foreground',
        )}
      >
        {formatPercentage(percentage)}
      </span>
      {target?.source === 'default' && (
        <span
          role="img"
          aria-label="Kein Arbeitszeitmodell hinterlegt"
          className="inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-warning"
        />
      )}
    </div>
  );
}

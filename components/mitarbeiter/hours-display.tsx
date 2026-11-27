'use client';

import { useMemo } from 'react';
import { Progress } from '@/components/ui/progress';
import { useMountedWallClockTick } from '@/hooks/use-wall-clock-tick';
import { memberLiveDay, type MemberStatus } from '@/lib/time-tracking/member-day';
import { cn } from '@/lib/utils';
import { getNoTargetReason, type DailyTarget } from '@/lib/personnel/targets';
import { HIDDEN_STATUS_HINT, type StatusVisibility } from './member-status-visibility';

interface HoursDisplayProps {
  /** The member's status today; none yet reads as nothing recorded. */
  status?: MemberStatus | undefined;
  visibility?: StatusVisibility | undefined;
  /** Resolved daily target (P1-04); without it the progress is unknown, never measured against 8h. */
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

export function HoursDisplay({ status, visibility = 'visible', target }: HoursDisplayProps) {
  const effectiveStatus = status?.status ?? 'clocked_out';
  // The server and the hydrating render show the recorded minutes, the tick
  // adds the running ones after mount, split by the day rule as the detail
  // and the week split them (`memberLiveDay`). It ticks for every running
  // activity, as the detail does: a tracked break under the automatic rule
  // still counts toward its steps.
  const nowMs = useMountedWallClockTick(60_000, status?.isClockedIn ?? false);
  const { breakdown } = memberLiveDay(status, target?.targetMinutes, nowMs);
  const totalMinutes = breakdown.workMinutes + breakdown.overtimeMinutes;

  const goalMinutes = target?.targetMinutes ?? 0;
  // Visible exception, not a silent assumption: mark unconfigured members.
  const goalHint =
    target?.source === 'default'
      ? 'Kein Arbeitszeitmodell hinterlegt – Standardziel 8 Stunden von Montag bis Freitag'
      : target?.source === 'derived'
        ? 'Ziel aus den Wochenstunden der Beschäftigung abgeleitet'
        : undefined;
  // A target the page could not read is unknown, never an invented 8h day.
  const noTargetReason = target ? getNoTargetReason(target) : 'Tagesziel nicht geladen';

  const percentage = useMemo(
    () => calculatePercentage(totalMinutes, goalMinutes),
    [goalMinutes, totalMinutes],
  );

  // Determine indicator color based on progress
  const getIndicatorColor = () => {
    if (percentage >= 100) return 'bg-success';
    return 'bg-brand-purple';
  };

  if (visibility !== 'visible') {
    const hidden = visibility === 'hidden';
    return (
      <div className="flex items-center gap-2 min-w-[100px]" title={hidden ? HIDDEN_STATUS_HINT : undefined}>
        <Progress
          value={0}
          label={hidden ? 'Tagesfortschritt nicht sichtbar' : 'Tagesfortschritt nicht geladen'}
          className="h-2 flex-1 bg-muted/30"
          indicatorClassName="bg-muted-foreground/30"
        />
        <span className="text-xs font-medium text-muted-foreground w-8 text-right">—</span>
      </div>
    );
  }

  if (noTargetReason) {
    return (
      <div className="flex items-center gap-2 min-w-[100px]" title={noTargetReason}>
        <Progress
          value={0}
          label={`Tagesfortschritt: ${noTargetReason}`}
          className="h-2 flex-1 bg-muted/30"
          indicatorClassName="bg-muted-foreground/30"
        />
        <span className="truncate text-xs font-medium text-muted-foreground">{noTargetReason}</span>
        {target && <UnconfiguredMarker target={target} />}
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
      {target && <UnconfiguredMarker target={target} />}
    </div>
  );
}

/**
 * Marks a member on the labeled default target, on days without a target
 * too (the weekend), so missing configuration is never silent. Outside
 * employment no configuration applies.
 */
function UnconfiguredMarker({ target }: { target: DailyTarget }) {
  if (target.source !== 'default' || target.outsideEmployment) return null;
  return (
    <span
      role="img"
      aria-label="Kein Arbeitszeitmodell hinterlegt"
      className="inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-warning"
    />
  );
}

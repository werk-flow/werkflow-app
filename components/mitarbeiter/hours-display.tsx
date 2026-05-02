'use client';

import { useState, useEffect, useMemo } from 'react';
import { Progress } from '@/components/ui/progress';
import { getNonNegativeElapsedMs } from '@/lib/time-tracking/helpers';
import { cn } from '@/lib/utils';

interface HoursDisplayProps {
  isClockedIn: boolean;
  clockInTime: string | null;
  todayMinutes: number;
  /** Whether the viewer has permission to see this member's progress */
  canViewStatus?: boolean;
}

// Daily goal in minutes (8 hours)
const DAILY_GOAL_MINUTES = 8 * 60; // 480 minutes

/**
 * Calculate total minutes including live elapsed time
 */
function calculateTotalMinutes(
  clockInTime: string | null,
  baseMinutes: number
): number {
  if (!clockInTime) return baseMinutes;

  const elapsedMinutes = getNonNegativeElapsedMs(clockInTime) / (1000 * 60);

  return baseMinutes + elapsedMinutes;
}

/**
 * Calculate percentage towards daily goal (capped at 100%)
 */
function calculatePercentage(totalMinutes: number): number {
  const percentage = (totalMinutes / DAILY_GOAL_MINUTES) * 100;
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
  clockInTime,
  todayMinutes,
  canViewStatus = true
}: HoursDisplayProps) {
  const [totalMinutes, setTotalMinutes] = useState(() =>
    calculateTotalMinutes(clockInTime, todayMinutes)
  );

  // Live update when clocked in
  useEffect(() => {
    if (!isClockedIn || !clockInTime) {
      setTotalMinutes(todayMinutes);
      return;
    }

    // Update immediately
    setTotalMinutes(calculateTotalMinutes(clockInTime, todayMinutes));

    // Then update every minute for smoother progress
    const interval = setInterval(() => {
      setTotalMinutes(calculateTotalMinutes(clockInTime, todayMinutes));
    }, 60000); // Update every minute

    return () => clearInterval(interval);
  }, [isClockedIn, clockInTime, todayMinutes]);

  const percentage = useMemo(
    () => calculatePercentage(totalMinutes),
    [totalMinutes]
  );

  // Determine indicator color based on progress
  const getIndicatorColor = () => {
    if (percentage >= 100) return 'bg-green-500';
    return 'bg-brand-purple';
  };

  // Show "Nicht verfügbar" for members the current user can't view
  if (!canViewStatus) {
    return (
      <div className="flex items-center gap-2 min-w-[100px]">
        <Progress
          value={0}
          className="h-2 flex-1 bg-muted/30"
          indicatorClassName="bg-muted-foreground/30"
        />
        <span className="text-xs font-medium text-muted-foreground/50 w-8 text-right">
          —
        </span>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 min-w-[100px]">
      <Progress
        value={percentage}
        className={cn('h-2 flex-1 bg-muted/50')}
        indicatorClassName={cn(
          getIndicatorColor(),
          isClockedIn && 'opacity-80'
        )}
      />
      <span
        className={cn(
          'text-xs font-medium tabular-nums w-8 text-right',
          percentage >= 100
            ? 'text-green-600 dark:text-green-400'
            : 'text-muted-foreground'
        )}
      >
        {formatPercentage(percentage)}
      </span>
    </div>
  );
}

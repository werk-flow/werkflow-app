'use client';

import { useEffect } from 'react';
import { startWallClockInterval } from '@/hooks/use-wall-clock-tick';
import { getBusinessTodayIso } from '@/lib/date-time/berlin';

/**
 * Wall-clock companion to the live-view primitive: fires `refresh` when the
 * Europe/Berlin business date changes while the surface stays mounted (the
 * tab left open overnight). This is deliberately NOT a Realtime concern —
 * nothing writes a row at midnight — and it compares a local date string on
 * the shared wall-clock interval, it does not poll the server. It renders
 * nothing by itself. The woken-laptop case needs no visibility listener here:
 * the Realtime provider's coalesced catch-up already triggers every
 * subscribed surface's refetch on tab return.
 */
/**
 * Fires `refresh` once on the shared minute tick after the wall clock passes
 * `deadline` (epoch milliseconds): a deadline that passes writes no row, so no
 * Realtime event reports it. Ticks only while a deadline is set.
 */
export function useDeadlineRefresh(deadline: number | null, refresh: () => void): void {
  useEffect(() => {
    if (deadline === null) return;
    const stop = startWallClockInterval(() => {
      if (Date.now() < deadline) return;
      stop();
      refresh();
    }, 60_000);
    return stop;
  }, [deadline, refresh]);
}

export function useBusinessDayRefresh(refresh: () => void): void {
  useEffect(() => {
    let businessDate = getBusinessTodayIso();
    const refreshIfDateChanged = () => {
      const nextBusinessDate = getBusinessTodayIso();
      if (nextBusinessDate === businessDate) return;
      businessDate = nextBusinessDate;
      refresh();
    };
    return startWallClockInterval(refreshIfDateChanged, 60_000);
  }, [refresh]);
}

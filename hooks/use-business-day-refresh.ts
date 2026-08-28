'use client';

import { useEffect } from 'react';
import { getBusinessTodayIso } from '@/lib/personnel/types';

/**
 * Wall-clock companion to the live-view primitive: fires `refresh` when the
 * Europe/Berlin business date changes while the surface stays mounted (the
 * tab left open overnight). This is deliberately NOT a Realtime concern —
 * nothing writes a row at midnight — and the interval is a named exception
 * to the setInterval ban (eslint.config.mjs): it compares a local date
 * string, it does not poll the server. The woken-laptop case needs no
 * visibility listener here: the Realtime provider's coalesced catch-up
 * already triggers every subscribed surface's refetch on tab return.
 */
export function useBusinessDayRefresh(refresh: () => void): void {
  useEffect(() => {
    let businessDate = getBusinessTodayIso();
    const refreshIfDateChanged = () => {
      const nextBusinessDate = getBusinessTodayIso();
      if (nextBusinessDate === businessDate) return;
      businessDate = nextBusinessDate;
      refresh();
    };
    const intervalId = window.setInterval(refreshIfDateChanged, 60_000);
    return () => {
      window.clearInterval(intervalId);
    };
  }, [refresh]);
}

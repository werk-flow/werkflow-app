'use client';

import { useEffect } from 'react';
import { getBusinessTodayIso } from '@/lib/personnel/types';

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
    document.addEventListener('visibilitychange', refreshIfDateChanged);
    return () => {
      window.clearInterval(intervalId);
      document.removeEventListener('visibilitychange', refreshIfDateChanged);
    };
  }, [refresh]);
}

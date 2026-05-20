'use client';

import { useState, useEffect } from 'react';
import { getNonNegativeElapsedMs } from '@/lib/time-tracking/helpers';

interface LiveCounterProps {
  clockInTime: string;
  todayMinutes: number;
}

function formatElapsedTime(startTime: Date, baseMinutes: number): string {
  const totalMs =
    getNonNegativeElapsedMs(startTime.toISOString()) + baseMinutes * 60 * 1000;

  const hours = Math.floor(totalMs / (1000 * 60 * 60));
  const minutes = Math.floor((totalMs % (1000 * 60 * 60)) / (1000 * 60));
  const seconds = Math.floor((totalMs % (1000 * 60)) / 1000);

  return `${hours.toString().padStart(2, '0')}:${minutes
    .toString()
    .padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
}

export function LiveCounter({ clockInTime, todayMinutes }: LiveCounterProps) {
  const [elapsed, setElapsed] = useState(() =>
    formatElapsedTime(new Date(clockInTime), todayMinutes)
  );

  useEffect(() => {
    const startTime = new Date(clockInTime);

    // Then update every second
    const interval = setInterval(() => {
      setElapsed(formatElapsedTime(startTime, todayMinutes));
    }, 1000);

    return () => clearInterval(interval);
  }, [clockInTime, todayMinutes]);

  return (
    <span className="text-sm font-medium tabular-nums text-green-600 dark:text-green-400">
      {elapsed}
    </span>
  );
}


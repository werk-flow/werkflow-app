'use client';

import { useEffect, useMemo, useState } from 'react';

function getMinuteTimestamp() {
  return Date.now();
}

export function useCurrentTimePosition(
  effectiveHourWidth: number,
  enabled: boolean
) {
  const [nowTimestamp, setNowTimestamp] = useState(getMinuteTimestamp);

  useEffect(() => {
    if (!enabled) return;

    const interval = window.setInterval(() => {
      setNowTimestamp(getMinuteTimestamp());
    }, 60000);

    return () => window.clearInterval(interval);
  }, [enabled]);

  return useMemo(() => {
    if (!enabled) return null;

    const now = new Date(nowTimestamp);
    const totalHours = now.getHours() + now.getMinutes() / 60;
    return totalHours * effectiveHourWidth;
  }, [effectiveHourWidth, enabled, nowTimestamp]);
}

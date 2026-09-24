'use client';

import { useEffect, useState } from 'react';

/** A wall-clock tick once a minute for the now indicator and open blocks. */
export function useNowTick(enabled = true): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!enabled) return;
    // eslint-disable-next-line no-restricted-syntax -- wall-clock render tick, no data polling
    const interval = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(interval);
  }, [enabled]);
  return now;
}

'use client';

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { NOTHING_SHOWN, advanceShownClock, type ClockFacts, type ShownClock } from './shown-clock-rule';

// What the clock shows while the connection changes (decision record 0010, the
// amendment "what the clock shows while the connection changes"). The phone's own actions show at
// once. Everything else waits for a settled answer: while unsent actions settle, the clock keeps the
// state the person saw, with one calm marker, until a clock read that started after they settled
// answers. It never shows a state it is not sure of, and never an intermediate one. It decides only
// what is shown; recorded time changes only through the outbox and the server.

/**
 * The shown clock across renders. When unsent actions settled and no clock read started since, or
 * the network returns while it waits, it asks for one: the server's answer is what ends the wait.
 */
export function useShownClock(
  facts: ClockFacts,
  readAgain: { lastStart: () => number; refresh: () => Promise<void> },
): ShownClock {
  const [memory, setMemory] = useState(NOTHING_SHOWN);
  const next = advanceShownClock(memory, facts);
  // The state of the previous render, adjusted during render: no frame shows the stale one.
  if (next !== memory) setMemory(next);
  const { settledAt } = next;
  const { online } = facts;
  const wasOnline = useRef(online);
  useEffect(() => {
    const cameOnline = online && !wasOnline.current;
    wasOnline.current = online;
    if (settledAt !== null && online && (cameOnline || readAgain.lastStart() < settledAt))
      void readAgain.refresh();
  }, [settledAt, online, readAgain]);
  return next.shown;
}

function onConnectionChange(changed: () => void): () => void {
  window.addEventListener('online', changed);
  window.addEventListener('offline', changed);
  return () => {
    window.removeEventListener('online', changed);
    window.removeEventListener('offline', changed);
  };
}

/** Whether the phone reports network; the server render assumes it does. */
export function useOnline(): boolean {
  return useSyncExternalStore(
    onConnectionChange,
    () => navigator.onLine,
    () => true,
  );
}

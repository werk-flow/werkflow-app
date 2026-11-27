'use client';

import { useEffect, useRef } from 'react';
import type { RealtimeChannel } from '@supabase/supabase-js';

import {
  KI_LIVE_EVENT,
  KI_LIVE_PROTOCOL,
  type KiLiveEvent,
  kiLiveEventSchema,
  kiLiveTopic,
} from '@/lib/ai/live/events';
import { kiLiveFailures, kiLiveRejoinDelayMs } from '@/lib/ai/live/rejoin';
import { logError } from '@/lib/logging';
import { createSupabaseBrowserClient } from '@/lib/supabase/client';
import { tabStorage } from '@/lib/time-tracking/manual-entry-bridge-storage';

// The chat's one exception to the Realtime provider's channel ownership
// (docs/technical/realtime-and-caching.md, "WerkFlow KI live channel"): the
// shown thread's private Broadcast channel, joined only while the tab is
// visible, joined again with backoff after a failure.

const RELOADED_FOR = 'werkflow-ki-live-reloaded-for';

/**
 * A server that speaks a newer live protocol than this build: the page loads
 * the new build once. A second mismatch after that reload changes nothing.
 */
function reloadOnce(protocol: number): void {
  try {
    const storage = tabStorage();
    // Without storage the tab could not tell its second reload from its first.
    if (storage === null || storage.getItem(RELOADED_FOR) === String(protocol)) return;
    storage.setItem(RELOADED_FOR, String(protocol));
  } catch {
    // best-effort: without storage the tab does not reload, and the thread's next read shows the answer.
    return;
  }
  window.location.reload();
}

function parseEvent(payload: unknown): KiLiveEvent | null {
  const event = kiLiveEventSchema.safeParse(payload);
  if (event.success) {
    if (event.data.v === KI_LIVE_PROTOCOL) return event.data;
    if (event.data.v > KI_LIVE_PROTOCOL) reloadOnce(event.data.v);
    return null;
  }
  // A shape this build cannot read from a newer server still names its protocol.
  const version = typeof payload === 'object' && payload !== null && 'v' in payload ? payload.v : null;
  if (typeof version === 'number' && version > KI_LIVE_PROTOCOL) reloadOnce(version);
  return null;
}

/**
 * Follows the thread on screen: `onEvent` gets each live event, and `onJoin`
 * runs after every join, the first included, so the page reads what it
 * missed while it was not joined. No thread, no channel; a hidden tab leaves
 * the channel and joins again when it is shown.
 */
export function useKiLive(input: {
  threadId: string | null;
  onEvent: (threadId: string, event: KiLiveEvent) => void;
  onJoin: (threadId: string) => void;
}): void {
  const { threadId } = input;
  const handlers = useRef(input);
  useEffect(() => {
    handlers.current = input;
  });
  useEffect(() => {
    if (threadId === null) return;
    const supabase = createSupabaseBrowserClient();
    let channel: RealtimeChannel | null = null;
    let failures = 0;
    let joinedAt: number | null = null;
    let cancelRejoin: (() => void) | null = null;
    let stopped = false;

    const leave = (): void => {
      cancelRejoin?.();
      cancelRejoin = null;
      const current = channel;
      channel = null;
      joinedAt = null;
      if (current) void supabase.removeChannel(current);
    };

    const join = (): void => {
      cancelRejoin = null;
      if (stopped || channel || document.visibilityState === 'hidden') return;
      const joining = supabase
        .channel(kiLiveTopic(threadId), { config: { private: true } })
        .on('broadcast', { event: KI_LIVE_EVENT }, (message: { payload?: unknown }) => {
          const event = parseEvent(message.payload);
          if (event && channel === joining) handlers.current.onEvent(threadId, event);
        });
      channel = joining;
      joining.subscribe((status: string, error?: Error) => {
        if (channel !== joining) return;
        if (status === 'SUBSCRIBED') {
          joinedAt = Date.now();
          handlers.current.onJoin(threadId);
          return;
        }
        if (status !== 'CHANNEL_ERROR' && status !== 'TIMED_OUT' && status !== 'CLOSED') return;
        if (error) logError('kiLive: channel failed', error);
        failures = kiLiveFailures(failures, joinedAt === null ? null : Date.now() - joinedAt);
        leave();
        const timer = setTimeout(join, kiLiveRejoinDelayMs(failures, Math.random()));
        cancelRejoin = () => clearTimeout(timer);
      });
    };

    const followVisibility = (): void => {
      if (document.visibilityState === 'hidden') leave();
      else join();
    };
    document.addEventListener('visibilitychange', followVisibility);
    join();
    return () => {
      stopped = true;
      document.removeEventListener('visibilitychange', followVisibility);
      leave();
    };
  }, [threadId]);
}

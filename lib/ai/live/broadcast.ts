import 'server-only';

import { AI_TURN_LIMITS, type AiEntryPoint } from '@/lib/ai/limits';
import {
  KI_LIVE_EVENT,
  KI_LIVE_PROTOCOL,
  type KiLiveEvent,
  type KiLiveMessage,
  kiLiveTopic,
} from '@/lib/ai/live/events';
import type { AiTurnEnd, AiTurnSink } from '@/lib/ai/turn';
import { type Schedule, timerSchedule } from '@/lib/ai/turn-stream';
import { getSupabaseUrl } from '@/lib/env/public';
import { getSupabaseSecretKey } from '@/lib/env/server';
import { logError } from '@/lib/logging';

/** The live channel's deltas leave at most this often: a fast model sends one message per interval. */
const KI_LIVE_INTERVAL_MS = 250;


/** Sends events in order through one REST call; resolves whether Realtime accepted them. */
export type KiLiveSend = (topic: string, events: KiLiveEvent[], signal: AbortSignal) => Promise<boolean>;

/**
 * Realtime's REST broadcast with the service key: the server sends, and the
 * topic's private flag makes Realtime deliver only to clients its policy let
 * join (supabase/migrations/20270503100000_let_only_the_author_follow_a_ki_thread_live.sql).
 */
const sendThroughRest: KiLiveSend = async (topic, events, signal) => {
  const key = getSupabaseSecretKey();
  const response = await fetch(`${getSupabaseUrl()}/realtime/v1/api/broadcast`, {
    method: 'POST',
    headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messages: events.map((payload) => ({ topic, event: KI_LIVE_EVENT, payload, private: true })),
    }),
    signal,
  });
  return response.status === 202;
};

/**
 * Sends a turn's messages under their time limit, the answer's end with a
 * second try inside it, each try with half of it: a follower that misses the end shows the answer as
 * still written until it reads the thread again. A failure costs only
 * freshness, so it is logged once per turn: a channel that fails once usually
 * fails for every message.
 */
function createPost(
  topic: string,
  send: KiLiveSend,
  timeoutMs: number,
): (messages: KiLiveMessage[], tries?: number) => Promise<void> {
  let failureLogged = false;
  return async (messages, tries = 1) => {
    const events = messages.map((message): KiLiveEvent => ({ ...message, v: KI_LIVE_PROTOCOL }));
    let failure: unknown = 'timeout';
    for (let attempt = 0; attempt < tries; attempt += 1) {
      try {
        // Each try has its share of the limit, so a stalled first try leaves the second its time.
        if (await send(topic, events, AbortSignal.timeout(timeoutMs / tries))) return;
        failure = 'not_accepted';
      } catch (error) {
        failure = error;
      }
    }
    if (failureLogged) return;
    failureLogged = true;
    logError('kiLive: broadcast failed', failure);
  };
}

export type KiLiveBroadcast = {
  /** Announces the turn: the person's message and the answer's place in the thread. */
  start: (started: Extract<KiLiveMessage, { type: 'started' }>) => void;
  /** Receives the answer while it is written, and each partial save. */
  sink: Required<AiTurnSink>;
  /** Sends what is left and the answer's end; resolves within two sends' time limits. */
  end: (end: AiTurnEnd) => Promise<void>;
};

function endMessage(command: string, end: AiTurnEnd, length: number): KiLiveMessage {
  return {
    type: 'end',
    command,
    status: end.status,
    failure: end.status === 'complete' ? null : end.message,
    length,
  };
}

/**
 * One turn's live messages on its thread's channel, in order and throttled.
 * Text that waits for a send joins the next message, so a slow send never
 * queues more than one. A failed send costs only freshness: the next message
 * names its offset, and a client that missed text reads the thread.
 */
export function createKiLiveBroadcast(
  input: { threadId: string; commandId: string; entryPoint: AiEntryPoint },
  send: KiLiveSend = sendThroughRest,
  schedule: Schedule = timerSchedule,
): KiLiveBroadcast {
  const topic = kiLiveTopic(input.threadId);
  const { liveSendTimeoutMs } = AI_TURN_LIMITS[input.entryPoint];
  let pending = '';
  let sent = 0;
  let saved = 0;
  let ended = false;
  let revoked = false;
  let inFlight: Promise<void> | null = null;
  let cancelPump: (() => void) | null = null;

  const post = createPost(topic, send, liveSendTimeoutMs);

  const takeText = (): KiLiveMessage | null => {
    if (!pending) return null;
    const message: KiLiveMessage = {
      type: 'text',
      command: input.commandId,
      at: sent,
      delta: pending,
      saved,
    };
    sent += pending.length;
    pending = '';
    return message;
  };

  const dispatch = (messages: KiLiveMessage[]): void => {
    inFlight = post(messages).finally(() => {
      inFlight = null;
      if (pending && !ended) schedulePump();
    });
  };

  const pump = (): void => {
    cancelPump = null;
    if (inFlight || ended) return;
    const message = takeText();
    if (message) dispatch([message]);
  };

  function schedulePump(): void {
    cancelPump ??= schedule(pump, KI_LIVE_INTERVAL_MS);
  }

  /** No text leaves after this; a send on its way still lands. */
  const stop = (): void => {
    ended = true;
    cancelPump?.();
    cancelPump = null;
  };

  return {
    start(started) {
      dispatch([started]);
    },
    sink: {
      text(delta) {
        if (ended) return;
        pending += delta;
        schedulePump();
      },
      saved(length) {
        saved = length;
      },
      revoked() {
        // The author lost access mid-turn: Realtime may still hold their join, so nothing more is sent.
        revoked = true;
        stop();
      },
    },
    async end(end) {
      stop();
      await inFlight;
      if (revoked) return;
      const length = sent + pending.length;
      const last = takeText();
      await post([...(last ? [last] : []), endMessage(input.commandId, end, length)], 2);
    },
  };
}

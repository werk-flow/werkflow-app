import 'server-only';

import { AI_TURN_LIMITS, type AiEntryPoint } from '@/lib/ai/limits';
import {
  KI_LIVE_EVENT,
  KI_LIVE_PROTOCOL,
  type KiLiveEvent,
  type KiLiveMessage,
  kiLiveTopic,
} from '@/lib/ai/live/events';
import type { AiThreadRow } from '@/lib/ai/thread-types';
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

function endMessage(command: string, end: AiTurnEnd, length: number, rows: AiThreadRow[]): KiLiveMessage {
  return {
    type: 'end',
    command,
    status: end.status,
    failure: end.status === 'complete' ? null : end.message,
    length,
    ...(rows.length > 0 ? { rows } : {}),
  };
}

/**
 * What a turn wrote and saved but did not send yet: its text from the
 * offset sent so far, then the rows saved after it, in order.
 */
function createOutbox(command: string) {
  let pending = '';
  let rows: KiLiveMessage[] = [];
  let sent = 0;
  let saved = 0;
  const latest = new Map<string, AiThreadRow>();
  return {
    text(delta: string): void {
      pending += delta;
    },
    row(row: AiThreadRow): void {
      rows.push({ type: 'row', command, row });
      if (row.revision >= (latest.get(row.key)?.revision ?? 0)) latest.set(row.key, row);
    },
    /** The turn's latest rows, each at its highest saved revision, at most the end's cap. */
    rows: (): AiThreadRow[] => [...latest.values()].slice(-50),
    saved(length: number): void {
      saved = length;
    },
    waiting: (): boolean => pending.length > 0 || rows.length > 0,
    /** The answer's length once all its text is sent. */
    length: (): number => sent + pending.length,
    take(): KiLiveMessage[] {
      const taken = rows;
      rows = [];
      if (!pending) return taken;
      const text: KiLiveMessage = { type: 'text', command, at: sent, delta: pending, saved };
      sent += pending.length;
      pending = '';
      return [text, ...taken];
    },
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
  const outbox = createOutbox(input.commandId);
  let ended = false;
  let revoked = false;
  let inFlight: Promise<void> | null = null;
  let cancelPump: (() => void) | null = null;

  const post = createPost(topic, send, liveSendTimeoutMs);

  const dispatch = (messages: KiLiveMessage[]): void => {
    inFlight = post(messages).finally(() => {
      inFlight = null;
      if (outbox.waiting() && !ended) schedulePump();
    });
  };

  const pump = (): void => {
    cancelPump = null;
    if (inFlight || ended) return;
    const messages = outbox.take();
    if (messages.length > 0) dispatch(messages);
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
        outbox.text(delta);
        schedulePump();
      },
      saved: outbox.saved,
      row(row) {
        if (ended) return;
        outbox.row(row);
        schedulePump();
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
      const length = outbox.length();
      await post([...outbox.take(), endMessage(input.commandId, end, length, outbox.rows())], 2);
    },
  };
}

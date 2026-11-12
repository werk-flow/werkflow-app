'use client';

import { applyTransitionEcho } from '@/lib/time-tracking/clock-echo';
import type { LiveClockState, TimeActivitySelection } from '@/lib/time-tracking/types';
import { todayHolderKey } from './today-store';
import {
  changeTimeOutbox,
  type OutboxHolder,
  type StoredClock,
  type StoredTimeEvent,
  type TimeOutbox,
} from './time-outbox-store';

// The rules of the time outbox (decision record 0010, the 2026-11-11
// amendment "the time outbox"). One person's unsent clock events in an
// organization form one chain: each event stands on the one before it, so
// they are sent in order, one at a time, and the chain stops at the first
// event the server does not accept. A stopped chain waits for the person; the
// device never rewrites an event to make the server accept it.

/**
 * How long an unsent time event counts as waiting for signal: the server's
 * recording deadline (owner queue OQ-4 of werk-flow/werkflow-planning#22).
 * After it the phone shows the event as not transferred, and the person may
 * delete it.
 */
const UNSENT_TIME_EVENT_KEEP_MS = 7 * 24 * 60 * 60 * 1000;

/** The clock call a phone can keep without signal; every other action needs the server's answer first. */
type OfflineClockCommand = {
  operationId: string;
  action: string;
  expectedSessionId: string | null;
  expectedVersion: number | null;
  selection: TimeActivitySelection | null;
};

type UnsentEventStatus =
  /** Waits for signal, or for its turn while the events before it are sent. */
  | 'pending'
  /** The server refused it for good, or it waited longer than the device keeps trying. */
  | 'failed'
  /** The server's state moved; the event was not recorded. */
  | 'conflict'
  /** Too old to be recorded automatically; the person files a correction. */
  | 'correction'
  /** Stands on an event before it that was not recorded. */
  | 'held';

export type UnsentTimeEvent = Pick<StoredTimeEvent, 'operationId' | 'capturedAt' | 'action' | 'selection'> & {
  status: UnsentEventStatus;
  /** The server's code for a stopped event, `expired` for one the device gave up waiting for. */
  code: string | null;
};

/** What the clock shows of one person's unsent events. */
export type ClockDeviceView = {
  /** `stopped`: the first event needs the person's decision, and nothing behind it is sent. */
  status: 'pending' | 'stopped';
  /** The clock with every unsent event applied; null for a stopped chain, where the server's state stands. */
  state: LiveClockState | null;
  events: UnsentTimeEvent[];
};

const NO_SESSION = { sessionId: null, version: null };

function waitedTooLong(event: StoredTimeEvent, now: Date): boolean {
  return now.getTime() - Date.parse(event.capturedAt) > UNSENT_TIME_EVENT_KEEP_MS;
}

function headStatus(head: StoredTimeEvent, now: Date): { status: UnsentEventStatus; code: string | null } {
  if (head.verdict?.outcome === 'rejected') return { status: 'failed', code: head.verdict.code };
  if (head.verdict?.code === 'correction_required') return { status: 'correction', code: head.verdict.code };
  if (head.verdict) return { status: 'conflict', code: head.verdict.code };
  return waitedTooLong(head, now) ? { status: 'failed', code: 'expired' } : { status: 'pending', code: null };
}

/** The clock with one unsent event applied, at its captured time. */
function applyUnsentEvent(state: LiveClockState, event: StoredTimeEvent): LiveClockState {
  return applyTransitionEcho(
    state,
    event.selection,
    {
      outcome: event.action === 'end' ? 'ended' : 'active',
      sessionId: state.sessionId,
      segmentId: null,
      version: state.sessionVersion,
      recoveryReason: null,
    },
    new Date(event.capturedAt),
  );
}

/** What the clock shows for an outbox, or null when it holds no event. */
export function clockDeviceView(outbox: TimeOutbox, now: Date): ClockDeviceView | null {
  const [head, ...behind] = outbox.events;
  if (!head) return null;
  const first = headStatus(head, now);
  const stopped = first.status !== 'pending';
  const { clock } = outbox;
  return {
    status: stopped ? 'stopped' : 'pending',
    state: stopped || !clock?.base ? null : outbox.events.reduce(applyUnsentEvent, clock.base),
    events: [
      { ...head, ...first },
      ...behind.map((event) => ({
        ...event,
        status: stopped ? ('held' as const) : ('pending' as const),
        code: null,
      })),
    ],
  };
}

/** The clock a phone keeps: without job, customer and project names, which no unsent event needs. */
function clockToKeep(holder: OutboxHolder, base: LiveClockState, wipeGeneration: string): StoredClock {
  return {
    holder: todayHolderKey(holder),
    ...holder,
    base: { ...base, activeJobInfo: null, resumeJobInfo: null },
    wipeGeneration,
  };
}

/** Whether a phone can keep the action without signal: every other one needs the server's answer first. */
export function isOfflineClockAction(action: string): action is StoredTimeEvent['action'] {
  return action === 'start' || action === 'switch' || action === 'end';
}

/** One clock action as it was captured: when, on which confirmed clock, and under which wipe signal. */
export type TimeEventCapture = {
  command: OfflineClockCommand & { action: StoredTimeEvent['action'] };
  /** The clock the server last confirmed, for the first event of a chain; null for one that stands on another. */
  base: LiveClockState | null;
  capturedAt: Date;
  triedOnline: boolean;
  /** The wipe signal when the person acted (today-store.ts): the page without signal shows the clock only under the current one. */
  wipeGeneration: string;
};

/**
 * Puts one captured clock action into the holder's outbox. The first event of a chain stands on
 * `base` and expects the session and version the command names. A later event stands on the event
 * before it and learns its expectation from that event's answer; behind a stopped chain it waits
 * with it. An action the outbox already holds is kept once. Throws when the device storage fails,
 * a full disk included.
 */
export function captureTimeEvent(
  holder: OutboxHolder,
  capture: TimeEventCapture,
): ReturnType<typeof changeTimeOutbox> {
  const { command, base } = capture;
  return changeTimeOutbox(holder, (current) => {
    if (current.events.some((kept) => kept.operationId === command.operationId)) return null;
    const last = current.events.at(-1);
    const event: StoredTimeEvent = {
      operationId: command.operationId,
      ...holder,
      sequence: (last?.sequence ?? 0) + 1,
      capturedAt: capture.capturedAt.toISOString(),
      action: command.action,
      selection: command.selection,
      expected: last ? null : { sessionId: command.expectedSessionId, version: command.expectedVersion },
      triedOnline: capture.triedOnline,
      verdict: null,
    };
    if (last) return { clock: current.clock, events: [...current.events, event] };
    if (base) return { clock: clockToKeep(holder, base, capture.wipeGeneration), events: [event] };
    // Kept behind events the outbox has sent since: it expects what the last of them left.
    const after = current.clock?.after;
    return { clock: current.clock, events: [after ? { ...event, expected: after } : event] };
  });
}

/** The server's answer to the first event of the chain, as far as the device acts on it. */
export type HeadAnswer =
  | {
      kind: 'recorded';
      state: { sessionId: string | null; segmentId: string | null; version: number | null };
    }
  | { kind: 'stopped'; verdict: NonNullable<StoredTimeEvent['verdict']> };

/**
 * Applies the server's answer to the chain's first event, if `operationId` still is that event:
 * another tab may have applied the same answer already. A recorded event leaves, the clock moves
 * on by it and the next event learns what it expects, all in one transaction. When it was the last
 * one, the clock keeps that expectation for an action a page kept meanwhile and the outbox takes in
 * later (`after`). A stopped event stays with the server's answer.
 */
export function settleFirstTimeEvent(
  holder: OutboxHolder,
  operationId: string,
  answer: HeadAnswer,
): ReturnType<typeof changeTimeOutbox> {
  return changeTimeOutbox(holder, (current) => {
    const [head, next, ...rest] = current.events;
    if (!head || head.operationId !== operationId) return null;
    if (answer.kind === 'stopped')
      return {
        clock: current.clock,
        events: [{ ...head, verdict: answer.verdict }, ...current.events.slice(1)],
      };
    const { state } = answer;
    // After an end no session is open.
    const after = head.action === 'end' ? NO_SESSION : { sessionId: state.sessionId, version: state.version };
    const base =
      current.clock?.base &&
      applyTransitionEcho(
        current.clock.base,
        head.selection,
        { outcome: head.action === 'end' ? 'ended' : 'active', ...state, recoveryReason: null },
        new Date(head.capturedAt),
      );
    return {
      clock: {
        holder: todayHolderKey(holder),
        ...holder,
        base: base ?? null,
        after,
        wipeGeneration: current.clock?.wipeGeneration ?? 'unreadable',
      },
      events: next ? [{ ...next, expected: after }, ...rest] : [],
    };
  });
}

/** Lets a refused first event be sent again, unchanged, after the person asked for it. */
export function retryFirstTimeEvent(holder: OutboxHolder): ReturnType<typeof changeTimeOutbox> {
  return changeTimeOutbox(holder, (current) => {
    const [head, ...behind] = current.events;
    if (head?.verdict?.outcome !== 'rejected') return null;
    return { clock: current.clock, events: [{ ...head, verdict: null }, ...behind] };
  });
}

/**
 * Deletes the holder's unsent events and their clock: after the person chose to discard them, or
 * filed the correction that replaces them.
 */
export function discardTimeEvents(holder: OutboxHolder): ReturnType<typeof changeTimeOutbox> {
  return changeTimeOutbox(holder, () => ({ clock: null, events: [] }));
}

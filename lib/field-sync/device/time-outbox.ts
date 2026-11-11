'use client';

import { applyTransitionEcho } from '@/lib/time-tracking/clock-echo';
import type { LiveClockState, TimeActivitySelection } from '@/lib/time-tracking/types';
import { sharedWipeGeneration, todayHolderKey } from './today-store';
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
export const UNSENT_TIME_EVENT_KEEP_MS = 7 * 24 * 60 * 60 * 1000;

/** The clock call a phone can keep without signal; every other action needs the server's answer first. */
export type OfflineClockCommand = {
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

function isExpired(event: StoredTimeEvent, now: Date): boolean {
  return now.getTime() - Date.parse(event.capturedAt) > UNSENT_TIME_EVENT_KEEP_MS;
}

function headStatus(head: StoredTimeEvent, now: Date): { status: UnsentEventStatus; code: string | null } {
  if (head.verdict?.outcome === 'rejected') return { status: 'failed', code: head.verdict.code };
  if (head.verdict?.code === 'correction_required') return { status: 'correction', code: head.verdict.code };
  if (head.verdict) return { status: 'conflict', code: head.verdict.code };
  return isExpired(head, now) ? { status: 'failed', code: 'expired' } : { status: 'pending', code: null };
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
    state: stopped || !clock ? null : outbox.events.reduce(applyUnsentEvent, clock.base),
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

/** The clock a phone keeps: without customer and project names, which no unsent event needs. */
function clockToKeep(holder: OutboxHolder, base: LiveClockState): StoredClock {
  const withoutNames = (job: LiveClockState['activeJobInfo']): LiveClockState['activeJobInfo'] =>
    job ? { ...job, clientName: null, projectName: null } : null;
  return {
    holder: todayHolderKey(holder),
    ...holder,
    base: {
      ...base,
      activeJobInfo: withoutNames(base.activeJobInfo),
      resumeJobInfo: withoutNames(base.resumeJobInfo),
    },
    // A clock saved without a readable signal is shown by no reader that knows no session.
    wipeGeneration: sharedWipeGeneration() ?? 'unreadable',
  };
}

type CaptureRefusal =
  /** The action needs the server's answer first: a recovery or a session of the older capture. */
  | 'needs_network'
  /** Earlier events wait for the person's decision; nothing new stands on them. */
  | 'chain_stopped';

export type CaptureResult =
  | { captured: true; outbox: TimeOutbox; deviceHoldsEvents: boolean }
  | { captured: false; reason: CaptureRefusal };

function isOfflineAction(action: string): action is StoredTimeEvent['action'] {
  return action === 'start' || action === 'switch' || action === 'end';
}

/**
 * Keeps one clock action on the device, at `capturedAt`. The first event of a chain stands on
 * `base`, the clock the server last confirmed, and expects the session and version the command
 * names. A later event stands on the event before it and learns its expectation from that
 * event's answer. Throws when the device storage fails, a full disk included.
 */
export async function captureTimeEvent(
  holder: OutboxHolder,
  capture: {
    command: OfflineClockCommand;
    base: LiveClockState | null;
    capturedAt: Date;
    triedOnline: boolean;
  },
): Promise<CaptureResult> {
  const { command, base } = capture;
  const { action } = command;
  if (!isOfflineAction(action)) return { captured: false, reason: 'needs_network' };
  let refusal: CaptureRefusal | null = null;
  const changed = await changeTimeOutbox(holder, (current) => {
    const last = current.events.at(-1);
    const event: StoredTimeEvent = {
      operationId: command.operationId,
      ...holder,
      sequence: (last?.sequence ?? 0) + 1,
      capturedAt: capture.capturedAt.toISOString(),
      action,
      selection: command.selection,
      expected: last ? null : { sessionId: command.expectedSessionId, version: command.expectedVersion },
      triedOnline: capture.triedOnline,
      verdict: null,
    };
    if (last) {
      // The device's own answer to a resend of this action: it is kept already.
      if (current.events.some((kept) => kept.operationId === command.operationId)) return null;
      if (clockDeviceView(current, capture.capturedAt)?.status === 'stopped') {
        refusal = 'chain_stopped';
        return null;
      }
      return { clock: current.clock, events: [...current.events, event] };
    }
    if (!base || base.legacyOpen || base.recoveryReason) {
      refusal = 'needs_network';
      return null;
    }
    return { clock: clockToKeep(holder, base), events: [event] };
  });
  return refusal ? { captured: false, reason: refusal } : { captured: true, ...changed };
}

/** The server's answer to the first event of the chain, as far as the device acts on it. */
export type HeadAnswer =
  | {
      kind: 'recorded';
      state: { sessionId: string | null; segmentId: string | null; version: number | null };
    }
  /** The online clock call that failed on the phone had reached the server: the action is recorded. */
  | { kind: 'recorded_online' }
  | { kind: 'stopped'; verdict: NonNullable<StoredTimeEvent['verdict']> };

/**
 * Applies the server's answer to the chain's first event, if `operationId` still is that event:
 * another tab may have applied the same answer already. A recorded event leaves, the clock moves
 * on by it and the next event learns what it expects, all in one transaction. A stopped event
 * stays with the server's answer.
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
    if (!next) return { clock: null, events: [] };
    const state = answer.kind === 'recorded' ? answer.state : null;
    return {
      clock: current.clock && {
        ...current.clock,
        base: applyTransitionEcho(
          current.clock.base,
          head.selection,
          {
            outcome: head.action === 'end' ? 'ended' : 'active',
            sessionId: state?.sessionId ?? null,
            segmentId: state?.segmentId ?? null,
            version: state?.version ?? null,
            recoveryReason: null,
          },
          new Date(head.capturedAt),
        ),
      },
      events: [
        {
          ...next,
          // After an end no session is open. An event recorded by its online call answered no state,
          // so the next one names none and the server decides.
          expected:
            state && head.action !== 'end'
              ? { sessionId: state.sessionId, version: state.version }
              : NO_SESSION,
        },
        ...rest,
      ],
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

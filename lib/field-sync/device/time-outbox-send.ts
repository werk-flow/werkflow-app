'use client';

import { z } from '@/lib/zod';
import { settleFirstTimeEvent, type HeadAnswer } from './time-outbox';
import { readTimeOutbox, type OutboxHolder, type StoredTimeEvent } from './time-outbox-store';

// Sends one person's unsent time events to `POST /api/field-sync/v1/operations`
// (decision record 0010): the first event of the chain, alone, and the next
// one only after the server recorded it, because each event names the session
// and version the one before it left. An event's envelope never changes
// between sends, so the server records it once whatever is resent.

const OPERATIONS_PATH = '/api/field-sync/v1/operations';
/** The operation kind of lib/field-sync/time-transition.ts. */
const TIME_TRANSITION_KIND = 'time.transition';

export type TimeOutboxSendOptions = {
  fetch: (url: string, init: RequestInit) => Promise<Response>;
  now: () => Date;
  /**
   * Whether the browser's session still is the holder's. The envelope names no person, so the
   * server would record a former user's event for whoever is signed in now.
   */
  sessionIsHolders: () => Promise<boolean>;
};

function envelopeOf(event: StoredTimeEvent, sentAt: Date): Record<string, unknown> {
  return {
    operationId: event.operationId,
    kind: TIME_TRANSITION_KIND,
    capturedAt: event.capturedAt,
    sentAt: sentAt.toISOString(),
    organizationId: event.organizationId,
    payload: {
      action: event.action,
      expectedSessionId: event.expected?.sessionId ?? null,
      expectedVersion: event.expected?.version ?? null,
      selection: event.selection,
      acknowledgeLong: false,
    },
  };
}

const verdictSchema = z.object({
  outcome: z.string(),
  code: z.string(),
  state: z
    .object({
      sessionId: z.string().nullable(),
      segmentId: z.string().nullable(),
      version: z.number().nullable(),
    })
    .optional(),
});
/** One event's result, or the verdict of a request the server refused as a whole. */
const answerSchema = z.union([
  z.object({ results: z.array(verdictSchema.extend({ operationId: z.string().nullable() })) }),
  verdictSchema,
]);

/**
 * What the device does with the server's answer for one event, or null to keep it pending: a
 * `retry`, a body that is no field sync answer (a captive portal's page, a cut-off response) and
 * an unknown outcome behind a 5xx status. Any other unknown outcome stops the event as refused, so
 * a newer server never makes this client drop it (decision record 0010, "Outcome classes").
 */
function answerOf(response: { status: number; body: unknown }, event: StoredTimeEvent): HeadAnswer | null {
  const parsed = answerSchema.safeParse(response.body);
  if (!parsed.success) return null;
  const own =
    'results' in parsed.data
      ? parsed.data.results.find((result) => result.operationId === event.operationId)
      : parsed.data;
  if (!own || own.outcome === 'retry') return null;
  const { outcome, code } = own;
  if (outcome === 'accepted' || outcome === 'replayed')
    return { kind: 'recorded', state: own.state ?? { sessionId: null, segmentId: null, version: null } };
  // The online clock call that failed on this phone used the same operation id without a captured
  // time. The server holding that id means it recorded the action then.
  if (code === 'idempotency_conflict' && event.triedOnline) return { kind: 'recorded_online' };
  if (outcome === 'conflict') return { kind: 'stopped', verdict: { outcome, code } };
  if (outcome === 'rejected' || response.status < 500)
    return { kind: 'stopped', verdict: { outcome: 'rejected', code } };
  return null;
}

async function sendEvent(event: StoredTimeEvent, options: TimeOutboxSendOptions): Promise<HeadAnswer | null> {
  let response: Response;
  try {
    response = await options.fetch(OPERATIONS_PATH, {
      method: 'POST',
      cache: 'no-store',
      credentials: 'same-origin',
      // The handler's same-origin guard for a cookie request.
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ operations: [envelopeOf(event, options.now())] }),
    });
  } catch {
    // best-effort: without signal the event stays pending for the next trigger.
    return null;
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    // best-effort: a body that is no JSON says nothing about the event; it stays pending.
    return null;
  }
  return answerOf({ status: response.status, body }, event);
}

/**
 * Sends the holder's chain from its first event until the server does not record one: without
 * signal, on a `retry`, or on an event that now waits for the person. Throws only when the device
 * storage fails. Callers serialize it (clock-device.ts): two passes at once would only resend.
 */
export async function sendTimeOutbox(holder: OutboxHolder, options: TimeOutboxSendOptions): Promise<void> {
  for (;;) {
    const [head] = (await readTimeOutbox(holder)).events;
    if (!head || head.verdict) return;
    // Checked before every send: the session can end, or change its person, between two events.
    if (!(await options.sessionIsHolders())) return;
    const answer = await sendEvent(head, options);
    if (!answer) return;
    await settleFirstTimeEvent(holder, head.operationId, answer);
    if (answer.kind === 'stopped') return;
  }
}

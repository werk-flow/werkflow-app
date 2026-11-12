'use client';

import { createSupabaseBrowserClient } from '@/lib/supabase/client';
import type { LiveClockState } from '@/lib/time-tracking/types';
import { takeInKeptClockActions } from './kept-clock-actions';
import {
  captureTimeEvent,
  clockDeviceView,
  removeTimeEvents,
  type ClockDeviceView,
  type TimeEventCapture,
} from './time-outbox';
import { sendTimeOutbox } from './time-outbox-send';
import { readTimeOutbox, readWholeTimeOutbox, type OutboxHolder } from './time-outbox-store';
import { TODAY_WIPE_KEY } from './today-wipe';
import { markUnsentWork } from './sync-runner';
import { KEPT_CLOCK_ACTION_PREFIX } from './unsent-mark';
import type { UnsentScope, UnsentSource } from './unsent-work';

// This tab's hold on the time outbox: whose unsent events it shows and sends.
// The holder comes from the page the server rendered for the signed-in person
// and the active organization. A sign-out or organization switch in another
// tab ends it (the wipe signal of today-wipe.ts): this tab then captures and
// sends nothing more until it loads again, because its page no longer says
// who is signed in. Before every send the browser's session must still be the
// holder's (time-outbox-send.ts).

/** Changes with every change to the outbox, so the other tabs of the origin read it again. */
const OUTBOX_CHANGED_KEY = 'werkflow:time-outbox-changed';
const SEND_LOCK = 'werkflow-time-outbox';
const TAKE_IN_LOCK = 'werkflow-kept-clock-actions';
const UNSENT_KIND = 'time';

/** Hears what the outbox holds for this tab's holder; `holdEnded` when another tab's wipe ended the hold. */
export type ViewListener = (view: ClockDeviceView | null, holdEnded?: boolean) => void;

let holder: OutboxHolder | null = null;
let dropped = false;
const listeners = new Set<ViewListener>();

/** The person and organization this tab captures and sends for, or null after another tab's wipe. */
export function clockHolder(): OutboxHolder | null {
  return dropped ? null : holder;
}

/** What the outbox holds for this tab's holder, told to every listener. */
async function publish(): Promise<void> {
  const current = clockHolder();
  // A hold another tab's wipe ended was told so once; it hears nothing after.
  if (!current) return;
  const view = clockDeviceView(await readTimeOutbox(current), new Date());
  // A wipe or another holder while the device read: this answer is the former holder's, never shown.
  if (clockHolder() !== current) return;
  for (const listener of listeners) listener(view);
}

/** Sets the start-up hint for time events before a kept action's key goes (kept-clock-actions.ts). */
function markTimeHeld(): void {
  markUnsentWork(UNSENT_KIND, true);
}

/**
 * Tells this tab's listeners and the origin's other tabs that the outbox changed, and keeps the
 * start-up hint in step with it: set while the device holds any person's event.
 */
export async function outboxChanged(): Promise<void> {
  const { events } = await readWholeTimeOutbox();
  markUnsentWork(UNSENT_KIND, events.length > 0);
  try {
    localStorage.setItem(OUTBOX_CHANGED_KEY, String(Date.now()));
  } catch {
    // best-effort: another tab then shows the change with its next read.
  }
  await publish();
}

function onStorage(event: StorageEvent): void {
  // Another tab's wipe, or its `localStorage.clear()` (no key), which took the signal with it.
  if (event.key === TODAY_WIPE_KEY || event.key === null) {
    dropped = true;
    for (const listener of listeners) listener(null, true);
    return;
  }
  // eslint-disable-next-line no-restricted-syntax -- a failed read here is shown by the next action's own read; a storage event has no caller to tell
  if (event.key === OUTBOX_CHANGED_KEY) void publish().catch(() => undefined);
  // Another tab's page kept an action without signal: the next pass of this tab sends it too.
  // eslint-disable-next-line no-restricted-syntax -- as above; the action stays kept and the next start takes it in
  if (event.key?.startsWith(KEPT_CLOCK_ACTION_PREFIX)) void takeInAndSend().catch(() => undefined);
}

/** Takes in what other tabs kept and sends it: the tab that kept it may close before it sends. */
async function takeInAndSend(): Promise<void> {
  const { moved } = await takeInKept();
  if (moved > 0) await sendOwnTimeEvents();
}

/**
 * Moves the clock actions pages kept without signal into the outbox and shows them. One tab at a
 * time: a second tab that took in the same list after the first one already sent an event would
 * put that event back with the expectation of the page that kept it, not of the answer before it.
 */
export async function takeInKept(): Promise<{ moved: number; unreadable: number }> {
  let taken = { moved: 0, unreadable: 0 };
  await exclusively(TAKE_IN_LOCK, async () => {
    taken = await takeInKeptClockActions(markTimeHeld);
  });
  if (taken.moved > 0) await outboxChanged();
  return taken;
}

/**
 * Deletes the events `operationIds` names once no send is in flight: a send that already left
 * finishes first, so the server never records an event the person was told is gone.
 */
export async function removeShownTimeEvents(
  holder: OutboxHolder,
  operationIds: readonly string[],
  resume: LiveClockState | null,
): ReturnType<typeof removeTimeEvents> {
  return exclusively(SEND_LOCK, () => removeTimeEvents(holder, operationIds, resume));
}

/**
 * Keeps one clock action of the page without signal behind every action other tabs kept before it:
 * those are taken in first, under the same lock, so an earlier tap never ends up behind a later one.
 * Throws when the device storage fails.
 */
export async function captureBehindKept(holder: OutboxHolder, capture: TimeEventCapture): Promise<void> {
  await exclusively(TAKE_IN_LOCK, async () => {
    await takeInKeptClockActions(markTimeHeld);
    await captureTimeEvent(holder, capture, { underSignal: true });
  });
  await outboxChanged();
}

/**
 * Makes `next` this tab's holder and tells `listener` what the outbox holds for it, now and after
 * every change. Returns the call that ends the listening. Throws when the device storage fails.
 */
export async function holdClock(next: OutboxHolder, listener: ViewListener): Promise<() => void> {
  if (listeners.size === 0) window.addEventListener('storage', onStorage);
  holder = next;
  listeners.add(listener);
  await takeInKept();
  await publish();
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) window.removeEventListener('storage', onStorage);
  };
}

/**
 * The person of the browser's session, or null when nobody is signed in. Throws when the session
 * cannot be read: whoever asks then knows nothing, and neither sends nor ends a session over it.
 */
async function readSession(): Promise<{ userId: string; token: string } | null> {
  const { data, error } = await createSupabaseBrowserClient().auth.getSession();
  if (error) throw error;
  return data.session ? { userId: data.session.user.id, token: data.session.access_token } : null;
}

async function sessionUserId(): Promise<string | null> {
  return (await readSession())?.userId ?? null;
}

/** Runs `work` while no other tab of the origin holds `lock`; a browser without Web Locks relies on the server recording each event once. */
async function exclusively<T>(lock: string, work: () => Promise<T>): Promise<T> {
  if (typeof navigator.locks?.request === 'function') return navigator.locks.request(lock, work);
  return work();
}

/**
 * The chains this tab sends: its holder's, or, on a page without one (a password reset, the
 * invite error, a tab whose hold another tab's wipe ended), the session person's in each of their
 * organizations. The server accepts only the active organization's; the others stay pending.
 */
async function holdersToSend(): Promise<OutboxHolder[]> {
  const current = clockHolder();
  if (current) return [current];
  const userId = await sessionUserId();
  if (!userId) return [];
  return (await ownOrganizations(userId)).map((organizationId) => ({ userId, organizationId }));
}

/** Sends the unsent events of this tab's holder, or of the session's person, as far as the server records them now. */
export async function sendOwnTimeEvents(): Promise<void> {
  await takeInKept();
  const hold = clockHolder();
  for (const holder of await holdersToSend())
    await exclusively(SEND_LOCK, () =>
      sendTimeOutbox(holder, {
        fetch: (url, init) => fetch(url, init),
        now: () => new Date(),
        // Checked before every send: the hold and the session can change between two events.
        holdersToken: async () => {
          const session = clockHolder() === hold ? await readSession() : null;
          return session?.userId === holder.userId ? session.token : null;
        },
      }),
    );
  await outboxChanged();
}

/** The person whose unsent events a sign-out or switch asks about: this tab's holder, else the session's. */
async function signedInUserId(): Promise<string | null> {
  return clockHolder()?.userId ?? (await sessionUserId());
}

async function ownOrganizations(userId: string): Promise<string[]> {
  const { events } = await readWholeTimeOutbox();
  return [...new Set(events.filter((event) => event.userId === userId).map((event) => event.organizationId))];
}

/**
 * The holders whose events a flow asks about: the signed-in person's in every organization for a
 * sign-out, only this tab's holder for a switch, which leaves just the active organization. Without
 * a hold a switch asks as a sign-out does.
 */
async function holdersInScope(scope: UnsentScope = 'session'): Promise<OutboxHolder[]> {
  const current = clockHolder();
  if (scope === 'organization' && current) return [current];
  const userId = await signedInUserId();
  if (!userId) return [];
  return (await ownOrganizations(userId)).map((organizationId) => ({ userId, organizationId }));
}

/**
 * The time events as unsent work (unsent-work.ts). Only the active organization's can be sent; a
 * sign-out still names and discards the person's events of every organization, because it ends them
 * all, and a switch only the organization it leaves.
 */
export const timeUnsentSource: UnsentSource = {
  name: UNSENT_KIND,
  async summarize(scope) {
    // A kept action this version cannot read may be anyone's: no session ends over it unseen.
    const { unreadable } = await takeInKept();
    if (unreadable > 0) throw new Error(`${unreadable} kept clock actions cannot be read by this version`);
    const ids: string[] = [];
    for (const holder of await holdersInScope(scope))
      ids.push(...(await readTimeOutbox(holder)).events.map((event) => event.operationId));
    return ids.length > 0 ? [{ label: 'Stempelzeiten', count: ids.length, ids }] : [];
  },
  flush: sendOwnTimeEvents,
  async discard(scope, ids) {
    await takeInKept();
    // The session ends: no server state to go on from, and what stays is asked about again.
    for (const holder of await holdersInScope(scope)) await removeShownTimeEvents(holder, ids, null);
    await outboxChanged();
  },
};

'use client';

import { createSupabaseBrowserClient } from '@/lib/supabase/client';
import { clockDeviceView, discardTimeEvents, type ClockDeviceView } from './time-outbox';
import { sendTimeOutbox } from './time-outbox-send';
import { readTimeOutbox, readWholeTimeOutbox, type OutboxHolder } from './time-outbox-store';
import { TODAY_WIPE_KEY } from './today-wipe';
import { markUnsentWork } from './unsent-mark';
import type { UnsentSource } from './unsent-work';

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
const UNSENT_KIND = 'time';

type ViewListener = (view: ClockDeviceView | null) => void;

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
  const view = current ? clockDeviceView(await readTimeOutbox(current), new Date()) : null;
  for (const listener of listeners) listener(view);
}

/** Tells this tab's listeners and the origin's other tabs that the outbox changed. */
export async function outboxChanged(deviceHoldsEvents: boolean): Promise<void> {
  markUnsentWork(UNSENT_KIND, deviceHoldsEvents);
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
    for (const listener of listeners) listener(null);
    return;
  }
  // eslint-disable-next-line no-restricted-syntax -- a failed read here is shown by the next action's own read; a storage event has no caller to tell
  if (event.key === OUTBOX_CHANGED_KEY) void publish().catch(() => undefined);
}

/**
 * Makes `next` this tab's holder and tells `listener` what the outbox holds for it, now and after
 * every change. Returns the call that ends the listening. Throws when the device storage fails.
 */
export async function holdClock(next: OutboxHolder, listener: ViewListener): Promise<() => void> {
  if (listeners.size === 0) window.addEventListener('storage', onStorage);
  holder = next;
  listeners.add(listener);
  await publish();
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) window.removeEventListener('storage', onStorage);
  };
}

async function sessionUserId(): Promise<string | null> {
  const { data } = await createSupabaseBrowserClient().auth.getSession();
  return data.session?.user.id ?? null;
}

/** Runs `send` while no other tab of the origin sends; a browser without Web Locks relies on the server recording each event once. */
function exclusively(send: () => Promise<void>): Promise<void> {
  return typeof navigator.locks?.request === 'function' ? navigator.locks.request(SEND_LOCK, send) : send();
}

/** Sends this tab's holder's unsent events, as far as the server records them now. */
export async function sendOwnTimeEvents(): Promise<void> {
  const current = clockHolder();
  if (!current) return;
  await exclusively(() =>
    sendTimeOutbox(current, {
      fetch: (url, init) => fetch(url, init),
      now: () => new Date(),
      sessionIsHolders: async () => clockHolder() === current && (await sessionUserId()) === current.userId,
    }),
  );
  const { events } = await readWholeTimeOutbox();
  await outboxChanged(events.length > 0);
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
 * The time events as unsent work (unsent-work.ts): the signed-in person's own, in every
 * organization, because a sign-out ends them all. Only the active organization's can be sent.
 */
export const timeUnsentSource: UnsentSource = {
  name: UNSENT_KIND,
  async summarize() {
    const userId = await signedInUserId();
    const { events } = await readWholeTimeOutbox();
    const count = events.filter((event) => event.userId === userId).length;
    return count > 0 ? [{ label: 'Stempelzeiten', count }] : [];
  },
  flush: sendOwnTimeEvents,
  async discard() {
    const userId = await signedInUserId();
    if (!userId) return;
    for (const organizationId of await ownOrganizations(userId))
      await discardTimeEvents({ userId, organizationId });
    const { events } = await readWholeTimeOutbox();
    await outboxChanged(events.length > 0);
  },
};

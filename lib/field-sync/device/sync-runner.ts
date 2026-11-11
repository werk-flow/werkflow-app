'use client';

import { logError } from '@/lib/logging';

// Sends what a phone recorded without signal (decision record 0010, "Sync
// triggers"): on app start, on `online` and on „Jetzt senden“. A return to
// the visible app is the Realtime provider's catch-up alone (client freshness
// contract rule 2), so it is no trigger here. There is no background sync and
// no polling. Each kind of unsent work registers one sender; a pass runs them
// in the order they registered, one after the other, because a report can
// depend on the time event before it.

type Sender = { name: string; send: () => Promise<void> };

const senders: Sender[] = [];
let pass: Promise<void> | null = null;
let again = false;
let listening = false;

/**
 * Registers the sender of one kind of unsent work. `send` sends everything it
 * can now and resolves when it is done; what the server did not answer stays
 * with the sender for the next pass. A second registration under the same
 * name replaces the first.
 */
export function registerSender(name: string, send: () => Promise<void>): void {
  const known = senders.findIndex((sender) => sender.name === name);
  if (known === -1) senders.push({ name, send });
  else senders[known] = { name, send };
}

async function runSenders(): Promise<void> {
  do {
    again = false;
    for (const sender of [...senders]) {
      try {
        await sender.send();
      } catch (error) {
        // One sender's failure never keeps the next from sending; its own work stays unsent and visible.
        logError('sync runner: sender failed', { sender: sender.name, error });
      }
    }
  } while (again);
}

/**
 * One pass over every sender. A call during a pass asks for one more pass
 * after it and resolves when that one ended, so work queued meanwhile is
 * never left for the next trigger.
 */
export function runSync(): Promise<void> {
  if (pass) {
    again = true;
    return pass;
  }
  pass = runSenders().finally(() => {
    pass = null;
  });
  return pass;
}

/** Sends now, the app start, and again on every `online`. Later calls only send now. */
export function startSyncRunner(): Promise<void> {
  if (!listening) {
    listening = true;
    window.addEventListener('online', () => void runSync());
  }
  return runSync();
}

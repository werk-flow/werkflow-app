import { isDeepStrictEqual } from 'node:util';
import { expect, type Locator, type Page } from '@playwright/test';
import { assertWorkspaceTestLock } from '@/lib/testing/runner/workspace-test-lock';
import type { LiveClockState } from '@/lib/time-tracking/types';
import { z } from '@/lib/zod';
import { clockStatus } from '../golden/support/steps/time-tracking';
import { RUNNING_CLOCK_STATE } from './clock-state-fixture';

// What the clock's unsent-event contracts share (clock-unsent*.spec.ts): the clock as the page
// mounts it, the server route that records every envelope and its answer, and the device's rows.

declare global {
  interface Window {
    contractOnline: boolean;
    /** Lets the device store held back by `holdDeviceStore` answer. */
    releaseDeviceStore?: () => void;
  }
}

export const CLOCKED_OUT_STATE: LiveClockState = {
  ...RUNNING_CLOCK_STATE,
  status: 'clocked_out',
  isClockedIn: false,
  clockInTime: null,
  statusStartedAt: null,
  captureModel: 'none',
  sessionId: null,
  sessionVersion: null,
  currentSegmentId: null,
  currentActivity: null,
  resumeActivity: null,
};

const envelopeSchema = z.object({
  operationId: z.string(),
  kind: z.string(),
  capturedAt: z.string(),
  sentAt: z.string(),
  organizationId: z.string(),
  // Every other payload field is kept too: a resend must carry the whole first envelope.
  payload: z
    .object({
      action: z.string(),
      expectedSessionId: z.string().nullable(),
      expectedVersion: z.number().nullable(),
    })
    .loose(),
});
export type Envelope = z.infer<typeof envelopeSchema>;
export type Verdict = {
  outcome: string;
  code: string;
  state?: { sessionId: string; segmentId: null; version: number };
};

/** The server's side of the contract: the clock it answers, the envelopes it got, and its verdict. */
export type Server = {
  state: LiveClockState;
  sent: Envelope[];
  /** The bearer token of each send: the person the server records for. */
  authorization: string[];
  verdict: Verdict;
  status: number;
  online: boolean;
  /** The clock read fails, as a server error does. */
  stateFails?: boolean;
  /** A send that never answers, as in a dead spot where the phone still reports a connection. */
  stalls?: boolean;
};

export const ACCEPTED: Verdict = {
  outcome: 'accepted',
  code: 'accepted',
  state: { sessionId: '20000000-0000-4000-8000-000000000009', segmentId: null, version: 1 },
};

export async function mountClock(
  page: Page,
  initial: LiveClockState,
  prepare: () => void = () => undefined,
  verdict: Verdict = ACCEPTED,
  /** The clock's readiness once mounted: not ready while what the device holds is unknown. */
  readiness: RegExp = /^Bereit/,
): Promise<Server> {
  assertWorkspaceTestLock();
  const bundle = process.env.WERKFLOW_UI_CONTRACT_BUNDLE;
  if (!bundle) throw new Error('Run through bun tests/ui-contracts/run.ts.');
  const server: Server = {
    state: initial,
    sent: [],
    authorization: [],
    verdict,
    status: 200,
    online: true,
  };
  await page.route('http://localhost/ui-contracts**', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<html lang="de"><body><div id="root"></div></body></html>',
    }),
  );
  await page.route('**/api/time-tracking-state?**', (route) =>
    server.stateFails
      ? route.fulfill({ status: 500, json: { success: false, error: 'unavailable' } })
      : route.fulfill({ json: { success: true, state: server.state } }),
  );
  // The ledger records an operation once (decision record 0010): a resend of an accepted one answers its
  // first state, and the same id with another envelope is an idempotency conflict.
  const accepted = new Map<string, { envelope: Envelope; verdict: Verdict }>();
  const answerOnce = (envelope: Envelope): Verdict & { operationId: string } => {
    const { operationId } = envelope;
    const first = accepted.get(operationId);
    if (first && !isDeepStrictEqual(withoutSentAt(envelope), withoutSentAt(first.envelope)))
      return { outcome: 'rejected', code: 'idempotency_conflict', operationId };
    if (first) return { ...first.verdict, outcome: 'replayed', code: 'replayed', operationId };
    const verdict = server.verdict;
    if (verdict.outcome === 'accepted') accepted.set(operationId, { envelope, verdict });
    return { ...verdict, operationId };
  };
  await page.route('**/api/field-sync/v1/operations', async (route) => {
    // Without network a send never arrives, whatever the page believes about its connection.
    if (!server.online) {
      await route.abort('internetdisconnected');
      return;
    }
    if (server.stalls) return;
    const body = z.object({ operations: z.array(envelopeSchema) }).parse(route.request().postDataJSON());
    server.sent.push(...body.operations);
    server.authorization.push(route.request().headers()['authorization'] ?? '');
    await route.fulfill({
      status: server.status,
      json: { results: body.operations.map(answerOnce) },
    });
  });
  await page.goto('http://localhost/ui-contracts');
  await page.evaluate(() => {
    window.uiContractFixture = 'clock';
    window.clockContract = { transitions: [], directResult: null, resolveTransition: null };
    // The phone's network, as the page reads it: the contract turns it off and on.
    window.contractOnline = true;
    Object.defineProperty(navigator, 'onLine', { get: () => window.contractOnline });
  });
  // What the device holds before the app starts.
  await page.evaluate(prepare);
  await page.addScriptTag({ path: bundle });
  await expect(page.getByLabel('Zeitstatus')).toHaveText(readiness);
  return server;
}

export async function setNetwork(page: Page, server: Server, online: boolean): Promise<void> {
  server.online = online;
  await page.evaluate((next) => {
    window.contractOnline = next;
    if (next) window.dispatchEvent(new Event('online'));
  }, online);
}

const deviceRowSchema = z.object({
  userId: z.string(),
  action: z.string(),
  operationId: z.string(),
  sequence: z.number().optional(),
});

/** What the device holds unsent: the outbox's events in their order, then the actions pages kept. */
export async function unsentOnDevice(
  page: Page,
): Promise<{ userId: string; action: string; operationId: string }[]> {
  const stored = await page.evaluate(async () => {
    const names = (await indexedDB.databases()).map((info) => info.name);
    let events: unknown[] = [];
    if (names.includes('werkflow-time-outbox')) {
      const database = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open('werkflow-time-outbox');
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      events = await new Promise<unknown[]>((resolve, reject) => {
        const request = database.transaction('events').objectStore('events').getAll();
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      database.close();
    }
    const kept = Array.from({ length: localStorage.length }, (_, index) => localStorage.key(index) ?? '')
      .filter((key) => key.startsWith('werkflow:unsent:clock:'))
      .toSorted()
      .map((key): unknown => JSON.parse(localStorage.getItem(key) ?? 'null'));
    return { events, kept };
  });
  const events = z.array(deviceRowSchema).parse(stored.events);
  const kept = z.array(deviceRowSchema).parse(stored.kept);
  return [...events.toSorted((left, right) => (left.sequence ?? 0) - (right.sequence ?? 0)), ...kept].map(
    ({ userId, action, operationId }) => ({ userId, action, operationId }),
  );
}

export function unsentBadge(scope: Page | Locator): Locator {
  return scope.locator('[data-clock-unsent]');
}

export function unsentSection(page: Page): Locator {
  return page.getByRole('region', { name: 'Noch nicht übertragen', exact: true });
}

/** A clock start without network, from the stopped clock's sheet. */
export async function startWithoutNetwork(page: Page, server: Server): Promise<void> {
  await setNetwork(page, server, false);
  await page.getByRole('button', { name: 'Zeiterfassung starten', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Arbeit starten', exact: true }).click();
  await expect(clockStatus(page)).toHaveText('Arbeit');
}

/**
 * Before the app starts: an earlier visit left the hint that the device may hold unsent work (it may
 * be a report draft or another person's time), and the device store holds every answer back until
 * `window.releaseDeviceStore()`. Runs in the page.
 */
export function holdDeviceStore(): void {
  localStorage.setItem('werkflow:unsent:time', '1');
  const factory = indexedDB;
  let release = (): void => undefined;
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  window.releaseDeviceStore = () => release();
  type Handler = ((event: Event) => void) | null;
  const open = (name: string, version?: number) => {
    let answered: IDBOpenDBRequest | null = null;
    const held: { onupgradeneeded: Handler; onsuccess: Handler; onerror: Handler; onblocked: Handler } & {
      readonly result: IDBDatabase | undefined;
      readonly error: DOMException | null | undefined;
    } = {
      onupgradeneeded: null,
      onsuccess: null,
      onerror: null,
      onblocked: null,
      get result() {
        return answered?.result;
      },
      get error() {
        return answered?.error;
      },
    };
    void released.then(() => {
      const request = factory.open(name, version);
      answered = request;
      request.onupgradeneeded = (event) => held.onupgradeneeded?.(event);
      request.onsuccess = (event) => held.onsuccess?.(event);
      request.onerror = (event) => held.onerror?.(event);
      request.onblocked = (event) => held.onblocked?.(event);
    });
    return held;
  };
  Object.defineProperty(window, 'indexedDB', {
    value: {
      open,
      databases: () => factory.databases(),
      deleteDatabase: (name: string) => factory.deleteDatabase(name),
      cmp: (left: unknown, right: unknown) => factory.cmp(left, right),
    },
  });
}

export function withoutSentAt(envelope: Envelope | undefined): Envelope | undefined {
  return envelope && { ...envelope, sentAt: '' };
}

/**
 * What the server recorded: each operation id once, as it first arrived. A send in flight when
 * `online` fires is ended and sent again (decision record 0010, "the network's return ends a send
 * that hangs"); one that had reached the server arrives twice and is recorded once. A second
 * arrival must be the same envelope.
 */
export function recorded(server: Server): Envelope[] {
  const first = new Map<string, Envelope>();
  for (const envelope of server.sent) {
    const earlier = first.get(envelope.operationId);
    if (earlier) expect(withoutSentAt(envelope)).toEqual(withoutSentAt(earlier));
    else first.set(envelope.operationId, envelope);
  }
  return [...first.values()];
}

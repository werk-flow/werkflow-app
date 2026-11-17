import { expect, test, type Page } from '@playwright/test';
import type { StoredToday } from '@/lib/field-sync/device/today-store';
import type { LiveClockState } from '@/lib/time-tracking/types';
import { assertWorkspaceTestLock } from '@/lib/testing/runner/workspace-test-lock';
import { RUNNING_CLOCK_STATE } from './clock-state-fixture';

// A field worker's start page shows today and nothing else: the Einsätze of
// the phone's stored day, the clock with today's working time, and the own
// open Aufgaben. It reads the day only through E7's seam, never keeps a copy,
// and never shows an empty day it could not read.

const MAIN = (page: Page) => page.getByRole('main');

const EMPTY_DAY: StoredToday = {
  snapshot: {
    version: 'v1',
    berlinDate: '2026-11-17',
    validUntil: '2999-01-01T00:00:00.000Z',
    userId: '9b000000-0000-4000-8000-000000000001',
    organizationId: '9b000000-0000-4000-8000-0000000000a1',
    assignments: [],
  },
  confirmedAt: '2026-11-17T06:42:00.000Z',
  wipeGeneration: '',
};

const INSTRUCTION = {
  groupLabel: null,
  notes: null,
  required: true,
};

const TWO_EINSAETZE: StoredToday = {
  ...EMPTY_DAY,
  snapshot: {
    ...EMPTY_DAY.snapshot,
    assignments: [
      {
        jobId: '9b000000-0000-4000-8000-000000000021',
        jobNumber: 'AUF-2026-21',
        title: 'Heizung tauschen',
        requestedOutcome: null,
        plannedWorkingMinutes: null,
        visits: [{ startAt: '2026-11-17T07:00:00.000Z', endAt: '2026-11-17T09:30:00.000Z' }],
        customerName: 'Hausverwaltung Lindenhof GmbH',
        customerPhone: null,
        siteName: 'Lindenhof Haus 2',
        siteAddress: 'Lindenstraße 4, 70173 Stuttgart',
        accessNotes: null,
        contactName: null,
        contactRole: null,
        contactPhone: null,
        project: null,
        instructions: [
          {
            ...INSTRUCTION,
            id: '9b000000-0000-4000-8000-000000000031',
            content: 'Alte Therme abbauen',
            done: true,
          },
          {
            ...INSTRUCTION,
            id: '9b000000-0000-4000-8000-000000000032',
            content: 'Neue Therme setzen',
            done: false,
          },
        ],
      },
      {
        jobId: '9b000000-0000-4000-8000-000000000022',
        jobNumber: 'AUF-2026-22',
        title: 'Wartung Gastherme',
        requestedOutcome: null,
        plannedWorkingMinutes: null,
        visits: [{ startAt: null, endAt: null }],
        customerName: 'Erika Musterfrau',
        customerPhone: null,
        siteName: 'Wohnung Musterfrau',
        siteAddress: null,
        accessNotes: null,
        contactName: null,
        contactRole: null,
        contactPhone: null,
        project: { name: 'Sanierung Musterweg', projectNumber: 'PRJ-2026-3' },
        instructions: [
          { ...INSTRUCTION, id: '9b000000-0000-4000-8000-000000000033', content: 'Abgas messen', done: true },
        ],
      },
    ],
  },
};

const STOPPED_CLOCK: LiveClockState = {
  ...RUNNING_CLOCK_STATE,
  status: 'clocked_out',
  isClockedIn: false,
  statusStartedAt: null,
  clockInTime: null,
  currentActivity: null,
  resumeActivity: null,
  todayMinutes: 452,
  workMinutes: 452,
};

test.beforeEach(async ({ page }) => {
  assertWorkspaceTestLock();
  const bundle = process.env.WERKFLOW_UI_CONTRACT_BUNDLE;
  if (!bundle) throw new Error('Run through bun tests/ui-contracts/run.ts.');
  await page.route('http://localhost/ui-contracts**', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<html lang="de"><body><div id="root"></div></body></html>',
    }),
  );
  await page.goto('http://localhost/ui-contracts');
  await page.evaluate(() => {
    window.uiContractFixture = 'worker-start';
  });
});

/** Mounts the start page over a device that answers `device` to its reads. */
async function openStart(
  page: Page,
  device: { stored: StoredToday | null } | { fails: true },
): Promise<void> {
  await page.evaluate((answer) => {
    window.workerStartDevice = answer;
  }, device);
  await page.addScriptTag({ path: process.env.WERKFLOW_UI_CONTRACT_BUNDLE ?? '' });
}

const einsaetze = (page: Page) => MAIN(page).getByRole('list', { name: 'Deine Einsätze heute' });

/** Moves the browser's signal and tells the page, as the browser's own `online` and `offline` events do. */
async function setSignal(page: Page, online: boolean): Promise<void> {
  await page.evaluate((next) => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => next });
    window.dispatchEvent(new Event(next ? 'online' : 'offline'));
  }, online);
}

test('a day with two Einsätze shows each one’s time, customer, place and next step, opening its work pack', async ({
  page,
}) => {
  await openStart(page, { stored: TWO_EINSAETZE });
  const rows = einsaetze(page).getByRole('link');
  // In the snapshot's order: by start, all-day visits first.
  await expect(rows).toHaveText([/^08:00 Uhr/, /^Ganztägig/]);

  const first = rows.filter({ hasText: 'Heizung tauschen' });
  await expect(first).toContainText('08:00 Uhr');
  await expect(first).toContainText('Heizung tauschen');
  await expect(first).toContainText('Hausverwaltung Lindenhof GmbH · Lindenstraße 4, 70173 Stuttgart');
  // The next step is the first open instruction in the office's order.
  await expect(first).toContainText('Als Nächstes: Neue Therme setzen');
  await expect(first).toHaveAttribute('href', '/auftraege/AUF-2026-21');

  const second = rows.filter({ hasText: 'Wartung Gastherme' });
  await expect(second).toContainText('Ganztägig');
  await expect(second).toContainText('Erika Musterfrau · Wohnung Musterfrau');
  await expect(second).toContainText('Alle Anweisungen erledigt');
  await expect(second).toHaveAttribute('href', '/auftraege/projekt/PRJ-2026-3/AUF-2026-22');
  // Every clock action refreshes the start page; a prefetch in view would read each work pack again.
  await expect(first).toHaveAttribute('data-automatic-prefetch', 'false');
  await expect(MAIN(page).getByText(/Offline · Stand/)).toHaveCount(0);
});

test('an empty day says that nothing is planned today', async ({ page }) => {
  await openStart(page, { stored: EMPTY_DAY });
  await expect(MAIN(page).getByText('Keine Einsätze heute')).toBeVisible();
  await expect(MAIN(page).getByText('Heute ist nichts für dich geplant.')).toBeVisible();
});

test('without signal the stored day stays listed under „Offline · Stand“', async ({ page }) => {
  await openStart(page, { stored: TWO_EINSAETZE });
  await expect(einsaetze(page).getByRole('link')).toHaveCount(2);
  await setSignal(page, false);
  await expect(MAIN(page).getByRole('status')).toHaveText('Offline · Stand 07:42');
  await expect(einsaetze(page).getByRole('link')).toHaveCount(2);
  await setSignal(page, true);
  await expect(MAIN(page).getByText(/Offline · Stand/)).toHaveCount(0);
});

test('a day the phone did not store shows no list and no empty day, until a refresh saves one', async ({
  page,
}) => {
  await openStart(page, { stored: null });
  // The start page's refresh shows E7's banner when it cannot store the day; this page keeps no copy.
  await expect(MAIN(page).getByTestId('worker-start-einsaetze-loading')).toBeAttached();
  await expect(MAIN(page).getByText('Keine Einsätze heute')).toHaveCount(0);
  await expect(einsaetze(page)).toHaveCount(0);

  await page.evaluate((day) => window.workerStartContract.save(day), TWO_EINSAETZE);
  await expect(einsaetze(page).getByRole('link')).toHaveCount(2);
});

test('without signal and without a stored day the page says the day is not on the phone', async ({
  page,
}) => {
  await openStart(page, { stored: null });
  await setSignal(page, false);
  await expect(MAIN(page).getByText('Keine Einsätze auf diesem Gerät')).toBeVisible();
  await expect(MAIN(page).getByText('Keine Einsätze heute')).toHaveCount(0);
});

test('a device that cannot be read shows its failure with a retry, never an empty day', async ({ page }) => {
  await openStart(page, { fails: true });
  const failure = MAIN(page).getByRole('alert');
  await expect(failure).toContainText('Deine Einsätze von heute konnten nicht gelesen werden');
  await expect(MAIN(page).getByText('Keine Einsätze heute')).toHaveCount(0);

  await page.evaluate((day) => {
    window.workerStartContract.device = { stored: day };
  }, TWO_EINSAETZE);
  await failure.getByRole('button', { name: 'Erneut laden' }).click();
  await expect(einsaetze(page).getByRole('link')).toHaveCount(2);
});

test('a running clock shows what runs since when and today’s working time up to the clock’s state', async ({
  page,
}) => {
  await openStart(page, { stored: EMPTY_DAY });
  const clock = MAIN(page).getByTestId('worker-start-clock');
  await expect(clock).toHaveAttribute('href', '/zeiterfassung');
  await page.evaluate(
    (state) => window.workerStartContract.setClock({ state, isReady: true, statusError: null }),
    RUNNING_CLOCK_STATE,
  );
  // 30 recorded minutes and 30 running ones up to the state's 10:30.
  await expect(clock).toContainText('Du arbeitest gerade. Seit 10:00 Uhr.');
  await expect(clock).toContainText('Heute bis 10:30 Uhr gearbeitet: 1 Std.');
});

test('a stopped clock shows today’s working time, and an unreachable clock no false hours', async ({
  page,
}) => {
  await openStart(page, { stored: EMPTY_DAY });
  const clock = MAIN(page).getByTestId('worker-start-clock');
  await page.evaluate(
    (state) => window.workerStartContract.setClock({ state, isReady: true, statusError: null }),
    STOPPED_CLOCK,
  );
  await expect(clock).toContainText('Du bist nicht eingestempelt.');
  await expect(clock).toContainText('Heute gearbeitet: 7 Std. 32 Min.');

  await page.evaluate(() =>
    window.workerStartContract.setClock({ state: null, isReady: false, statusError: 'Netzwerkfehler' }),
  );
  await expect(clock).toContainText('Die Uhr ist gerade nicht erreichbar.');
  await expect(clock).not.toContainText('gearbeitet:');
});

test('the own open Aufgaben show their count and lead to the Aufgaben', async ({ page }) => {
  await openStart(page, { stored: EMPTY_DAY });
  const tasks = MAIN(page).getByTestId('worker-start-tasks');
  await expect(tasks).toHaveAttribute('href', '/aufgaben');
  await expect(tasks).toHaveText('Deine Aufgaben');
  await page.evaluate(() => window.workerStartContract.setActionableCount(3));
  await expect(tasks).toContainText('3 offen');
});

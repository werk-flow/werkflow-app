import { expect, type Page } from '@playwright/test';
import { test } from '@playwright/test';
import { z } from '@/lib/zod';
import { CLOCK_ORGANIZATION_ID, CLOCK_USER_ID } from './clock-state-fixture';
import { CLOCKED_OUT_STATE, mountClock, setNetwork, type Server } from './clock-unsent-support';

// The report drafts in the question every session end asks (werk-flow/werkflow-planning#403;
// decision record 0010, the amendment "a session end asks about report drafts"). The device holds
// the drafts in its real IndexedDB; the sync handler is the route below, which records every draft
// attach and accepts it.

const COLLEAGUE_ID = '10000000-0000-4000-8000-0000000000bb';
const DRAFT_ID = '60000000-0000-4000-8000-000000000001';
const updatedAt = '2026-11-12T08:30:00.000Z';

type DraftRecord = {
  id: string;
  userId?: string;
  title?: string;
  refusal?: { kind: 'no_access' | 'failed'; at: string } | null;
  version?: number;
};

/** Writes report drafts into the device's store, as a job page leaves them, with the device mark. */
async function storeDrafts(page: Page, drafts: readonly DraftRecord[]): Promise<void> {
  await page.evaluate(
    async ({ records, userId, organizationId, changedAt }) => {
      const database = await new Promise<IDBDatabase>((resolve, reject) => {
        const opening = indexedDB.open('werkflow-drafts', 1);
        opening.onupgradeneeded = () => opening.result.createObjectStore('drafts', { keyPath: 'id' });
        opening.onsuccess = () => resolve(opening.result);
        opening.onerror = () => reject(opening.error);
      });
      await new Promise<void>((resolve, reject) => {
        const transaction = database.transaction('drafts', 'readwrite');
        for (const record of records)
          transaction.objectStore('drafts').put({
            userId,
            organizationId,
            revisionId: `${record.id.slice(0, -1)}a`,
            operationId: `${record.id.slice(0, -1)}b`,
            jobId: '60000000-0000-4000-8000-0000000000f1',
            kind: 'work_report',
            visibility: 'internal_only',
            capturedAt: changedAt,
            title: 'Wartung Heizung',
            content: { performedWork: 'Brenner gereinigt, Druck geprüft.' },
            photos: [],
            ready: true,
            updatedAt: changedAt,
            sealed: false,
            refusal: null,
            version: 1,
            ...record,
          });
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
      });
      database.close();
      localStorage.setItem('werkflow:drafts-on-device', '1');
    },
    { records: drafts, userId: CLOCK_USER_ID, organizationId: CLOCK_ORGANIZATION_ID, changedAt: updatedAt },
  );
}

/** The ids of the drafts the device still holds. */
async function draftsOnDevice(page: Page): Promise<string[]> {
  const ids = await page.evaluate(async () => {
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      const opening = indexedDB.open('werkflow-drafts', 1);
      opening.onsuccess = () => resolve(opening.result);
      opening.onerror = () => reject(opening.error);
    });
    const keys = await new Promise<IDBValidKey[]>((resolve, reject) => {
      const request = database.transaction('drafts').objectStore('drafts').getAllKeys();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    database.close();
    return keys.map(String);
  });
  return ids.toSorted();
}

const draftAttachSchema = z.object({
  operations: z.array(z.object({ kind: z.literal('work_artifact.draft'), payload: z.object({ artifactId: z.string() }) })),
});

/** The handler's side for draft attaches: it records each and accepts it. Time events go to the clock's route. */
async function acceptDraftAttaches(page: Page, server: Server): Promise<string[]> {
  const attached: string[] = [];
  await page.route('**/api/field-sync/v1/operations', async (route) => {
    const draftAttach = draftAttachSchema.safeParse(route.request().postDataJSON());
    if (!draftAttach.success) {
      await route.fallback();
      return;
    }
    if (!server.online) {
      await route.abort('internetdisconnected');
      return;
    }
    attached.push(...draftAttach.data.operations.map((operation) => operation.payload.artifactId));
    await route.fulfill({ json: { results: [{ operationId: 'echo', outcome: 'accepted', code: 'accepted' }] } });
  });
  return attached;
}

function question(page: Page) {
  return page.getByRole('dialog', { name: 'Noch nicht übertragen', exact: true });
}

test('a sign-out names each unsent draft by its title, kind and last change, never its text, and „Abbrechen“ keeps it', async ({
  page,
}) => {
  const server = await mountClock(page, CLOCKED_OUT_STATE);
  await setNetwork(page, server, false);
  await storeDrafts(page, [{ id: DRAFT_ID }]);

  await page.getByRole('button', { name: 'Abmelden prüfen', exact: true }).click();

  const drafts = question(page).getByRole('list', { name: 'Berichtsentwürfe', exact: true });
  await expect(drafts.getByRole('listitem')).toHaveText(['Wartung HeizungArbeitsbericht · geändert 12.11.2026, 09:30']);
  await expect(question(page)).not.toContainText('Brenner gereinigt');
  await question(page).getByRole('button', { name: 'Abbrechen', exact: true }).click();
  await expect(page.getByLabel('Abmeldung')).toHaveText('Sitzung bleibt');
  expect(await draftsOnDevice(page)).toEqual([DRAFT_ID]);
});

test('„Jetzt senden“ sends the draft once there is signal, and the session may end without a second question', async ({
  page,
}) => {
  const server = await mountClock(page, CLOCKED_OUT_STATE);
  const attached = await acceptDraftAttaches(page, server);
  await setNetwork(page, server, false);
  await storeDrafts(page, [{ id: DRAFT_ID }]);

  await page.getByRole('button', { name: 'Abmelden prüfen', exact: true }).click();
  await expect(question(page)).toContainText('Noch nicht alles ist übertragen.');
  await setNetwork(page, server, true);
  await question(page).getByRole('button', { name: 'Jetzt senden', exact: true }).click();

  await expect(page.getByLabel('Abmeldung')).toHaveText('Sitzung darf enden');
  expect(attached).toEqual([DRAFT_ID]);
  expect(await draftsOnDevice(page)).toEqual([]);
});

test('a lost-access draft is named as such and never sent; an unreadable one is named as not readable; „Verwerfen“ deletes both', async ({
  page,
}) => {
  const server = await mountClock(page, CLOCKED_OUT_STATE);
  const attached = await acceptDraftAttaches(page, server);
  const noAccessId = '60000000-0000-4000-8000-000000000002';
  const unreadableId = '60000000-0000-4000-8000-000000000003';
  await storeDrafts(page, [
    { id: noAccessId, refusal: { kind: 'no_access', at: new Date().toISOString() } },
    { id: unreadableId, version: 99 },
  ]);

  await page.getByRole('button', { name: 'Abmelden prüfen', exact: true }).click();

  await expect(
    question(page).getByRole('list', { name: 'Berichtsentwürfe ohne Zugriff', exact: true }),
  ).toContainText('Kein Zugriff mehr, wird nicht gesendet');
  await expect(
    question(page).getByRole('list', {
      name: 'Berichtsentwürfe, die diese App-Version nicht lesen kann',
      exact: true,
    }),
  ).toHaveText('Entwurf lässt sich nicht öffnenNicht lesbar');
  await question(page).getByRole('button', { name: 'Jetzt senden', exact: true }).click();
  await expect(question(page)).toContainText('Noch nicht alles ist übertragen.');
  expect(attached).toEqual([]);

  await question(page).getByRole('button', { name: 'Verwerfen', exact: true }).click();
  const confirmation = page.getByRole('alertdialog', { name: 'Nicht Übertragenes verwerfen?' });
  await expect(confirmation).toContainText('Berichtsentwürfe ohne Zugriff: 1');
  await confirmation.getByRole('button', { name: 'Endgültig verwerfen', exact: true }).click();
  await expect(page.getByLabel('Abmeldung')).toHaveText('Sitzung darf enden');
  expect(await draftsOnDevice(page)).toEqual([]);
});

test('„Verwerfen“ deletes only the drafts the question showed: one written since stays and is asked about', async ({
  page,
}) => {
  const server = await mountClock(page, CLOCKED_OUT_STATE);
  await setNetwork(page, server, false);
  await storeDrafts(page, [{ id: DRAFT_ID }]);
  await page.getByRole('button', { name: 'Abmelden prüfen', exact: true }).click();
  await question(page).getByRole('button', { name: 'Verwerfen', exact: true }).click();

  // Another tab stores a draft while the question is open.
  const laterId = '60000000-0000-4000-8000-000000000004';
  await storeDrafts(page, [{ id: laterId, title: 'Nachtrag Keller' }]);
  const confirmation = page.getByRole('alertdialog', { name: 'Nicht Übertragenes verwerfen?' });
  await confirmation.getByRole('button', { name: 'Endgültig verwerfen', exact: true }).click();

  await expect(question(page)).toContainText('Seit deiner Frage ist noch etwas dazugekommen.');
  await expect(question(page).getByRole('list', { name: 'Berichtsentwürfe', exact: true })).toContainText(
    'Nachtrag Keller',
  );
  await expect(page.getByLabel('Abmeldung')).toHaveText('');
  expect(await draftsOnDevice(page)).toEqual([laterId]);
});

test('a sign-out is not asked about a colleague’s draft, which stays on the phone', async ({ page }) => {
  await mountClock(page, CLOCKED_OUT_STATE);
  await storeDrafts(page, [{ id: DRAFT_ID, userId: COLLEAGUE_ID }]);

  await page.getByRole('button', { name: 'Abmelden prüfen', exact: true }).click();

  await expect(page.getByLabel('Abmeldung')).toHaveText('Sitzung darf enden');
  await expect(question(page)).toHaveCount(0);
  expect(await draftsOnDevice(page)).toEqual([DRAFT_ID]);
});

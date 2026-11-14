import { expect, test, type Page } from '@playwright/test';
import { openContractFixture } from './open-fixture';

// A report draft refused for lost access is deleted 7 days later whoever
// uses the phone next (decision record 0010, the report draft amendment and
// "where the lost-access deletion runs"). Person A's drafts sit in the
// browser's real IndexedDB; person B lands on the sign-in page, or opens a
// job page as office staff who never opens a report dialog. Only A's expired
// draft goes; A's live draft stays as it was.

test.use({ viewport: { width: 375, height: 812 } });

const EXPIRED_ID = '9f000000-0000-4000-8000-000000000010';
const LIVE_ID = '9f000000-0000-4000-8000-000000000020';

/** Stores A's two drafts as the device store keeps them, and the device mark the store sets with them. */
async function storeDraftsOfA(page: Page): Promise<void> {
  await page.evaluate(
    async ({ expiredId, liveId }) => {
      const base = {
        userId: '9f000000-0000-4000-8000-000000000001',
        organizationId: '9f000000-0000-4000-8000-0000000000a1',
        jobId: '9f000000-0000-4000-8000-000000000030',
        kind: 'work_report',
        visibility: 'internal_only',
        capturedAt: '2026-10-01T07:00:00.000Z',
        title: 'Heizung gewartet',
        content: { performedWork: 'Brenner gereinigt' },
        ready: true,
        updatedAt: '2026-10-01T07:30:00.000Z',
        sealed: false,
      };
      const photo = (id: string) => ({
        id,
        name: 'foto-1.jpg',
        blob: new Blob(['synthetic photo'], { type: 'image/jpeg' }),
        transferred: null,
        documentId: null,
      });
      const lostAt = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString();
      const drafts = [
        {
          ...base,
          id: expiredId,
          revisionId: '9f000000-0000-4000-8000-000000000011',
          operationId: '9f000000-0000-4000-8000-000000000012',
          photos: [photo('9f000000-0000-4000-8000-000000000013')],
          refusal: { kind: 'no_access', at: lostAt },
        },
        {
          ...base,
          id: liveId,
          revisionId: '9f000000-0000-4000-8000-000000000021',
          operationId: '9f000000-0000-4000-8000-000000000022',
          photos: [photo('9f000000-0000-4000-8000-000000000023')],
          refusal: null,
        },
      ];
      const opening = indexedDB.open('werkflow-drafts', 1);
      opening.onupgradeneeded = () => opening.result.createObjectStore('drafts', { keyPath: 'id' });
      const database = await new Promise<IDBDatabase>((resolve, reject) => {
        opening.onsuccess = () => resolve(opening.result);
        opening.onerror = () => reject(opening.error);
      });
      const transaction = database.transaction('drafts', 'readwrite');
      for (const draft of drafts) transaction.objectStore('drafts').put(draft);
      await new Promise<void>((resolve, reject) => {
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
      });
      database.close();
      localStorage.setItem('werkflow:drafts-on-device', '1');
    },
    { expiredId: EXPIRED_ID, liveId: LIVE_ID },
  );
}

/** The ids and refusals of every draft the device holds, of any person. */
async function draftsOnDevice(page: Page): Promise<Array<{ id: string; refusal: unknown }>> {
  return page.evaluate(async () => {
    const opening = indexedDB.open('werkflow-drafts', 1);
    opening.onupgradeneeded = () => opening.result.createObjectStore('drafts', { keyPath: 'id' });
    const database = await new Promise<IDBDatabase>((resolve, reject) => {
      opening.onsuccess = () => resolve(opening.result);
      opening.onerror = () => reject(opening.error);
    });
    const reading = database.transaction('drafts').objectStore('drafts').getAll();
    const records = await new Promise<Array<{ id: string; refusal: unknown }>>((resolve, reject) => {
      reading.onsuccess = () => resolve(reading.result);
      reading.onerror = () => reject(reading.error);
    });
    database.close();
    return records
      .map(({ id, refusal }) => ({ id, refusal }))
      .sort((left, right) => left.id.localeCompare(right.id));
  });
}

const ONLY_THE_LIVE_DRAFT = [{ id: LIVE_ID, refusal: null }];

test("person B's sign-in page deletes A's lost-access draft past seven days and leaves A's live draft", async ({
  page,
}) => {
  await openContractFixture(page, 'draft-landing');
  await storeDraftsOfA(page);
  // B lands on the sign-in page: the `(auth)` layout mounts again.
  await openContractFixture(page, 'draft-landing');
  await expect.poll(() => draftsOnDevice(page)).toEqual(ONLY_THE_LIVE_DRAFT);
  expect(await page.evaluate(() => localStorage.getItem('werkflow:drafts-on-device'))).toBe('1');
});

test("an office person's job page, without opening a report, deletes A's lost-access draft past seven days", async ({
  page,
}) => {
  await page.addInitScript(() => {
    window.uiContractWorkArtifactViewer = 'admin';
  });
  await openContractFixture(page, 'draft-landing');
  await storeDraftsOfA(page);
  await openContractFixture(page, 'work-artifact-customer-decision');
  await expect(page.getByRole('button', { name: /Wartung Heizung/ })).toBeVisible();
  await expect.poll(() => draftsOnDevice(page)).toEqual(ONLY_THE_LIVE_DRAFT);
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

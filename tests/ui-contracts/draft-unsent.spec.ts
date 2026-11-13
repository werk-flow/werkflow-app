import { expect, type Page } from '@playwright/test';
import { test } from '@playwright/test';
import { z } from '@/lib/zod';
import { CLOCK_ORGANIZATION_ID, CLOCK_USER_ID } from './clock-state-fixture';
import {
  CLOCKED_OUT_STATE,
  mountClock,
  setNetwork,
  startWithoutNetwork,
  unsentOnDevice,
  type Server,
} from './clock-unsent-support';

// The report drafts in the question every session end asks (werk-flow/werkflow-planning#403;
// decision record 0010, the amendment "a session end asks about report drafts"). The device holds
// the drafts in its real IndexedDB; the sync handler is the route below, which records every draft
// attach and accepts it.

const COLLEAGUE_ID = '10000000-0000-4000-8000-0000000000bb';
const DRAFT_ID = '60000000-0000-4000-8000-000000000001';
const updatedAt = '2026-11-12T08:30:00.000Z';

/** Fixes the page's date on the drafts' day, timers still running: a week on, they count as old. */
async function onDraftsDay(page: Page): Promise<void> {
  await page.clock.setFixedTime(new Date('2026-11-12T09:00:00.000Z'));
}

type DraftRecord = {
  id: string;
  ready?: boolean;
  userId?: string;
  title?: string;
  refusal?: { kind: 'no_access' | 'failed'; at: string } | null;
  sealed?: boolean;
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
  operations: z.array(
    z.object({ kind: z.literal('work_artifact.draft'), payload: z.object({ artifactId: z.string() }) }),
  ),
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
    await route.fulfill({
      json: { results: [{ operationId: 'echo', outcome: 'accepted', code: 'accepted' }] },
    });
  });
  return attached;
}

function question(page: Page) {
  return page.getByRole('dialog', { name: 'Noch nicht übertragen', exact: true });
}

test('a sign-out names each unsent draft by its title, kind and last change, never its text, and „Abbrechen“ keeps it', async ({
  page,
}) => {
  await onDraftsDay(page);
  const server = await mountClock(page, CLOCKED_OUT_STATE);
  await setNetwork(page, server, false);
  await storeDrafts(page, [{ id: DRAFT_ID }]);

  await page.getByRole('button', { name: 'Abmelden prüfen', exact: true }).click();

  const drafts = question(page).getByRole('list', { name: 'Berichtsentwürfe', exact: true });
  await expect(drafts.getByRole('listitem')).toHaveText([
    'Wartung HeizungArbeitsbericht · geändert 12.11.2026, 09:30',
  ]);
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
  // Two reasons are left, neither waits for the network: the question says so neutrally and never
  // sends the person to the network.
  await expect(question(page)).toContainText(
    'Noch nicht alles konnte gesendet werden. Prüfe die Einträge oben.',
  );
  await expect(question(page)).not.toContainText('Netz');
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

test('a sign-out whose phone cannot read its jobs of today still lists the drafts and says the job names could not be loaded', async ({
  page,
}) => {
  await onDraftsDay(page);
  const server = await mountClock(page, CLOCKED_OUT_STATE);
  await setNetwork(page, server, false);
  await storeDrafts(page, [{ id: DRAFT_ID }]);
  // The phone's store of today's jobs fails to open.
  await page.evaluate(() => {
    const open = IDBFactory.prototype.open;
    IDBFactory.prototype.open = function (this: IDBFactory, name: string, version?: number) {
      if (name === 'werkflow-today') throw new DOMException('The store did not open.', 'UnknownError');
      return open.call(this, name, version);
    };
  });

  await page.getByRole('button', { name: 'Abmelden prüfen', exact: true }).click();

  await expect(question(page).getByRole('list', { name: 'Berichtsentwürfe', exact: true })).toHaveText(
    'Wartung HeizungArbeitsbericht · geändert 12.11.2026, 09:30',
  );
  await expect(question(page)).toContainText('Die Auftragsnamen konnten gerade nicht geladen werden.');
});

test('a sign-out is not asked about a colleague’s draft, which stays on the phone', async ({ page }) => {
  await mountClock(page, CLOCKED_OUT_STATE);
  await storeDrafts(page, [{ id: DRAFT_ID, userId: COLLEAGUE_ID }]);

  await page.getByRole('button', { name: 'Abmelden prüfen', exact: true }).click();

  await expect(page.getByLabel('Abmeldung')).toHaveText('Sitzung darf enden');
  await expect(question(page)).toHaveCount(0);
  expect(await draftsOnDevice(page)).toEqual([DRAFT_ID]);
});

/** Another tab's online save of a draft takes the drafts' send turn and never answers, as in a dead spot. */
async function hangSaveInAnotherTab(page: Page): Promise<void> {
  await page.evaluate(() => {
    void navigator.locks.request('werkflow-draft-send', () => new Promise<void>(() => undefined));
  });
}

test('a save hanging in another tab when the question opens stalls its send, and „Abbrechen“ still keeps the session', async ({
  page,
}) => {
  await mountClock(page, CLOCKED_OUT_STATE);
  await storeDrafts(page, [{ id: DRAFT_ID, sealed: true }]);
  await hangSaveInAnotherTab(page);

  await page.getByRole('button', { name: 'Abmelden prüfen', exact: true }).click();

  await expect(question(page).getByRole('status')).toHaveText('Es wird gesendet …');
  await question(page).getByRole('button', { name: 'Abbrechen', exact: true }).click();
  await expect(page.getByLabel('Abmeldung')).toHaveText('Sitzung bleibt');
  expect(await draftsOnDevice(page)).toEqual([DRAFT_ID]);
});

const STILL_SENDING =
  'Gerade wird noch ein Entwurf übertragen. Was hier noch steht, ist nicht gelöscht. Versuche es gleich noch einmal.';

/** Moves the page clock in steps until the discard's bound passed, which starts once it read the session. */
async function passDiscardBound(page: Page): Promise<void> {
  await expect(async () => {
    await page.clock.runFor(1_000);
    await expect(question(page)).toContainText(STILL_SENDING, { timeout: 100 });
  }).toPass();
}

test('a discard waiting for a save that started hanging in another tab ends after its bound, deletes nothing, shows a draft written meanwhile, and „Abbrechen“ keeps the session', async ({
  page,
}) => {
  // The page's clock runs by hand, so the discard's ten-second bound passes without waiting.
  await page.clock.install();
  const server = await mountClock(page, CLOCKED_OUT_STATE);
  await setNetwork(page, server, false);
  await storeDrafts(page, [{ id: DRAFT_ID, sealed: true }]);
  await page.getByRole('button', { name: 'Abmelden prüfen', exact: true }).click();
  // The question's own send found no signal and ended; then another tab's save starts and hangs.
  await expect(question(page)).toContainText('Noch nicht alles ist übertragen.');
  await hangSaveInAnotherTab(page);

  await question(page).getByRole('button', { name: 'Verwerfen', exact: true }).click();
  const confirmation = page.getByRole('alertdialog', { name: 'Nicht Übertragenes verwerfen?' });
  await confirmation.getByRole('button', { name: 'Endgültig verwerfen', exact: true }).click();
  // Another tab writes a draft while the discard waits.
  const laterId = '60000000-0000-4000-8000-000000000005';
  await storeDrafts(page, [{ id: laterId, title: 'Nachtrag Dachboden' }]);
  await passDiscardBound(page);

  // The confirmation closed: a new discard first shows the draft written meanwhile in detail.
  await expect(confirmation).toHaveCount(0);
  await expect(question(page).getByRole('list', { name: 'Berichtsentwürfe', exact: true })).toContainText(
    'Nachtrag Dachboden',
  );
  await question(page).getByRole('button', { name: 'Abbrechen', exact: true }).click();
  await expect(page.getByLabel('Abmeldung')).toHaveText('Sitzung bleibt');
  expect(await draftsOnDevice(page)).toEqual([DRAFT_ID, laterId]);
});

test('a discard that deletes the times but finds a draft save still running says what is left and lists only that', async ({
  page,
}) => {
  await page.clock.install();
  const server = await mountClock(page, CLOCKED_OUT_STATE);
  await startWithoutNetwork(page, server);
  await storeDrafts(page, [{ id: DRAFT_ID, sealed: true }]);
  await page.getByRole('button', { name: 'Abmelden prüfen', exact: true }).click();
  await expect(question(page)).toContainText('Noch nicht alles ist übertragen.');
  await hangSaveInAnotherTab(page);

  await question(page).getByRole('button', { name: 'Verwerfen', exact: true }).click();
  const confirmation = page.getByRole('alertdialog', { name: 'Nicht Übertragenes verwerfen?' });
  await confirmation.getByRole('button', { name: 'Endgültig verwerfen', exact: true }).click();
  await passDiscardBound(page);

  // The times are gone; the question names only the draft that stays.
  expect(await unsentOnDevice(page)).toEqual([]);
  await expect(question(page).getByRole('list', { name: 'Berichtsentwürfe', exact: true })).toBeVisible();
  await expect(question(page)).not.toContainText('Stempelzeiten');
  await question(page).getByRole('button', { name: 'Abbrechen', exact: true }).click();
  await expect(page.getByLabel('Abmeldung')).toHaveText('Sitzung bleibt');
  expect(await draftsOnDevice(page)).toEqual([DRAFT_ID]);
});

// After a send, the question names the one reason that keeps what is left from going; never the
// network for a draft that could not go with signal either.
for (const { record, says } of [
  {
    record: { ready: false },
    says: 'Ein Berichtsentwurf ist noch unvollständig und kann so nicht gesendet werden. Ergänze ihn im Auftrag oder verwirf ihn.',
  },
  {
    record: { refusal: { kind: 'no_access', at: '2026-11-12T08:40:00.000Z' } },
    says: 'Auf den Auftrag eines Entwurfs hast du keinen Zugriff mehr. Er wird nicht gesendet, du kannst ihn nur verwerfen.',
  },
  {
    record: { version: 99 },
    says: 'Diese App-Version kann einen Entwurf nicht lesen. Er wird nicht gesendet, du kannst ihn nur verwerfen.',
  },
  {
    record: { refusal: { kind: 'failed', at: '2026-11-12T08:40:00.000Z' } },
    says: 'Ein Entwurf wurde nicht angenommen. Öffne ihn im Auftrag und sende ihn erneut, oder verwirf ihn.',
  },
] as const)
  test(`with signal, a draft the send cannot take is named by its reason: ${says.split('.')[0]}`, async ({
    page,
  }) => {
    await onDraftsDay(page);
    const server = await mountClock(page, CLOCKED_OUT_STATE);
    const attached = await acceptDraftAttaches(page, server);
    await storeDrafts(page, [{ id: DRAFT_ID, ...record }]);

    await page.getByRole('button', { name: 'Abmelden prüfen', exact: true }).click();

    await expect(question(page)).toContainText(says);
    await expect(question(page)).not.toContainText('Prüfe dein Netz');
    expect(attached).toEqual([]);
  });

test('after a send that leaves a draft waiting for the network and an incomplete one, the question names both kinds of reason', async ({
  page,
}) => {
  const server = await mountClock(page, CLOCKED_OUT_STATE);
  await setNetwork(page, server, false);
  await storeDrafts(page, [{ id: DRAFT_ID }, { id: '60000000-0000-4000-8000-000000000006', ready: false }]);

  await page.getByRole('button', { name: 'Abmelden prüfen', exact: true }).click();

  await expect(question(page)).toContainText(
    'Noch nicht alles konnte gesendet werden. Manches wartet auf Netz, anderes kann so nicht gesendet werden.',
  );
});

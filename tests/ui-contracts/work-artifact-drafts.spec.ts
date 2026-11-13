import { expect, test, type Locator, type Page } from '@playwright/test';
import { z } from '@/lib/zod';
import { openContractFixture } from './open-fixture';
import { visibleText } from '../golden/support/steps/shared';

// A new Arbeitsnachweis of a job is a draft on the device while the person
// writes it (decision record 0010, the report draft amendment;
// werk-flow/werkflow-planning#320): text and photos survive a lost signal and
// a reload, the section names each draft's state, and the server's answer
// decides what stays on the phone. The device store is the browser's real
// IndexedDB; the upload path and the sync handler are stand-ins.

test.use({ viewport: { width: 375, height: 812 } });

/** A one-pixel PNG the browser can decode: a synthetic photo. */
const PHOTO = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);

const sentOperationSchema = z.object({
  operationId: z.string(),
  kind: z.string(),
  capturedAt: z.string(),
  payload: z.object({
    title: z.string(),
    revisionId: z.string(),
    content: z.object({ performedWork: z.string().optional() }),
    photos: z.array(z.unknown()),
  }),
});
type SentOperation = z.infer<typeof sentOperationSchema>;

/** Answers the sync handler: `offline` aborts the request, a verdict answers it. Returns what was sent. */
async function answerSync(
  page: Page,
  answer: () => 'offline' | { outcome: string; code: string },
): Promise<SentOperation[]> {
  const sent: SentOperation[] = [];
  await page.route('**/api/field-sync/v1/operations', async (route) => {
    const { operations } = z
      .object({ operations: z.array(sentOperationSchema) })
      .parse(route.request().postDataJSON());
    sent.push(...operations);
    const verdict = answer();
    if (verdict === 'offline') await route.abort('internetdisconnected');
    else
      await route.fulfill({
        json: { results: operations.map(({ operationId }) => ({ operationId, ...verdict })) },
      });
  });
  return sent;
}

async function writeReport(page: Page, title: string, photos: number): Promise<void> {
  await page.getByRole('button', { name: 'Neu', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Arbeitsnachweis erstellen', exact: true });
  await dialog.getByRole('textbox', { name: 'Titel', exact: true }).fill(title);
  await dialog.getByRole('textbox', { name: 'Ausgeführte Arbeiten', exact: true }).fill('Brenner gereinigt');
  for (let index = 1; index <= photos; index += 1) {
    await dialog
      .getByTestId('artifact-photo-input')
      .setInputFiles({ name: `foto-${index}.png`, mimeType: 'image/png', buffer: PHOTO });
    await expect(dialog.getByRole('img', { name: `Foto ${index}`, exact: true })).toBeVisible();
  }
}

/** Closes the dialog with its footer button; the corner control carries the same name. */
async function closeDialog(dialog: Locator): Promise<void> {
  await dialog
    .locator('[data-slot="dialog-footer"]')
    .getByRole('button', { name: 'Schließen', exact: true })
    .click();
}

/** From now on every connection to the draft store opens only when the spec releases it. */
async function holdDraftStoreOpens(page: Page): Promise<void> {
  await page.evaluate(() => {
    const held: Array<() => void> = [];
    Object.assign(window, { heldDraftOpens: held });
    const open = IDBFactory.prototype.open;
    IDBFactory.prototype.open = function (this: IDBFactory, name: string, version?: number) {
      const request = open.call(this, name, version);
      if (name === 'werkflow-drafts')
        request.addEventListener(
          'success',
          (event) => {
            event.stopImmediatePropagation();
            held.push(() => request.dispatchEvent(new Event('success')));
          },
          { once: true },
        );
      return request;
    };
  });
}

/** How many draft store connections wait for the spec. */
async function heldOpens(page: Page): Promise<number> {
  return page.evaluate(() => {
    const held: unknown = Reflect.get(window, 'heldDraftOpens');
    return Array.isArray(held) ? held.length : 0;
  });
}

/** Releases held connections, the newest first, until none comes for a while. */
async function releaseHeldOpensNewestFirst(page: Page): Promise<void> {
  let quiet = 0;
  while (quiet < 5) {
    const released = await page.evaluate(() => {
      const held: unknown = Reflect.get(window, 'heldDraftOpens');
      if (!Array.isArray(held) || held.length === 0) return false;
      const release: unknown = held.pop();
      if (typeof release === 'function') release();
      return true;
    });
    quiet = released ? 0 : quiet + 1;
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(resolve)));
  }
}

/** How many drafts the device holds, of anyone. */
async function storedDraftCount(page: Page): Promise<number> {
  return page.evaluate(async () => {
    const opening = indexedDB.open('werkflow-drafts', 1);
    opening.onupgradeneeded = () => opening.result.createObjectStore('drafts', { keyPath: 'id' });
    const database = await new Promise<IDBDatabase>(
      (resolve) => (opening.onsuccess = () => resolve(opening.result)),
    );
    if (!database.objectStoreNames.contains('drafts')) {
      database.close();
      return 0;
    }
    const counting = database.transaction('drafts').objectStore('drafts').count();
    const count = await new Promise<number>(
      (resolve) => (counting.onsuccess = () => resolve(counting.result)),
    );
    database.close();
    return count;
  });
}

/** Whether the one stored draft is sealed. */
async function storedDraftSealed(page: Page): Promise<boolean | null> {
  return page.evaluate(async () => {
    const opening = indexedDB.open('werkflow-drafts', 1);
    opening.onupgradeneeded = () => opening.result.createObjectStore('drafts', { keyPath: 'id' });
    const database = await new Promise<IDBDatabase>(
      (resolve) => (opening.onsuccess = () => resolve(opening.result)),
    );
    const reading = database.transaction('drafts').objectStore('drafts').getAll();
    const records = await new Promise<unknown[]>(
      (resolve) => (reading.onsuccess = () => resolve(reading.result)),
    );
    database.close();
    const [record] = records;
    return typeof record === 'object' && record !== null ? Reflect.get(record, 'sealed') === true : null;
  });
}

/** Seals the one stored draft as another tab's online save does before it leaves. */
async function sealStoredDraftElsewhere(page: Page): Promise<void> {
  await expect.poll(() => storedDraftCount(page)).toBe(1);
  await page.evaluate(async () => {
    const opening = indexedDB.open('werkflow-drafts', 1);
    opening.onupgradeneeded = () => opening.result.createObjectStore('drafts', { keyPath: 'id' });
    const database = await new Promise<IDBDatabase>(
      (resolve) => (opening.onsuccess = () => resolve(opening.result)),
    );
    const transaction = database.transaction('drafts', 'readwrite');
    const store = transaction.objectStore('drafts');
    const reading = store.getAll();
    reading.onsuccess = () => {
      for (const record of reading.result) store.put({ ...record, sealed: true });
    };
    await new Promise<void>((resolve) => (transaction.oncomplete = () => resolve()));
    database.close();
  });
}

/**
 * From the save on, the second connection to the draft store first changes the unsealed draft as
 * another tab does, between two of this tab's transactions: its photo field adds a photo, or its
 * save writes its own text and seals the draft.
 */
async function changeElsewhereBeforeSecondOpen(page: Page, change: 'photo' | 'sealed_text'): Promise<void> {
  await page.evaluate((kind) => {
    const open = IDBFactory.prototype.open;
    let opens = 0;
    IDBFactory.prototype.open = function (this: IDBFactory, name: string, version?: number) {
      const request = open.call(this, name, version);
      if (name !== 'werkflow-drafts') return request;
      opens += 1;
      if (opens !== 2) return request;
      request.addEventListener(
        'success',
        (event) => {
          event.stopImmediatePropagation();
          const transaction = request.result.transaction('drafts', 'readwrite');
          const store = transaction.objectStore('drafts');
          const reading = store.getAll();
          reading.onsuccess = () => {
            const records: unknown[] = reading.result;
            for (const record of records) {
              if (typeof record !== 'object' || record === null) continue;
              if (Reflect.get(record, 'sealed') === true) continue;
              const photos: unknown = Reflect.get(record, 'photos');
              const blob = new Blob(['synthetic photo'], { type: 'image/png' });
              const photo = {
                id: crypto.randomUUID(),
                name: 'foto-anderes-fenster.png',
                blob,
                transferred: null,
                documentId: null,
              };
              const existing: unknown[] = Array.isArray(photos) ? photos : [];
              store.put(
                kind === 'photo'
                  ? { ...record, photos: [...existing, photo] }
                  : {
                      ...record,
                      content: { performedWork: 'Text aus dem anderen Fenster' },
                      updatedAt: new Date(Date.now() + 1000).toISOString(),
                      sealed: true,
                    },
              );
              Reflect.set(window, 'changedElsewhere', true);
            }
          };
          transaction.oncomplete = () => request.dispatchEvent(new Event('success'));
        },
        { once: true },
      );
      return request;
    };
  }, change);
}

function draftRow(page: Page, title: string) {
  return page.getByTestId('device-drafts').getByRole('listitem').filter({ hasText: title });
}

test('a report with two photos written without signal stays on the device, survives a reload and opens again with its text and photos', async ({
  page,
}) => {
  await page.addInitScript(() => {
    window.uiContractDraftsOffline = true;
  });
  await openContractFixture(page, 'work-artifact-report');
  await writeReport(page, 'Wartung Heizung', 2);
  await page.getByRole('button', { name: 'Als Entwurf speichern', exact: true }).click();

  await expect(
    page
      .getByRole('alert')
      .filter({ hasText: /Gerade kein Netz\. Der Entwurf ist auf diesem Gerät gespeichert/ }),
  ).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const row = draftRow(page, 'Wartung Heizung');
  await expect(row.getByText('Entwurf auf dem Gerät', { exact: true })).toBeVisible();
  await expect(row.getByText('Arbeitsbericht · 2 Fotos', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => window.uiContractWorkArtifacts.saves)).toEqual([]);

  // A reload, still without signal, is a new page: only the device still knows the draft.
  await openContractFixture(page, 'work-artifact-report');
  await draftRow(page, 'Wartung Heizung').getByRole('button', { name: 'Bearbeiten', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Arbeitsnachweis erstellen', exact: true });
  await expect(dialog.getByRole('textbox', { name: 'Titel', exact: true })).toHaveValue('Wartung Heizung');
  await expect(dialog.getByRole('textbox', { name: 'Ausgeführte Arbeiten', exact: true })).toHaveValue(
    'Brenner gereinigt',
  );
  await expect(dialog.getByRole('img', { name: /^Foto \d$/ })).toHaveCount(2);
});

test('with the signal back the photos upload one by one, the row counts them, and one operation with both photos takes the draft off the device', async ({
  page,
}) => {
  await openContractFixture(page, 'work-artifact-report');
  await page.evaluate(() => {
    window.uiContractDrafts.uploadAnswer = 'interrupted';
  });
  await writeReport(page, 'Wartung Heizung', 2);
  await page.getByRole('button', { name: 'Als Entwurf speichern', exact: true }).click();
  const row = draftRow(page, 'Wartung Heizung');
  await expect(row.getByText('Entwurf auf dem Gerät', { exact: true })).toBeVisible();

  const sent = await answerSync(page, () => ({ outcome: 'accepted', code: 'accepted' }));
  await page.evaluate(() => {
    window.uiContractDrafts.uploadAnswer = 'saved';
    window.uiContractDrafts.heldUploads = [];
    window.uiContractDrafts.uploads = [];
  });
  await row.getByRole('button', { name: 'Jetzt senden', exact: true }).click();

  await expect(row.getByText('Wird hochgeladen (0 von 2 Fotos)', { exact: true })).toBeVisible();
  await page.evaluate(() => window.uiContractDrafts.heldUploads?.shift()?.());
  await expect(row.getByText('Wird hochgeladen (1 von 2 Fotos)', { exact: true })).toBeVisible();
  await page.evaluate(() => window.uiContractDrafts.heldUploads?.shift()?.());

  await expect(page.getByTestId('device-drafts')).toHaveCount(0);
  expect(await page.evaluate(() => window.uiContractDrafts.uploads)).toEqual(['foto-1.png', 'foto-2.png']);
  expect(
    sent.map((operation) => [operation.kind, operation.payload.title, operation.payload.photos.length]),
  ).toEqual([['work_artifact.draft', 'Wartung Heizung', 2]]);
});

test('a draft the server refuses shows „Nicht übertragen“ with „Erneut senden“, and the resend repeats the same operation', async ({
  page,
}) => {
  await openContractFixture(page, 'work-artifact-report');
  let verdict = { outcome: 'conflict', code: 'version_conflict' };
  const sent = await answerSync(page, () => verdict);
  await page.evaluate(() => {
    window.uiContractWorkArtifacts.loseSaveAnswer = true;
  });
  await writeReport(page, 'Wartung Heizung', 0);
  await page.getByRole('button', { name: 'Als Entwurf speichern', exact: true }).click();

  const dialog = page.getByRole('dialog', { name: 'Arbeitsnachweis erstellen', exact: true });
  await expect(
    dialog.getByText(/Der Entwurf konnte nicht übertragen werden\. Er bleibt auf diesem Gerät/),
  ).toBeVisible();
  await closeDialog(dialog);
  const row = draftRow(page, 'Wartung Heizung');
  await expect(row.getByText('Nicht übertragen', { exact: true })).toBeVisible();
  await expect(row.getByRole('button', { name: 'Jetzt senden', exact: true })).toHaveCount(0);

  verdict = { outcome: 'accepted', code: 'accepted' };
  await row.getByRole('button', { name: 'Erneut senden', exact: true }).click();
  await expect(page.getByTestId('device-drafts')).toHaveCount(0);
  expect(new Set(sent.map((operation) => operation.operationId)).size).toBe(1);
  expect(sent.length).toBe(2);
});

test('a draft for a job the person lost access to shows „Kein Zugriff mehr“, is never sent again, and is deleted only after the person confirms', async ({
  page,
}) => {
  await openContractFixture(page, 'work-artifact-report');
  const sent = await answerSync(page, () => ({ outcome: 'rejected', code: 'forbidden' }));
  await page.evaluate(() => {
    window.uiContractWorkArtifacts.loseSaveAnswer = true;
  });
  await writeReport(page, 'Wartung Heizung', 0);
  await page.getByRole('button', { name: 'Als Entwurf speichern', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Arbeitsnachweis erstellen', exact: true });
  await expect(dialog.getByText(/Du hast keinen Zugriff mehr auf diesen Auftrag/)).toBeVisible();
  await closeDialog(dialog);

  const row = draftRow(page, 'Wartung Heizung');
  await expect(row.getByText('Kein Zugriff mehr', { exact: true })).toBeVisible();
  await expect(
    row.getByText(/Der Entwurf wird nicht übertragen und am \d{2}\.\d{2}\.\d{4} von diesem Gerät gelöscht\./),
  ).toBeVisible();
  await expect(row.getByRole('button')).toHaveText(['Löschen']);
  expect(sent.length).toBe(1);

  await row.getByRole('button', { name: 'Löschen', exact: true }).click();
  const confirm = page.getByRole('alertdialog', { name: 'Entwurf „Wartung Heizung“ löschen?' });
  await confirm.getByRole('button', { name: 'Abbrechen', exact: true }).click();
  await expect(row).toBeVisible();
  await row.getByRole('button', { name: 'Löschen', exact: true }).click();
  await confirm.getByRole('button', { name: 'Endgültig löschen', exact: true }).click();
  await expect(page.getByTestId('device-drafts')).toHaveCount(0);
});

test('a refused photo upload on a job the person lost marks the draft without sending it', async ({
  page,
}) => {
  await openContractFixture(page, 'work-artifact-report');
  const sent = await answerSync(page, () => ({ outcome: 'accepted', code: 'accepted' }));
  await page.evaluate(() => {
    window.uiContractDrafts.uploadAnswer = 'refused';
    window.uiContractDrafts.jobAccessLost = true;
  });
  await writeReport(page, 'Wartung Heizung', 1);
  await page.getByRole('button', { name: 'Als Entwurf speichern', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Arbeitsnachweis erstellen', exact: true });
  await expect(dialog.getByText(/Du hast keinen Zugriff mehr auf diesen Auftrag/)).toBeVisible();
  expect(sent).toEqual([]);
});

test('a full device shows that the photo was not stored, and the photo is not listed', async ({ page }) => {
  await openContractFixture(page, 'work-artifact-report');
  await page.getByRole('button', { name: 'Neu', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Arbeitsnachweis erstellen', exact: true });
  await dialog.getByRole('textbox', { name: 'Titel', exact: true }).fill('Wartung Heizung');
  // The field's label names the button that opens the camera.
  await expect(dialog.getByRole('button', { name: 'Fotos', exact: true })).toHaveText('Foto aufnehmen');
  await page.evaluate(() => {
    IDBObjectStore.prototype.put = () => {
      throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
    };
  });
  await dialog
    .getByTestId('artifact-photo-input')
    .setInputFiles({ name: 'foto-1.png', mimeType: 'image/png', buffer: PHOTO });

  await expect(dialog.getByText(/Der Speicher dieses Geräts ist voll\./)).toBeVisible();
  await expect(dialog.getByRole('img', { name: /^Foto \d$/ })).toHaveCount(0);
});

test('a save that reaches the server keeps its one request and leaves no draft on the device', async ({
  page,
}) => {
  await openContractFixture(page, 'work-artifact-report');
  const sent = await answerSync(page, () => ({ outcome: 'accepted', code: 'accepted' }));
  await writeReport(page, 'Wartung Heizung', 0);
  await page.getByRole('button', { name: 'Als Entwurf speichern', exact: true }).click();

  const saved = page.getByRole('dialog', { name: 'Wartung Heizung', exact: true });
  await closeDialog(saved);
  await expect(page.getByTestId('device-drafts')).toHaveCount(0);
  expect((await page.evaluate(() => window.uiContractWorkArtifacts.saves)).length).toBe(1);
  expect(sent).toEqual([]);
});

test('a photo is taken with the camera input: an image file input that asks for the rear camera', async ({
  page,
}) => {
  await openContractFixture(page, 'work-artifact-report');
  await page.getByRole('button', { name: 'Neu', exact: true }).click();
  const input = page.getByTestId('artifact-photo-input');
  await expect(input).toHaveAttribute('type', 'file');
  await expect(input).toHaveAttribute('accept', 'image/*');
  await expect(input).toHaveAttribute('capture', 'environment');
});

test('a save right after a photo waits until the device stored the photo, and then keeps the photo with the draft', async ({
  page,
}) => {
  await page.addInitScript(() => {
    window.uiContractDraftsOffline = true;
  });
  await openContractFixture(page, 'work-artifact-report');
  await page.getByRole('button', { name: 'Neu', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Arbeitsnachweis erstellen', exact: true });
  await dialog.getByRole('textbox', { name: 'Titel', exact: true }).fill('Wartung Heizung');
  await dialog.getByRole('textbox', { name: 'Ausgeführte Arbeiten', exact: true }).fill('Brenner gereinigt');
  await expect(dialog.getByRole('button', { name: 'Fotos', exact: true })).toBeVisible();
  // From here every connection to the draft store opens only when the spec lets it.
  await page.evaluate(() => {
    const held: Array<() => void> = [];
    Object.assign(window, { heldDraftOpens: held });
    const open = IDBFactory.prototype.open;
    IDBFactory.prototype.open = function (this: IDBFactory, name: string, version?: number) {
      const request = open.call(this, name, version);
      if (name === 'werkflow-drafts')
        request.addEventListener(
          'success',
          (event) => {
            event.stopImmediatePropagation();
            held.push(() => request.dispatchEvent(new Event('success')));
          },
          { once: true },
        );
      return request;
    };
  });
  await dialog
    .getByTestId('artifact-photo-input')
    .setInputFiles({ name: 'foto-1.png', mimeType: 'image/png', buffer: PHOTO });
  await page.getByRole('button', { name: 'Als Entwurf speichern', exact: true }).click();
  // Release the held connections one by one until the save has settled.
  await expect
    .poll(async () => {
      await page.evaluate(() => {
        const held: unknown = Reflect.get(window, 'heldDraftOpens');
        if (Array.isArray(held))
          for (const release of held.splice(0)) if (typeof release === 'function') release();
      });
      return page
        .getByRole('alert')
        .filter({ hasText: /Gerade kein Netz/ })
        .count();
    })
    .toBe(1);
  expect(await page.evaluate(() => window.uiContractWorkArtifacts.saves)).toEqual([]);
  await expect(
    draftRow(page, 'Wartung Heizung').getByText('Arbeitsbericht · 1 Foto', { exact: true }),
  ).toBeVisible();
});

test('a save that cannot read the draft on the device saves nothing and keeps the draft with its photo', async ({
  page,
}) => {
  await openContractFixture(page, 'work-artifact-report');
  const dialog = await (async () => {
    await page.getByRole('button', { name: 'Neu', exact: true }).click();
    return page.getByRole('dialog', { name: 'Arbeitsnachweis erstellen', exact: true });
  })();
  await dialog.getByRole('textbox', { name: 'Titel', exact: true }).fill('Wartung Heizung');
  await dialog.getByRole('textbox', { name: 'Ausgeführte Arbeiten', exact: true }).fill('Brenner gereinigt');
  await dialog
    .getByTestId('artifact-photo-input')
    .setInputFiles({ name: 'foto-1.png', mimeType: 'image/png', buffer: PHOTO });
  await expect(dialog.getByRole('img', { name: 'Foto 1', exact: true })).toBeVisible();
  // From here the device cannot read its draft store.
  await page.evaluate(() => {
    IDBObjectStore.prototype.get = () => {
      throw new DOMException('The device refused the read.', 'UnknownError');
    };
  });
  await page.getByRole('button', { name: 'Als Entwurf speichern', exact: true }).click();

  await expect(
    dialog.getByText(/Der Entwurf konnte nicht auf diesem Gerät gespeichert werden/),
  ).toBeVisible();
  expect(await page.evaluate(() => window.uiContractWorkArtifacts.saves)).toEqual([]);
  await expect(dialog.getByRole('img', { name: 'Foto 1', exact: true })).toBeVisible();
});

test('a save whose answer is lost after it committed sends the same draft revision, so the server replays instead of colliding', async ({
  page,
}) => {
  await openContractFixture(page, 'work-artifact-report');
  const sent = await answerSync(page, () => ({ outcome: 'replayed', code: 'replayed' }));
  await page.evaluate(() => {
    window.uiContractWorkArtifacts.loseSaveAnswerAfterCommit = true;
  });
  await writeReport(page, 'Wartung Heizung', 0);
  await page.getByRole('button', { name: 'Als Entwurf speichern', exact: true }).click();

  await expect.poll(() => sent.length).toBe(1);
  const [saved] = await page.evaluate(() => window.uiContractWorkArtifacts.saves);
  expect(sent[0]?.payload.revisionId).toBe(saved?.revisionId);
  // The save names the state of the draft it wrote; the send names the same one, so the server adopts it.
  expect(saved?.draftChangedAt).toBeDefined();
  expect(sent[0]?.capturedAt).toBe(saved?.draftChangedAt);
});

test('a draft whose online save may have landed cannot be changed until its send is answered, so the send carries what was saved', async ({
  page,
}) => {
  // The browser's own network flag, which the spec turns off once the save's answer is lost.
  await page.addInitScript(() => {
    Reflect.set(window, 'contractOnline', true);
    Object.defineProperty(navigator, 'onLine', { get: () => Reflect.get(window, 'contractOnline') === true });
  });
  await openContractFixture(page, 'work-artifact-report');
  let online = false;
  const sent = await answerSync(page, () => (online ? { outcome: 'replayed', code: 'replayed' } : 'offline'));
  await page.evaluate(() => {
    window.uiContractWorkArtifacts.loseSaveAnswerAfterCommit = true;
  });
  await writeReport(page, 'Wartung Heizung', 0);
  // The save reaches the server, then the signal goes before its answer comes back.
  await page.evaluate(() => Reflect.set(window, 'contractOnline', false));
  await page.getByRole('button', { name: 'Als Entwurf speichern', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.uiContractWorkArtifacts.saves.length)).toBe(1);

  // The save may be on the server: the draft keeps exactly that text until the server answers.
  const row = draftRow(page, 'Wartung Heizung');
  await expect(row).toBeVisible();
  await expect(row.getByRole('button', { name: 'Bearbeiten', exact: true })).toHaveCount(0);

  online = true;
  await page.evaluate(() => {
    Reflect.set(window, 'contractOnline', true);
    window.dispatchEvent(new Event('online'));
  });
  await expect.poll(() => sent.length).toBeGreaterThan(0);
  const [saved] = await page.evaluate(() => window.uiContractWorkArtifacts.saves);
  expect(sent.map((operation) => operation.payload.revisionId)).toEqual(sent.map(() => saved?.revisionId));
  expect(sent.map((operation) => operation.payload.content.performedWork)).toEqual(
    sent.map(() => 'Brenner gereinigt'),
  );
  await expect(row).toBeHidden();
});

test("a save in a tab whose draft another tab's save already sealed sends nothing and keeps this form's text", async ({
  page,
}) => {
  await openContractFixture(page, 'work-artifact-report');
  const sent = await answerSync(page, () => 'offline');
  await writeReport(page, 'Wartung Heizung', 0);
  await sealStoredDraftElsewhere(page);
  const dialog = page.getByRole('dialog', { name: 'Arbeitsnachweis erstellen', exact: true });
  await dialog.getByRole('textbox', { name: 'Ausgeführte Arbeiten', exact: true }).fill('Brenner und Pumpe');
  await page.getByRole('button', { name: 'Als Entwurf speichern', exact: true }).click();

  await expect(
    visibleText(page, 'Dieser Entwurf wird gerade aus einem anderen Fenster gesendet.'),
  ).toBeVisible();
  await expect(dialog.getByRole('textbox', { name: 'Ausgeführte Arbeiten', exact: true })).toHaveValue(
    'Brenner und Pumpe',
  );
  expect(await page.evaluate(() => window.uiContractWorkArtifacts.saves)).toEqual([]);
  expect(sent).toEqual([]);
});

test("another tab's photo that reaches the draft before the save decides goes with the draft's own send, never a text-only save", async ({
  page,
}) => {
  await openContractFixture(page, 'work-artifact-report');
  const sent = await answerSync(page, () => ({ outcome: 'accepted', code: 'accepted' }));
  await writeReport(page, 'Wartung Heizung', 0);
  await expect.poll(() => storedDraftCount(page)).toBe(1);
  await changeElsewhereBeforeSecondOpen(page, 'photo');
  await page.getByRole('button', { name: 'Als Entwurf speichern', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Arbeitsnachweis erstellen', exact: true })).toBeHidden();

  // Whether the other tab's photo came in before the decision or was refused after the seal, no
  // text-only save ever runs for a draft that holds a photo.
  if (await page.evaluate(() => Reflect.get(window, 'changedElsewhere') === true)) {
    expect(await page.evaluate(() => window.uiContractWorkArtifacts.saves)).toEqual([]);
    await expect.poll(() => sent.length).toBe(1);
    expect(sent[0]?.payload.photos).toHaveLength(1);
  }
});

test('a draft with photos that another tab changes and seals after this save decided is not sent from here, and the form keeps its text', async ({
  page,
}) => {
  await openContractFixture(page, 'work-artifact-report');
  const sent = await answerSync(page, () => 'offline');
  await writeReport(page, 'Wartung Heizung', 1);
  await expect.poll(() => storedDraftCount(page)).toBe(1);
  await changeElsewhereBeforeSecondOpen(page, 'sealed_text');
  await page.getByRole('button', { name: 'Als Entwurf speichern', exact: true }).click();

  const dialog = page.getByRole('dialog', { name: 'Arbeitsnachweis erstellen', exact: true });
  await expect(
    visibleText(dialog, 'Dieser Entwurf wurde inzwischen in einem anderen Fenster geändert'),
  ).toBeVisible();
  await expect(dialog.getByRole('textbox', { name: 'Ausgeführte Arbeiten', exact: true })).toHaveValue(
    'Brenner gereinigt',
  );
  expect(sent).toEqual([]);
});

test('text typed while an online save holds the draft sealed reaches the device when the server refuses that save', async ({
  page,
}) => {
  await openContractFixture(page, 'work-artifact-report');
  await answerSync(page, () => 'offline');
  await page.evaluate(() => {
    window.uiContractWorkArtifacts.holdSave = true;
    window.uiContractWorkArtifacts.refuseSave = 'work_artifact_not_authorized';
  });
  await writeReport(page, 'Wartung Heizung', 0);
  await page.getByRole('button', { name: 'Als Entwurf speichern', exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => typeof window.uiContractWorkArtifacts.releaseSave))
    .toBe('function');

  // The draft is sealed while the save is out; the person keeps typing.
  const dialog = page.getByRole('dialog', { name: 'Arbeitsnachweis erstellen', exact: true });
  await dialog.getByRole('textbox', { name: 'Ausgeführte Arbeiten', exact: true }).fill('Brenner und Pumpe');
  await page.evaluate(() => window.uiContractWorkArtifacts.releaseSave?.());
  // The refusal unseals the draft.
  await expect.poll(() => storedDraftSealed(page)).toBe(false);
  await closeDialog(dialog);

  await draftRow(page, 'Wartung Heizung').getByRole('button', { name: 'Bearbeiten', exact: true }).click();
  await expect(
    page
      .getByRole('dialog', { name: 'Arbeitsnachweis erstellen', exact: true })
      .getByRole('textbox', { name: 'Ausgeführte Arbeiten', exact: true }),
  ).toHaveValue('Brenner und Pumpe');
});

test("an online save of a sealed draft holds the drafts' send turn until its answer is handled, so a session end's discard in any tab waits for it", async ({
  page,
}) => {
  await openContractFixture(page, 'work-artifact-report');
  await answerSync(page, () => 'offline');
  await page.evaluate(() => {
    window.uiContractWorkArtifacts.holdSave = true;
  });
  await writeReport(page, 'Wartung Heizung', 0);
  await page.getByRole('button', { name: 'Als Entwurf speichern', exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => typeof window.uiContractWorkArtifacts.releaseSave))
    .toBe('function');
  const heldTurns = () =>
    page.evaluate(async () => (await navigator.locks.query()).held?.map((lock) => lock.name) ?? []);

  expect(await heldTurns()).toContain('werkflow-draft-send');
  await page.evaluate(() => window.uiContractWorkArtifacts.releaseSave?.());
  // The answer is handled: the device's copy is gone, and with it the turn.
  await expect.poll(() => storedDraftCount(page)).toBe(0);
  await expect.poll(heldTurns).not.toContain('werkflow-draft-send');
});

test('a refused online save never writes over the newer text another tab stored after its own refusal unsealed the draft', async ({
  page,
}) => {
  await openContractFixture(page, 'work-artifact-report');
  await answerSync(page, () => 'offline');
  await page.evaluate(() => {
    window.uiContractWorkArtifacts.holdSave = true;
    window.uiContractWorkArtifacts.refuseSave = 'work_artifact_not_authorized';
  });
  await writeReport(page, 'Wartung Heizung', 0);
  await page.getByRole('button', { name: 'Als Entwurf speichern', exact: true }).click();
  await expect
    .poll(() => page.evaluate(() => typeof window.uiContractWorkArtifacts.releaseSave))
    .toBe('function');

  // Another tab's send was refused, which unsealed the draft, and that tab stored its own text.
  await page.evaluate(async () => {
    const opening = indexedDB.open('werkflow-drafts', 1);
    const database = await new Promise<IDBDatabase>(
      (resolve) => (opening.onsuccess = () => resolve(opening.result)),
    );
    const transaction = database.transaction('drafts', 'readwrite');
    const store = transaction.objectStore('drafts');
    const reading = store.getAll();
    reading.onsuccess = () => {
      const records: unknown[] = reading.result;
      for (const record of records) {
        if (typeof record !== 'object' || record === null) continue;
        store.put({
          ...record,
          sealed: false,
          content: { performedWork: 'Text aus dem anderen Fenster' },
          updatedAt: new Date(Date.now() + 1000).toISOString(),
        });
      }
    };
    await new Promise<void>((resolve) => (transaction.oncomplete = () => resolve()));
    database.close();
  });
  await page.evaluate(() => window.uiContractWorkArtifacts.releaseSave?.());

  const dialog = page.getByRole('dialog', { name: 'Arbeitsnachweis erstellen', exact: true });
  await expect(
    visibleText(dialog, 'Dieser Entwurf wurde inzwischen in einem anderen Fenster geändert'),
  ).toBeVisible();
  await closeDialog(dialog);
  await draftRow(page, 'Wartung Heizung').getByRole('button', { name: 'Bearbeiten', exact: true }).click();
  await expect(
    page
      .getByRole('dialog', { name: 'Arbeitsnachweis erstellen', exact: true })
      .getByRole('textbox', { name: 'Ausgeführte Arbeiten', exact: true }),
  ).toHaveValue('Text aus dem anderen Fenster');
});

test('a review request that fails after the device sent the draft says the draft is saved but not submitted', async ({
  page,
}) => {
  await page.addInitScript(() => {
    window.uiContractRecordedVisit = {
      startedAt: '2026-11-02T06:00:00.000Z',
      endedAt: '2026-11-02T11:15:00.000Z',
    };
  });
  await openContractFixture(page, 'work-artifact-report');
  await answerSync(page, () => ({ outcome: 'accepted', code: 'accepted' }));
  await writeReport(page, 'Wartung Heizung', 1);
  // The review request after the send gets no answer.
  await page.getByRole('button', { name: 'Zur Prüfung einreichen', exact: true }).click();

  await expect(
    page
      .getByRole('dialog')
      .getByText(/Der Entwurf ist gespeichert, wurde aber nicht zur Prüfung eingereicht/),
  ).toBeVisible();
});

test('text typed but never saved is on the device: a restart without signal opens the draft with it', async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'onLine', { get: () => false });
  });
  await openContractFixture(page, 'work-artifact-report');
  await writeReport(page, 'Wartung Heizung', 0);
  await expect
    .poll(() =>
      page.evaluate(() => Object.keys(localStorage).some((key) => key.startsWith('werkflow:drafts:'))),
    )
    .toBe(true);

  await openContractFixture(page, 'work-artifact-report');
  await draftRow(page, 'Wartung Heizung').getByRole('button', { name: 'Bearbeiten', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Arbeitsnachweis erstellen', exact: true });
  await expect(dialog.getByRole('textbox', { name: 'Ausgeführte Arbeiten', exact: true })).toHaveValue(
    'Brenner gereinigt',
  );
});

test('two photos taken before the first is stored never take a draft past its photo limit', async ({
  page,
}) => {
  await openContractFixture(page, 'work-artifact-report');
  await writeReport(page, 'Wartung Heizung', 0);
  const dialog = page.getByRole('dialog', { name: 'Arbeitsnachweis erstellen', exact: true });
  for (let index = 1; index <= 19; index += 1)
    await dialog
      .getByTestId('artifact-photo-input')
      .setInputFiles({ name: `foto-${index}.png`, mimeType: 'image/png', buffer: PHOTO });
  await expect(dialog.getByRole('img', { name: /^Foto \d+$/ })).toHaveCount(19);
  await holdDraftStoreOpens(page);
  for (const index of [20, 21])
    await dialog
      .getByTestId('artifact-photo-input')
      .setInputFiles({ name: `foto-${index}.png`, mimeType: 'image/png', buffer: PHOTO });
  await releaseHeldOpensNewestFirst(page);

  await expect(dialog.getByRole('img', { name: /^Foto \d+$/ })).toHaveCount(20);
  await expect(dialog.getByText('Ein Entwurf kann höchstens 20 Fotos haben.', { exact: true })).toBeVisible();
});

test('a closed dialog keeps its draft out of every send until its last change is on the device, so no send carries older text', async ({
  page,
}) => {
  await page.addInitScript(() => {
    window.uiContractDraftsOffline = true;
  });
  await openContractFixture(page, 'work-artifact-report');
  const sent = await answerSync(page, () => ({ outcome: 'accepted', code: 'accepted' }));
  await writeReport(page, 'Wartung Heizung', 0);
  const dialog = page.getByRole('dialog', { name: 'Arbeitsnachweis erstellen', exact: true });
  await holdDraftStoreOpens(page);
  await dialog.getByRole('textbox', { name: 'Ausgeführte Arbeiten', exact: true }).fill('Brenner und Pumpe');
  await expect.poll(() => heldOpens(page)).toBeGreaterThan(0);
  await dialog
    .locator('[data-slot="dialog-footer"]')
    .getByRole('button', { name: 'Schließen', exact: true })
    .click();
  // The signal returns while the last change still waits for the device; the send's reads go first.
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect.poll(() => heldOpens(page)).toBe(2);
  await releaseHeldOpensNewestFirst(page);

  // Whatever sends the draft, it sends the last text, never the one before it.
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await releaseHeldOpensNewestFirst(page);
  await expect.poll(() => sent.length).toBeGreaterThan(0);
  expect(sent.map((operation) => operation.payload.content.performedWork)).toEqual(
    sent.map(() => 'Brenner und Pumpe'),
  );
});

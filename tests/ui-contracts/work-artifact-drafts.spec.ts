import { expect, test, type Locator, type Page } from '@playwright/test';
import { z } from '@/lib/zod';
import { openContractFixture } from './open-fixture';

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
  payload: z.object({ title: z.string(), photos: z.array(z.unknown()) }),
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

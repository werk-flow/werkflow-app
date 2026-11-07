import { expect, test, type Page, type Route } from '@playwright/test';
import { assertWorkspaceTestLock } from '@/lib/testing/runner/workspace-test-lock';

// Each storage PUT carries `/<document id>/<file name>`; the spec answers it.
type StorageAnswer = (fileName: string, attempt: number, route: Route) => Promise<void>;

const saved: StorageAnswer = (_fileName, _attempt, route) => route.fulfill({ status: 200, body: '' });

async function openUploadDialog(
  page: Page,
  {
    answer = saved,
    loseFinalizeAnswer = [],
    failFinalize = [],
  }: { answer?: StorageAnswer; loseFinalizeAnswer?: string[]; failFinalize?: string[] },
): Promise<Map<string, number>> {
  assertWorkspaceTestLock();
  const bundle = process.env.WERKFLOW_UI_CONTRACT_BUNDLE;
  if (!bundle) throw new Error('Run through bun tests/ui-contracts/run.ts.');
  const puts = new Map<string, number>();
  await page.route('http://localhost/ui-contracts**', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<!doctype html><html lang="de"><body><div id="root"></div></body></html>',
    }),
  );
  await page.route('http://localhost/storage/**', async (route) => {
    const fileName = decodeURIComponent(new URL(route.request().url()).pathname.split('/').at(-1) ?? '');
    const attempt = (puts.get(fileName) ?? 0) + 1;
    puts.set(fileName, attempt);
    await answer(fileName, attempt, route);
  });
  await page.goto('http://localhost/ui-contracts');
  await page.evaluate(
    (failures) => {
      window.uiContractFixture = 'document-upload';
      window.uiContractDocumentUpload = {
        ...failures,
        tickets: [],
        registered: [],
        completions: [],
        versions: [
          { versionNumber: 1, storagePath: 'contract-organization/contract-versioned/v1/angebot.pdf' },
        ],
      };
    },
    { loseFinalizeAnswer, failFinalize },
  );
  await page.addScriptTag({ path: bundle });
  return puts;
}

/** The file's name, size, state and reason. */
function fileRow(page: Page, fileName: string) {
  return page.getByRole('dialog').getByText(fileName, { exact: true }).locator('xpath=..');
}

async function registeredFiles(page: Page): Promise<string[]> {
  return page.evaluate(() => [...window.uiContractDocumentUpload.registered].sort());
}

test('a file storage refused stays listed with its reason, and the retry sends only that file', async ({
  page,
}) => {
  const puts = await openUploadDialog(page, {
    answer: (fileName, attempt, route) =>
      fileName === 'aufmass.pdf' && attempt === 1
        ? route.fulfill({ status: 503, body: '' })
        : route.fulfill({ status: 200, body: '' }),
  });

  await expect(fileRow(page, 'aufmass.pdf')).toContainText('Der Speicher hat die Datei nicht angenommen.');
  await expect(fileRow(page, 'angebot.pdf')).toContainText('Gespeichert');
  await expect(fileRow(page, 'abnahme.pdf')).toContainText('Gespeichert');
  expect(await page.evaluate(() => window.uiContractDocumentUpload.completions)).toEqual([
    { failedCount: 1, uploaded: ['angebot.pdf', 'abnahme.pdf'] },
  ]);

  await page.getByRole('button', { name: 'Erneut versuchen' }).click();

  await expect(page.getByLabel('Upload-Dialog')).toHaveText('geschlossen');
  expect(Object.fromEntries(puts)).toEqual({ 'angebot.pdf': 1, 'aufmass.pdf': 2, 'abnahme.pdf': 1 });
  expect(await registeredFiles(page)).toEqual(['abnahme.pdf', 'angebot.pdf', 'aufmass.pdf']);
  expect(await page.evaluate(() => window.uiContractDocumentUpload.completions.at(-1))).toEqual({
    failedCount: 0,
    uploaded: ['aufmass.pdf'],
  });
});

test('a retry after a lost save answer registers the stored file once without sending it again', async ({
  page,
}) => {
  const puts = await openUploadDialog(page, { loseFinalizeAnswer: ['angebot.pdf'] });

  await expect(fileRow(page, 'angebot.pdf')).toContainText('Die Übertragung wurde unterbrochen.');
  await expect(fileRow(page, 'angebot.pdf')).not.toContainText('Gespeichert');

  await page.getByRole('button', { name: 'Erneut versuchen' }).click();

  await expect(page.getByLabel('Upload-Dialog')).toHaveText('geschlossen');
  expect(puts.get('angebot.pdf')).toBe(1);
  expect(
    await page.evaluate(() =>
      window.uiContractDocumentUpload.tickets.filter((name) => name === 'angebot.pdf'),
    ),
  ).toEqual(['angebot.pdf']);
  expect(await registeredFiles(page)).toEqual(['abnahme.pdf', 'angebot.pdf', 'aufmass.pdf']);
});

test('closing a running upload warns that unfinished files are lost, and leaving the page asks first', async ({
  page,
}) => {
  // The first file's transfer never ends, so the upload stays running.
  await openUploadDialog(page, { answer: () => new Promise<void>(() => undefined) });
  const dialog = page.getByRole('dialog', { name: 'Dateien hochladen' });
  await expect(fileRow(page, 'angebot.pdf')).toContainText('0 %');

  const leaveIsHeld = () =>
    page.evaluate(() => {
      const leave = new Event('beforeunload', { cancelable: true });
      window.dispatchEvent(leave);
      return leave.defaultPrevented;
    });
  expect(await leaveIsHeld()).toBe(true);

  await page.keyboard.press('Escape');
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Abbrechen' }).click();
  await expect(dialog).toContainText('Dateien, die noch nicht hochgeladen sind, gehen verloren.');
  await expect(dialog.getByRole('button', { name: 'Weiter hochladen' })).toBeFocused();
  await dialog.getByRole('button', { name: 'Weiter hochladen' }).click();
  await expect(dialog).not.toContainText('gehen verloren');

  await dialog.getByRole('button', { name: 'Abbrechen' }).click();
  await dialog.getByRole('button', { name: 'Trotzdem abbrechen' }).click();

  await expect(page.getByLabel('Upload-Dialog')).toHaveText('geschlossen');
  await expect
    .poll(() => page.evaluate(() => window.uiContractDocumentUpload.completions))
    .toEqual([{ failedCount: 3, uploaded: [] }]);
  expect(await registeredFiles(page)).toEqual([]);
  expect(await leaveIsHeld()).toBe(false);
});

test('a cancel request ends with its run, so a retry runs without the loss warning', async ({ page }) => {
  let failHeldTransfer = () => undefined;
  await openUploadDialog(page, {
    // The first transfer of the first file fails on demand; its retry never ends.
    answer: (fileName, attempt, route) =>
      fileName !== 'angebot.pdf'
        ? route.fulfill({ status: 200, body: '' })
        : new Promise<void>((resolve) => {
            if (attempt === 1)
              failHeldTransfer = () => {
                void route.fulfill({ status: 503, body: '' }).then(resolve);
              };
          }),
  });
  const dialog = page.getByRole('dialog', { name: 'Dateien hochladen' });
  await expect(fileRow(page, 'angebot.pdf')).toContainText('0 %');
  await dialog.getByRole('button', { name: 'Abbrechen' }).click();
  await expect(dialog.getByRole('button', { name: 'Trotzdem abbrechen' })).toBeVisible();

  failHeldTransfer();
  await expect(fileRow(page, 'angebot.pdf')).toContainText('Der Speicher hat die Datei nicht angenommen.');
  await dialog.getByRole('button', { name: 'Erneut versuchen' }).click();

  await expect(fileRow(page, 'angebot.pdf')).toContainText('0 %');
  await expect(dialog.getByRole('button', { name: 'Abbrechen', exact: true })).toBeVisible();
  await expect(dialog).not.toContainText('gehen verloren');
});

/** Uploads a new version of the versioned document, then retries with the first try's stored bytes. */
async function uploadVersionTwice(page: Page, beforeRetry: 'nothing' | 'another person saves a version') {
  return page.evaluate(async (between) => {
    const file = new File(['Version 2'], 'angebot-v2.pdf', { type: 'application/pdf' });
    const documentId = 'contract-versioned';
    const first = await window.uiContractUploadVersion({ documentId, file, transferred: null });
    if (first.status !== 'failed') throw new Error('expected the first try to fail');
    if (between === 'another person saves a version') {
      window.uiContractDocumentUpload.versions.push({
        versionNumber: 2,
        storagePath: 'contract-organization/contract-versioned/v2/kollege.pdf',
      });
    }
    const retry = await window.uiContractUploadVersion({ documentId, file, transferred: first.transferred });
    return {
      first: first.reason,
      retry: retry.status === 'failed' ? retry.reason : retry.status,
      versions: window.uiContractDocumentUpload.versions.map((version) => version.storagePath),
    };
  }, beforeRetry);
}

test('a version retry after a lost save answer counts the saved version, not a conflict', async ({
  page,
}) => {
  const puts = await openUploadDialog(page, { loseFinalizeAnswer: ['angebot-v2.pdf'] });

  expect(await uploadVersionTwice(page, 'nothing')).toEqual({
    first: 'interrupted',
    retry: 'saved',
    versions: [
      'contract-organization/contract-versioned/v1/angebot.pdf',
      'contract-organization/contract-versioned/v2/angebot-v2.pdf',
    ],
  });
  expect(puts.get('angebot-v2.pdf')).toBe(1);
});

test('a version retry after another person saved a version stays a conflict', async ({ page }) => {
  await openUploadDialog(page, { failFinalize: ['angebot-v2.pdf'] });

  expect(await uploadVersionTwice(page, 'another person saves a version')).toEqual({
    first: 'not_saved',
    retry: 'version_conflict',
    versions: [
      'contract-organization/contract-versioned/v1/angebot.pdf',
      'contract-organization/contract-versioned/v2/kollege.pdf',
    ],
  });
});

import { expect, test, type Page } from '@playwright/test';
import { openContractFixture } from './open-fixture';

// The report dialog (docs/features/problem-reports.md) over stub actions:
// the real launcher, recorder, context builder, redaction and upload client.

type StoredPut = { kind: string; body: Buffer };

async function openReportFixture(page: Page): Promise<StoredPut[]> {
  const puts: StoredPut[] = [];
  await page.route('http://localhost/storage/**', async (route) => {
    const kind = new URL(route.request().url()).pathname.split('/')[2] ?? '';
    puts.push({ kind, body: route.request().postDataBuffer() ?? Buffer.alloc(0) });
    await route.fulfill({ status: 200, body: '' });
  });
  await openContractFixture(page, 'problem-report');
  return puts;
}

async function openDialog(page: Page) {
  await page.getByRole('button', { name: 'Problem melden', exact: true }).click();
  return expectDialogReady(page);
}

/** The open report dialog once its screenshot preview is drawn. */
async function expectDialogReady(page: Page) {
  const dialog = page.getByRole('dialog', { name: 'Problem melden', exact: true });
  await expect(
    dialog.getByRole('img', { name: 'Vorschau des Screenshots mit deinen Schwärzungen' }),
  ).toBeVisible();
  return dialog;
}

function boundary(page: Page) {
  return page.evaluate(() => ({
    submissions: window.uiContractProblemReport.submissions,
    tickets: window.uiContractProblemReport.tickets,
    registered: window.uiContractProblemReport.registered,
  }));
}

test('an empty description marks the field, focuses it and sends nothing', async ({ page }) => {
  await openReportFixture(page);
  const dialog = await openDialog(page);
  await dialog.getByRole('button', { name: 'Senden', exact: true }).click();
  const description = dialog.getByRole('textbox', { name: 'Was ist passiert?', exact: true });
  await expect(description).toBeFocused();
  await expect(description).toHaveAttribute('aria-invalid', 'true');
  await expect(dialog.getByText('Beschreibe kurz, was passiert ist.')).toBeVisible();
  expect((await boundary(page)).submissions).toEqual([]);
});

test('a text-only report sends no screenshot', async ({ page }) => {
  const puts = await openReportFixture(page);
  const dialog = await openDialog(page);
  await dialog.getByRole('checkbox', { name: 'Screenshot mitsenden' }).click();
  await expect(
    dialog.getByRole('img', { name: 'Vorschau des Screenshots mit deinen Schwärzungen' }),
  ).toBeHidden();
  await dialog
    .getByRole('textbox', { name: 'Was ist passiert?', exact: true })
    .fill('Die Liste bleibt leer.');
  await dialog.getByRole('button', { name: 'Senden', exact: true }).click();
  await expect(
    page.getByRole('alert').getByText('Danke! Deine Meldung Nr. 7 ist eingegangen.'),
  ).toBeVisible();
  await expect(dialog).toBeHidden();
  const state = await boundary(page);
  expect(state.submissions.map((submission) => submission.description)).toEqual(['Die Liste bleibt leer.']);
  expect(state.tickets).toEqual([]);
  expect(puts).toEqual([]);
});

test('a redaction box is burned into the uploaded image', async ({ page }) => {
  const puts = await openReportFixture(page);
  const dialog = await openDialog(page);
  const preview = dialog.getByRole('img', { name: 'Vorschau des Screenshots mit deinen Schwärzungen' });
  const box = await preview.boundingBox();
  if (!box) throw new Error('The preview has no box.');
  // From a quarter to three quarters of the width, and from a quarter to half the height.
  await page.mouse.move(box.x + box.width * 0.25, box.y + box.height * 0.25);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.75, box.y + box.height * 0.5, { steps: 4 });
  await page.mouse.up();
  await dialog
    .getByRole('textbox', { name: 'Was ist passiert?', exact: true })
    .fill('Der Knopf reagiert nicht.');
  await dialog.getByRole('button', { name: 'Senden', exact: true }).click();
  await expect(
    page.getByRole('alert').getByText('Danke! Deine Meldung Nr. 7 ist eingegangen.'),
  ).toBeVisible();

  expect((await boundary(page)).registered).toEqual(['screenshot']);
  const screenshot = puts.find((put) => put.kind === 'screenshot');
  if (!screenshot) throw new Error('No screenshot reached storage.');
  const pixels = await page.evaluate(
    async (bytes) => {
      const image = await createImageBitmap(new Blob([new Uint8Array(bytes)], { type: 'image/png' }));
      const canvas = document.createElement('canvas');
      canvas.width = image.width;
      canvas.height = image.height;
      const context = canvas.getContext('2d');
      if (!context) throw new Error('No 2D context.');
      context.drawImage(image, 0, 0);
      const at = (x: number, y: number) => [...context.getImageData(x, y, 1, 1).data.slice(0, 3)];
      return {
        inside: at(image.width * 0.5, image.height * 0.375),
        outside: at(image.width * 0.5, image.height * 0.75),
      };
    },
    [...screenshot.body],
  );
  expect(pixels.inside).toEqual([0, 0, 0]);
  expect(pixels.outside).toEqual([255, 255, 255]);
});

test('the context keeps a control label only when the app names it, and routes only as templates', async ({
  page,
}) => {
  await openReportFixture(page);
  await page.getByRole('button', { name: 'Speichern', exact: true }).click();
  await page.getByRole('button', { name: 'Musterbau Nord GmbH', exact: true }).click();
  const dialog = await openDialog(page);
  await dialog.getByRole('checkbox', { name: 'Screenshot mitsenden' }).click();
  await dialog.getByRole('textbox', { name: 'Was ist passiert?', exact: true }).fill('Speichern geht nicht.');
  await dialog.getByRole('button', { name: 'Senden', exact: true }).click();
  await expect(
    page.getByRole('alert').getByText('Danke! Deine Meldung Nr. 7 ist eingegangen.'),
  ).toBeVisible();

  const [submission] = (await boundary(page)).submissions;
  expect(submission?.context.routeTemplate).toBe('/auftraege/[jobNumber]');
  expect(submission?.context.recentActions).toEqual([
    { routeTemplate: '/auftraege/[jobNumber]', controlLabel: null },
    { routeTemplate: '/auftraege/[jobNumber]', controlLabel: 'Speichern' },
    { routeTemplate: '/auftraege/[jobNumber]', controlLabel: null },
    { routeTemplate: '/auftraege/[jobNumber]', controlLabel: 'Problem melden' },
  ]);
  // The build's commit, shortened to twelve characters.
  expect(submission?.context.appVersion).toBe('contract-bui');
  expect(JSON.stringify(submission?.context)).not.toContain('Musterbau');
});

test('the send shows its pending state in the first frame and keeps the dialog until the answer', async ({
  page,
}) => {
  await openReportFixture(page);
  await page.evaluate(() => {
    window.uiContractProblemReport.holdSubmission = true;
  });
  const dialog = await openDialog(page);
  await dialog.getByRole('checkbox', { name: 'Screenshot mitsenden' }).click();
  await dialog.getByRole('textbox', { name: 'Was ist passiert?', exact: true }).fill('Es lädt ewig.');
  const send = dialog.getByRole('button', { name: 'Senden', exact: true });
  await send.click();
  await expect(send).toHaveAttribute('aria-busy', 'true');
  await expect(dialog).toBeVisible();
  await page.evaluate(() => window.uiContractProblemReport.releaseSubmission?.());
  await expect(
    page.getByRole('alert').getByText('Danke! Deine Meldung Nr. 7 ist eingegangen.'),
  ).toBeVisible();
  await expect(dialog).toBeHidden();
});

test('F2 opens the report dialog from the keyboard, and Escape returns to where the person was', async ({
  page,
}) => {
  await openReportFixture(page);
  const working = page.getByRole('button', { name: 'Speichern', exact: true });
  await working.focus();
  await page.keyboard.press('F2');
  const dialog = await expectDialogReady(page);
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(working).toBeFocused();
});

import { expect, type Locator, type Page } from '@playwright/test';
import { expectBannerAfter } from './shared';

// Problem reports (docs/features/problem-reports.md): the „Problem melden“
// button of the app shell, the report dialog and „Meine Meldungen“.

const PROBLEM_REPORT_COPY = {
  button: 'Problem melden',
  dialog: 'Problem melden',
  description: 'Was ist passiert?',
  includeScreenshot: 'Screenshot mitsenden',
  screenshot: 'Vorschau des Screenshots mit deinen Schwärzungen',
  send: 'Senden',
  receipt: /Danke! Deine Meldung Nr\. \d+ ist eingegangen\./,
  ownReports: 'Meine Meldungen',
} as const;

/** The one visible „Problem melden“: the phone header's icon or the desktop sidebar's row. */
export function problemReportButton(page: Page): Locator {
  return page.getByRole('button', { name: PROBLEM_REPORT_COPY.button, exact: true });
}

export function problemReportDialog(page: Page): Locator {
  return page.getByRole('dialog', { name: PROBLEM_REPORT_COPY.dialog, exact: true });
}

/** Opens the dialog and waits until its screenshot preview is drawn. */
export async function openProblemReport(page: Page): Promise<Locator> {
  await problemReportButton(page).click();
  const dialog = problemReportDialog(page);
  await expect(problemReportScreenshot(dialog)).toBeVisible();
  return dialog;
}

function problemReportScreenshot(dialog: Locator): Locator {
  return dialog.getByRole('img', { name: PROBLEM_REPORT_COPY.screenshot, exact: true });
}

/** Draws one redaction box across the middle of the preview, as a finger or mouse drag does. */
export async function redactScreenshotMiddle(dialog: Locator): Promise<void> {
  const preview = problemReportScreenshot(dialog);
  const box = await preview.boundingBox();
  if (!box) throw new Error('The screenshot preview has no box to draw on.');
  const page = dialog.page();
  await page.mouse.move(box.x + box.width * 0.25, box.y + box.height * 0.25);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.75, box.y + box.height * 0.5, { steps: 4 });
  await page.mouse.up();
}

/** Describes the problem and sends it; the dialog closes on the receipt. */
export async function sendProblemReport(dialog: Locator, description: string): Promise<void> {
  const page = dialog.page();
  await dialog.getByRole('textbox', { name: PROBLEM_REPORT_COPY.description, exact: true }).fill(description);
  await expectBannerAfter(page, PROBLEM_REPORT_COPY.receipt, async () => {
    await dialog.getByRole('button', { name: PROBLEM_REPORT_COPY.send, exact: true }).click();
  });
  await expect(dialog).toBeHidden();
}

/** The receipt banner naming the report's number. */
export function problemReportReceipt(page: Page, number: number): Locator {
  return page
    .getByRole('alert')
    .getByText(`Danke! Deine Meldung Nr. ${number} ist eingegangen.`, { exact: true });
}

/** The receipt's „Meine Meldungen“ action, which opens the reporter's list. */
export async function openOwnReportsFromReceipt(page: Page): Promise<void> {
  await page.getByRole('button', { name: PROBLEM_REPORT_COPY.ownReports, exact: true }).click();
  await expect(page.getByRole('heading', { level: 1, name: PROBLEM_REPORT_COPY.ownReports })).toBeVisible();
}

/** A report of „Meine Meldungen“ by its description, at the width's own layout. */
export function ownReport(page: Page, description: string): Locator {
  return page.getByText(description, { exact: true }).filter({ visible: true });
}

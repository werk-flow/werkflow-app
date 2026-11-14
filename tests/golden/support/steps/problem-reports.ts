import { expect, type Locator, type Page } from '@playwright/test';

/** A file a test hands to a file input. */
type FilePayload = { name: string; mimeType: string; buffer: Buffer };
import { confirmed, expectBannerAfter, selectFromSearchable } from './shared';

// Problem reports (docs/features/problem-reports.md): the „Problem melden“
// button of the app shell, the report dialog and „Meine Meldungen“.

const PROBLEM_REPORT_COPY = {
  button: 'Problem melden',
  dialog: 'Problem melden',
  description: 'Was ist passiert?',
  includeScreenshot: 'Screenshot mitsenden',
  screenshot: 'Vorschau des Screenshots mit deinen Schwärzungen',
  enlarge: 'Vergrößern',
  redactionView: 'Screenshot schwärzen',
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

/** The „Vergrößern“ button under the dialog's preview, which opens the large redaction view. */
export function enlargeScreenshotButton(dialog: Locator): Locator {
  return dialog.getByRole('button', { name: PROBLEM_REPORT_COPY.enlarge, exact: true });
}

export function screenshotRedactionView(page: Page): Locator {
  return page.getByRole('dialog', { name: PROBLEM_REPORT_COPY.redactionView, exact: true });
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

/** The status of one report of „Meine Meldungen“, read in the row or card that holds its description. */
export function ownReportStatus(page: Page, description: string, status: string): Locator {
  return confirmed(page.locator('tr, [data-slot="list-row"]').filter({ visible: true }))
    .filter({ hasText: description })
    .getByText(status, { exact: true });
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

/** A text of „Meine Meldungen“, such as a report's description or its answer, at the width's own layout. */
export function ownReport(page: Page, description: string): Locator {
  return page.getByText(description, { exact: true }).filter({ visible: true });
}

// WerkFlow support's area (docs/features/problem-reports.md, "Support"): the
// queue, a report's page and the report filed for a caller.

const SUPPORT_COPY = {
  queueHeading: 'Meldungen',
  status: 'Status',
  bucket: 'Einordnung',
  assignee: 'Zuständig',
  response: 'Antwort an die Person',
  save: 'Speichern',
  saved: 'Gespeichert. Die Person sieht es in „Meine Meldungen“.',
  openOriginal: 'Original öffnen',
  pendingScrub: 'Der Text wird noch bereinigt und erscheint danach hier.',
  notFound: 'Seite nicht gefunden',
  filingHeading: 'Meldung aufnehmen',
  organization: 'Organisation',
  caller: 'Wer hat angerufen?',
  description: 'Was hat die Person gemeldet?',
  file: 'Meldung aufnehmen',
  filed: /Die Meldung Nr\. \d+ ist aufgenommen\./,
} as const;

/** Opens support's queue; the heading shows once the caller is admitted. */
export async function openSupportQueue(page: Page): Promise<void> {
  await page.goto('/support');
  await expect(page.getByRole('heading', { level: 1, name: SUPPORT_COPY.queueHeading })).toBeVisible();
}

/** Opens one report's page in support's area. */
export async function openSupportReport(page: Page, reportId: string): Promise<void> {
  await page.goto(`/support/meldungen/${reportId}`);
  await expect(page.getByRole('button', { name: SUPPORT_COPY.save, exact: true })).toBeEnabled();
}

/** A text of a report's page, at the width's own layout. */
export function supportReportText(page: Page, text: string): Locator {
  return page.getByRole('main').getByText(text, { exact: true }).filter({ visible: true });
}

export function supportPendingScrubNotice(page: Page): Locator {
  return supportReportText(page, SUPPORT_COPY.pendingScrub);
}

async function chooseTriageOption(page: Page, field: string, option: string): Promise<void> {
  await page.getByRole('combobox', { name: field, exact: true }).click();
  await page.getByRole('option', { name: option, exact: true }).click();
}

/** Fills the triage form of the open report; `saveSupportTriage` sends it. */
export async function fillSupportTriage(
  page: Page,
  triage: { status: string; bucket: string; assignee: string; response: string },
): Promise<void> {
  await chooseTriageOption(page, SUPPORT_COPY.status, triage.status);
  await chooseTriageOption(page, SUPPORT_COPY.bucket, triage.bucket);
  await selectFromSearchable(
    page,
    page.getByRole('combobox', { name: SUPPORT_COPY.assignee, exact: true }),
    triage.assignee,
  );
  await page.getByRole('textbox', { name: SUPPORT_COPY.response, exact: true }).fill(triage.response);
}

export function supportTriageSaveButton(page: Page): Locator {
  return page.getByRole('button', { name: SUPPORT_COPY.save, exact: true });
}

export function supportTriageSavedBanner(page: Page): Locator {
  return page.getByRole('alert').getByText(SUPPORT_COPY.saved, { exact: true });
}

/** Presses „Original öffnen“ and waits for the original's text. */
export async function openSupportOriginal(page: Page, description: string): Promise<void> {
  await page.getByRole('button', { name: SUPPORT_COPY.openOriginal, exact: true }).click();
  await expect(supportReportText(page, description)).toBeVisible();
}

/** The not-found page a person outside the allowlist gets for every address of the area. */
export function supportAreaNotFound(page: Page): Locator {
  return page.getByRole('heading', { level: 1, name: SUPPORT_COPY.notFound });
}

/** Files a report for a member who phoned, with one attachment, and lands on the new report's page. */
export async function fileReportForCaller(
  page: Page,
  input: { organization: string; member: string; description: string; attachment: FilePayload },
): Promise<void> {
  await page.goto('/support/aufnehmen');
  await expect(page.getByRole('heading', { level: 1, name: SUPPORT_COPY.filingHeading })).toBeVisible();
  await selectFromSearchable(
    page,
    page.getByRole('combobox', { name: SUPPORT_COPY.organization }),
    input.organization,
  );
  // The organization is URL state: its members arrive with the next server render.
  await expect(page).toHaveURL(/[?&]organisation=/);
  await selectFromSearchable(page, page.getByRole('combobox', { name: SUPPORT_COPY.caller }), input.member);
  await page.getByRole('textbox', { name: SUPPORT_COPY.description }).fill(input.description);
  const form = page.getByRole('main');
  await form.locator('input[type="file"]').setInputFiles(input.attachment);
  await expect(form.getByText(input.attachment.name, { exact: true })).toBeVisible();
  await expectBannerAfter(page, SUPPORT_COPY.filed, async () => {
    await page.getByRole('button', { name: SUPPORT_COPY.file, exact: true }).click();
  });
  await expect(page).toHaveURL(/\/support\/meldungen\/[0-9a-f-]{36}$/);
}

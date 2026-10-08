import { expect, type Locator, type Page } from '@playwright/test';
import { REQUEST_STATUS_LABELS } from '../../../../lib/requests/types';
import { documentOpenButton, documentsRegion, uploadIntoDocumentsSection } from './documents';
import { workTemplateSelect } from './work';
import { getRequestById, type PersistedRequest } from '../db/requests';
import {
  assignDespiteQualificationWarning,
  customerPicker,
  customerPickerSearch,
  expectBannerAfter,
  SHARED_COPY,
  expectVisibleAfterSave,
  selectFromSearchable,
  typeIntoDatePickerById,
  typeIntoDateTimeField,
  visibleText,
} from './shared';

// P1-02: Anfragen (customer requests) and their conversion into work.

/**
 * Copy of the request list, the request dialogs and the request detail that no
 * pure product module owns (client components hold it). Category, urgency,
 * source, status and close-reason labels come from lib/requests/types.
 */
const REQUEST_COPY = {
  navLink: 'Anfragen',
  capture: 'Anfrage erfassen',
  captureTitle: 'Neue Anfrage erfassen',
  search: 'Anfragen durchsuchen',
  refreshList: 'Liste aktualisieren',
  promoteCaller: 'Als neuen Kunden anlegen',
  noAssignee: 'Niemand zuständig',
  convert: 'Umwandeln',
  convertTitle: 'Anfrage umwandeln',
  convertToJob: 'In Auftrag umwandeln',
  convertToProject: 'In Projekt umwandeln',
  projectTab: 'Projekt',
  convertedJobLink: /Auftrag AUF-/,
  matchCustomer: 'Vorhandenem Kunden zuordnen',
  matchTitle: 'Kunden zuordnen',
  match: 'Zuordnen',
  close: 'Schließen',
  closeTitle: 'Anfrage ohne Auftrag schließen',
  closeReasonLabel: 'Grund *',
  closeSubmit: 'Anfrage schließen',
} as const;

/** The row actions of the request's contextual „Dokumente & Bilder“ frame. */
const REQUEST_DOCUMENT_COPY = {
  actions: 'Dateiaktionen öffnen',
  moveToTrash: 'In Papierkorb verschieben',
  movedToTrash: 'Datei wurde in den Papierkorb verschoben.',
} as const;

/** Texts of the request detail and its dialogs that specs assert. */
export const REQUEST_DETAIL_TEXT = {
  callerFacts: 'Erfasste Anruferdaten',
  /** The history entry of the creation. */
  captured: 'Anfrage erfasst',
  closedWithoutWork: 'Ohne Auftrag geschlossen:',
  converted: 'Diese Anfrage wurde umgewandelt',
  /** The conversion dialog's promise that it plans nothing by itself. */
  noAutomaticScheduling: 'Es wird nichts automatisch terminiert.',
  /** The empty planned-date picker of the conversion dialog. */
  noPlannedDate: 'Datum wählen',
  /** The banner after an unknown caller became a customer. */
  callerPromoted: 'Kunde wurde angelegt und der Anfrage zugeordnet.',
  /** The origin line of converted work that links back to its request. */
  workOrigin: 'Entstanden aus',
} as const;

/** The status tabs of the request list, keyed by the URL value each one commits. */
const REQUEST_STATUS_TABS = {
  aktiv: 'Aktiv',
  umgewandelt: REQUEST_STATUS_LABELS.umgewandelt,
  geschlossen: REQUEST_STATUS_LABELS.geschlossen,
  alle: 'Alle',
} as const;

/** The detail's status actions, the banner each one confirms with, and the action it offers next. */
const REQUEST_STATUS_ACTIONS = {
  clarify: {
    action: 'In Klärung setzen',
    banner: 'Anfrage ist jetzt in Klärung.',
    next: 'Zurück auf Offen',
  },
  reopen: {
    action: 'Wieder öffnen',
    banner: 'Anfrage wurde wieder geöffnet.',
    next: 'In Klärung setzen',
  },
} as const;

/** The sidebar entry of the request list. */
export function requestsNavLink(page: Page): Locator {
  return page.getByRole('link', { name: REQUEST_COPY.navLink });
}

/** The capture action: the list header trigger, or the dialog's submit when scoped to the dialog. */
export function requestCaptureButton(scope: Page | Locator): Locator {
  return scope.getByRole('button', { name: REQUEST_COPY.capture });
}

/** The assignee picker's option for no responsible person. */
export function noAssigneeOption(listbox: Locator): Locator {
  return listbox.getByRole('option').filter({ hasText: REQUEST_COPY.noAssignee });
}

/** The request list's search field. */
export function requestSearchField(page: Page): Locator {
  return page.getByRole('textbox', { name: REQUEST_COPY.search, exact: true });
}

/** The request list's refresh action. */
export function requestListRefreshButton(page: Page): Locator {
  return page.getByRole('button', { name: REQUEST_COPY.refreshList, exact: true });
}

/** The capture dialog, named by its title. */
export function requestCaptureDialog(page: Page): Locator {
  return page.getByRole('dialog', { name: REQUEST_COPY.captureTitle, exact: true });
}

/** The conversion dialog, named by its heading. */
export function requestConversionDialog(page: Page): Locator {
  return page.getByRole('dialog').filter({
    has: page.getByRole('heading', { name: REQUEST_COPY.convertTitle }),
  });
}

/** Promotes the unknown caller of a request into a customer. */
export function promoteCallerButton(page: Page): Locator {
  return page.getByRole('button', { name: REQUEST_COPY.promoteCaller });
}

/** The once-only conversion action on a request detail. */
export function requestConvertButton(page: Page): Locator {
  return page.getByRole('button', { name: REQUEST_COPY.convert });
}

/** The conversion dialog's job submit. */
export function convertToJobSubmit(dialog: Locator): Locator {
  return dialog.getByRole('button', { name: REQUEST_COPY.convertToJob });
}

/** The link from a converted request to its job. */
export function convertedJobLink(page: Page): Locator {
  return page.getByRole('link', { name: REQUEST_COPY.convertedJobLink });
}

/** The link from converted work back to its request. */
export function requestBacklink(page: Page, requestNumber: string): Locator {
  return page.getByRole('link', { name: `Anfrage ${requestNumber}` });
}

/** The detail's action that closes the request without work. */
export function requestCloseButton(page: Page): Locator {
  return page.getByRole('button', { name: REQUEST_COPY.close, exact: true });
}

/** The close dialog's required reason label. */
export function requestCloseReasonLabel(dialog: Locator): Locator {
  return dialog.getByText(REQUEST_COPY.closeReasonLabel, { exact: true });
}

export function requestCloseSubmit(dialog: Locator): Locator {
  return dialog.getByRole('button', { name: REQUEST_COPY.closeSubmit });
}

/** Moves a file of the request's „Dokumente & Bilder“ frame to the trash through its row menu. */
export async function moveRequestDocumentToTrash(page: Page, fileName: string): Promise<void> {
  const row = documentsRegion(page.getByRole('main'))
    .locator('[data-row-id]')
    .filter({ has: documentOpenButton(page, fileName) });
  await row.getByRole('button', { name: REQUEST_DOCUMENT_COPY.actions }).click();
  await page.getByRole('menuitem', { name: REQUEST_DOCUMENT_COPY.moveToTrash }).click();
  await page
    .getByRole('alertdialog')
    .getByRole('button', { name: REQUEST_DOCUMENT_COPY.moveToTrash })
    .click();
}

/** The confirmation that a request file moved to the trash. */
export function requestDocumentTrashedMessage(page: Page): Locator {
  return visibleText(page, REQUEST_DOCUMENT_COPY.movedToTrash);
}

// The request list is server-paged: a tab and the search navigate through the
// URL (?status=, ?q=), the search after a 250 ms debounce. The URL commits
// when the server page for that selection arrived, so an assertion after
// these steps reads the selected page and never the previous one.
export async function showRequestStatus(page: Page, status: keyof typeof REQUEST_STATUS_TABS): Promise<void> {
  await page.getByRole('tab', { name: REQUEST_STATUS_TABS[status], exact: true }).click();
  await expect(page).toHaveURL((url) => url.searchParams.get('status') === status, {
    timeout: 15_000,
  });
}

export async function searchRequests(page: Page, query: string): Promise<void> {
  await page.getByLabel(REQUEST_COPY.search).fill(query);
  await expect(page).toHaveURL((url) => (url.searchParams.get('q') ?? '') === query, { timeout: 15_000 });
}

export async function createRequestViaDialog(
  page: Page,
  options: {
    summary: string;
    requestNumber?: string;
    clientName?: string;
    siteName?: string;
    contactName?: string;
    callerName?: string;
    callerPhone?: string;
    callerEmail?: string;
    callerAddress?: string;
    details?: string;
    categoryLabel?: string;
    urgencyLabel?: string;
    sourceLabel?: string;
    receivedAtLocal?: string;
    assigneeName?: string;
  },
): Promise<PersistedRequest> {
  if ((options.siteName || options.contactName) && !options.clientName) {
    throw new Error('createRequestViaDialog: siteName/contactName require clientName');
  }

  await page.goto('/anfragen');
  await requestCaptureButton(page).click();
  await expect(page.getByRole('heading', { name: REQUEST_COPY.captureTitle })).toBeVisible();

  await page.locator('#request-summary').fill(options.summary);
  if (options.requestNumber !== undefined) {
    const requestNumberInput = page.locator('#request-number');
    // The generated suggestion arrives asynchronously. Let it settle before
    // replacing it so Playwright cannot interleave both controlled updates.
    await expect(requestNumberInput).toHaveValue(/.+/, { timeout: 15_000 });
    await requestNumberInput.fill(options.requestNumber);
    await expect(requestNumberInput).toHaveValue(options.requestNumber);
  }

  if (options.categoryLabel) {
    await page.locator('#request-category').click();
    await page.getByRole('option', { name: options.categoryLabel, exact: true }).click();
  }
  if (options.urgencyLabel) {
    await page.locator('#request-urgency').click();
    await page.getByRole('option', { name: options.urgencyLabel, exact: true }).click();
  }
  if (options.receivedAtLocal) {
    await typeIntoDateTimeField(page.getByRole('dialog'), 'request-received-at', options.receivedAtLocal);
  }

  if (options.clientName) {
    // Same searchable customer combobox as the job dialog.
    await customerPicker(page).click();
    await customerPickerSearch(page).fill(options.clientName);
    await page
      .getByRole('listbox')
      .getByRole('option')
      .filter({ hasText: options.clientName })
      .first()
      .click();
  }

  if (options.siteName) {
    await expect(page.locator('#request-site')).toBeVisible({
      timeout: 15_000,
    });
    await selectFromSearchable(page, page.locator('#request-site'), options.siteName);
  }
  if (options.contactName) {
    await expect(page.locator('#request-contact')).toBeVisible({
      timeout: 15_000,
    });
    await selectFromSearchable(page, page.locator('#request-contact'), options.contactName);
  }

  if (options.callerName) {
    await page.locator('#request-caller-name').fill(options.callerName);
  }
  if (options.callerPhone) {
    await page.locator('#request-caller-phone').fill(options.callerPhone);
  }
  if (options.callerEmail) {
    await page.locator('#request-caller-email').fill(options.callerEmail);
  }
  if (options.callerAddress) {
    await page.locator('#request-caller-address').fill(options.callerAddress);
  }
  if (options.details) {
    await page.locator('#request-details').fill(options.details);
  }
  if (options.sourceLabel) {
    await page.locator('#request-source').click();
    await page.getByRole('option', { name: options.sourceLabel, exact: true }).click();
  }
  if (options.assigneeName) {
    await selectFromSearchable(page, page.locator('#request-assignee'), options.assigneeName);
  }

  // The submit button carries the same label as the header trigger; scope it
  // to the dialog. Success navigates straight to the new request detail.
  await requestCaptureButton(page.getByRole('dialog')).click();
  await page.waitForURL(/\/anfragen\/[0-9a-f-]{36}/, { timeout: 20_000 });
  await expect(visibleText(page, options.summary)).toBeVisible({
    timeout: 15_000,
  });

  const requestId = page.url().match(/\/anfragen\/([0-9a-f-]{36})/)?.[1];
  if (!requestId) {
    throw new Error('createRequestViaDialog: could not read the request id from the URL');
  }
  return getRequestById(requestId);
}

export async function uploadDocumentOnRequestDetail(
  page: Page,
  filePath: string,
  expectedFileName: string,
): Promise<void> {
  // Assumes the request detail page is already open.
  await uploadIntoDocumentsSection(page, filePath, expectedFileName);
}

export async function convertRequestToJobViaDialog(
  page: Page,
  options?: {
    clientName?: string;
    plannedDate?: string;
    workTemplateName?: string;
    qualificationOverrideReason?: string;
  },
): Promise<void> {
  await requestConvertButton(page).click();
  await expect(page.getByRole('heading', { name: REQUEST_COPY.convertTitle })).toBeVisible();

  if (options?.clientName) {
    // Unknown-caller requests must resolve the customer inside the dialog.
    await customerPicker(page.getByRole('dialog')).click();
    await customerPickerSearch(page).fill(options.clientName);
    await page
      .getByRole('listbox')
      .getByRole('option')
      .filter({ hasText: options.clientName })
      .first()
      .click();
  }

  if (options?.plannedDate) {
    await typeIntoDatePickerById(page.getByRole('dialog'), 'convert-date', options.plannedDate);
  }
  if (options?.workTemplateName) {
    await selectFromSearchable(
      page,
      workTemplateSelect(page.getByRole('dialog'), 'job'),
      options.workTemplateName,
    );
  }

  // The job number is suggested asynchronously after the dialog opens;
  // submitting before it arrives fails validation like it would for a user.
  await expect(page.locator('#convert-number')).toHaveValue(/.+/, {
    timeout: 15_000,
  });

  await convertToJobSubmit(page.getByRole('dialog')).click();
  if (options?.qualificationOverrideReason) {
    await assignDespiteQualificationWarning(page, options.qualificationOverrideReason);
  }
  await expect(page.getByRole('dialog')).toHaveCount(0, { timeout: 20_000 });
  await expect(visibleText(page, REQUEST_DETAIL_TEXT.converted)).toBeVisible({
    timeout: 15_000,
  });
}

export async function matchRequestToExistingCustomer(page: Page, clientName: string): Promise<void> {
  await page.getByRole('button', { name: REQUEST_COPY.matchCustomer }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('heading', { name: REQUEST_COPY.matchTitle })).toBeVisible();
  await customerPicker(dialog).click();
  await customerPickerSearch(page).fill(clientName);
  await page.getByRole('listbox').getByRole('option').filter({ hasText: clientName }).first().click();
  await dialog.getByRole('button', { name: REQUEST_COPY.match, exact: true }).click();
  await expect(dialog).toHaveCount(0, { timeout: 15_000 });
  await expectVisibleAfterSave(page, clientName);
}

export async function convertRequestToProjectViaDialog(
  page: Page,
  projectNumber: string,
  workTemplateName?: string,
): Promise<void> {
  await requestConvertButton(page).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('heading', { name: REQUEST_COPY.convertTitle })).toBeVisible();
  await dialog.getByRole('tab', { name: REQUEST_COPY.projectTab }).click();
  await expect(dialog.locator('#convert-number')).toHaveValue(/.+/, {
    timeout: 15_000,
  });
  await dialog.locator('#convert-number').fill(projectNumber);
  if (workTemplateName) {
    await selectFromSearchable(page, workTemplateSelect(dialog, 'project'), workTemplateName);
  }
  await dialog.getByRole('button', { name: REQUEST_COPY.convertToProject }).click();
  await expect(dialog).toHaveCount(0, { timeout: 20_000 });
  await expect(visibleText(page, REQUEST_DETAIL_TEXT.converted)).toBeVisible({
    timeout: 15_000,
  });
}

export async function setRequestStatusFromDetail(
  page: Page,
  change: keyof typeof REQUEST_STATUS_ACTIONS,
): Promise<void> {
  const { action, banner, next } = REQUEST_STATUS_ACTIONS[change];
  // The header shows the target status with the click; the banner confirms
  // the write, and only then is the reload below a read of persisted state.
  await expectBannerAfter(page, banner, () =>
    page.getByRole('button', { name: action, exact: true }).click(),
  );
  const expectedAction = page.getByRole('button', {
    name: next,
    exact: true,
  });
  await expect(expectedAction).toBeVisible({ timeout: 15_000 });
  await page.reload();
  await expect(expectedAction).toBeVisible({ timeout: 15_000 });
}

export async function closeRequestViaDialog(page: Page, reasonLabel: string): Promise<void> {
  const detailUrl = page.url();
  for (let attempt = 0; attempt < 2; attempt += 1) {
    if (page.url() !== detailUrl) await page.goto(detailUrl);
    // The request-created event can reach the newly mounted detail page after
    // navigation. Drain the shared 150 ms router-refresh debounce (REALTIME_DEBOUNCE_MS) first.
    await page.waitForTimeout(300);
    if (page.url() !== detailUrl) {
      if (attempt === 0) continue;
      throw new Error('closeRequestViaDialog: detail route refreshed away');
    }

    await requestCloseButton(page).click();
    await expect(page.getByRole('heading', { name: REQUEST_COPY.closeTitle })).toBeVisible();
    const dialog = page.getByRole('dialog');
    try {
      await dialog.locator('#close-reason').click({ timeout: 5_000 });
      await page.getByRole('option', { name: reasonLabel, exact: true }).click({ timeout: 5_000 });
      await requestCloseSubmit(dialog).click({ timeout: 5_000 });
      await expect(page.getByRole('dialog')).toHaveCount(0, {
        timeout: 15_000,
      });
    } catch (error) {
      const dialogWasInterrupted = page.url() !== detailUrl || !(await dialog.isVisible().catch(() => false));
      if (attempt === 0 && dialogWasInterrupted) continue;
      throw error;
    }

    // Reload from the server so success cannot be confused with a client-side
    // modal close that raced the Realtime refresh.
    await page.goto(detailUrl);
    const persistedClosedReason = await expect(visibleText(page, REQUEST_DETAIL_TEXT.closedWithoutWork))
      .toBeVisible({ timeout: 5_000 })
      .then(() => true)
      .catch(() => false);
    if (persistedClosedReason) return;
    if (attempt === 1) {
      throw new Error('closeRequestViaDialog: request remained open after retry');
    }
  }
}

// Assigns a responsible person on the currently open request detail page via
// the edit dialog (P1-02 storage, first surfaced as an ownership signal here).
export async function assignRequestAssigneeViaEditDialog(page: Page, assigneeName: string): Promise<void> {
  await page.getByRole('button', { name: SHARED_COPY.action.edit, exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await selectFromSearchable(page, dialog.locator('#edit-request-assignee'), assigneeName);
  await dialog.getByRole('button', { name: SHARED_COPY.action.save, exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0, { timeout: 15_000 });
  await expectVisibleAfterSave(page, assigneeName);
}

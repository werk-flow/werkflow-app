import { expect, type Locator, type Page } from '@playwright/test';
import { WORK_BLOCKER_REASON_LABELS, type WorkBlockerReason } from '../../../../lib/work-lifecycle/types';
import { parkplatzButton } from '../plantafel';
import { planningWarningReason, planningWarningSave, showPlanningMonth } from './calendar';
import { confirmed, planningWarningDialog, selectFromSearchable, typeIntoDatePickerById } from './shared';

// P1-12: dispatch, Parkplatz context, customer commitments, batch moves.

/** Copy of the dispatch panel, its dialogs and the job's dispatch card that no pure product module owns. */
const DISPATCH_COPY = {
  panel: 'Einsätze',
  openChallenges: 'Offene Rückfragen',
  send: 'Einsatz senden',
  sendFromParkplatz: /^Einsatz für .* senden$/,
  acknowledge: 'Einsatz bestätigen',
  challenge: 'Rückfrage stellen',
  challengeSend: 'Rückfrage senden',
  keepPlan: /Plan beibehalten/,
  keep: 'Beibehalten',
  recordCommitment: 'Zusage erfassen',
  recordAnyCommitment: /^(Zusage erfassen|Neue Zusage erfassen)$/,
  commitmentDialog: 'Kundenzusage erfassen',
  batchMode: 'Verschieben',
  checkImpact: 'Auswirkungen prüfen',
  previewDialog: 'Verschiebung prüfen',
  moveNow: 'Jetzt verschieben',
  batchShiftMissing: 'Gib eine Verschiebung in Tagen oder eine neue Uhrzeit an.',
  employeeSearch: /Mitarbeiter suchen/,
  parkingContextDialog: 'Parkplatz-Kontext',
  saveParkingContext: 'Kontext speichern',
} as const;

/** The reason dialogs of the dispatch surfaces, by their headings. */
const REASON_DIALOGS = {
  challenge: 'Rückfrage zum Einsatz',
  keepPlan: 'Plan beibehalten',
  withdrawDispatch: 'Einsatz zurückziehen',
  withdrawCommitment: 'Kundenzusage zurückziehen',
} as const;

/** A row action that opens a reason dialog, and the dialog's confirming button. */
const ROW_REASON_ACTIONS = {
  withdrawDispatch: { open: 'Einsatz zurückziehen …', confirm: 'Einsatz zurückziehen' },
  withdrawCommitment: { open: 'Zusage zurückziehen …', confirm: 'Zusage zurückziehen' },
} as const;

/** The readiness picture of the issue dialog, in the product's words. */
export const DISPATCH_READINESS_COPY = {
  label: {
    capacity: 'Kapazität & Verfügbarkeit',
    qualification: 'Qualifikationen',
    site: 'Einsatzort',
    travel: 'Fahrzeit',
    tools: 'Werkzeuge',
  },
  travelUnknown: 'Fahrzeit nicht bewertet.',
  travelConflict: 'keine Zeit zwischen',
  materialLabel: 'Material (nicht reserviert)',
  materialLineEnd: '– nicht reserviert.',
  toolsUnknownLabel: '(nicht bewertet)',
  toolsUnknown: 'Werkzeugverfügbarkeit nicht bewertet.',
} as const;

/** Notes the dispatch surfaces show about a commitment, by purpose. */
export const DISPATCH_COMMITMENT_COPY = {
  noMessageSent: 'Es wird keine Nachricht versendet.',
  customerNotNotified: 'Der Kunde wird dadurch nicht benachrichtigt.',
  committedToCustomer: 'Dem Kunden zugesagt',
  mismatch: 'weicht vom Plan ab',
} as const;

/** The consequences the batch preview names before anything moves. */
const BATCH_PREVIEW_NOTICES = {
  commitmentMismatch: 'Kundenzusagen weichen danach ab',
  oneConfirmationInvalidated: /1 Bestätigung wird ungültig/,
  planningWarnings: /Planungshinweis/,
} as const;

export async function openDispatchPanel(page: Page, calendarDate?: string): Promise<void> {
  await showPlanningMonth(page, calendarDate);
  await page.getByRole('main').getByTestId('dispatch-panel-toggle').click();
  await expect(dispatchPanel(page)).toBeVisible();
}

/** Proves the panel toggle exists nowhere in the DOM: a field worker never sees the dispatch surface. */
export async function expectNoDispatchPanelToggle(page: Page): Promise<void> {
  await expect(page.getByTestId('dispatch-panel-toggle')).toHaveCount(0);
}

// The dispatch panel has a stable state hook; its landmark is the complementary region.
export function dispatchPanel(page: Page): Locator {
  return page.locator('[data-dispatch-panel]');
}

/** The dispatch panel as its complementary landmark „Einsätze“. */
export function dispatchPanelRegion(page: Page): Locator {
  return page.getByRole('complementary', { name: DISPATCH_COPY.panel });
}

export function openChallengesRegion(page: Page): Locator {
  return dispatchPanelRegion(page).getByRole('region', { name: DISPATCH_COPY.openChallenges });
}

export function dispatchOccurrenceRow(page: Page, title: string): Locator {
  return dispatchPanelOccurrences(page, title);
}

/** The visit rows with this title inside a scope (the page, the panel or its landmark). */
export function dispatchPanelOccurrences(scope: Page | Locator, title: string): Locator {
  return confirmed(scope.locator('[data-dispatch-occurrence]').filter({ hasText: title }));
}

export function dispatchIssueDialog(page: Page): Locator {
  return page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: DISPATCH_COPY.send }) });
}

/** The send button of a panel row or of the issue dialog. */
export function dispatchSendButton(scope: Locator): Locator {
  return scope.getByRole('button', { name: DISPATCH_COPY.send });
}

/** Opens the issue dialog of the panel row and waits until its readiness picture loaded. */
export async function openIssueDialogForPanelRow(page: Page, title: string): Promise<Locator> {
  const row = dispatchOccurrenceRow(page, title);
  await expect(row).toBeVisible();
  await dispatchSendButton(row).click();
  const dialog = dispatchIssueDialog(page);
  await expect(readinessDimension(dialog, 'tools', 'unknown')).toBeVisible();
  return dialog;
}

/** One readiness dimension of the issue dialog; with a state, only while it has that state. */
export function readinessDimension(
  dialog: Locator,
  key: string,
  state?: 'ok' | 'warning' | 'unknown',
): Locator {
  return dialog.locator(
    state
      ? `[data-readiness-key="${key}"][data-readiness-state="${state}"]`
      : `[data-readiness-key="${key}"]`,
  );
}

// Issues the dispatch for the earliest panel row matching the title, and
// asserts the honest readiness picture on the way: tools are never assessed
// in this slice and must render as the labeled unknown, never as success.
export async function issueDispatchForOccurrence(
  page: Page,
  title: string,
  beforeSubmit?: () => void | Promise<void>,
): Promise<void> {
  const row = dispatchOccurrenceRow(page, title).first();
  await expect(row).toBeVisible();
  await dispatchSendButton(row).click();
  const dialog = dispatchIssueDialog(page);
  await expect(readinessDimension(dialog, 'tools', 'unknown')).toBeVisible();
  await beforeSubmit?.();
  await dispatchSendButton(dialog).click();
  await expect(dialog).toHaveCount(0);
  await expect(row.locator('[data-recipient-state]').first()).toBeVisible();
}

/** The note a dispatch card shows: „Hinweis: …“. */
export function dispatchNoteText(note: string): string {
  return `Hinweis: ${note}`;
}

/** Opens the recipient picker of the issue dialog and searches for a person. */
export async function searchDispatchRecipients(page: Page, dialog: Locator, name: string): Promise<void> {
  await dialog.locator('#dispatch-recipients').click();
  await page.getByPlaceholder(DISPATCH_COPY.employeeSearch).fill(name);
}

export function dispatchRecipientOption(page: Page, name: string): Locator {
  return page.getByRole('listbox').getByRole('option').filter({ hasText: name });
}

export function jobDispatchSection(page: Page): Locator {
  return page.getByRole('main').getByTestId('job-dispatch-section');
}

/** The acknowledgement's label; the field work pack makes it its primary action while a dispatch waits. */
export const DISPATCH_ACKNOWLEDGE_ACTION = DISPATCH_COPY.acknowledge;

export function acknowledgeDispatchButton(section: Locator): Locator {
  return section.getByRole('button', { name: DISPATCH_COPY.acknowledge });
}

/** The challenge action of the dispatch card; pass the section or the page. */
export function challengeDispatchButton(scope: Page | Locator): Locator {
  return scope.getByRole('button', { name: DISPATCH_COPY.challenge });
}

export async function expectDispatchStateOnJobPage(
  page: Page,
  jobNumber: string,
  state: string,
): Promise<void> {
  await page.goto(`/auftraege/${jobNumber}`);
  const section = jobDispatchSection(page);
  await expect(section.locator(`[data-dispatch-state="${state}"]`)).toBeVisible();
}

export async function acknowledgeDispatchOnJobPage(page: Page, jobNumber: string): Promise<void> {
  await page.goto(`/auftraege/${jobNumber}`);
  const section = jobDispatchSection(page);
  await expect(section).toBeVisible();
  await acknowledgeDispatchButton(section).click();
  await expect(section.locator('[data-dispatch-state="bestaetigt"]')).toBeVisible();
}

/** A reason dialog of the dispatch surfaces, named by its heading. */
export function dispatchReasonDialog(page: Page, kind: keyof typeof REASON_DIALOGS): Locator {
  return page.getByRole('dialog').filter({ has: page.getByRole('heading', { name: REASON_DIALOGS[kind] }) });
}

/** The reason field of an open dispatch reason dialog. */
export function dispatchReasonField(dialog: Locator): Locator {
  return dialog.locator('#dispatch-reason-dialog');
}

/** The optional note of the issue dialog that travels with the dispatch. */
export function dispatchNoteField(dialog: Locator): Locator {
  return dialog.locator('#dispatch-note');
}

/** The job's dispatch card while the dispatch has this state (`ausstehend`, `bestaetigt`, `rueckfrage`). */
export function dispatchStateCard(section: Locator, state: string): Locator {
  return confirmed(section.locator(`[data-dispatch-state="${state}"]`));
}

/** A recipient's state on a dispatch row; without a state, every recipient state. */
export function dispatchRecipientState(row: Locator, state?: string): Locator {
  return row.locator(state ? `[data-recipient-state="${state}"]` : '[data-recipient-state]');
}

/** The readiness dimensions of the issue dialog that have this state. */
export function readinessDimensionsInState(dialog: Locator, state: 'ok' | 'warning' | 'unknown'): Locator {
  return dialog.locator(`[data-readiness-state="${state}"]`);
}

/** The icon of one readiness dimension, by the state it shows. */
export function readinessIcon(dimension: Locator, icon: 'ok' | 'warning' | 'unknown'): Locator {
  return dimension.locator(`[data-readiness-icon="${icon}"]`);
}

/** The Parkplatz context line of a card; with `set`, only once the context is recorded. */
export function parkingContextLine(card: Locator, state?: 'set'): Locator {
  return confirmed(card.locator(state ? `[data-parking-context="${state}"]` : '[data-parking-context]'));
}

/** The commitment marker of a dispatch row; with a value, only while it is or is not a mismatch. */
export function commitmentMismatchMarker(row: Locator, mismatch?: boolean): Locator {
  return row.locator(
    mismatch === undefined ? '[data-commitment-mismatch]' : `[data-commitment-mismatch="${mismatch}"]`,
  );
}

/** Fills and sends the challenge dialog that the dispatch card's challenge action opened. */
export async function submitDispatchChallenge(page: Page, reason: string): Promise<void> {
  const dialog = dispatchReasonDialog(page, 'challenge');
  await dialog.locator('#dispatch-challenge-reason').fill(reason);
  await dialog.getByRole('button', { name: DISPATCH_COPY.challengeSend }).click();
  await expect(dialog).toHaveCount(0);
}

export async function challengeDispatchOnJobPage(
  page: Page,
  jobNumber: string,
  reason: string,
): Promise<void> {
  await page.goto(`/auftraege/${jobNumber}`);
  const section = jobDispatchSection(page);
  await expect(section).toBeVisible();
  await challengeDispatchButton(section).click();
  await submitDispatchChallenge(page, reason);
  await expect(section.locator('[data-dispatch-state="rueckfrage"]')).toBeVisible();
}

export async function resolveDispatchChallengeInPanel(page: Page, reason: string): Promise<void> {
  const panel = dispatchPanel(page);
  await panel.getByRole('button', { name: DISPATCH_COPY.keepPlan }).first().click();
  const dialog = dispatchReasonDialog(page, 'keepPlan');
  await dialog.locator('#dispatch-reason-dialog').fill(reason);
  await dialog.getByRole('button', { name: DISPATCH_COPY.keep, exact: true }).click();
  await expect(dialog).toHaveCount(0);
}

/** The row action that opens a withdraw dialog. */
export function rowReasonAction(row: Locator, action: keyof typeof ROW_REASON_ACTIONS): Locator {
  return row.getByRole('button', { name: ROW_REASON_ACTIONS[action].open });
}

/** The confirming button of the withdraw dialog that the row action opened. */
export function reasonDialogConfirm(dialog: Locator, action: keyof typeof ROW_REASON_ACTIONS): Locator {
  return dialog.getByRole('button', { name: ROW_REASON_ACTIONS[action].confirm, exact: true });
}

export async function openParkplatzPanel(page: Page): Promise<void> {
  await page.goto('/kalender');
  // The button's accessible name includes the live count badge.
  await parkplatzButton(page).click();
  await expect(page.locator('[data-parkplatz-panel]')).toBeVisible();
}

export function parkplatzCard(page: Page, title: string): Locator {
  // Filter instead of interpolating the title into a CSS selector.
  return confirmed(
    page.locator('[data-parkplatz-card]').filter({ has: page.getByText(title, { exact: true }) }),
  );
}

/** The send action of a Parkplatz card. */
export function parkplatzDispatchButton(card: Locator): Locator {
  return card.getByRole('button', { name: DISPATCH_COPY.sendFromParkplatz });
}

/** The Parkplatz card's action that opens the context dialog of a parked job with a context. */
export function parkplatzEditContextButton(card: Locator, title: string): Locator {
  return card.getByRole('button', { name: `Parkplatz-Kontext für ${title} bearbeiten`, exact: true });
}

export async function dispatchParkedJobFromParkplatz(
  page: Page,
  options: { jobTitle: string; recipientName: string },
): Promise<void> {
  const card = parkplatzCard(page, options.jobTitle);
  await expect(card).toBeVisible();
  await parkplatzDispatchButton(card).click();
  const dialog = dispatchIssueDialog(page);
  await expect(readinessDimension(dialog, 'tools', 'unknown')).toBeVisible();
  await searchDispatchRecipients(page, dialog, options.recipientName);
  const recipient = dispatchRecipientOption(page, options.recipientName);
  if ((await recipient.getAttribute('aria-selected')) !== 'true') await recipient.click();
  await dialog.getByRole('heading').click();
  await dispatchSendButton(dialog).click();
  await expect(dialog).toHaveCount(0);
}

/** The context dialog that a park by drag opens before anything is persisted. */
export function parkingContextDialog(page: Page): Locator {
  return page.getByRole('dialog').filter({
    has: page.getByRole('heading', { name: DISPATCH_COPY.parkingContextDialog }),
  });
}

/** Fills the Parkplatz context: reason, optional note, responsible person and review date. */
export async function fillParkingContext(
  page: Page,
  dialog: Locator,
  input: { reason: WorkBlockerReason; note?: string; responsibleName: string; reviewDate: string },
): Promise<void> {
  await selectFromSearchable(
    page,
    dialog.locator('#parking-reason'),
    WORK_BLOCKER_REASON_LABELS[input.reason],
  );
  if (input.note !== undefined) await dialog.locator('#parking-note').fill(input.note);
  await selectFromSearchable(page, dialog.locator('#parking-responsible'), input.responsibleName);
  await typeIntoDatePickerById(dialog, 'parking-review-date', input.reviewDate);
}

/** A field of the Parkplatz context dialog. */
export function parkingContextField(dialog: Locator, field: 'reason' | 'note' | 'responsible'): Locator {
  return dialog.locator(`#parking-${field}`);
}

export function parkingContextSave(dialog: Locator): Locator {
  return dialog.getByRole('button', { name: DISPATCH_COPY.saveParkingContext, exact: true });
}

export function recordCommitmentButton(row: Locator): Locator {
  return row.getByRole('button', { name: DISPATCH_COPY.recordCommitment, exact: true });
}

export function commitmentDialog(page: Page): Locator {
  return page.getByRole('dialog').filter({
    has: page.getByRole('heading', { name: DISPATCH_COPY.commitmentDialog }),
  });
}

/** The channel picker of the commitment dialog. */
export function commitmentSourceField(dialog: Locator): Locator {
  return dialog.locator('#commitment-source');
}

export function commitmentSubmit(dialog: Locator): Locator {
  return dialog.getByRole('button', { name: DISPATCH_COPY.recordCommitment });
}

/** An arrival window as the dispatch surfaces print it: „06:00–08:00 Uhr“. */
export function arrivalWindowText(from: string, to: string): string {
  return `${from}–${to} Uhr`;
}

/** The commitment summary of a panel row: „Zusage: 24.08.2026, 06:00–08:00 Uhr“. */
export function commitmentSummaryText(germanDate: string, from: string, to: string): string {
  return `Zusage: ${germanDate}, ${arrivalWindowText(from, to)}`;
}

// Records a date-only customer commitment for the panel row (the dialog
// prefills the occurrence's Berlin date). Recording sends NO message.
export async function recordCommitmentForOccurrence(page: Page, title: string): Promise<void> {
  const row = dispatchOccurrenceRow(page, title).first();
  await expect(row).toBeVisible();
  await row.getByRole('button', { name: DISPATCH_COPY.recordAnyCommitment }).click();
  const dialog = commitmentDialog(page);
  await commitmentSubmit(dialog).click();
  await expect(dialog).toHaveCount(0);
}

/** The panel's switch into batch selection. */
export function batchModeToggle(panel: Locator): Locator {
  return panel.getByRole('button', { name: DISPATCH_COPY.batchMode, exact: true });
}

/** The panel's own selection counter: „1 Besuch ausgewählt“, „3 Besuche ausgewählt“. */
export function batchSelectionCount(panel: Locator, count: number): Locator {
  return panel.getByText(`${count} Besuch${count === 1 ? '' : 'e'} ausgewählt`, {
    exact: true,
  });
}

export function checkBatchImpactButton(panel: Locator): Locator {
  return panel.getByRole('button', { name: DISPATCH_COPY.checkImpact });
}

/** The batch form's reason field. */
export function batchReasonField(panel: Locator): Locator {
  return panel.locator('#batch-reason');
}

/** The batch form's whole-day shift field. */
export function batchDayShiftField(panel: Locator): Locator {
  return panel.locator('#batch-day-shift');
}

/** The occurrences the batch preview lists, in its order. */
export function batchPreviewItems(preview: Locator): Locator {
  return confirmed(preview.locator('[data-batch-preview-item]'));
}

export function batchShiftMissingError(panel: Locator): Locator {
  return panel.getByText(DISPATCH_COPY.batchShiftMissing, { exact: true });
}

export function batchPreviewDialog(page: Page): Locator {
  return page.getByRole('dialog').filter({
    has: page.getByRole('heading', { name: DISPATCH_COPY.previewDialog }),
  });
}

/** A consequence the batch preview names. */
export function batchPreviewNotice(preview: Locator, notice: keyof typeof BATCH_PREVIEW_NOTICES): Locator {
  const text = BATCH_PREVIEW_NOTICES[notice];
  return typeof text === 'string' ? preview.getByText(text, { exact: false }) : preview.getByText(text);
}

/** An instant as the batch preview prints it: „24.08., 06:00 Uhr“. */
export function batchPreviewInstant(dayMonth: string, time: string): string {
  return `${dayMonth}, ${time} Uhr`;
}

export function moveNowButton(preview: Locator): Locator {
  return preview.getByRole('button', { name: DISPATCH_COPY.moveNow });
}

export async function startBatchRescheduleInPanel(
  page: Page,
  options: {
    titles: string[];
    /** Total rows the selection must cover across all titles. */
    expectedCount: number;
    dayShiftText: string;
    reason: string;
  },
): Promise<Locator> {
  const panel = dispatchPanel(page);
  await batchModeToggle(panel).click();
  for (const title of options.titles) {
    const rows = dispatchPanelOccurrences(panel, title);
    const rowCount = await rows.count();
    for (let index = 0; index < rowCount; index += 1) {
      await rows.nth(index).getByRole('checkbox').check();
    }
  }
  // A Realtime re-render between clicks could reorder rows; the panel's own
  // selection counter is the authoritative proof every row got selected.
  await expect(batchSelectionCount(panel, options.expectedCount)).toBeVisible({ timeout: 10_000 });
  await panel.locator('#batch-day-shift').fill(options.dayShiftText);
  await panel.locator('#batch-reason').fill(options.reason);
  await checkBatchImpactButton(panel).click();
  const preview = batchPreviewDialog(page);
  await expect(preview).toBeVisible();
  return preview;
}

// Commits the previewed batch. The separate planning-warning dialog appears
// only when the shared assessment found conflicts (e.g. the focused world has
// no schedules); supplying the override reason covers both modes.
export async function confirmBatchReschedule(
  page: Page,
  preview: Locator,
  overrideReason: string,
): Promise<void> {
  await moveNowButton(preview).click();
  const warning = planningWarningDialog(page);
  await expect
    .poll(async () => {
      if (await warning.isVisible().catch(() => false)) return 'warning';
      if (!(await preview.isVisible().catch(() => false))) return 'closed';
      return 'pending';
    })
    .not.toBe('pending');
  if (await warning.isVisible().catch(() => false)) {
    await planningWarningReason(warning).fill(overrideReason);
    await planningWarningSave(warning).click();
  }
  await expect(preview).toHaveCount(0);
}

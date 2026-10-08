import { expect, type Locator, type Page } from '@playwright/test';
import { SICKNESS_EVIDENCE_LABELS, SICKNESS_TYPE_LABELS } from '../../../../lib/sickness/types';
import type { SicknessAbsenceType, SicknessEvidenceStatus } from '../../../../lib/sickness/types';
import { VACATION_PORTION_LABELS } from '../../../../lib/vacation/types';
import { confirmed, SHARED_COPY, typeIntoDatePicker, visibleText } from './shared';
import {
  clockInConfirmationButton,
  clockInLauncher,
  clockInSheetHeading,
  runningClockLauncher,
} from './time-tracking';

// P1-08: sickness / privacy-sensitive absence. A report is a fact, not a
// request — every step asserts the resulting state transition, never a
// transient flash (inherited rows could satisfy texts alone).

/** Copy of the sickness surfaces that no pure product module owns. */
export const SICKNESS_COPY = {
  reportSickness: 'Krank melden',
  recordSickness: 'Krankmeldung erfassen',
  ownNoDiagnosisHint: 'bitte gib keine Diagnose an.',
  managerNoDetailsHint: 'Es werden keine Krankheitsdetails erfasst.',
  correctionReasonRequired: 'Bitte gib einen Grund für die Korrektur an.',
  recordedForYouNotice: 'Für dich wurde eine Krankmeldung erfasst',
  cancelledNoticePrefix: 'Krankmeldung storniert:',
  ownCancelledNoticeStart: 'Deine Krankmeldung',
  ownCancelledNoticeEnd: 'wurde storniert',
} as const;

/** Anything that would ask for a diagnosis; the privacy contract allows none. */
const DIAGNOSIS = /Diagnose/i;

/** The neutral calendar label of an absence: „Abwesend – Name“, with its open end or half day. */
export function absenceCalendarLabel(
  personName: string,
  options: { openEnded?: boolean; halfDay?: boolean } = {},
): string {
  const suffix = options.openEnded ? ' (bis auf Weiteres)' : options.halfDay ? ' (halber Tag)' : '';
  return `Abwesend – ${personName}${suffix}`;
}

/** A typed sickness label the shared calendar must never show. */
export function typedSicknessCalendarLabel(personName: string): string {
  return `Krank – ${personName}`;
}

/** The manager notice title of a self-report: „Krankmeldung: Name“. */
export function sicknessNoticeText(personName: string): string {
  return `Krankmeldung: ${personName}`;
}

/** The manager section's report summary: „Kind krank · Halbtägig · Nachweis ausstehend“. */
export function sicknessReportSummaryText(options: {
  type: SicknessAbsenceType;
  halfDay?: boolean;
  evidence: SicknessEvidenceStatus;
}): string {
  return [
    SICKNESS_TYPE_LABELS[options.type],
    ...(options.halfDay ? [VACATION_PORTION_LABELS.half_day] : []),
    SICKNESS_EVIDENCE_LABELS[options.evidence],
  ].join(' · ');
}

/** The own section's action that opens the self-report dialog. */
export function reportSicknessButton(page: Page): Locator {
  return page.getByRole('button', { name: SICKNESS_COPY.reportSickness });
}

/** The member detail's action that opens the office entry dialog. */
export function recordSicknessButton(page: Page): Locator {
  return page.getByRole('button', { name: SICKNESS_COPY.recordSickness });
}

/** The actions menu trigger of one report row on the member detail. */
function sicknessReportActionsButton(page: Page, rangeText: string): Locator {
  return page.getByRole('button', { name: `Aktionen für die Krankmeldung vom ${rangeText}` });
}

/** The save button of the correction dialog. */
export function saveSicknessCorrectionButton(dialog: Locator): Locator {
  return dialog.getByRole('button', { name: 'Korrektur speichern' });
}

/** A sickness dialog offers no field that could take a diagnosis. */
export async function expectNoDiagnosisControl(dialog: Locator): Promise<void> {
  await expect(dialog.getByLabel(DIAGNOSIS)).toHaveCount(0);
  await expect(dialog.getByRole('textbox', { name: DIAGNOSIS })).toHaveCount(0);
  await expect(dialog.getByRole('combobox', { name: DIAGNOSIS })).toHaveCount(0);
  await expect(dialog.getByPlaceholder(DIAGNOSIS)).toHaveCount(0);
}

export async function openOwnSicknessSection(page: Page): Promise<void> {
  await page.goto('/zeiterfassung');
  await expect(visibleText(page, 'Krankmeldung')).toBeVisible({
    timeout: 15_000,
  });
}

// Self-report. `endDigits` undefined = open-ended („bis auf Weiteres").
// The overlap hint against approved vacation is mode-dependent state, so the
// caller passes `expectVacationOverlapHint` derived from the database.
export async function reportOwnSicknessViaDialog(
  page: Page,
  options: {
    startDigits: string;
    endDigits?: string;
    halfDay?: boolean;
    type?: SicknessAbsenceType;
    expectVacationOverlapHint?: boolean;
  },
): Promise<void> {
  await openOwnSicknessSection(page);
  await reportSicknessButton(page).click();
  await expect(page.getByRole('heading', { name: SICKNESS_COPY.reportSickness })).toBeVisible();

  const dialog = page.getByRole('dialog');
  if (options.type) {
    await dialog.locator('#sickness-type').click();
    await page.getByRole('option', { name: SICKNESS_TYPE_LABELS[options.type], exact: true }).click();
  }
  await typeIntoDatePicker(dialog, 'Ab', options.startDigits);
  if (options.endDigits !== undefined) {
    await dialog.locator('#sickness-end-known').click();
    await typeIntoDatePicker(dialog, SHARED_COPY.field.rangeEnd, options.endDigits);
    if (options.halfDay) {
      await dialog.locator('#sickness-half-day').click();
    }
  }
  await dialog.getByRole('button', { name: SICKNESS_COPY.reportSickness }).click();
  if (options.expectVacationOverlapHint) {
    // The saved report shows the overlap hint until explicitly acknowledged.
    await expect(dialog.getByText('überschneidet sich mit genehmigtem Urlaub')).toBeVisible({
      timeout: 15_000,
    });
    await dialog.getByRole('button', { name: 'Verstanden' }).click();
  }
  await expect(page.getByRole('dialog')).toHaveCount(0, { timeout: 15_000 });
}

// Overlapping own active sickness is impossible (gist exclusion constraint);
// the dialog stays open with an understandable error.
export async function expectSicknessOverlapRejectedViaDialog(
  page: Page,
  options: { startDigits: string; endDigits?: string },
): Promise<void> {
  await openOwnSicknessSection(page);
  await reportSicknessButton(page).click();
  const dialog = page.getByRole('dialog');
  await typeIntoDatePicker(dialog, 'Ab', options.startDigits);
  if (options.endDigits !== undefined) {
    await dialog.locator('#sickness-end-known').click();
    await typeIntoDatePicker(dialog, SHARED_COPY.field.rangeEnd, options.endDigits);
  }
  await dialog.getByRole('button', { name: SICKNESS_COPY.reportSickness }).click();
  await expect(dialog.getByText('Für diesen Zeitraum ist bereits eine Krankmeldung erfasst.')).toBeVisible({
    timeout: 15_000,
  });
  await dialog.getByRole('button', { name: SHARED_COPY.action.cancel }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0, { timeout: 15_000 });
}

// Own close-out: set the end date on an active report identified by its
// current range text (aria-label). Success = the dialog closes and the row
// shows the new range.
export async function setOwnSicknessEndDateViaDialog(
  page: Page,
  options: { rangeText: string; endDigits: string; expectedRangeText: string },
): Promise<void> {
  await openOwnSicknessSection(page);
  await page
    .getByRole('button', {
      name: `Enddatum für die Krankmeldung vom ${options.rangeText} setzen`,
    })
    .click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await typeIntoDatePicker(dialog, 'Letzter Tag', options.endDigits);
  await dialog.getByRole('button', { name: 'Enddatum speichern' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0, { timeout: 15_000 });
  await expect(visibleText(page, options.expectedRangeText)).toBeVisible({
    timeout: 15_000,
  });
}

// Own cancellation of an active report from the own section, identified by
// its range text (aria-label).
export async function cancelOwnSicknessReport(page: Page, rangeText: string): Promise<void> {
  await openOwnSicknessSection(page);
  await page
    .getByRole('button', {
      name: `Krankmeldung vom ${rangeText} stornieren`,
    })
    .click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('heading', { name: 'Krankmeldung stornieren' })).toBeVisible();
  await dialog.getByRole('button', { name: SHARED_COPY.action.cancelRecord, exact: true }).click();
  await expect(dialog).toHaveCount(0, { timeout: 15_000 });
}

// Office entry on the currently open member/personnel detail (the 7:00
// phone-call-in path). `endDigits` undefined = open-ended.
export async function recordSicknessForMemberViaSection(
  page: Page,
  options: {
    startDigits: string;
    endDigits?: string;
    halfDay?: boolean;
    type?: SicknessAbsenceType;
    evidenceRequired?: boolean;
    expectVacationOverlapHint?: boolean;
  },
): Promise<void> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    await page.waitForTimeout(300);
    await recordSicknessButton(page).click();
    await expect(page.getByRole('heading', { name: SICKNESS_COPY.recordSickness })).toBeVisible();
    const dialog = page.getByRole('dialog');
    let submitted = false;
    try {
      if (options.type) {
        await dialog.locator('#record-sickness-type').click();
        await page.getByRole('option', { name: SICKNESS_TYPE_LABELS[options.type], exact: true }).click();
      }
      await typeIntoDatePicker(dialog, 'Ab', options.startDigits);
      if (options.endDigits !== undefined) {
        await dialog.locator('#record-sickness-end-known').click();
        await typeIntoDatePicker(dialog, SHARED_COPY.field.rangeEnd, options.endDigits);
        if (options.halfDay) {
          await dialog.locator('#record-sickness-half-day').click();
        }
      }
      if (options.evidenceRequired) {
        await dialog.locator('#record-sickness-evidence').click();
      }
      submitted = true;
      await dialog.getByRole('button', { name: SICKNESS_COPY.recordSickness }).click();
      if (options.expectVacationOverlapHint) {
        // The saved report shows the overlap hint until explicitly acknowledged.
        await expect(dialog.getByText('überschneidet sich mit genehmigtem Urlaub')).toBeVisible({
          timeout: 15_000,
        });
        await dialog.getByRole('button', { name: 'Verstanden' }).click();
      }
      await expect(page.getByRole('dialog')).toHaveCount(0, {
        timeout: 15_000,
      });
      return;
    } catch (error) {
      const interruptedBeforeSubmit = !submitted && !(await dialog.isVisible().catch(() => false));
      if (attempt === 0 && interruptedBeforeSubmit) continue;
      throw error;
    }
  }

  throw new Error('recordSicknessForMemberViaSection: dialog remained interrupted');
}

const SICKNESS_REPORT_MENU_ITEMS = {
  correct: 'Korrigieren',
  evidence: 'Nachweis verwalten',
  cancel: SHARED_COPY.action.cancelRecord,
} as const;

// Manager actions on one report row of the member-detail section, addressed
// by the report's range text (the per-item aria-label disambiguates).
export async function openSicknessReportMenu(
  page: Page,
  rangeText: string,
  item: keyof typeof SICKNESS_REPORT_MENU_ITEMS,
): Promise<void> {
  await sicknessReportActionsButton(page, rangeText).click();
  await page.getByRole('menuitem', { name: SICKNESS_REPORT_MENU_ITEMS[item] }).click();
}

export async function setSicknessEvidenceViaMenu(
  page: Page,
  rangeText: string,
  options: { required: boolean; received?: boolean },
): Promise<void> {
  await openSicknessReportMenu(page, rangeText, 'evidence');
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  const requiredBox = dialog.locator('#evidence-required');
  const isChecked = (await requiredBox.getAttribute('data-state')) === 'checked';
  if (isChecked !== options.required) {
    await requiredBox.click();
  }
  if (options.required) {
    const receivedBox = dialog.locator('#evidence-received');
    const receivedChecked = (await receivedBox.getAttribute('data-state')) === 'checked';
    if (receivedChecked !== (options.received ?? false)) {
      await receivedBox.click();
    }
  }
  await dialog.getByRole('button', { name: SHARED_COPY.action.save, exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0, { timeout: 15_000 });
}

export async function cancelSicknessReportViaMenuWithReason(
  page: Page,
  rangeText: string,
  reason: string,
): Promise<void> {
  await openSicknessReportMenu(page, rangeText, 'cancel');
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await dialog.locator('#cancel-sickness-reason').fill(reason);
  await dialog.getByRole('button', { name: SHARED_COPY.action.cancelRecord, exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0, { timeout: 15_000 });
  // The row flips to the terminal state — the precise transition, not a text
  // an inherited row could already satisfy.
  await expect(
    confirmed(page.locator('[data-sickness-report]'))
      .filter({ hasText: rangeText })
      .getByText('Storniert')
      .first(),
  ).toBeVisible({ timeout: 15_000 });
}

// Clock-in on a sick day succeeds with a visible notice (warn, never block).
export async function expectClockInNoticeForSickness(page: Page): Promise<void> {
  await page.goto('/dashboard');
  await clockInLauncher(page).click();
  await expect(clockInSheetHeading(page)).toBeVisible();
  await clockInConfirmationButton(page).click();
  await expect(visibleText(page, 'Für heute liegt eine Krankmeldung vor')).toBeVisible({
    timeout: 15_000,
  });
  // Clocked IN despite the notice — the warn-not-block contract.
  await expect(runningClockLauncher(page)).toBeVisible({
    timeout: 15_000,
  });
}

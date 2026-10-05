import { expect, type Locator, type Page } from '@playwright/test';
import { SHARED_COPY, expectBannerAfter, typeIntoDatePicker, visibleText } from './shared';
import {
  clockInConfirmationButton,
  clockInLauncher,
  clockInSheetHeading,
  runningClockLauncher,
  timeApprovalsTab,
} from './time-tracking';

// ============================================
// P1-06 — Vacation requests, decisions, balance
// ============================================

/** Copy of the vacation surfaces that no pure product module owns. */
export const VACATION_COPY = {
  requestVacation: 'Urlaub beantragen',
  rangeStart: SHARED_COPY.field.rangeStart,
  rangeEnd: SHARED_COPY.field.rangeEnd,
  submitRequest: 'Antrag einreichen',
  noEntitlement: 'Kein Urlaubsanspruch hinterlegt',
  approverNoLongerResponsible:
    'Du bist für diese Urlaubsfreigabe nicht mehr verantwortlich. Die Ansicht wurde aktualisiert.',
} as const;

/** The balance's taken counter without its unit: „9 von 30“. */
export function vacationTakenRatio(taken: string | number, entitlement: number): string {
  return `${taken} von ${entitlement}`;
}

/** The balance's taken counter: „0,5 von 30 Tagen genommen“ (taken comes formatted). */
export function vacationTakenText(taken: string | number, entitlement: number): string {
  return `${vacationTakenRatio(taken, entitlement)} Tagen genommen`;
}

/** The balance's remaining days: „29,5 Tage Resturlaub“ (days come formatted). */
export function vacationRemainingText(days: string | number): string {
  return `${days} Tage Resturlaub`;
}

/** A pending request's day count in the own list: „2 (vorläufig)“. */
export function provisionalVacationDaysText(formattedDays: string): string {
  return `${formattedDays} (vorläufig)`;
}

/** The request dialog's day preview: „Berechnete Urlaubstage: 0,5“. */
export function vacationPreviewText(formattedDays: string): string {
  return `Berechnete Urlaubstage: ${formattedDays}`;
}

/** The calendar bar label of a vacation; a pending request carries „(angefragt)“. */
export function vacationCalendarLabel(personName: string, options: { requested?: boolean } = {}): string {
  return `Urlaub – ${personName}${options.requested ? ' (angefragt)' : ''}`;
}

/** The banner that confirms an approval. */
export function vacationApprovedBanner(personName: string): string {
  return `Der Urlaubsantrag von ${personName} wurde genehmigt.`;
}

/** The approval card's approve action for one person's request. */
export function approveVacationButton(page: Page, personName: string): Locator {
  return page.getByRole('button', { name: `Urlaubsantrag von ${personName} genehmigen` });
}

/** The own vacation section's action that opens the request dialog. */
export function requestVacationButton(page: Page): Locator {
  return page.getByRole('button', { name: VACATION_COPY.requestVacation });
}

/** The submit button inside the request dialog. */
export function submitVacationRequestButton(dialog: Locator): Locator {
  return dialog.getByRole('button', { name: VACATION_COPY.submitRequest });
}

/** The request dialog's half-day toggle. */
export function vacationHalfDayToggle(dialog: Locator): Locator {
  return dialog.locator('#vacation-half-day');
}

/** Types the request range into the open request dialog (ddmmyyyy digits). */
export async function typeVacationRange(
  dialog: Locator,
  startDigits: string,
  endDigits: string,
): Promise<void> {
  await typeIntoDatePicker(dialog, VACATION_COPY.rangeStart, startDigits);
  await typeIntoDatePicker(dialog, VACATION_COPY.rangeEnd, endDigits);
}

// The employee vacation surface lives on the /zeiterfassung overview
// (dashboard) for every role.
export async function openOwnVacationSection(page: Page): Promise<void> {
  await page.goto('/zeiterfassung');
  await expect(visibleText(page, 'Urlaub & Abwesenheit')).toBeVisible({
    timeout: 15_000,
  });
}

export async function createOwnVacationRequestViaDialog(
  page: Page,
  options: {
    startDigits: string;
    endDigits: string;
    halfDay?: boolean;
    comment?: string;
  },
): Promise<void> {
  await openOwnVacationSection(page);
  await requestVacationButton(page).click();
  await expect(page.getByRole('heading', { name: VACATION_COPY.requestVacation })).toBeVisible();

  const dialog = page.getByRole('dialog');
  await typeVacationRange(dialog, options.startDigits, options.endDigits);
  if (options.halfDay) {
    await vacationHalfDayToggle(dialog).click();
  }
  if (options.comment !== undefined) {
    await dialog.locator('#vacation-comment').fill(options.comment);
  }
  await submitVacationRequestButton(dialog).click();
  await expect(page.getByRole('dialog')).toHaveCount(0, { timeout: 15_000 });
}

// Submitting an overlapping range must fail with an understandable message
// while the dialog stays open (the database exclusion constraint decides).
export async function expectVacationOverlapRejectedViaDialog(
  page: Page,
  options: { startDigits: string; endDigits: string },
): Promise<void> {
  await openOwnVacationSection(page);
  await requestVacationButton(page).click();
  const dialog = page.getByRole('dialog');
  await typeVacationRange(dialog, options.startDigits, options.endDigits);
  await submitVacationRequestButton(dialog).click();
  await expect(
    dialog.getByText('Für diesen Zeitraum existiert bereits ein offener oder genehmigter Urlaubsantrag.'),
  ).toBeVisible({ timeout: 15_000 });
  await dialog.getByRole('button', { name: SHARED_COPY.action.cancel }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
}

export async function withdrawOwnPendingVacationRequest(page: Page): Promise<void> {
  await openOwnVacationSection(page);
  // Exactly one pending request is expected when this step runs. The button's
  // accessible name carries the request's date range. Success is the button
  // disappearing — a "Zurückgezogen" text alone would be satisfied by an
  // older withdrawn request inherited from an earlier spec before the new
  // withdrawal has actually committed (a race GG-02's full run exposed).
  const withdrawButton = page.getByRole('button', {
    name: /^Urlaubsantrag vom .* zurückziehen$/,
  });
  await withdrawButton.click();
  await expect(withdrawButton).toHaveCount(0, { timeout: 15_000 });
  await expect(visibleText(page, 'Zurückgezogen')).toBeVisible({
    timeout: 15_000,
  });
}

export async function openVacationApprovals(page: Page): Promise<void> {
  await page.goto('/zeiterfassung?tab=approvals');
  await expect(timeApprovalsTab(page)).toBeVisible({
    timeout: 15_000,
  });
}

export async function approveVacationRequestFor(page: Page, personName: string): Promise<void> {
  await openVacationApprovals(page);
  const approve = approveVacationButton(page, personName);
  // The card leaves with the click, before the server answers. The banner is
  // the confirmation; callers read the persisted request where they need it.
  await expectBannerAfter(page, vacationApprovedBanner(personName), () => approve.click());
  await expect(approve).toHaveCount(0, { timeout: 15_000 });
}

export async function rejectVacationRequestFor(
  page: Page,
  personName: string,
  reason: string,
): Promise<void> {
  await openVacationApprovals(page);
  await page.getByRole('button', { name: `Urlaubsantrag von ${personName} ablehnen` }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('heading', { name: 'Urlaubsantrag ablehnen' })).toBeVisible();
  await dialog.locator('#vacation-decision-reason').fill(reason);
  // The dialog stays open until the server answers; a refusal keeps it open.
  await expectBannerAfter(page, `Der Urlaubsantrag von ${personName} wurde abgelehnt.`, () =>
    dialog.getByRole('button', { name: 'Ablehnen', exact: true }).click(),
  );
  await expect(page.getByRole('dialog')).toHaveCount(0, { timeout: 15_000 });
}

export async function cancelApprovedVacationFor(
  page: Page,
  personName: string,
  reason: string,
): Promise<void> {
  await openVacationApprovals(page);
  await page
    .getByRole('button', {
      name: `Genehmigten Urlaub von ${personName} stornieren`,
    })
    .click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('heading', { name: 'Genehmigten Urlaub stornieren' })).toBeVisible();
  await dialog.locator('#vacation-decision-reason').fill(reason);
  await expectBannerAfter(page, `Der Urlaub von ${personName} wurde storniert.`, () =>
    dialog.getByRole('button', { name: SHARED_COPY.action.cancelRecord, exact: true }).click(),
  );
  await expect(page.getByRole('dialog')).toHaveCount(0, { timeout: 15_000 });
}

// Cancels one specific approved vacation when a person has several approved
// ranges: the range text disambiguates where the per-person aria-label alone
// would be ambiguous (strict mode).
export async function cancelApprovedVacationForRangeText(
  page: Page,
  personName: string,
  rangeText: string,
  reason: string,
): Promise<void> {
  await openVacationApprovals(page);
  await page
    .locator('[data-slot="card"]')
    .filter({ hasText: rangeText })
    .getByRole('button', {
      name: `Genehmigten Urlaub von ${personName} stornieren`,
    })
    .click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('heading', { name: 'Genehmigten Urlaub stornieren' })).toBeVisible();
  await dialog.locator('#vacation-decision-reason').fill(reason);
  await expectBannerAfter(page, `Der Urlaub von ${personName} wurde storniert.`, () =>
    dialog.getByRole('button', { name: SHARED_COPY.action.cancelRecord, exact: true }).click(),
  );
  await expect(page.getByRole('dialog')).toHaveCount(0, { timeout: 15_000 });
}

// The clock-in contradiction rule: on an approved full-day vacation day the
// FAB flow is denied server-side with an understandable banner.
export async function expectClockInBlockedByVacation(page: Page): Promise<void> {
  await page.goto('/dashboard');
  await clockInLauncher(page).click();
  await expect(clockInSheetHeading(page)).toBeVisible();
  await clockInConfirmationButton(page).click();
  await expect(visibleText(page, 'Heute ist Urlaub genehmigt')).toBeVisible({
    timeout: 15_000,
  });
  // Still clocked out: the FAB keeps offering a start, never an active session.
  await expect(clockInLauncher(page)).toBeVisible();
  await expect(runningClockLauncher(page)).toHaveCount(0);
}

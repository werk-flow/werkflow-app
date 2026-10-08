import { expect, type Locator, type Page } from '@playwright/test';
import { formatVacationDays } from '../../../lib/vacation/balance';
import { calendarAbsenceBars } from '../../golden/support/plantafel';
import { confirmed, SHARED_COPY } from '../../golden/support/steps/shared';
import {
  openOwnVacationSection,
  requestVacationButton,
  submitVacationRequestButton,
  typeVacationRange,
  vacationHalfDayToggle,
  vacationPreviewText,
} from '../../golden/support/steps/vacation';

/** The approval card's neutral hint that another absence overlaps the request. */
export const OTHER_ABSENCE_HINT =
  'Hinweis: Für diese Person liegt im beantragten Zeitraum eine weitere Abwesenheit vor.';

/** Every word that would reveal a sickness type on an approval card. */
export const SICKNESS_TYPE_WORDS = /Krankheit|Kind krank|Sonstige/;

/** The approval card's line for a job planned inside the request: „Im Zeitraum eingeplant: Titel (dd.mm.yyyy)“. */
export function plannedInRangeText(jobTitle: string, germanDate: string): string {
  return `Im Zeitraum eingeplant: ${jobTitle} (${germanDate})`;
}

export function vacationCalendarEvent(
  page: Page,
  status: 'pending' | 'approved',
  personName: string,
): Locator {
  // Absence bars carry their tone as data; the person name scopes the bar.
  return confirmed(calendarAbsenceBars(page, status).filter({ hasText: personName }).first());
}

export function vacationRequestCard(page: Page, personName: string): Locator {
  // Approval cards expose only their data marker, so the raw selector stays in
  // this audit support helper and the person name scopes it to one request.
  return confirmed(page.locator('[data-vacation-request]').filter({ hasText: personName }));
}

export function absenceCalendarEvent(page: Page, label: string): Locator {
  return confirmed(calendarAbsenceBars(page, 'approved').filter({ hasText: label }));
}

/** Opens the request dialog for one day, reads its day preview and cancels without saving. */
export async function expectVacationPreview(
  page: Page,
  dateDigits: string,
  expectedDays: number,
  halfDay = false,
): Promise<void> {
  await openOwnVacationSection(page);
  await requestVacationButton(page).click();
  const dialog = page.getByRole('dialog');
  await typeVacationRange(dialog, dateDigits, dateDigits);
  if (halfDay) await vacationHalfDayToggle(dialog).click();
  await expect(dialog.getByTestId('vacation-days-preview')).toHaveText(
    vacationPreviewText(formatVacationDays(expectedDays)),
    { timeout: 15_000 },
  );
  await expect(submitVacationRequestButton(dialog)).toBeEnabled();
  await dialog.getByRole('button', { name: SHARED_COPY.action.cancel }).click();
  await expect(dialog).toHaveCount(0);
}

import type { Locator, Page } from '@playwright/test';

import type { PlanningStatusIntent } from '../../../lib/calendar/planning-occurrence-edit';
import { expect } from '../../golden/support/fixtures';
import { monthDay } from '../../golden/support/plantafel';
import {
  markNotificationReadButton,
  openAufgaben,
  unreadNotificationRows,
} from '../../golden/support/steps/attention';
import {
  calendarEntryHeading,
  occurrenceStatusLabel,
  openPlanningCreationDialog,
  planningCheckAndSave,
  planningEmployeeSearch,
  planningInternalEntryToggle,
  planningTitleField,
  planningWarningPanel,
  typePlanningDate,
} from '../../golden/support/steps/calendar';
import { dismissDialog } from '../../golden/support/steps/interaction';
import { confirmed, employeeAssignmentPicker, SHARED_COPY } from '../../golden/support/steps/shared';
import { openOwnVacationSection } from '../../golden/support/steps/vacation';

/**
 * The capacity sentences the planning warning names per person and date. The
 * product composes them on the server (lib/planning/capacity.ts keeps its map
 * private, the schedule fallback lives in a server-only module).
 */
const CAPACITY_WARNINGS = {
  scheduleFallback:
    'Für diese Person gilt nur der gekennzeichnete Standardwert, weil kein Arbeitszeitmodell hinterlegt ist.',
  pendingAbsence: 'Für diesen Tag liegt ein noch offener Abwesenheitsantrag vor.',
  freeDay: 'Der Termin liegt auf einem arbeitsfreien Tag.',
  approvedAbsence: 'Für diesen Zeitraum liegt eine genehmigte Abwesenheit vor.',
} as const;

type CapacityWarning = keyof typeof CAPACITY_WARNINGS;

/** A date as the planning warning and the request lists print it: „24.08.2026“. */
export function formatGermanDate(dateIso: string): string {
  const [year, month, day] = dateIso.split('-');
  return `${day}.${month}.${year}`;
}

/** The warning line that names the person, the capacity fact and the date. */
export function capacityWarningLine(
  warning: Locator,
  input: { employeeName: string; kind: CapacityWarning; dateIso: string },
): Locator {
  return confirmed(
    warning.getByText(
      `${input.employeeName}: ${CAPACITY_WARNINGS[input.kind]} (${formatGermanDate(input.dateIso)})`,
    ),
  );
}

/** Any warning line about this capacity fact. */
export function capacityWarningText(warning: Locator, kind: CapacityWarning): Locator {
  return warning.getByText(CAPACITY_WARNINGS[kind]);
}

export function planningDateCellStatus(page: Page, dateIso: string, status: PlanningStatusIntent): Locator {
  return monthDay(page, dateIso).getByText(occurrenceStatusLabel(status), { exact: true });
}

/** The own section's open-ended sickness range as its cancel action names it. */
export function openEndedSicknessRangeText(germanStartDate: string): string {
  return `${germanStartDate} – bis auf Weiteres`;
}

// Request cards can render in both responsive layouts. The date is the stable
// business identity, and this helper picks the visible action copy as before.
function pendingVacationWithdrawButton(page: Page, germanDate: string): Locator {
  const escapedDate = germanDate.replace(/\./g, '\\.');
  return page
    .getByRole('button', {
      name: new RegExp(`^Urlaubsantrag vom .*${escapedDate}.* zurückziehen$`),
    })
    .first();
}

export async function withdrawOwnPendingVacationRequestByDate(page: Page, germanDate: string): Promise<void> {
  await openOwnVacationSection(page);
  const withdrawButton = pendingVacationWithdrawButton(page, germanDate);
  await withdrawButton.click();
  await expect(withdrawButton).toHaveCount(0, { timeout: 15_000 });
}

// The dialog deliberately has two equally named close controls. The footer
// button is the first one in DOM order and is the intended interaction here.
export async function closePlanningDialogWithNamedControl(dialog: Locator): Promise<void> {
  await dialog.getByRole('button', { name: SHARED_COPY.action.close }).first().click();
}

/** Switches the open planning form to an internal entry with title and date, optionally for one person. */
export async function fillInternalPlanningDraft(
  page: Page,
  dialog: Locator,
  options: { title: string; dateIso: string; assignEmployeeName?: string },
): Promise<void> {
  await planningInternalEntryToggle(dialog).click();
  await planningTitleField(dialog).fill(options.title);
  await typePlanningDate(dialog, options.dateIso);
  if (options.assignEmployeeName) {
    await employeeAssignmentPicker(dialog).click();
    await planningEmployeeSearch(page).fill(options.assignEmployeeName);
    await page
      .getByRole('listbox')
      .getByRole('option')
      .filter({ hasText: options.assignEmployeeName })
      .click();
    await calendarEntryHeading(dialog).click();
  }
}

// Opens the creation dialog, provokes the capacity check, asserts the exact
// warning line (person AND date), and leaves WITHOUT saving anything.
export async function probePlanningWarningLine(
  page: Page,
  options: {
    title: string;
    dateIso: string;
    employeeName: string;
    kind: CapacityWarning;
  },
): Promise<void> {
  const dialog = await openPlanningCreationDialog(page);
  await fillInternalPlanningDraft(page, dialog, {
    title: options.title,
    dateIso: options.dateIso,
    assignEmployeeName: options.employeeName,
  });
  await planningCheckAndSave(dialog).click();
  const warning = planningWarningPanel(dialog);
  await expect(warning).toBeVisible({ timeout: 30_000 });
  await expect(
    capacityWarningLine(warning, {
      employeeName: options.employeeName,
      kind: options.kind,
      dateIso: options.dateIso,
    }),
  ).toBeVisible();
  await dismissDialog(dialog);
  await expect(dialog).toHaveCount(0, { timeout: 15_000 });
}

export async function markAllOwnNotificationsRead(page: Page): Promise<void> {
  await openAufgaben(page);
  await markAllUnreadNotificationsRead(page);
}

// Drains one persisted unread row at a time with a bounded progress check.
async function markAllUnreadNotificationsRead(page: Page): Promise<void> {
  const unreadRows = unreadNotificationRows(page);
  let unreadCount = await unreadRows.count();
  while (unreadCount > 0) {
    await markNotificationReadButton(unreadRows.first()).click({ timeout: 15_000 });
    await expect.poll(async () => unreadRows.count(), { timeout: 15_000 }).toBeLessThan(unreadCount);
    unreadCount = await unreadRows.count();
  }
}

import { expect, type Locator, type Page } from '@playwright/test';
import { plannedEntriesMessage } from '../../../../lib/calendar/planning-entry-draft';
import {
  planningEditSuccessMessage,
  planningStatusChangeMessage,
  type PlanningEditScope,
  type PlanningStatusIntent,
} from '../../../../lib/calendar/planning-occurrence-edit';
import { PLANNING_OCCURRENCE_STATUS_LABELS } from '../../../../lib/planning/types';
import { calendarStepButton, calendarViewTab } from '../plantafel';
import {
  confirmed,
  employeeAssignmentPicker,
  employeeAssignmentSearch,
  planningWarningDialog,
  SHARED_COPY,
  typeIntoDatePickerById,
  typeIntoTimeInput,
  visibleText,
} from './shared';
import { TIME_ENTRY_COPY, fillManualEntryTimes, manualEntryMemberPicker } from './time-tracking';
import { jobFormField, workCreateSubmit, workCreateTab } from './work';

/**
 * Copy of the planning form, the occurrence edit dialog and the calendar's
 * entry dialog that no pure product module owns. Success sentences and status
 * labels come from their product owners instead.
 */
const PLANNING_COPY = {
  newEntry: 'Kalendereintrag',
  entryDialog: 'Kalendereintrag erstellen',
  internalEntry: 'Interner Termin',
  repeat: 'Wiederholen',
  weekdays: 'Wochentage',
  checkAndSave: /Planung pr.fen und speichern/,
  planWithReason: 'Mit Begründung planen',
  overrideSubmit: /Mit Begr.ndung planen|.nderung speichern/,
  editSubmit: /.nderung speichern/,
  editOverrideSubmit: /Mit Begründung planen|Änderung speichern/,
  editAssigneePicker: /Mitarbeiter/,
  employeePicker: 'Mitarbeiter',
  employeeSearch: /Mitarbeiter suchen/,
  teamSearch: /Team suchen/,
  jobSearch: /Auftrag suchen/,
  allDay: /Ganzt.gig/,
  allDayExact: 'Ganztägig / mehrtägig',
  editEntry: 'Termin bearbeiten',
  editDialog: 'Geplanten Termin bearbeiten',
  extendSeries: 'Serie um sechs Monate verlängern',
  saveStatus: 'Status speichern',
  closeOverview: 'Terminübersicht schließen',
  noAppAccess: 'Ohne App-Zugang',
  overrideTooShort: 'Bitte begründe die Abweichung mit mindestens 8 Zeichen.',
  staleAssessment: 'Die Planungslage hat sich geändert. Bitte Hinweise erneut prüfen.',
  manualEntrySaved: 'Eintrag erfolgreich erstellt!',
  entryDetails: 'Eintrag Details',
} as const;

/** The tabs of the calendar's entry dialog; the job tab is the work area's creation form. */
const ENTRY_DIALOG_TABS = {
  plan: 'Termin planen',
  manual: TIME_ENTRY_COPY.manualEntry,
} as const;

type EntryDialogTab = keyof typeof ENTRY_DIALOG_TABS | 'job';

/** The internal entry types, in the order the form offers them. */
export const PLANNING_INTERNAL_TYPE_LABELS = {
  internal_work: 'Interne Arbeit',
  meeting: 'Besprechung',
  training: 'Schulung',
  other: 'Sonstiges',
} as const;

/** The edit scopes of a series occurrence, in the order the dialog offers them. */
export const PLANNING_EDIT_SCOPE_LABELS: Record<PlanningEditScope, string> = {
  one: 'Nur dieser Termin',
  future: 'Dieser und zukünftige',
  series: 'Ganze Serie ab frühestem änderbaren Termin',
};

const FREQUENCY_LABELS = {
  daily: /T.glich/,
  weekly: /W.chentlich/,
  monthly: /Monatlich/,
} as const;

const STATUS_ACTIONS: Record<PlanningStatusIntent, string> = {
  cancelled: 'Termin absagen',
  skipped: 'Auslassen',
};

// P1-11: recurring and multi-visit planning. These helpers keep the golden
// spec at the business-action level while the controls remain keyboard-usable.
export type PlanningEntryStepOptions = {
  kind: 'job_visit' | 'internal';
  jobSearch?: string;
  internalTitle?: string;
  internalType?: 'meeting' | 'internal_work' | 'training' | 'other';
  date: string;
  time?: string;
  durationHours?: number;
  durationDays?: number;
  employeeNames?: string[];
  teamNames?: string[];
  recurrence?: {
    frequency?: 'daily' | 'weekly' | 'monthly';
    count: number;
    // German weekday labels (Mo/Di/…) that must be pressed for weekly series;
    // the form preselects the start date's weekday automatically.
    weekdayLabels?: string[];
  };
  overrideReason?: string;
  /**
   * Submission boundary for measured freshness: runs immediately before the
   * click that persists the entry. With an override reason it runs before
   * the override click; a save that closes without the expected warning
   * then fails the measurement instead of starting its clock late.
   */
  beforeSubmit?: () => void | Promise<void>;
};

/** The calendar's entry dialog (plan a visit, create a job, record time). */
export function calendarEntryDialog(page: Page): Locator {
  return page.getByRole('dialog').filter({
    has: page.getByRole('heading', { name: PLANNING_COPY.entryDialog }),
  });
}

/** The entry dialog's heading; clicking it closes a picker popover inside the dialog. */
export function calendarEntryHeading(dialog: Locator): Locator {
  return dialog.getByRole('heading', { name: PLANNING_COPY.entryDialog });
}

export function entryDialogTab(dialog: Locator, tab: EntryDialogTab): Locator {
  if (tab === 'job') return workCreateTab(dialog, 'job');
  return dialog.getByRole('tab', { name: ENTRY_DIALOG_TABS[tab] });
}

/** The calendar's action that opens the entry dialog. */
export function calendarNewEntryButton(page: Page): Locator {
  return page.getByRole('button', { name: PLANNING_COPY.newEntry, exact: true });
}

/** Opens the entry dialog from the calendar on the given tab, without waiting for the tab's form. */
async function openCalendarEntryDialog(page: Page, tab: EntryDialogTab): Promise<Locator> {
  await page.goto('/kalender');
  await calendarNewEntryButton(page).click();
  const dialog = calendarEntryDialog(page);
  await entryDialogTab(dialog, tab).click();
  return dialog;
}

/** Opens the entry dialog on „Termin planen“ and waits until the planning form is ready. */
export async function openPlanningCreationDialog(page: Page): Promise<Locator> {
  await page.goto('/kalender');
  await calendarNewEntryButton(page).click();
  const dialog = calendarEntryDialog(page);
  await expect(entryDialogTab(dialog, 'plan')).toBeVisible({
    timeout: 15_000,
  });
  await entryDialogTab(dialog, 'plan').click();
  await expect(dialog.locator('#planning-date')).toBeVisible({
    timeout: 15_000,
  });
  return dialog;
}

/** The title field of an internal entry in the planning form. */
export function planningTitleField(dialog: Locator): Locator {
  return dialog.locator('#planning-title');
}

/** Types the planning form's date (YYYY-MM-DD). */
export async function typePlanningDate(dialog: Locator, dateIso: string): Promise<void> {
  await typeIntoDatePickerById(dialog, 'planning-date', dateIso);
}

/** The toggle that switches the planning form to an internal entry. */
export function planningInternalEntryToggle(dialog: Locator): Locator {
  return dialog.getByRole('button', { name: PLANNING_COPY.internalEntry, exact: true });
}

export function planningInternalTypeOption(
  page: Page,
  type: keyof typeof PLANNING_INTERNAL_TYPE_LABELS,
): Locator {
  return page.getByRole('option', { name: PLANNING_INTERNAL_TYPE_LABELS[type], exact: true });
}

export function planningAllDayOption(page: Page): Locator {
  return page.getByRole('option', { name: PLANNING_COPY.allDayExact, exact: true });
}

export function planningRepeatToggle(dialog: Locator): Locator {
  return dialog.getByText(PLANNING_COPY.repeat, { exact: true });
}

export function planningFrequencyOption(page: Page, frequency: keyof typeof FREQUENCY_LABELS): Locator {
  return page.getByRole('option', { name: FREQUENCY_LABELS[frequency] });
}

/** The form's employee multi-select, named by its field label. */
export function planningEmployeePicker(dialog: Locator): Locator {
  return dialog.getByRole('combobox', { name: PLANNING_COPY.employeePicker, exact: true });
}

/** The search field of an open employee picker; the popover portals outside the dialog. */
export function planningEmployeeSearch(page: Page): Locator {
  return page.getByPlaceholder(PLANNING_COPY.employeeSearch);
}

/** The search field of an open team picker; its popover portals outside the dialog. */
export function planningTeamSearch(page: Page): Locator {
  return page.getByPlaceholder(PLANNING_COPY.teamSearch);
}

export function planningCheckAndSave(dialog: Locator): Locator {
  return dialog.getByRole('button', { name: PLANNING_COPY.checkAndSave });
}

export function planWithReasonButton(dialog: Locator): Locator {
  return dialog.getByRole('button', { name: PLANNING_COPY.planWithReason });
}

/** The capacity and qualification warning the planning form shows before it saves. */
export function planningWarningPanel(dialog: Locator): Locator {
  return dialog.locator('[data-planning-warning]');
}

export function planningOverrideTooShort(dialog: Locator): Locator {
  return dialog.getByText(PLANNING_COPY.overrideTooShort);
}

/** The reason field of the separate planning warning dialog. */
export function planningWarningReason(warning: Locator): Locator {
  return warning.locator('#planning-warning-reason');
}

export function planningWarningSave(warning: Locator): Locator {
  return warning.getByRole('button', { name: SHARED_COPY.planningWarning.saveWithReason });
}

/** The warning's action that takes the change back; nothing is saved. */
export function planningWarningRevert(warning: Locator): Locator {
  return warning.getByRole('button', { name: SHARED_COPY.planningWarning.revertChange });
}

/**
 * Confirms the planning warning dialog with a reason and waits until it
 * closed. When the warning is not required, a change without warnings passes.
 */
export async function confirmPlanningWarning(page: Page, reason: string, required = true): Promise<void> {
  const warning = planningWarningDialog(page);
  if (required) {
    await expect(warning).toBeVisible({ timeout: 30_000 });
  } else {
    // isVisible ignores its timeout; the warning opens after the planning check answers.
    const appeared = await warning.waitFor({ state: 'visible', timeout: 2_000 }).then(
      () => true,
      () => false,
    );
    if (!appeared) return;
  }
  await planningWarningReason(warning).fill(reason);
  await planningWarningSave(warning).click();
  await expect(warning).toHaveCount(0, { timeout: 20_000 });
}

export function plannedEntriesConfirmation(page: Page, occurrenceCount: number): Locator {
  return visibleText(page, plannedEntriesMessage(occurrenceCount));
}

export function occurrenceEditConfirmation(page: Page, scope: PlanningEditScope): Locator {
  return visibleText(page, planningEditSuccessMessage(scope));
}

export function occurrenceStatusConfirmation(page: Page, status: PlanningStatusIntent): Locator {
  return visibleText(page, planningStatusChangeMessage(status));
}

export function seriesExtendedConfirmation(page: Page, addedCount: number): Locator {
  return visibleText(page, `Serie wurde um sechs Monate verlängert (${addedCount} neue Termine).`);
}

/** The notice that a confirmation was refused because the planning facts changed. */
export function staleAssessmentNotice(page: Page): Locator {
  return visibleText(page, PLANNING_COPY.staleAssessment);
}

/** The calendar label of a skipped or cancelled occurrence. */
export function occurrenceStatusLabel(status: PlanningStatusIntent): string {
  const label = PLANNING_OCCURRENCE_STATUS_LABELS[status];
  if (!label) throw new Error(`No calendar label for the occurrence status ${status}.`);
  return label;
}

async function selectPlanningOption(
  dialog: Locator,
  triggerId: string,
  searchPlaceholder: RegExp,
  optionText: string,
): Promise<void> {
  await dialog.locator(`#${triggerId}`).click();
  // The popover portals outside the dialog.
  const page = dialog.page();
  await page.getByPlaceholder(searchPlaceholder).fill(optionText);
  const option = page.getByRole('listbox').getByRole('option').filter({ hasText: optionText }).first();
  if ((await option.getAttribute('aria-selected')) !== 'true') await option.click();
  await dialog.getByRole('heading').first().click();
}

async function finishPlanningSave(
  dialog: Locator,
  firstButtonName: RegExp,
  overrideReason?: string,
  beforeSubmit?: () => void | Promise<void>,
): Promise<void> {
  if (!overrideReason) await beforeSubmit?.();
  await dialog.getByRole('button', { name: firstButtonName }).click();
  await expect
    .poll(
      async () => {
        if (!(await dialog.isVisible().catch(() => false))) return 'closed';
        if (
          await planningWarningPanel(dialog)
            .isVisible()
            .catch(() => false)
        ) {
          return 'warning';
        }
        return 'pending';
      },
      { timeout: 30_000 },
    )
    .not.toBe('pending');

  if (!(await dialog.isVisible().catch(() => false))) {
    if (overrideReason && beforeSubmit) {
      throw new Error(
        'Planning saved without the expected warning; the measured submission boundary was never marked.',
      );
    }
    return;
  }
  if (!overrideReason) {
    throw new Error('Planning produced warnings but no override reason was supplied');
  }
  const reasonInput = dialog.locator('#planning-override, #planning-edit-reason').first();
  await reasonInput.fill(overrideReason);
  await beforeSubmit?.();
  await dialog
    .getByRole('button', {
      name: PLANNING_COPY.overrideSubmit,
    })
    .click();
  await expect(dialog).toHaveCount(0, { timeout: 30_000 });
}

export async function createPlannedCalendarEntry(
  page: Page,
  options: PlanningEntryStepOptions,
): Promise<void> {
  const dialog = await openPlanningCreationDialog(page);

  if (options.kind === 'job_visit') {
    if (!options.jobSearch) throw new Error('A job search value is required');
    await selectPlanningOption(dialog, 'planning-job', PLANNING_COPY.jobSearch, options.jobSearch);
  } else {
    await dialog.getByRole('button', { name: PLANNING_COPY.internalEntry }).click();
    if (options.internalType && options.internalType !== 'meeting') {
      await dialog.locator('#planning-internal-type').click();
      await page
        .getByRole('option', { name: new RegExp(PLANNING_INTERNAL_TYPE_LABELS[options.internalType]) })
        .click();
    }
    await planningTitleField(dialog).fill(options.internalTitle ?? PLANNING_COPY.internalEntry);
  }

  await typePlanningDate(dialog, options.date);
  if (options.durationDays !== undefined) {
    await dialog.locator('#planning-time-kind').click();
    await page.getByRole('option', { name: PLANNING_COPY.allDay }).click();
    await dialog.locator('#planning-days').fill(String(options.durationDays));
  } else {
    await typeIntoTimeInput(dialog, 'planning-time', (options.time ?? '09:00').replace(':', ''));
    // DurationHoursInput keeps the element id on its inner text input.
    await dialog.locator('#planning-duration').fill(String(options.durationHours ?? 1));
  }

  for (const employeeName of options.employeeNames ?? []) {
    await selectPlanningOption(dialog, 'planning-employees', PLANNING_COPY.employeeSearch, employeeName);
  }
  for (const teamName of options.teamNames ?? []) {
    await selectPlanningOption(dialog, 'planning-teams', PLANNING_COPY.teamSearch, teamName);
  }

  if (options.recurrence) {
    await planningRepeatToggle(dialog).click();
    if (options.recurrence.frequency) {
      // The Rhythmus Field wires its id onto the select trigger.
      await dialog.locator('#planning-frequency').click();
      await planningFrequencyOption(page, options.recurrence.frequency).click();
    }
    // Scope weekday toggles to the Wochentage group so short labels (Mo/Di/…)
    // can never match another dialog button (e.g. a team named alike).
    const weekdayGroup = dialog.getByRole('group', { name: PLANNING_COPY.weekdays });
    for (const weekdayLabel of options.recurrence.weekdayLabels ?? []) {
      const weekdayButton = weekdayGroup.getByRole('button', {
        name: weekdayLabel,
        exact: true,
      });
      if ((await weekdayButton.getAttribute('aria-pressed')) !== 'true') {
        await weekdayButton.click();
      }
    }
    await dialog.locator('#planning-count').fill(String(options.recurrence.count));
  }

  await finishPlanningSave(dialog, PLANNING_COPY.checkAndSave, options.overrideReason, options.beforeSubmit);
}

export function plannedCalendarEvent(page: Page, title: string, index = 0): Locator {
  return confirmed(page.locator('[data-calendar-card]').filter({ hasText: title }).nth(index));
}

/** The month grid keys one day's items by data-month-day; the run-scoped title narrows the visit. */
export function occurrenceInDateCell(page: Page, dateIso: string, title: string): Locator {
  return confirmed(
    page.locator(`[data-month-day="${dateIso}"]`).locator('[data-calendar-card]').filter({ hasText: title }),
  );
}

/** A completed pointer gesture is evidence only after the calendar drag engine owns the drag. */
export async function dragPlanningMonthEvent(
  page: Page,
  input: { title: string; sourceDate: string; targetDate: string },
): Promise<void> {
  if (
    input.sourceDate === input.targetDate ||
    ![input.sourceDate, input.targetDate].every((date) => /^\d{4}-\d{2}-\d{2}$/.test(date))
  ) {
    throw new Error('A month drag requires two distinct explicit calendar dates.');
  }
  const main = page.getByRole('main');
  const sourceDay = main.locator(`[data-month-day="${input.sourceDate}"]`);
  // The cell background sits under its day column; the column is the hit area.
  const targetDay = main.locator(`[data-month-day="${input.targetDate}"]`);
  const event = confirmed(sourceDay.locator('[data-calendar-card]').filter({ hasText: input.title }));
  await expect(event).toHaveCount(1);
  await expect(event).toBeVisible();
  await expect(event).toHaveClass(/\bcursor-grab\b/);
  await targetDay.scrollIntoViewIfNeeded();
  await event.scrollIntoViewIfNeeded();

  async function visiblePoint(
    locator: Locator,
  ): Promise<{ x: number; y: number; left: number; right: number }> {
    return locator.evaluate((element) => {
      const bounds = element.getBoundingClientRect();
      let left = Math.max(0, bounds.left);
      let right = Math.min(innerWidth, bounds.right);
      let top = Math.max(0, bounds.top);
      let bottom = Math.min(innerHeight, bounds.bottom);
      for (let ancestor = element.parentElement; ancestor; ancestor = ancestor.parentElement) {
        const style = getComputedStyle(ancestor);
        const clip = ancestor.getBoundingClientRect();
        if (/(auto|scroll|hidden|clip)/.test(style.overflowX)) {
          left = Math.max(left, clip.left);
          right = Math.min(right, clip.right);
        }
        if (/(auto|scroll|hidden|clip)/.test(style.overflowY)) {
          top = Math.max(top, clip.top);
          bottom = Math.min(bottom, clip.bottom);
        }
      }
      if (right - left < 8 || bottom - top < 8)
        throw new Error('The month drag source and target must both expose safe visible hit areas.');
      const x = (left + right) / 2;
      const y = (top + bottom) / 2;
      const hit = document.elementFromPoint(x, y);
      if (!hit || !element.contains(hit))
        throw new Error('The month drag hit point is covered by another surface.');
      return { x, y, left, right };
    });
  }

  const start = await visiblePoint(event);
  const thresholdX = start.x + 12 < start.right - 2 ? start.x + 12 : start.x - 12;
  if (thresholdX <= start.left + 2)
    throw new Error('The source event is too narrow to engage a drag safely.');
  await visiblePoint(targetDay);
  const canCancelOutside = await main.locator('[data-month-view]').evaluateAll((calendars) =>
    calendars.every((calendar) => {
      const bounds = calendar.getBoundingClientRect();
      return 1 < bounds.left || 1 > bounds.right || 1 < bounds.top || 1 > bounds.bottom;
    }),
  );
  if (!canCancelOutside) throw new Error('No safe outside-calendar release point is available.');
  const body = page.locator('body');
  await expect(body).not.toHaveClass(/\bis-dragging\b/);
  await page.mouse.move(start.x, start.y);
  let held = false;
  try {
    await page.mouse.down();
    held = true;
    await page.mouse.move(thresholdX, start.y, { steps: 3 });
    await expect(body, 'The drag engine must engage the drag before moving to another date').toHaveClass(
      /\bis-dragging\b/,
      { timeout: 5_000 },
    );
    const target = await visiblePoint(targetDay);
    await page.mouse.move(target.x, target.y, { steps: 10 });
    await expect(body, 'The drag engine must retain the drag until the destination release').toHaveClass(
      /\bis-dragging\b/,
      { timeout: 5_000 },
    );
    // Exactly one destination release. Business warning and persisted-date
    // assertions remain with the scenario; an unknown outcome is never retried.
    held = false;
    await page.mouse.up();
  } finally {
    if (held) {
      await page.mouse.move(1, 1);
      await page.mouse.up();
    }
  }
}

/**
 * Opens the calendar's month view and steps `monthDelta` months forward
 * (negative: back) through the header's navigation.
 */
export async function showCalendarMonth(page: Page, monthDelta = 0): Promise<void> {
  await page.goto('/kalender');
  await calendarViewTab(page, 'month').click();
  const step = calendarStepButton(page, monthDelta < 0 ? 'previous' : 'next');
  for (let index = 0; index < Math.abs(monthDelta); index += 1) {
    await step.click();
  }
}

export async function showPlanningMonth(page: Page, targetDate?: string): Promise<void> {
  await page.goto(targetDate ? `/kalender?date=${targetDate}` : '/kalender');
  await calendarViewTab(page, 'month').click();
  await expect(
    page.locator('[data-calendar-scroll-container][data-calendar-state="ready"][data-calendar-view="month"]'),
  ).toBeVisible({ timeout: 15_000 });
  if (targetDate)
    await expect(page.locator(`[data-month-cell="${targetDate}"][data-in-month="true"]`)).toBeVisible();
}

/** The card popover's edit action; pass the popover to scope it, or the page for an absence check. */
export function occurrenceEditButton(scope: Page | Locator): Locator {
  return scope.getByRole('button', { name: PLANNING_COPY.editEntry });
}

function occurrenceEditDialog(page: Page): Locator {
  return page.getByRole('dialog').filter({
    has: page.getByRole('heading', { name: PLANNING_COPY.editDialog }),
  });
}

export function occurrenceEditHeading(dialog: Locator): Locator {
  return dialog.getByRole('heading', { name: PLANNING_COPY.editDialog });
}

/** Opens the edit dialog of the visit with this title on this month day. */
export async function openOccurrenceEditDialogByDate(
  page: Page,
  title: string,
  dateIso: string,
): Promise<Locator> {
  await showPlanningMonth(page, dateIso);
  const event = occurrenceInDateCell(page, dateIso, title);
  await expect(event).toBeVisible({ timeout: 20_000 });
  await event.click();
  await occurrenceEditButton(page).click();
  const dialog = occurrenceEditDialog(page);
  await expect(dialog).toBeVisible({ timeout: 15_000 });
  return dialog;
}

export function extendSeriesButton(dialog: Locator): Locator {
  return dialog.getByRole('button', { name: PLANNING_COPY.extendSeries });
}

/** The action that skips or cancels the occurrence. */
export function occurrenceStatusAction(dialog: Locator, status: PlanningStatusIntent): Locator {
  return dialog.getByRole('button', { name: STATUS_ACTIONS[status], exact: true });
}

export function occurrenceStatusSave(dialog: Locator): Locator {
  return dialog.getByRole('button', { name: PLANNING_COPY.saveStatus, exact: true });
}

/** The close button of a card popover that offers no editing. */
export function closeOccurrenceOverviewButton(page: Page): Locator {
  return page.getByRole('button', { name: PLANNING_COPY.closeOverview });
}

/** The marker of an employee option without app access. */
export function noAppAccessBadge(option: Locator): Locator {
  return option.getByText(PLANNING_COPY.noAppAccess);
}

/** Adds one more person through the edit dialog's employee picker. */
export async function addOccurrenceAssignee(page: Page, dialog: Locator, searchText: string): Promise<void> {
  await dialog.getByRole('combobox').filter({ hasText: PLANNING_COPY.editAssigneePicker }).click();
  await page.getByPlaceholder(PLANNING_COPY.employeeSearch).fill(searchText);
  await page.getByRole('listbox').getByRole('option').filter({ hasText: searchText }).click();
  await occurrenceEditHeading(dialog).click();
}

// Mirrors the shared planning-save contract for the occurrence edit dialog:
// the capacity warning renders inline with `#planning-edit-reason`.
export async function saveOccurrenceEditWithOverride(dialog: Locator, overrideReason: string): Promise<void> {
  await dialog.getByRole('button', { name: PLANNING_COPY.editSubmit }).click();
  await expect
    .poll(
      async () => {
        if (!(await dialog.isVisible().catch(() => false))) return 'closed';
        if (
          await planningWarningPanel(dialog)
            .isVisible()
            .catch(() => false)
        ) {
          return 'warning';
        }
        return 'pending';
      },
      { timeout: 30_000 },
    )
    .not.toBe('pending');
  if (!(await dialog.isVisible().catch(() => false))) return;
  await dialog.locator('#planning-edit-reason').fill(overrideReason);
  await dialog.getByRole('button', { name: PLANNING_COPY.editOverrideSubmit }).click();
  await expect(dialog).toHaveCount(0, { timeout: 30_000 });
}

export async function editPlannedCalendarOccurrence(
  page: Page,
  options: {
    title: string;
    eventIndex?: number;
    scope: 'one' | 'future' | 'series';
    date?: string;
    time?: string;
    durationHours?: number;
    overrideReason?: string;
    calendarDate?: string;
  },
): Promise<void> {
  await showPlanningMonth(page, options.calendarDate);
  const event = plannedCalendarEvent(page, options.title, options.eventIndex ?? 0);
  await expect(event).toBeVisible({ timeout: 20_000 });
  await event.click();
  await occurrenceEditButton(page).click();
  const dialog = occurrenceEditDialog(page);
  if (options.scope !== 'one') {
    await dialog.locator('#planning-edit-scope').click();
    await page
      .getByRole('option')
      .filter({ hasText: PLANNING_EDIT_SCOPE_LABELS[options.scope] })
      .first()
      .click();
  }
  if (options.date) {
    await typeIntoDatePickerById(dialog, 'planning-edit-date', options.date);
  }
  if (options.time) {
    await typeIntoTimeInput(dialog, 'planning-edit-time', options.time.replace(':', ''));
  }
  if (options.durationHours !== undefined) {
    await dialog.locator('#planning-edit-duration').fill(String(options.durationHours));
  }
  await finishPlanningSave(dialog, PLANNING_COPY.editSubmit, options.overrideReason);
}

/**
 * Fills the entry dialog's „Auftrag erstellen“ tab with a planned job for one
 * person and submits it. A planning warning may follow; the caller handles it.
 */
export async function submitJobFromCalendar(
  page: Page,
  options: {
    jobNumber: string;
    title: string;
    date: string;
    time: string;
    durationHours: number;
    employeeName: string;
  },
): Promise<Locator> {
  const dialog = await openCalendarEntryDialog(page, 'job');
  await jobFormField(dialog, 'number').fill(options.jobNumber);
  await jobFormField(dialog, 'title').fill(options.title);
  await typeIntoDatePickerById(dialog, 'job-date', options.date);
  await typeIntoTimeInput(dialog, 'job-time', options.time.replace(':', ''));
  await jobFormField(dialog, 'duration').fill(String(options.durationHours));
  await employeeAssignmentPicker(dialog).click();
  await employeeAssignmentSearch(page).fill(options.employeeName);
  await page.getByRole('listbox').getByRole('option').filter({ hasText: options.employeeName }).click();
  await calendarEntryHeading(dialog).click();
  await workCreateSubmit(dialog, 'job').click();
  return dialog;
}

/** Records a manual time entry for a member through the entry dialog's third tab and saves it. */
export async function submitManualEntryFromCalendar(
  page: Page,
  options: { memberName: string; clockInDigits: string; clockOutDigits: string },
): Promise<Locator> {
  const dialog = await openCalendarEntryDialog(page, 'manual');
  await manualEntryMemberPicker(dialog).click();
  await employeeAssignmentSearch(page).fill(options.memberName);
  await page.getByRole('listbox').getByRole('option').filter({ hasText: options.memberName }).click();
  await fillManualEntryTimes(dialog, options);
  await dialog.getByRole('button', { name: SHARED_COPY.action.save, exact: true }).click();
  return dialog;
}

export function manualEntrySavedConfirmation(page: Page): Locator {
  return visibleText(page, PLANNING_COPY.manualEntrySaved);
}

/** The details dialog a time block opens. */
export function timeEntryDetailsDialog(page: Page): Locator {
  return page.getByRole('dialog').filter({
    has: page.getByRole('heading', { name: PLANNING_COPY.entryDetails }),
  });
}

/** The heading of the details dialog. */
export function timeEntryDetailsHeading(dialog: Locator): Locator {
  return dialog.getByRole('heading', { name: PLANNING_COPY.entryDetails, exact: true });
}

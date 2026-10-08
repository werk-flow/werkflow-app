import { expect, type Locator, type Page } from '@playwright/test';
import {
  ACCESS_CLASS_OPTIONS,
  ACCESS_TRANSITIONS,
  EMPLOYMENT_TRANSITIONS,
  REQUIREMENT_TYPES,
} from '../../../../components/mitarbeiter/personnel-lifecycle-options';
import type {
  PersonnelAccessTransitionKind,
  PersonnelDocumentAccessClass,
  PersonnelEmploymentTransitionKind,
  PersonnelRequirementType,
} from '../../../../lib/personnel/lifecycle';
import { EMPLOYMENT_TYPE_LABELS, type EmploymentType } from '../../../../lib/personnel/types';
import type { OrganizationResponsibility } from '../../../../lib/responsibilities/types';
import { ROLE_LABELS } from '../../../../lib/roles';
import {
  confirmed,
  datePickerDigits,
  employeeAssignmentPicker,
  employeeAssignmentSearch,
  expectVisibleAfterSave,
  pageHeader,
  selectFromSearchable,
  SHARED_COPY,
  typeIntoDatePicker,
  visibleText,
} from './shared';
import { workCreateButton, workCreateTab } from './work';
import { getEmployeeRecordById, type PersistedEmployeeRecord } from '../db/personnel';

/**
 * Copy of the personnel area (P1-03 records and conditions, P1-04 schedules
 * and targets, P1-05 responsibilities, P1-07 attention rows, P1-09 own
 * qualifications). Labels that a pure product module owns are imported there
 * (EMPLOYMENT_TYPE_LABELS, EMPLOYMENT_STATE_LABELS, RESPONSIBILITY_LABELS, …).
 */
export const PERSONNEL_COPY = {
  personnelSection: 'Personalien',
  otherPersonnel: 'Weiteres Personal',
  createRecord: 'Personalakte anlegen',
  entryDate: 'Eintrittsdatum',
  numberTaken: 'Diese Personalnummer ist bereits vergeben.',
  invited: 'Eingeladen',
  inviteSent: 'Einladung versendet',
  scheduleWins: 'Für Zeitziele gilt der Wochenplan.',
  noSchedule: 'Kein Arbeitszeitmodell hinterlegt',
  noScheduleDefaultTarget: 'Kein Arbeitszeitmodell hinterlegt – Standardziel 8 Stunden.',
  noScheduleSection: 'Kein Arbeitszeitmodell hinterlegt. Ohne Wochenplan gilt',
  closurePastDay:
    'Vergangene Tage können nicht geändert werden – frühere Zeiträume behalten ihre damalige Bedeutung.',
  noHolidayRegion: 'Kein Feiertagskalender',
} as const;

/** The personnel master-data fields, keyed like the history's field names. */
const PERSONNEL_FIELDS = {
  employee_number: 'Personalnummer',
  first_name: 'Vorname',
  phone: 'Telefon',
  private_email: 'Private E-Mail',
  street: 'Straße',
  postal_code: 'PLZ',
  city: 'Ort',
  emergency_contact_name: 'Notfallkontakt',
  emergency_contact_phone: 'Notfallkontakt Telefon',
  exit_date: 'Austrittsdatum',
  notes: 'Notizen',
  employment_type: 'Beschäftigungsart',
  weekly_hours: 'Wochenstunden',
  note: 'Notiz',
} as const;

type PersonnelField = keyof typeof PERSONNEL_FIELDS;

/** The personnel history's event labels. */
export const PERSONNEL_HISTORY_EVENTS = {
  created: 'Personalakte angelegt',
  master_data_updated: 'Personalien geändert',
  condition_added: 'Kondition hinzugefügt',
  condition_updated: 'Kondition geändert',
  condition_deleted: 'Kondition gelöscht',
  schedule_added: 'Wochenplan hinzugefügt',
} as const;

/** One history change line: „Telefon: — → 030 300030“. An empty side is the dash. */
export function personnelChangeText(
  field: PersonnelField,
  before: string | null,
  after: string | null,
): string {
  return `${PERSONNEL_FIELDS[field]}: ${before ?? '—'} → ${after ?? '—'}`;
}

/** The version badges of conditions and work schedules. */
const VERSION_BADGES = { current: 'Aktuell', scheduled: 'Geplant', former: 'Früher' } as const;

/** The exact version badge („Aktuell“, „Geplant“, „Früher“) inside one version row. */
export function versionBadge(row: Locator, version: keyof typeof VERSION_BADGES): Locator {
  return row.getByText(VERSION_BADGES[version], { exact: true });
}

/** The page-wide visible version badge, for a page that shows one version of that kind. */
export function visibleVersionBadge(page: Page, version: keyof typeof VERSION_BADGES): Locator {
  return visibleText(page, VERSION_BADGES[version]);
}

/** The condition summary's weekly hours: „35 Std./Woche“. */
export function conditionWeeklyHoursText(hours: number): string {
  return `${hours} Std./Woche`;
}

/** The condition summary's yearly vacation entitlement: „28 Urlaubstage/Jahr“. */
export function conditionVacationDaysText(days: number): string {
  return `${days} Urlaubstage/Jahr`;
}

/** A work schedule's weekly total: „40 Std. pro Woche“ or „7 Min. pro Woche“. */
export function weeklyScheduleText(total: { hours: number } | { minutes: number }): string {
  return 'hours' in total ? `${total.hours} Std. pro Woche` : `${total.minutes} Min. pro Woche`;
}

/** One row of the personnel list (members table or further personnel) by the person's name. */
export function personnelListRow(page: Page, name: string): Locator {
  return confirmed(page.getByRole('row').filter({ hasText: name }).filter({ visible: true }));
}

/** The daily progress bar of a list row at a percentage. */
export function dailyProgressAtPercent(row: Locator, percent: number): Locator {
  return row.getByRole('progressbar', { name: `Tagesfortschritt: ${percent}%` });
}

/** The daily progress bar of a list row on a closure day (zero target with its reason). */
export function dailyProgressOnClosureDay(row: Locator): Locator {
  return row.getByRole('progressbar', { name: `Tagesfortschritt: ${TARGET_COPY.closure}` });
}

/** The marker that a list row runs on the default target without a work schedule. */
export function defaultTargetMarker(row: Locator): Locator {
  return row.getByLabel(PERSONNEL_COPY.noSchedule);
}

/** The header of a personnel record detail page (title and state badges). */
export function personnelRecordHeader(page: Page, recordName: string): Locator {
  return pageHeader(page).filter({ has: page.getByRole('heading', { name: recordName }) });
}

// P1-03: personnel identity and date-effective employment conditions.

export async function openMemberDetailFromList(page: Page, name: string): Promise<void> {
  await page.goto('/mitarbeiter');
  const memberLink = page.getByRole('link', { name, exact: true });
  await expect(memberLink).toBeVisible({ timeout: 20_000 });
  const memberHref = await memberLink.getAttribute('href');
  if (!memberHref) {
    throw new Error(`openMemberDetailFromList: link for ${name} has no href`);
  }
  // This helper often follows a settings mutation whose Realtime event can
  // still refresh the list and supersede an App Router transition. Follow the
  // semantic link directly while establishing the persisted setup state.
  await page.goto(memberHref);
  await page.waitForURL(/\/mitarbeiter\/[0-9a-f-]{36}/, { timeout: 20_000 });
  await expect(visibleText(page, PERSONNEL_COPY.personnelSection)).toBeVisible({
    timeout: 15_000,
  });
}

/** The inline-edit pencil of one Personalien field. */
function personnelFieldEditButton(page: Page, fieldLabel: string): Locator {
  return page.getByRole('button', { name: `${fieldLabel} bearbeiten`, exact: true });
}

/** The text fields of the shared MetadataSection on customer and project details. */
const METADATA_TEXT_FIELDS = { name: 'Name', description: 'Beschreibung' } as const;

// Inline edit of one Personalien field through the shared MetadataSection
// pencil-edit flow (text fields only; dates use the segmented DatePicker).
export async function editPersonnelTextField(
  page: Page,
  field: PersonnelField,
  value: string,
): Promise<void> {
  await editInlineTextField(page, PERSONNEL_FIELDS[field], value);
}

export async function editMetadataTextField(
  page: Page,
  field: keyof typeof METADATA_TEXT_FIELDS,
  value: string,
): Promise<void> {
  await editInlineTextField(page, METADATA_TEXT_FIELDS[field], value);
}

async function editInlineTextField(page: Page, fieldLabel: string, value: string): Promise<void> {
  await personnelFieldEditButton(page, fieldLabel).click();
  // The field editor autofocuses its input; targeting :focus avoids matching
  // unrelated inputs elsewhere on the detail page (e.g. table search boxes).
  const input = page.locator('input:focus, textarea:focus');
  await expect(input).toBeVisible();
  await input.fill(value);
  await page.getByRole('button', { name: SHARED_COPY.action.save, exact: true }).click();
  await expectVisibleAfterSave(page, value);
}

function isoToGermanDate(dateIso: string): string {
  const [year, month, day] = dateIso.split('-');
  return `${day}.${month}.${year}`;
}

/** Sets the exit date inline and proves it persisted across a reload. */
export async function editPersonnelExitDate(page: Page, dateIso: string): Promise<void> {
  const editButton = personnelFieldEditButton(page, PERSONNEL_FIELDS.exit_date);
  await editButton.click();
  await typeIntoDatePicker(page.getByRole('main'), SHARED_COPY.field.date, datePickerDigits(dateIso), 10);
  await page.getByRole('button', { name: SHARED_COPY.action.save, exact: true }).click();
  await expect(editButton).toBeVisible({
    timeout: 15_000,
  });
  await page.reload();
  await expect(visibleText(page, isoToGermanDate(dateIso))).toBeVisible({
    timeout: 15_000,
  });
}

/** The page action that opens the „Personalakte anlegen“ dialog. */
export function createPersonnelRecordButton(page: Page): Locator {
  return page.getByRole('button', { name: PERSONNEL_COPY.createRecord });
}

/** The submit button inside the „Personalakte anlegen“ dialog. */
export function submitPersonnelRecordButton(dialog: Locator): Locator {
  return dialog.getByRole('button', { name: PERSONNEL_COPY.createRecord, exact: true });
}

/** The detail action that opens the „Kondition hinzufügen“ dialog. */
export function addConditionButton(page: Page): Locator {
  return page.getByRole('button', { name: 'Kondition hinzufügen' });
}

/** One visible condition version by its valid-from date (dd.mm.yyyy). */
export function conditionRow(page: Page, validFromLabel: string): Locator {
  return confirmed(
    page
      .getByRole('listitem')
      .filter({ hasText: `${SHARED_COPY.field.validFrom} ${validFromLabel}` })
      .filter({ visible: true }),
  );
}

/** The actions menu trigger of one condition version. */
function conditionActionsButton(row: Locator, validFromLabel: string): Locator {
  return row.getByRole('button', { name: `Aktionen für Kondition vom ${validFromLabel}` });
}

export async function addConditionViaDialog(
  page: Page,
  options: {
    // ddmmyyyy digits for the valid-from date; omitted = keep today's default.
    validFromDigits?: string;
    employmentType: EmploymentType;
    weeklyHours?: string;
    vacationDays?: string;
    note?: string;
  },
): Promise<void> {
  const detailUrl = page.url();
  for (let attempt = 0; attempt < 2; attempt += 1) {
    if (page.url() !== detailUrl) await page.goto(detailUrl);
    // Drain a pending refresh from the preceding test of the file before the
    // modal owns user input. The hook itself debounces for 150 ms (REALTIME_DEBOUNCE_MS).
    await page.waitForTimeout(300);
    if (page.url() !== detailUrl) {
      if (attempt === 0) continue;
      throw new Error('addConditionViaDialog: detail route refreshed away');
    }
    await addConditionButton(page).click();
    await expect(page.getByRole('heading', { name: 'Kondition hinzufügen' })).toBeVisible();

    const dialog = page.getByRole('dialog');
    try {
      if (options.validFromDigits) {
        // Keep controlled date entry below the shared 150 ms Realtime debounce.
        await typeIntoDatePicker(dialog, SHARED_COPY.field.validFrom, options.validFromDigits, 10);
      }

      await dialog.locator('#condition-type').click({ timeout: 5_000 });
      await page
        .getByRole('option', { name: EMPLOYMENT_TYPE_LABELS[options.employmentType], exact: true })
        .click({ timeout: 5_000 });

      if (options.weeklyHours !== undefined) {
        await dialog.locator('#condition-weekly-hours').fill(options.weeklyHours, { timeout: 5_000 });
      }
      if (options.vacationDays !== undefined) {
        await dialog.locator('#condition-vacation-days').fill(options.vacationDays, { timeout: 5_000 });
      }
      if (options.note !== undefined) {
        await dialog.locator('#condition-note').fill(options.note, { timeout: 5_000 });
      }

      await dialog
        .getByRole('button', { name: SHARED_COPY.action.save, exact: true })
        .click({ timeout: 5_000 });
      await expect(page.getByRole('dialog')).toHaveCount(0, {
        timeout: 15_000,
      });
      return;
    } catch (error) {
      const dialogWasInterrupted = page.url() !== detailUrl || !(await dialog.isVisible().catch(() => false));
      if (attempt === 0 && dialogWasInterrupted) continue;
      throw error;
    }
  }
}

export async function editConditionWeeklyHours(
  page: Page,
  validFromLabel: string,
  weeklyHours: string,
): Promise<void> {
  const row = conditionRow(page, validFromLabel).first();
  await conditionActionsButton(row, validFromLabel).click();
  await page.getByRole('menuitem', { name: SHARED_COPY.action.edit }).click();
  await expect(page.getByRole('heading', { name: 'Kondition bearbeiten' })).toBeVisible();
  await page.locator('#condition-weekly-hours').fill(weeklyHours);
  await page.getByRole('dialog').getByRole('button', { name: SHARED_COPY.action.save, exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0, { timeout: 15_000 });
}

/** Deletes one condition version through its actions menu and the confirmation. */
export async function deleteConditionViaMenu(page: Page, validFromLabel: string): Promise<void> {
  await conditionActionsButton(conditionRow(page, validFromLabel), validFromLabel).click();
  await page.getByRole('menuitem', { name: SHARED_COPY.action.delete }).click();
  const deleteDialog = page.getByRole('alertdialog');
  await deleteDialog.getByRole('button', { name: SHARED_COPY.action.delete, exact: true }).click();
  await expect(deleteDialog).toHaveCount(0, { timeout: 15_000 });
}

export async function createPersonnelRecordViaDialog(
  page: Page,
  options: {
    firstName?: string;
    lastName: string;
    entryDateDigits?: string;
    employeeNumber?: string;
  },
): Promise<PersistedEmployeeRecord> {
  await page.goto('/mitarbeiter');
  await createPersonnelRecordButton(page).click();
  await expect(page.getByRole('heading', { name: PERSONNEL_COPY.createRecord })).toBeVisible();

  const dialog = page.getByRole('dialog');
  if (options.firstName) {
    await page.locator('#personnel-first-name').fill(options.firstName);
  }
  await page.locator('#personnel-last-name').fill(options.lastName);
  if (options.employeeNumber !== undefined) {
    await page.locator('#personnel-number').fill(options.employeeNumber);
  } else {
    // The number suggestion arrives asynchronously; wait so the submit cannot
    // race it (mirrors the request/job dialogs).
    await expect(page.locator('#personnel-number')).toHaveValue(/.+/, {
      timeout: 15_000,
    });
  }
  if (options.entryDateDigits) {
    await typeIntoDatePicker(dialog, PERSONNEL_COPY.entryDate, options.entryDateDigits);
  }

  await submitPersonnelRecordButton(dialog).click();
  const reachedDetail = await page
    .waitForURL(/\/mitarbeiter\/[0-9a-f-]{36}/, { timeout: 20_000 })
    .then(() => true)
    .catch(() => false);
  if (!reachedDetail) {
    // Realtime can refresh the list after the insert and win the race against
    // the action's detail redirect. Follow the persisted row instead.
    const recordName = [options.firstName, options.lastName].filter(Boolean).join(' ');
    const recordLink = page.getByRole('link', {
      name: recordName,
      exact: true,
    });
    await expect(recordLink).toBeVisible({ timeout: 30_000 });
    await recordLink.click();
    await page.waitForURL(/\/mitarbeiter\/[0-9a-f-]{36}/, { timeout: 20_000 });
  }

  const recordId = page.url().match(/\/mitarbeiter\/([0-9a-f-]{36})/)?.[1];
  if (!recordId) {
    throw new Error('createPersonnelRecordViaDialog: could not read the record id');
  }
  return getEmployeeRecordById(recordId);
}

export async function sendInviteFromPersonnelRecord(
  page: Page,
  email: string,
  role: Exclude<keyof typeof ROLE_LABELS, 'admin'>,
): Promise<void> {
  await page.getByRole('button', { name: 'Zugang einladen' }).click();
  await expect(page.getByRole('heading', { name: /Zugang für .* einladen/ })).toBeVisible();
  await page.locator('#personnel-invite-email').fill(email);
  await page.locator('#personnel-invite-role').click();
  await page.getByRole('option', { name: ROLE_LABELS[role], exact: true }).click();
  await page.getByRole('button', { name: 'Einladung senden' }).click();
  // A Realtime refresh can replace the dialog before its short success flash
  // is observed. Assert the persisted personnel state and audit entry instead.
  await expect(page.getByRole('dialog')).toHaveCount(0, {
    timeout: 30_000,
  });
  await expect(visibleText(page, PERSONNEL_COPY.invited)).toBeVisible();
  await expect(visibleText(page, PERSONNEL_COPY.inviteSent)).toBeVisible();
}

/**
 * Opens the job dialog's employee picker on /auftraege and returns its search
 * field: the picker that a personnel record without login must never reach.
 */
export async function openJobEmployeePickerSearch(page: Page): Promise<Locator> {
  await page.goto('/auftraege');
  await workCreateButton(page).click();
  await workCreateTab(page, 'job').click();
  await employeeAssignmentPicker(page).click();
  return employeeAssignmentSearch(page);
}

// P1-04: date-effective work schedules and holiday/closure context.

/** The daily and weekly target copy of the time overview and the member detail. */
export const TARGET_COPY = {
  closure: 'Betriebsruhe',
  noTargetToday: 'heute keine Sollarbeitszeit.',
  dailyTargetPrefix: 'Tagesziel:',
  noWorkday: 'Laut Arbeitszeitmodell heute kein Arbeitstag.',
  vacationNoTarget: 'Urlaub genehmigt – heute keine Sollarbeitszeit.',
  sicknessNoTarget: 'Krankmeldung – heute keine Sollarbeitszeit.',
} as const;

/**
 * Today's target line on the time overview: „Tagesziel: 1 Min. Arbeitszeit“,
 * or its half-day variants for a half vacation or a half sickness day. The
 * duration comes formatted (formatDuration).
 */
export function dailyTargetText(duration: string, halfDay?: 'vacation' | 'sickness'): string {
  const prefix =
    halfDay === 'vacation'
      ? 'Halber Urlaubstag – '
      : halfDay === 'sickness'
        ? 'Halber Tag Krankmeldung – '
        : '';
  return `${prefix}${TARGET_COPY.dailyTargetPrefix} ${duration} Arbeitszeit`;
}

/** A holiday's own target line: „Feiertag: Neujahr“. */
export function holidayTargetText(holidayName: string | null): string {
  return `Feiertag: ${String(holidayName)}`;
}

/** The weekly chart's target: „Soll: 38 Std. 30 Min.“; the duration comes formatted. */
export function weeklyTargetText(duration: string): string {
  return `Soll: ${duration}`;
}

/** The weekly chart's target in whole hours: „Soll: 40 Std.“. */
export function weeklyTargetHoursText(hours: number): string {
  return weeklyTargetText(`${hours} Std.`);
}

export async function addWorkScheduleViaDialog(
  page: Page,
  options: {
    // ddmmyyyy digits for the valid-from date; omitted = keep today's default.
    validFromDigits?: string;
    // Hours per weekday as typed strings, index 0 = Montag … 6 = Sonntag;
    // omitted = keep the dialog's full-time default (Mo–Fr 8, weekend 0).
    dayHours?: string[];
    note?: string;
  },
): Promise<void> {
  const detailUrl = page.url();
  for (let attempt = 0; attempt < 2; attempt += 1) {
    if (page.url() !== detailUrl) await page.goto(detailUrl);
    // A schedule event from the preceding test's action can arrive after
    // navigation. Let the 150 ms router-refresh debounce (REALTIME_DEBOUNCE_MS) settle first.
    await page.waitForTimeout(300);
    if (page.url() !== detailUrl) {
      if (attempt === 0) continue;
      throw new Error('addWorkScheduleViaDialog: detail route refreshed away');
    }
    await page.getByRole('button', { name: 'Wochenplan hinzufügen' }).click();
    await expect(page.getByRole('heading', { name: 'Wochenplan hinzufügen' })).toBeVisible();

    const dialog = page.getByRole('dialog');
    try {
      if (options.validFromDigits) {
        // Keep this controlled input below the shared 150 ms Realtime debounce.
        await typeIntoDatePicker(dialog, SHARED_COPY.field.validFrom, options.validFromDigits, 10);
      }
      if (options.dayHours) {
        for (const [index, hours] of options.dayHours.entries()) {
          await dialog.locator(`#schedule-day-${index}`).fill(hours, { timeout: 5_000 });
        }
      }
      if (options.note !== undefined) {
        await dialog.locator('#schedule-note').fill(options.note, { timeout: 5_000 });
      }
      await dialog
        .getByRole('button', { name: SHARED_COPY.action.save, exact: true })
        .click({ timeout: 5_000 });
      await expect(page.getByRole('dialog')).toHaveCount(0, {
        timeout: 15_000,
      });
      return;
    } catch (error) {
      const dialogWasInterrupted = page.url() !== detailUrl || !(await dialog.isVisible().catch(() => false));
      if (attempt === 0 && dialogWasInterrupted) continue;
      throw error;
    }
  }
}

/** The holiday-region select on the time settings. */
export function holidayRegionSelect(page: Page): Locator {
  return page.getByLabel('Bundesland');
}

/** The holiday-region save button on the time settings. */
export function saveHolidayRegionButton(page: Page): Locator {
  return page.getByRole('button', { name: 'Feiertagskalender speichern' });
}

export async function setHolidayRegionViaSettings(page: Page, regionLabel: string): Promise<void> {
  await page.goto('/einstellungen/zeiterfassung');
  await selectFromSearchable(page, page.locator('#holiday-region'), regionLabel);
  await saveHolidayRegionButton(page).click();
  await expect(page.getByText('Der Feiertagskalender wurde gespeichert.')).toBeVisible({
    timeout: 15_000,
  });
}

const CLOSURE_DATE_FIELD = 'Datum der Betriebsruhe';

/** The submit button of the closure-day form on the time settings. */
export function closureDaySubmitButton(page: Page): Locator {
  return page.getByRole('button', { name: 'Eintragen' });
}

/** Fills and submits the closure-day form without asserting the outcome (for a refused date). */
export async function submitClosureDayForm(
  page: Page,
  options: { dateDigits: string; label: string },
): Promise<void> {
  await typeIntoDatePicker(page.getByRole('main'), CLOSURE_DATE_FIELD, options.dateDigits);
  await page.getByLabel('Bezeichnung (optional)').fill(options.label);
  await closureDaySubmitButton(page).click();
}

export async function addClosureDayViaSettings(
  page: Page,
  options: { dateDigits: string; label?: string; beforeSubmit?: () => Promise<void> },
): Promise<void> {
  await page.goto('/einstellungen/zeiterfassung');
  await typeIntoDatePicker(page.locator('body'), CLOSURE_DATE_FIELD, options.dateDigits);
  if (options.label !== undefined) {
    await page.locator('#closure-label').fill(options.label);
  }
  await options.beforeSubmit?.();
  await closureDaySubmitButton(page).click();
  await expect(page.getByText('Der Betriebsruhe-Tag wurde eingetragen.')).toBeVisible({
    timeout: 15_000,
  });
}

// dateLabel: dd.mm.yyyy — the aria-label also contains the weekday, so match
// via regular expression around the date.
export async function removeClosureDayViaSettings(
  page: Page,
  dateLabel: string,
  beforeSubmit?: () => Promise<void>,
): Promise<void> {
  await page.goto('/einstellungen/zeiterfassung');
  const escaped = dateLabel.replace(/\./g, '\\.');
  await beforeSubmit?.();
  await page
    .getByRole('button', {
      name: new RegExp(`Betriebsruhe am .*${escaped} entfernen`),
    })
    .click();
  await expect(page.getByText('Der Betriebsruhe-Tag wurde entfernt.')).toBeVisible({
    timeout: 15_000,
  });
}

// P1-05: scoped responsibilities, effective previews, and substitutions.

/** The responsibility settings copy that the role variants read. */
export const RESPONSIBILITY_COPY = {
  roleDefaultMode: 'Standardrollen',
  selectedMode: 'Bestimmte Personen',
  readOnlyHint: 'Du kannst die Regel einsehen. Nur der Admin kann sie ändern.',
  ownSummary: 'Meine Verantwortlichkeiten und Vertretungen',
  currentlyResponsible: 'Aktuell verantwortlich',
  notResponsible: 'Nicht verantwortlich',
  substituteUntil: 'Vertretung bis',
} as const;

/** The own-summary line of a substitute: „Vertretung für Ada Admin“. */
export function substituteForText(delegatorName: string): string {
  return `Vertretung für ${delegatorName}`;
}

/** The settings card of one responsibility. */
export function responsibilityCard(page: Page, responsibility: OrganizationResponsibility): Locator {
  return confirmed(page.getByRole('main').getByTestId(`responsibility-${responsibility}`));
}

/** The admin action that opens the responsibility change dialog. */
export function changeResponsibilityButton(scope: Page | Locator): Locator {
  return scope.getByRole('button', { name: 'Verantwortung ändern' });
}

/** The admin action that opens the delegation dialog. */
export function addDelegationButton(scope: Page | Locator): Locator {
  return scope.getByRole('button', { name: 'Vertretung eintragen' });
}

/** The member detail's responsibility summary region. */
export function responsibilitySummary(page: Page): Locator {
  return page.getByRole('region', { name: 'Verantwortlichkeiten & Vertretung' });
}

/** The summary's badge with the number of active delegations: „1 Vertretung“. */
export function activeDelegationsBadge(summary: Locator, count: number): Locator {
  return summary.getByText(`${count} ${count === 1 ? 'Vertretung' : 'Vertretungen'}`, { exact: true });
}

export async function previewResponsibilityChange(
  page: Page,
  options: {
    responsibility: 'time_approval' | 'leave_approval';
    selectedNames?: string[];
    gainedNames?: string[];
    lostNames?: string[];
  },
): Promise<void> {
  await page.goto('/einstellungen/mitarbeiter');
  const card = responsibilityCard(page, options.responsibility);
  await changeResponsibilityButton(card).click();
  const dialog = page.getByRole('dialog');

  if (options.selectedNames) {
    await dialog.locator(`#${options.responsibility}-mode`).click();
    await page.getByRole('option', { name: RESPONSIBILITY_COPY.selectedMode }).click();
    await expect(dialog.getByRole('checkbox').first()).toBeVisible({
      timeout: 15_000,
    });
    for (const checkbox of await dialog.getByRole('checkbox').all()) {
      if (await checkbox.isChecked()) await checkbox.uncheck();
    }
    for (const name of options.selectedNames) {
      await dialog.getByRole('checkbox', { name: new RegExp(name) }).check();
    }
  } else {
    await dialog.locator(`#${options.responsibility}-mode`).click();
    await page.getByRole('option', { name: 'Standardrollen: Admin und Büro' }).click();
  }

  await dialog.getByRole('button', { name: 'Wirkung prüfen' }).click();
  const preview = dialog.getByTestId('effective-access-preview');
  await expect(preview).toBeVisible({ timeout: 15_000 });
  const gainedSection = preview.getByTestId('preview-gained');
  const lostSection = preview.getByTestId('preview-lost');
  for (const name of options.gainedNames ?? []) {
    await expect(gainedSection.getByText(name, { exact: false })).toBeVisible();
  }
  for (const name of options.lostNames ?? []) {
    await expect(lostSection.getByText(name, { exact: false })).toBeVisible();
  }
}

export async function confirmResponsibilityPreview(page: Page): Promise<void> {
  await page.getByRole('dialog').getByRole('button', { name: 'Änderung bestätigen' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0, { timeout: 15_000 });
}

const END_DELEGATION_TODAY = 'Heute beenden';

export async function createResponsibilityDelegationViaSettings(
  page: Page,
  options: {
    responsibility: 'time_approval' | 'leave_approval';
    delegatorName: string;
    substituteName: string;
    validFromDigits: string;
    validUntilDigits: string;
  },
): Promise<void> {
  await page.goto('/einstellungen/mitarbeiter');
  const card = responsibilityCard(page, options.responsibility);
  await addDelegationButton(card).click();
  const dialog = page.getByRole('dialog');

  const delegatorTrigger = dialog.locator(`#${options.responsibility}-delegator`);
  await expect(delegatorTrigger).toBeVisible({ timeout: 15_000 });
  if (!(await delegatorTrigger.textContent())?.includes(options.delegatorName)) {
    await selectFromSearchable(page, delegatorTrigger, options.delegatorName);
  }
  await selectFromSearchable(
    page,
    dialog.locator(`#${options.responsibility}-substitute`),
    options.substituteName,
  );
  await typeIntoDatePicker(dialog, SHARED_COPY.field.validFrom, options.validFromDigits);
  await typeIntoDatePicker(dialog, 'Gültig bis', options.validUntilDigits);
  await dialog.getByRole('button', { name: 'Vertretung speichern' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0, { timeout: 15_000 });
  const activeDelegationRow = (scope: Locator): Locator =>
    confirmed(scope.locator('li'))
      .filter({ hasText: options.substituteName })
      .filter({ has: page.getByRole('button', { name: END_DELEGATION_TODAY }) })
      .first();
  try {
    await expect(activeDelegationRow(card)).toBeVisible({ timeout: 15_000 });
  } catch {
    await page.reload();
    await expect(activeDelegationRow(responsibilityCard(page, options.responsibility))).toBeVisible({
      timeout: 15_000,
    });
  }
}

export async function endResponsibilityDelegationViaSettings(
  page: Page,
  responsibility: 'time_approval' | 'leave_approval',
  substituteName: string,
): Promise<void> {
  await page.goto('/einstellungen/mitarbeiter');
  const card = responsibilityCard(page, responsibility);
  const row = confirmed(card.locator('li'))
    .filter({ hasText: substituteName })
    .filter({ has: page.getByRole('button', { name: END_DELEGATION_TODAY }) })
    .first();
  await row.getByRole('button', { name: END_DELEGATION_TODAY }).click();
  const endedRow = confirmed(card.locator('li'))
    .filter({ hasText: substituteName })
    .filter({ has: page.getByText('Beendet', { exact: true }) })
    .first();
  await expect(endedRow.getByText('Beendet', { exact: true })).toBeVisible({
    timeout: 15_000,
  });
}

// ---------------------------------------------------------------------------
// People lifecycle (P1-24): onboarding, protected personnel files, access and
// employment transitions on the member detail and in the settings.

/** Copy of the controlled people lifecycle on the member detail and in the settings. */
export const PEOPLE_LIFECYCLE_COPY = {
  noTemplate: 'Noch keine Vorlage eingerichtet.',
  noAccessRule: 'Noch keine kontrollierte Zugangsregel.',
  noPlanDerived: 'Nicht eingerichtet. Es wurde kein Plan aus Bestandsdaten abgeleitet.',
  noOpenRequirements: 'Keine offenen Anforderungen.',
  receiptConfirmed: 'Der Erhalt der Dokumentversion wurde bestätigt.',
} as const;

const LIFECYCLE_CONTROLS = {
  template: 'Vorlage',
  templateDialog: 'Onboardingvorlage veröffentlichen',
  templateName: 'Name',
  firstItem: 'Erster Punkt',
  blocksAccess: 'Blockiert die Zugangsaktivierung',
  publish: 'Veröffentlichen',
  createPlan: 'Plan anlegen',
  planDialog: 'Onboardingplan anlegen',
  noTemplateOption: 'Ohne Vorlage',
  file: 'Datei',
  uploadDialog: 'Geschützte Personalunterlage',
  documentType: 'Dokumentart',
  upload: 'Hochladen',
  release: 'Freigeben',
  acknowledge: 'Bestätigen',
  confirmReceipt: 'Erhalt bestätigen',
  controlAccess: 'Zugang steuern',
  accessDialog: 'Organisationszugang steuern',
  recordTransition: 'Übergang erfassen',
  transitionDialog: 'Beschäftigungsübergang erfassen',
  effectiveOn: 'Wirksam am',
  exportState: 'Arbeitsstand exportieren',
} as const;

function lifecycleLabel<Value extends string>(
  options: ReadonlyArray<{ value: Value; label: string }>,
  value: Value,
): string {
  const option = options.find((candidate) => candidate.value === value);
  if (!option) throw new Error(`No lifecycle option for ${value}`);
  return option.label;
}

/** The label of one onboarding template version in the plan dialog. */
export function templateVersionLabel(templateName: string, version: number): string {
  return `${templateName} · Version ${version}`;
}

/** The lifecycle section of a member detail. */
export function personnelLifecycle(page: Page): Locator {
  return page.getByRole('main').getByTestId('personnel-lifecycle');
}

/** Publishes an onboarding template with one access-blocking item from the settings. */
export async function publishOnboardingTemplate(
  page: Page,
  input: { name: string; firstItemType: PersonnelRequirementType; firstItemTitle: string },
): Promise<void> {
  await page.getByRole('button', { name: LIFECYCLE_CONTROLS.template, exact: true }).click();
  const dialog = page.getByRole('dialog', { name: LIFECYCLE_CONTROLS.templateDialog });
  await dialog.getByLabel(LIFECYCLE_CONTROLS.templateName).fill(input.name);
  await selectFromSearchable(
    page,
    dialog.getByRole('combobox').filter({ hasText: lifecycleLabel(REQUIREMENT_TYPES, 'manual') }),
    lifecycleLabel(REQUIREMENT_TYPES, input.firstItemType),
  );
  await dialog.getByLabel(LIFECYCLE_CONTROLS.firstItem).fill(input.firstItemTitle);
  await dialog.getByText(LIFECYCLE_CONTROLS.blocksAccess).click();
  await dialog.getByRole('button', { name: LIFECYCLE_CONTROLS.publish }).click();
}

/** Creates the onboarding plan of the open member detail from a template version. */
export async function createOnboardingPlan(page: Page, templateLabel: string): Promise<void> {
  await personnelLifecycle(page).getByRole('button', { name: LIFECYCLE_CONTROLS.createPlan }).click();
  const dialog = page.getByRole('dialog', { name: LIFECYCLE_CONTROLS.planDialog });
  await selectFromSearchable(
    page,
    dialog.getByRole('combobox').filter({ hasText: LIFECYCLE_CONTROLS.noTemplateOption }),
    templateLabel,
  );
  await dialog.getByRole('button', { name: LIFECYCLE_CONTROLS.createPlan }).click();
}

/** Uploads a protected personnel file on the open member detail and waits until the section lists it. */
export async function uploadProtectedPersonnelFile(
  page: Page,
  input: {
    fileName: string;
    content: string;
    documentType: string;
    accessClass?: Exclude<PersonnelDocumentAccessClass, 'personnel_standard'>;
  },
): Promise<void> {
  const lifecycle = personnelLifecycle(page);
  await lifecycle.getByRole('button', { name: LIFECYCLE_CONTROLS.file, exact: true }).click();
  const dialog = page.getByRole('dialog', { name: LIFECYCLE_CONTROLS.uploadDialog });
  await dialog.getByLabel(LIFECYCLE_CONTROLS.file).setInputFiles({
    name: input.fileName,
    mimeType: 'text/plain',
    buffer: Buffer.from(input.content),
  });
  await dialog.getByLabel(LIFECYCLE_CONTROLS.documentType).fill(input.documentType);
  if (input.accessClass) {
    await selectFromSearchable(
      page,
      dialog
        .getByRole('combobox')
        .filter({ hasText: lifecycleLabel(ACCESS_CLASS_OPTIONS, 'personnel_standard') }),
      lifecycleLabel(ACCESS_CLASS_OPTIONS, input.accessClass),
    );
  }
  await dialog.getByRole('button', { name: LIFECYCLE_CONTROLS.upload }).click();
  await expect(visibleText(lifecycle, input.fileName)).toBeVisible({ timeout: 20_000 });
}

/** The release action of one protected file in the lifecycle section. */
export function protectedFileReleaseButton(lifecycle: Locator, fileName: string): Locator {
  return confirmed(lifecycle.getByRole('listitem'))
    .filter({ hasText: fileName })
    .getByRole('button', { name: LIFECYCLE_CONTROLS.release });
}

/** The employee's acknowledgement of an onboarding requirement. */
export function acknowledgeRequirementButton(page: Page): Locator {
  return page.getByRole('button', { name: LIFECYCLE_CONTROLS.acknowledge, exact: true });
}

/** The employee's receipt confirmation of a released document. */
export function confirmReceiptButton(page: Page): Locator {
  return page.getByRole('button', { name: LIFECYCLE_CONTROLS.confirmReceipt });
}

/** The banner that confirms a document receipt. */
export function receiptConfirmedBanner(page: Page): Locator {
  return page.getByRole('alert').filter({ hasText: PEOPLE_LIFECYCLE_COPY.receiptConfirmed });
}

/** The access control action of the lifecycle section. */
export function accessControlButton(lifecycle: Locator): Locator {
  return lifecycle.getByRole('button', { name: LIFECYCLE_CONTROLS.controlAccess });
}

/** Records one organization access transition with a reason and waits until the dialog closes. */
export async function changeOrganizationAccess(
  page: Page,
  transition: PersonnelAccessTransitionKind,
  reason: string,
): Promise<void> {
  await accessControlButton(personnelLifecycle(page)).click();
  const dialog = page.getByRole('dialog', { name: LIFECYCLE_CONTROLS.accessDialog });
  await selectFromSearchable(
    page,
    dialog.getByRole('combobox'),
    lifecycleLabel(ACCESS_TRANSITIONS, transition),
  );
  await dialog.getByLabel(SHARED_COPY.field.reason).fill(reason);
  await dialog.getByRole('button', { name: SHARED_COPY.action.save }).click();
  await expect(dialog).toBeHidden({ timeout: 15_000 });
}

/** Records one employment transition from a date with a reason. */
export async function recordEmploymentTransition(
  page: Page,
  input: { transition: PersonnelEmploymentTransitionKind; effectiveOn: string; reason: string },
): Promise<void> {
  await personnelLifecycle(page).getByRole('button', { name: LIFECYCLE_CONTROLS.recordTransition }).click();
  const dialog = page.getByRole('dialog', { name: LIFECYCLE_CONTROLS.transitionDialog });
  await selectFromSearchable(
    page,
    dialog.getByRole('combobox').filter({ hasText: lifecycleLabel(EMPLOYMENT_TRANSITIONS, 'record_notice') }),
    lifecycleLabel(EMPLOYMENT_TRANSITIONS, input.transition),
  );
  await typeIntoDatePicker(dialog, LIFECYCLE_CONTROLS.effectiveOn, datePickerDigits(input.effectiveOn));
  await dialog.getByLabel(SHARED_COPY.field.reason).fill(input.reason);
  await dialog.getByRole('button', { name: SHARED_COPY.action.save }).click();
}

/** The export of a member's working state. */
export function exportWorkingStateButton(lifecycle: Locator): Locator {
  return lifecycle.getByRole('button', { name: LIFECYCLE_CONTROLS.exportState });
}

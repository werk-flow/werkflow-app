import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Locator, Page } from '@playwright/test';

import { expect, test } from '../../golden/support/fixtures';
import { requireEnv } from '../../golden/support/env';
import {
  getOrganizationTimeEntryCount,
  getPlanningState,
} from '../../golden/support/db';
import {
  addClosureDayViaSettings,
  approveVacationRequestFor,
  cancelApprovedVacationFor,
  createJob,
  createOwnVacationRequestViaDialog,
  createPersonnelRecordViaDialog,
  createPlannedCalendarEntry,
  openAufgaben,
  openOwnSicknessSection,
  openOwnVacationSection,
  plannedCalendarEvent,
  removeClosureDayViaSettings,
  reportOwnSicknessViaDialog,
  setHolidayRegionViaSettings,
  showPlanningMonth,
  typeIntoDatePickerById,
  typeIntoTimeInput,
} from '../../golden/support/steps';
import {
  addLocalMonthsClamped,
  formatBerlinLocalDateTime,
} from '../../../lib/planning/date-time';
import { getPublicHolidaysForYear } from '../../../lib/personnel/holidays';

// A6 — Planung (P1-11). Serial journeys over the shared audit world; every
// business mutation runs through the real UI and database access below is
// read-only assertion state. Owned uniqueness-constrained run-day offsets:
// +45 … +54 (vacation/sickness/closure fixtures). Planning occurrence dates
// themselves are not uniqueness-constrained; series fixtures use run-scoped
// titles on far-future dates so inherited state can never collide.

test.describe.configure({ mode: 'serial' });

const WEEKDAY_LABELS = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'] as const;

function berlinTodayIso(): string {
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Europe/Berlin',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

function shiftIsoDate(dateIso: string, days: number): string {
  const [year, month, day] = dateIso.split('-').map(Number);
  const shifted = new Date(Date.UTC(year, month - 1, day) + days * 86_400_000);
  return `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, '0')}-${String(shifted.getUTCDate()).padStart(2, '0')}`;
}

function toDatePickerDigits(dateIso: string): string {
  const [year, month, day] = dateIso.split('-');
  return `${day}${month}${year}`;
}

function formatGermanDate(dateIso: string): string {
  const [year, month, day] = dateIso.split('-');
  return `${day}.${month}.${year}`;
}

// Stored original_start_local values carry seconds ('T06:00:00'); minute
// precision is the honest comparison unit for series identities.
function originalStartMinute(occurrence: {
  originalStartLocal: string | null;
}): string {
  return occurrence.originalStartLocal?.slice(0, 16) ?? '';
}

function isWeekday(dateIso: string): boolean {
  const [year, month, day] = dateIso.split('-').map(Number);
  const jsWeekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return jsWeekday !== 0 && jsWeekday !== 6;
}

// Monday-based weekday index (0 = Monday … 6 = Sunday), matching the form.
function mondayWeekdayIndex(dateIso: string): number {
  const [year, month, day] = dateIso.split('-').map(Number);
  const jsWeekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return jsWeekday === 0 ? 6 : jsWeekday - 1;
}

// Deterministic allocation of A6's uniqueness-constrained weekday offsets
// inside the owned +45 … +54 reserve: one consecutive weekday pair for the
// two-date changed-facts series, plus three further distinct weekdays.
function a6WeekdayOffsets(todayIso: string): {
  pendingOffset: number;
  pairOffsets: [number, number];
  closureOffset: number;
  vacationOffset: number;
} {
  const weekdayOffsets: number[] = [];
  for (let offset = 45; offset <= 54; offset++) {
    if (isWeekday(shiftIsoDate(todayIso, offset))) weekdayOffsets.push(offset);
  }
  let pairOffsets: [number, number] | null = null;
  for (const offset of weekdayOffsets) {
    if (weekdayOffsets.includes(offset + 1)) {
      pairOffsets = [offset, offset + 1];
      break;
    }
  }
  if (!pairOffsets) {
    throw new Error('A6: no consecutive weekday pair inside +45…+54');
  }
  const remaining = weekdayOffsets.filter(
    (offset) => offset !== pairOffsets![0] && offset !== pairOffsets![1]
  );
  if (remaining.length < 3) {
    throw new Error('A6: not enough distinct weekdays inside +45…+54');
  }
  return {
    pendingOffset: remaining[0],
    pairOffsets,
    closureOffset: remaining[1],
    vacationOffset: remaining[2],
  };
}

// ---------------------------------------------------------------------------
// Audit-local read-only database observers (A6 only — deliberately NOT part of
// the golden harness). Service-role SELECTs used exclusively for assertions.
// ---------------------------------------------------------------------------

let readOnlyAdminClient: SupabaseClient | null = null;

function createReadOnlyAdminClient(): SupabaseClient {
  readOnlyAdminClient ??= createClient(
    requireEnv('NEXT_PUBLIC_SUPABASE_URL'),
    requireEnv('SUPABASE_SECRET_KEY'),
    { auth: { persistSession: false, autoRefreshToken: false } }
  );
  return readOnlyAdminClient;
}

async function getInternalOccurrenceTypes(
  orgId: string,
  internalTitle: string
): Promise<string[]> {
  const admin = createReadOnlyAdminClient();
  const { data, error } = await admin
    .from('planning_occurrences')
    .select('internal_type')
    .eq('organization_id', orgId)
    .eq('entry_kind', 'internal')
    .eq('title', internalTitle);
  if (error) {
    throw new Error(`Internal occurrence lookup failed: ${error.message}`);
  }
  return (data ?? []).map((row) => row.internal_type as string);
}

async function getOccurrenceAssignmentRecordIds(
  orgId: string,
  occurrenceId: string
): Promise<string[]> {
  const admin = createReadOnlyAdminClient();
  const { data, error } = await admin
    .from('planning_occurrence_assignments')
    .select('employee_record_id')
    .eq('organization_id', orgId)
    .eq('occurrence_id', occurrenceId);
  if (error) {
    throw new Error(`Occurrence assignment lookup failed: ${error.message}`);
  }
  return (data ?? []).map((row) => row.employee_record_id as string).sort();
}

// ---------------------------------------------------------------------------
// Audit-local UI helpers. Date-cell scoped locators are used instead of the
// shared index-based event helpers because A6 series span month boundaries
// and (since P1-11-F03) skipped/cancelled occurrences stay visible.
// ---------------------------------------------------------------------------

async function openPlanningCreationDialog(page: Page): Promise<Locator> {
  await page.goto('/kalender');
  await page.getByRole('button', { name: 'Kalendereintrag' }).click();
  const dialog = page
    .getByRole('dialog')
    .filter({ has: page.getByRole('heading', { name: 'Kalendereintrag erstellen' }) });
  await expect(dialog.getByRole('tab', { name: 'Termin planen' })).toBeVisible({
    timeout: 15_000,
  });
  await dialog.getByRole('tab', { name: 'Termin planen' }).click();
  await expect(dialog.locator('#planning-date')).toBeVisible({ timeout: 15_000 });
  return dialog;
}

async function fillInternalPlanningDraft(
  page: Page,
  dialog: Locator,
  options: { title: string; dateIso: string; assignEmployeeName?: string }
): Promise<void> {
  await dialog.getByRole('button', { name: 'Interner Termin' }).click();
  await dialog.locator('#planning-title').fill(options.title);
  await typeIntoDatePickerById(dialog, 'planning-date', options.dateIso);
  if (options.assignEmployeeName) {
    await dialog
      .getByRole('combobox')
      .filter({ hasText: 'Mitarbeiter zuweisen' })
      .click();
    await page.getByPlaceholder(/Mitarbeiter suchen/).fill(options.assignEmployeeName);
    await page
      .getByRole('listbox')
      .getByRole('button')
      .filter({ hasText: options.assignEmployeeName })
      .first()
      .click();
    await dialog.getByRole('heading').first().click();
  }
}

// Opens the creation dialog, provokes the capacity check, asserts the exact
// warning line (person AND date), and leaves WITHOUT saving anything.
async function probePlanningWarningLine(
  page: Page,
  options: { title: string; dateIso: string; employeeName: string; expectedLine: string }
): Promise<void> {
  const dialog = await openPlanningCreationDialog(page);
  await fillInternalPlanningDraft(page, dialog, {
    title: options.title,
    dateIso: options.dateIso,
    assignEmployeeName: options.employeeName,
  });
  await dialog
    .getByRole('button', { name: /Planung pr.fen und speichern/ })
    .click();
  const warning = dialog.locator('[data-planning-warning]');
  await expect(warning).toBeVisible({ timeout: 30_000 });
  await expect(warning.getByText(options.expectedLine)).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0, { timeout: 15_000 });
}

function occurrenceEventInCell(
  page: Page,
  dateIso: string,
  title: string
): Locator {
  return page
    .locator(`.fc-daygrid-day[data-date="${dateIso}"]`)
    .locator('.fc-event-job')
    .filter({ hasText: title })
    .first();
}

async function openOccurrenceEditDialogByDate(
  page: Page,
  title: string,
  dateIso: string
): Promise<Locator> {
  await showPlanningMonth(page, dateIso);
  const event = occurrenceEventInCell(page, dateIso, title);
  await expect(event).toBeVisible({ timeout: 20_000 });
  await event.click();
  await page.getByRole('button', { name: 'Termin bearbeiten' }).click();
  const dialog = page
    .getByRole('dialog')
    .filter({ has: page.getByRole('heading', { name: 'Geplanten Termin bearbeiten' }) });
  await expect(dialog).toBeVisible({ timeout: 15_000 });
  return dialog;
}

async function withdrawOwnPendingVacationRequestByDate(
  page: Page,
  germanDate: string
): Promise<void> {
  await openOwnVacationSection(page);
  const escaped = germanDate.replace(/\./g, '\\.');
  const withdrawButton = page
    .getByRole('button', {
      name: new RegExp(`^Urlaubsantrag vom .*${escaped}.* zurückziehen$`),
    })
    .first();
  await withdrawButton.click();
  await expect(withdrawButton).toHaveCount(0, { timeout: 15_000 });
}

async function markAllOwnNotificationsRead(page: Page): Promise<void> {
  await openAufgaben(page);
  const unreadRows = page.locator('[data-unread="true"]');
  for (let iteration = 0; iteration < 10; iteration++) {
    const unreadCount = await unreadRows.count();
    if (unreadCount === 0) break;
    await unreadRows
      .first()
      .getByRole('button', { name: /^Benachrichtigung vom .* als gelesen markieren$/ })
      .click();
    await expect
      .poll(async () => unreadRows.count(), { timeout: 15_000 })
      .toBeLessThan(unreadCount);
  }
  await expect(unreadRows).toHaveCount(0, { timeout: 15_000 });
}

// Shared across the serial A6 tests: the organization-wide actual-time count
// captured before any A6 planning exists (planning must never create time).
let organizationTimeBaseline: number | null = null;

// The Berlin base date and the weekday allocation are frozen at module load so
// every serial test shares identical dates even when a battery run crosses
// midnight (T7 relocates fixtures created by T5).
const A6_TODAY_ISO = berlinTodayIso();
const A6_OFFSETS = a6WeekdayOffsets(A6_TODAY_ISO);

test.describe('A6 Planung @AUDIT-W1-A6', () => {
  test('A6-T1: Ganztägige Besuche und alle vier internen Terminarten, auch durch das Büro geplant [P1-11-F01]', async ({
    adminPage,
    bueroPage,
    world,
  }) => {
    const todayIso = A6_TODAY_ISO;
    organizationTimeBaseline = await getOrganizationTimeEntryCount(world.orgId);

    // The four internal entry types are offered with their exact German labels.
    const labelDialog = await openPlanningCreationDialog(adminPage);
    await labelDialog.getByRole('button', { name: 'Interner Termin' }).click();
    await labelDialog.locator('#planning-internal-type').click();
    const typeOptions = adminPage.getByRole('option');
    await expect(typeOptions).toHaveCount(4);
    for (const label of ['Interne Arbeit', 'Besprechung', 'Schulung', 'Sonstiges']) {
      await expect(
        adminPage.getByRole('option', { name: label, exact: true })
      ).toBeVisible();
    }
    await adminPage.keyboard.press('Escape');
    await adminPage.keyboard.press('Escape');
    await expect(labelDialog).toHaveCount(0, { timeout: 15_000 });

    // Büro plans a Besprechung (the default type) — the planner role includes
    // Büro, not only Admin.
    const besprechungTitle = `A6 Baustellenrunde ${world.runId}`;
    const besprechungDate = shiftIsoDate(todayIso, 48);
    await createPlannedCalendarEntry(bueroPage, {
      kind: 'internal',
      internalTitle: besprechungTitle,
      internalType: 'meeting',
      date: besprechungDate,
      time: '07:00',
      durationHours: 1,
    });
    await showPlanningMonth(bueroPage, besprechungDate);
    await expect(plannedCalendarEvent(bueroPage, besprechungTitle)).toBeVisible({
      timeout: 20_000,
    });
    expect(
      await getInternalOccurrenceTypes(world.orgId, besprechungTitle)
    ).toEqual(['meeting']);

    // Admin plans a Sonstiges entry through the visible label.
    const sonstigesTitle = `A6 Werkstatttag ${world.runId}`;
    await createPlannedCalendarEntry(adminPage, {
      kind: 'internal',
      internalTitle: sonstigesTitle,
      internalType: 'other',
      date: shiftIsoDate(todayIso, 49),
      time: '08:00',
      durationHours: 2,
    });
    expect(
      await getInternalOccurrenceTypes(world.orgId, sonstigesTitle)
    ).toEqual(['other']);

    // A JOB visit can be all-day and multi-day, not only internal entries.
    const visitJobNumber = `A6-VISIT-${world.runId}`;
    const visitTitle = `A6 Ganztagsbesuch ${world.runId}`;
    const visitDate = shiftIsoDate(todayIso, 47);
    await createJob(adminPage, { jobNumber: visitJobNumber, title: visitTitle });
    await createPlannedCalendarEntry(adminPage, {
      kind: 'job_visit',
      jobSearch: visitJobNumber,
      date: visitDate,
      durationDays: 2,
    });
    const visitState = await getPlanningState(world.orgId, {
      jobNumber: visitJobNumber,
    });
    expect(visitState.occurrenceCount).toBe(1);
    expect(visitState.occurrences[0].startAt).toBeNull();
    expect(visitState.occurrences[0].startDate).toBe(visitDate);
    expect(visitState.occurrences[0].endDateExclusive).toBe(
      shiftIsoDate(visitDate, 2)
    );
    await showPlanningMonth(adminPage, visitDate);
    await expect(plannedCalendarEvent(adminPage, visitTitle)).toBeVisible({
      timeout: 20_000,
    });
  });

  test('A6-T2: Wochen- und Monatsserien — ungültige Monatstermine fallen aus statt zu verrutschen [P1-11-F01/P1-11-F02]', async ({
    adminPage,
    world,
  }) => {
    const todayIso = A6_TODAY_ISO;

    // Weekly series across two explicit weekdays: the materialized dates use
    // exactly the selected weekdays in calendar order.
    const weeklyTitle = `A6 Wochenserie ${world.runId}`;
    const weeklyStart = shiftIsoDate(todayIso, 70);
    const startWeekdayIndex = mondayWeekdayIndex(weeklyStart);
    const secondWeekdayIndex = (startWeekdayIndex + 1) % 7;
    await createPlannedCalendarEntry(adminPage, {
      kind: 'internal',
      internalTitle: weeklyTitle,
      internalType: 'internal_work',
      date: weeklyStart,
      time: '06:00',
      durationHours: 1,
      recurrence: {
        frequency: 'weekly',
        count: 6,
        weekdayLabels: [WEEKDAY_LABELS[secondWeekdayIndex]],
      },
    });
    const expectedWeeklyDates: string[] = [];
    for (
      let date = weeklyStart;
      expectedWeeklyDates.length < 6;
      date = shiftIsoDate(date, 1)
    ) {
      const weekday = mondayWeekdayIndex(date);
      if (weekday === startWeekdayIndex || weekday === secondWeekdayIndex) {
        expectedWeeklyDates.push(date);
      }
    }
    const weeklyState = await getPlanningState(world.orgId, {
      internalTitle: weeklyTitle,
    });
    expect(weeklyState.seriesCount).toBe(1);
    expect(weeklyState.occurrences.map(originalStartMinute)).toEqual(
      expectedWeeklyDates.map((date) => `${date}T06:00`)
    );

    // Monthly series anchored on a 31st: months without a 31st DROP OUT and
    // never shift to the 30th (or 28th/29th).
    let monthlyStart: string | null = null;
    for (let monthOffset = 2; monthOffset <= 14 && !monthlyStart; monthOffset++) {
      const [year, month] = todayIso.split('-').map(Number);
      const anchor = new Date(Date.UTC(year, month - 1 + monthOffset, 31));
      if (anchor.getUTCDate() !== 31) continue;
      const candidate = `${anchor.getUTCFullYear()}-${String(anchor.getUTCMonth() + 1).padStart(2, '0')}-31`;
      if (candidate > shiftIsoDate(todayIso, 40)) monthlyStart = candidate;
    }
    if (!monthlyStart) throw new Error('A6: no month with a 31st found');
    const expectedMonthlyDates: string[] = [];
    const [startYear, startMonth] = monthlyStart.split('-').map(Number);
    for (
      let monthOffset = 0;
      expectedMonthlyDates.length < 4;
      monthOffset += 1
    ) {
      const candidate = new Date(
        Date.UTC(startYear, startMonth - 1 + monthOffset, 31)
      );
      if (candidate.getUTCDate() !== 31) continue;
      expectedMonthlyDates.push(
        `${candidate.getUTCFullYear()}-${String(candidate.getUTCMonth() + 1).padStart(2, '0')}-31`
      );
    }
    const monthlyTitle = `A6 Monatsserie ${world.runId}`;
    await createPlannedCalendarEntry(adminPage, {
      kind: 'internal',
      internalTitle: monthlyTitle,
      internalType: 'internal_work',
      date: monthlyStart,
      time: '06:00',
      durationHours: 1,
      recurrence: { frequency: 'monthly', count: 4 },
    });
    const monthlyState = await getPlanningState(world.orgId, {
      internalTitle: monthlyTitle,
    });
    expect(monthlyState.seriesCount).toBe(1);
    const monthlyDates = monthlyState.occurrences.map(
      (occurrence) => occurrence.originalStartLocal?.slice(0, 10) ?? ''
    );
    expect(monthlyDates).toEqual(expectedMonthlyDates);
    for (const date of monthlyDates) expect(date.endsWith('-31')).toBe(true);
  });

  test('A6-T3: Serien reichen 18 Monate in die Zukunft und wachsen per Klick um je sechs Monate ohne Duplikate [P1-11-F02]', async ({
    adminPage,
    world,
  }) => {
    const todayIso = A6_TODAY_ISO;
    const horizonTitle = `A6 Horizontserie ${world.runId}`;
    const horizonStart = shiftIsoDate(todayIso, 77);

    // 730 requested weekly occurrences must clamp at the 18-month horizon.
    const initialHorizonDate = addLocalMonthsClamped(horizonStart, 18);
    const expectedInitialDates: string[] = [];
    for (
      let date = horizonStart;
      date <= initialHorizonDate && expectedInitialDates.length < 730;
      date = shiftIsoDate(date, 7)
    ) {
      expectedInitialDates.push(date);
    }
    await createPlannedCalendarEntry(adminPage, {
      kind: 'internal',
      internalTitle: horizonTitle,
      internalType: 'internal_work',
      date: horizonStart,
      time: '06:00',
      durationHours: 1,
      recurrence: { frequency: 'weekly', count: 730 },
    });
    await expect(
      adminPage.getByText(`${expectedInitialDates.length} Termine wurden geplant.`)
    ).toBeVisible({ timeout: 20_000 });
    const initialState = await getPlanningState(world.orgId, {
      internalTitle: horizonTitle,
    });
    expect(initialState.occurrences.map(originalStartMinute)).toEqual(
      expectedInitialDates.map((date) => `${date}T06:00`)
    );

    // One click adds exactly the next six months of occurrences — twice, and
    // every occurrence identity stays unique (no duplicates on repetition).
    const computeExtension = (currentDates: string[]): string[] => {
      const generatedThrough = currentDates[currentDates.length - 1];
      const extensionHorizon = addLocalMonthsClamped(generatedThrough, 6);
      const added: string[] = [];
      for (
        let date = shiftIsoDate(generatedThrough, 7);
        date <= extensionHorizon;
        date = shiftIsoDate(date, 7)
      ) {
        added.push(date);
      }
      return added;
    };

    let expectedDates = [...expectedInitialDates];
    for (let clickIndex = 0; clickIndex < 2; clickIndex++) {
      const addedDates = computeExtension(expectedDates);
      expect(addedDates.length).toBeGreaterThan(0);
      const dialog = await openOccurrenceEditDialogByDate(
        adminPage,
        horizonTitle,
        horizonStart
      );
      await dialog
        .getByRole('button', { name: 'Serie um sechs Monate verlängern' })
        .click();
      await expect(
        adminPage.getByText(
          `Serie wurde um sechs Monate verlängert (${addedDates.length} neue Termine).`
        )
      ).toBeVisible({ timeout: 30_000 });
      expectedDates = [...expectedDates, ...addedDates];
      const extendedState = await getPlanningState(world.orgId, {
        internalTitle: horizonTitle,
      });
      const identities = extendedState.occurrences.map(originalStartMinute);
      expect(identities).toEqual(expectedDates.map((date) => `${date}T06:00`));
      expect(new Set(identities).size).toBe(identities.length);
    }
  });

  test('A6-T4: Vergangenes und Begonnenes bleibt unverändert; abgesagte und ausgelassene Termine bleiben sichtbar [P1-11-F03]', async ({
    adminPage,
    world,
  }) => {
    const todayIso = A6_TODAY_ISO;
    const yesterdayIso = shiftIsoDate(todayIso, -1);
    const title = `A6 Rückblick ${world.runId}`;

    // Daily series starting YESTERDAY: the first occurrence is irrevocably in
    // the past when the edits below run.
    await createPlannedCalendarEntry(adminPage, {
      kind: 'internal',
      internalTitle: title,
      internalType: 'meeting',
      date: yesterdayIso,
      time: '06:00',
      durationHours: 1,
      recurrence: { frequency: 'daily', count: 4 },
    });
    const createdState = await getPlanningState(world.orgId, {
      internalTitle: title,
    });
    expect(createdState.occurrenceCount).toBe(4);
    const pastStartAt = createdState.occurrences.find(
      (occurrence) => originalStartMinute(occurrence) === `${yesterdayIso}T06:00`
    )?.startAt;
    expect(pastStartAt).toBeTruthy();

    // Editing the past occurrence directly is refused understandably; the
    // dialog offers exactly the three documented scopes.
    const pastDialog = await openOccurrenceEditDialogByDate(
      adminPage,
      title,
      yesterdayIso
    );
    await pastDialog.locator('#planning-edit-scope').click();
    for (const scopeLabel of [
      'Nur dieser Termin',
      'Dieser und zukünftige',
      'Ganze Serie ab frühestem änderbaren Termin',
    ]) {
      await expect(
        adminPage.getByRole('option', { name: scopeLabel, exact: true })
      ).toBeVisible();
    }
    await adminPage
      .getByRole('option', { name: 'Nur dieser Termin', exact: true })
      .click();
    await typeIntoTimeInput(pastDialog, 'planning-edit-time', '0930');
    await pastDialog
      .getByRole('button', { name: 'Änderung speichern', exact: true })
      .click();
    await expect(
      adminPage.getByText('Begonnene oder vergangene Termine bleiben unverändert.')
    ).toBeVisible({ timeout: 20_000 });
    await expect(pastDialog).toBeVisible();
    // Both the footer button and the dialog X are named "Schließen".
    await pastDialog.getByRole('button', { name: 'Schließen' }).first().click();
    await expect(pastDialog).toHaveCount(0, { timeout: 15_000 });

    // Whole-series edit: only future occurrences move; the past occurrence is
    // byte-identical afterwards.
    const preEditState = await getPlanningState(world.orgId, {
      internalTitle: title,
    });
    const nowMs = Date.now();
    const seriesDialog = await openOccurrenceEditDialogByDate(
      adminPage,
      title,
      shiftIsoDate(todayIso, 2)
    );
    await seriesDialog.locator('#planning-edit-scope').click();
    await adminPage
      .getByRole('option', { name: 'Ganze Serie ab frühestem änderbaren Termin' })
      .click();
    await typeIntoTimeInput(seriesDialog, 'planning-edit-time', '1000');
    await seriesDialog
      .getByRole('button', { name: 'Änderung speichern', exact: true })
      .click();
    await expect(seriesDialog).toHaveCount(0, { timeout: 20_000 });
    const postEditState = await getPlanningState(world.orgId, {
      internalTitle: title,
    });
    for (const before of preEditState.occurrences) {
      const after = postEditState.occurrences.find(
        (occurrence) => occurrence.originalStartLocal === before.originalStartLocal
      );
      expect(after).toBeTruthy();
      const beforeMs = new Date(before.startAt!).getTime();
      const afterTime = formatBerlinLocalDateTime(after!.startAt!).slice(11, 16);
      if (beforeMs < nowMs - 120_000) {
        // Past/already-begun: never rewritten.
        expect(after!.startAt).toBe(before.startAt);
      } else if (beforeMs > nowMs + 120_000) {
        // Clearly future: moved to the new time.
        expect(afterTime).toBe('10:00');
      }
    }
    expect(
      postEditState.occurrences.find(
        (occurrence) => originalStartMinute(occurrence) === `${yesterdayIso}T06:00`
      )?.startAt
    ).toBe(pastStartAt);

    // Cancel tomorrow's occurrence and skip the day after: both keep a
    // traceably VISIBLE calendar presence instead of disappearing.
    const cancelDate = shiftIsoDate(todayIso, 1);
    const skipDate = shiftIsoDate(todayIso, 2);
    const cancelDialog = await openOccurrenceEditDialogByDate(
      adminPage,
      title,
      cancelDate
    );
    await cancelDialog
      .getByRole('button', { name: 'Termin absagen', exact: true })
      .click();
    await cancelDialog
      .locator('#planning-status-reason')
      .fill('A6 Termin bewusst abgesagt und dokumentiert.');
    await cancelDialog
      .getByRole('button', { name: 'Status speichern', exact: true })
      .click();
    await expect(cancelDialog).toHaveCount(0, { timeout: 20_000 });
    await expect(
      adminPage.getByText('Termin wurde abgesagt.')
    ).toBeVisible({ timeout: 15_000 });

    const skipDialog = await openOccurrenceEditDialogByDate(
      adminPage,
      title,
      skipDate
    );
    await skipDialog
      .getByRole('button', { name: 'Auslassen', exact: true })
      .click();
    await skipDialog
      .locator('#planning-status-reason')
      .fill('A6 Termin betrieblich nicht benötigt.');
    await skipDialog
      .getByRole('button', { name: 'Status speichern', exact: true })
      .click();
    await expect(skipDialog).toHaveCount(0, { timeout: 20_000 });

    await showPlanningMonth(adminPage, cancelDate);
    const cancelledEvent = occurrenceEventInCell(adminPage, cancelDate, title);
    await expect(cancelledEvent).toBeVisible({ timeout: 20_000 });
    await expect(
      adminPage
        .locator(`.fc-daygrid-day[data-date="${cancelDate}"]`)
        .getByText('Abgesagt')
    ).toBeVisible();
    await showPlanningMonth(adminPage, skipDate);
    await expect(
      occurrenceEventInCell(adminPage, skipDate, title)
    ).toBeVisible({ timeout: 20_000 });
    await expect(
      adminPage
        .locator(`.fc-daygrid-day[data-date="${skipDate}"]`)
        .getByText('Ausgelassen')
    ).toBeVisible();

    // The cancelled occurrence is read-only: its popover explains the status
    // and offers no editing.
    await showPlanningMonth(adminPage, cancelDate);
    await occurrenceEventInCell(adminPage, cancelDate, title).click();
    await expect(
      adminPage.getByRole('button', { name: 'Terminübersicht schließen' })
    ).toBeVisible({ timeout: 15_000 });
    await expect(
      adminPage.getByRole('button', { name: 'Termin bearbeiten' })
    ).toHaveCount(0);
    await adminPage
      .getByRole('button', { name: 'Terminübersicht schließen' })
      .click();

    const finalState = await getPlanningState(world.orgId, {
      internalTitle: title,
    });
    expect(
      finalState.occurrences.find(
        (occurrence) => originalStartMinute(occurrence) === `${cancelDate}T06:00`
      )?.status
    ).toBe('cancelled');
    expect(
      finalState.occurrences.find(
        (occurrence) => originalStartMinute(occurrence) === `${skipDate}T06:00`
      )?.status
    ).toBe('skipped');
    expect(finalState.eventTypes).toEqual(
      expect.arrayContaining(['cancelled', 'skipped'])
    );
  });

  test('A6-T5: Schwebende Urlaubsanträge warnen mit Person und Datum; geänderte Fakten erzwingen eine neue Entscheidung [P1-11-F04]', async ({
    adminPage,
    employeePage,
    world,
  }) => {
    const todayIso = A6_TODAY_ISO;
    const { pendingOffset, pairOffsets } = A6_OFFSETS;
    const pendingDate = shiftIsoDate(todayIso, pendingOffset);
    const employeeName = `${world.users.employee.firstName} ${world.users.employee.lastName}`;
    const fallbackMessage =
      'Für diese Person gilt nur der gekennzeichnete Standardwert, weil kein Arbeitszeitmodell hinterlegt ist.';
    const pendingMessage =
      'Für diesen Tag liegt ein noch offener Abwesenheitsantrag vor.';

    // A pending (undecided) vacation request is a capacity source: the warning
    // names the person and the date, and saving requires a reason.
    await createOwnVacationRequestViaDialog(employeePage, {
      startDigits: toDatePickerDigits(pendingDate),
      endDigits: toDatePickerDigits(pendingDate),
      comment: `A6 schwebender Antrag ${world.runId}`,
    });
    const pendingTitle = `A6 Kapazität ${world.runId}`;
    const pendingDialog = await openPlanningCreationDialog(adminPage);
    await fillInternalPlanningDraft(adminPage, pendingDialog, {
      title: pendingTitle,
      dateIso: pendingDate,
      assignEmployeeName: employeeName,
    });
    await pendingDialog
      .getByRole('button', { name: /Planung pr.fen und speichern/ })
      .click();
    const pendingWarning = pendingDialog.locator('[data-planning-warning]');
    await expect(pendingWarning).toBeVisible({ timeout: 30_000 });
    await expect(
      pendingWarning.getByText(
        `${employeeName}: ${pendingMessage} (${pendingDate})`
      )
    ).toBeVisible();
    await expect(
      pendingWarning.getByText(
        `${employeeName}: ${fallbackMessage} (${pendingDate})`
      )
    ).toBeVisible();
    await expect(
      pendingDialog.getByRole('button', { name: 'Mit Begründung planen' })
    ).toBeDisabled();
    await pendingDialog
      .locator('#planning-override')
      .fill(`A6 Einsatz trotz offenen Antrags abgestimmt ${world.runId}`);
    await pendingDialog
      .getByRole('button', { name: 'Mit Begründung planen' })
      .click();
    await expect(pendingDialog).toHaveCount(0, { timeout: 30_000 });
    await expect(
      adminPage.getByText('Termin wurde geplant.')
    ).toBeVisible({ timeout: 15_000 });
    const pendingState = await getPlanningState(world.orgId, {
      internalTitle: pendingTitle,
    });
    expect(pendingState.capacityConflictKinds).toEqual(
      expect.arrayContaining(['no_schedule', 'pending_absence'])
    );
    expect(pendingState.overrideReasons).toContain(
      `A6 Einsatz trotz offenen Antrags abgestimmt ${world.runId}`
    );

    // Changed facts force a NEW decision: while the warning is on screen, a
    // new pending request appears; the confirmation is refused as stale, the
    // refreshed hints show the new fact, and only the second confirmation
    // saves. The two-date series also proves per-date attribution.
    const staleTitle = `A6 Faktenlage ${world.runId}`;
    const staleDateFirst = shiftIsoDate(todayIso, pairOffsets[0]);
    const staleDateSecond = shiftIsoDate(todayIso, pairOffsets[1]);
    const staleDialog = await openPlanningCreationDialog(adminPage);
    await fillInternalPlanningDraft(adminPage, staleDialog, {
      title: staleTitle,
      dateIso: staleDateFirst,
      assignEmployeeName: employeeName,
    });
    await staleDialog.getByText('Wiederholen', { exact: true }).click();
    const rhythmBlock = staleDialog
      .getByText('Rhythmus', { exact: true })
      .locator('..');
    await rhythmBlock.getByRole('combobox').click();
    await adminPage.getByRole('option', { name: /T.glich/ }).click();
    await staleDialog.locator('#planning-count').fill('2');
    await staleDialog
      .getByRole('button', { name: /Planung pr.fen und speichern/ })
      .click();
    const staleWarning = staleDialog.locator('[data-planning-warning]');
    await expect(staleWarning).toBeVisible({ timeout: 30_000 });
    await expect(
      staleWarning.getByText(
        `${employeeName}: ${fallbackMessage} (${staleDateFirst})`
      )
    ).toBeVisible();
    await expect(
      staleWarning.getByText(
        `${employeeName}: ${fallbackMessage} (${staleDateSecond})`
      )
    ).toBeVisible();
    await expect(staleWarning.getByText(pendingMessage)).toHaveCount(0);

    // The fact changes AFTER the warning was shown.
    await createOwnVacationRequestViaDialog(employeePage, {
      startDigits: toDatePickerDigits(staleDateFirst),
      endDigits: toDatePickerDigits(staleDateFirst),
      comment: `A6 Faktenänderung ${world.runId}`,
    });
    await staleDialog
      .locator('#planning-override')
      .fill(`A6 Einsatz bewusst bestätigt ${world.runId}`);
    await staleDialog
      .getByRole('button', { name: 'Mit Begründung planen' })
      .click();
    await expect(
      adminPage.getByText(
        'Die Planungslage hat sich geändert. Bitte Hinweise erneut prüfen.'
      )
    ).toBeVisible({ timeout: 30_000 });
    await expect(staleDialog).toBeVisible();
    await expect(
      staleWarning.getByText(
        `${employeeName}: ${pendingMessage} (${staleDateFirst})`
      )
    ).toBeVisible({ timeout: 15_000 });
    await staleDialog
      .getByRole('button', { name: 'Mit Begründung planen' })
      .click();
    await expect(staleDialog).toHaveCount(0, { timeout: 30_000 });
    await expect(
      adminPage.getByText('2 Termine wurden geplant.')
    ).toBeVisible({ timeout: 15_000 });
    const staleState = await getPlanningState(world.orgId, {
      internalTitle: staleTitle,
    });
    expect(staleState.occurrenceCount).toBe(2);
    expect(staleState.capacityConflictKinds).toEqual(
      expect.arrayContaining(['no_schedule', 'pending_absence'])
    );
    expect(staleState.overrideReasons).toContain(
      `A6 Einsatz bewusst bestätigt ${world.runId}`
    );

    // Terminal state: the employee withdraws both pending requests (a
    // self-action without decision notifications).
    await withdrawOwnPendingVacationRequestByDate(
      employeePage,
      formatGermanDate(shiftIsoDate(todayIso, pairOffsets[0]))
    );
    await withdrawOwnPendingVacationRequestByDate(
      employeePage,
      formatGermanDate(pendingDate)
    );
  });

  test('A6-T6: Kapazitätsquellen — Betriebsruhe, Feiertag, genehmigter Urlaub und Krankheit erklären Person und Datum [P1-11-F04]', async ({
    adminPage,
    employeePage,
    world,
  }) => {
    const todayIso = A6_TODAY_ISO;
    const { closureOffset, vacationOffset } = A6_OFFSETS;
    const closureDate = shiftIsoDate(todayIso, closureOffset);
    const vacationDate = shiftIsoDate(todayIso, vacationOffset);
    const employeeName = `${world.users.employee.firstName} ${world.users.employee.lastName}`;
    const freeDayMessage = 'Der Termin liegt auf einem arbeitsfreien Tag.';
    const absenceMessage =
      'Für diesen Zeitraum liegt eine genehmigte Abwesenheit vor.';

    // Betriebsruhe: a closure day is a capacity source.
    await addClosureDayViaSettings(adminPage, {
      dateDigits: toDatePickerDigits(closureDate),
      label: `A6 Betriebsruhe ${world.runId}`,
    });
    await probePlanningWarningLine(adminPage, {
      title: `A6 Ruheprobe ${world.runId}`,
      dateIso: closureDate,
      employeeName,
      expectedLine: `${employeeName}: ${freeDayMessage} (${closureDate})`,
    });
    await removeClosureDayViaSettings(adminPage, formatGermanDate(closureDate));

    // Feiertag: with a temporary Berlin holiday calendar, the next public
    // holiday raises the same understandable warning. The region is reset
    // immediately afterwards (the audit world deliberately runs without one).
    await setHolidayRegionViaSettings(adminPage, 'Berlin');
    const currentYear = Number(todayIso.slice(0, 4));
    const nextHoliday = [
      ...getPublicHolidaysForYear('BE', currentYear),
      ...getPublicHolidaysForYear('BE', currentYear + 1),
    ]
      .map((holiday) => holiday.date)
      .find((date) => date > shiftIsoDate(todayIso, 55));
    if (!nextHoliday) throw new Error('A6: no upcoming Berlin holiday found');
    await probePlanningWarningLine(adminPage, {
      title: `A6 Feiertagsprobe ${world.runId}`,
      dateIso: nextHoliday,
      employeeName,
      expectedLine: `${employeeName}: ${freeDayMessage} (${nextHoliday})`,
    });
    await setHolidayRegionViaSettings(adminPage, 'Kein Feiertagskalender');

    // Genehmigter Urlaub: an approved absence is a capacity source.
    await createOwnVacationRequestViaDialog(employeePage, {
      startDigits: toDatePickerDigits(vacationDate),
      endDigits: toDatePickerDigits(vacationDate),
      comment: `A6 Urlaubsprobe ${world.runId}`,
    });
    await approveVacationRequestFor(adminPage, employeeName);
    await probePlanningWarningLine(adminPage, {
      title: `A6 Urlaubskonfliktprobe ${world.runId}`,
      dateIso: vacationDate,
      employeeName,
      expectedLine: `${employeeName}: ${absenceMessage} (${vacationDate})`,
    });
    await cancelApprovedVacationFor(
      adminPage,
      employeeName,
      `A6 Probe abgeschlossen, Urlaub wieder storniert ${world.runId}`
    );

    // Krankheit: an active sickness report is a capacity source. The employee
    // reports open-ended from today and cancels the report afterwards.
    // Deliberate current-day exception to the +45…+54 reserve: the sickness
    // overlap constraint only guards ACTIVE reports, and every inherited
    // wave-1 sickness fixture (A4) ends cancelled, so an active report
    // starting today cannot collide in either focused or combined runs.
    const sicknessProbeDate = isWeekday(todayIso)
      ? todayIso
      : shiftIsoDate(todayIso, mondayWeekdayIndex(todayIso) === 5 ? 2 : 1);
    await reportOwnSicknessViaDialog(employeePage, {
      startDigits: toDatePickerDigits(todayIso),
    });
    await probePlanningWarningLine(adminPage, {
      title: `A6 Krankheitsprobe ${world.runId}`,
      dateIso: sicknessProbeDate,
      employeeName,
      expectedLine: `${employeeName}: ${absenceMessage} (${sicknessProbeDate})`,
    });
    await openOwnSicknessSection(employeePage);
    await employeePage
      .getByRole('button', {
        name: `Krankmeldung vom ${formatGermanDate(todayIso)} – bis auf Weiteres stornieren`,
      })
      .click();
    const cancelSicknessDialog = employeePage.getByRole('dialog');
    await expect(
      cancelSicknessDialog.getByRole('heading', { name: 'Krankmeldung stornieren' })
    ).toBeVisible();
    await cancelSicknessDialog
      .getByRole('button', { name: 'Stornieren', exact: true })
      .click();
    await expect(cancelSicknessDialog).toHaveCount(0, { timeout: 15_000 });

    // The employee reads the decision notifications produced by the approval
    // and cancellation above: A6 leaves no unread employee notification.
    await markAllOwnNotificationsRead(employeePage);
  });

  test('A6-T7: Personal ohne Login ist manager-sichtbar verplant; Handwerker sehen genau ihre Termine ohne Ist-Zeit [P1-11-F05]', async ({
    adminPage,
    employeePage,
    world,
  }) => {
    const todayIso = A6_TODAY_ISO;
    const { pendingOffset } = A6_OFFSETS;
    const noLoginName = `Nora Nachweis-${world.runId}`;
    const noLoginTitle = `A6 Ohne Login ${world.runId}`;
    const noLoginDate = shiftIsoDate(todayIso, 50);

    // A6 creates its own no-login personnel record (never an earlier
    // session's fixture) and plans ONLY that record.
    const noLoginRecordId = await createPersonnelRecordViaDialog(adminPage, {
      firstName: 'Nora',
      lastName: `Nachweis-${world.runId}`,
    });
    await createPlannedCalendarEntry(adminPage, {
      kind: 'internal',
      internalTitle: noLoginTitle,
      internalType: 'internal_work',
      date: noLoginDate,
      time: '06:00',
      durationHours: 1,
      employeeNames: [noLoginName],
      overrideReason: `A6 Planung ohne Login bewusst bestätigt ${world.runId}`,
    });
    const noLoginState = await getPlanningState(world.orgId, {
      internalTitle: noLoginTitle,
    });
    expect(noLoginState.occurrenceCount).toBe(1);
    expect(
      await getOccurrenceAssignmentRecordIds(
        world.orgId,
        noLoginState.occurrences[0].id
      )
    ).toEqual([noLoginRecordId]);

    // Managers SEE the planned no-login person: the occurrence renders on the
    // manager calendar and the edit dialog carries the assignment visibly.
    const editDialog = await openOccurrenceEditDialogByDate(
      adminPage,
      noLoginTitle,
      noLoginDate
    );
    await expect(
      editDialog.getByRole('combobox').filter({ hasText: '1 Mitarbeiter' })
    ).toBeVisible({ timeout: 15_000 });
    await editDialog
      .getByRole('combobox')
      .filter({ hasText: '1 Mitarbeiter' })
      .click();
    await adminPage.getByPlaceholder(/Mitarbeiter suchen/).fill('Nora');
    const noLoginOption = adminPage
      .getByRole('listbox')
      .getByRole('button')
      .filter({ hasText: noLoginName })
      .first();
    await expect(noLoginOption).toBeVisible({ timeout: 15_000 });
    await expect(noLoginOption.getByText('Ohne App-Zugang')).toBeVisible();
    await editDialog.getByRole('heading').first().click();
    await editDialog.getByRole('button', { name: 'Schließen' }).first().click();
    await expect(editDialog).toHaveCount(0, { timeout: 15_000 });

    // Field workers see EXACTLY their assigned occurrences: their own A6
    // entry is visible, the no-login-only entry is not.
    const ownDate = shiftIsoDate(todayIso, pendingOffset);
    await showPlanningMonth(employeePage, ownDate);
    await expect(
      occurrenceEventInCell(employeePage, ownDate, `A6 Kapazität ${world.runId}`)
    ).toBeVisible({ timeout: 20_000 });
    await showPlanningMonth(employeePage, noLoginDate);
    await expect(
      employeePage.locator('.fc-event-job').filter({ hasText: noLoginTitle })
    ).toHaveCount(0);

    // Planned occurrences never create actual work time: the organization-wide
    // time-entry count is unchanged since before any A6 planning existed.
    expect(organizationTimeBaseline).not.toBeNull();
    expect(await getOrganizationTimeEntryCount(world.orgId)).toBe(
      organizationTimeBaseline!
    );
  });
});

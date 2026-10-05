import { expect, test } from '../support/fixtures';
import {
  jobPopover,
  LOCKED_CARD_NAME,
  lockedOccurrenceNotice,
  startedOccurrenceMessage,
} from '../../golden/support/plantafel';
import { getPlanningState } from '../../golden/support/db/calendar';
import { createAdminClient } from '../../golden/support/db/shared';
import {
  closeOccurrenceOverviewButton,
  createPlannedCalendarEntry,
  extendSeriesButton,
  noAppAccessBadge,
  occurrenceEditButton,
  occurrenceEditConfirmation,
  occurrenceEditHeading,
  occurrenceInDateCell,
  occurrenceStatusAction,
  occurrenceStatusConfirmation,
  occurrenceStatusSave,
  openOccurrenceEditDialogByDate,
  openPlanningCreationDialog,
  PLANNING_EDIT_SCOPE_LABELS,
  PLANNING_INTERNAL_TYPE_LABELS,
  plannedCalendarEvent,
  plannedEntriesConfirmation,
  planningCheckAndSave,
  planningEmployeeSearch,
  planningFrequencyOption,
  planningInternalEntryToggle,
  planningOverrideTooShort,
  planningRepeatToggle,
  planningWarningPanel,
  planWithReasonButton,
  seriesExtendedConfirmation,
  showPlanningMonth,
  staleAssessmentNotice,
} from '../../golden/support/steps/calendar';
import { dismissDialog } from '../../golden/support/steps/interaction';
import {
  addClosureDayViaSettings,
  createPersonnelRecordViaDialog,
  PERSONNEL_COPY,
  removeClosureDayViaSettings,
  setHolidayRegionViaSettings,
} from '../../golden/support/steps/personnel';
import { SHARED_COPY, employeeAssignmentPicker, typeIntoTimeInput } from '../../golden/support/steps/shared';
import { cancelOwnSicknessReport, reportOwnSicknessViaDialog } from '../../golden/support/steps/sickness';
import {
  approveVacationRequestFor,
  cancelApprovedVacationFor,
  createOwnVacationRequestViaDialog,
} from '../../golden/support/steps/vacation';
import { createJob } from '../../golden/support/steps/work';
import { berlinDateAtOffset, ownedBerlinDateAtOffset } from '../../golden/support/date-ownership';
import {
  capacityWarningLine,
  capacityWarningText,
  closePlanningDialogWithNamedControl,
  fillInternalPlanningDraft,
  formatGermanDate,
  markAllOwnNotificationsRead,
  openEndedSicknessRangeText,
  planningDateCellStatus,
  probePlanningWarningLine,
  withdrawOwnPendingVacationRequestByDate,
} from '../support/a6-steps';
import { expectDefined } from '../../../lib/testing/spec-support/expect-defined';
import { addLocalMonthsClamped, formatBerlinLocalDateTime } from '../../../lib/planning/date-time';
import { getPublicHolidaysForYear, HOLIDAY_REGION_LABELS } from '../../../lib/personnel/holidays';

// A6 — Planung (P1-11): edge cases, role variants and capacity sources around
// the golden planning journey. Every test prepares its own records in the
// shared audit world and runs alone; every business mutation runs through the
// real UI and database access below is read-only assertion state. Owned
// uniqueness-constrained run-day offsets: +45 … +54 (vacation/sickness/closure
// fixtures). Recurrence materialization is unit-tested in
// lib/planning/recurrence.test.ts; identity, exception, past-protection,
// plan-versus-actual and visibility rules in supabase/tests/planning_occurrences.sql.

const WEEKDAY_LABELS = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'] as const;

function shiftIsoDate(dateIso: string, days: number): string {
  const [year, month, day] = dateIso.split('-').map(Number);
  if (year === undefined || month === undefined || day === undefined)
    throw new Error(`Invalid ISO date: ${dateIso}`);
  const shifted = new Date(Date.UTC(year, month - 1, day) + days * 86_400_000);
  return `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, '0')}-${String(shifted.getUTCDate()).padStart(2, '0')}`;
}

function toDatePickerDigits(dateIso: string): string {
  const [year, month, day] = dateIso.split('-');
  return `${day}${month}${year}`;
}

// Stored original_start_local values carry seconds ('T06:00:00'); minute
// precision is the honest comparison unit for series identities.
function originalStartMinute(occurrence: { originalStartLocal: string | null }): string {
  return occurrence.originalStartLocal?.slice(0, 16) ?? '';
}

function isWeekday(dateIso: string): boolean {
  const [year, month, day] = dateIso.split('-').map(Number);
  if (year === undefined || month === undefined || day === undefined)
    throw new Error(`Invalid ISO date: ${dateIso}`);
  const jsWeekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return jsWeekday !== 0 && jsWeekday !== 6;
}

// Monday-based weekday index (0 = Monday … 6 = Sunday), matching the form.
function mondayWeekdayIndex(dateIso: string): number {
  const [year, month, day] = dateIso.split('-').map(Number);
  if (year === undefined || month === undefined || day === undefined)
    throw new Error(`Invalid ISO date: ${dateIso}`);
  const jsWeekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return jsWeekday === 0 ? 6 : jsWeekday - 1;
}

// Deterministic allocation of A6's uniqueness-constrained weekday offsets
// inside the owned +45 … +54 reserve: one consecutive weekday pair for the
// two-date changed-facts series, plus three further distinct weekdays.
function a6WeekdayOffsets(): {
  pendingOffset: number;
  pairOffsets: [number, number];
  closureOffset: number;
  vacationOffset: number;
} {
  const weekdayOffsets: number[] = [];
  for (let offset = 45; offset <= 54; offset++) {
    if (isWeekday(ownedBerlinDateAtOffset('a6-planung', offset))) {
      weekdayOffsets.push(offset);
    }
  }
  const pairStart = expectDefined(
    weekdayOffsets.find((offset) => weekdayOffsets.includes(offset + 1)),
    'a consecutive weekday pair inside +45…+54',
  );
  const pairOffsets: [number, number] = [pairStart, pairStart + 1];
  const remaining = weekdayOffsets.filter((offset) => offset !== pairStart && offset !== pairStart + 1);
  const [pendingOffset, closureOffset, vacationOffset] = remaining;
  if (pendingOffset === undefined || closureOffset === undefined || vacationOffset === undefined) {
    throw new Error('A6: not enough distinct weekdays inside +45…+54');
  }
  return {
    pendingOffset,
    pairOffsets,
    closureOffset,
    vacationOffset,
  };
}

// ---------------------------------------------------------------------------
// Audit-local read-only database observers (A6 only — deliberately NOT part of
// the golden harness). Service-role SELECTs used exclusively for assertions.
// ---------------------------------------------------------------------------

async function getInternalOccurrenceTypes(orgId: string, internalTitle: string): Promise<string[]> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from('planning_occurrences')
    .select('internal_type')
    .eq('organization_id', orgId)
    .eq('entry_kind', 'internal')
    .eq('title', internalTitle);
  if (error) {
    throw new Error(`Internal occurrence lookup failed: ${error.message}`);
  }
  return (data ?? []).map((row) => row.internal_type ?? '');
}

async function getOccurrenceAssignmentRecordIds(orgId: string, occurrenceId: string): Promise<string[]> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from('planning_occurrence_assignments')
    .select('employee_record_id')
    .eq('organization_id', orgId)
    .eq('occurrence_id', occurrenceId);
  if (error) {
    throw new Error(`Occurrence assignment lookup failed: ${error.message}`);
  }
  return (data ?? []).map((row) => row.employee_record_id).sort();
}

// Date-cell scoped locators (occurrenceInDateCell) are used instead of the
// shared index-based event helpers because A6 series span month boundaries
// and (since P1-11-F03) skipped/cancelled occurrences stay visible.

test.describe('A6 Planung @AUDIT-W1-A6', () => {
  test('A6-T1: Interne Terminarten, Büro als Planer, Nachtarbeit über Mitternacht und ganztägige Mehrtagesbesuche [P1-11-F01]', async ({
    adminPage,
    bueroPage,
    world,
  }) => {
    // The four internal entry types are offered with their exact German labels.
    const labelDialog = await openPlanningCreationDialog(adminPage);
    await planningInternalEntryToggle(labelDialog).click();
    await labelDialog.locator('#planning-internal-type').click();
    const typeOptions = adminPage.getByRole('option');
    await expect(typeOptions).toHaveCount(4);
    for (const label of Object.values(PLANNING_INTERNAL_TYPE_LABELS)) {
      await expect(adminPage.getByRole('option', { name: label, exact: true })).toBeVisible();
    }
    // The open select list is the top layer: the first Escape closes it, the second the dialog.
    await dismissDialog(adminPage.getByRole('listbox'));
    await dismissDialog(labelDialog);
    await expect(labelDialog).toHaveCount(0, { timeout: 15_000 });

    // Büro plans a Besprechung (the default type) — the planner role includes
    // Büro, not only Admin.
    const besprechungTitle = `A6-T1 Baustellenrunde ${world.runId}`;
    const besprechungDate = berlinDateAtOffset(48);
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
    expect(await getInternalOccurrenceTypes(world.orgId, besprechungTitle)).toEqual(['meeting']);

    // Internal work across midnight needs neither a job nor a second entry.
    const nightTitle = `A6-T1 Nachtarbeit ${world.runId}`;
    await createPlannedCalendarEntry(adminPage, {
      kind: 'internal',
      internalTitle: nightTitle,
      internalType: 'internal_work',
      date: berlinDateAtOffset(49),
      time: '22:00',
      durationHours: 4,
    });
    await expect(plannedEntriesConfirmation(adminPage, 1)).toBeVisible({ timeout: 15_000 });
    const night = await getPlanningState(world.orgId, { internalTitle: nightTitle });
    expect(night.jobId).toBeNull();
    const nightOccurrence = expectDefined(night.occurrences[0], 'the night occurrence');
    const nightStart = expectDefined(nightOccurrence.startAt, 'the night start');
    const nightEnd = expectDefined(nightOccurrence.endAt, 'the night end');
    expect(formatBerlinLocalDateTime(nightStart).slice(11, 16)).toBe('22:00');
    expect(new Date(nightEnd).getTime() - new Date(nightStart).getTime()).toBe(4 * 60 * 60 * 1000);

    // A JOB visit can be all-day and multi-day, not only internal entries.
    const visitJobNumber = `A6-T1-VISIT-${world.runId}`;
    const visitTitle = `A6-T1 Ganztagsbesuch ${world.runId}`;
    const visitDate = berlinDateAtOffset(47);
    await createJob(adminPage, {
      jobNumber: visitJobNumber,
      title: visitTitle,
    });
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
    expect(visitState.occurrences[0]?.startAt).toBeNull();
    expect(visitState.occurrences[0]?.startDate).toBe(visitDate);
    expect(visitState.occurrences[0]?.endDateExclusive).toBe(shiftIsoDate(visitDate, 2));
    await showPlanningMonth(adminPage, visitDate);
    await expect(plannedCalendarEvent(adminPage, visitTitle)).toBeVisible({
      timeout: 20_000,
    });
  });

  test('A6-T2: Eine Wochenserie mit zusätzlich gewähltem Wochentag wird genau an diesen Tagen geplant [P1-11-F01]', async ({
    adminPage,
    world,
  }) => {
    const weeklyTitle = `A6-T2 Wochenserie ${world.runId}`;
    const weeklyStart = berlinDateAtOffset(70);
    const startWeekdayIndex = mondayWeekdayIndex(weeklyStart);
    const secondWeekdayIndex = (startWeekdayIndex + 1) % 7;
    const secondWeekdayLabel = expectDefined(WEEKDAY_LABELS[secondWeekdayIndex], 'the second weekday label');
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
        weekdayLabels: [secondWeekdayLabel],
      },
    });
    await expect(plannedEntriesConfirmation(adminPage, 6)).toBeVisible({ timeout: 15_000 });
    const expectedWeeklyDates: string[] = [];
    for (let date = weeklyStart; expectedWeeklyDates.length < 6; date = shiftIsoDate(date, 1)) {
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
      expectedWeeklyDates.map((date) => `${date}T06:00`),
    );
  });

  test('A6-T3: Serien reichen 18 Monate in die Zukunft und wachsen per Klick um je sechs Monate ohne Duplikate [P1-11-F02]', async ({
    adminPage,
    world,
  }) => {
    const horizonTitle = `A6-T3 Horizontserie ${world.runId}`;
    const horizonStart = berlinDateAtOffset(77);

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
    await expect(plannedEntriesConfirmation(adminPage, expectedInitialDates.length)).toBeVisible({
      timeout: 20_000,
    });
    const initialState = await getPlanningState(world.orgId, {
      internalTitle: horizonTitle,
    });
    expect(initialState.occurrences.map(originalStartMinute)).toEqual(
      expectedInitialDates.map((date) => `${date}T06:00`),
    );

    // One click adds exactly the next six months of occurrences — twice, and
    // every occurrence identity stays unique (no duplicates on repetition).
    const computeExtension = (currentDates: string[]): string[] => {
      const generatedThrough = currentDates.at(-1);
      if (!generatedThrough) throw new Error('A6: the series has no generated dates to extend from');
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
      const dialog = await openOccurrenceEditDialogByDate(adminPage, horizonTitle, horizonStart);
      await extendSeriesButton(dialog).click();
      await expect(seriesExtendedConfirmation(adminPage, addedDates.length)).toBeVisible({ timeout: 30_000 });
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
    const yesterdayIso = berlinDateAtOffset(-1);
    const cancelDate = berlinDateAtOffset(1);
    const skipDate = berlinDateAtOffset(2);
    const title = `A6-T4 Rückblick ${world.runId}`;

    // Daily series starting YESTERDAY: the first occurrence is irrevocably in
    // the past when the edits below run; tomorrow and the day after are not.
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
    const pastStartAt = expectDefined(
      createdState.occurrences.find(
        (occurrence) => originalStartMinute(occurrence) === `${yesterdayIso}T06:00`,
      )?.startAt,
      'the past occurrence start',
    );

    // P1-24a prevents edits before opening the dialog. History stays readable.
    await showPlanningMonth(adminPage, yesterdayIso);
    const pastCard = occurrenceInDateCell(adminPage, yesterdayIso, title);
    await expect(pastCard).toHaveAttribute('data-locked', '');
    await expect(pastCard).toHaveAccessibleName(LOCKED_CARD_NAME);
    await pastCard.click();
    await expect(jobPopover(adminPage)).toBeVisible();
    await expect(lockedOccurrenceNotice(adminPage)).toContainText(startedOccurrenceMessage());
    await expect(occurrenceEditButton(adminPage)).toHaveCount(0);
    await dismissDialog(jobPopover(adminPage));

    // Whole-series edit from a future visit: the three scopes are offered, the
    // future visits move, the past one keeps its start.
    const seriesDialog = await openOccurrenceEditDialogByDate(adminPage, title, skipDate);
    await seriesDialog.locator('#planning-edit-scope').click();
    for (const scopeLabel of Object.values(PLANNING_EDIT_SCOPE_LABELS)) {
      await expect(adminPage.getByRole('option', { name: scopeLabel, exact: true })).toBeVisible();
    }
    await adminPage
      .getByRole('option', {
        name: PLANNING_EDIT_SCOPE_LABELS.series,
      })
      .click();
    await typeIntoTimeInput(seriesDialog, 'planning-edit-time', '1000');
    await seriesDialog.getByRole('button', { name: SHARED_COPY.action.saveChange, exact: true }).click();
    await expect(seriesDialog).toHaveCount(0, { timeout: 20_000 });
    await expect(occurrenceEditConfirmation(adminPage, 'series')).toBeVisible({
      timeout: 15_000,
    });
    const postEditState = await getPlanningState(world.orgId, {
      internalTitle: title,
    });
    const startAtFor = (dateIso: string): string =>
      expectDefined(
        postEditState.occurrences.find((occurrence) => originalStartMinute(occurrence) === `${dateIso}T06:00`)
          ?.startAt,
        `the occurrence start of ${dateIso}`,
      );
    expect(startAtFor(yesterdayIso)).toBe(pastStartAt);
    expect(formatBerlinLocalDateTime(startAtFor(cancelDate)).slice(11, 16)).toBe('10:00');
    expect(formatBerlinLocalDateTime(startAtFor(skipDate)).slice(11, 16)).toBe('10:00');

    // Cancel tomorrow's occurrence and skip the day after: both keep a
    // traceably VISIBLE calendar presence instead of disappearing.
    const cancelDialog = await openOccurrenceEditDialogByDate(adminPage, title, cancelDate);
    await occurrenceStatusAction(cancelDialog, 'cancelled').click();
    await cancelDialog
      .locator('#planning-status-reason')
      .fill('A6 Termin bewusst abgesagt und dokumentiert.');
    await occurrenceStatusSave(cancelDialog).click();
    await expect(cancelDialog).toHaveCount(0, { timeout: 20_000 });
    await expect(occurrenceStatusConfirmation(adminPage, 'cancelled')).toBeVisible({
      timeout: 15_000,
    });

    const skipDialog = await openOccurrenceEditDialogByDate(adminPage, title, skipDate);
    await occurrenceStatusAction(skipDialog, 'skipped').click();
    await skipDialog.locator('#planning-status-reason').fill('A6 Termin betrieblich nicht benötigt.');
    await occurrenceStatusSave(skipDialog).click();
    await expect(skipDialog).toHaveCount(0, { timeout: 20_000 });
    await expect(occurrenceStatusConfirmation(adminPage, 'skipped')).toBeVisible({
      timeout: 15_000,
    });

    await showPlanningMonth(adminPage, cancelDate);
    const cancelledEvent = occurrenceInDateCell(adminPage, cancelDate, title);
    await expect(cancelledEvent).toBeVisible({ timeout: 20_000 });
    await expect(planningDateCellStatus(adminPage, cancelDate, 'cancelled')).toBeVisible();
    await showPlanningMonth(adminPage, skipDate);
    await expect(occurrenceInDateCell(adminPage, skipDate, title)).toBeVisible({
      timeout: 20_000,
    });
    await expect(planningDateCellStatus(adminPage, skipDate, 'skipped')).toBeVisible();

    // The cancelled occurrence is read-only: its popover explains the status
    // and offers no editing.
    await showPlanningMonth(adminPage, cancelDate);
    await occurrenceInDateCell(adminPage, cancelDate, title).click();
    await expect(closeOccurrenceOverviewButton(adminPage)).toBeVisible({
      timeout: 15_000,
    });
    await expect(occurrenceEditButton(adminPage)).toHaveCount(0);
    await closeOccurrenceOverviewButton(adminPage).click();

    const finalState = await getPlanningState(world.orgId, {
      internalTitle: title,
    });
    expect(
      finalState.occurrences.find((occurrence) => originalStartMinute(occurrence) === `${cancelDate}T06:00`)
        ?.status,
    ).toBe('cancelled');
    expect(
      finalState.occurrences.find((occurrence) => originalStartMinute(occurrence) === `${skipDate}T06:00`)
        ?.status,
    ).toBe('skipped');
  });

  test('A6-T5: Schwebende Urlaubsanträge warnen mit Person und Datum; geänderte Fakten erzwingen eine neue Entscheidung [P1-11-F04]', async ({
    adminPage,
    employeePage,
    world,
  }) => {
    const { pendingOffset, pairOffsets } = a6WeekdayOffsets();
    const pendingDate = ownedBerlinDateAtOffset('a6-planung', pendingOffset);
    const employeeName = `${world.users.employee.firstName} ${world.users.employee.lastName}`;

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
    await planningCheckAndSave(pendingDialog).click();
    const pendingWarning = planningWarningPanel(pendingDialog);
    await expect(pendingWarning).toBeVisible({ timeout: 30_000 });
    await expect(
      capacityWarningLine(pendingWarning, { employeeName, kind: 'pendingAbsence', dateIso: pendingDate }),
    ).toBeVisible();
    await expect(
      capacityWarningLine(pendingWarning, { employeeName, kind: 'scheduleFallback', dateIso: pendingDate }),
    ).toBeVisible();
    const planWithReason = planWithReasonButton(pendingDialog);
    const overrideReason = pendingDialog.locator('#planning-override');
    await expect(planWithReason).toBeEnabled();
    await planWithReason.click();
    await expect(planningOverrideTooShort(pendingDialog)).toBeVisible();
    await expect(overrideReason).toHaveAttribute('aria-invalid', 'true');
    await expect(overrideReason).toBeFocused();
    await overrideReason.fill(`A6 Einsatz trotz offenen Antrags abgestimmt ${world.runId}`);
    await planWithReason.click();
    await expect(pendingDialog).toHaveCount(0, { timeout: 30_000 });
    await expect(plannedEntriesConfirmation(adminPage, 1)).toBeVisible({
      timeout: 15_000,
    });
    const pendingState = await getPlanningState(world.orgId, {
      internalTitle: pendingTitle,
    });
    expect(pendingState.capacityConflictKinds).toEqual(
      expect.arrayContaining(['no_schedule', 'pending_absence']),
    );
    expect(pendingState.overrideReasons).toContain(
      `A6 Einsatz trotz offenen Antrags abgestimmt ${world.runId}`,
    );

    // Changed facts force a NEW decision: while the warning is on screen, a
    // new pending request appears; the confirmation is refused as stale, the
    // refreshed hints show the new fact, and only the second confirmation
    // saves. The two-date series also proves per-date attribution.
    const staleTitle = `A6 Faktenlage ${world.runId}`;
    const staleDateFirst = ownedBerlinDateAtOffset('a6-planung', pairOffsets[0]);
    const staleDateSecond = ownedBerlinDateAtOffset('a6-planung', pairOffsets[1]);
    const staleDialog = await openPlanningCreationDialog(adminPage);
    await fillInternalPlanningDraft(adminPage, staleDialog, {
      title: staleTitle,
      dateIso: staleDateFirst,
      assignEmployeeName: employeeName,
    });
    await planningRepeatToggle(staleDialog).click();
    // The Rhythmus Field wires its id onto the select trigger.
    await staleDialog.locator('#planning-frequency').click();
    await planningFrequencyOption(adminPage, 'daily').click();
    await staleDialog.locator('#planning-count').fill('2');
    await planningCheckAndSave(staleDialog).click();
    const staleWarning = planningWarningPanel(staleDialog);
    await expect(staleWarning).toBeVisible({ timeout: 30_000 });
    await expect(
      capacityWarningLine(staleWarning, { employeeName, kind: 'scheduleFallback', dateIso: staleDateFirst }),
    ).toBeVisible();
    await expect(
      capacityWarningLine(staleWarning, { employeeName, kind: 'scheduleFallback', dateIso: staleDateSecond }),
    ).toBeVisible();
    await expect(capacityWarningText(staleWarning, 'pendingAbsence')).toHaveCount(0);

    // The fact changes AFTER the warning was shown.
    await createOwnVacationRequestViaDialog(employeePage, {
      startDigits: toDatePickerDigits(staleDateFirst),
      endDigits: toDatePickerDigits(staleDateFirst),
      comment: `A6 Faktenänderung ${world.runId}`,
    });
    await staleDialog.locator('#planning-override').fill(`A6 Einsatz bewusst bestätigt ${world.runId}`);
    await planWithReasonButton(staleDialog).click();
    await expect(staleAssessmentNotice(adminPage)).toBeVisible({ timeout: 30_000 });
    await expect(staleDialog).toBeVisible();
    await expect(
      capacityWarningLine(staleWarning, { employeeName, kind: 'pendingAbsence', dateIso: staleDateFirst }),
    ).toBeVisible({ timeout: 15_000 });
    await planWithReasonButton(staleDialog).click();
    await expect(staleDialog).toHaveCount(0, { timeout: 30_000 });
    await expect(plannedEntriesConfirmation(adminPage, 2)).toBeVisible({
      timeout: 15_000,
    });
    const staleState = await getPlanningState(world.orgId, {
      internalTitle: staleTitle,
    });
    expect(staleState.occurrenceCount).toBe(2);
    expect(staleState.capacityConflictKinds).toEqual(
      expect.arrayContaining(['no_schedule', 'pending_absence']),
    );
    expect(staleState.overrideReasons).toContain(`A6 Einsatz bewusst bestätigt ${world.runId}`);

    // Terminal state: the employee withdraws both pending requests (a
    // self-action without decision notifications).
    await withdrawOwnPendingVacationRequestByDate(
      employeePage,
      formatGermanDate(ownedBerlinDateAtOffset('a6-planung', pairOffsets[0])),
    );
    await withdrawOwnPendingVacationRequestByDate(employeePage, formatGermanDate(pendingDate));
  });

  test('A6-T6: Kapazitätsquellen — Betriebsruhe, Feiertag, genehmigter Urlaub und Krankheit erklären Person und Datum [P1-11-F04]', async ({
    adminPage,
    employeePage,
    world,
  }) => {
    const todayIso = berlinDateAtOffset(0);
    const { closureOffset, vacationOffset } = a6WeekdayOffsets();
    const closureDate = ownedBerlinDateAtOffset('a6-planung', closureOffset);
    const vacationDate = ownedBerlinDateAtOffset('a6-planung', vacationOffset);
    const employeeName = `${world.users.employee.firstName} ${world.users.employee.lastName}`;

    // Betriebsruhe: a closure day is a capacity source.
    await addClosureDayViaSettings(adminPage, {
      dateDigits: toDatePickerDigits(closureDate),
      label: `A6 Betriebsruhe ${world.runId}`,
    });
    await probePlanningWarningLine(adminPage, {
      title: `A6 Ruheprobe ${world.runId}`,
      dateIso: closureDate,
      employeeName,
      kind: 'freeDay',
    });
    await removeClosureDayViaSettings(adminPage, formatGermanDate(closureDate));

    // Feiertag: with a temporary Berlin holiday calendar, the next public
    // holiday raises the same understandable warning. The region is reset
    // immediately afterwards (the audit world deliberately runs without one).
    await setHolidayRegionViaSettings(adminPage, HOLIDAY_REGION_LABELS.BE);
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
      kind: 'freeDay',
    });
    await setHolidayRegionViaSettings(adminPage, PERSONNEL_COPY.noHolidayRegion);

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
      kind: 'approvedAbsence',
    });
    await cancelApprovedVacationFor(
      adminPage,
      employeeName,
      `A6 Probe abgeschlossen, Urlaub wieder storniert ${world.runId}`,
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
      kind: 'approvedAbsence',
    });
    // Opens the own section, cancels the open-ended report and waits until the dialog closed.
    await cancelOwnSicknessReport(employeePage, openEndedSicknessRangeText(formatGermanDate(todayIso)));

    // The employee reads the decision notifications produced by the approval
    // and cancellation above: A6 leaves no unread employee notification.
    await markAllOwnNotificationsRead(employeePage);
  });

  test('A6-T7: Personal ohne Login ist manager-sichtbar verplant; Handwerker sehen genau ihre Termine [P1-11-F05]', async ({
    adminPage,
    employeePage,
    world,
  }) => {
    const employeeName = `${world.users.employee.firstName} ${world.users.employee.lastName}`;
    const ownTitle = `A6-T7 Eigener Termin ${world.runId}`;
    const ownDate = berlinDateAtOffset(51);
    const noLoginName = `Nora Nachweis-${world.runId}`;
    const noLoginTitle = `A6-T7 Ohne Login ${world.runId}`;
    const noLoginDate = berlinDateAtOffset(50);

    // The field worker's own visit, planned with the reason the missing work
    // schedule demands.
    await createPlannedCalendarEntry(adminPage, {
      kind: 'internal',
      internalTitle: ownTitle,
      internalType: 'internal_work',
      date: ownDate,
      time: '06:00',
      durationHours: 1,
      employeeNames: [employeeName],
      overrideReason: `A6 Einsatz für den Handwerker abgestimmt ${world.runId}`,
    });

    // A6 creates its own no-login personnel record and plans ONLY that record.
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
    const noLoginOccurrence = expectDefined(noLoginState.occurrences[0], 'the no-login occurrence');
    expect(await getOccurrenceAssignmentRecordIds(world.orgId, noLoginOccurrence.id)).toEqual([
      noLoginRecordId,
    ]);

    // Managers SEE the planned no-login person: the occurrence renders on the
    // manager calendar and the edit dialog carries the assignment visibly.
    const editDialog = await openOccurrenceEditDialogByDate(adminPage, noLoginTitle, noLoginDate);
    await expect(employeeAssignmentPicker(editDialog, 1)).toBeVisible({
      timeout: 15_000,
    });
    await employeeAssignmentPicker(editDialog, 1).click();
    await planningEmployeeSearch(adminPage).fill('Nora');
    const noLoginOption = adminPage.getByRole('listbox').getByRole('option').filter({ hasText: noLoginName });
    await expect(noLoginOption).toBeVisible({ timeout: 15_000 });
    await expect(noAppAccessBadge(noLoginOption)).toBeVisible();
    await occurrenceEditHeading(editDialog).click();
    await closePlanningDialogWithNamedControl(editDialog);
    await expect(editDialog).toHaveCount(0, { timeout: 15_000 });

    // Field workers see EXACTLY their assigned occurrences: their own entry is
    // visible, the no-login-only entry is not.
    await showPlanningMonth(employeePage, ownDate);
    await expect(occurrenceInDateCell(employeePage, ownDate, ownTitle)).toBeVisible({
      timeout: 20_000,
    });
    await showPlanningMonth(employeePage, noLoginDate);
    await expect(occurrenceInDateCell(employeePage, noLoginDate, noLoginTitle)).toHaveCount(0);
  });
});

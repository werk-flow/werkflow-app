import { expect, test } from '../support/fixtures';
import { expectDefined } from '../../../lib/testing/spec-support/expect-defined';
import { ensureEmployedSince } from '../../golden/support/db/personnel';
import {
  getOrganizationTimeEntrySnapshot,
  getTimeCorrectionState,
  seedApprovedManualInterval,
  seedPendingManualInterval,
} from '../../golden/support/db/time-tracking';
import { dismissDialog, pressKey } from '../../golden/support/steps/interaction';
import {
  dialogBody,
  selectFromSearchable,
  SHARED_COPY,
  visibleText,
} from '../../golden/support/steps/shared';
import {
  approvePendingTimeEntry,
  breakModeSelect,
  calendarTimeCorrectionDialog,
  createOwnManualTimeEntry,
  fillManualEntryInterval,
  fillOwnPastTime,
  manualEntryDialog,
  manualEntryHeaderButton,
  openTimeApprovals,
  provisionalTimeSummary,
  refreshTimeHistoryButton,
  saveAutomaticBreakRule,
  selectManualEntryJob,
  selectTimeHistoryStatus,
  setTimeHistoryDay,
  submitCalendarTimeCorrection,
  TIME_CORRECTION_COPY,
  TIME_ENTRY_COPY,
  TIME_ENTRY_STATUS_TEXT,
  timeCorrectionCard,
  TIME_SETTINGS_COPY,
  timeHistoryFilter,
  timeHistoryPanel,
  timeHistoryRows,
  timeHistoryTab,
  typeIntoTimeGroup,
} from '../../golden/support/steps/time-tracking';
import { timeEntryDetailsDialog, timeEntryDetailsHeading } from '../../golden/support/steps/calendar';
import {
  calendarRefreshButton,
  calendarStepButton,
  calendarViewTab,
  calendarWorkTimeBlock,
  dayRow,
  visibleCalendarLayerToggle,
} from '../../golden/support/plantafel';
import { createJob } from '../../golden/support/steps/work';
import { getJobIdByNumber } from '../../golden/support/db/work';
import { berlinDateAtOffset } from '../../golden/support/date-ownership';
import { clockOutTimeGroup, moveCalendarBlockToMember, visibleCalendarTimeBlock } from '../support/a1-steps';
import { nextFrames } from '../support/layout-measure';

function dateDigits(date: string): string {
  return date.split('-').reverse().join('');
}

// Time windows inside this file's world: A1-29, A1-30 and A1-32 book Emil's time
// on the previous business day (00:00-00:09, 10:00-13:00, 14:00-22:00), A1-31
// books Emil's time on the business date between 00:01 and 00:08, so no test's
// counts or overlaps see another test's rows.
test.describe('A1 Zeiterfassung @AUDIT-W1-A1', () => {
  test('A1-29: Manuelle Zeiten lehnen falsche Reihenfolge und Überlappung ab', async ({
    adminPage,
    employeePage,
    world,
  }) => {
    const previousBusinessDate = berlinDateAtOffset(-1);
    const digits = dateDigits(previousBusinessDate);
    const manualTimeJobNumber = `A1-MANUAL-${world.runId}`;
    const manualTimeJobTitle = `A1 Manueller Zeitauftrag ${world.runId}`;
    await ensureEmployedSince({
      organizationId: world.orgId,
      userIds: [world.users.employee.id],
      date: previousBusinessDate,
    });
    await createJob(adminPage, {
      jobNumber: manualTimeJobNumber,
      title: manualTimeJobTitle,
      assignEmployeeName: world.users.employee.firstName,
    });
    await employeePage.goto('/zeiterfassung');
    // The page's primary action sits in the page header beside the title. An
    // earlier day asks for the reason, and the time goes in as a correction.
    await manualEntryHeaderButton(employeePage).click();
    const invalidOrderDialog = manualEntryDialog(employeePage);
    await fillManualEntryInterval(invalidOrderDialog, {
      dateDigits: digits,
      clockInDigits: '0900',
      clockOutDigits: '0800',
    });
    await invalidOrderDialog.getByRole('button', { name: SHARED_COPY.action.save, exact: true }).click();
    await expect(invalidOrderDialog.getByText(TIME_ENTRY_COPY.clockOutBeforeClockIn)).toBeVisible();
    await invalidOrderDialog.getByRole('button', { name: SHARED_COPY.action.close }).click();

    const reason = `A1 vergessene Zeit ${world.runId}`;
    await manualEntryHeaderButton(employeePage).click();
    const validDialog = manualEntryDialog(employeePage);
    await selectManualEntryJob(employeePage, validDialog, manualTimeJobNumber);
    await fillOwnPastTime(validDialog, { date: previousBusinessDate, from: '00:00', to: '00:05', reason });
    await validDialog.getByRole('button', { name: SHARED_COPY.action.save, exact: true }).click();
    // Close-then-banner (M5): the dialog closes and the global banner confirms.
    await expect(visibleText(employeePage, TIME_CORRECTION_COPY.submittedForReview)).toBeVisible();
    await expect(validDialog).toHaveCount(0, { timeout: 10_000 });

    // Time over recorded time of that day is refused with the overlap.
    await seedApprovedManualInterval({
      organizationId: world.orgId,
      userId: world.users.employee.id,
      date: previousBusinessDate,
      from: '00:06',
      to: '00:09',
    });
    await manualEntryHeaderButton(employeePage).click();
    const overlapDialog = manualEntryDialog(employeePage);
    await fillOwnPastTime(overlapDialog, {
      date: previousBusinessDate,
      from: '00:07',
      to: '00:08',
      reason: `${reason} Überlappung`,
    });
    await overlapDialog.getByRole('button', { name: SHARED_COPY.action.save, exact: true }).click();
    await expect(overlapDialog.getByText(TIME_ENTRY_COPY.overlap)).toBeVisible();

    // The accepted submission reaches the manager's approvals with its job.
    const state = await getTimeCorrectionState(world.orgId);
    const revision = expectDefined(
      state.revisions.find((item) => item.reason === reason),
      'the submitted revision',
    );
    expect(JSON.stringify(revision.proposed_snapshot)).toContain(
      await getJobIdByNumber(world.orgId, manualTimeJobNumber),
    );
    await openTimeApprovals(adminPage);
    const submission = timeCorrectionCard(adminPage, revision.request_id);
    await expect(submission).toContainText(/00:00[\s\S]*00:05/);
    await expect(submission).toContainText(world.users.employee.firstName);
  });

  test('A1-30: Manager korrigiert, hängt um und löscht bestehende Arbeitsblöcke', async ({
    adminPage,
    employeePage,
    world,
  }) => {
    const previousBusinessDate = berlinDateAtOffset(-1);
    // This historical work needs both employees to be employed on that date.
    await ensureEmployedSince({
      organizationId: world.orgId,
      userIds: [world.users.employee.id, world.users.buero.id],
      date: previousBusinessDate,
    });
    // Emil's pending submission of the earlier day; an employee enters such
    // time as a correction (A1-29), so the submission is seeded.
    await seedPendingManualInterval({
      organizationId: world.orgId,
      userId: world.users.employee.id,
      date: previousBusinessDate,
      from: '10:00',
      to: '11:00',
    });
    // Emil's open overview counts the submission in „Vorgemerkte Zeit“ and
    // drops it when the manager decides it in another session, without navigation.
    await employeePage.goto('/zeiterfassung');
    const provisional = provisionalTimeSummary(employeePage);
    await expect(provisional).toContainText(TIME_ENTRY_COPY.pendingSubmission);
    await openTimeApprovals(adminPage);
    await approvePendingTimeEntry(adminPage, world.users.employee.id, /10:00.*11:00/);
    await expect(provisional.filter({ hasText: TIME_ENTRY_COPY.pendingSubmission })).toHaveCount(0);

    await adminPage.goto('/kalender');
    await calendarViewTab(adminPage, 'day').click();
    await calendarStepButton(adminPage, 'previous').click();
    await visibleCalendarLayerToggle(adminPage, 'work').click();
    await calendarRefreshButton(adminPage).click();
    const workBlock = visibleCalendarTimeBlock(adminPage, /10:00.*11:00/);
    await expect(workBlock).toBeVisible();
    await workBlock.click();
    const editDialog = timeEntryDetailsDialog(adminPage);
    await editDialog
      .getByRole('button', { name: SHARED_COPY.action.edit, exact: true })
      .click({ delay: 250 });
    const originalViewport = expectDefined(adminPage.viewportSize(), 'the configured viewport');
    await adminPage.setViewportSize({ width: 375, height: 568 });
    const entryBody = dialogBody(editDialog);
    const entryHeading = timeEntryDetailsHeading(editDialog);
    const saveEntry = editDialog.getByRole('button', { name: SHARED_COPY.action.save, exact: true });
    await expect(entryHeading).toBeInViewport({ ratio: 1 });
    await expect(saveEntry).toBeInViewport({ ratio: 1 });
    // The dialog re-centres after the viewport change; compare against its box once every frame
    // and finite animation has ended (two equal reads inside one frame passed a still-moving dialog).
    await nextFrames(adminPage);
    const initialSaveBox = expectDefined(await saveEntry.boundingBox(), 'the settled save button box');
    expect(await entryBody.evaluate((body) => body.scrollHeight > body.clientHeight)).toBe(true);
    await entryBody.evaluate((body) => {
      body.scrollTop = body.scrollHeight;
    });
    await expect(entryHeading).toBeInViewport({ ratio: 1 });
    await expect(saveEntry).toBeInViewport({ ratio: 1 });
    await nextFrames(adminPage);
    const scrolledSaveBox = expectDefined(await saveEntry.boundingBox(), 'the scrolled save button box');
    expect(Math.abs(scrolledSaveBox.y - initialSaveBox.y)).toBeLessThanOrEqual(1);
    await adminPage.setViewportSize(originalViewport);
    const clockOutTime = clockOutTimeGroup(editDialog);
    await expect(clockOutTime).toBeVisible();
    await typeIntoTimeGroup(editDialog, clockOutTime, '1130');
    const entryFormId = expectDefined(
      await editDialog.locator('form').getAttribute('id'),
      'the entry form id',
    );
    await expect(saveEntry).toHaveAttribute('form', entryFormId);
    // Enter on the save button submits the form it names by its form attribute.
    await pressKey(editDialog, 'Enter', { into: saveEntry });
    await expect(
      editDialog.getByRole('button', { name: SHARED_COPY.action.edit, exact: true }),
    ).toBeVisible();
    await dismissDialog(editDialog);
    await expect(visibleCalendarTimeBlock(adminPage, /10:00.*11:30/)).toBeVisible();

    await visibleCalendarTimeBlock(adminPage, /10:00.*11:30/).click();
    const deleteDialog = timeEntryDetailsDialog(adminPage);
    await deleteDialog.getByRole('button', { name: SHARED_COPY.action.delete, exact: true }).click();
    await adminPage
      .getByRole('alertdialog')
      .getByRole('button', { name: SHARED_COPY.action.delete, exact: true })
      .click();
    await expect(adminPage.getByTitle(/10:00.*11:30/)).toHaveCount(0);
    // Reassignment is an audited correction. Keep deletion coverage above on
    // a separate uncorrected booking, whose raw rows may still be deleted.
    await seedApprovedManualInterval({
      organizationId: world.orgId,
      userId: world.users.employee.id,
      date: previousBusinessDate,
      from: '12:00',
      to: '13:00',
    });
    await calendarRefreshButton(adminPage).click();
    const sourceRow = dayRow(adminPage, world.users.employee.id);
    const source = calendarWorkTimeBlock(sourceRow, '12:00', '13:00');
    await expect(source).toBeVisible();
    await moveCalendarBlockToMember(
      adminPage,
      source,
      `${world.users.buero.firstName} ${world.users.buero.lastName}`,
    );
    const correction = calendarTimeCorrectionDialog(adminPage);
    await expect(correction).toBeVisible();
    const reason = `Zuordnung berichtigt ${world.runId}`;
    await submitCalendarTimeCorrection(correction, reason);
    await expect(correction).toHaveCount(0);
    await expect(source).toHaveCount(0);
    const recipient = dayRow(adminPage, world.users.buero.id);
    await expect(calendarWorkTimeBlock(recipient, '12:00', '13:00')).toBeVisible();
    // The persisted correction: one revision with this reason and its one application.
    const state = await getTimeCorrectionState(world.orgId);
    const revision = expectDefined(
      state.revisions.find((item) => item.reason === reason),
      'the reassignment revision',
    );
    expect(state.applications.filter((item) => item.request_id === revision.request_id)).toHaveLength(1);
  });

  test('A1-31: Verlauf filtert Zeitraum, Mitarbeiter und Status [BASE-TIME-F06]', async ({
    adminPage,
    businessDate,
    employeePage,
    world,
  }) => {
    const businessDateDigits = dateDigits(businessDate);
    // Emil's own submission stays pending; the manager's entry for Emil is approved at once.
    await createOwnManualTimeEntry(employeePage, {
      dateDigits: businessDateDigits,
      clockInDigits: '0001',
      clockOutDigits: '0004',
    });
    const employeeFirstName = world.users.employee.firstName;
    await createOwnManualTimeEntry(adminPage, {
      memberName: employeeFirstName,
      dateDigits: businessDateDigits,
      clockInDigits: '0005',
      clockOutDigits: '0008',
    });

    await timeHistoryTab(adminPage).click();
    const history = timeHistoryPanel(adminPage);
    await expect(history.getByText(TIME_ENTRY_COPY.entriesFound)).toBeVisible();
    await selectFromSearchable(
      adminPage,
      timeHistoryFilter(history, TIME_ENTRY_COPY.allMembers),
      employeeFirstName,
    );
    await selectTimeHistoryStatus(
      adminPage,
      timeHistoryFilter(history, TIME_ENTRY_COPY.allStatuses),
      'pending',
    );
    await setTimeHistoryDay(history, businessDateDigits);
    await refreshTimeHistoryButton(history).click();
    const rows = timeHistoryRows(history);
    await expect(rows).toHaveCount(2);
    await expect(rows.filter({ hasText: /00:0[14]/ })).toHaveCount(2);
    for (const row of await rows.all()) {
      await expect(row).toContainText(employeeFirstName);
      await expect(row).toContainText(TIME_ENTRY_STATUS_TEXT.pending);
    }

    await selectTimeHistoryStatus(
      adminPage,
      timeHistoryFilter(history, TIME_ENTRY_STATUS_TEXT.pending),
      'approved',
    );
    await refreshTimeHistoryButton(history).click();
    await expect(rows.filter({ hasText: /00:0[58]/ })).toHaveCount(2);
    await expect(rows).toHaveCount(2);
    for (const row of await rows.all()) {
      await expect(row).toContainText(employeeFirstName);
      await expect(row).toContainText(TIME_ENTRY_STATUS_TEXT.approved);
    }

    await selectFromSearchable(
      adminPage,
      timeHistoryFilter(history, new RegExp(employeeFirstName)),
      world.users.buero.firstName,
    );
    await selectTimeHistoryStatus(
      adminPage,
      timeHistoryFilter(history, TIME_ENTRY_STATUS_TEXT.approved),
      'pending',
    );
    await refreshTimeHistoryButton(history).click();
    await expect(visibleText(adminPage, TIME_ENTRY_COPY.noEntriesFound)).toBeVisible();
    await expect(visibleText(adminPage, world.orgName)).toBeVisible();
  });

  test('A1-32: Nur Admin ändert Pausenregel und abgeschlossene Historie bleibt stabil', async ({
    adminPage,
    bueroPage,
    world,
  }) => {
    // A completed day longer than the automatic threshold that the new rule must not rewrite.
    const previousBusinessDate = berlinDateAtOffset(-1);
    await ensureEmployedSince({
      organizationId: world.orgId,
      userIds: [world.users.employee.id],
      date: previousBusinessDate,
    });
    await seedApprovedManualInterval({
      organizationId: world.orgId,
      userId: world.users.employee.id,
      date: previousBusinessDate,
      from: '14:00',
      to: '22:00',
    });
    const entriesBefore = await getOrganizationTimeEntrySnapshot(world.orgId);
    await adminPage.goto('/einstellungen/zeiterfassung');
    await saveAutomaticBreakRule(adminPage, { thresholdMinutes: 360, durationMinutes: 30 });
    await expect(visibleText(adminPage, TIME_SETTINGS_COPY.saved)).toBeVisible();

    await bueroPage.goto('/einstellungen/zeiterfassung');
    await expect(breakModeSelect(bueroPage)).toBeDisabled();
    await expect(visibleText(bueroPage, TIME_SETTINGS_COPY.readOnly)).toBeVisible();
    // The save action reconciles open breaks in the application; completed rows stay untouched.
    // The refused Büro write and the untouched completed day are proven in
    // supabase/tests/time_settings_atomic_writes.sql.
    expect(await getOrganizationTimeEntrySnapshot(world.orgId)).toEqual(entriesBefore);
  });
});

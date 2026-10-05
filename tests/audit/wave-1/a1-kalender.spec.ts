import { expect, test } from '../support/fixtures';
import {
  confirmPlanningWarning,
  createPlannedCalendarEntry,
  dragPlanningMonthEvent,
  manualEntrySavedConfirmation,
  planningWarningReason,
  planningWarningSave,
  showPlanningMonth,
  submitJobFromCalendar,
  submitManualEntryFromCalendar,
  timeEntryDetailsDialog,
} from '../../golden/support/steps/calendar';
import {
  fillParkingContext,
  parkingContextDialog,
  parkingContextSave,
} from '../../golden/support/steps/dispatch';
import { dismissDialog } from '../../golden/support/steps/interaction';
import { planningWarningDialog, textInDom, visibleText } from '../../golden/support/steps/shared';
import { createOwnManualTimeEntry } from '../../golden/support/steps/time-tracking';
import {
  calendarConfirmation,
  calendarLayerToggle,
  calendarRefreshButton,
  calendarViewTab,
  dayCard,
  dayRow,
  dayTimeline,
  dayViewCards,
  dragCardTo,
  dragHandleBy,
  memberFilterBulkAction,
  memberFilterButton,
  memberFilterPicker,
  memberFilterPopover,
  memberFilterSummary,
  monthCards,
  monthDay,
  monthDayNumber,
  monthDayShowing,
  monthMoreButton,
  parkplatzButton,
  parkplatzCardOf,
  reassignedConfirmation,
  scheduledFromParkplatzConfirmation,
  trailingResizeHandle,
  visibleCalendarLayerToggle,
} from '../../golden/support/plantafel';
import { berlinDateAtOffset, ownedBerlinDateAtOffset } from '../../golden/support/date-ownership';
import { moveCalendarBlockToMember, visibleCalendarTimeBlock } from '../support/a1-steps';

test.describe('A1 Kalender @AUDIT-W1-A1', () => {
  test('A1-21/A1-24: Kalenderansichten und getrennte Plan-/Arbeitszeitfilter', async ({
    adminPage,
    employeePage,
    world,
  }) => {
    const planningDate = ownedBerlinDateAtOffset('a1-kalender', 24);
    const title = `A1 Kalender ${world.runId}`;
    const otherEmployeeTitle = `A1 Kalender Bruno ${world.runId}`;
    await createPlannedCalendarEntry(adminPage, {
      kind: 'internal',
      internalTitle: title,
      date: planningDate,
      time: '06:00',
      durationHours: 1,
      employeeNames: ['Emil'],
      overrideReason: 'A1 Audit ohne hinterlegten Wochenplan',
    });
    await createPlannedCalendarEntry(adminPage, {
      kind: 'internal',
      internalTitle: otherEmployeeTitle,
      date: planningDate,
      time: '08:00',
      durationHours: 1,
      employeeNames: ['Bruno'],
      overrideReason: 'A1 Organisationssicht ohne hinterlegten Wochenplan',
    });
    await adminPage.goto('/kalender');
    for (const view of ['day', 'board', 'month'] as const) {
      await calendarViewTab(adminPage, view).click();
      await expect(calendarViewTab(adminPage, view)).toHaveAttribute('data-state', 'active');
    }
    await showPlanningMonth(adminPage, planningDate);
    await calendarRefreshButton(adminPage).click();
    const targetDay = monthDay(adminPage, planningDate);
    const calendarEvent = monthCards(targetDay, title);
    await expect(calendarEvent).toHaveCount(1, { timeout: 20_000 });
    const calendarTitle = visibleText(adminPage, title);
    // The month shows three items per day; the fourth waits behind „+n mehr".
    const otherCalendarTitle = visibleText(adminPage, otherEmployeeTitle);
    if (
      !(await calendarTitle.isVisible().catch(() => false)) ||
      !(await otherCalendarTitle.isVisible().catch(() => false))
    ) {
      await monthMoreButton(targetDay).click({ timeout: 5_000 });
    }
    await expect(calendarTitle).toBeVisible({ timeout: 20_000 });
    await expect(otherCalendarTitle).toBeVisible();
    await expect(calendarLayerToggle(adminPage, 'work')).toBeVisible();
    await expect(calendarLayerToggle(adminPage, 'planned')).toBeVisible();
    await calendarLayerToggle(adminPage, 'planned').click();
    await expect(textInDom(adminPage, title)).toHaveCount(0);
    await calendarLayerToggle(adminPage, 'planned').click();
    await expect(visibleText(adminPage, title)).toBeVisible();
    await memberFilterButton(adminPage).click();
    await memberFilterBulkAction(adminPage, 'none').click();
    await memberFilterPicker(adminPage).click();
    await adminPage.getByRole('option', { name: world.users.employee.firstName }).click();
    // The open picker list is the top layer: the first Escape closes it, the second the filter popover.
    await dismissDialog(adminPage.getByRole('listbox'));
    await dismissDialog(memberFilterPopover(adminPage));
    await expect(visibleText(adminPage, title)).toBeVisible();
    await expect(textInDom(adminPage, otherEmployeeTitle)).toHaveCount(0);
    // The member filter persists per user (P1-24a); leave every row selected.
    await memberFilterButton(adminPage).click();
    await memberFilterBulkAction(adminPage, 'all').click();
    await dismissDialog(memberFilterPopover(adminPage));
    await expect(memberFilterSummary(adminPage)).toBeVisible();

    await showPlanningMonth(employeePage, planningDate);
    await expect(visibleText(employeePage, title)).toBeVisible({
      timeout: 20_000,
    });
    await expect(textInDom(employeePage, otherEmployeeTitle)).toHaveCount(0);
    for (const view of ['day', 'week', 'month'] as const) {
      await calendarViewTab(employeePage, view).click();
      await expect(calendarViewTab(employeePage, view)).toHaveAttribute('data-state', 'active');
    }
  });

  test('A1-22: Kalender-Drag verschiebt Planung erst nach bestätigtem Warnpfad', async ({
    adminPage,
    world,
  }) => {
    const sourceDate = ownedBerlinDateAtOffset('a1-kalender', 22);
    const targetDate = ownedBerlinDateAtOffset('a1-kalender', 23);
    const title = `A1 Drag ${world.runId}`;
    await createPlannedCalendarEntry(adminPage, {
      kind: 'internal',
      internalTitle: title,
      date: sourceDate,
      time: '06:00',
      durationHours: 1,
      employeeNames: ['Emil'],
      overrideReason: 'A1 Ausgangsplanung ohne Wochenplan',
    });
    await adminPage.reload();
    await showPlanningMonth(adminPage, sourceDate);
    await dragPlanningMonthEvent(adminPage, { title, sourceDate, targetDate });
    const warning = planningWarningDialog(adminPage);
    await expect(warning).toBeVisible({ timeout: 20_000 });
    await planningWarningReason(warning).fill('A1 Drag bewusst bestätigt');
    await planningWarningSave(warning).click();
    await expect(warning).toHaveCount(0, { timeout: 20_000 });
    await showPlanningMonth(adminPage, targetDate);
    await expect(monthDayShowing(adminPage, targetDate, title)).toBeVisible();
  });

  test('A1-23: Kalender erstellt, skaliert, hängt um und parkt per Drag & Drop [BASE-CALENDAR-F02]', async ({
    adminPage,
    world,
  }) => {
    const plannedDate = ownedBerlinDateAtOffset('a1-kalender', 151);
    const jobNumber = `A1-CAL-J-${world.runId}`;
    const title = `A1 Kalenderauftrag ${world.runId}`;
    const bueroName = `${world.users.buero.firstName} ${world.users.buero.lastName}`;
    const createDialog = await submitJobFromCalendar(adminPage, {
      jobNumber,
      title,
      date: plannedDate,
      time: '09:00',
      durationHours: 1,
      employeeName: world.users.employee.firstName,
    });
    await confirmPlanningWarning(adminPage, 'A1 Kalenderauftrag bewusst geplant', false);
    await expect(createDialog).toHaveCount(0, { timeout: 20_000 });

    await showPlanningMonth(adminPage, plannedDate);
    await monthDayNumber(adminPage, plannedDate).click();
    await expect(calendarViewTab(adminPage, 'day')).toHaveAttribute('data-state', 'active');
    const jobBlock = dayViewCards(adminPage, title);
    await expect(jobBlock).toBeVisible({ timeout: 20_000 });
    const widthBefore = (await jobBlock.boundingBox())?.width ?? 0;
    await dragHandleBy(adminPage, trailingResizeHandle(jobBlock), 60);
    await confirmPlanningWarning(adminPage, 'A1 Dauer bewusst verlängert');
    await expect
      .poll(async () => (await jobBlock.boundingBox())?.width ?? 0)
      .toBeGreaterThan(widthBefore + 30);

    await moveCalendarBlockToMember(adminPage, jobBlock, bueroName);
    await confirmPlanningWarning(adminPage, 'A1 Umplanung zu Bruno bewusst bestätigt');
    // The day drop snaps the start as well, so the sentence may name the new time.
    await expect(reassignedConfirmation(adminPage, bueroName)).toBeVisible({ timeout: 20_000 });

    const blockBox = await jobBlock.boundingBox();
    const parkplatzBox = await parkplatzButton(adminPage).boundingBox();
    if (!blockBox || !parkplatzBox) throw new Error('A1-23 park drag targets are unavailable');
    await adminPage.mouse.move(blockBox.x + blockBox.width / 2, blockBox.y + blockBox.height / 2);
    await adminPage.mouse.down();
    await adminPage.mouse.move(
      parkplatzBox.x + parkplatzBox.width / 2,
      parkplatzBox.y + parkplatzBox.height / 2,
      {
        steps: 15,
      },
    );
    await adminPage.mouse.up();
    const parkingDialog = parkingContextDialog(adminPage);
    await expect(parkingDialog).toBeVisible({ timeout: 20_000 });
    await fillParkingContext(adminPage, parkingDialog, {
      reason: 'capacity',
      note: 'A1 Auftrag wird bis zur neuen Kapazitätsplanung geparkt.',
      responsibleName: world.users.admin.firstName,
      reviewDate: berlinDateAtOffset(7),
    });
    await parkingContextSave(parkingDialog).click();
    await expect(parkingDialog).toHaveCount(0, { timeout: 20_000 });
    await expect(calendarConfirmation(adminPage, 'parked')).toBeVisible({
      timeout: 20_000,
    });
    await adminPage.reload();
    await showPlanningMonth(adminPage, plannedDate);
    await monthDayNumber(adminPage, plannedDate).click();
    await parkplatzButton(adminPage).click();
    const parkedPill = parkplatzCardOf(adminPage, title);
    await expect(parkedPill).toBeVisible();
    await expect(parkedPill.locator('[data-parking-context]')).toHaveAttribute(
      'data-parking-context',
      'set',
      {
        timeout: 20_000,
      },
    );
    await dragCardTo(adminPage, parkedPill, dayTimeline(dayRow(adminPage, world.users.employee.id)));
    await confirmPlanningWarning(adminPage, 'A1 Auftrag aus Parkplatz eingeplant', false);
    await expect(scheduledFromParkplatzConfirmation(adminPage)).toBeVisible({
      timeout: 20_000,
    });
    await expect(parkedPill).toHaveCount(0, { timeout: 20_000 });
    // The visit kept Bruno and gained Emil: the card sits in both rows; the drop row is the proof.
    await expect(dayCard(dayRow(adminPage, world.users.employee.id), title)).toBeVisible();
  });

  test('A1-24/A1-25: Kalender-Zeiteintrag, Blocktrennung, Pending-Dialog, Filter und Realtime [BASE-CALENDAR-F03/F04]', async ({
    adminPage,
    bueroPage,
    businessDate,
    employeePage,
    world,
  }) => {
    const plannedTitle = `A1 Kalender Planarbeit ${world.runId}`;
    // A pending own entry in the past of the business date (the runner starts no group 23:40-00:10).
    await createOwnManualTimeEntry(employeePage, {
      dateDigits: businessDate.split('-').reverse().join(''),
      clockInDigits: '0000',
      clockOutDigits: '0005',
    });
    await createPlannedCalendarEntry(adminPage, {
      kind: 'internal',
      internalTitle: plannedTitle,
      date: businessDate,
      time: '10:00',
      durationHours: 1,
      employeeNames: ['Bruno'],
      overrideReason: 'A1 heutige Planarbeit für Kalendertrennung',
    });

    const manualDialog = await submitManualEntryFromCalendar(adminPage, {
      memberName: world.users.buero.firstName,
      clockInDigits: '0006',
      clockOutDigits: '0009',
    });
    await expect(manualEntrySavedConfirmation(adminPage)).toBeVisible({
      timeout: 20_000,
    });
    await expect(manualDialog).toHaveCount(0, { timeout: 10_000 });

    await calendarViewTab(adminPage, 'day').click();
    const refreshButton = calendarRefreshButton(adminPage);
    await refreshButton.click();
    await expect(refreshButton).toBeDisabled();
    await expect(refreshButton).toBeEnabled({ timeout: 30_000 });
    await visibleCalendarLayerToggle(adminPage, 'work').click();
    const plannedBlock = dayViewCards(adminPage, plannedTitle);
    const workBlock = visibleCalendarTimeBlock(adminPage, /00:06.*00:09/);
    await expect(plannedBlock).toBeVisible({ timeout: 20_000 });
    await expect(workBlock).toBeVisible({ timeout: 20_000 });
    await calendarLayerToggle(adminPage, 'planned').click();
    await expect(plannedBlock).toHaveCount(0);
    await expect(workBlock).toBeVisible();
    await calendarLayerToggle(adminPage, 'planned').click();
    await visibleCalendarLayerToggle(adminPage, 'work').click();
    await expect(adminPage.getByTitle(/00:06.*00:09/)).toHaveCount(0);
    await expect(dayViewCards(adminPage, plannedTitle)).toBeVisible();
    await visibleCalendarLayerToggle(adminPage, 'work').click();

    const pendingBlock = visibleCalendarTimeBlock(adminPage, /00:00.*00:05/);
    await expect(pendingBlock).toBeVisible({ timeout: 20_000 });
    await expect(pendingBlock).toHaveClass(/bg-warning/);
    await pendingBlock.click();
    const detailsDialog = timeEntryDetailsDialog(adminPage);
    await expect(detailsDialog).toBeVisible();
    await dismissDialog(detailsDialog);

    await showPlanningMonth(adminPage, businessDate);
    const liveTitle = `A1 Kalender Live ${world.runId}`;
    await createPlannedCalendarEntry(bueroPage, {
      kind: 'internal',
      internalTitle: liveTitle,
      date: businessDate,
      time: '12:00',
      durationHours: 1,
      employeeNames: ['Bruno'],
      overrideReason: 'A1 Kalender-Realtime',
    });
    await expect(visibleText(adminPage, liveTitle)).toBeVisible({
      timeout: 30_000,
    });
  });
});

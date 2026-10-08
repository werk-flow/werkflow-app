import { expect, test } from './support/fixtures';
import {
  getCalendarPreferencesFor,
  getJobOccurrenceAssigneeRecordIds,
  getPlanningState,
  occurrenceLocalDate,
} from './support/db/calendar';
import { getDispatchState, getParkingState } from './support/db/dispatch';
import { getEmployeeRecordStateByUser } from './support/db/personnel';
import { expectLiveWithin } from './support/live';
import {
  activeBoardRowCards,
  bannerUndo,
  boardCard,
  boardCardAsShown,
  boardCell,
  boardRows,
  calendarBanner,
  calendarViewReady,
  calendarViewTab,
  cardDispatchChip,
  chooseBoardHorizon,
  closeBanners,
  dragCardTo,
  mondayOf,
  openPlantafel,
  parkplatzButton,
  parkplatzCardOf,
  parkplatzScheduleButton,
  scheduleParkedDialog,
  scheduleParkedSubmit,
  shiftIsoDate,
} from './support/plantafel';
import { seedPlanningVisit } from './support/planning-fixture';
import { dispatchOverviewBerlinDateAtOffset } from './support/date-ownership';
import {
  acknowledgeDispatchOnJobPage,
  fillParkingContext,
  issueDispatchForOccurrence,
  openDispatchPanel,
  parkingContextSave,
} from './support/steps/dispatch';
import { SHARED_COPY, textInDom, typeIntoDatePickerById } from './support/steps/shared';

// Each scenario owns its job and occurrence; any test can run alone. Audit
// P1-24a keeps the refusals, the other drop kinds, the day and month views and
// the board read's isolation.

/** Next week's Tuesday and Wednesday, inside the dispatch overview's 14-day window. */
function visitDates(): { visitDate: string; movedDate: string } {
  const visitDate = shiftIsoDate(mondayOf(dispatchOverviewBerlinDateAtOffset(7)), 1);
  return { visitDate, movedDate: shiftIsoDate(visitDate, 1) };
}

test.describe('P1-24a independent Plantafel scenarios @P1-24a', () => {
  test('a manager lands on the Plantafel and reassigns a visit by drag, then undoes it', async ({
    adminPage,
    world,
  }) => {
    const { visitDate } = visitDates();
    const visit = await seedPlanningVisit(world, { date: visitDate, hour: 8 });
    const { title } = visit;
    const employeeRecord = await getEmployeeRecordStateByUser(world.orgId, world.users.employee.id);
    const bueroRecord = await getEmployeeRecordStateByUser(world.orgId, world.users.buero.id);

    await openPlantafel(adminPage, visitDate);
    await expect(calendarViewTab(adminPage, 'board')).toHaveAttribute('data-state', 'active');
    const card = boardCard(adminPage, employeeRecord.id, title);
    await expect(card).toBeVisible({ timeout: 20_000 });
    await expect(cardDispatchChip(card, 'nicht_gesendet')).toBeVisible();

    // Reassign to the Büro member: the card is in the target row before the
    // server answers, the banner confirms with Undo, the assignment changed.
    await dragCardTo(adminPage, card, boardCell(adminPage, bueroRecord.id, visitDate));
    await expect(boardCard(adminPage, bueroRecord.id, title)).toBeVisible({ timeout: 1_000 });
    const banner = calendarBanner(adminPage, 'moved');
    await expect(banner).toBeVisible({ timeout: 20_000 });
    await expect(bannerUndo(banner)).toBeVisible();
    expect(await getJobOccurrenceAssigneeRecordIds(world.orgId, visit.jobNumber)).toEqual([bueroRecord.id]);

    await bannerUndo(banner).click();
    await expect(boardCard(adminPage, employeeRecord.id, title)).toBeVisible({ timeout: 20_000 });
    await expect(calendarBanner(adminPage, 'undoFailed')).toHaveCount(0);
    await expect
      .poll(async () => getJobOccurrenceAssigneeRecordIds(world.orgId, visit.jobNumber), { timeout: 20_000 })
      .toEqual([employeeRecord.id]);
    await closeBanners(adminPage);
  });

  test('a second session sees a date move live and the dispatch state reaches the card', async ({
    adminPage,
    bueroPage,
    employeePage,
    world,
  }) => {
    const { visitDate, movedDate } = visitDates();
    const visit = await seedPlanningVisit(world, { date: visitDate, hour: 10 });
    const { title } = visit;
    const employeeRecord = await getEmployeeRecordStateByUser(world.orgId, world.users.employee.id);
    await openPlantafel(adminPage, visitDate);
    await openPlantafel(bueroPage, visitDate);
    // The observing session's card under the moved date is absent until the move lands.
    await expectLiveWithin(boardCard(bueroPage, employeeRecord.id, title, movedDate), {
      label: 'P1-24a board date move reaches a second session',
      actingPage: adminPage,
      mutation: async (beforeSubmit) => {
        await dragCardTo(
          adminPage,
          boardCard(adminPage, employeeRecord.id, title),
          boardCell(adminPage, employeeRecord.id, movedDate),
          { release: false },
        );
        await beforeSubmit();
        await adminPage.mouse.up();
      },
    });
    await expect(calendarBanner(adminPage, 'moved')).toBeVisible({ timeout: 20_000 });
    await closeBanners(adminPage);
    await expect
      .poll(
        async () =>
          occurrenceLocalDate(
            (await getPlanningState(world.orgId, { jobNumber: visit.jobNumber })).occurrences[0],
          ),
        { timeout: 20_000 },
      )
      .toBe(movedDate);

    // Dispatch: the chip follows the recipient's state.
    await openDispatchPanel(adminPage, movedDate);
    await issueDispatchForOccurrence(adminPage, title);
    await openPlantafel(adminPage, visitDate);
    await expect(cardDispatchChip(boardCard(adminPage, employeeRecord.id, title), 'ausstehend')).toBeVisible({
      timeout: 20_000,
    });
    await acknowledgeDispatchOnJobPage(employeePage, visit.jobNumber);
    await expect(cardDispatchChip(boardCard(adminPage, employeeRecord.id, title), 'bestaetigt')).toBeVisible({
      timeout: 20_000,
    });
    const dispatch = await getDispatchState(world.orgId, visit.jobNumber);
    expect(dispatch.dispatches).toHaveLength(1);
  });

  test('a park by drag opens the context dialog, cancelling restores the card, saving parks it, and „Einplanen am …“ brings it back', async ({
    adminPage,
    world,
  }) => {
    const { visitDate, movedDate } = visitDates();
    const visit = await seedPlanningVisit(world, { date: visitDate, hour: 12 });
    const { title } = visit;
    const employeeRecord = await getEmployeeRecordStateByUser(world.orgId, world.users.employee.id);
    await openPlantafel(adminPage, visitDate);
    await expect(boardCard(adminPage, employeeRecord.id, title)).toBeVisible({ timeout: 20_000 });

    // Cancel: the card left the grid on the drop and comes back on cancel.
    await dragCardTo(adminPage, boardCard(adminPage, employeeRecord.id, title), parkplatzButton(adminPage));
    const dialog = adminPage.getByRole('dialog');
    await expect(dialog).toBeVisible({ timeout: 20_000 });
    await expect(boardCardAsShown(adminPage, employeeRecord.id, title)).toHaveCount(0);
    await dialog.getByRole('button', { name: SHARED_COPY.action.cancel, exact: true }).click();
    await expect(boardCard(adminPage, employeeRecord.id, title)).toBeVisible({ timeout: 20_000 });

    // Save: the parked job carries its context and the board no longer shows it.
    await dragCardTo(adminPage, boardCard(adminPage, employeeRecord.id, title), parkplatzButton(adminPage));
    await expect(dialog).toBeVisible({ timeout: 20_000 });
    // The Parkplatz context (P1-14): reason, note, responsible person and review date.
    await fillParkingContext(adminPage, dialog, {
      reason: 'capacity',
      note: 'Plantafel-Parkplatz im Journey.',
      responsibleName: world.users.admin.firstName,
      reviewDate: shiftIsoDate(movedDate, 2),
    });
    await parkingContextSave(dialog).click();
    await expect(dialog).toHaveCount(0, { timeout: 20_000 });
    await expect(calendarBanner(adminPage, 'parked')).toBeVisible({ timeout: 20_000 });
    await closeBanners(adminPage);
    const parked = await getParkingState(world.orgId, visit.jobNumber);
    expect(parked.context?.reason).toBe('capacity');

    // Back onto the board through the keyboard route of the Parkplatz card.
    await parkplatzButton(adminPage).click();
    const parkedCard = parkplatzCardOf(adminPage, title);
    await expect(parkedCard).toBeVisible({ timeout: 20_000 });
    await parkplatzScheduleButton(parkedCard, title).click();
    const schedule = scheduleParkedDialog(adminPage);
    await typeIntoDatePickerById(schedule, 'schedule-parked-date', visitDate);
    await scheduleParkedSubmit(schedule).click();
    await expect(schedule).toHaveCount(0, { timeout: 20_000 });
    await expect(calendarBanner(adminPage, 'scheduled')).toBeVisible({ timeout: 20_000 });
    await closeBanners(adminPage);
    await expect
      .poll(async () => (await getParkingState(world.orgId, visit.jobNumber)).eventTypes, { timeout: 20_000 })
      .toContain('unparked');
    // The re-planned visit has no person yet; the cancelled occurrence stays struck through in the employee's row.
    await expect(boardCard(adminPage, 'unassigned', title)).toBeVisible({ timeout: 20_000 });
  });

  test('the horizon is remembered per user', async ({ adminPage, world }) => {
    const { visitDate } = visitDates();
    await openPlantafel(adminPage, visitDate);
    await chooseBoardHorizon(adminPage, 2);
    await expect(calendarViewReady(adminPage, 'week')).toHaveAttribute('data-calendar-horizon', '2', {
      timeout: 20_000,
    });
    // Confirm persistence before testing the reloaded page, without action transport assumptions.
    await expect
      .poll(async () => (await getCalendarPreferencesFor(world.orgId, world.users.admin.id))?.horizonWeeks, {
        timeout: 10_000,
      })
      .toBe(2);

    await openPlantafel(adminPage, visitDate);
    await expect(calendarViewReady(adminPage, 'week')).toHaveAttribute('data-calendar-horizon', '2');
    await chooseBoardHorizon(adminPage, 1);
    await expect(calendarViewReady(adminPage, 'week')).toHaveAttribute('data-calendar-horizon', '1', {
      timeout: 20_000,
    });
    await expect
      .poll(async () => (await getCalendarPreferencesFor(world.orgId, world.users.admin.id))?.horizonWeeks, {
        timeout: 10_000,
      })
      .toBe(1);
    await openPlantafel(adminPage, visitDate);
    await expect(calendarViewReady(adminPage, 'week')).toHaveAttribute('data-calendar-horizon', '1');
  });

  test('the employee sees the week as their own row only', async ({ adminPage, employeePage, world }) => {
    const { visitDate } = visitDates();
    const visit = await seedPlanningVisit(world, { date: visitDate, hour: 14, assigned: false });
    const { title } = visit;
    const employeeRecord = await getEmployeeRecordStateByUser(world.orgId, world.users.employee.id);
    await openPlantafel(adminPage, visitDate);
    await dragCardTo(
      adminPage,
      boardCard(adminPage, 'unassigned', title),
      boardCell(adminPage, employeeRecord.id, visitDate),
    );
    await expect(calendarBanner(adminPage, 'moved')).toBeVisible({ timeout: 20_000 });
    await closeBanners(adminPage);
    await expect
      .poll(async () => getJobOccurrenceAssigneeRecordIds(world.orgId, visit.jobNumber), { timeout: 20_000 })
      .toEqual([employeeRecord.id]);
    await employeePage.goto(`/kalender?date=${visitDate}`);
    await calendarViewTab(employeePage, 'week').click();
    await expect(calendarViewReady(employeePage, 'week')).toBeVisible({ timeout: 30_000 });
    await expect(boardRows(employeePage)).toHaveCount(1);
    await expect(activeBoardRowCards(employeePage, title)).toBeVisible();
    await expect(
      textInDom(employeePage, `${world.users.buero.firstName} ${world.users.buero.lastName}`),
    ).toHaveCount(0);
  });
});

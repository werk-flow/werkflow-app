import { resolveBerlinWallTime } from '../../../lib/planning/date-time';
import { expectDefined } from '../../../lib/testing/spec-support/expect-defined';
import { expect, test } from '../support/fixtures';
import {
  getJobOccurrenceAssigneeRecordIds,
  getPlanningState,
  occurrenceLocalDate,
  seedClosureDay,
  getCalendarPreferencesFor,
} from '../../golden/support/db/calendar';
import { getDispatchState, getParkingState } from '../../golden/support/db/dispatch';
import { getEmployeeRecordStateByUser, giveEmployeesWorkSchedules } from '../../golden/support/db/personnel';
import { seedSicknessReport } from '../../golden/support/db/sickness';
import { getOrganizationTimeEntryCount } from '../../golden/support/db/time-tracking';
import { ownedBerlinDateAtOffset } from '../../golden/support/date-ownership';
import {
  banners,
  beginCardDragToPoint,
  boardAbsenceBar,
  boardCard,
  boardCell,
  boardCellEntryAction,
  boardColumn,
  boardFilterButton,
  boardFilterPopover,
  boardRowCards,
  boardSearch,
  boardTeamHeader,
  boardWeekNumber,
  calendarAbsenceBarStarting,
  calendarBanner,
  calendarHolidayLabel,
  calendarPageHeading,
  calendarViewReady,
  calendarViewTab,
  cardDispatchChip,
  cardPopoverAction,
  cardSeriesMark,
  chooseBoardHorizon,
  closeBanners,
  conflictsOnlyFilter,
  dayCard,
  dayRow,
  dayTimeline,
  densityToggle,
  DRAG_REFUSALS,
  dragCardTo,
  dragGhost,
  dragHandleBy,
  dragHandleTo,
  dragToCreateOnDayRow,
  inMonthCells,
  jobPopover,
  mondayOf,
  monthCards,
  monthCell,
  monthDay,
  monthDayPopover,
  monthMoreButton,
  openCalendarView,
  openPlantafel,
  parkplatzButton,
  parkplatzCardOf,
  plantafel,
  reassignedBanner,
  shiftIsoDate,
  shortcutsButton,
  shortcutsDialog,
  trailingResizeHandle,
  unassignedRowHeader,
} from '../../golden/support/plantafel';
import { seedPlanningVisit } from '../../golden/support/planning-fixture';
import {
  calendarEntryDialog,
  createPlannedCalendarEntry,
  occurrenceEditButton,
  planningAllDayOption,
  planningCheckAndSave,
  planningEmployeePicker,
  planningInternalEntryToggle,
  planningInternalTypeOption,
} from '../../golden/support/steps/calendar';
import { fillParkingContext, parkingContextSave } from '../../golden/support/steps/dispatch';
import { dismissDialog, pressKey } from '../../golden/support/steps/interaction';
import { addClosureDayViaSettings } from '../../golden/support/steps/personnel';
import {
  addTeamMemberViaManagement,
  createTeamViaManagement,
} from '../../golden/support/steps/qualifications';
import {
  employeeSelectionSummary,
  expectGone,
  selectFromSearchable,
  SHARED_COPY,
  testData,
} from '../../golden/support/steps/shared';
import { createJob } from '../../golden/support/steps/work';

// P1-24a audit: the Plantafel, the day and the month view flow by flow
// (docs/product/user-flow-catalog.md, P1-24a-F01 to F35). Golden P1-24a owns
// the reassignment with Undo, the live date move, the park dialog with
// „Einplanen am …“, the horizon memory and the employee's own row. Every test
// seeds its own visits; the weeks keep the tests apart: AUDIT-01, 03, 04 and 06
// the first week, AUDIT-02 the second, AUDIT-05 the third.

const OVERRIDE_REASON = 'Betrieblich abgestimmter P1-24a Audit-Einsatz.';

/** The Monday of the first audit week, anchored in the group's owned date window. */
function firstAuditMonday(): string {
  return mondayOf(ownedBerlinDateAtOffset('p1-24a', 134));
}
function dateDigits(dateIso: string): string {
  return `${dateIso.slice(8, 10)}${dateIso.slice(5, 7)}${dateIso.slice(0, 4)}`;
}
function jobNumber(runId: string, suffix: string): string {
  return `AUF-${runId}-P124A-${suffix}`;
}

test.describe('P1-24a Plantafel, day and month audit @AUDIT-W3-P1-24A @AUDIT-W3', () => {
  test('AUDIT-01 the board opens at each horizon with weekends, closure and team grouping @P1-24A-01', async ({
    adminPage,
    world,
  }) => {
    const monday = firstAuditMonday();
    const closure = shiftIsoDate(monday, 4);
    const employeeName = `${world.users.employee.firstName} ${world.users.employee.lastName}`;
    const titleA = `P1-24a Besuch A ${world.runId}`;
    const titleB = `P1-24a Besuch B ${world.runId}`;
    const titleSeries = `P1-24a Serie ${world.runId}`;
    const internalTitle = `Teamrunde ${world.runId}`;
    const closureLabel = testData`Brückentag P1-24a`;
    // Persons with a schedule plan without the "no schedule" warning; the closure day still zeroes its target.
    await giveEmployeesWorkSchedules({
      organizationId: world.orgId,
      actorUserId: world.users.admin.id,
      validFrom: '2026-01-01',
      weekdayMinutes: 480,
      weekendMinutes: 0,
      note: 'P1-24a audit',
    });
    await createTeamViaManagement(adminPage, `Team Plantafel ${world.runId}`);
    await addTeamMemberViaManagement(adminPage, { teamName: `Team Plantafel ${world.runId}`, employeeName });
    await addClosureDayViaSettings(adminPage, {
      dateDigits: dateDigits(closure),
      label: closureLabel,
    });
    await createJob(adminPage, { jobNumber: jobNumber(world.runId, 'A'), title: titleA });
    await createJob(adminPage, { jobNumber: jobNumber(world.runId, 'B'), title: titleB });
    await createJob(adminPage, { jobNumber: jobNumber(world.runId, 'C'), title: titleSeries });
    await createPlannedCalendarEntry(adminPage, {
      kind: 'job_visit',
      jobSearch: jobNumber(world.runId, 'A'),
      date: monday,
      time: '08:00',
      employeeNames: [employeeName],
      overrideReason: OVERRIDE_REASON,
    });
    // A multi-day all-day visit without a person lands in „Ohne Zuweisung“.
    await createPlannedCalendarEntry(adminPage, {
      kind: 'job_visit',
      jobSearch: jobNumber(world.runId, 'B'),
      date: shiftIsoDate(monday, 1),
      durationDays: 2,
      overrideReason: OVERRIDE_REASON,
    });
    await createPlannedCalendarEntry(adminPage, {
      kind: 'job_visit',
      jobSearch: jobNumber(world.runId, 'C'),
      date: monday,
      time: '13:00',
      employeeNames: [employeeName],
      recurrence: { frequency: 'daily', count: 3 },
      overrideReason: OVERRIDE_REASON,
    });
    await createPlannedCalendarEntry(adminPage, {
      kind: 'internal',
      internalTitle,
      internalType: 'meeting',
      date: shiftIsoDate(monday, 3),
      time: '10:00',
      employeeNames: [employeeName],
    });

    await openPlantafel(adminPage, monday);
    await expect(calendarViewTab(adminPage, 'board')).toHaveAttribute('data-state', 'active');
    await expect(boardTeamHeader(adminPage, `Team Plantafel ${world.runId}`)).toBeVisible();
    await expect(unassignedRowHeader(adminPage)).toBeVisible();
    await expect(boardCard(adminPage, 'unassigned', titleB)).toBeVisible();
    // The closure day carries its label in the header; the weekend is shaded.
    await expect(boardColumn(adminPage, closure)).toContainText(closureLabel);
    await expect(boardColumn(adminPage, shiftIsoDate(monday, 5))).toHaveClass(/bg-calendar-cell-off/);
    const employeeRecord = await getEmployeeRecordStateByUser(world.orgId, world.users.employee.id);
    await expect(boardCell(adminPage, employeeRecord.id, closure)).toHaveAttribute(
      'aria-label',
      /Brückentag P1-24a|Betriebsruhe/,
    );
    // Series marks, the internal entry, and capacity on the planned day.
    await expect(cardSeriesMark(boardCard(adminPage, employeeRecord.id, titleSeries, monday))).toBeVisible();
    await expect(boardCard(adminPage, employeeRecord.id, internalTitle)).toBeVisible();
    await expect(boardCell(adminPage, employeeRecord.id, monday)).toHaveAttribute(
      'data-capacity',
      /partial|full|overbooked/,
    );

    for (const weeks of [2, 4, 6, 1] as const) {
      await chooseBoardHorizon(adminPage, weeks);
      await expect(calendarViewReady(adminPage, 'week')).toHaveAttribute(
        'data-calendar-horizon',
        String(weeks),
        {
          timeout: 20_000,
        },
      );
    }
    await expect(boardWeekNumber(adminPage)).toBeVisible();
  });

  test('AUDIT-02 every other drop kind: refusal on an absence day, date move, copy, bar edge, note, park and unpark by drag @P1-24A-02', async ({
    adminPage,
    world,
  }) => {
    const monday = shiftIsoDate(firstAuditMonday(), 7);
    const tuesday = shiftIsoDate(monday, 1);
    const absenceStart = shiftIsoDate(monday, 2);
    const thursday = shiftIsoDate(monday, 3);
    const friday = shiftIsoDate(monday, 4);
    const employeeName = `${world.users.employee.firstName} ${world.users.employee.lastName}`;
    const employeeRecord = await getEmployeeRecordStateByUser(world.orgId, world.users.employee.id);
    const bueroRecord = await getEmployeeRecordStateByUser(world.orgId, world.users.buero.id);
    const visit = await seedPlanningVisit(world, { date: monday, hour: 8, assignee: 'buero' });
    const bar = await seedPlanningVisit(world, { date: tuesday, allDayDays: 2, assigned: false });
    await seedSicknessReport({
      organizationId: world.orgId,
      employeeRecordId: employeeRecord.id,
      reportedBy: world.users.employee.id,
      startDate: absenceStart,
      endDate: thursday,
    });
    const entriesBefore = await getOrganizationTimeEntryCount(world.orgId);

    await openPlantafel(adminPage, monday);
    await expect(boardAbsenceBar(adminPage, employeeRecord.id, 'sickness')).toBeVisible({ timeout: 20_000 });

    await test.step('A drop onto an absence day is refused at the pointer and writes nothing', async () => {
      await dragCardTo(
        adminPage,
        boardCard(adminPage, bueroRecord.id, visit.title),
        boardCell(adminPage, employeeRecord.id, absenceStart),
        { release: false },
      );
      await expect(dragGhost(adminPage)).toHaveAttribute('data-state', 'refused');
      await expect(dragGhost(adminPage)).toContainText(DRAG_REFUSALS.absent);
      await adminPage.mouse.up();
      await expect(boardCard(adminPage, bueroRecord.id, visit.title)).toBeVisible();
      expect(
        occurrenceLocalDate(
          (await getPlanningState(world.orgId, { jobNumber: visit.jobNumber })).occurrences[0],
        ),
      ).toBe(monday);
    });

    await test.step('A date move in the same row keeps the time', async () => {
      await dragCardTo(
        adminPage,
        boardCard(adminPage, bueroRecord.id, visit.title),
        boardCell(adminPage, bueroRecord.id, tuesday),
      );
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
        .toBe(tuesday);
      await expect(boardCard(adminPage, bueroRecord.id, visit.title)).toContainText('08:00');
    });

    await test.step('An Alt drop copies the visit into another row', async () => {
      await dragCardTo(
        adminPage,
        boardCard(adminPage, bueroRecord.id, visit.title),
        boardCell(adminPage, employeeRecord.id, monday),
        { alt: true },
      );
      await expect(calendarBanner(adminPage, 'copied')).toBeVisible({ timeout: 20_000 });
      await closeBanners(adminPage);
      await expect
        .poll(
          async () => (await getPlanningState(world.orgId, { jobNumber: visit.jobNumber })).occurrenceCount,
          { timeout: 20_000 },
        )
        .toBe(2);
    });

    await test.step('The bar edge extends an all-day visit by a day', async () => {
      await dragHandleTo(
        adminPage,
        trailingResizeHandle(boardCard(adminPage, 'unassigned', bar.title)),
        boardCell(adminPage, 'unassigned', thursday),
      );
      await expect(calendarBanner(adminPage, 'extendedUntil')).toBeVisible({ timeout: 20_000 });
      await closeBanners(adminPage);
      await expect
        .poll(
          async () =>
            (await getPlanningState(world.orgId, { jobNumber: bar.jobNumber })).occurrences[0]
              ?.endDateExclusive,
          { timeout: 20_000 },
        )
        .toBe(friday);
    });

    await test.step('The person-day action creates an all-day note without a dispatch chip', async () => {
      const noteTitle = `Schlüssel abholen ${world.runId}`;
      // The action sits in the cell's corner above the card lanes.
      const noteAction = boardCellEntryAction(adminPage, employeeRecord.id, friday, employeeName);
      await noteAction.hover();
      await noteAction.click();
      const noteDialog = calendarEntryDialog(adminPage);
      await planningInternalEntryToggle(noteDialog).click();
      await noteDialog.locator('#planning-internal-type').click();
      await planningInternalTypeOption(adminPage, 'other').click();
      await noteDialog.locator('#planning-time-kind').click();
      await planningAllDayOption(adminPage).click();
      await noteDialog.getByLabel(SHARED_COPY.field.title).fill(noteTitle);
      await planningCheckAndSave(noteDialog).click();
      await expect(noteDialog).toHaveCount(0, { timeout: 20_000 });
      const noteCard = boardCard(adminPage, employeeRecord.id, noteTitle, friday);
      await expect(noteCard).toBeVisible({ timeout: 20_000 });
      await expect(cardDispatchChip(noteCard, 'nicht_gesendet')).toHaveCount(0);
      expect(
        occurrenceLocalDate(
          (await getPlanningState(world.orgId, { internalTitle: noteTitle })).occurrences[0],
        ),
      ).toBe(friday);
    });

    await test.step('Park by drag, then unpark the Parkplatz card by drag', async () => {
      await dragCardTo(
        adminPage,
        boardCard(adminPage, employeeRecord.id, visit.title),
        parkplatzButton(adminPage),
      );
      const parkDialog = adminPage.getByRole('dialog');
      await expect(parkDialog).toBeVisible({ timeout: 20_000 });
      await fillParkingContext(adminPage, parkDialog, {
        reason: 'capacity',
        responsibleName: world.users.admin.firstName,
        reviewDate: friday,
      });
      await parkingContextSave(parkDialog).click();
      await expect(parkDialog).toHaveCount(0, { timeout: 20_000 });
      await closeBanners(adminPage);
      expect((await getParkingState(world.orgId, visit.jobNumber)).context?.reason).toBe('capacity');
      await parkplatzButton(adminPage).click();
      const parkedCard = parkplatzCardOf(adminPage, visit.title);
      await expect(parkedCard).toBeVisible({ timeout: 20_000 });
      await dragCardTo(adminPage, parkedCard, boardCell(adminPage, employeeRecord.id, tuesday));
      await expect(calendarBanner(adminPage, 'scheduled')).toBeVisible({ timeout: 20_000 });
      await closeBanners(adminPage);
      await expect
        .poll(async () => (await getParkingState(world.orgId, visit.jobNumber)).eventTypes, {
          timeout: 20_000,
        })
        .toContain('unparked');
    });

    // No side effect: the board wrote no time entry and no dispatch.
    expect(await getOrganizationTimeEntryCount(world.orgId)).toBe(entriesBefore);
    expect((await getDispatchState(world.orgId, visit.jobNumber)).dispatches).toHaveLength(0);
  });

  test('AUDIT-03 keyboard and form paths, filters, search and persistence @P1-24A-03', async ({
    adminPage,
    world,
  }) => {
    const monday = firstAuditMonday();
    const employeeRecord = await getEmployeeRecordStateByUser(world.orgId, world.users.employee.id);
    const bueroRecord = await getEmployeeRecordStateByUser(world.orgId, world.users.buero.id);
    const bueroName = `${world.users.buero.firstName} ${world.users.buero.lastName}`;
    const moved = await seedPlanningVisit(world, { date: monday, hour: 9 });
    const searched = await seedPlanningVisit(world, { date: shiftIsoDate(monday, 1), hour: 9 });
    await openPlantafel(adminPage, monday);

    await test.step('Enter opens the popover; its move form reassigns the visit', async () => {
      const movedCard = boardCard(adminPage, employeeRecord.id, moved.title, monday);
      await movedCard.focus();
      await pressKey(adminPage, 'Enter', { into: movedCard });
      const popover = jobPopover(adminPage);
      await expect(popover).toBeVisible();
      await expect(occurrenceEditButton(popover)).toBeVisible();
      await cardPopoverAction(popover, 'openMoveForm').click();
      await selectFromSearchable(adminPage, popover.locator('#popover-move-person'), bueroName);
      await cardPopoverAction(popover, 'move').click();
      await expect(reassignedBanner(adminPage, bueroName)).toBeVisible({
        timeout: 20_000,
      });
      await closeBanners(adminPage);
      await expect
        .poll(async () => getJobOccurrenceAssigneeRecordIds(world.orgId, moved.jobNumber), {
          timeout: 20_000,
        })
        .toEqual([bueroRecord.id]);
    });

    await test.step('Search narrows the cards; the filter popover holds the conflict filter', async () => {
      await boardSearch(adminPage).fill(searched.title);
      await expectGone(boardRowCards(adminPage, moved.title));
      await expect(boardRowCards(adminPage, searched.title)).toHaveCount(1);
      await boardSearch(adminPage).fill('');
      await boardFilterButton(adminPage).click();
      await conflictsOnlyFilter(adminPage).check();
      await dismissDialog(boardFilterPopover(adminPage));
      await expect(boardFilterButton(adminPage, 1)).toBeVisible();
      await boardFilterButton(adminPage).click();
      await conflictsOnlyFilter(adminPage).uncheck();
      await dismissDialog(boardFilterPopover(adminPage));
    });

    await test.step('Density persists across a reload; shortcuts move the window and switch views', async () => {
      await densityToggle(adminPage, 'compact').click();
      await shortcutsButton(adminPage).click();
      await expect(shortcutsDialog(adminPage)).toBeVisible();
      await dismissDialog(shortcutsDialog(adminPage));
      // Confirm the stored outcome before reloading, independent of action wire encoding.
      await expect
        .poll(async () => (await getCalendarPreferencesFor(world.orgId, world.users.admin.id))?.density, {
          timeout: 10_000,
        })
        .toBe('compact');
      await openPlantafel(adminPage, monday);
      await expect(plantafel(adminPage)).toHaveAttribute('data-density', 'compact');
      await densityToggle(adminPage, 'comfortable').click();
      // The shortcuts move by the horizon; a one-week horizon makes each step one week.
      await chooseBoardHorizon(adminPage, 1);
      await expect(calendarViewReady(adminPage, 'week')).toHaveAttribute('data-calendar-horizon', '1', {
        timeout: 20_000,
      });
      // The closed select keeps focus on its combobox trigger, where a key belongs
      // to the control and never to the calendar; leave it as a user would.
      // pressKey refuses a shortcut while focus still sits in a field.
      await calendarPageHeading(adminPage).click();
      await pressKey(adminPage, 'j');
      await expect(boardColumn(adminPage, shiftIsoDate(monday, 7))).toBeVisible({ timeout: 20_000 });
      await pressKey(adminPage, 'k');
      await expect(boardColumn(adminPage, monday)).toBeVisible({ timeout: 20_000 });
      await pressKey(adminPage, 'd');
      await expect(calendarViewReady(adminPage, 'day')).toBeVisible({ timeout: 20_000 });
      await pressKey(adminPage, 'w');
      await expect(calendarViewReady(adminPage, 'week')).toBeVisible({ timeout: 20_000 });
      await expect
        .poll(
          async () => {
            const stored = await getCalendarPreferencesFor(world.orgId, world.users.admin.id);
            return `${stored?.density}/${stored?.horizonWeeks}/${stored?.view}`;
          },
          { timeout: 10_000 },
        )
        .toBe('comfortable/1/week');
    });
  });

  test('AUDIT-04 the day view: lanes, drag-to-create, resize, and the refusal past midnight @P1-24A-04', async ({
    adminPage,
    world,
  }) => {
    const thursday = shiftIsoDate(firstAuditMonday(), 3);
    const employeeName = `${world.users.employee.firstName} ${world.users.employee.lastName}`;
    const visit = await seedPlanningVisit(world, { date: thursday, hour: 13 });
    const seededEnd = expectDefined(
      resolveBerlinWallTime(`${thursday}T14:00`),
      'the seeded visit end',
    ).instant.getTime();
    await openCalendarView(adminPage, thursday, 'day');
    const row = dayRow(adminPage, world.users.employee.id);
    await expect(row).toBeVisible();
    const visitCard = dayCard(row, visit.title);
    await expect(visitCard).toBeVisible();

    await test.step('Drag-to-create on empty time opens the dialog with the person preset', async () => {
      await dragToCreateOnDayRow(adminPage, dayTimeline(row), 15.1, 16.6);
      const dialog = calendarEntryDialog(adminPage);
      await expect(dialog).toBeVisible({ timeout: 20_000 });
      await expect(dialog.locator('#planning-date')).toBeVisible({ timeout: 15_000 });
      // The multi-select summarises its selection; the opened list (a body portal) names the preset person.
      await expect(planningEmployeePicker(dialog)).toHaveText(employeeSelectionSummary(1));
      await planningEmployeePicker(dialog).click();
      await expect(adminPage.getByRole('option', { name: employeeName, selected: true })).toBeVisible({
        timeout: 10_000,
      });
      // The open list is the top layer: the first Escape closes it, the second the dialog.
      await dismissDialog(adminPage.getByRole('listbox'));
      await expect(adminPage.getByRole('listbox')).toHaveCount(0);
      await dismissDialog(dialog);
      await expect(dialog).toHaveCount(0);
    });

    const timelineBox = expectDefined(await dayTimeline(row).boundingBox(), 'the day timeline layout');
    await test.step('The end handle lengthens the visit', async () => {
      await dragHandleBy(adminPage, trailingResizeHandle(visitCard), timelineBox.width / 24);
      await expect(calendarBanner(adminPage, 'lengthened')).toBeVisible({ timeout: 20_000 });
      await closeBanners(adminPage);
      await expect
        .poll(
          async () => {
            const endAt = (await getPlanningState(world.orgId, { jobNumber: visit.jobNumber })).occurrences[0]
              ?.endAt;
            return endAt ? Date.parse(endAt) : null;
          },
          { timeout: 20_000 },
        )
        .toBeGreaterThan(seededEnd);
    });

    await test.step('A drop that would end past midnight is refused at the pointer', async () => {
      const cardBox = expectDefined(await visitCard.boundingBox(), 'the visit card layout');
      await beginCardDragToPoint(adminPage, visitCard, {
        x: timelineBox.x + timelineBox.width - 4,
        y: cardBox.y + cardBox.height / 2,
      });
      await expect(dragGhost(adminPage)).toContainText(DRAG_REFUSALS.pastMidnight);
      await adminPage.mouse.up();
      await expect(banners(adminPage)).toHaveCount(0);
    });
  });

  test('AUDIT-05 the month view: closure label, absence bar, „+n mehr“, a date move and the popover @P1-24A-05', async ({
    adminPage,
    world,
  }) => {
    const monday = shiftIsoDate(firstAuditMonday(), 14);
    const closure = shiftIsoDate(monday, 1);
    const absenceStart = shiftIsoDate(monday, 2);
    const moveDay = shiftIsoDate(monday, 4);
    const closureLabel = testData`Monatsruhe P1-24a`;
    const employeeName = `${world.users.employee.firstName} ${world.users.employee.lastName}`;
    const employeeRecord = await getEmployeeRecordStateByUser(world.orgId, world.users.employee.id);
    const visits: Array<{ jobNumber: string; title: string }> = [];
    for (const hour of [9, 10, 11, 12]) visits.push(await seedPlanningVisit(world, { date: monday, hour }));
    const movedVisit = expectDefined(visits[0], 'the first month visit');
    await seedClosureDay({
      organizationId: world.orgId,
      actorUserId: world.users.admin.id,
      date: closure,
      label: closureLabel,
    });
    await seedSicknessReport({
      organizationId: world.orgId,
      employeeRecordId: employeeRecord.id,
      reportedBy: world.users.employee.id,
      startDate: absenceStart,
      endDate: shiftIsoDate(monday, 3),
    });

    await openCalendarView(adminPage, monday, 'month');
    await expect(calendarHolidayLabel(adminPage, closureLabel)).toBeVisible();
    await expect(calendarAbsenceBarStarting(adminPage, absenceStart, employeeName)).toBeVisible();
    await expect(monthCards(monthDay(adminPage, monday))).toHaveCount(3);
    await monthMoreButton(monthDay(adminPage, monday)).click();
    await expect(monthCards(monthDayPopover(adminPage, monday))).toHaveCount(4);
    await dismissDialog(monthDayPopover(adminPage, monday));
    await expect(inMonthCells(adminPage)).toHaveCount(
      new Date(Date.UTC(Number(monday.slice(0, 4)), Number(monday.slice(5, 7)), 0)).getUTCDate(),
    );

    // Move one visit to a free weekday by drag; the card lands at once and the state follows.
    await dragCardTo(
      adminPage,
      monthCards(monthDay(adminPage, monday), movedVisit.title),
      monthCell(adminPage, moveDay),
    );
    await expect(monthCards(monthDay(adminPage, moveDay), movedVisit.title)).toBeVisible({
      timeout: 1_000,
    });
    await expect(calendarBanner(adminPage, 'moved')).toBeVisible({ timeout: 20_000 });
    await closeBanners(adminPage);
    await expect
      .poll(
        async () =>
          occurrenceLocalDate(
            (await getPlanningState(world.orgId, { jobNumber: movedVisit.jobNumber })).occurrences[0],
          ),
        { timeout: 20_000 },
      )
      .toBe(moveDay);
    // The card popover opens beside the card in the month too.
    await monthCards(monthDay(adminPage, moveDay), movedVisit.title).click();
    await expect(cardPopoverAction(jobPopover(adminPage), 'showDetails')).toBeVisible();
    await dismissDialog(jobPopover(adminPage));
  });

  test('AUDIT-06 the board read narrows the employee to their own row and denies the outsider @P1-24A-06', async ({
    employeePage,
    outsiderPage,
    world,
  }) => {
    const monday = firstAuditMonday();
    const boardRead = `/api/calendar-board?organizationId=${world.orgId}&fromDate=${monday}&toDate=${shiftIsoDate(monday, 5)}`;
    const own = await employeePage.request.get(boardRead);
    expect(own.status()).toBe(200);
    const ownBody = (await own.json()) as { rows: Array<{ userId: string | null }> };
    expect(ownBody.rows.map((row) => row.userId)).toEqual([world.users.employee.id]);
    const foreign = await outsiderPage.request.get(boardRead);
    expect(foreign.status()).toBe(403);
  });
});

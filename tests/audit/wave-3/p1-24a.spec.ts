import { expect, test } from "../support/fixtures";
import { getCalendarPreferencesFor, getEmployeeRecordStateByUser, getOrganizationTimeEntryCount, getParkingState, getPlanningState, getVisibleDispatchStateAs, giveEmployeesWorkSchedules, occurrenceLocalDate } from "../../golden/support/db";
import { ownedBerlinDateAtOffset } from "../../golden/support/date-ownership";
import {
  banners,
  beginCardDragToPoint,
  boardAbsenceBar,
  boardCard,
  boardCell,
  boardColumn,
  boardRows,
  boardTeamHeader,
  calendarAbsenceBarStarting,
  calendarHolidayLabel,
  calendarViewReady,
  closeBanners,
  dayCard,
  dayRow,
  dayTimeline,
  dragCardTo,
  dragGhost,
  dragHandleBy,
  dragHandleTo,
  dragToCreateOnDayRow,
  inMonthCells,
  jobPopover,
  monthCards,
  monthCell,
  monthDay,
  monthDayPopover,
  openCalendarView,
  openPlantafel,
  parkplatzButton,
  parkplatzCardOf,
  plantafel,
  successBanner,
  trailingResizeHandle,
} from "../../golden/support/plantafel";
import {
  addClosureDayViaSettings,
  addTeamMemberViaManagement,
  createJob,
  createPlannedCalendarEntry,
  createTeamViaManagement,
  removeClosureDayViaSettings,
  reportOwnSicknessViaDialog,
  selectFromSearchable,
  textInDom,
  typeIntoDatePickerById,
} from "../../golden/support/steps";

// P1-24a audit: the Plantafel, the day and the month view flow by flow
// (docs/product/user-flow-catalog.md, P1-24a-F01 to F35). The world is this
// group's own; dates are run-day +131 to +140 (date-ownership registry).

test.describe.configure({ mode: "serial" });

const MONDAY = mondayOf(ownedBerlinDateAtOffset("p1-24a", 134));
const DAY_A = MONDAY;
const DAY_B = shiftIsoDate(MONDAY, 1);
const DAY_D = shiftIsoDate(MONDAY, 3);
const CLOSURE = shiftIsoDate(MONDAY, 4);
/** A free weekday of the second week: no visit, no absence, no closure. */
const NOTE_DAY = shiftIsoDate(MONDAY, 7);
/** The month move's target: the free weekday after the note's day. */
const MOVE_DAY = shiftIsoDate(MONDAY, 8);
const SATURDAY = shiftIsoDate(MONDAY, 5);
const ABSENCE_START = shiftIsoDate(MONDAY, 2);
const ABSENCE_END = shiftIsoDate(MONDAY, 3);
const OVERRIDE_REASON = "Betrieblich abgestimmter P1-24a Audit-Einsatz.";

function shiftIsoDate(dateIso: string, days: number): string {
  const [year, month, day] = dateIso.split("-").map(Number);
  if (year === undefined || month === undefined || day === undefined) throw new Error(`Invalid ISO date: ${dateIso}`);
  return new Date(Date.UTC(year, month - 1, day) + days * 86_400_000).toISOString().slice(0, 10);
}
function mondayOf(dateIso: string): string {
  return shiftIsoDate(dateIso, -((new Date(`${dateIso}T00:00:00Z`).getUTCDay() + 6) % 7));
}
function dateDigits(dateIso: string): string {
  return `${dateIso.slice(8, 10)}${dateIso.slice(5, 7)}${dateIso.slice(0, 4)}`;
}
function germanDate(dateIso: string): string {
  return `${dateIso.slice(8, 10)}.${dateIso.slice(5, 7)}.${dateIso.slice(0, 4)}`;
}
function jobNumber(runId: string, suffix: string): string {
  return `AUF-${runId}-P124A-${suffix}`;
}

test.describe("P1-24a Plantafel, day and month audit @AUDIT-W3-P1-24A @AUDIT-W3", () => {
  test("AUDIT-01 the board opens at each horizon with today, weekends, closure and team grouping @P1-24A-01", async ({ adminPage, world }) => {
    const employeeName = `${world.users.employee.firstName} ${world.users.employee.lastName}`;
    // Persons with a schedule plan without the "no schedule" warning; the closure day still zeroes its target.
    await giveEmployeesWorkSchedules({ organizationId: world.orgId, actorUserId: world.users.admin.id, validFrom: "2026-01-01", weekdayMinutes: 480, weekendMinutes: 0, note: "P1-24a audit" });
    await createTeamViaManagement(adminPage, `Team Plantafel ${world.runId}`);
    await addTeamMemberViaManagement(adminPage, { teamName: `Team Plantafel ${world.runId}`, employeeName });
    await addClosureDayViaSettings(adminPage, { dateDigits: dateDigits(CLOSURE), label: "Brückentag P1-24a" });
    await createJob(adminPage, { jobNumber: jobNumber(world.runId, "A"), title: `P1-24a Besuch A ${world.runId}` });
    await createJob(adminPage, { jobNumber: jobNumber(world.runId, "B"), title: `P1-24a Besuch B ${world.runId}` });
    await createJob(adminPage, { jobNumber: jobNumber(world.runId, "C"), title: `P1-24a Serie ${world.runId}` });
    await createPlannedCalendarEntry(adminPage, { kind: "job_visit", jobSearch: jobNumber(world.runId, "A"), date: DAY_A, time: "08:00", employeeNames: [employeeName], overrideReason: OVERRIDE_REASON });
    // A multi-day all-day visit without a person lands in „Ohne Zuweisung“.
    await createPlannedCalendarEntry(adminPage, { kind: "job_visit", jobSearch: jobNumber(world.runId, "B"), date: DAY_B, durationDays: 2, overrideReason: OVERRIDE_REASON });
    await createPlannedCalendarEntry(adminPage, { kind: "job_visit", jobSearch: jobNumber(world.runId, "C"), date: DAY_A, time: "13:00", employeeNames: [employeeName], recurrence: { frequency: "daily", count: 3 }, overrideReason: OVERRIDE_REASON });
    await createPlannedCalendarEntry(adminPage, { kind: "internal", internalTitle: `Teamrunde ${world.runId}`, internalType: "meeting", date: DAY_D, time: "10:00", employeeNames: [employeeName] });

    await openPlantafel(adminPage, DAY_A);
    await expect(adminPage.getByRole("tab", { name: "Plantafel", exact: true })).toHaveAttribute("data-state", "active");
    await expect(boardTeamHeader(adminPage, `Team Plantafel ${world.runId}`)).toBeVisible();
    await expect(plantafel(adminPage).getByRole("rowheader", { name: "Ohne Zuweisung" })).toBeVisible();
    await expect(boardCard(adminPage, "unassigned", `P1-24a Besuch B ${world.runId}`)).toBeVisible();
    // The closure day carries its label in the header; the weekend is shaded.
    await expect(boardColumn(adminPage, CLOSURE)).toContainText("Brückentag P1-24a");
    await expect(boardColumn(adminPage, SATURDAY)).toHaveClass(/bg-calendar-cell-off/);
    const employeeRecord = await getEmployeeRecordStateByUser(world.orgId, world.users.employee.id);
    await expect(boardCell(adminPage, employeeRecord.id, CLOSURE)).toHaveAttribute("aria-label", /Brückentag P1-24a|Betriebsruhe/);
    // Series marks, the internal entry, and capacity on the planned day.
    await expect(boardCard(adminPage, employeeRecord.id, `P1-24a Serie ${world.runId}`, DAY_A).getByRole("img", { name: "Serientermin" })).toBeVisible();
    await expect(boardCard(adminPage, employeeRecord.id, `Teamrunde ${world.runId}`)).toBeVisible();
    await expect(boardCell(adminPage, employeeRecord.id, DAY_A)).toHaveAttribute("data-capacity", /partial|full|overbooked/);

    for (const [option, weeks] of [["2 Wochen", "2"], ["4 Wochen", "4"], ["6 Wochen", "6"], ["1 Woche", "1"]] as const) {
      await adminPage.getByLabel("Horizont").click();
      await adminPage.getByRole("option", { name: option }).click();
      await expect(calendarViewReady(adminPage, "week")).toHaveAttribute("data-calendar-horizon", weeks, { timeout: 20_000 });
    }
    await expect(adminPage.getByRole("main").getByText(/KW \d+/)).toBeVisible();
  });

  test("AUDIT-02 every drop kind: reassign with refusal on an absence day, date move, bar edge, copy, park, unpark, note @P1-24A-02", async ({ adminPage, employeePage, world }) => {
    const employeeName = `${world.users.employee.firstName} ${world.users.employee.lastName}`;
    const bueroName = `${world.users.buero.firstName} ${world.users.buero.lastName}`;
    const employeeRecord = await getEmployeeRecordStateByUser(world.orgId, world.users.employee.id);
    const bueroRecord = await getEmployeeRecordStateByUser(world.orgId, world.users.buero.id);
    const titleA = `P1-24a Besuch A ${world.runId}`;
    // The employee reports sick for two days: a drop there is refused at the pointer.
    await reportOwnSicknessViaDialog(employeePage, { startDigits: dateDigits(ABSENCE_START), endDigits: dateDigits(ABSENCE_END) });
    const entriesBefore = await getOrganizationTimeEntryCount(world.orgId);

    await openPlantafel(adminPage, DAY_A);
    await expect(boardAbsenceBar(adminPage, employeeRecord.id, "Abwesend")).toBeVisible({ timeout: 20_000 });

    // Refusal at the pointer: the ghost turns red with the sentence, the release writes nothing.
    await dragCardTo(adminPage, boardCard(adminPage, employeeRecord.id, titleA), boardCell(adminPage, employeeRecord.id, ABSENCE_START), { release: false });
    await expect(dragGhost(adminPage)).toHaveAttribute("data-state", "refused");
    await expect(dragGhost(adminPage)).toContainText("abwesend");
    await adminPage.mouse.up();
    await expect(boardCard(adminPage, employeeRecord.id, titleA)).toBeVisible();
    expect(occurrenceLocalDate((await getPlanningState(world.orgId, { jobNumber: jobNumber(world.runId, "A") })).occurrences[0])).toBe(DAY_A);

    // Reassign to the Büro member, then move the date; the visit keeps 08:00.
    await dragCardTo(adminPage, boardCard(adminPage, employeeRecord.id, titleA), boardCell(adminPage, bueroRecord.id, DAY_A));
    await expect(successBanner(adminPage, `Termin wurde zu ${bueroName} verschoben.`)).toBeVisible({ timeout: 20_000 });
    await closeBanners(adminPage);
    await dragCardTo(adminPage, boardCard(adminPage, bueroRecord.id, titleA), boardCell(adminPage, bueroRecord.id, DAY_B));
    await expect(successBanner(adminPage, "verschoben")).toBeVisible({ timeout: 20_000 });
    await closeBanners(adminPage);
    await expect.poll(async () => occurrenceLocalDate((await getPlanningState(world.orgId, { jobNumber: jobNumber(world.runId, "A") })).occurrences[0]), { timeout: 20_000 }).toBe(DAY_B);
    await expect(boardCard(adminPage, bueroRecord.id, titleA)).toContainText("08:00");

    // Alt-copy onto the employee's Monday: a second occurrence of the same job.
    await dragCardTo(adminPage, boardCard(adminPage, bueroRecord.id, titleA), boardCell(adminPage, employeeRecord.id, DAY_A), { alt: true });
    await expect(successBanner(adminPage, "Kopie")).toBeVisible({ timeout: 20_000 });
    await closeBanners(adminPage);
    await expect.poll(async () => (await getPlanningState(world.orgId, { jobNumber: jobNumber(world.runId, "A") })).occurrenceCount, { timeout: 20_000 }).toBe(2);

    // The unassigned two-day bar grows by one day at its right edge.
    const bar = boardCard(adminPage, "unassigned", `P1-24a Besuch B ${world.runId}`);
    await dragHandleTo(adminPage, trailingResizeHandle(bar), boardCell(adminPage, "unassigned", DAY_D));
    await expect(successBanner(adminPage, "dauert jetzt bis")).toBeVisible({ timeout: 20_000 });
    await closeBanners(adminPage);
    await expect.poll(async () => (await getPlanningState(world.orgId, { jobNumber: jobNumber(world.runId, "B") })).occurrences[0]?.endDateExclusive, { timeout: 20_000 }).toBe(shiftIsoDate(DAY_D, 1));

    // A note in two clicks: the dialog opens preset as an all-day „Sonstiges“ entry.
    // Two weeks bring a free weekday into view; the action sits in the cell's corner above the card lanes.
    await adminPage.getByLabel("Horizont").click();
    await adminPage.getByRole("option", { name: "2 Wochen" }).click();
    await expect(calendarViewReady(adminPage, "week")).toHaveAttribute("data-calendar-horizon", "2", { timeout: 20_000 });
    const noteAction = boardCell(adminPage, employeeRecord.id, NOTE_DAY).getByRole("button", { name: new RegExp(`Notiz am .* für ${employeeName} anlegen`) });
    await noteAction.hover();
    await noteAction.click();
    const noteDialog = adminPage.getByRole("dialog").filter({ has: adminPage.getByRole("heading", { name: "Kalendereintrag erstellen" }) });
    await expect(noteDialog.getByRole("button", { name: "Interner Termin", pressed: true })).toBeVisible({ timeout: 20_000 });
    await noteDialog.getByLabel("Titel").fill(`Schlüssel abholen ${world.runId}`);
    await noteDialog.getByRole("button", { name: "Planung prüfen und speichern" }).click();
    await expect(noteDialog).toHaveCount(0, { timeout: 20_000 });
    await expect(boardCard(adminPage, employeeRecord.id, `Schlüssel abholen ${world.runId}`)).toBeVisible({ timeout: 20_000 });
    await expect(boardCard(adminPage, employeeRecord.id, `Schlüssel abholen ${world.runId}`).getByText("nicht gesendet", { exact: true })).toHaveCount(0);

    // Park by drag and unpark by drag: the card leaves, the dialog saves, the Parkplatz card returns onto a cell.
    await dragCardTo(adminPage, boardCard(adminPage, employeeRecord.id, titleA), parkplatzButton(adminPage));
    const parkDialog = adminPage.getByRole("dialog");
    await expect(parkDialog).toBeVisible({ timeout: 20_000 });
    await selectFromSearchable(adminPage, parkDialog.locator("#parking-reason"), "Kapazität");
    await selectFromSearchable(adminPage, parkDialog.locator("#parking-responsible"), world.users.admin.firstName);
    await typeIntoDatePickerById(parkDialog, "parking-review-date", CLOSURE);
    await parkDialog.getByRole("button", { name: "Kontext speichern", exact: true }).click();
    await expect(parkDialog).toHaveCount(0, { timeout: 20_000 });
    await closeBanners(adminPage);
    expect((await getParkingState(world.orgId, jobNumber(world.runId, "A"))).context?.reason).toBe("capacity");
    await parkplatzButton(adminPage).click();
    const parkedCard = parkplatzCardOf(adminPage, titleA);
    await expect(parkedCard).toBeVisible({ timeout: 20_000 });
    await dragCardTo(adminPage, parkedCard, boardCell(adminPage, employeeRecord.id, DAY_B));
    await expect(successBanner(adminPage, "eingeplant")).toBeVisible({ timeout: 20_000 });
    await closeBanners(adminPage);
    await expect.poll(async () => (await getParkingState(world.orgId, jobNumber(world.runId, "A"))).eventTypes, { timeout: 20_000 }).toContain("unparked");

    // No side effect: no time entry and no dispatch came from the board.
    expect(await getOrganizationTimeEntryCount(world.orgId)).toBe(entriesBefore);
    expect((await getVisibleDispatchStateAs(world.users.employee, world.orgId)).planning_dispatches).toBe(0);
  });

  test("AUDIT-03 keyboard and form paths, filters, search, read-only and persistence @P1-24A-03", async ({ adminPage, world }) => {
    const employeeRecord = await getEmployeeRecordStateByUser(world.orgId, world.users.employee.id);
    const bueroName = `${world.users.buero.firstName} ${world.users.buero.lastName}`;
    const titleSeries = `P1-24a Serie ${world.runId}`;
    await openPlantafel(adminPage, DAY_A);
    await boardCard(adminPage, employeeRecord.id, titleSeries, DAY_A).focus();
    await adminPage.keyboard.press("Enter");
    const popover = jobPopover(adminPage);
    await expect(popover).toBeVisible();
    await expect(popover.getByRole("button", { name: "Termin bearbeiten" })).toBeVisible();
    await popover.getByRole("button", { name: "Verschieben …" }).click();
    await selectFromSearchable(adminPage, popover.locator("#popover-move-person"), bueroName);
    await popover.getByRole("button", { name: "Verschieben", exact: true }).click();
    await expect(successBanner(adminPage, `Termin wurde zu ${bueroName} verschoben.`)).toBeVisible({ timeout: 20_000 });
    await closeBanners(adminPage);

    // Search narrows the cards; the filter popover holds the team, dispatch and conflict filters.
    await adminPage.getByLabel("Plantafel durchsuchen").fill("Teamrunde");
    await expect(boardRows(adminPage).locator("[data-calendar-card]").filter({ hasText: titleSeries })).toHaveCount(0);
    await expect(boardRows(adminPage).locator("[data-calendar-card]").filter({ hasText: "Teamrunde" })).toHaveCount(1);
    await adminPage.getByLabel("Plantafel durchsuchen").fill("");
    await adminPage.getByRole("button", { name: /^Filter/ }).click();
    await adminPage.getByRole("checkbox", { name: "Nur Konflikte" }).check();
    await adminPage.keyboard.press("Escape");
    await expect(adminPage.getByRole("button", { name: /^Filter, 1 aktiv/ })).toBeVisible();
    await adminPage.getByRole("button", { name: /^Filter/ }).click();
    await adminPage.getByRole("checkbox", { name: "Nur Konflikte" }).uncheck();
    await adminPage.keyboard.press("Escape");

    // Density and read-only persist across a reload; keyboard shortcuts move the window and switch views.
    await adminPage.getByRole("button", { name: /Kompakt anzeigen/ }).click();
    await adminPage.getByRole("button", { name: "Nur ansehen" }).click();
    await adminPage.getByRole("button", { name: "Tastenkürzel anzeigen" }).click();
    await expect(adminPage.getByRole("dialog", { name: "Tastenkürzel" })).toBeVisible();
    await adminPage.keyboard.press("Escape");
    // The save is debounced; the stored row is the proof of persistence before the reload.
    await expect.poll(async () => {
      const stored = await getCalendarPreferencesFor(world.orgId, world.users.admin.id);
      return `${stored?.density}/${stored?.readOnly}`;
    }, { timeout: 10_000 }).toBe("compact/true");
    await openPlantafel(adminPage, DAY_A);
    await expect(plantafel(adminPage)).toHaveAttribute("data-density", "compact");
    await expect(adminPage.getByRole("button", { name: "Nur ansehen" })).toHaveAttribute("aria-pressed", "true");
    await adminPage.getByRole("button", { name: "Nur ansehen" }).click();
    await adminPage.getByRole("button", { name: /Komfortabel anzeigen/ }).click();
    // The shortcuts move by the horizon; the persisted two weeks become one for a one-week step.
    await adminPage.getByLabel("Horizont").click();
    await adminPage.getByRole("option", { name: "1 Woche" }).click();
    await expect(calendarViewReady(adminPage, "week")).toHaveAttribute("data-calendar-horizon", "1", { timeout: 20_000 });
    await adminPage.keyboard.press("j");
    await expect(boardColumn(adminPage, shiftIsoDate(MONDAY, 7))).toBeVisible({ timeout: 20_000 });
    await adminPage.keyboard.press("k");
    await expect(boardColumn(adminPage, MONDAY)).toBeVisible({ timeout: 20_000 });
    await adminPage.keyboard.press("d");
    await expect(calendarViewReady(adminPage, "day")).toBeVisible({ timeout: 20_000 });
    await adminPage.keyboard.press("w");
    await expect(calendarViewReady(adminPage, "week")).toBeVisible({ timeout: 20_000 });
    // The last preference burst (read-only off, comfortable, one week, week view) must land before the next test navigates.
    await expect.poll(async () => { const stored = await getCalendarPreferencesFor(world.orgId, world.users.admin.id); return `${stored?.readOnly}/${stored?.view}`; }, { timeout: 10_000 }).toBe("false/week");
  });

  test("AUDIT-04 the day view: lanes, drag-to-create, resize, and the refusal past midnight @P1-24A-04", async ({ adminPage, world }) => {
    const employeeName = `${world.users.employee.firstName} ${world.users.employee.lastName}`;
    await openCalendarView(adminPage, DAY_A, "day", "Tag");
    const row = dayRow(adminPage, world.users.employee.id);
    await expect(row).toBeVisible();
    // AUDIT-02 moved and copied visits between rows; the series card is addressed wherever it sits.
    const seriesCard = dayCard(adminPage.getByRole("main").locator("[data-day-view]"), `P1-24a Serie ${world.runId}`);
    await expect(seriesCard).toBeVisible();
    // Drag-to-create on empty time opens the dialog with the person preset.
    await dragToCreateOnDayRow(adminPage, dayTimeline(row), 15.1, 16.6);
    const dialog = adminPage.getByRole("dialog").filter({ has: adminPage.getByRole("heading", { name: "Kalendereintrag erstellen" }) });
    await expect(dialog).toBeVisible({ timeout: 20_000 });
    await expect(dialog.locator("#planning-date")).toBeVisible({ timeout: 15_000 });
    // The multi-select summarises its selection; the opened list (a body portal) names the preset person.
    await expect(dialog.getByRole("combobox", { name: "Mitarbeiter" })).toHaveText("1 Mitarbeiter");
    await dialog.getByRole("combobox", { name: "Mitarbeiter" }).click();
    await expect(adminPage.getByRole("option", { name: employeeName, selected: true })).toBeVisible({ timeout: 10_000 });
    await adminPage.keyboard.press("Escape");
    await expect(adminPage.getByRole("listbox")).toHaveCount(0);
    await adminPage.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);

    // Resize the series visit by its end handle: the write settles with the sentence.
    const timelineBox = await dayTimeline(row).boundingBox();
    if (!timelineBox) throw new Error("The day timeline has no layout.");
    await dragHandleBy(adminPage, trailingResizeHandle(seriesCard), timelineBox.width / 24);
    await expect(successBanner(adminPage, "Termin dauert jetzt")).toBeVisible({ timeout: 20_000 });
    await closeBanners(adminPage);

    // A drop that would end past midnight is refused at the pointer and writes nothing.
    const cardBox = await seriesCard.boundingBox();
    if (!cardBox) throw new Error("The visit card has no layout.");
    await beginCardDragToPoint(adminPage, seriesCard, { x: timelineBox.x + timelineBox.width - 4, y: cardBox.y + cardBox.height / 2 });
    await expect(dragGhost(adminPage)).toContainText("über Mitternacht");
    await adminPage.mouse.up();
    await expect(banners(adminPage)).toHaveCount(0);
  });

  test("AUDIT-05 the month view: bars, „+n mehr“, past days, a date move and the popover @P1-24A-05", async ({ adminPage, world }) => {
    const employeeName = `${world.users.employee.firstName} ${world.users.employee.lastName}`;
    for (const index of [1, 2, 3, 4]) {
      await createJob(adminPage, { jobNumber: jobNumber(world.runId, `M${index}`), title: `P1-24a Monat ${index} ${world.runId}` });
      await createPlannedCalendarEntry(adminPage, { kind: "job_visit", jobSearch: jobNumber(world.runId, `M${index}`), date: CLOSURE, time: `${String(8 + index).padStart(2, "0")}:00`, employeeNames: [employeeName], overrideReason: OVERRIDE_REASON });
    }
    await openCalendarView(adminPage, DAY_A, "month", "Monat");
    await expect(calendarHolidayLabel(adminPage, "Brückentag P1-24a")).toBeVisible();
    await expect(calendarAbsenceBarStarting(adminPage, ABSENCE_START, employeeName)).toBeVisible();
    await expect(monthCards(monthDay(adminPage, CLOSURE))).toHaveCount(3);
    await monthDay(adminPage, CLOSURE).getByRole("button", { name: /\+\d+ mehr/ }).click();
    await expect(monthCards(monthDayPopover(adminPage, CLOSURE), "P1-24a Monat")).toHaveCount(4);
    await adminPage.keyboard.press("Escape");
    await expect(inMonthCells(adminPage)).toHaveCount(new Date(Date.UTC(Number(CLOSURE.slice(0, 4)), Number(CLOSURE.slice(5, 7)), 0)).getUTCDate());

    // Move one visit to a free day of the next week by drag; the card lands at once and the state follows.
    await dragCardTo(adminPage, monthCards(monthDay(adminPage, CLOSURE), `P1-24a Monat 1 ${world.runId}`), monthCell(adminPage, MOVE_DAY));
    await expect(monthCards(monthDay(adminPage, MOVE_DAY), `P1-24a Monat 1 ${world.runId}`)).toBeVisible({ timeout: 1_000 });
    await expect(successBanner(adminPage, "verschoben")).toBeVisible({ timeout: 20_000 });
    await closeBanners(adminPage);
    await expect.poll(async () => occurrenceLocalDate((await getPlanningState(world.orgId, { jobNumber: jobNumber(world.runId, "M1") })).occurrences[0]), { timeout: 20_000 }).toBe(MOVE_DAY);
    // The card popover opens beside the card in the month too.
    await monthCards(monthDay(adminPage, MOVE_DAY), `P1-24a Monat 1 ${world.runId}`).click();
    await expect(jobPopover(adminPage).getByRole("button", { name: "Details anzeigen" })).toBeVisible();
    await adminPage.keyboard.press("Escape");
    await removeClosureDayViaSettings(adminPage, germanDate(CLOSURE));
  });

  test("AUDIT-06 the employee's week, organization isolation of the board read, and the outsider @P1-24A-06", async ({ employeePage, outsiderPage, world }) => {
    await employeePage.goto(`/kalender?date=${DAY_A}`);
    await employeePage.getByRole("tab", { name: "Woche", exact: true }).click();
    await expect(calendarViewReady(employeePage, "week")).toBeVisible({ timeout: 30_000 });
    await expect(boardRows(employeePage)).toHaveCount(1);
    await expect(employeePage.getByRole("button", { name: "Nur ansehen" })).toHaveCount(0);
    await expect(textInDom(employeePage, `${world.users.buero.firstName} ${world.users.buero.lastName}`)).toHaveCount(0);
    const own = await employeePage.request.get(`/api/calendar-board?organizationId=${world.orgId}&fromDate=${DAY_A}&toDate=${SATURDAY}`);
    expect(own.status()).toBe(200);
    const ownBody = await own.json() as { rows: Array<{ userId: string | null }> };
    expect(ownBody.rows.map((row) => row.userId)).toEqual([world.users.employee.id]);
    const foreign = await outsiderPage.request.get(`/api/calendar-board?organizationId=${world.orgId}&fromDate=${DAY_A}&toDate=${SATURDAY}`);
    expect(foreign.status()).toBe(403);
  });
});

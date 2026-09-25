import { expect, test } from "./support/fixtures";
import { getCalendarPreferencesFor, getPlanningState, getVisiblePlanningStateAs, occurrenceLocalDate } from "./support/db/calendar";
import { getDispatchState, getParkingState } from "./support/db/dispatch";
import { getEmployeeRecordStateByUser, giveEmployeesWorkSchedules } from "./support/db/personnel";
import { expectLiveWithin } from "./support/live";
import {
  boardCard,
  boardCell,
  boardRows,
  calendarViewReady,
  closeBanners,
  dragCardTo,
  openPlantafel,
  parkplatzButton,
  parkplatzCardOf,
  successBanner,
} from "./support/plantafel";
import { createPlannedCalendarEntry } from "./support/steps/calendar";
import { acknowledgeDispatchOnJobPage, issueDispatchForOccurrence, openDispatchPanel } from "./support/steps/dispatch";
import { selectFromSearchable, textInDom, typeIntoDatePickerById } from "./support/steps/shared";
import { createJob } from "./support/steps/work";

// P1-24a: one journey across the Plantafel. A manager plans a visit, moves it
// to another person by drag (optimistic, then confirmed with Undo), a second
// session sees a date move live, the dispatch state reaches the card, a park
// by drag opens the context dialog and the card returns through „Einplanen
// am …“, read-only mode refuses a drag with its sentence, the horizon is
// remembered per user, and the employee sees only the own row.

const TODAY_ISO = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Berlin", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());

function shiftIsoDate(dateIso: string, days: number): string {
  const [year, month, day] = dateIso.split("-").map(Number);
  if (year === undefined || month === undefined || day === undefined) throw new Error(`Invalid ISO date: ${dateIso}`);
  return new Date(Date.UTC(year, month - 1, day) + days * 86_400_000).toISOString().slice(0, 10);
}

/** The Monday of the week that holds `dateIso`, so a board week is addressed by its anchor. */
function mondayOf(dateIso: string): string {
  const weekday = (new Date(`${dateIso}T00:00:00Z`).getUTCDay() + 6) % 7;
  return shiftIsoDate(dateIso, -weekday);
}

// P1-24a owns the Tuesday and Wednesday of the week two weeks out at 08:00
// Berlin: beyond P1-12's +3..+10 window, before P1-11's next-month planning date.
const VISIT_DATE = shiftIsoDate(mondayOf(shiftIsoDate(TODAY_ISO, 14)), 1);
const MOVED_DATE = shiftIsoDate(VISIT_DATE, 1);
const OVERRIDE_REASON = "Betrieblich abgestimmter P1-24a Einsatz.";

function jobNumber(runId: string): string {
  return `AUF-${runId}-P124A`;
}
function jobTitle(runId: string): string {
  return `P1-24a Plantafel ${runId}`;
}

test.describe("P1-24a Plantafel journey @P1-24a", () => {
  test("a manager lands on the Plantafel and reassigns a visit by drag, then undoes it", async ({ adminPage, world }) => {
    const employeeName = `${world.users.employee.firstName} ${world.users.employee.lastName}`;
    const title = jobTitle(world.runId);
    // Persons with a schedule plan without the "no schedule" warning, so drops stay optimistic.
    await giveEmployeesWorkSchedules({ organizationId: world.orgId, actorUserId: world.users.admin.id, validFrom: "2026-01-01", weekdayMinutes: 480, weekendMinutes: 0, note: "P1-24a journey" });
    await createJob(adminPage, { jobNumber: jobNumber(world.runId), title });
    await createPlannedCalendarEntry(adminPage, {
      kind: "job_visit",
      jobSearch: jobNumber(world.runId),
      date: VISIT_DATE,
      time: "08:00",
      employeeNames: [employeeName],
      overrideReason: OVERRIDE_REASON,
    });
    const employeeRecord = await getEmployeeRecordStateByUser(world.orgId, world.users.employee.id);
    const bueroRecord = await getEmployeeRecordStateByUser(world.orgId, world.users.buero.id);

    await openPlantafel(adminPage, VISIT_DATE);
    await expect(adminPage.getByRole("tab", { name: "Plantafel", exact: true })).toHaveAttribute("data-state", "active");
    const card = boardCard(adminPage, employeeRecord.id, title);
    await expect(card).toBeVisible({ timeout: 20_000 });
    await expect(card.getByText("nicht gesendet", { exact: true })).toBeVisible();

    // Reassign to the Büro member: the card is in the target row before the
    // server answers, the banner confirms with Undo, the assignment changed.
    await dragCardTo(adminPage, card, boardCell(adminPage, bueroRecord.id, VISIT_DATE));
    await expect(boardCard(adminPage, bueroRecord.id, title)).toBeVisible({ timeout: 1_000 });
    const banner = successBanner(adminPage, "verschoben");
    await expect(banner).toBeVisible({ timeout: 20_000 });
    await expect(banner.getByRole("button", { name: "Rückgängig", exact: true })).toBeVisible();
    const employeeView = await getVisiblePlanningStateAs(world.users.employee, world.orgId);
    expect(employeeView.planning_occurrences).toBe(0);

    await banner.getByRole("button", { name: "Rückgängig", exact: true }).click();
    await expect(boardCard(adminPage, employeeRecord.id, title)).toBeVisible({ timeout: 20_000 });
    await expect(successBanner(adminPage, "Rückgängig war nicht möglich")).toHaveCount(0);
    await expect.poll(async () => (await getVisiblePlanningStateAs(world.users.employee, world.orgId)).planning_occurrences, { timeout: 20_000 }).toBe(1);
    await closeBanners(adminPage);
  });

  test("a second session sees a date move live and the dispatch state reaches the card", async ({ adminPage, bueroPage, employeePage, world }) => {
    const title = jobTitle(world.runId);
    const employeeRecord = await getEmployeeRecordStateByUser(world.orgId, world.users.employee.id);
    await openPlantafel(adminPage, VISIT_DATE);
    await openPlantafel(bueroPage, VISIT_DATE);
    // The observing session's card under the moved date is absent until the move lands.
    await expectLiveWithin(boardCard(bueroPage, employeeRecord.id, title, MOVED_DATE), {
      label: "P1-24a board date move reaches a second session",
      actingPage: adminPage,
      mutation: async (beforeSubmit) => {
        await dragCardTo(adminPage, boardCard(adminPage, employeeRecord.id, title), boardCell(adminPage, employeeRecord.id, MOVED_DATE), { release: false });
        await beforeSubmit();
        await adminPage.mouse.up();
      },
    });
    await expect(successBanner(adminPage, "verschoben")).toBeVisible({ timeout: 20_000 });
    await closeBanners(adminPage);
    await expect.poll(async () => occurrenceLocalDate((await getPlanningState(world.orgId, { jobNumber: jobNumber(world.runId) })).occurrences[0]), { timeout: 20_000 }).toBe(MOVED_DATE);

    // Dispatch: the chip follows the recipient's state.
    await openDispatchPanel(adminPage);
    await issueDispatchForOccurrence(adminPage, title);
    await openPlantafel(adminPage, VISIT_DATE);
    await expect(boardCard(adminPage, employeeRecord.id, title).getByText("gesendet", { exact: true })).toBeVisible({ timeout: 20_000 });
    await acknowledgeDispatchOnJobPage(employeePage, jobNumber(world.runId));
    await expect(boardCard(adminPage, employeeRecord.id, title).getByText("bestätigt", { exact: true })).toBeVisible({ timeout: 20_000 });
    const dispatch = await getDispatchState(world.orgId, jobNumber(world.runId));
    expect(dispatch.dispatches).toHaveLength(1);
  });

  test("a park by drag opens the context dialog, cancelling restores the card, saving parks it, and „Einplanen am …“ brings it back", async ({ adminPage, world }) => {
    const title = jobTitle(world.runId);
    const employeeRecord = await getEmployeeRecordStateByUser(world.orgId, world.users.employee.id);
    await openPlantafel(adminPage, VISIT_DATE);
    await expect(boardCard(adminPage, employeeRecord.id, title)).toBeVisible({ timeout: 20_000 });

    // Cancel: the card left the grid on the drop and comes back on cancel.
    await dragCardTo(adminPage, boardCard(adminPage, employeeRecord.id, title), parkplatzButton(adminPage));
    const dialog = adminPage.getByRole("dialog");
    await expect(dialog).toBeVisible({ timeout: 20_000 });
    await expect(boardCard(adminPage, employeeRecord.id, title)).toHaveCount(0);
    await dialog.getByRole("button", { name: "Abbrechen", exact: true }).click();
    await expect(boardCard(adminPage, employeeRecord.id, title)).toBeVisible({ timeout: 20_000 });

    // Save: the parked job carries its context and the board no longer shows it.
    await dragCardTo(adminPage, boardCard(adminPage, employeeRecord.id, title), parkplatzButton(adminPage));
    await expect(dialog).toBeVisible({ timeout: 20_000 });
    // The Parkplatz context (P1-14): reason, note, responsible person and review date.
    await selectFromSearchable(adminPage, dialog.locator("#parking-reason"), "Kapazität");
    await dialog.locator("#parking-note").fill("Plantafel-Parkplatz im Journey.");
    await selectFromSearchable(adminPage, dialog.locator("#parking-responsible"), world.users.admin.firstName);
    await typeIntoDatePickerById(dialog, "parking-review-date", shiftIsoDate(MOVED_DATE, 2));
    await dialog.getByRole("button", { name: "Kontext speichern", exact: true }).click();
    await expect(dialog).toHaveCount(0, { timeout: 20_000 });
    await expect(successBanner(adminPage, "Auftrag wurde geparkt.")).toBeVisible({ timeout: 20_000 });
    await closeBanners(adminPage);
    const parked = await getParkingState(world.orgId, jobNumber(world.runId));
    expect(parked.context?.reason).toBe("capacity");

    // Back onto the board through the keyboard route of the Parkplatz card.
    await parkplatzButton(adminPage).click();
    const parkedCard = parkplatzCardOf(adminPage, title);
    await expect(parkedCard).toBeVisible({ timeout: 20_000 });
    await parkedCard.getByRole("button", { name: `${title} einplanen` }).click();
    const schedule = adminPage.getByRole("dialog").filter({ has: adminPage.getByRole("heading", { name: "Auftrag einplanen" }) });
    await typeIntoDatePickerById(schedule, "schedule-parked-date", VISIT_DATE);
    await schedule.getByRole("button", { name: "Einplanen", exact: true }).click();
    await expect(schedule).toHaveCount(0, { timeout: 20_000 });
    await expect(successBanner(adminPage, "eingeplant")).toBeVisible({ timeout: 20_000 });
    await closeBanners(adminPage);
    await expect.poll(async () => (await getParkingState(world.orgId, jobNumber(world.runId))).eventTypes, { timeout: 20_000 }).toContain("unparked");
    // The re-planned visit has no person yet; the cancelled occurrence stays struck through in Emil's row.
    await expect(boardCard(adminPage, "unassigned", title)).toBeVisible({ timeout: 20_000 });
  });

  test("read-only mode refuses a drag with its sentence and the horizon is remembered per user", async ({ adminPage, world }) => {
    const title = jobTitle(world.runId);
    const bueroRecord = await getEmployeeRecordStateByUser(world.orgId, world.users.buero.id);
    await openPlantafel(adminPage, VISIT_DATE);
    await adminPage.getByRole("button", { name: "Nur ansehen" }).click();
    await expect(adminPage.getByRole("button", { name: "Nur ansehen" })).toHaveAttribute("aria-pressed", "true");
    // The engine refuses at the press and shows the sentence for four seconds; the gesture then goes nowhere.
    const lockedCard = await boardCard(adminPage, "unassigned", title).boundingBox();
    if (!lockedCard) throw new Error("The card has no layout.");
    await adminPage.mouse.move(lockedCard.x + 20, lockedCard.y + lockedCard.height / 2);
    await adminPage.mouse.down();
    await expect(adminPage.getByRole("status").filter({ hasText: "Nur ansehen" })).toBeVisible();
    const target = await boardCell(adminPage, bueroRecord.id, VISIT_DATE).boundingBox();
    if (!target) throw new Error("The target cell has no layout.");
    await adminPage.mouse.move(target.x + target.width / 2, target.y + target.height / 2, { steps: 8 });
    await adminPage.mouse.up();
    await expect(boardCard(adminPage, "unassigned", title)).toBeVisible();
    await expect(boardCard(adminPage, bueroRecord.id, title)).toHaveCount(0);
    await adminPage.getByLabel("Horizont").click();
    await adminPage.getByRole("option", { name: "2 Wochen" }).click();
    await expect(calendarViewReady(adminPage, "week")).toHaveAttribute("data-calendar-horizon", "2", { timeout: 20_000 });
    // The save is debounced; the stored row is the proof of persistence before the reload.
    await expect.poll(async () => (await getCalendarPreferencesFor(world.orgId, world.users.admin.id))?.horizonWeeks, { timeout: 10_000 }).toBe(2);

    await openPlantafel(adminPage, VISIT_DATE);
    await expect(calendarViewReady(adminPage, "week")).toHaveAttribute("data-calendar-horizon", "2");
    await expect(adminPage.getByRole("button", { name: "Nur ansehen" })).toHaveAttribute("aria-pressed", "true");
    await adminPage.getByRole("button", { name: "Nur ansehen" }).click();
    await adminPage.getByLabel("Horizont").click();
    await adminPage.getByRole("option", { name: "1 Woche" }).click();
    await expect(calendarViewReady(adminPage, "week")).toHaveAttribute("data-calendar-horizon", "1", { timeout: 20_000 });
    // The last burst lands before the next test navigates away from the debounced save.
    await expect.poll(async () => {
      const stored = await getCalendarPreferencesFor(world.orgId, world.users.admin.id);
      return `${stored?.readOnly}/${stored?.horizonWeeks}`;
    }, { timeout: 10_000 }).toBe("false/1");
  });

  test("the employee sees the week as their own row only", async ({ adminPage, employeePage, world }) => {
    const title = jobTitle(world.runId);
    const employeeRecord = await getEmployeeRecordStateByUser(world.orgId, world.users.employee.id);
    // The re-planned visit has no person yet; the manager gives it back to Emil by drag. The cancelled
    // original of the park stays readable for its former assignee, so the proof is the count growing by one.
    const visibleBefore = (await getVisiblePlanningStateAs(world.users.employee, world.orgId)).planning_occurrences;
    await openPlantafel(adminPage, VISIT_DATE);
    await dragCardTo(adminPage, boardCard(adminPage, "unassigned", title), boardCell(adminPage, employeeRecord.id, VISIT_DATE));
    await expect(successBanner(adminPage, "verschoben")).toBeVisible({ timeout: 20_000 });
    await closeBanners(adminPage);
    await expect.poll(async () => (await getVisiblePlanningStateAs(world.users.employee, world.orgId)).planning_occurrences, { timeout: 20_000 }).toBe(visibleBefore + 1);
    await employeePage.goto(`/kalender?date=${VISIT_DATE}`);
    await employeePage.getByRole("tab", { name: "Woche", exact: true }).click();
    await expect(calendarViewReady(employeePage, "week")).toBeVisible({ timeout: 30_000 });
    await expect(boardRows(employeePage)).toHaveCount(1);
    // The cancelled original of the park stays as a dimmed „Abgesagt“ card (F05); the re-planned visit is the active one.
    await expect(boardRows(employeePage).locator("[data-calendar-card]").filter({ hasText: title }).filter({ hasNotText: "Abgesagt" })).toBeVisible();
    await expect(employeePage.getByRole("button", { name: "Nur ansehen" })).toHaveCount(0);
    await expect(textInDom(employeePage, `${world.users.buero.firstName} ${world.users.buero.lastName}`)).toHaveCount(0);
  });
});

import { expect, test } from "../support/fixtures";
import { submitMissedTime } from "../support/time-corrections";
import { calendarClosure, calendarCorrectionBlock, calendarReady, correctionRequestCard, realtimeSubscribed } from "../support/performance-steps";
import { showPlanningMonth } from "../../golden/support/steps/calendar";
import { addClosureDayViaSettings, removeClosureDayViaSettings } from "../../golden/support/steps/personnel";
import { expectCalendarChangeWithin } from "../support/calendar-live";
import { ownedBerlinDateAtOffset } from "../../golden/support/date-ownership";
import { getTimeCorrectionState } from "../../golden/support/db/time-tracking";

const closureDate = ownedBerlinDateAtOffset("performance-calendar-live", 130);
// Worked-time projections deliberately exclude future timestamps.
const correctionDate = ownedBerlinDateAtOffset("performance-calendar-live", -7);

test.describe("Already-open calendar updates @AUDIT-PERFORMANCE-LIVE", () => {
  test("closure creation and removal reach the already-open calendar @FRESHNESS @AUDIT-PERFORMANCE-LIVE-CLOSURE", async ({ adminPage, bueroPage, world }) => {
    const label = `Betriebsruhe Aktualisierung ${world.runId}`;
    const [year, month, day] = closureDate.split("-");
    await showPlanningMonth(bueroPage, closureDate);
    await expect(calendarReady(bueroPage, "month")).toBeVisible();
    await expect(realtimeSubscribed(bueroPage)).toBeAttached();
    const visibleClosure = calendarClosure(bueroPage, label);
    await expect(visibleClosure).toHaveCount(0);
    await expectCalendarChangeWithin(visibleClosure, {
      state: "visible", receiverReady: calendarReady(bueroPage, "month"),
      label: "calendar closure appears in the already-open office month",
      mutation: (beforeSubmit) => addClosureDayViaSettings(adminPage, { dateDigits: `${day}${month}${year}`, label, beforeSubmit }),
    });
    await expectCalendarChangeWithin(visibleClosure, {
      state: "absent",
      label: "calendar closure disappears from the already-open office month",
      receiverReady: calendarReady(bueroPage, "month"),
      mutation: (beforeSubmit) => removeClosureDayViaSettings(adminPage, `${day}.${month}.${year}`, beforeSubmit),
    });
    await expect(visibleClosure).toHaveCount(0);
  });

  test("a provisional correction appears and withdrawal removes it without receiver navigation @FRESHNESS @READINESS @AUDIT-PERFORMANCE-LIVE-CORRECTION", async ({ adminPage, employeePage, world }) => {
    const reason = `Kalender-Korrektur Aktualisierung ${world.runId}`;
    const personName = world.users.employee.firstName;
    await showPlanningMonth(adminPage, correctionDate);
    await adminPage.getByRole("checkbox", { name: "Arbeitszeiten", exact: true }).check();
    await expect(adminPage.getByRole("checkbox", { name: "Arbeitszeiten", exact: true })).toBeChecked();
    await expect(calendarReady(adminPage, "month")).toBeVisible();
    await expect(realtimeSubscribed(adminPage)).toBeAttached();
    const block = calendarCorrectionBlock(adminPage, correctionDate, personName);
    await expect(block).toHaveCount(0);
    await expectCalendarChangeWithin(block, {
      state: "visible", receiverReady: calendarReady(adminPage, "month"),
      label: "provisional correction appears in the already-open manager month",
      mutation: (beforeSubmit) => submitMissedTime(employeePage, { date: correctionDate, reason, beforeSubmit }),
    });
    const submitted = await getTimeCorrectionState(world.orgId);
    const revision = submitted.revisions.find((entry) => entry.reason === reason);
    const request = submitted.requests.find((entry) => entry.id === revision?.request_id);
    expect(request?.status).toBe("submitted");
    if (!request) throw new Error("The measured correction must have its exact persisted request.");
    const withdraw = correctionRequestCard(employeePage, request.id).getByRole("button", { name: "Zurückziehen", exact: true });
    await expect(withdraw).toBeVisible();
    await expect(withdraw).toBeEnabled();
    await expectCalendarChangeWithin(block, {
      state: "absent",
      label: "withdrawn correction disappears from the already-open manager month",
      receiverReady: calendarReady(adminPage, "month"),
      mutation: async (beforeSubmit) => { await beforeSubmit(); await withdraw.click(); },
    });
    const withdrawn = await getTimeCorrectionState(world.orgId);
    expect(withdrawn.requests.find((entry) => entry.id === request.id)?.status).toBe("withdrawn");
    expect(withdrawn.applications.filter((entry) => entry.request_id === request.id)).toHaveLength(0);
    await expect(block).toHaveCount(0);
  });
});

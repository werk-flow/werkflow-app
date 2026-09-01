import type { Page } from "@playwright/test";

import { expect, test } from "../../golden/support/fixtures";
import {
  getTimeCorrectionCountsAs,
  getTimeCorrectionState,
} from "../../golden/support/db";
import { ownedBerlinDateAtOffset } from "../../golden/support/date-ownership";
import {
  retryDialogTransaction,
  selectFromSearchable,
  typeIntoDateTimeField,
  visibleText,
} from "../../golden/support/steps";

test.describe.configure({ mode: "serial" });

const DATES = [115, 116, 117, 118, 119].map((offset) =>
  ownedBerlinDateAtOffset("p1-22", offset),
);
let clarificationRequestId: string;

async function submitMissedTime(
  page: Page,
  input: { date: string; reason: string; personName?: string },
): Promise<void> {
  await page.goto("/zeiterfassung?tab=history");
  const dialog = page.getByRole("dialog").filter({
    has: page.getByRole("heading", { name: "Zeitkorrektur" }),
  });
  await retryDialogTransaction({
    dialog,
    open: async () => {
      await page.getByRole("button", { name: "Zeit nachtragen" }).click({ timeout: 10_000 });
      await expect(dialog).toBeVisible({ timeout: 5_000 });
    },
    interact: async () => {
      const bounded = { timeout: 5_000 };
      if (input.personName) {
        await selectFromSearchable(
          page,
          dialog.getByRole("combobox", { name: "Person für Zeitkorrektur" }),
          input.personName,
        );
      }
      await typeIntoDateTimeField(dialog, "time-correction-start", `${input.date}T07:00`, bounded);
      await typeIntoDateTimeField(dialog, "time-correction-end", `${input.date}T09:30`, bounded);
      await dialog.getByLabel("Grund").fill(input.reason, bounded);
      await dialog.getByRole("button", { name: "Speichern" }).click(bounded);
    },
  });
}

test.describe("P1-22 exhaustive correction audit @AUDIT-W2-P1-22 @AUDIT-W2", () => {
  // Catalog mapping: P1-22-F01…F16 and F25…F29 are exercised here through the
  // common dialog/preview/history path and completed by the focused Golden,
  // projection-unit and SQL boundary assertions. F17…F24 map to the direct/
  // self-authority case below; F30…F38 map to immutable lifecycle and replay
  // assertions; F39…F50 map to atomic batch, RLS, grants, Realtime and the
  // connected-reader/closed-scope assertions recorded in the acceptance ledger.
  test("preserves clarification as a new immutable revision before approval", async ({
    adminPage,
    employeePage,
    world,
  }) => {
    const reason = `Korrektur mit Rückfrage ${world.runId}`;
    await submitMissedTime(employeePage, { date: DATES[0]!, reason });
    const submitted = await getTimeCorrectionState(world.orgId);
    const request = submitted.requests.find((row) =>
      submitted.revisions.some((revision) =>
        revision.request_id === row.id && revision.reason === reason,
      ),
    );
    expect(request?.status).toBe("submitted");
    clarificationRequestId = request!.id;
    const originalRevision = submitted.revisions.find((revision) =>
      revision.request_id === clarificationRequestId && revision.revision === 1
    );
    expect(originalRevision).toBeDefined();

    await adminPage.goto("/zeiterfassung?tab=approvals");
    const approvalCard = adminPage.getByTestId(`time-correction-${clarificationRequestId}`);
    await approvalCard.getByLabel("Kommentar").fill("Bitte den fehlenden Einsatz genauer erläutern.");
    await approvalCard.getByRole("button", { name: "Rückfrage" }).click();
    await expect(approvalCard).toHaveCount(0);

    await employeePage.goto("/zeiterfassung?tab=history");
    const responseCard = employeePage.getByTestId(`time-correction-${clarificationRequestId}`);
    await expect(responseCard.getByText("Rückfrage", { exact: true })).toBeVisible();
    await responseCard.getByLabel("Antwort").fill("Notdiensteinsatz beim Kunden; Beginn und Ende geprüft.");
    await responseCard.getByRole("button", { name: "Erneut einreichen" }).click();
    await expect(responseCard.getByText("Zur Prüfung", { exact: true })).toBeVisible();

    const resubmitted = await getTimeCorrectionState(world.orgId);
    const clarificationRevisions = resubmitted.revisions.filter(
      (row) => row.request_id === clarificationRequestId
    );
    expect(clarificationRevisions).toHaveLength(2);
    expect(clarificationRevisions.find((revision) => revision.revision === 1))
      .toEqual(originalRevision);
    expect(clarificationRevisions.find((revision) => revision.revision === 2))
      .toMatchObject({
        reason: "Notdiensteinsatz beim Kunden; Beginn und Ende geprüft.",
        created_by: world.users.employee.id,
      });
    expect(resubmitted.events.filter((row) => row.request_id === clarificationRequestId).map((row) => row.event_type)).toEqual([
      "submitted", "clarification_requested", "resubmitted",
    ]);
    expect(resubmitted.applications.filter((row) => row.request_id === clarificationRequestId)).toHaveLength(0);
  });

  test("applies a manager correction for another employee immediately but never a self bypass", async ({
    bueroPage,
    world,
  }) => {
    const reason = `Direkte Büro-Korrektur ${world.runId}`;
    await submitMissedTime(bueroPage, {
      date: DATES[1]!,
      reason,
      personName: `${world.users.employee.firstName} ${world.users.employee.lastName}`,
    });
    await expect(visibleText(bueroPage, "Die Zeit wurde korrigiert.")).toBeVisible();
    const state = await getTimeCorrectionState(world.orgId);
    const revision = state.revisions.find((row) => row.reason === reason);
    const request = state.requests.find((row) => row.id === revision?.request_id);
    expect(request).toMatchObject({ status: "approved", requested_by: world.users.buero.id });
    expect(state.applications.filter((row) => row.request_id === request?.id)).toHaveLength(1);
    expect(request?.subject_user_id).not.toBe(world.users.buero.id);

    const selfReason = `Eigene Büro-Korrektur ${world.runId}`;
    await submitMissedTime(bueroPage, { date: DATES[4]!, reason: selfReason });
    await expect(visibleText(bueroPage, "Die Korrektur wurde zur Prüfung eingereicht.")).toBeVisible();
    const selfState = await getTimeCorrectionState(world.orgId);
    const selfRevision = selfState.revisions.find((row) => row.reason === selfReason);
    const selfRequest = selfState.requests.find(
      (row) => row.id === selfRevision?.request_id
    );
    expect(selfRequest).toMatchObject({
      status: "submitted",
      requested_by: world.users.buero.id,
      subject_user_id: world.users.buero.id,
    });
    expect(selfState.applications.filter(
      (row) => row.request_id === selfRequest?.id
    )).toHaveLength(0);
  });

  test("reviews selected corrections atomically and keeps tenant reads isolated", async ({
    adminPage,
    employeePage,
    world,
  }) => {
    const reasons = [
      `Batch A ${world.runId}`,
      `Batch B ${world.runId}`,
    ];
    await submitMissedTime(employeePage, { date: DATES[2]!, reason: reasons[0]! });
    await submitMissedTime(employeePage, { date: DATES[3]!, reason: reasons[1]! });
    const before = await getTimeCorrectionState(world.orgId);
    const batchIds = before.revisions
      .filter((revision) => reasons.includes(revision.reason))
      .map((revision) => revision.request_id);
    expect(batchIds).toHaveLength(2);

    await adminPage.goto("/zeiterfassung?tab=approvals");
    for (const requestId of batchIds) {
      await adminPage.getByTestId(`time-correction-${requestId}`)
        .getByRole("checkbox").check();
    }
    await adminPage.getByRole("button", { name: "Auswahl freigeben" }).click();
    await expect(visibleText(adminPage, "2 Anträge wurden gemeinsam bearbeitet.")).toBeVisible();

    const after = await getTimeCorrectionState(world.orgId);
    expect(after.requests.filter((row) => batchIds.includes(row.id)).map((row) => row.status)).toEqual([
      "approved", "approved",
    ]);
    expect(after.applications.filter((row) => batchIds.includes(row.request_id))).toHaveLength(2);

    const employeeCounts = await getTimeCorrectionCountsAs(world.users.employee, world.orgId);
    const outsiderCounts = await getTimeCorrectionCountsAs(world.outsider.admin, world.orgId);
    expect(employeeCounts.time_correction_requests).toBeGreaterThan(0);
    expect(outsiderCounts).toEqual({
      time_correction_requests: 0,
      time_correction_request_revisions: 0,
      time_correction_request_sources: 0,
      time_correction_events: 0,
      time_correction_applications: 0,
    });
  });
});

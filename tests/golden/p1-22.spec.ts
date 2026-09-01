import { expect, test } from "./support/fixtures";
import { getTimeCorrectionState } from "./support/db";
import {
  confirmResponsibilityPreview,
  previewResponsibilityChange,
  retryDialogTransaction,
  textInDom,
  typeIntoDateTimeField,
  visibleText,
} from "./support/steps";

test.describe.configure({ mode: "serial" });

let correctionRequestId: string;

function tomorrowLocalDate(): string {
  const date = new Date();
  date.setDate(date.getDate() + 1);
  return date.toLocaleDateString("sv-SE", { timeZone: "Europe/Berlin" });
}

test.describe("P1-22 consistent time corrections @P1-22", () => {
  test("keeps an employee correction provisional until a second person decides @P1-22-stage-submit", async ({
    adminPage,
    employeePage,
    world,
  }) => {
    const reason = `Vergessene Arbeitszeit ${world.runId}`;
    const date = tomorrowLocalDate();
    await previewResponsibilityChange(adminPage, {
      responsibility: "time_approval",
      selectedNames: [
        `${world.users.admin.firstName} ${world.users.admin.lastName}`,
        `${world.users.employee.firstName} ${world.users.employee.lastName}`,
      ],
    });
    await confirmResponsibilityPreview(adminPage);
    await employeePage.goto("/zeiterfassung?tab=history");
    await expect(employeePage.getByRole("tab", { name: "Verlauf" })).toHaveAttribute("data-state", "active");
    const dialog = employeePage.getByRole("dialog").filter({
      has: employeePage.getByRole("heading", { name: "Zeitkorrektur" }),
    });
    await retryDialogTransaction({
      dialog,
      open: async () => {
        await employeePage.getByRole("button", { name: "Zeit nachtragen" }).click({ timeout: 10_000 });
        await expect(dialog).toBeVisible({ timeout: 5_000 });
      },
      interact: async () => {
        const bounded = { timeout: 5_000 };
        await typeIntoDateTimeField(dialog, "time-correction-start", `${date}T08:00`, bounded);
        await typeIntoDateTimeField(dialog, "time-correction-end", `${date}T10:00`, bounded);
        await dialog.getByLabel("Grund").fill(reason, bounded);
        await dialog.getByRole("button", { name: "Speichern" }).click(bounded);
      },
    });
    await expect(visibleText(employeePage, "Die Korrektur wurde zur Prüfung eingereicht.")).toBeVisible();
    await expect(visibleText(employeePage, reason)).toBeVisible();

    const state = await getTimeCorrectionState(world.orgId);
    const request = state.requests.find((row) =>
      row.requested_by === world.users.employee.id
      && state.revisions.some((revision) =>
        revision.request_id === row.id && revision.reason === reason
      )
    );
    expect(request).toMatchObject({ status: "submitted", current_revision: 1 });
    correctionRequestId = request!.id;
    await expect(employeePage.getByTestId(`time-correction-${correctionRequestId}`)
      .getByText("Zur Prüfung", { exact: true })).toBeVisible();
    expect(state.applications.filter((row) => row.request_id === correctionRequestId)).toHaveLength(0);
    expect(state.events.filter((row) => row.request_id === correctionRequestId).map((row) => row.event_type)).toEqual(["submitted"]);
  });

  test("shows the attributable before/after review and applies exactly once @P1-22-stage-approve", async ({
    adminPage,
    employeePage,
    world,
  }) => {
    if (!correctionRequestId) {
      const retainedState = await getTimeCorrectionState(world.orgId);
      const retainedRequest = retainedState.requests.find((row) =>
        row.requested_by === world.users.employee.id
        && row.status === "submitted"
        && retainedState.revisions.some((revision) =>
          revision.request_id === row.id
          && revision.reason === `Vergessene Arbeitszeit ${world.runId}`
        )
      );
      if (!retainedRequest) throw new Error("Run the P1-22 submit stage first.");
      correctionRequestId = retainedRequest.id;
      await previewResponsibilityChange(adminPage, {
        responsibility: "time_approval",
        selectedNames: [
          `${world.users.admin.firstName} ${world.users.admin.lastName}`,
          `${world.users.employee.firstName} ${world.users.employee.lastName}`,
        ],
      });
      await confirmResponsibilityPreview(adminPage);
    }
    await adminPage.goto("/zeiterfassung?tab=approvals");
    const card = adminPage.getByTestId(`time-correction-${correctionRequestId}`);
    await expect(card.getByText("Bisher wirksam")).toBeVisible({ timeout: 30_000 });
    await expect(card.getByText("Vorgeschlagen")).toBeVisible();
    await card.getByRole("button", { name: "Freigeben" }).click();
    await expect(card).toHaveCount(0);

    const state = await getTimeCorrectionState(world.orgId);
    expect(state.requests.find((row) => row.id === correctionRequestId)?.status).toBe("approved");
    expect(state.applications.filter((row) => row.request_id === correctionRequestId)).toHaveLength(1);
    expect(state.revisions.filter((row) => row.request_id === correctionRequestId)).toHaveLength(1);

    await employeePage.goto("/zeiterfassung?tab=history");
    const historyCard = employeePage.getByTestId(`time-correction-${correctionRequestId}`);
    await expect(historyCard.getByText("Freigegeben", { exact: true })).toBeVisible();
    await expect(textInDom(employeePage, "Zur Prüfung")).toHaveCount(0);
  });
});

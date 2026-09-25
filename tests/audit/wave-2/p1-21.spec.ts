import type { Locator, Page } from "@playwright/test";

import { expect, test } from "../support/fixtures";
import { getTimeCaptureCountsAs, getTimeCaptureState } from "../../golden/support/db/time-tracking";
import { getWorkLifecycleState } from "../../golden/support/db/work";
import { clockOut } from "../../golden/support/steps/time-tracking";
import { createJob } from "../../golden/support/steps/work";

import { auditCheckpoint, saveAuditCheckpoint } from "../support/checkpoints";

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function openActivityDialog(page: Page): Promise<{
  dialog: Locator;
  confirmButtonName: "Starten" | "Aktivität wechseln";
}> {
  const openButton = page.getByRole("button", {
    name: "Laufende Zeiterfassung öffnen",
  });
  const startButton = page.getByRole("button", { name: "Zeiterfassung starten" });
  const clockControl = openButton.or(startButton);
  await expect(clockControl).toHaveCount(1);
  await expect(clockControl).toBeVisible();
  // The button is disabled and labelled "starten" until the background clock
  // read lands; the real label is only known once it is enabled.
  await expect(clockControl).toBeEnabled();
  const isOpen = await openButton.isVisible();
  await (isOpen
    ? openButton
    : startButton
  ).click();
  // The button opens the sheet of next actions; the full activity dialog with
  // every kind and qualifier sits behind "Weitere Aktivitäten …".
  const sheet = page.getByRole("dialog").filter({
    has: page.getByRole("heading", {
      name: isOpen ? "Laufende Zeiterfassung" : "Zeiterfassung starten",
    }),
  });
  await sheet.getByRole("button", { name: "Weitere Aktivitäten …" }).click();
  return {
    dialog: page.getByRole("dialog").filter({
    has: page.getByRole("heading", {
      name: isOpen ? "Aktivität wechseln" : "Aktivität wählen",
    }),
    }),
    confirmButtonName: isOpen ? "Aktivität wechseln" : "Starten",
  };
}

async function chooseJob(page: Page, dialog: Locator, title: string): Promise<void> {
  await dialog.getByRole("button", { name: /Ohne Auftrag|Auftrag ausgewählt/ }).click();
  const picker = page.getByRole("dialog").filter({
    has: page.getByRole("heading", { name: /Einstempeln|Auftrag wechseln/ }),
  });
  await picker.getByPlaceholder("Auftrag suchen...").fill(title);
  await picker.getByRole("radio", { name: new RegExp(escapeRegExp(title)) }).click();
  await picker.getByRole("button", { name: /Einstempeln|Wechseln/, exact: true }).click();
}

test.describe("P1-21 exhaustive activity audit @AUDIT-W2-P1-21 @AUDIT-W2", () => {
  test("records travel qualifiers without starting job execution", async ({ adminPage, employeePage, world }) => {
    const jobNumber = `AUF-${world.runId}-P121-AUDIT`;
    saveAuditCheckpoint("p1-21.auditJobNumber", jobNumber);
    const title = `Zeit-Audit ${world.runId}`;
    await createJob(adminPage, {
      jobNumber,
      title,
      assignEmployeeName: `${world.users.employee.firstName} ${world.users.employee.lastName}`,
    });
    await employeePage.goto("/dashboard");
    const { dialog, confirmButtonName } = await openActivityDialog(employeePage);
    await dialog.getByRole("button", { name: "Fahrt", exact: true }).click();
    await chooseJob(employeePage, dialog, title);
    await dialog.getByLabel("Strecke").click();
    await employeePage.getByRole("option", { name: "Zuhause → Einsatzort" }).click();
    await dialog.getByLabel("Rolle").click();
    await employeePage.getByRole("option", { name: "Mitgefahren" }).click();
    await dialog.getByRole("button", { name: confirmButtonName, exact: true }).click();
    await expect(dialog).toHaveCount(0, { timeout: 15_000 });

    await expect.poll(async () => (await getTimeCaptureState(world.orgId, world.users.employee.id)).segments.at(-1)?.kind).toBe("travel");
    const capture = await getTimeCaptureState(world.orgId, world.users.employee.id);
    expect(capture.segments.at(-1)).toMatchObject({
      allocation_kind: "job",
      travel_route: "home_to_site",
      travel_role: "passenger",
    });
    const lifecycle = await getWorkLifecycleState(world.orgId, { jobNumber });
    expect("execution_state" in lifecycle.entity ? lifecycle.entity.execution_state : null).toBe("not_started");
  });

  test("starts execution only on call-out and keeps tenant reads scoped", async ({ employeePage, world }) => {
    const auditJobNumber = auditCheckpoint("p1-21.auditJobNumber");
    if (!auditJobNumber) {
      throw new Error("Run the travel-qualifier test first; it creates the audit job.");
    }
    const { dialog, confirmButtonName } = await openActivityDialog(employeePage);
    await dialog.getByRole("button", { name: "Notdienst", exact: true }).click();
    await dialog.getByRole("button", { name: confirmButtonName, exact: true }).click();
    await expect(dialog).toHaveCount(0, { timeout: 15_000 });
    await expect.poll(async () => (await getTimeCaptureState(world.orgId, world.users.employee.id)).segments.at(-1)?.kind).toBe("callout");

    const lifecycle = await getWorkLifecycleState(world.orgId, {
      jobNumber: auditJobNumber,
    });
    expect(lifecycle.executionEvents.at(-1)?.event_type).toBe(
      "automatic_time_start",
    );
    expect(lifecycle.executionEvents.at(-1)?.created_by).toBe(
      world.users.employee.id,
    );

    const employeeCounts = await getTimeCaptureCountsAs(world.users.employee, world.orgId);
    const outsiderCounts = await getTimeCaptureCountsAs(world.outsider.admin, world.orgId);
    expect(employeeCounts.time_sessions).toBeGreaterThan(0);
    expect(employeeCounts.time_segments).toBeGreaterThan(0);
    expect(outsiderCounts.time_sessions).toBe(0);
    expect(outsiderCounts).toEqual({
      time_sessions: 0,
      time_segments: 0,
      time_operations: 0,
      time_segment_events: 0,
    });
  });

  test("can end call-out and start standalone standby while clocked out", async ({ employeePage, world }) => {
    await clockOut(employeePage);
    const { dialog, confirmButtonName } = await openActivityDialog(employeePage);
    await dialog.getByRole("button", { name: "Bereitschaft", exact: true }).click();
    await dialog.getByLabel("Bereitschaft").click();
    await employeePage.getByRole("option", { name: "Extern" }).click();
    await dialog.getByRole("button", { name: confirmButtonName, exact: true }).click();
    await expect(dialog).toHaveCount(0, { timeout: 15_000 });
    await expect.poll(async () => (await getTimeCaptureState(world.orgId, world.users.employee.id)).segments.at(-1)?.standby_context).toBe("remote");
    await clockOut(employeePage);
  });
});

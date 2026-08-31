import type { Locator, Page } from "@playwright/test";

import { closeWorkArtifactDialog } from "./support/spec-helpers/work-artifact-dialog";
import { expect, test } from "./support/fixtures";
import {
  getMaintenanceCoverageStateByReference,
  getJobNumberById,
  getMaintenancePlanNumberByClient,
  getMaintenanceStateByPlanNumber,
} from "./support/db";
import {
  berlinDateAtOffset,
  ownedBerlinDateAtOffset,
} from "./support/date-ownership";
import { requireChainedValue } from "./support/preconditions";
import {
  addSiteOnCustomerDetail,
  createAndPublishWorkTemplate,
  createCustomer,
  createDirectServiceCase,
  createInstalledEquipment,
  createMaintenanceCoverageViaDialog,
  createMaintenancePlanViaDialog,
  openCustomerDetail,
  openFieldWorkPack,
  typeIntoDateTimeField,
  visibleText,
} from "./support/steps";
import type { TestWorld } from "./support/world";

test.describe.configure({ mode: "serial" });

const DATES = Array.from({ length: 5 }, (_, index) =>
  ownedBerlinDateAtOffset("p1-20", 105 + index),
);
// Completion is bounded by the real operating date, not fixture-date
// ownership. Keep the visit inside that boundary while coverage dates retain
// P1-20's collision-free audit window.
const EXECUTION_DATE = berlinDateAtOffset(0);
const FIRST_DUE_LABEL = new Intl.DateTimeFormat("de-DE").format(
  new Date(`${EXECUTION_DATE}T12:00:00Z`),
);

function names(world: TestWorld) {
  return {
    customerName: `P120 Golden Kunde ${world.runId}`,
    siteName: `P120 Golden Heizzentrale ${world.runId}`,
    equipmentName: `P120 Golden Wärmeerzeuger ${world.runId}`,
    templateName: `P120 Golden Wartung ${world.runId}`,
    coverageReference: `P120-VERTRAG-${world.runId}`,
    serviceSummary: `P120 Golden reaktive Abweichung ${world.runId}`,
    evidenceTitle: `P120 Golden Wartungsbericht ${world.runId}`,
    employeeName: `${world.users.employee.firstName} ${world.users.employee.lastName}`,
  };
}

async function createSubmittedReport(page: Page, title: string): Promise<void> {
  await page
    .getByTestId("work-artifacts-section")
    .getByRole("button", { name: "Neu" })
    .click();
  const dialog: Locator = page.getByRole("dialog");
  await dialog
    .getByRole("combobox", { name: "Art des Arbeitsnachweises" })
    .click();
  await page
    .getByRole("option", { name: "Arbeitsbericht", exact: true })
    .click();
  await dialog.getByLabel("Titel").fill(title);
  await dialog
    .getByLabel("Zusammenfassung")
    .fill("Wartungsumfang nachvollziehbar dokumentiert.");
  await typeIntoDateTimeField(
    dialog,
    "artifact-visit-start",
    `${EXECUTION_DATE}T06:00`,
  );
  await typeIntoDateTimeField(
    dialog,
    "artifact-visit-end",
    `${EXECUTION_DATE}T08:00`,
  );
  await dialog
    .getByLabel("Ausgeführte Arbeiten")
    .fill("Anlage geprüft und Messwerte dokumentiert.");
  await dialog
    .getByRole("button", { name: "Zur Prüfung einreichen", exact: true })
    .click();
  await expect(dialog.getByText(/Version 1/)).toBeVisible({ timeout: 20_000 });
  await closeWorkArtifactDialog(dialog);
}

async function assignEmployee(
  page: Page,
  jobNumber: string,
  employeeName: string,
): Promise<void> {
  await page.goto(`/auftraege/${jobNumber}`);
  await page.getByRole("button", { name: "Zuweisen", exact: true }).click();
  const dialog = page.getByRole("dialog").filter({
    has: page.getByRole("heading", { name: "Mitarbeiter zuweisen" }),
  });
  await dialog
    .getByRole("combobox")
    .filter({ hasText: "Mitarbeiter zuweisen" })
    .click();
  await page.getByPlaceholder("Mitarbeiter suchen...").fill(employeeName);
  await page
    .getByRole("listbox")
    .getByRole("button")
    .filter({ hasText: employeeName })
    .click();
  await dialog.getByRole("heading", { name: "Mitarbeiter zuweisen" }).click();
  await dialog.getByRole("button", { name: "Speichern" }).click();
  await expect(dialog).toHaveCount(0, { timeout: 15_000 });
}

test.describe("P1-20 maintenance plan to completed visit @P1-20 @GG-06", () => {
  test("prepares exact existing owners @P1-20-stage-setup", async ({
    adminPage,
    world,
  }) => {
    const fixture = names(world);
    await createCustomer(adminPage, fixture.customerName);
    await openCustomerDetail(adminPage, fixture.customerName);
    await addSiteOnCustomerDetail(adminPage, {
      name: fixture.siteName,
      street: "Wartungsweg 20",
      postalCode: "10115",
      city: "Berlin",
      isPrimary: true,
    });
    await createInstalledEquipment(adminPage, {
      customerName: fixture.customerName,
      siteName: fixture.siteName,
      name: fixture.equipmentName,
      state: "Aktiv",
      manufacturer: "WerkFlow Testtechnik",
      model: "MW 20",
    });
    await createAndPublishWorkTemplate(adminPage, {
      name: fixture.templateName,
      targetType: "job",
      firstItem: "Anlage warten",
      secondItem: "Messwerte dokumentieren",
      evidenceDescription: "Wartungsbericht",
    });
    await createDirectServiceCase(adminPage, {
      customerName: fixture.customerName,
      siteName: fixture.siteName,
      statement: "Bei der Wartung wurde eine gesonderte Störung festgestellt.",
      summary: fixture.serviceSummary,
      equipmentName: fixture.equipmentName,
    });
  });

  test("records operational coverage and an exact follow-up @P1-20-stage-coverage", async ({
    adminPage,
    world,
  }) => {
    const fixture = names(world);
    await createMaintenanceCoverageViaDialog(adminPage, {
      clientName: fixture.customerName,
      siteName: fixture.siteName,
      reference: fixture.coverageReference,
      validFrom: DATES[0],
      validUntil: DATES[4],
      noticeDate: DATES[2],
      renewalDate: DATES[3],
      reviewDueDate: DATES[1],
      operationalNote: "Leistungsumfang vor Verlängerung intern prüfen.",
    });
    await expect(visibleText(adminPage, "Prüfung vorgemerkt")).toBeVisible();
    const coverageRow = adminPage
      .getByTestId("maintenance-coverage-row")
      .filter({ hasText: fixture.coverageReference });
    await coverageRow.getByRole("button", { name: "Wiedervorlage" }).click();
    const dialog = adminPage.getByRole("dialog");
    await dialog.getByRole("button", { name: "Speichern" }).click();
    await expect(dialog).toHaveCount(0, { timeout: 20_000 });

    const state = requireChainedValue(
      await getMaintenanceCoverageStateByReference(
        world.orgId,
        fixture.coverageReference,
      ),
      {
        test: "P1-20 coverage stage",
        needs: "the operational coverage created in this stage",
        grep: "@P1-20-stage-setup|@P1-20-stage-coverage",
        suite: "golden",
      },
    );
    expect(state.coverage).toMatchObject({
      valid_from: DATES[0],
      valid_until: DATES[4],
      review_due_date: DATES[1],
      status: "active",
    });
    expect(state.events.map((event) => event.event_type)).toContain("created");
    expect(state.followUps).toHaveLength(1);
  });

  test("activates a versioned plan and materializes the horizon @P1-20-stage-plan", async ({
    adminPage,
    world,
  }) => {
    const fixture = names(world);
    await createMaintenancePlanViaDialog(adminPage, {
      clientName: fixture.customerName,
      siteName: fixture.siteName,
      coverageReference: fixture.coverageReference,
      templateName: fixture.templateName,
      equipmentName: fixture.equipmentName,
      effectiveFrom: EXECUTION_DATE,
      firstDue: EXECUTION_DATE,
      intervalMonths: "6",
      instructions: "Zugang über das Büro; Messwerte vollständig erfassen.",
    });
    const coverage = requireChainedValue(
      await getMaintenanceCoverageStateByReference(
        world.orgId,
        fixture.coverageReference,
      ),
      {
        test: "P1-20 plan stage coverage",
        needs: "the coverage from the prior stage",
        grep: "@P1-20-stage-setup|@P1-20-stage-coverage|@P1-20-stage-plan",
        suite: "golden",
      },
    );
    const planNumber = requireChainedValue(
      await getMaintenancePlanNumberByClient(
        world.orgId,
        coverage.coverage.client_id,
      ),
      {
        test: "P1-20 plan stage",
        needs: "the active plan created in this stage",
        grep: "@P1-20-stage-setup|@P1-20-stage-coverage|@P1-20-stage-plan",
        suite: "golden",
      },
    );
    const state = requireChainedValue(
      await getMaintenanceStateByPlanNumber(world.orgId, planNumber),
      {
        test: "P1-20 plan state",
        needs: "the active plan created in this stage",
        grep: "@P1-20-stage-setup|@P1-20-stage-coverage|@P1-20-stage-plan",
        suite: "golden",
      },
    );
    expect(state.plan.status).toBe("active");
    expect(state.revisions).toHaveLength(1);
    expect(state.equipment).toHaveLength(1);
    expect(state.dueWork.length).toBeGreaterThanOrEqual(3);
    expect(state.dueWork[0]).toMatchObject({
      due_date: EXECUTION_DATE,
      status: "open",
      job_id: null,
      planning_occurrence_id: null,
    });
    expect(state.planEvents.map((event) => event.event_type)).toEqual(
      expect.arrayContaining(["created", "horizon_extended"]),
    );
  });

  test("creates and schedules one normal visit job @P1-20-stage-visit", async ({
    adminPage,
    world,
  }) => {
    const fixture = names(world);
    const coverage = requireChainedValue(
      await getMaintenanceCoverageStateByReference(
        world.orgId,
        fixture.coverageReference,
      ),
      {
        test: "P1-20 visit coverage",
        needs: "the coverage from the prior stages",
        grep: "@P1-20-stage-setup|@P1-20-stage-coverage|@P1-20-stage-plan|@P1-20-stage-visit",
        suite: "golden",
      },
    );
    const planNumber = requireChainedValue(
      await getMaintenancePlanNumberByClient(
        world.orgId,
        coverage.coverage.client_id,
      ),
      {
        test: "P1-20 visit plan",
        needs: "the plan from the plan stage",
        grep: "@P1-20-stage-setup|@P1-20-stage-coverage|@P1-20-stage-plan|@P1-20-stage-visit",
        suite: "golden",
      },
    );
    await adminPage.goto("/service/wartung");
    const dueRow = adminPage
      .getByTestId("maintenance-due-row")
      .filter({ hasText: planNumber })
      .filter({ hasText: FIRST_DUE_LABEL });
    await dueRow.getByRole("button", { name: "Auftrag anlegen" }).click();
    let dialog = adminPage.getByRole("dialog");
    await dialog.getByRole("button", { name: "Aktion ausführen" }).click();
    await expect(dialog).toHaveCount(0, { timeout: 20_000 });
    let state = requireChainedValue(
      await getMaintenanceStateByPlanNumber(world.orgId, planNumber),
      {
        test: "P1-20 visit state",
        needs: "the visit job created in this stage",
        grep: "@P1-20-stage-setup|@P1-20-stage-coverage|@P1-20-stage-plan|@P1-20-stage-visit",
        suite: "golden",
      },
    );
    const linkedDueWork = requireChainedValue(
      state.dueWork[0]?.job_id ? state.dueWork[0] : null,
      {
        test: "P1-20 visit job",
        needs: "the linked visit job",
        grep: "@P1-20-stage-setup|@P1-20-stage-coverage|@P1-20-stage-plan|@P1-20-stage-visit",
        suite: "golden",
      },
    );
    expect(linkedDueWork.status).toBe("visit_created");
    await adminPage.goto("/service/wartung");
    const scheduledRow = adminPage
      .getByTestId("maintenance-due-row")
      .filter({ hasText: planNumber })
      .filter({ hasText: FIRST_DUE_LABEL });
    await scheduledRow.getByRole("button", { name: "Termin planen" }).click();
    dialog = adminPage.getByRole("dialog");
    await dialog.getByRole("button", { name: "Aktion ausführen" }).click();
    await expect(dialog).toHaveCount(0, { timeout: 20_000 });
    state = requireChainedValue(
      await getMaintenanceStateByPlanNumber(world.orgId, planNumber),
      {
        test: "P1-20 scheduled visit",
        needs: "the scheduled visit from this stage",
        grep: "@P1-20-stage-setup|@P1-20-stage-coverage|@P1-20-stage-plan|@P1-20-stage-visit",
        suite: "golden",
      },
    );
    expect(state.dueWork[0].planning_occurrence_id).not.toBeNull();
  });

  test("projects only exact visit context to the assigned employee @P1-20-stage-field", async ({
    adminPage,
    employeePage,
    world,
  }) => {
    const fixture = names(world);
    const coverage = requireChainedValue(
      await getMaintenanceCoverageStateByReference(
        world.orgId,
        fixture.coverageReference,
      ),
      {
        test: "P1-20 field coverage",
        needs: "the retained maintenance coverage",
        grep: "@P1-20-stage-setup|@P1-20-stage-coverage|@P1-20-stage-plan|@P1-20-stage-visit|@P1-20-stage-field",
        suite: "golden",
      },
    );
    const planNumber = requireChainedValue(
      await getMaintenancePlanNumberByClient(
        world.orgId,
        coverage.coverage.client_id,
      ),
      {
        test: "P1-20 field plan",
        needs: "the retained maintenance plan",
        grep: "@P1-20-stage-setup|@P1-20-stage-coverage|@P1-20-stage-plan|@P1-20-stage-visit|@P1-20-stage-field",
        suite: "golden",
      },
    );
    const state = requireChainedValue(
      await getMaintenanceStateByPlanNumber(world.orgId, planNumber),
      {
        test: "P1-20 field visit",
        needs: "the linked visit job",
        grep: "@P1-20-stage-setup|@P1-20-stage-coverage|@P1-20-stage-plan|@P1-20-stage-visit|@P1-20-stage-field",
        suite: "golden",
      },
    );
    const jobId = requireChainedValue(state.dueWork[0]?.job_id, {
      test: "P1-20 field job id",
      needs: "the exact visit job",
      grep: "@P1-20-stage-setup|@P1-20-stage-coverage|@P1-20-stage-plan|@P1-20-stage-visit|@P1-20-stage-field",
      suite: "golden",
    });
    const jobNumber = requireChainedValue(
      await getJobNumberById(world.orgId, jobId),
      {
        test: "P1-20 field job number",
        needs: "the visit job number",
        grep: "@P1-20-stage-setup|@P1-20-stage-coverage|@P1-20-stage-plan|@P1-20-stage-visit|@P1-20-stage-field",
        suite: "golden",
      },
    );
    await assignEmployee(adminPage, jobNumber, fixture.employeeName);
    const pack = await openFieldWorkPack(employeePage, jobNumber);
    await expect(pack).toContainText(planNumber);
    await expect(pack).toContainText(fixture.equipmentName);
    await expect(pack).toContainText("Messwerte vollständig erfassen");
    await expect(pack).not.toContainText(fixture.coverageReference);
    await expect(pack).not.toContainText("Leistungsumfang vor Verlängerung");

    await employeePage.goto(`/auftraege/${jobNumber}`);
    await createSubmittedReport(employeePage, fixture.evidenceTitle);
  });

  test("completes the due item with exact evidence and next due @P1-20-stage-completion", async ({
    adminPage,
    world,
  }) => {
    const fixture = names(world);
    const coverage = requireChainedValue(
      await getMaintenanceCoverageStateByReference(
        world.orgId,
        fixture.coverageReference,
      ),
      {
        test: "P1-20 completion coverage",
        needs: "the retained coverage",
        grep: "@P1-20-stage-setup|@P1-20-stage-coverage|@P1-20-stage-plan|@P1-20-stage-visit|@P1-20-stage-field|@P1-20-stage-completion",
        suite: "golden",
      },
    );
    const planNumber = requireChainedValue(
      await getMaintenancePlanNumberByClient(
        world.orgId,
        coverage.coverage.client_id,
      ),
      {
        test: "P1-20 completion plan",
        needs: "the retained plan",
        grep: "@P1-20-stage-setup|@P1-20-stage-coverage|@P1-20-stage-plan|@P1-20-stage-visit|@P1-20-stage-field|@P1-20-stage-completion",
        suite: "golden",
      },
    );
    await adminPage.goto("/service/wartung");
    const dueRow = adminPage
      .getByTestId("maintenance-due-row")
      .filter({ hasText: planNumber })
      .filter({ hasText: FIRST_DUE_LABEL });
    await dueRow.getByRole("button", { name: "Abschließen" }).click();
    const dialog = adminPage.getByRole("dialog");
    await dialog
      .getByText(fixture.evidenceTitle, { exact: false })
      .locator("..")
      .getByRole("checkbox")
      .click();
    await dialog.getByRole("button", { name: "Aktion ausführen" }).click();
    await expect(dialog).toHaveCount(0, { timeout: 20_000 });
    const state = requireChainedValue(
      await getMaintenanceStateByPlanNumber(world.orgId, planNumber),
      {
        test: "P1-20 completion state",
        needs: "the completed due item",
        grep: "@P1-20-stage-setup|@P1-20-stage-coverage|@P1-20-stage-plan|@P1-20-stage-visit|@P1-20-stage-field|@P1-20-stage-completion",
        suite: "golden",
      },
    );
    expect(state.dueWork[0]).toMatchObject({
      status: "completed",
      scope_outcome: "complete",
      completed_on: expect.any(String),
      next_due_date: expect.any(String),
    });
    expect(state.evidenceLinks).toHaveLength(1);
    expect(state.dueEvents.map((event) => event.event_type)).toContain(
      "completed",
    );
  });
});

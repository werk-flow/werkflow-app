import { resolve } from "node:path";
import type { Locator, Page } from "@playwright/test";

import { expect, test } from "../../golden/support/fixtures";
import {
  getMaintenanceCountsAs,
  getMaintenanceCoverageStateByReference,
  getMaintenancePlanNumbersByClient,
  getMaintenanceStateByPlanNumber,
} from "../../golden/support/db";
import { ownedBerlinDateAtOffset } from "../../golden/support/date-ownership";
import { requireChainedValue } from "../../golden/support/preconditions";
import {
  addSiteOnCustomerDetail,
  createAndPublishWorkTemplate,
  createCustomer,
  createDirectServiceCase,
  createInstalledEquipment,
  createMaintenanceCoverageViaDialog,
  createMaintenancePlanViaDialog,
  openCustomerDetail,
  selectFromSearchable,
  textInDom,
  typeIntoDatePickerById,
  uploadIntoDocumentsSection,
} from "../../golden/support/steps";
import { ARTIFACTS_DIR, type TestWorld } from "../../golden/support/world";

test.describe.configure({ mode: "serial" });

const DATES = Array.from({ length: 5 }, (_, index) =>
  ownedBerlinDateAtOffset("p1-20", 105 + index),
);
const FIRST_DUE_LABEL = new Intl.DateTimeFormat("de-DE").format(
  new Date(`${DATES[0]}T12:00:00Z`),
);

function names(world: TestWorld) {
  return {
    customerName: `P120 Audit Kunde ${world.runId}`,
    siteName: `P120 Audit Heizzentrale ${world.runId}`,
    equipmentName: `P120 Audit Wärmeerzeuger ${world.runId}`,
    templateName: `P120 Audit Wartung ${world.runId}`,
    coverageReference: `P120-AUDIT-VERTRAG-${world.runId}`,
    serviceSummary: `P120 Audit reaktiver Befund ${world.runId}`,
  };
}

async function fillPlanDialog(
  page: Page,
  fixture: ReturnType<typeof names>,
): Promise<Locator> {
  await page.goto("/service/wartung");
  await page.getByRole("button", { name: "Wartungsplan anlegen" }).click();
  const dialog = page.getByRole("dialog");
  await selectFromSearchable(
    page,
    dialog.locator("#maintenance-client"),
    fixture.customerName,
  );
  await selectFromSearchable(
    page,
    dialog.locator("#maintenance-site"),
    fixture.siteName,
  );
  await selectFromSearchable(
    page,
    dialog.locator("#maintenance-template"),
    fixture.templateName,
  );
  await typeIntoDatePickerById(dialog, "maintenance-effective", DATES[0]);
  await typeIntoDatePickerById(dialog, "maintenance-first-due", DATES[1]);
  await dialog
    .getByText(fixture.equipmentName, { exact: true })
    .locator("..")
    .click();
  return dialog;
}

async function openPlanAction(
  page: Page,
  planNumber: string,
  actionName: string,
): Promise<Locator> {
  await page.goto("/service/wartung");
  await page.getByRole("tab", { name: /Pläne/ }).click();
  const section = page
    .getByTestId("maintenance-plan-card")
    .filter({ has: page.getByRole("heading", { name: planNumber }) });
  await section.getByRole("button", { name: actionName, exact: true }).click();
  return page.getByRole("dialog");
}

test.describe("P1-20 exhaustive maintenance audit @AUDIT-W2-P1-20 @AUDIT-W2", () => {
  test("creates bounded exact owners without hidden work @P1-20-audit-setup", async ({
    adminPage,
    world,
  }) => {
    const fixture = names(world);
    await createCustomer(adminPage, fixture.customerName);
    await openCustomerDetail(adminPage, fixture.customerName);
    await addSiteOnCustomerDetail(adminPage, {
      name: fixture.siteName,
      street: "Auditwartungsweg 20",
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
      model: "Audit 20",
    });
    await createAndPublishWorkTemplate(adminPage, {
      name: fixture.templateName,
      targetType: "job",
      firstItem: "Anlage fachgerecht warten",
      secondItem: "Messwerte nachvollziehbar dokumentieren",
      evidenceDescription: "Versionierter Wartungsbericht",
    });
    await createDirectServiceCase(adminPage, {
      customerName: fixture.customerName,
      siteName: fixture.siteName,
      statement: "Gesonderter reaktiver Befund während der Wartung.",
      summary: fixture.serviceSummary,
      equipmentName: fixture.equipmentName,
    });
    await createMaintenanceCoverageViaDialog(adminPage, {
      clientName: fixture.customerName,
      siteName: fixture.siteName,
      reference: fixture.coverageReference,
      validFrom: DATES[0],
      validUntil: DATES[4],
      noticeDate: DATES[2],
      renewalDate: DATES[3],
      reviewDueDate: DATES[1],
      operationalNote:
        "Nur bestätigte operative Abdeckung; kein kaufmännischer Status.",
    });
    await createMaintenancePlanViaDialog(adminPage, {
      clientName: fixture.customerName,
      siteName: fixture.siteName,
      coverageReference: fixture.coverageReference,
      templateName: fixture.templateName,
      equipmentName: fixture.equipmentName,
      effectiveFrom: DATES[0],
      firstDue: DATES[0],
      intervalMonths: "6",
      instructions: "Zugang und Messpunkte vor Ort prüfen.",
    });

    const coverage = requireChainedValue(
      await getMaintenanceCoverageStateByReference(
        world.orgId,
        fixture.coverageReference,
      ),
      {
        test: "P1-20 audit setup coverage",
        needs: "the exact coverage created in this stage",
        grep: "@P1-20-audit-setup",
        suite: "audit",
      },
    );
    const [planNumber] = await getMaintenancePlanNumbersByClient(
      world.orgId,
      coverage.coverage.client_id,
    );
    const state = requireChainedValue(
      planNumber
        ? await getMaintenanceStateByPlanNumber(world.orgId, planNumber)
        : null,
      {
        test: "P1-20 audit setup plan",
        needs: "the active maintenance plan",
        grep: "@P1-20-audit-setup",
        suite: "audit",
      },
    );
    expect(state.equipment).toHaveLength(1);
    expect(state.dueWork.length).toBeGreaterThanOrEqual(3);
    expect(state.dueWork.every((due) => due.job_id === null)).toBe(true);
    expect(
      state.dueWork.every((due) => due.planning_occurrence_id === null),
    ).toBe(true);
  });

  test("requires an explicit overlap reason @P1-20-audit-overlap", async ({
    adminPage,
    world,
  }) => {
    const fixture = names(world);
    const dialog = await fillPlanDialog(adminPage, fixture);
    await dialog.getByRole("button", { name: "Wartungsplan anlegen" }).click();
    await expect(dialog.getByRole("alert")).toContainText(
      "Begründung erforderlich",
    );
    await dialog
      .locator("#maintenance-overlap")
      .fill("Zweite Fachwartung deckt einen getrennten Anlagenumfang ab.");
    await dialog.getByRole("button", { name: "Wartungsplan anlegen" }).click();
    await expect(dialog).toHaveCount(0, { timeout: 20_000 });

    const coverage = requireChainedValue(
      await getMaintenanceCoverageStateByReference(
        world.orgId,
        fixture.coverageReference,
      ),
      {
        test: "P1-20 audit overlap coverage",
        needs: "the setup coverage",
        grep: "@P1-20-audit-setup|@P1-20-audit-overlap",
        suite: "audit",
      },
    );
    const planNumbers = await getMaintenancePlanNumbersByClient(
      world.orgId,
      coverage.coverage.client_id,
    );
    expect(planNumbers).toHaveLength(2);
    const secondPlanNumber = planNumbers[1];
    if (!secondPlanNumber)
      throw new Error("The overlapping plan number is missing.");
    const second = requireChainedValue(
      await getMaintenanceStateByPlanNumber(world.orgId, secondPlanNumber),
      {
        test: "P1-20 audit overlap plan",
        needs: "the explicitly justified overlapping plan",
        grep: "@P1-20-audit-setup|@P1-20-audit-overlap",
        suite: "audit",
      },
    );
    expect(second.revisions[0]?.overlap_reason).toContain("getrennten");
  });

  test("links exact existing documents, follow-ups, and service context @P1-20-audit-links", async ({
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
        test: "P1-20 audit links coverage",
        needs: "the setup coverage",
        grep: "@P1-20-audit-setup|@P1-20-audit-overlap|@P1-20-audit-links",
        suite: "audit",
      },
    );
    const [planNumber] = await getMaintenancePlanNumbersByClient(
      world.orgId,
      coverage.coverage.client_id,
    );
    if (!planNumber) throw new Error("The maintenance plan number is missing.");
    const existingPlan = requireChainedValue(
      await getMaintenanceStateByPlanNumber(world.orgId, planNumber),
      {
        test: "P1-20 audit existing service result",
        needs: "the plan that receives the exact service-case link",
        grep: "@P1-20-audit-setup|@P1-20-audit-overlap|@P1-20-audit-links",
        suite: "audit",
      },
    );
    const expectedDocumentLinkCount = Math.max(
      coverage.documentLinks.length,
      1,
    );
    const expectedFollowUpCount = Math.max(coverage.followUps.length, 1);
    const expectedServiceCaseLinkCount = Math.max(
      existingPlan.serviceCaseLinks.length,
      1,
    );

    await adminPage.goto("/service/wartung");
    await adminPage.getByRole("tab", { name: /Abdeckungen/ }).click();
    const coverageRow = adminPage
      .getByTestId("maintenance-coverage-row")
      .filter({ hasText: fixture.coverageReference });
    let dialog;
    if (coverage.followUps.length === 0) {
      await coverageRow.getByRole("button", { name: "Wiedervorlage" }).click();
      dialog = adminPage.getByRole("dialog").filter({
        has: adminPage.getByRole("heading", { name: "Nachfassaktion anlegen" }),
      });
      await dialog.getByRole("button", { name: "Speichern" }).click();
      await expect(dialog).toHaveCount(0, { timeout: 20_000 });
    }
    if (coverage.documentLinks.length === 0) {
      await coverageRow.getByRole("button", { name: "Dokumente" }).click();
      dialog = adminPage.getByRole("dialog").filter({
        has: adminPage.getByRole("heading", {
          name: `Dokumente zu ${coverage.coverage.coverage_number}`,
        }),
      });
      await uploadIntoDocumentsSection(
        adminPage,
        resolve(ARTIFACTS_DIR, "upload-fixture.pdf"),
        "upload-fixture",
        { enclosingDialog: dialog },
      );
      await dialog.getByRole("button", { name: "Schließen" }).click();
    }

    if (existingPlan.serviceCaseLinks.length === 0) {
      await adminPage.goto("/service/wartung");
      const dueRow = adminPage
        .getByTestId("maintenance-due-row")
        .filter({ hasText: planNumber })
        .filter({ hasText: FIRST_DUE_LABEL });
      await dueRow.getByRole("button", { name: "Auftrag anlegen" }).click();
      dialog = adminPage.getByRole("dialog").filter({
        has: adminPage.getByRole("heading", { name: "Fälligkeit bearbeiten" }),
      });
      await dialog.getByRole("combobox", { name: "Aktion" }).click();
      await adminPage
        .getByRole("option", { name: "Reaktiven Servicefall verknüpfen" })
        .click();
      await selectFromSearchable(
        adminPage,
        dialog.getByText("Servicefall suchen", { exact: true }),
        fixture.serviceSummary,
      );
      await dialog
        .getByLabel("Begründung")
        .fill("Reaktiver Befund gehört exakt zu dieser Wartungsfälligkeit.");
      await dialog.getByRole("button", { name: "Aktion ausführen" }).click();
      await expect(dialog).toHaveCount(0, { timeout: 20_000 });
    }

    const afterCoverage = requireChainedValue(
      await getMaintenanceCoverageStateByReference(
        world.orgId,
        fixture.coverageReference,
      ),
      {
        test: "P1-20 audit link result",
        needs: "the exact document and follow-up links",
        grep: "@P1-20-audit-setup|@P1-20-audit-overlap|@P1-20-audit-links",
        suite: "audit",
      },
    );
    expect(afterCoverage.documentLinks).toHaveLength(expectedDocumentLinkCount);
    expect(afterCoverage.followUps).toHaveLength(expectedFollowUpCount);
    const plan = requireChainedValue(
      await getMaintenanceStateByPlanNumber(world.orgId, planNumber),
      {
        test: "P1-20 audit service result",
        needs: "the exact service-case link",
        grep: "@P1-20-audit-setup|@P1-20-audit-overlap|@P1-20-audit-links",
        suite: "audit",
      },
    );
    expect(plan.serviceCaseLinks).toHaveLength(expectedServiceCaseLinkCount);
    expect(plan.dueWork.every((due) => due.job_id === null)).toBe(true);
  });

  test("protects lifecycle updates and archives only terminal plans @P1-20-audit-lifecycle", async ({
    adminPage,
    bueroPage,
    world,
  }) => {
    const fixture = names(world);
    const coverage = requireChainedValue(
      await getMaintenanceCoverageStateByReference(
        world.orgId,
        fixture.coverageReference,
      ),
      {
        test: "P1-20 audit lifecycle coverage",
        needs: "the setup coverage",
        grep: "@P1-20-audit-setup|@P1-20-audit-overlap|@P1-20-audit-links|@P1-20-audit-lifecycle",
        suite: "audit",
      },
    );
    const planNumbers = await getMaintenancePlanNumbersByClient(
      world.orgId,
      coverage.coverage.client_id,
    );
    expect(planNumbers).toHaveLength(2);
    const firstPlanNumber = planNumbers[0];
    const secondPlanNumber = planNumbers[1];
    if (!firstPlanNumber || !secondPlanNumber) {
      throw new Error("The lifecycle plan numbers are missing.");
    }
    const staleDialog = await openPlanAction(
      bueroPage,
      firstPlanNumber,
      "Pausieren",
    );
    const currentDialog = await openPlanAction(
      adminPage,
      firstPlanNumber,
      "Pausieren",
    );
    await currentDialog
      .locator("#maintenance-action-reason")
      .fill("Plan während der getrennten Fachprüfung pausiert");
    await currentDialog
      .getByRole("button", { name: "Wartungsplan pausieren" })
      .click();
    await expect(currentDialog).toHaveCount(0, { timeout: 20_000 });
    await staleDialog
      .locator("#maintenance-action-reason")
      .fill("Dieser veraltete Stand darf nicht gewinnen");
    await staleDialog
      .getByRole("button", { name: "Wartungsplan pausieren" })
      .click();
    await expect(staleDialog.getByRole("alert")).toContainText(
      "inzwischen geändert",
    );
    await staleDialog.getByRole("button", { name: "Abbrechen" }).click();

    let dialog = await openPlanAction(adminPage, secondPlanNumber, "Beenden");
    await dialog
      .locator("#maintenance-action-reason")
      .fill("Getrennten Auditplan nachvollziehbar beendet");
    await dialog.getByRole("button", { name: "Wartungsplan beenden" }).click();
    await expect(dialog).toHaveCount(0, { timeout: 20_000 });
    dialog = await openPlanAction(adminPage, secondPlanNumber, "Archivieren");
    await dialog
      .locator("#maintenance-action-reason")
      .fill("Beendeten Auditplan aus der laufenden Ansicht entfernt");
    await dialog
      .getByRole("button", { name: "Wartungsplan archivieren" })
      .click();
    await expect(dialog).toHaveCount(0, { timeout: 20_000 });

    const first = requireChainedValue(
      await getMaintenanceStateByPlanNumber(world.orgId, firstPlanNumber),
      {
        test: "P1-20 audit lifecycle current plan",
        needs: "the successfully paused plan",
        grep: "@P1-20-audit-setup|@P1-20-audit-overlap|@P1-20-audit-links|@P1-20-audit-lifecycle",
        suite: "audit",
      },
    );
    const second = requireChainedValue(
      await getMaintenanceStateByPlanNumber(world.orgId, secondPlanNumber),
      {
        test: "P1-20 audit lifecycle terminal plan",
        needs: "the terminated and archived plan",
        grep: "@P1-20-audit-setup|@P1-20-audit-overlap|@P1-20-audit-links|@P1-20-audit-lifecycle",
        suite: "audit",
      },
    );
    expect(first.plan.status).toBe("suspended");
    expect(
      first.planEvents.filter((event) => event.event_type === "status_changed"),
    ).toHaveLength(1);
    expect(second.plan.status).toBe("terminated");
    expect(second.plan.archived_at).not.toBeNull();
  });

  test("enforces manager and organization boundaries @P1-20-audit-boundary", async ({
    employeePage,
    outsiderPage,
    world,
  }) => {
    const fixture = names(world);
    const coverage = requireChainedValue(
      await getMaintenanceCoverageStateByReference(
        world.orgId,
        fixture.coverageReference,
      ),
      {
        test: "P1-20 audit boundary coverage",
        needs: "the complete audit state",
        grep: "@P1-20-audit-setup|@P1-20-audit-overlap|@P1-20-audit-links|@P1-20-audit-lifecycle|@P1-20-audit-boundary",
        suite: "audit",
      },
    );
    await employeePage.goto("/service/wartung");
    await expect(employeePage).not.toHaveURL(/\/service\/wartung/);
    await outsiderPage.goto("/service/wartung");
    await expect(
      outsiderPage.getByRole("heading", { name: "Wartung", exact: true }),
    ).toBeVisible();
    await expect(
      textInDom(outsiderPage, fixture.coverageReference),
    ).toHaveCount(0);
    const employeeCounts = await getMaintenanceCountsAs(
      world.users.employee,
      world.orgId,
    );
    const outsiderCounts = await getMaintenanceCountsAs(
      world.outsider.admin,
      world.orgId,
    );
    expect(Object.values(employeeCounts).every((count) => count === 0)).toBe(
      true,
    );
    expect(Object.values(outsiderCounts).every((count) => count === 0)).toBe(
      true,
    );
    expect(coverage.coverage.operational_note).toContain(
      "kein kaufmännischer Status",
    );
  });
});

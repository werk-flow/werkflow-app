import { resolve } from "node:path";
import type { Locator, Page, Route } from "@playwright/test";

import { expect, test } from "../support/fixtures";
import { auditCheckpoint, saveAuditCheckpoint } from "../support/checkpoints";
import { captureResponsiveSection } from "../support/visual-evidence";
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
import { artifactsDirectory, type TestWorld } from "../../golden/support/world";

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
  const section = page.getByRole("main").getByTestId("maintenance-plan-card")
    .filter({ has: page.getByRole("heading", { name: planNumber }) });
  await section.getByRole("button", { name: actionName, exact: true }).click();
  return page.getByRole("dialog");
}

async function expectMaintenanceColumns(header: Locator, row: Locator, columns: boolean): Promise<void> {
  if (columns) await expect(header).toBeVisible();
  else await expect(header).toBeHidden();
  const cells = await row.evaluate((element) => Array.from(element.children).map((cell) => {
    const bounds = cell.getBoundingClientRect();
    return { x: bounds.x, width: bounds.width, top: bounds.top, bottom: bounds.bottom };
  }));
  expect(cells).toHaveLength(4);
  if (columns) {
    const headings = await header.evaluate((element) => Array.from(element.children).map((cell) => {
      const bounds = cell.getBoundingClientRect();
      return { x: bounds.x, width: bounds.width };
    }));
    expect(headings).toHaveLength(4);
    for (let index = 0; index < cells.length; index += 1) {
      expect(Math.abs(cells[index].x - headings[index].x), `column ${index + 1} start`).toBeLessThanOrEqual(1);
      expect(Math.abs(cells[index].width - headings[index].width), `column ${index + 1} width`).toBeLessThanOrEqual(1);
    }
  } else {
    for (let index = 1; index < cells.length; index += 1) {
      expect(cells[index].top).toBeGreaterThanOrEqual(cells[index - 1].bottom);
    }
  }
  const containment = await row.evaluate((element) => {
    const action = element.lastElementChild!;
    const bounds = action.getBoundingClientRect();
    return {
      rowOverflow: element.scrollWidth - element.clientWidth,
      actionOverflow: action.scrollWidth - action.clientWidth,
      controlsContained: Array.from(action.querySelectorAll('button')).every((button) => {
        const control = button.getBoundingClientRect();
        return control.left >= bounds.left - 1 && control.right <= bounds.right + 1;
      }),
    };
  });
  expect(containment.rowOverflow).toBeLessThanOrEqual(1);
  expect(containment.actionOverflow).toBeLessThanOrEqual(1);
  expect(containment.controlsContained).toBe(true);
}

async function verifyMaintenanceResponsiveRow(page: Page, header: Locator, row: Locator, width: number): Promise<void> {
  await expectMaintenanceColumns(header, row, width === 1280);
  if (width !== 1280) return;
  // Sidebar tablets have too little content width for four useful columns.
  await page.setViewportSize({ width: 768, height: 900 });
  try { await expectMaintenanceColumns(header, row, false); }
  finally { await page.setViewportSize({ width: 1280, height: 900 }); }
}

type DocumentFrameGeometry = {
  frameX: number; frameWidth: number;
  headerX: number; headerY: number; headerWidth: number; headerHeight: number;
  actionsX: number; actionsY: number; actionsHeight: number;
  rowHeight: number; metadataWraps: boolean;
};

async function measureDocumentFrame(dialog: Locator): Promise<DocumentFrameGeometry> {
  await expect.poll(() => dialog.evaluate((element) => element.getAnimations().filter(
    (animation) => animation.playState === 'running' || animation.pending,
  ).length)).toBe(0);
  return dialog.locator('[data-slot="contextual-documents-frame"]').evaluate((frame) => {
    const header = frame.querySelector('[data-slot="contextual-documents-header"]');
    const actions = frame.querySelector('[data-slot="contextual-documents-actions"]');
    const row = frame.querySelector('[data-slot="list-row"]');
    if (!header || !actions || !row) throw new Error('Document frame, toolbar and representative row must exist in both loading and loaded states.');
    const bounds = frame.getBoundingClientRect();
    const headerBounds = header.getBoundingClientRect();
    const actionBounds = actions.getBoundingClientRect();
    const metadata = row.firstElementChild?.lastElementChild;
    return {
      frameX: bounds.x, frameWidth: bounds.width,
      headerX: headerBounds.x - bounds.x, headerY: headerBounds.y - bounds.y,
      headerWidth: headerBounds.width, headerHeight: headerBounds.height,
      actionsX: actionBounds.x - bounds.x, actionsY: actionBounds.y - bounds.y,
      actionsHeight: actionBounds.height,
      rowHeight: row.getBoundingClientRect().height,
      metadataWraps: Boolean(metadata && metadata.getBoundingClientRect().height > Number.parseFloat(getComputedStyle(metadata).lineHeight) + 1),
    };
  });
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

  test("requires an explicit overlap reason @P1-20-audit-overlap",
    {
      annotation: [
        {
          type: "requires-test",
          description:
            "creates bounded exact owners without hidden work @P1-20-audit-setup",
        },
      ],
    },
    async ({
    adminPage,
    world,
  }) => {
    const fixture = names(world);
      const existingCoverage = await getMaintenanceCoverageStateByReference(
        world.orgId,
        fixture.coverageReference,
      );
      const existingPlans = existingCoverage
        ? await getMaintenancePlanNumbersByClient(
            world.orgId,
            existingCoverage.coverage.client_id,
          )
        : [];
      if (
        existingPlans.length > 1 &&
        !auditCheckpoint("p1-20.overlapValidationObserved")
      ) {
        throw new Error(
          "An overlapping plan already exists without this stage's validation proof. Run the fresh P1-20 audit group.",
        );
      }
      if (existingPlans.length < 2) {
        const dialog = await fillPlanDialog(adminPage, fixture);
    await dialog.getByRole("button", { name: "Wartungsplan anlegen" }).click();
    await expect(dialog.getByRole("alert")).toContainText(
      "Begründung erforderlich",
        );
        saveAuditCheckpoint("p1-20.overlapValidationObserved", true);
    await dialog
      .locator("#maintenance-overlap")
      .fill("Zweite Fachwartung deckt einen getrennten Anlagenumfang ab.");
    await dialog.getByRole("button", { name: "Wartungsplan anlegen" }).click();
    await expect(dialog).toHaveCount(0, { timeout: 20_000 });
      }

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

  test("links exact existing documents, follow-ups, and service context @P1-20-audit-links",
    {
      annotation: [
        {
          type: "requires-test",
          description:
            "creates bounded exact owners without hidden work @P1-20-audit-setup",
        },
        {
          type: "requires-test",
          description:
            "requires an explicit overlap reason @P1-20-audit-overlap",
        },
      ],
    }, async ({
    adminPage,
    world,
  }, testInfo) => {
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
    const coverageRow = adminPage.getByRole("main").getByTestId("maintenance-coverage-row")
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
        resolve(artifactsDirectory(), "upload-fixture.pdf"),
        "upload-fixture",
        { enclosingDialog: dialog },
      );
      await dialog.getByRole("button", { name: "Schließen" }).click();
    }

    if (existingPlan.serviceCaseLinks.length === 0) {
      await adminPage.goto("/service/wartung");
      const dueRow = adminPage.getByRole("main").getByTestId("maintenance-due-row")
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

    // Capture before the following lifecycle stage suspends/archives these plans.
    await adminPage.goto("/service/wartung");
    const populatedDueRow = adminPage.getByRole("main").getByTestId("maintenance-due-row")
      .filter({ hasText: planNumber }).filter({ hasText: FIRST_DUE_LABEL });
    await expect(populatedDueRow).toBeVisible();
    const duePanel = adminPage.getByRole("tabpanel").filter({ has: populatedDueRow });
    const dueHeader = duePanel.getByTestId("maintenance-due-header");
    const planRows = duePanel.getByTestId("maintenance-due-row").filter({ hasText: planNumber });
    const openPlanDue = plan.dueWork.filter((due) => ['open', 'visit_created'].includes(due.status));
    await expect(planRows).toHaveCount(openPlanDue.length);
    const lastDue = [...openPlanDue].sort((left, right) => left.due_date.localeCompare(right.due_date)).at(-1);
    if (!lastDue) throw new Error('Populated maintenance evidence requires an owned open due date.');
    const lastOwnedDueRow = duePanel.locator(`[data-testid="maintenance-due-row"][data-due-date="${lastDue.due_date}"]`).filter({ hasText: planNumber });
    await captureResponsiveSection(adminPage, testInfo, duePanel, "p120-maintenance-due-populated", async (width) => {
      await verifyMaintenanceResponsiveRow(adminPage, dueHeader, populatedDueRow, width);
      await expectMaintenanceColumns(dueHeader, lastOwnedDueRow, width === 1280);
      await lastOwnedDueRow.scrollIntoViewIfNeeded();
      await expect(lastOwnedDueRow).toBeInViewport({ ratio: 1 });
      if (width === 375) return populatedDueRow;
      await populatedDueRow.scrollIntoViewIfNeeded();
    });

    await adminPage.getByRole("tab", { name: /Abdeckungen/ }).click();
    await expect(coverageRow).toBeVisible();
    const coveragePanel = adminPage.getByRole("tabpanel").filter({ has: coverageRow });
    await captureResponsiveSection(adminPage, testInfo, coveragePanel, "p120-maintenance-coverage-populated", async (width) => {
      await verifyMaintenanceResponsiveRow(adminPage, coveragePanel.getByTestId("maintenance-coverage-header"), coverageRow, width);
      if (width === 375) return coverageRow;
    });

    const documentsDialog = adminPage.getByRole("dialog").filter({
      has: adminPage.getByRole("heading", { name: `Dokumente zu ${coverage.coverage.coverage_number}` }),
    });
    let releaseRead: () => void = () => undefined;
    const readReleased = new Promise<void>((resolveRead) => { releaseRead = resolveRead; });
    let interceptedRead = false;
    const heldReads: Promise<void>[] = [];
    const readUrl = new URL("/service/wartung", adminPage.url()).href;
    const holdCoverageRead = async (route: Route): Promise<void> => {
      const request = route.request();
      if (request.method() !== "POST" || !request.headers()["next-action"] ||
        !request.postData()?.includes(coverage.coverage.id)) {
        await route.continue();
        return;
      }
      // The opening effect reads documents for this exact coverage. Keep its real response.
      interceptedRead = true;
      const continued = readReleased.then(() => route.continue());
      heldReads.push(continued);
      await continued;
    };
    await adminPage.route(readUrl, holdCoverageRead);
    const loadingGeometry = new Map<number, DocumentFrameGeometry>();
    try {
      await coverageRow.getByRole("button", { name: "Dokumente" }).click();
      await expect.poll(() => interceptedRead, { message: "Exact coverage document read was intercepted" }).toBe(true);
      const loadingStatus = documentsDialog.locator('[role="status"][aria-busy="true"]')
        .filter({ hasText: "Dokumente werden geladen." });
      await expect(loadingStatus).toBeVisible();
      await captureResponsiveSection(adminPage, testInfo, documentsDialog,
        "p120-maintenance-documents-loading", async (width) => {
          await expect(loadingStatus).toBeVisible();
          loadingGeometry.set(width, await measureDocumentFrame(documentsDialog));
        });
    } finally {
      releaseRead();
      try {
        await Promise.all(heldReads);
      } finally {
        await adminPage.unroute(readUrl, holdCoverageRead);
      }
    }
    const loadedDocument = documentsDialog.getByTestId("contextual-documents-section")
      .getByText("upload-fixture").filter({ visible: true });
    await expect(loadedDocument).toBeVisible();
    await captureResponsiveSection(adminPage, testInfo, documentsDialog,
      "p120-maintenance-documents-loaded", async (width) => {
        await expect(loadedDocument).toBeVisible();
        const loading = loadingGeometry.get(width);
        if (!loading) throw new Error(`Missing document loading geometry at ${width}px.`);
        const loaded = await measureDocumentFrame(documentsDialog);
        for (const property of ['frameX', 'frameWidth', 'headerX', 'headerY', 'headerWidth', 'headerHeight', 'actionsY', 'actionsHeight'] as const) {
          expect(Math.abs(loaded[property] - loading[property]), `${width}px document ${property}`).toBeLessThanOrEqual(1);
        }
        // Placeholder label widths are approximate; toolbar height and its
        // position within the shared frame still have to match.
        expect(Math.abs(loaded.actionsX - loading.actionsX), `${width}px document actionsX`).toBeLessThanOrEqual(8);
        // Long real metadata may wrap on phones. Compare exact row height
        // only when its text fits the skeleton's single metadata line.
        if (!loaded.metadataWraps) expect(Math.abs(loaded.rowHeight - loading.rowHeight), `${width}px document row height`).toBeLessThanOrEqual(1);
      });
    await documentsDialog.getByRole("button", { name: "Schließen" }).click();
  });

  test("protects lifecycle updates and archives only terminal plans @P1-20-audit-lifecycle",
    {
      annotation: [
        {
          type: "requires-test",
          description:
            "creates bounded exact owners without hidden work @P1-20-audit-setup",
        },
        {
          type: "requires-test",
          description:
            "requires an explicit overlap reason @P1-20-audit-overlap",
        },
        {
          type: "requires-test",
          description:
            "links exact existing documents, follow-ups, and service context @P1-20-audit-links",
        },
      ],
    },
    async ({
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

  test("enforces manager and organization boundaries @P1-20-audit-boundary",
    {
      annotation: [
        {
          type: "requires-test",
          description:
            "creates bounded exact owners without hidden work @P1-20-audit-setup",
        },
        {
          type: "requires-test",
          description:
            "requires an explicit overlap reason @P1-20-audit-overlap",
        },
        {
          type: "requires-test",
          description:
            "links exact existing documents, follow-ups, and service context @P1-20-audit-links",
        },
        {
          type: "requires-test",
          description:
            "protects lifecycle updates and archives only terminal plans @P1-20-audit-lifecycle",
        },
      ],
    },
    async ({
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

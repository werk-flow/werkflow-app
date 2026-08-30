import { resolve } from "node:path";
import type { Locator, Page } from "@playwright/test";

import { expect, test } from "../../golden/support/fixtures";
import {
  getServiceCaseCountsAs,
  getServiceCaseNumberBySummary,
  getServiceCaseStateByNumber,
} from "../../golden/support/db";
import {
  berlinDateAtOffset,
  ownedBerlinDateAtOffset,
} from "../../golden/support/date-ownership";
import { requireChainedValue } from "../../golden/support/preconditions";
import { closeWorkArtifactDialog } from "../../golden/support/spec-helpers/work-artifact-dialog";
import {
  acknowledgeDispatchOnJobPage,
  addSiteOnCustomerDetail,
  convertRequestToServiceCase,
  createCustomer,
  createDirectServiceCase,
  createInstalledEquipment,
  createJob,
  createPlannedCalendarEntry,
  createRequestViaDialog,
  issueDispatchForOccurrence,
  openCustomerDetail,
  openDispatchPanel,
  openFieldWorkPack,
  selectFromSearchable,
  textInDom,
  typeIntoDateTimeField,
  updateServiceCaseViaDialog,
  uploadIntoDocumentsSection,
  visibleText,
} from "../../golden/support/steps";
import { ARTIFACTS_DIR, type TestWorld } from "../../golden/support/world";

test.describe.configure({ mode: "serial" });

const DATES = Array.from({ length: 5 }, (_, index) =>
  ownedBerlinDateAtOffset("p1-19", 100 + index),
);
const VISIT_DATE = berlinDateAtOffset(7);

function names(world: TestWorld) {
  return {
    customerName: `P119 Audit Kunde ${world.runId}`,
    primarySite: `P119 Audit Heizzentrale ${world.runId}`,
    otherSite: `P119 Audit Außenstelle ${world.runId}`,
    equipmentName: `P119 Audit Heizgerät ${world.runId}`,
    directSummary: `P119 Audit Direktfall ${world.runId}`,
    requestSummary: `P119 Audit Störungsmeldung ${world.runId}`,
    requestNumber: `P119-AUDIT-ANF-${world.runId}`,
    jobNumber: `AUF-${world.runId}-P119-AUDIT`,
    wrongSiteJobNumber: `AUF-${world.runId}-P119-OTHER`,
    jobTitle: `P119 Audit Serviceeinsatz ${world.runId}`,
    evidenceTitle: `P119 Audit Besuchsbericht ${world.runId}`,
    employeeName: `${world.users.employee.firstName} ${world.users.employee.lastName}`,
  };
}

async function createSubmittedReport(
  page: Page,
  title: string,
): Promise<void> {
  await page
    .getByTestId("work-artifacts-section")
    .getByRole("button", { name: "Neu" })
    .click();
  const dialog: Locator = page.getByRole("dialog");
  await dialog.getByRole("combobox", { name: "Art des Arbeitsnachweises" }).click();
  await page.getByRole("option", { name: "Arbeitsbericht", exact: true }).click();
  await dialog.getByLabel("Titel").fill(title);
  await dialog.getByLabel("Zusammenfassung").fill("Audit-Servicebesuch nachvollziehbar dokumentiert.");
  await typeIntoDateTimeField(dialog, "artifact-visit-start", `${VISIT_DATE}T06:00`);
  await typeIntoDateTimeField(dialog, "artifact-visit-end", `${VISIT_DATE}T08:00`);
  await dialog.getByLabel("Ausgeführte Arbeiten").fill("Fehler eingegrenzt und Anlage kontrolliert neu gestartet.");
  await dialog.getByRole("button", { name: "Zur Prüfung einreichen", exact: true }).click();
  await expect(dialog.getByText(/Version 1/)).toBeVisible({ timeout: 20_000 });
  await closeWorkArtifactDialog(dialog);
}

test.describe("P1-19 exhaustive reactive-service audit @AUDIT-W2-P1-19 @AUDIT-W2", () => {
  test("prepares exact existing owners @P1-19-audit-setup", async ({
    adminPage,
    world,
  }) => {
    const fixture = names(world);
    await createCustomer(adminPage, fixture.customerName);
    await openCustomerDetail(adminPage, fixture.customerName);
    await addSiteOnCustomerDetail(adminPage, {
      name: fixture.primarySite,
      street: "Auditserviceweg 19",
      postalCode: "10115",
      city: "Berlin",
      isPrimary: true,
    });
    await addSiteOnCustomerDetail(adminPage, {
      name: fixture.otherSite,
      street: "Auditserviceweg 20",
      postalCode: "10115",
      city: "Berlin",
    });
    await createInstalledEquipment(adminPage, {
      customerName: fixture.customerName,
      siteName: fixture.primarySite,
      name: fixture.equipmentName,
      state: "Aktiv",
      manufacturer: "Audit Service GmbH",
      model: "AS 19",
    });
    await createJob(adminPage, {
      jobNumber: fixture.jobNumber,
      title: fixture.jobTitle,
      clientName: fixture.customerName,
      siteName: fixture.primarySite,
      assignEmployeeName: fixture.employeeName,
    });
    await createJob(adminPage, {
      jobNumber: fixture.wrongSiteJobNumber,
      title: `P119 Audit falscher Ort ${world.runId}`,
      clientName: fixture.customerName,
      siteName: fixture.otherSite,
    });
  });

  test("owns direct and request intake without inventing parallel records @P1-19-audit-intake", async ({
    adminPage,
    world,
  }) => {
    const fixture = names(world);
    const directCaseNumber = await createDirectServiceCase(adminPage, {
      customerName: fixture.customerName,
      siteName: fixture.primarySite,
      statement: "Seit dem letzten Besuch tritt derselbe Fehler erneut auf.",
      summary: fixture.directSummary,
      chargeContextLabel: "Nacharbeit vermutet",
      equipmentName: fixture.equipmentName,
    });
    await createRequestViaDialog(adminPage, {
      summary: fixture.requestSummary,
      requestNumber: fixture.requestNumber,
      clientName: fixture.customerName,
      siteName: fixture.primarySite,
      details: "Originale Meldung mit unverändertem technischen Wortlaut.",
      urgencyLabel: "Hoch",
      receivedAtLocal: `${DATES[0]}T06:00`,
    });
    const requestCaseNumber = await convertRequestToServiceCase(adminPage);

    const direct = await getServiceCaseStateByNumber(world.orgId, directCaseNumber);
    const request = await getServiceCaseStateByNumber(world.orgId, requestCaseNumber);
    expect(direct.serviceCase.intake_type).toBe("direct");
    expect(direct.serviceCase.source_request_id).toBeNull();
    expect(request.serviceCase).toMatchObject({
      intake_type: "request",
      original_statement: fixture.requestSummary,
      original_details: "Originale Meldung mit unverändertem technischen Wortlaut.",
    });
    expect(request.serviceCase.source_request_id).not.toBeNull();
    expect(direct.equipmentLinks).toHaveLength(1);
    expect(request.equipmentLinks).toHaveLength(0);
  });

  test("searches by exact linked owner without inventing links @P1-19-audit-search", async ({
    adminPage,
    world,
  }) => {
    const fixture = names(world);
    requireChainedValue(
      await getServiceCaseNumberBySummary(world.orgId, fixture.requestSummary),
      {
        test: "P1-19 audit search",
        needs: "the direct and request cases from the intake stage",
        grep: "@P1-19-audit-setup|@P1-19-audit-intake|@P1-19-audit-search",
        suite: "audit",
      },
    );
    await adminPage.goto("/service/faelle");
    const search = adminPage.getByLabel("Servicefälle durchsuchen");
    await search.fill(fixture.equipmentName);
    await expect(adminPage.getByRole("link").filter({ hasText: fixture.directSummary })).toBeVisible();
    await expect(adminPage.getByRole("link").filter({ hasText: fixture.requestSummary })).toHaveCount(0);
    await search.fill(fixture.requestSummary);
    await expect(adminPage.getByRole("link").filter({ hasText: fixture.requestSummary })).toBeVisible();
  });

  test("enforces exact site links, stale protection, and case relations @P1-19-audit-triage", async ({
    adminPage,
    bueroPage,
    world,
  }) => {
    const fixture = names(world);
    const caseNumber = requireChainedValue(
      (await getServiceCaseNumberBySummary(world.orgId, fixture.requestSummary)) ??
        (await getServiceCaseNumberBySummary(
          world.orgId,
          `P119 Audit freigegeben ${world.runId}`,
        )),
      {
        test: "P1-19 audit triage",
        needs: "the request case from the audit intake stage",
        grep: "@P1-19-audit-setup|@P1-19-audit-intake|@P1-19-audit-search|@P1-19-audit-triage",
        suite: "audit",
      },
    );
    const directCaseNumber = requireChainedValue(
      await getServiceCaseNumberBySummary(world.orgId, fixture.directSummary),
      {
        test: "P1-19 audit triage relation",
        needs: "the direct case from the audit intake stage",
        grep: "@P1-19-audit-setup|@P1-19-audit-intake|@P1-19-audit-search|@P1-19-audit-triage",
        suite: "audit",
      },
    );
    await adminPage.goto(`/service/faelle/${caseNumber}`);
    await adminPage.getByRole("button", { name: "Bearbeiten" }).click();
    const selectionDialog = adminPage.getByRole("dialog");
    await selectionDialog.locator("#service-job").click();
    const listbox = adminPage.getByRole("listbox");
    await expect(listbox.getByText(fixture.jobNumber, { exact: false })).toBeVisible();
    await expect(listbox.getByText(fixture.wrongSiteJobNumber, { exact: false })).toHaveCount(0);
    await adminPage.keyboard.press("Escape");
    await expect(listbox).toHaveCount(0);
    await expect(selectionDialog).toBeVisible();
    await selectionDialog.getByRole("button", { name: "Abbrechen" }).click();

    await updateServiceCaseViaDialog(adminPage, {
      statusLabel: "Einsatz erforderlich",
      urgencyLabel: "Notfall",
      chargeContextLabel: "Gewährleistung vermutet",
      jobNumber: fixture.jobNumber,
      accessInstructions: "Schlüssel im Büro abholen; Heizzentrale im Untergeschoss.",
      triageNote: "Gewährleistung und Berechnung bleiben ausdrücklich ungeklärt.",
      equipmentName: fixture.equipmentName,
      reason: "Einsatz nach fachlicher Triage vorbereitet",
    });
    await expect(visibleText(adminPage, fixture.jobNumber)).toBeVisible({ timeout: 20_000 });

    await bueroPage.goto(`/service/faelle/${caseNumber}`);
    await bueroPage.getByRole("button", { name: "Bearbeiten" }).click();
    const staleDialog = bueroPage.getByRole("dialog");
    await staleDialog.locator("#service-triage").fill("Diese Eingabe darf nicht den neueren Stand überschreiben.");
    await staleDialog.locator("#service-reason").fill("Parallelprüfung aus dem Büro");
    await updateServiceCaseViaDialog(adminPage, {
      summary: `P119 Audit freigegeben ${world.runId}`,
      reason: "Aktueller Stand durch Admin bestätigt",
    });
    await expect(
      adminPage.getByRole("heading", {
        name: `P119 Audit freigegeben ${world.runId}`,
        exact: true,
      }),
    ).toBeVisible({ timeout: 20_000 });
    await staleDialog.getByRole("button", { name: "Speichern", exact: true }).click();
    await expect(staleDialog.getByRole("alert")).toContainText("inzwischen geändert");
    await staleDialog.getByRole("button", { name: "Abbrechen" }).click();
    const afterConflict = await getServiceCaseStateByNumber(world.orgId, caseNumber);
    expect(afterConflict.serviceCase.triage_note).toContain(
      "Gewährleistung und Berechnung bleiben ausdrücklich ungeklärt",
    );
    expect(afterConflict.serviceCase.triage_note).not.toContain(
      "darf nicht den neueren Stand überschreiben",
    );

    const relationSection = adminPage.getByTestId("service-case-relations");
    await relationSection.getByRole("button", { name: "Verknüpfen" }).click();
    const relationDialog = adminPage.getByRole("dialog");
    await selectFromSearchable(
      adminPage,
      relationDialog.getByText("Servicefall suchen", { exact: true }),
      directCaseNumber,
    );
    await relationDialog.locator("#relation-type").click();
    await adminPage.getByRole("option", { name: "Fortsetzung von", exact: true }).click();
    await relationDialog.locator("#relation-reason").fill("Wiederkehrende Störung an derselben Kundenanlage");
    await relationDialog.getByRole("button", { name: "Verknüpfen" }).click();
    await expect(relationSection).toContainText(directCaseNumber, { timeout: 20_000 });
  });

  test("reuses dispatch and limits field privacy @P1-19-audit-dispatch", async ({
    adminPage,
    employeePage,
    world,
  }) => {
    const fixture = names(world);
    const caseNumber = requireChainedValue(
      await getServiceCaseNumberBySummary(world.orgId, `P119 Audit freigegeben ${world.runId}`),
      {
        test: "P1-19 audit dispatch",
        needs: "the triaged case from the prior audit stage",
        grep: "@P1-19-audit-setup|@P1-19-audit-intake|@P1-19-audit-search|@P1-19-audit-triage|@P1-19-audit-dispatch",
        suite: "audit",
      },
    );
    await createPlannedCalendarEntry(adminPage, {
      kind: "job_visit",
      jobSearch: fixture.jobNumber,
      date: VISIT_DATE,
      time: "06:00",
      employeeNames: [fixture.employeeName],
      overrideReason: "Audit-Serviceeinsatz ist fachlich bestätigt",
    });
    await openDispatchPanel(adminPage, VISIT_DATE);
    await issueDispatchForOccurrence(adminPage, fixture.jobTitle);
    await acknowledgeDispatchOnJobPage(employeePage, fixture.jobNumber);
    const pack = await openFieldWorkPack(employeePage, fixture.jobNumber);
    await expect(pack).toContainText(caseNumber);
    await expect(pack).toContainText(fixture.equipmentName);
    await expect(pack).toContainText("Schlüssel im Büro abholen");
    await expect(pack).not.toContainText("Gewährleistung vermutet");
    await expect(pack).not.toContainText("Berechnung bleiben ausdrücklich ungeklärt");
  });

  test("reuses the exact submitted evidence revision @P1-19-audit-evidence", async ({
    adminPage,
    employeePage,
    world,
  }) => {
    const fixture = names(world);
    const caseNumber = requireChainedValue(
      await getServiceCaseNumberBySummary(world.orgId, `P119 Audit freigegeben ${world.runId}`),
      {
        test: "P1-19 audit evidence",
        needs: "the triaged and dispatched case from the prior audit stage",
        grep: "@P1-19-audit-setup|@P1-19-audit-intake|@P1-19-audit-search|@P1-19-audit-triage|@P1-19-audit-dispatch|@P1-19-audit-evidence",
        suite: "audit",
      },
    );
    await employeePage.goto(`/auftraege/${fixture.jobNumber}`);
    await createSubmittedReport(employeePage, fixture.evidenceTitle);

    await adminPage.goto(`/service/faelle/${caseNumber}`);
    const evidenceSection = adminPage.getByTestId("service-case-evidence");
    await evidenceSection.getByRole("button", { name: "Verknüpfen" }).click();
    const evidenceDialog = adminPage.getByRole("dialog");
    await selectFromSearchable(
      adminPage,
      evidenceDialog.getByText("Arbeitsnachweis suchen", { exact: true }),
      fixture.evidenceTitle,
    );
    await evidenceDialog.getByRole("button", { name: "Verknüpfen" }).click();
    await expect(evidenceSection).toContainText(fixture.evidenceTitle, { timeout: 20_000 });
  });

  test("links an uploaded document to the exact service case @P1-19-audit-document", async ({
    adminPage,
    world,
  }) => {
    const caseNumber = requireChainedValue(
      await getServiceCaseNumberBySummary(world.orgId, `P119 Audit freigegeben ${world.runId}`),
      {
        test: "P1-19 audit document",
        needs: "the service case from the evidence stage",
        grep: "@P1-19-audit-setup|@P1-19-audit-intake|@P1-19-audit-search|@P1-19-audit-triage|@P1-19-audit-dispatch|@P1-19-audit-evidence|@P1-19-audit-document",
        suite: "audit",
      },
    );
    await adminPage.goto(`/service/faelle/${caseNumber}`);
    await uploadIntoDocumentsSection(
      adminPage,
      resolve(ARTIFACTS_DIR, "upload-fixture.pdf"),
      "upload-fixture",
    );
    const state = await getServiceCaseStateByNumber(world.orgId, caseNumber);
    expect(state.documentLinks).toHaveLength(1);
    expect(state.documentLinks[0]?.service_case_id).toBe(state.serviceCase.id);
  });

  test("reuses a follow-up owner and records the outcome @P1-19-audit-outcome", async ({
    adminPage,
    world,
  }) => {
    const caseNumber = requireChainedValue(
      await getServiceCaseNumberBySummary(world.orgId, `P119 Audit freigegeben ${world.runId}`),
      {
        test: "P1-19 audit outcome",
        needs: "the exact document link from the document stage",
        grep: "@P1-19-audit-setup|@P1-19-audit-intake|@P1-19-audit-search|@P1-19-audit-triage|@P1-19-audit-dispatch|@P1-19-audit-evidence|@P1-19-audit-document|@P1-19-audit-outcome",
        suite: "audit",
      },
    );
    await adminPage.goto(`/service/faelle/${caseNumber}`);
    await adminPage
      .getByTestId("service-case-follow-up")
      .getByRole("button", { name: "Nachfassaktion anlegen" })
      .click();
    const followUpDialog = adminPage.getByRole("dialog");
    await followUpDialog.locator("#service-follow-up-note").fill("Kaufmännische Gewährleistungsprüfung getrennt nachhalten.");
    await followUpDialog.getByRole("button", { name: "Speichern" }).click();
    await expect(followUpDialog).toHaveCount(0, { timeout: 20_000 });

    await updateServiceCaseViaDialog(adminPage, {
      statusLabel: "Nacharbeit erforderlich",
      reason: "Besuch beendet, weiterer klarer Schritt erforderlich",
    });
    await expect(visibleText(adminPage, "Nacharbeit erforderlich")).toBeVisible({ timeout: 20_000 });
    const afterOutcome = await getServiceCaseStateByNumber(world.orgId, caseNumber);
    expect(afterOutcome.serviceCase.triage_note).toContain(
      "Gewährleistung und Berechnung bleiben ausdrücklich ungeklärt",
    );
    expect(afterOutcome.serviceCase.job_id).not.toBeNull();
  });

  test("proves history and manager boundaries @P1-19-audit-boundary", async ({
    employeePage,
    outsiderPage,
    world,
  }) => {
    const caseNumber = requireChainedValue(
      await getServiceCaseNumberBySummary(world.orgId, `P119 Audit freigegeben ${world.runId}`),
      {
        test: "P1-19 audit boundary",
        needs: "the completed evidence and follow-up state from the outcome stage",
        grep: "@P1-19-audit-setup|@P1-19-audit-intake|@P1-19-audit-search|@P1-19-audit-triage|@P1-19-audit-dispatch|@P1-19-audit-evidence|@P1-19-audit-document|@P1-19-audit-outcome|@P1-19-audit-boundary",
        suite: "audit",
      },
    );
    const state = await getServiceCaseStateByNumber(world.orgId, caseNumber);
    expect(state.serviceCase.status).toBe("follow_up_required");
    expect(state.evidenceLinks).toHaveLength(1);
    expect(state.documentLinks).toHaveLength(1);
    expect(state.followUps).toHaveLength(1);
    expect(state.events.map((event) => event.event_type)).toEqual(
      expect.arrayContaining([
        "created",
        "status_changed",
        "relation_linked",
        "evidence_linked",
        "document_linked",
      ]),
    );

    await employeePage.goto("/service/faelle");
    await expect(employeePage).not.toHaveURL(/\/service\/faelle/);
    await outsiderPage.goto(`/service/faelle/${caseNumber}`);
    await expect(textInDom(outsiderPage, state.serviceCase.summary)).toHaveCount(0);
    await expect(textInDom(outsiderPage, caseNumber)).toHaveCount(0);
    const employeeCounts = await getServiceCaseCountsAs(
      world.users.employee,
      world.orgId,
      state.serviceCase.id,
    );
    const outsiderCounts = await getServiceCaseCountsAs(
      world.outsider.admin,
      world.orgId,
      state.serviceCase.id,
    );
    expect(Object.values(employeeCounts).every((count) => count === 0)).toBe(true);
    expect(Object.values(outsiderCounts).every((count) => count === 0)).toBe(true);
  });
});

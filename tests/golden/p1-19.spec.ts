import type { Locator, Page } from "@playwright/test";

import { closeWorkArtifactDialog } from "./support/spec-helpers/work-artifact-dialog";
import { expect, test } from "./support/fixtures";
import {
  getServiceCaseCountsAs,
  getServiceCaseNumberBySummary,
  getServiceCaseStateByNumber,
} from "./support/db";
import {
  berlinDateAtOffset,
  ownedBerlinDateAtOffset,
} from "./support/date-ownership";
import { expectLiveWithin } from "./support/live";
import { requireChainedValue } from "./support/preconditions";
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
  visibleText,
} from "./support/steps";
import type { TestWorld } from "./support/world";

test.describe.configure({ mode: "serial" });

const DATES = Array.from({ length: 5 }, (_, index) =>
  ownedBerlinDateAtOffset("p1-19", 100 + index),
);
const VISIT_DATE = berlinDateAtOffset(7);

function names(world: TestWorld) {
  return {
    customerName: `P119 Golden Kunde ${world.runId}`,
    siteName: `P119 Golden Heizzentrale ${world.runId}`,
    equipmentName: `P119 Golden Wärmeerzeuger ${world.runId}`,
    directSummary: `P119 direkter Wiederholungsfall ${world.runId}`,
    requestSummary: `P119 Heizung ausgefallen ${world.runId}`,
    requestNumber: `P119-ANF-${world.runId}`,
    jobNumber: `AUF-${world.runId}-P119-SERVICE`,
    jobTitle: `P119 Serviceeinsatz ${world.runId}`,
    evidenceTitle: `P119 Servicebericht ${world.runId}`,
    liveSummary: `P119 live aktualisiert ${world.runId}`,
    employeeName: `${world.users.employee.firstName} ${world.users.employee.lastName}`,
  };
}

async function beginWorkReport(
  page: Page,
  title: string,
): Promise<Locator> {
  await page
    .getByTestId("work-artifacts-section")
    .getByRole("button", { name: "Neu" })
    .click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("combobox", { name: "Art des Arbeitsnachweises" }).click();
  await page.getByRole("option", { name: "Arbeitsbericht", exact: true }).click();
  await dialog.getByLabel("Titel").fill(title);
  await dialog.getByLabel("Zusammenfassung").fill("Störung geprüft und Betrieb wiederhergestellt.");
  return dialog;
}

test.describe("P1-19 reactive service vertical slice @P1-19 @GG-05", () => {
  test("prepares exact service owners @P1-19-stage-setup", async ({
    adminPage,
    world,
  }) => {
    const fixture = names(world);
    await createCustomer(adminPage, fixture.customerName);
    await openCustomerDetail(adminPage, fixture.customerName);
    await addSiteOnCustomerDetail(adminPage, {
      name: fixture.siteName,
      street: "Serviceweg 19",
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
      model: "SRV 19",
    });
    await createJob(adminPage, {
      jobNumber: fixture.jobNumber,
      title: fixture.jobTitle,
      clientName: fixture.customerName,
      siteName: fixture.siteName,
      assignEmployeeName: fixture.employeeName,
    });
  });

  test("preserves direct intake identity @P1-19-stage-direct-intake", async ({
    adminPage,
    world,
  }) => {
    const fixture = names(world);
    const directCaseNumber = await createDirectServiceCase(adminPage, {
      customerName: fixture.customerName,
      siteName: fixture.siteName,
      statement: "Die Anlage macht wieder dieselben Geräusche.",
      summary: fixture.directSummary,
      urgencyLabel: "Normal",
      chargeContextLabel: "Nacharbeit vermutet",
      equipmentName: fixture.equipmentName,
    });
    const directState = await getServiceCaseStateByNumber(world.orgId, directCaseNumber);
    expect(directState.serviceCase).toMatchObject({
      intake_type: "direct",
      source_request_id: null,
      original_statement: "Die Anlage macht wieder dieselben Geräusche.",
      charge_context: "suspected_rework",
    });
  });

  test("preserves request conversion identity @P1-19-stage-request-intake", async ({
    adminPage,
    world,
  }) => {
    const fixture = names(world);
    await createRequestViaDialog(adminPage, {
      summary: fixture.requestSummary,
      requestNumber: fixture.requestNumber,
      clientName: fixture.customerName,
      siteName: fixture.siteName,
      details: "Die Kundin meldet kalte Heizkörper seit dem frühen Morgen.",
      urgencyLabel: "Hoch",
      receivedAtLocal: `${DATES[0]}T06:00`,
    });
    const requestCaseNumber = await convertRequestToServiceCase(adminPage);
    await expect(visibleText(adminPage, "Ursprüngliche Anfrage öffnen")).toBeVisible();
    const requestState = await getServiceCaseStateByNumber(world.orgId, requestCaseNumber);
    expect(requestState.serviceCase).toMatchObject({
      intake_type: "request",
      original_statement: fixture.requestSummary,
      original_details: "Die Kundin meldet kalte Heizkörper seit dem frühen Morgen.",
      urgency: "hoch",
    });
    expect(requestState.serviceCase.source_request_id).not.toBeNull();
    expect(requestState.events.map((event) => event.event_type)).toEqual(["created"]);
  });

  test("triages, links exact work, and dispatches @P1-19-stage-dispatch", async ({
    adminPage,
    employeePage,
    world,
  }) => {
    const fixture = names(world);
    const requestCaseNumber = requireChainedValue(
      await getServiceCaseNumberBySummary(world.orgId, fixture.requestSummary),
      {
        test: "P1-19 dispatch stage",
        needs: "the request-owned service case from the request-intake stage",
        grep: "@P1-19-stage-setup|@P1-19-stage-request-intake|@P1-19-stage-dispatch",
        suite: "golden",
      },
    );
    const directCaseNumber = requireChainedValue(
      await getServiceCaseNumberBySummary(world.orgId, fixture.directSummary),
      {
        test: "P1-19 dispatch relation",
        needs: "the direct repeat case from the direct-intake stage",
        grep: "@P1-19-stage-setup|@P1-19-stage-direct-intake|@P1-19-stage-request-intake|@P1-19-stage-dispatch",
        suite: "golden",
      },
    );
    await adminPage.goto(`/service/faelle/${requestCaseNumber}`);
    await updateServiceCaseViaDialog(adminPage, {
      statusLabel: "Einsatz erforderlich",
      urgencyLabel: "Notfall",
      chargeContextLabel: "Gewährleistung vermutet",
      jobNumber: fixture.jobNumber,
      accessInstructions: "Zugang über den Hof; Heizraum links.",
      triageNote: "Kein Rechtsentscheid; Serienfehler nur als Verdacht.",
      equipmentName: fixture.equipmentName,
      reason: "Einsatz nach telefonischer Rückfrage vorbereitet",
    });
    await expect(visibleText(adminPage, fixture.jobNumber)).toBeVisible({ timeout: 20_000 });

    const relations = adminPage.getByTestId("service-case-relations");
    await relations.getByRole("button", { name: "Verknüpfen" }).click();
    const relationDialog = adminPage.getByRole("dialog");
    await selectFromSearchable(
      adminPage,
      relationDialog.getByText("Servicefall suchen", { exact: true }),
      directCaseNumber,
    );
    await relationDialog.locator("#relation-type").click();
    await adminPage.getByRole("option", { name: "Fortsetzung von", exact: true }).click();
    await relationDialog.locator("#relation-reason").fill("Wiederkehrendes Fehlerbild derselben Kundenanlage");
    await relationDialog.getByRole("button", { name: "Verknüpfen" }).click();
    await expect(visibleText(adminPage, `Fortsetzung von ${directCaseNumber}`)).toBeVisible({ timeout: 20_000 });

    await createPlannedCalendarEntry(adminPage, {
      kind: "job_visit",
      jobSearch: fixture.jobNumber,
      date: VISIT_DATE,
      time: "06:00",
      employeeNames: [fixture.employeeName],
      overrideReason: "Bestätigter dringender Serviceeinsatz",
    });
    await openDispatchPanel(adminPage, VISIT_DATE);
    await issueDispatchForOccurrence(adminPage, fixture.jobTitle);
    await acknowledgeDispatchOnJobPage(employeePage, fixture.jobNumber);

    const state = await getServiceCaseStateByNumber(world.orgId, requestCaseNumber);
    expect(state.serviceCase).toMatchObject({
      status: "visit_required",
      urgency: "notfall",
      charge_context: "suspected_warranty",
    });
    expect(state.serviceCase.job_id).not.toBeNull();
    expect(state.equipmentLinks).toHaveLength(1);
    expect(state.relations).toHaveLength(1);
  });

  test("limits the field projection @P1-19-stage-field-projection", async ({
    employeePage,
    world,
  }) => {
    const fixture = names(world);
    const requestCaseNumber = requireChainedValue(
      await getServiceCaseNumberBySummary(world.orgId, fixture.requestSummary),
      {
        test: "P1-19 field-projection stage",
        needs: "the dispatched service case from the dispatch stage",
        grep: "@P1-19-stage-setup|@P1-19-stage-request-intake|@P1-19-stage-dispatch|@P1-19-stage-field-projection",
        suite: "golden",
      },
    );
    const pack = await openFieldWorkPack(employeePage, fixture.jobNumber);
    await expect(pack).toContainText(requestCaseNumber);
    await expect(pack).toContainText(fixture.equipmentName);
    await expect(pack).toContainText("Zugang über den Hof; Heizraum links.");
    await expect(pack).not.toContainText("Gewährleistung vermutet");
    await expect(pack).not.toContainText("Kein Rechtsentscheid");
  });

  test("links exact visit evidence and an existing follow-up owner @P1-19-stage-follow-up", async ({
    adminPage,
    employeePage,
    world,
  }) => {
    const fixture = names(world);
    const caseNumber = requireChainedValue(
      await getServiceCaseNumberBySummary(world.orgId, fixture.requestSummary),
      {
        test: "P1-19 follow-up stage",
        needs: "the dispatched service case from the dispatch stage",
        grep: "@P1-19-stage-setup|@P1-19-stage-direct-intake|@P1-19-stage-request-intake|@P1-19-stage-dispatch|@P1-19-stage-field-projection|@P1-19-stage-follow-up",
        suite: "golden",
      },
    );
    await employeePage.goto(`/auftraege/${fixture.jobNumber}`);
    const workReport = await beginWorkReport(employeePage, fixture.evidenceTitle);
    await typeIntoDateTimeField(workReport, "artifact-visit-start", `${VISIT_DATE}T06:00`);
    await typeIntoDateTimeField(workReport, "artifact-visit-end", `${VISIT_DATE}T07:30`);
    await workReport.getByLabel("Ausgeführte Arbeiten").fill("Regelung geprüft und Anlage neu gestartet.");
    await workReport.getByRole("button", { name: "Zur Prüfung einreichen", exact: true }).click();
    await expect(workReport.getByText(/Version 1/)).toBeVisible({ timeout: 20_000 });
    await closeWorkArtifactDialog(workReport);

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

    await adminPage
      .getByTestId("service-case-follow-up")
      .getByRole("button", { name: "Nachfassaktion anlegen" })
      .click();
    const followUpDialog = adminPage.getByRole("dialog");
    await followUpDialog.locator("#service-follow-up-note").fill("Gewährleistungsunterlagen im Büro prüfen.");
    await followUpDialog.getByRole("button", { name: "Speichern" }).click();
    await expect(followUpDialog).toHaveCount(0, { timeout: 20_000 });

    const state = await getServiceCaseStateByNumber(world.orgId, caseNumber);
    expect(state.evidenceLinks).toHaveLength(1);
    expect(state.followUps).toHaveLength(1);
    expect(state.followUps[0]).toMatchObject({
      source_type: "service_case",
      source_id: state.serviceCase.id,
      status: "open",
    });
  });

  test("refreshes managers across sessions @P1-19-stage-realtime", async ({
    adminPage,
    bueroPage,
    world,
  }) => {
    const fixture = names(world);
    const caseNumber = requireChainedValue(
      await getServiceCaseNumberBySummary(world.orgId, fixture.requestSummary),
      {
        test: "P1-19 realtime stage",
        needs: "the service case retained by the earlier P1-19 stages",
        grep: "@P1-19-stage-setup|@P1-19-stage-direct-intake|@P1-19-stage-request-intake|@P1-19-stage-dispatch|@P1-19-stage-field-projection|@P1-19-stage-follow-up|@P1-19-stage-realtime",
        suite: "golden",
      },
    );
    await adminPage.goto(`/service/faelle/${caseNumber}`);
    await bueroPage.goto(`/service/faelle/${caseNumber}`);
    await updateServiceCaseViaDialog(adminPage, {
      summary: fixture.liveSummary,
      reason: "Kurzbeschreibung nach Rückmeldung berichtigt",
    });
    await expectLiveWithin(
      bueroPage.getByRole("heading", { name: fixture.liveSummary }),
      { label: "P1-19 service case cross-session refresh" },
    );
  });

  test("denies service-wide employee and outsider access @P1-19-stage-boundary", async ({
    employeePage,
    outsiderPage,
    world,
  }) => {
    const fixture = names(world);
    const caseNumber = requireChainedValue(
      await getServiceCaseNumberBySummary(world.orgId, fixture.liveSummary),
      {
        test: "P1-19 boundary stage",
        needs: "the live-updated service case from the realtime stage",
        grep: "@P1-19-stage-setup|@P1-19-stage-direct-intake|@P1-19-stage-request-intake|@P1-19-stage-dispatch|@P1-19-stage-field-projection|@P1-19-stage-follow-up|@P1-19-stage-realtime|@P1-19-stage-boundary",
        suite: "golden",
      },
    );
    await employeePage.goto("/service/faelle");
    await expect(employeePage).not.toHaveURL(/\/service\/faelle/);
    await outsiderPage.goto(`/service/faelle/${caseNumber}`);
    await expect(textInDom(outsiderPage, fixture.liveSummary)).toHaveCount(0);
    await expect(textInDom(outsiderPage, caseNumber)).toHaveCount(0);

    const state = await getServiceCaseStateByNumber(world.orgId, caseNumber);
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

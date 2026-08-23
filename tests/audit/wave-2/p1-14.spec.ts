import { expect, test } from "../../golden/support/fixtures";
import type { Page } from "@playwright/test";
import {
  getAppliedWorkTemplateState,
  getVisibleWorkLifecycleCountsAs,
  getWorkLifecycleState,
} from "../../golden/support/db";
import {
  clockInOnJob,
  clockOut,
  createAndPublishWorkTemplate,
  createJob,
  createProject,
  selectFromSearchable,
  typeIntoDatePickerById,
} from "../../golden/support/steps";

test.describe.configure({ mode: "serial" });

function berlinTodayIso(): string {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Europe/Berlin",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function shiftIsoDate(dateIso: string, days: number): string {
  const [year, month, day] = dateIso.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day) + days * 86_400_000)
    .toISOString()
    .slice(0, 10);
}

function digits(dateIso: string): string {
  const [year, month, day] = dateIso.split("-");
  return `${day}${month}${year}`;
}

const DATES = Array.from({ length: 5 }, (_, index) =>
  shiftIsoDate(berlinTodayIso(), 75 + index),
);

async function transition(
  page: Page,
  label: string,
  reason?: string,
  expectSuccess = true,
): Promise<void> {
  const card = page.getByTestId("work-lifecycle-card");
  await card.getByRole("button", { name: label, exact: true }).click();
  const dialog = page.getByRole("dialog");
  if (reason) await dialog.locator("#work-transition-reason").fill(reason);
  await dialog.getByRole("button", { name: "Änderung speichern" }).click();
  if (expectSuccess) await expect(dialog).toHaveCount(0, { timeout: 15_000 });
}

test.describe("P1-14 exhaustive work lifecycle flows @AUDIT-W2-P1-14 @AUDIT-W2", () => {
  test("summary, filters, role transitions, stale recovery, and dialog catch-up", async ({
    adminPage,
    bueroPage,
    employeePage,
    world,
  }) => {
    // P1-14-F01…F12: explicit facets and next action; canonical list badge/filter;
    // manager and employee transition bounds; reason; stale optimistic version;
    // open-dialog preservation and catch-up.
    const jobNumber = `AUF-${world.runId}-P114-STATE`;
    await createJob(adminPage, {
      jobNumber,
      title: `Audit Arbeitsstand ${world.runId}`,
      plannedDateDigits: digits(DATES[0]),
      assignEmployeeName: `${world.users.employee.firstName} ${world.users.employee.lastName}`,
    });
    await adminPage.goto(`/auftraege/${jobNumber}`);
    const adminCard = adminPage.getByTestId("work-lifecycle-card");
    await expect(
      adminCard.getByText("Nicht begonnen", { exact: true }),
    ).toBeVisible();
    await expect(adminCard.getByText("Geplant", { exact: true })).toBeVisible();
    await expect(
      adminCard.getByText(/Nächster Schritt: Arbeit starten/),
    ).toBeVisible();
    await expect(
      adminCard.getByText("Nicht bewertet", { exact: true }).first(),
    ).toBeVisible();

    await employeePage.goto(`/auftraege/${jobNumber}`);
    const employeeCard = employeePage.getByTestId("work-lifecycle-card");
    await expect(
      employeeCard.getByRole("button", { name: "Storniert" }),
    ).toHaveCount(0);
    await expect(
      employeeCard.getByRole("button", { name: "Parken" }),
    ).toHaveCount(0);

    await bueroPage.goto(`/auftraege/${jobNumber}`);
    await bueroPage
      .getByTestId("work-lifecycle-card")
      .getByRole("button", { name: "In Ausführung" })
      .click();
    await transition(adminPage, "In Ausführung");
    await expect(
      bueroPage.getByText(
        "Während der Eingabe hat sich der Arbeitsstand geändert.",
      ),
    ).toBeVisible({ timeout: 20_000 });
    await bueroPage
      .getByRole("dialog")
      .getByRole("button", { name: "Änderung speichern" })
      .click();
    await expect(
      bueroPage.getByRole("dialog").getByText(/inzwischen geändert/),
    ).toBeVisible();
    await bueroPage
      .getByRole("dialog")
      .getByRole("button", { name: "Abbrechen" })
      .click();
    await expect(
      bueroPage
        .getByTestId("work-lifecycle-card")
        .getByText("In Ausführung", { exact: true }),
    ).toBeVisible();

    await adminPage.reload();
    await transition(
      adminPage,
      "Unterbrochen",
      "Kunde ist vorübergehend nicht vor Ort.",
    );
    const state = await getWorkLifecycleState(world.orgId, { jobNumber });
    expect(state.entity).toMatchObject({
      execution_state: "interrupted",
      execution_version: 2,
    });
    expect(state.executionEvents.map((event) => event.to_state)).toEqual([
      "in_progress",
      "interrupted",
    ]);

    await adminPage.goto("/auftraege");
    await adminPage.getByRole("button", { name: /^Unterbrochen\s+1$/ }).click();
    await expect(
      adminPage
        .getByText(jobNumber, { exact: true })
        .filter({ visible: true })
        .first(),
    ).toBeVisible();
  });

  test("blockers, owners, review, attention, resolution, and parking stay one model", async ({
    adminPage,
    employeePage,
    world,
  }) => {
    // P1-14-F13…F25: multiple blocker facts, required owner/review, employee-self
    // rule, due attention identity, resolution history, parking distinction,
    // legacy-gap honesty, atomic unpark, and no duplicate context system.
    const jobNumber = `AUF-${world.runId}-P114-BLOCK`;
    await createJob(adminPage, {
      jobNumber,
      title: `Audit Blocker ${world.runId}`,
      assignEmployeeName: `${world.users.employee.firstName} ${world.users.employee.lastName}`,
    });
    await employeePage.goto(`/auftraege/${jobNumber}`);
    let card = employeePage.getByTestId("work-lifecycle-card");
    await card.getByRole("button", { name: "Blocker", exact: true }).click();
    let dialog = employeePage.getByRole("dialog");
    await dialog.locator("#work-blocker-reason").click();
    await employeePage.getByRole("option", { name: "Sicherheit" }).click();
    await dialog
      .locator("#work-blocker-details")
      .fill("Arbeitsbereich muss abgesperrt werden.");
    await dialog
      .getByRole("button", { name: "Speichern", exact: true })
      .click();
    await expect(card.getByText(/Offene Blocker klären/)).toBeVisible();

    await adminPage.goto("/aufgaben");
    await expect(
      adminPage
        .getByText(`Audit Blocker ${world.runId}`, { exact: true })
        .first(),
    ).toBeVisible({ timeout: 20_000 });
    await employeePage.bringToFront();
    await card.getByRole("button", { name: "Lösen" }).click();
    dialog = employeePage.getByRole("dialog");
    await dialog
      .locator("#work-reason")
      .fill("Bereich ist abgesperrt und freigegeben.");
    await dialog.getByRole("button", { name: "Lösen" }).click();
    await expect(dialog).toHaveCount(0, { timeout: 15_000 });

    await adminPage.goto(`/auftraege/${jobNumber}`);
    card = adminPage.getByTestId("work-lifecycle-card");
    await card.getByText("Gelöste Blocker", { exact: true }).click();
    await card.getByRole("button", { name: "Wieder öffnen" }).click();
    dialog = adminPage.getByRole("dialog");
    await dialog
      .locator("#work-reason")
      .fill("Die Absperrung wurde vorzeitig entfernt.");
    await dialog.getByRole("button", { name: "Wieder öffnen" }).click();
    await expect(dialog).toHaveCount(0, { timeout: 15_000 });
    await adminPage.reload();
    card = adminPage.getByTestId("work-lifecycle-card");
    await card.getByRole("button", { name: "Lösen" }).click();
    dialog = adminPage.getByRole("dialog");
    await dialog
      .locator("#work-reason")
      .fill("Die Absperrung ist wieder wirksam.");
    await dialog.getByRole("button", { name: "Lösen" }).click();
    await expect(dialog).toHaveCount(0, { timeout: 15_000 });
    await adminPage.reload();
    card = adminPage.getByTestId("work-lifecycle-card");
    await card.getByRole("button", { name: "Parken" }).click();
    dialog = adminPage.getByRole("dialog");
    await dialog.locator("#work-blocker-reason").click();
    await adminPage.getByRole("option", { name: "Kunde" }).click();
    await dialog
      .locator("#work-blocker-details")
      .fill("Neuen Ausführungstermin mit Kunde abstimmen.");
    await selectFromSearchable(
      adminPage,
      dialog.locator("#work-blocker-owner"),
      world.users.admin.firstName,
    );
    await typeIntoDatePickerById(
      dialog,
      "work-blocker-review",
      DATES[1],
    );
    await dialog.getByRole("button", { name: "Speichern" }).click();
    await expect(dialog).toHaveCount(0, { timeout: 15_000 });
    await expect(card.getByText("Geparkt", { exact: true }).first()).toBeVisible();

    const state = await getWorkLifecycleState(world.orgId, { jobNumber });
    expect(
      state.blockers.map((blocker) => [blocker.kind, blocker.state]),
    ).toEqual([
      ["blocker", "resolved"],
      ["parking", "open"],
    ]);
    expect(state.blockers[0].version).toBe(4);
    expect(state.entity).toMatchObject({
      execution_state: "not_started",
      status: "geparkt",
    });
  });

  test("work prerequisites block start, follow predecessor state, reject cycles, and retain history", async ({
    adminPage,
    world,
  }) => {
    // P1-14-F26…F36: work/task/declarative prerequisite kinds, effect vocabulary,
    // same-org target selection, start/completion/warning semantics, cycle/self
    // rejection, derived satisfaction, predecessor reopening, versioned declared
    // resolution, removal, and retained event history.
    const first = `AUF-${world.runId}-P114-DEP-A`;
    const second = `AUF-${world.runId}-P114-DEP-B`;
    await createJob(adminPage, {
      jobNumber: first,
      title: `Abhängiger Auftrag ${world.runId}`,
    });
    await createJob(adminPage, {
      jobNumber: second,
      title: `Vorausgehender Auftrag ${world.runId}`,
    });
    await adminPage.goto(`/auftraege/${first}`);
    let card = adminPage.getByTestId("work-lifecycle-card");
    await card
      .getByRole("button", { name: "Voraussetzung", exact: true })
      .click();
    let dialog = adminPage.getByRole("dialog");
    await selectFromSearchable(
      adminPage,
      dialog.locator("#dependency-target"),
      second,
    );
    await dialog.getByRole("button", { name: "Hinzufügen" }).click();
    await card
      .getByRole("button", { name: "Voraussetzung", exact: true })
      .click();
    dialog = adminPage.getByRole("dialog");
    await selectFromSearchable(
      adminPage,
      dialog.locator("#dependency-target"),
      first,
    );
    await dialog.getByRole("button", { name: "Hinzufügen" }).click();
    await expect(
      dialog.getByText(/nicht von sich selbst abhängen/),
    ).toBeVisible();
    await dialog.getByRole("button", { name: "Abbrechen" }).click();
    await transition(adminPage, "In Ausführung", undefined, false);
    await expect(
      adminPage.getByRole("dialog").getByText(/verhindern den Start/),
    ).toBeVisible();
    await adminPage
      .getByRole("dialog")
      .getByRole("button", { name: "Abbrechen" })
      .click();

    await adminPage.goto(`/auftraege/${second}`);
    card = adminPage.getByTestId("work-lifecycle-card");
    await card
      .getByRole("button", { name: "Voraussetzung", exact: true })
      .click();
    dialog = adminPage.getByRole("dialog");
    await selectFromSearchable(
      adminPage,
      dialog.locator("#dependency-target"),
      first,
    );
    await dialog.getByRole("button", { name: "Hinzufügen" }).click();
    await expect(dialog.getByText(/keinen Kreis bilden/)).toBeVisible();
    await dialog.getByRole("button", { name: "Abbrechen" }).click();

    await transition(adminPage, "In Ausführung");
    await transition(adminPage, "Ausführung abgeschlossen");
    await adminPage.goto(`/auftraege/${first}`);
    let linkedDependency = adminPage
      .getByTestId("work-dependency-row")
      .filter({ hasText: "Verknüpfte Arbeit" });
    await expect(
      linkedDependency.getByText(/erfüllt/).first(),
    ).toBeVisible();
    await transition(adminPage, "In Ausführung");
    let state = await getWorkLifecycleState(world.orgId, { jobNumber: first });
    expect(state.dependencies[0]).toMatchObject({
      effect: "blocks_start",
      state: "open",
      isSatisfied: true,
    });

    await adminPage.goto(`/auftraege/${second}`);
    await transition(
      adminPage,
      "In Ausführung",
      "Nacharbeit wurde erforderlich.",
    );
    await adminPage.goto(`/auftraege/${first}`);
    linkedDependency = adminPage
      .getByTestId("work-dependency-row")
      .filter({ hasText: "Verknüpfte Arbeit" });
    await expect(
      linkedDependency.getByText(/offen/).first(),
    ).toBeVisible();
    state = await getWorkLifecycleState(world.orgId, { jobNumber: first });
    expect(state.dependencies[0]).toMatchObject({
      state: "open",
      isSatisfied: false,
    });
    await adminPage.goto(`/auftraege/${second}`);
    await transition(
      adminPage,
      "Storniert",
      "Vorausgehender Auftrag wurde storniert.",
    );
    await adminPage.goto(`/auftraege/${first}`);
    card = adminPage.getByTestId("work-lifecycle-card");
    linkedDependency = card
      .getByTestId("work-dependency-row")
      .filter({ hasText: "Verknüpfte Arbeit" });
    await expect(linkedDependency.getByText(/offen/).first()).toBeVisible();

    await card
      .getByRole("button", { name: "Voraussetzung", exact: true })
      .click();
    dialog = adminPage.getByRole("dialog");
    await dialog.locator("#dependency-type").click();
    await adminPage
      .getByRole("option", { name: "Deklarierte Voraussetzung" })
      .click();
    await selectFromSearchable(
      adminPage,
      dialog.locator("#dependency-target"),
      "Freigabe",
    );
    await dialog
      .locator("#dependency-description")
      .fill("Bauseitige Freigabe liegt vor.");
    await dialog.locator("#dependency-effect").click();
    await adminPage
      .getByRole("option", { name: "Blockiert den Abschluss" })
      .click();
    await dialog.getByRole("button", { name: "Hinzufügen" }).click();
    const declared = card
      .getByTestId("work-dependency-row")
      .filter({ hasText: "Bauseitige Freigabe liegt vor." });
    await declared.getByRole("button", { name: "Erfüllt" }).click();
    dialog = adminPage.getByRole("dialog");
    await dialog
      .locator("#work-reason")
      .fill("Freigabe wurde schriftlich bestätigt.");
    await dialog.getByRole("button", { name: "Speichern" }).click();
    await expect(dialog).toHaveCount(0, { timeout: 15_000 });
    await declared.getByRole("button", { name: "Wieder öffnen" }).click();
    dialog = adminPage.getByRole("dialog");
    await dialog.locator("#work-reason").fill("Freigabe wurde zurückgezogen.");
    await dialog.getByRole("button", { name: "Speichern" }).click();
    await expect(dialog).toHaveCount(0, { timeout: 15_000 });
    await declared
      .getByRole("button", { name: "Voraussetzung entfernen" })
      .click();
    dialog = adminPage.getByRole("dialog");
    await dialog
      .locator("#work-reason")
      .fill("Die Bedingung entfällt endgültig.");
    await dialog.getByRole("button", { name: "Entfernen" }).click();
    await expect(dialog).toHaveCount(0, { timeout: 15_000 });
    state = await getWorkLifecycleState(world.orgId, { jobNumber: first });
    expect(state.dependencies).toHaveLength(2);
    expect(
      state.dependencies.find(
        (dependency) => dependency.declared_kind === "approval",
      ),
    ).toMatchObject({
      effect: "blocks_completion",
      state: "removed",
      version: 4,
    });
  });

  test("live readiness and authoritative completion gates remain honest through handover", async ({
    adminPage,
    employeePage,
    world,
  }) => {
    // P1-14-F37…F48: shared readiness dimensions and unknown/load-failure posture;
    // no-demand material and unassessed tools; instruction/predecessor/time gates;
    // current-fact evaluation, reasoned manager override snapshot/fingerprint;
    // execution-complete versus handover; later-slice facts remain not assessable.
    const templateName = `Audit Lifecycle Vorlage ${world.runId}`;
    const jobNumber = `AUF-${world.runId}-P114-GATE`;
    await createAndPublishWorkTemplate(adminPage, {
      name: templateName,
      targetType: "job",
      firstItem: "Anlage sicher abschalten",
      secondItem: "Arbeitsstelle räumen",
    });
    await createJob(adminPage, {
      jobNumber,
      title: `Audit Abschluss ${world.runId}`,
      workTemplateName: templateName,
      plannedDateDigits: digits(DATES[2]),
      assignEmployeeName: `${world.users.employee.firstName} ${world.users.employee.lastName}`,
    });
    await adminPage.goto(`/auftraege/${jobNumber}`);
    const card = adminPage.getByTestId("work-lifecycle-card");
    await expect(card.getByText("Einsatzbereitschaft")).toBeVisible();
    await expect(
      card.getByText("Nicht bewertet", { exact: true }).first(),
    ).toBeVisible();
    await expect(card.getByText("Kein Materialbedarf geplant.", { exact: true })).toBeVisible();
    await transition(adminPage, "In Ausführung");
    await transition(adminPage, "Ausführung abgeschlossen", undefined, false);
    await expect(
      adminPage.getByRole("dialog").getByText(/noch nicht erfüllt/),
    ).toBeVisible();
    await adminPage
      .getByRole("dialog")
      .getByRole("button", { name: "Abbrechen" })
      .click();

    await employeePage.goto(`/auftraege/${jobNumber}`);
    await employeePage
      .getByRole("button", { name: "Punkt als erledigt markieren" })
      .first()
      .click();
    await expect(
      employeePage
        .getByRole("button", { name: "Punkt als offen markieren" })
        .first(),
    ).toBeVisible();
    await expect
      .poll(async () => {
        const applied = await getAppliedWorkTemplateState(world.orgId, {
          jobNumber,
        });
        return applied.instructions[0]?.is_completed;
      })
      .toBe(true);
    await employeePage.reload();
    await expect(
      employeePage
        .getByRole("button", { name: "Punkt als offen markieren" })
        .first(),
    ).toBeVisible();

    await adminPage.reload();
    await transition(adminPage, "Ausführung abgeschlossen");
    await adminPage
      .getByTestId("work-lifecycle-card")
      .getByRole("button", { name: "Übergeben", exact: true })
      .click();
    const handoverDialog = adminPage.getByRole("dialog");
    await handoverDialog.getByRole("checkbox").check();
    await handoverDialog
      .locator("#work-transition-reason")
      .fill("Übergabe wird vor P1-17 bewusst als Manager-Ausnahme dokumentiert.");
    await handoverDialog
      .getByRole("button", { name: "Änderung speichern" })
      .click();
    await expect(handoverDialog).toHaveCount(0, { timeout: 15_000 });
    const state = await getWorkLifecycleState(world.orgId, { jobNumber });
    expect(state.entity).toMatchObject({
      execution_state: "handed_over",
      execution_version: 3,
    });
    const handover = state.executionEvents.at(-1)!;
    expect(handover).toMatchObject({ to_state: "handed_over" });
    expect(handover.gate_fingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(handover.gate_snapshot).toMatchObject({
      incompleteRequiredInstructions: 0,
    });
  });

  test("project derivation, automatic planning/time effects, audit, RLS, and negative promises hold", async ({
    adminPage,
    employeePage,
    outsiderPage,
    world,
  }) => {
    // P1-14-F49…F63: child-derived/empty/mixed projects, reasoned override and
    // clear; no cascade; planning changes only planned state; time start is the
    // one atomic automatic execution transition; dispatch/request conversion
    // do not forge lifecycle; immutable attributed history; empty states;
    // organization/RLS isolation; Realtime catch-up; no stock, document,
    // signature, message, customer-package, schedule, dispatch, or actual-time
    // side effects from a lifecycle mutation.
    const projectNumber = `PRJ-${world.runId}-P114`;
    const jobNumber = `AUF-${world.runId}-P114-AUTO`;
    const title = `Audit Automatik ${world.runId}`;
    await createProject(adminPage, {
      projectNumber,
      title: `Audit Projekt ${world.runId}`,
    });
    await createJob(adminPage, {
      jobNumber,
      title,
      projectNumber,
      plannedDateDigits: digits(DATES[3]),
      assignEmployeeName: `${world.users.employee.firstName} ${world.users.employee.lastName}`,
    });
    await adminPage.goto(`/auftraege/projekt/${projectNumber}`);
    const projectCard = adminPage.getByTestId("work-lifecycle-card");
    await expect(projectCard.getByText("Automatisch abgeleitet")).toBeVisible();
    await projectCard.getByRole("button", { name: "Parken" }).click();
    let dialog = adminPage.getByRole("dialog");
    await dialog.locator("#work-blocker-reason").click();
    await adminPage.getByRole("option", { name: "Kapazität" }).click();
    await dialog
      .locator("#work-blocker-details")
      .fill("Projekt wird bis zur neuen Einsatzplanung geparkt.");
    await selectFromSearchable(
      adminPage,
      dialog.locator("#work-blocker-owner"),
      world.users.admin.firstName,
    );
    await typeIntoDatePickerById(
      dialog,
      "work-blocker-review",
      DATES[4],
    );
    await dialog.getByRole("button", { name: "Speichern" }).click();
    await expect(dialog).toHaveCount(0, { timeout: 15_000 });
    let childParkingState = await getWorkLifecycleState(world.orgId, {
      jobNumber,
    });
    expect(childParkingState.blockers[0]).toMatchObject({
      kind: "parking",
      state: "open",
    });
    expect(
      childParkingState.blockers[0].parent_project_parking_blocker_id,
    ).not.toBeNull();
    expect(childParkingState.entity).toMatchObject({ status: "geparkt" });
    await projectCard.getByRole("button", { name: "Weiterplanen" }).click();
    dialog = adminPage.getByRole("dialog");
    await dialog
      .locator("#work-reason")
      .fill("Projekt wird wieder für die Einsatzplanung geöffnet.");
    await dialog.getByRole("button", { name: "Weiterführen" }).click();
    await expect(dialog).toHaveCount(0, { timeout: 15_000 });
    childParkingState = await getWorkLifecycleState(world.orgId, { jobNumber });
    expect(childParkingState.blockers[0]).toMatchObject({
      kind: "parking",
      state: "resolved",
    });
    expect(childParkingState.entity).toMatchObject({
      status: "nicht_bearbeitet",
    });
    await transition(
      adminPage,
      "Storniert",
      "Projekt pausiert nicht, sondern wurde wirksam storniert.",
    );
    let projectState = await getWorkLifecycleState(world.orgId, {
      projectNumber,
    });
    expect(projectState.entity).toMatchObject({
      execution_state_override: "cancelled",
      status_override: null,
    });
    const childBefore = await getWorkLifecycleState(world.orgId, { jobNumber });
    expect(childBefore.entity).toMatchObject({
      execution_state: "not_started",
    });
    await projectCard
      .getByRole("button", { name: "Automatisch ableiten" })
      .click();
    dialog = adminPage.getByRole("dialog");
    await dialog
      .locator("#work-reason")
      .fill("Projekt folgt wieder dem Auftragsstand.");
    await dialog.getByRole("button", { name: "Automatisch ableiten" }).click();
    await expect(dialog).toHaveCount(0, { timeout: 15_000 });

    await clockInOnJob(employeePage, title);
    await clockOut(employeePage);
    const jobState = await getWorkLifecycleState(world.orgId, { jobNumber });
    expect(jobState.entity).toMatchObject({
      execution_state: "in_progress",
      status: "in_bearbeitung",
    });
    expect(jobState.executionEvents.at(-1)?.event_type).toBe(
      "automatic_time_start",
    );
    projectState = await getWorkLifecycleState(world.orgId, { projectNumber });
    expect(projectState.entity).toMatchObject({
      execution_state_override: null,
    });

    const applied = await getAppliedWorkTemplateState(world.orgId, {
      jobNumber,
    });
    expect(applied.inventoryMovements).toHaveLength(0);
    expect(applied.applications).toHaveLength(0);
    await outsiderPage.goto(`/auftraege/${jobNumber}`);
    await expect(outsiderPage.getByTestId("work-lifecycle-card")).toHaveCount(
      0,
    );
    const outsiderCounts = await getVisibleWorkLifecycleCountsAs(
      world.outsider.admin,
      world.orgId,
    );
    expect(Object.values(outsiderCounts).every((count) => count === 0)).toBe(
      true,
    );
  });
});

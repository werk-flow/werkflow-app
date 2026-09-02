import { expect, test } from "./support/fixtures";
import { getEmployeeRecordStateByUser, getP124CountsAs, getP124State } from "./support/db";
import { expectLiveWithin } from "./support/live";
import { openMemberDetailFromList, selectFromSearchable, textInDom, visibleText } from "./support/steps";

test.describe.configure({ mode: "serial" });

let employeeRecordId = "";
const templateName = "Sicherer Einstieg";
const acknowledgementTitle = "Betriebsregeln bestätigen";
const protectedFileName = "willkommen-p1-24.txt";

async function openEmployeeLifecycle(page: Parameters<typeof openMemberDetailFromList>[0], name: string) {
  await openMemberDetailFromList(page, name);
  return page.getByTestId("personnel-lifecycle");
}

test.describe("P1-24 controlled people lifecycle @P1-24 @GG-07", () => {
  test("creates an explicit template and editable onboarding plan @P1-24-stage-setup", async ({ adminPage, world }) => {
    const employee = await getEmployeeRecordStateByUser(world.orgId, world.users.employee.id);
    employeeRecordId = employee.id;

    await adminPage.goto("/einstellungen/mitarbeiter");
    if (await visibleText(adminPage, templateName).count() === 0) {
      await expect(visibleText(adminPage, "Noch keine Vorlage eingerichtet.")).toBeVisible();
      await adminPage.getByRole("button", { name: "Vorlage", exact: true }).click();
      const templateDialog = adminPage.getByRole("dialog", { name: "Onboardingvorlage veröffentlichen" });
      await templateDialog.getByLabel("Name").fill(templateName);
      await selectFromSearchable(
        adminPage,
        templateDialog.getByRole("combobox").filter({ hasText: "Manueller Punkt" }),
        "Bestätigung",
      );
      await templateDialog.getByLabel("Erster Punkt").fill(acknowledgementTitle);
      await templateDialog.getByText("Blockiert die Zugangsaktivierung").click();
      await templateDialog.getByRole("button", { name: "Veröffentlichen" }).click();
    }
    await expect(visibleText(adminPage, templateName)).toBeVisible({ timeout: 15_000 });

    const employeeName = `${world.users.employee.firstName} ${world.users.employee.lastName}`;
    const lifecycle = await openEmployeeLifecycle(adminPage, employeeName);
    await expect(lifecycle.getByText("Noch keine kontrollierte Zugangsregel.")).toBeVisible();
    if (await visibleText(lifecycle, acknowledgementTitle).count() === 0) {
      await lifecycle.getByRole("button", { name: "Plan anlegen" }).click();
      const planDialog = adminPage.getByRole("dialog", { name: "Onboardingplan anlegen" });
      await selectFromSearchable(
        adminPage,
        planDialog.getByRole("combobox").filter({ hasText: "Ohne Vorlage" }),
        "Sicherer Einstieg · Version 1",
      );
      await planDialog.getByRole("button", { name: "Plan anlegen" }).click();
    }
    await expect(visibleText(lifecycle, acknowledgementTitle)).toBeVisible({ timeout: 15_000 });

    const state = await getP124State(world.orgId);
    expect(state.plans.length).toBeGreaterThanOrEqual(1);
    expect(state.requirements.length).toBeGreaterThanOrEqual(1);
    expect(state.requirements.find((item) => item.title === acknowledgementTitle)).toMatchObject({
      requirement_type: "acknowledgement",
      blocks_access: true,
      state: "missing",
    });
  });

  test("releases one protected version and records exact employee receipts @P1-24-stage-documents-onboarding", async ({ adminPage, employeePage, world }) => {
    employeeRecordId = (await getEmployeeRecordStateByUser(world.orgId, world.users.employee.id)).id;
    const precondition = await getP124State(world.orgId);
    expect(precondition.requirements.some((item) => item.title === acknowledgementTitle)).toBe(true);
    await employeePage.goto("/aufgaben");
    const employeeName = `${world.users.employee.firstName} ${world.users.employee.lastName}`;
    const lifecycle = await openEmployeeLifecycle(adminPage, employeeName);
    let stageState = await getP124State(world.orgId);
    let expectedDocument = stageState.protectedDocuments.find((item) =>
      item.employee_record_id === employeeRecordId &&
      (item.documents as { display_name: string }).display_name === protectedFileName
    );
    if (!expectedDocument) {
      await lifecycle.getByRole("button", { name: "Datei", exact: true }).click();
      const uploadDialog = adminPage.getByRole("dialog", { name: "Geschützte Personalunterlage" });
      await uploadDialog.getByLabel("Datei").setInputFiles({
        name: protectedFileName,
        mimeType: "text/plain",
        buffer: Buffer.from("P1-24 protected acceptance file"),
      });
      await uploadDialog.getByLabel("Dokumentart").fill("Willkommensunterlage");
      await uploadDialog.getByRole("button", { name: "Hochladen" }).click();
    }
    await expect(visibleText(lifecycle, protectedFileName)).toBeVisible({ timeout: 20_000 });
    stageState = await getP124State(world.orgId);
    expectedDocument = stageState.protectedDocuments.find((item) =>
      item.employee_record_id === employeeRecordId &&
      (item.documents as { display_name: string }).display_name === protectedFileName
    );
    expect(expectedDocument).toBeDefined();
    if (!stageState.releases.some((item) => item.personnel_document_id === expectedDocument?.id)) {
      await lifecycle.getByRole("listitem").filter({ hasText: protectedFileName })
        .getByRole("button", { name: "Freigeben" }).click();
    }

    await expectLiveWithin(visibleText(employeePage, protectedFileName), {
      label: "released protected personnel document",
    });
    stageState = await getP124State(world.orgId);
    const expectedRequirement = stageState.requirements.find(
      (item) =>
        item.employee_record_id === employeeRecordId &&
        item.title === acknowledgementTitle,
    );
    expect(expectedRequirement).toBeDefined();
    if (!stageState.acknowledgements.some((item) =>
      item.employee_record_id === employeeRecordId &&
      item.requirement_id === expectedRequirement?.id &&
      item.acknowledgement_kind === "requirement_completed"
    )) {
      await employeePage.getByRole("button", { name: "Bestätigen", exact: true }).click();
    }
    stageState = await getP124State(world.orgId);
    if (!stageState.acknowledgements.some((item) =>
      item.employee_record_id === employeeRecordId &&
      item.personnel_document_id === expectedDocument?.id &&
      item.acknowledgement_kind === "document_received"
    )) {
      await employeePage.getByRole("button", { name: "Erhalt bestätigen" }).click();
    }
    await expectLiveWithin(visibleText(lifecycle, "Keine offenen Anforderungen."), {
      label: "employee acknowledgement reflected in manager lifecycle",
    });

    const state = await getP124State(world.orgId);
    const finalDocument = state.protectedDocuments.find((item) =>
      item.employee_record_id === employeeRecordId &&
      (item.documents as { display_name: string }).display_name === protectedFileName
    );
    expect(finalDocument).toBeDefined();
    expect(state.releases.filter((item) => item.personnel_document_id === finalDocument?.id)).toHaveLength(1);
    expect(state.acknowledgements.filter((item) =>
      item.employee_record_id === employeeRecordId &&
      (item.requirement_id === expectedRequirement?.id ||
        item.personnel_document_id === finalDocument?.id)
    ).map((item) => item.acknowledgement_kind).sort()).toEqual([
      "document_received",
      "requirement_completed",
    ]);
  });

  test("suspends only this organization and preserves reversible transition history @P1-24-stage-access-transition", async ({ adminPage, employeePage, world }) => {
    employeeRecordId = (await getEmployeeRecordStateByUser(world.orgId, world.users.employee.id)).id;
    const precondition = await getP124State(world.orgId);
    expect(precondition.acknowledgements.some((item) =>
      item.employee_record_id === employeeRecordId &&
      item.acknowledgement_kind === "requirement_completed"
    )).toBe(true);
    const employeeName = `${world.users.employee.firstName} ${world.users.employee.lastName}`;
    const lifecycle = await openEmployeeLifecycle(adminPage, employeeName);
    let transitionState = await getP124State(world.orgId);
    if (!transitionState.accessTransitions.some((item) =>
      item.employee_record_id === employeeRecordId &&
      item.transition_kind === "activate_now"
    )) {
      await lifecycle.getByRole("button", { name: "Zugang steuern" }).click();
      const dialog = adminPage.getByRole("dialog", { name: "Organisationszugang steuern" });
      await selectFromSearchable(adminPage, dialog.getByRole("combobox"), "Jetzt aktivieren");
      await dialog.getByLabel("Grund").fill("Kontrollierten Zugang starten");
      await dialog.getByRole("button", { name: "Speichern" }).click();
      await expect(dialog).toBeHidden({ timeout: 15_000 });
    }
    await expect(visibleText(lifecycle, "Aktiv")).toBeVisible({ timeout: 15_000 });

    transitionState = await getP124State(world.orgId);
    if (!transitionState.accessTransitions.some((item) =>
      item.employee_record_id === employeeRecordId &&
      item.transition_kind === "suspend_now"
    )) {
      await lifecycle.getByRole("button", { name: "Zugang steuern" }).click();
      const dialog = adminPage.getByRole("dialog", { name: "Organisationszugang steuern" });
      await selectFromSearchable(adminPage, dialog.getByRole("combobox"), "Sofort sperren");
      await dialog.getByLabel("Grund").fill("Sofortige Organisationssperre");
      await dialog.getByRole("button", { name: "Speichern" }).click();
      await expect(dialog).toBeHidden({ timeout: 15_000 });
    }
    await expect(visibleText(lifecycle, "Gesperrt")).toBeVisible({ timeout: 15_000 });

    await employeePage.goto("/aufgaben");
    await expect(employeePage).not.toHaveURL(/\/aufgaben/, { timeout: 15_000 });

    transitionState = await getP124State(world.orgId);
    if (!transitionState.accessTransitions.some((item) =>
      item.employee_record_id === employeeRecordId &&
      item.transition_kind === "reactivate"
    )) {
      await lifecycle.getByRole("button", { name: "Zugang steuern" }).click();
      const dialog = adminPage.getByRole("dialog", { name: "Organisationszugang steuern" });
      await selectFromSearchable(adminPage, dialog.getByRole("combobox"), "Reaktivieren");
      await dialog.getByLabel("Grund").fill("Zugang kontrolliert reaktiviert");
      await dialog.getByRole("button", { name: "Speichern" }).click();
      await expect(dialog).toBeHidden({ timeout: 15_000 });
    }
    await expect(visibleText(lifecycle, "Aktiv")).toBeVisible({ timeout: 15_000 });

    const state = await getP124State(world.orgId);
    const employeeAccess = state.access.filter(
      (item) => item.employee_record_id === employeeRecordId,
    );
    const employeeAccessTransitions = state.accessTransitions.filter(
      (item) => item.employee_record_id === employeeRecordId,
    );
    expect(employeeAccess).toHaveLength(1);
    expect(employeeAccessTransitions.map((item) => item.transition_kind)).toEqual([
      "activate_now",
      "suspend_now",
      "reactivate",
    ]);
    expect(employeeAccess[0]?.state).toBe("active");
  });

  test("keeps protected data outside the ordinary library and outsider organization @P1-24-stage-boundaries", async ({ adminPage, outsiderPage, world }) => {
    employeeRecordId = (await getEmployeeRecordStateByUser(world.orgId, world.users.employee.id)).id;
    await adminPage.goto("/dokumente");
    await expect(textInDom(adminPage, protectedFileName)).toHaveCount(0);

    const employeeName = `${world.users.employee.firstName} ${world.users.employee.lastName}`;
    const lifecycle = await openEmployeeLifecycle(adminPage, employeeName);
    const download = adminPage.waitForEvent("download");
    await lifecycle.getByRole("button", { name: "Arbeitsstand exportieren" }).click();
    expect((await download).suggestedFilename()).toContain(employeeRecordId);

    const outsiderCounts = await getP124CountsAs(world.outsider.admin, world.orgId);
    for (const [table, count] of Object.entries(outsiderCounts)) {
      expect(count, `outsider read ${table}`).toBe(0);
    }
    await outsiderPage.goto(`/mitarbeiter/${employeeRecordId}`);
    await expect(outsiderPage).not.toHaveURL(new RegExp(employeeRecordId), { timeout: 15_000 });

    const state = await getP124State(world.orgId);
    expect(state.operations.length).toBeGreaterThanOrEqual(8);
    expect(state.events.some((event) => event.event_type === "access_transition")).toBe(true);
    expect(state.events.some((event) => event.event_type === "personnel_document_uploaded")).toBe(true);
  });
});

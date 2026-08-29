import { expect, test } from "../../golden/support/fixtures";
import {
  getInstalledEquipmentNumberByName,
  getInstalledEquipmentState,
} from "../../golden/support/db";
import { ownedBerlinDateAtOffset } from "../../golden/support/date-ownership";
import { requireChainedValue } from "../../golden/support/preconditions";
import {
  addSiteOnCustomerDetail,
  correctInstalledEquipmentTerminalAction,
  createCustomer,
  createInstalledEquipment,
  createJob,
  expectDuplicateInstalledEquipmentRejected,
  openCustomerDetail,
  openInstalledEquipmentByName,
  openInstalledEquipmentWorkLinkDialog,
  replaceInstalledEquipment,
  transitionInstalledEquipment,
  visibleText,
} from "../../golden/support/steps";
import type { TestWorld } from "../../golden/support/world";

test.describe.configure({ mode: "serial" });

const INSTALLATION_DATE = ownedBerlinDateAtOffset("p1-18", 95);

function names(world: TestWorld) {
  return {
    customerName: `P118 Audit Kunde ${world.runId}`,
    primarySite: `P118 Audit Zentrale ${world.runId}`,
    secondarySite: `P118 Audit Außenstelle ${world.runId}`,
    rootName: `P118 Audit Wärmeerzeuger ${world.runId}`,
    componentName: `P118 Audit Umwälzpumpe ${world.runId}`,
    successorName: `P118 Audit Wärmeerzeuger neu ${world.runId}`,
    serialNumber: `P118-AUDIT-SER-${world.runId}`,
    validJobNumber: `AUF-${world.runId}-P118-SAME-SITE`,
    wrongSiteJobNumber: `AUF-${world.runId}-P118-WRONG-SITE`,
    employeeName: `${world.users.employee.firstName} ${world.users.employee.lastName}`,
  };
}

test.describe("P1-18 exhaustive installed-equipment audit @AUDIT-W2-P1-18 @AUDIT-W2", () => {
  test("owns bounded root, component, site, identifier, missing-data, and search contracts", async ({
    adminPage,
    world,
  }) => {
    const fixture = names(world);
    await createCustomer(adminPage, fixture.customerName);
    await openCustomerDetail(adminPage, fixture.customerName);
    await addSiteOnCustomerDetail(adminPage, {
      name: fixture.primarySite,
      street: "Auditweg 18",
      postalCode: "10115",
      city: "Berlin",
      isPrimary: true,
    });
    await addSiteOnCustomerDetail(adminPage, {
      name: fixture.secondarySite,
      street: "Auditweg 19",
      postalCode: "10115",
      city: "Berlin",
    });
    await createJob(adminPage, {
      jobNumber: fixture.validJobNumber,
      title: `P118 Audit gleicher Einsatzort ${world.runId}`,
      clientName: fixture.customerName,
      siteName: fixture.primarySite,
      assignEmployeeName: fixture.employeeName,
    });
    await createJob(adminPage, {
      jobNumber: fixture.wrongSiteJobNumber,
      title: `P118 Audit anderer Einsatzort ${world.runId}`,
      clientName: fixture.customerName,
      siteName: fixture.secondarySite,
    });
    const rootNumber = await createInstalledEquipment(adminPage, {
      customerName: fixture.customerName,
      siteName: fixture.primarySite,
      name: fixture.rootName,
      state: "Aktiv",
      manufacturer: "Audit Hersteller",
      serialNumber: fixture.serialNumber,
      installationDate: INSTALLATION_DATE,
    });
    const componentNumber = await createInstalledEquipment(adminPage, {
      customerName: fixture.customerName,
      siteName: fixture.primarySite,
      name: fixture.componentName,
      category: "Anlagenkomponente",
      parentName: fixture.rootName,
    });
    await expect(
      visibleText(adminPage, `Übergeordnet: ${fixture.rootName}`),
    ).toBeVisible();
    await expect(
      adminPage.getByTestId("equipment-fact-manufacturer"),
    ).toContainText("Nicht erfasst");
    await expect(
      adminPage.getByTestId("equipment-fact-commissioning"),
    ).toContainText("Nicht erfasst");
    await expect(
      visibleText(adminPage, "Keine Kennung erfasst."),
    ).toBeVisible();
    await adminPage.goto(`/service/anlagen/${rootNumber}`);
    await expect(
      visibleText(adminPage, `Komponente: ${fixture.componentName}`),
    ).toBeVisible();

    const component = await getInstalledEquipmentState(
      world.orgId,
      componentNumber,
    );
    const root = await getInstalledEquipmentState(world.orgId, rootNumber);
    expect(component.equipment.parent_equipment_id).toBe(root.equipment.id);
    expect(component.equipment.client_id).toBe(root.equipment.client_id);
    expect(component.equipment.site_id).toBe(root.equipment.site_id);
    expect(root.equipment.equipment_number).toMatch(/^ANL-\d{4}-\d{3}$/);
    expect(component.equipment.equipment_number).not.toBe(
      root.equipment.equipment_number,
    );

    await adminPage.goto("/service/anlagen");
    await adminPage
      .getByRole("combobox", { name: "Anlagen nach Kategorie filtern" })
      .click();
    await adminPage.getByRole("option", { name: "Anlagenkomponente" }).click();
    await expect(
      adminPage.getByRole("link").filter({ hasText: fixture.componentName }),
    ).toBeVisible();
    await expect(
      adminPage.getByRole("link").filter({ hasText: fixture.rootName }),
    ).toHaveCount(0);
  });

  test("rejects duplicate and wrong-site widening while correction preserves both identities", async ({
    adminPage,
    world,
  }) => {
    const fixture = names(world);
    const predecessorNumber = requireChainedValue(
      await getInstalledEquipmentNumberByName(world.orgId, fixture.rootName),
      {
        test: "P1-18 lifecycle audit",
        needs: "the root equipment created by the bounded-identity audit",
        grep: "owns bounded root|rejects duplicate",
        suite: "audit",
      },
    );
    await expectDuplicateInstalledEquipmentRejected(adminPage, {
      customerName: fixture.customerName,
      siteName: fixture.primarySite,
      name: `P118 Audit Duplikat ${world.runId}`,
      manufacturer: "Audit Hersteller",
      serialNumber: fixture.serialNumber,
    });
    await openInstalledEquipmentByName(adminPage, fixture.rootName);
    const workDialog = await openInstalledEquipmentWorkLinkDialog(adminPage);
    await workDialog.locator("#equipment-work-target").click();
    const listbox = adminPage.getByRole("listbox");
    await expect(
      listbox.getByText(fixture.validJobNumber, { exact: false }),
    ).toBeVisible();
    await expect(
      listbox.getByText(fixture.wrongSiteJobNumber, { exact: false }),
    ).toHaveCount(0);
    await adminPage.keyboard.press("Escape");
    await expect(listbox).toHaveCount(0);
    await workDialog.getByRole("button", { name: "Abbrechen" }).click();

    await transitionInstalledEquipment(
      adminPage,
      "Vorübergehend außer Betrieb",
      "Vor dem Austausch kontrolliert außer Betrieb genommen",
    );
    const successorNumber = await replaceInstalledEquipment(adminPage, {
      successorName: fixture.successorName,
      serialNumber: `P118-AUDIT-NEW-${world.runId}`,
      reason: "Austausch zunächst als Abschlussaktion dokumentiert",
    });
    await adminPage.goto(`/service/anlagen/${predecessorNumber}`);
    await correctInstalledEquipmentTerminalAction(
      adminPage,
      "Austausch wurde irrtümlich am falschen Gerät festgehalten",
    );
    const predecessor = await getInstalledEquipmentState(
      world.orgId,
      predecessorNumber,
    );
    const successor = await getInstalledEquipmentState(
      world.orgId,
      successorNumber,
    );
    expect(predecessor.equipment.state).toBe("inactive");
    expect(predecessor.equipment.voided_at).toBeNull();
    expect(successor.equipment.voided_at).not.toBeNull();
    expect(predecessor.events.map((event) => event.event_type)).toEqual(
      expect.arrayContaining(["replaced", "terminal_action_corrected"]),
    );
    expect(successor.events.map((event) => event.event_type)).toEqual(
      expect.arrayContaining(["registered", "terminal_action_corrected"]),
    );
    await adminPage.goto(`/service/anlagen/${successorNumber}`);
    await expect(
      visibleText(
        adminPage,
        "Dieser Nachfolger wurde durch eine Korrektur als irrtümlich erfasst markiert.",
      ),
    ).toBeVisible();
    await expect(
      adminPage.getByRole("button", { name: "Bearbeiten" }),
    ).toBeDisabled();
  });
});

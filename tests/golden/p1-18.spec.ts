import { resolve } from "node:path";

import { expect, test } from "./support/fixtures";
import {
  getInstalledEquipmentCountsAs,
  getInstalledEquipmentNumberByName,
  getInstalledEquipmentState,
} from "./support/db";
import { expectLiveWithin } from "./support/live";
import { requireChainedValue } from "./support/preconditions";
import {
  addSiteOnCustomerDetail,
  createCustomer,
  createInstalledEquipment,
  createJob,
  linkInstalledEquipmentSourceToJob,
  linkInstalledEquipmentToJob,
  openCustomerDetail,
  openFieldWorkPack,
  replaceInstalledEquipment,
  textInDom,
  transitionInstalledEquipment,
  updateInstalledEquipmentModel,
  uploadIntoDocumentsSection,
  visibleText,
} from "./support/steps";
import { ownedBerlinDateAtOffset } from "./support/date-ownership";
import { ARTIFACTS_DIR, type TestWorld } from "./support/world";

test.describe.configure({ mode: "serial" });

const DATES = Array.from({ length: 5 }, (_, index) =>
  ownedBerlinDateAtOffset("p1-18", 95 + index),
);

function names(world: TestWorld) {
  return {
    customerName: `P118 Golden Kunde ${world.runId}`,
    siteName: `P118 Golden Heizraum ${world.runId}`,
    equipmentName: `P118 Golden Wärmepumpe ${world.runId}`,
    successorName: `P118 Golden Wärmepumpe neu ${world.runId}`,
    serialNumber: `P118-SER-${world.runId}`,
    successorSerial: `P118-SER-NEW-${world.runId}`,
    jobNumber: `AUF-${world.runId}-P118-GOLDEN`,
    jobTitle: `P118 Golden Servicebezug ${world.runId}`,
    employeeName: `${world.users.employee.firstName} ${world.users.employee.lastName}`,
  };
}

test.describe("P1-18 installed equipment vertical slice @P1-18", () => {
  test("registers a site-owned equipment identity with honest facts @P1-18-stage-registration", async ({
    adminPage,
    world,
  }) => {
    const fixture = names(world);
    await createCustomer(adminPage, fixture.customerName);
    await openCustomerDetail(adminPage, fixture.customerName);
    await addSiteOnCustomerDetail(adminPage, {
      name: fixture.siteName,
      street: "Anlagenstraße 18",
      postalCode: "10115",
      city: "Berlin",
      isPrimary: true,
    });
    await createJob(adminPage, {
      jobNumber: fixture.jobNumber,
      title: fixture.jobTitle,
      clientName: fixture.customerName,
      siteName: fixture.siteName,
      assignEmployeeName: fixture.employeeName,
    });
    const equipmentNumber = await createInstalledEquipment(adminPage, {
      customerName: fixture.customerName,
      siteName: fixture.siteName,
      name: fixture.equipmentName,
      state: "Aktiv",
      manufacturer: "WerkFlow Testtechnik",
      model: "WP 18",
      serialNumber: fixture.serialNumber,
      location: "Heizraum, Untergeschoss",
      installationDate: DATES[0],
      commissioningDate: DATES[1],
      warrantyProvider: "WerkFlow Testtechnik",
      warrantyEndDate: DATES[4],
    });

    await expect(visibleText(adminPage, equipmentNumber)).toBeVisible();
    await expect(visibleText(adminPage, fixture.serialNumber)).toBeVisible();
    await expect(visibleText(adminPage, "Anlage erfasst")).toBeVisible();
    await adminPage.goto("/service/anlagen");
    await adminPage
      .getByLabel("Anlagen durchsuchen")
      .fill(fixture.serialNumber);
    await expect(
      adminPage.getByRole("link").filter({ hasText: fixture.equipmentName }),
    ).toBeVisible();
    await openCustomerDetail(adminPage, fixture.customerName);
    await expect(visibleText(adminPage, "Anlagen & Geräte")).toBeVisible();
    await expect(
      adminPage.getByRole("link").filter({ hasText: fixture.equipmentName }),
    ).toBeVisible();

    const state = await getInstalledEquipmentState(
      world.orgId,
      equipmentNumber,
    );
    expect(state.equipment).toMatchObject({
      client_id: expect.any(String),
      site_id: expect.any(String),
      state: "active",
      installation_date: DATES[0],
      commissioning_date: DATES[1],
    });
    expect(state.identifiers.map((identifier) => identifier.value)).toContain(
      fixture.serialNumber,
    );
    expect(state.events.map((event) => event.event_type)).toEqual([
      "registered",
    ]);
    expect(state.events[0].after_snapshot).toMatchObject({
      installation_date: DATES[0],
      commissioning_date: DATES[1],
      warranty_end_date: DATES[4],
    });
  });

  test("links exact work, documents, history, and the assigned field projection @P1-18-stage-history", async ({
    adminPage,
    employeePage,
    world,
  }) => {
    const fixture = names(world);
    const equipmentNumber = requireChainedValue(
      await getInstalledEquipmentNumberByName(
        world.orgId,
        fixture.equipmentName,
      ),
      {
        test: "P1-18 history stage",
        needs: "the equipment registered by the P1-18 registration stage",
        grep: "@P1-18-stage-registration|@P1-18-stage-history",
        suite: "golden",
      },
    );
    await adminPage.goto(`/service/anlagen/${equipmentNumber}`);
    await linkInstalledEquipmentToJob(adminPage, fixture.jobNumber);
    await linkInstalledEquipmentSourceToJob(
      adminPage,
      fixture.jobNumber,
      "Installation laut abgeschlossenem Auftrag",
    );
    await uploadIntoDocumentsSection(
      adminPage,
      resolve(ARTIFACTS_DIR, "upload-fixture.pdf"),
      "upload-fixture",
    );
    await transitionInstalledEquipment(
      adminPage,
      "Vorübergehend außer Betrieb",
      "Prüfung vor dem nächsten Einsatz erforderlich",
    );
    await expect(
      visibleText(adminPage, "Arbeitsbezug hinzugefügt"),
    ).toBeVisible();
    await expect(
      visibleText(adminPage, "Herkunftsnachweis verknüpft"),
    ).toBeVisible();

    await updateInstalledEquipmentModel(
      adminPage,
      "WP 18 R2",
      "Typenschild nach Vor-Ort-Prüfung berichtigt",
    );

    const pack = await openFieldWorkPack(employeePage, fixture.jobNumber);
    await expect(
      pack.getByText("Anlagen am Einsatzort", { exact: true }),
    ).toBeVisible();
    await expect(
      pack.getByText(fixture.equipmentName, { exact: true }),
    ).toBeVisible();
    await expect(pack).not.toContainText(fixture.serialNumber);
    await expect(pack).not.toContainText("Gewährleistungsgeber");
    await expect(textInDom(employeePage, fixture.serialNumber)).toHaveCount(0);

    const state = await getInstalledEquipmentState(
      world.orgId,
      equipmentNumber,
    );
    expect(state.workLinks).toHaveLength(1);
    expect(state.documentLinks).toHaveLength(1);
    expect(state.events.map((event) => event.event_type)).toEqual(
      expect.arrayContaining([
        "work_linked",
        "source_linked",
        "document_linked",
        "inactivated",
        "details_corrected",
      ]),
    );
  });

  test("refreshes another manager session from the equipment root @P1-18-stage-realtime", async ({
    adminPage,
    bueroPage,
    world,
  }) => {
    const fixture = names(world);
    const equipmentNumber = requireChainedValue(
      await getInstalledEquipmentNumberByName(
        world.orgId,
        fixture.equipmentName,
      ),
      {
        test: "P1-18 Realtime stage",
        needs: "the equipment registered by the P1-18 registration stage",
        grep: "@P1-18-stage-registration|@P1-18-stage-realtime",
        suite: "golden",
      },
    );
    await Promise.all([
      adminPage.goto(`/service/anlagen/${equipmentNumber}`),
      bueroPage.goto(`/service/anlagen/${equipmentNumber}`),
    ]);
    await expect(
      bueroPage.getByRole("heading", { name: fixture.equipmentName }),
    ).toBeVisible();
    const liveModel = `WP 18 LIVE ${world.runId}-${Date.now()}`;
    await updateInstalledEquipmentModel(
      adminPage,
      liveModel,
      "Typenschild für die Live-Aktualisierung berichtigt",
    );
    await expectLiveWithin(visibleText(bueroPage, liveModel), {
      label: "P1-18 equipment detail cross-session refresh",
    });
  });

  test("preserves replacement history and denies full employee or outsider access @P1-18-stage-boundary", async ({
    adminPage,
    employeePage,
    world,
  }) => {
    const fixture = names(world);
    const predecessorNumber = requireChainedValue(
      await getInstalledEquipmentNumberByName(
        world.orgId,
        fixture.equipmentName,
      ),
      {
        test: "P1-18 boundary stage",
        needs: "the equipment retained by the P1-18 history stage",
        grep: "@P1-18-stage-registration|@P1-18-stage-history|@P1-18-stage-boundary",
        suite: "golden",
      },
    );
    await adminPage.goto(`/service/anlagen/${predecessorNumber}`);
    const successorNumber = await replaceInstalledEquipment(adminPage, {
      successorName: fixture.successorName,
      serialNumber: fixture.successorSerial,
      reason: "Anlage nach dokumentiertem Austausch ersetzt",
    });
    await expect(
      visibleText(adminPage, `Vorgänger: ${fixture.equipmentName}`),
    ).toBeVisible();
    const predecessor = await getInstalledEquipmentState(
      world.orgId,
      predecessorNumber,
    );
    expect(predecessor.equipment.state).toBe("replaced");
    const successor = await getInstalledEquipmentState(
      world.orgId,
      successorNumber,
    );
    expect(successor.equipment.predecessor_equipment_id).toBe(
      predecessor.equipment.id,
    );

    await employeePage.goto(`/service/anlagen/${successorNumber}`);
    await employeePage.waitForURL(/\/auftraege\/?$/, { timeout: 20_000 });
    const employeeCounts = await getInstalledEquipmentCountsAs(
      world.users.employee,
      world.orgId,
    );
    expect(Object.values(employeeCounts).every((count) => count === 0)).toBe(
      true,
    );
    const outsiderCounts = await getInstalledEquipmentCountsAs(
      world.outsider.admin,
      world.orgId,
    );
    expect(Object.values(outsiderCounts).every((count) => count === 0)).toBe(
      true,
    );
  });
});

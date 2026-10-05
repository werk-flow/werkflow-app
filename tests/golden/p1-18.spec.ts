import { resolve } from 'node:path';

import { expectDefined } from '../../lib/testing/spec-support/expect-defined';
import { expect, test } from './support/fixtures';
import { seedCustomer } from './support/db/customers';
import { getInstalledEquipmentState, seedInstalledEquipment } from './support/db/service';
import { seedJob, seedJobAssignment } from './support/db/work';
import { ownedBerlinDateAtOffset } from './support/date-ownership';
import { expectLiveWithin } from './support/live';
import { openSeededCustomerDetail } from './support/steps/customers';
import { uploadIntoDocumentsSection } from './support/steps/documents';
import {
  EQUIPMENT_WARRANTY_PROVIDER_LABEL,
  createInstalledEquipment,
  customerEquipmentSectionTitle,
  equipmentEvent,
  equipmentListSearch,
  equipmentRelation,
  fieldPackEquipmentHeading,
  linkInstalledEquipmentSourceToJob,
  linkInstalledEquipmentToJob,
  replaceInstalledEquipment,
  transitionInstalledEquipment,
  updateInstalledEquipmentModel,
} from './support/steps/service';
import { testData, textInDom, visibleText } from './support/steps/shared';
import { openFieldWorkPack } from './support/steps/work';
import { artifactsDirectory } from './support/world';

test.describe('P1-18 installed equipment vertical slice @P1-18', () => {
  test('registers, links, corrects and replaces one site-owned asset @P1-18-journey', async ({
    adminPage,
    employeePage,
    world,
  }) => {
    const names = {
      customer: testData`P118 Golden Kunde ${world.runId}`,
      site: testData`P118 Golden Heizraum ${world.runId}`,
      equipment: testData`P118 Golden Wärmepumpe ${world.runId}`,
      successor: testData`P118 Golden Wärmepumpe neu ${world.runId}`,
      serialNumber: testData`P118-SER-${world.runId}`,
      successorSerial: testData`P118-SER-NEW-${world.runId}`,
      jobNumber: testData`AUF-${world.runId}-P118-GOLDEN`,
      jobTitle: testData`P118 Golden Servicebezug ${world.runId}`,
    };

    const clientId = await test.step('Seed the customer site and the assigned job', async () => {
      const customer = await seedCustomer({
        orgId: world.orgId,
        actorId: world.users.admin.id,
        name: names.customer,
        sites: [
          {
            name: names.site,
            street: 'Anlagenstraße 18',
            postalCode: '10115',
            city: 'Berlin',
            isPrimary: true,
          },
        ],
      });
      const jobId = await seedJob({
        orgId: world.orgId,
        actorId: world.users.admin.id,
        jobNumber: names.jobNumber,
        title: names.jobTitle,
        clientId: customer.clientId,
        siteId: expectDefined(customer.siteIds.get(names.site), 'the seeded P1-18 site'),
      });
      await seedJobAssignment({
        orgId: world.orgId,
        actorId: world.users.admin.id,
        jobId,
        userId: world.users.employee.id,
      });
      return customer.clientId;
    });

    const equipmentNumber = await test.step('Register the equipment with honest facts', async () => {
      const installationDate = ownedBerlinDateAtOffset('p1-18', 95);
      const commissioningDate = ownedBerlinDateAtOffset('p1-18', 96);
      const warrantyEndDate = ownedBerlinDateAtOffset('p1-18', 99);
      const registeredNumber = await createInstalledEquipment(adminPage, {
        customerName: names.customer,
        siteName: names.site,
        name: names.equipment,
        state: 'active',
        manufacturer: 'WerkFlow Testtechnik',
        model: 'WP 18',
        serialNumber: names.serialNumber,
        location: 'Heizraum, Untergeschoss',
        installationDate,
        commissioningDate,
        warrantyProvider: 'WerkFlow Testtechnik',
        warrantyEndDate,
      });
      await expect(visibleText(adminPage, registeredNumber)).toBeVisible();
      await expect(visibleText(adminPage, names.serialNumber)).toBeVisible();
      await expect(equipmentEvent(adminPage, 'registered')).toBeVisible();
      await adminPage.goto('/service/anlagen');
      await equipmentListSearch(adminPage).fill(names.serialNumber);
      await expect(adminPage.getByRole('link').filter({ hasText: names.equipment })).toBeVisible();
      await openSeededCustomerDetail(adminPage, clientId);
      await expect(customerEquipmentSectionTitle(adminPage)).toBeVisible();
      await expect(adminPage.getByRole('link').filter({ hasText: names.equipment })).toBeVisible();

      const state = await getInstalledEquipmentState(world.orgId, registeredNumber);
      expect(state.equipment).toMatchObject({
        client_id: clientId,
        state: 'active',
        installation_date: installationDate,
        commissioning_date: commissioningDate,
      });
      expect(state.identifiers.map((identifier) => identifier.value)).toContain(names.serialNumber);
      expect(state.events.map((event) => event.event_type)).toEqual(['registered']);
      expect(state.events[0]?.after_snapshot).toMatchObject({ warranty_end_date: warrantyEndDate });
      return registeredNumber;
    });

    await test.step('Link exact work, origin and document, then take it out of service', async () => {
      await adminPage.goto(`/service/anlagen/${equipmentNumber}`);
      await linkInstalledEquipmentToJob(adminPage, names.jobNumber);
      await linkInstalledEquipmentSourceToJob(
        adminPage,
        names.jobNumber,
        'Installation laut abgeschlossenem Auftrag',
      );
      await uploadIntoDocumentsSection(
        adminPage,
        resolve(artifactsDirectory(), 'upload-fixture.pdf'),
        'upload-fixture',
      );
      await transitionInstalledEquipment(
        adminPage,
        'inactive',
        'Prüfung vor dem nächsten Einsatz erforderlich',
      );
      await expect(equipmentEvent(adminPage, 'work_linked')).toBeVisible();
      await expect(equipmentEvent(adminPage, 'source_linked')).toBeVisible();

      const state = await getInstalledEquipmentState(world.orgId, equipmentNumber);
      expect(state.equipment.state).toBe('inactive');
      expect(state.workLinks).toHaveLength(1);
      expect(state.documentLinks).toHaveLength(1);
      expect(state.events.map((event) => event.event_type)).toEqual(
        expect.arrayContaining(['work_linked', 'source_linked', 'document_linked', 'inactivated']),
      );
    });

    await test.step('Correct the type plate model with a reason', async () => {
      await updateInstalledEquipmentModel(
        adminPage,
        'WP 18 R2',
        'Typenschild nach Vor-Ort-Prüfung berichtigt',
      );
      const state = await getInstalledEquipmentState(world.orgId, equipmentNumber);
      expect(state.equipment.model).toBe('WP 18 R2');
      expect(state.events.map((event) => event.event_type)).toContain('details_corrected');
    });

    await test.step('Show the assigned employee only the field facts', async () => {
      const pack = await openFieldWorkPack(employeePage, names.jobNumber);
      await expect(fieldPackEquipmentHeading(pack)).toBeVisible();
      await expect(pack.getByText(names.equipment, { exact: true })).toBeVisible();
      await expect(pack).not.toContainText(names.serialNumber);
      await expect(pack).not.toContainText(EQUIPMENT_WARRANTY_PROVIDER_LABEL);
      await expect(textInDom(employeePage, names.serialNumber)).toHaveCount(0);
    });

    await test.step('Replace the equipment and keep its predecessor', async () => {
      await adminPage.goto(`/service/anlagen/${equipmentNumber}`);
      const successorNumber = await replaceInstalledEquipment(adminPage, {
        successorName: names.successor,
        serialNumber: names.successorSerial,
        reason: 'Anlage nach dokumentiertem Austausch ersetzt',
      });
      await expect(equipmentRelation(adminPage, 'predecessor', names.equipment)).toBeVisible();
      const predecessor = await getInstalledEquipmentState(world.orgId, equipmentNumber);
      expect(predecessor.equipment.state).toBe('replaced');
      const successor = await getInstalledEquipmentState(world.orgId, successorNumber);
      expect(successor.equipment.predecessor_equipment_id).toBe(predecessor.equipment.id);
    });
  });

  test('refreshes another manager session from the equipment root @P1-18-stage-realtime @FRESHNESS', async ({
    adminPage,
    bueroPage,
    world,
  }) => {
    const equipmentName = `P118 Live Wärmepumpe ${world.runId}`;
    const customer = await seedCustomer({
      orgId: world.orgId,
      actorId: world.users.admin.id,
      name: `P118 Live Kunde ${world.runId}`,
      sites: [{ name: `P118 Live Heizraum ${world.runId}`, isPrimary: true }],
    });
    const { equipmentNumber } = await seedInstalledEquipment({
      orgId: world.orgId,
      actorId: world.users.admin.id,
      clientId: customer.clientId,
      siteId: expectDefined(
        customer.siteIds.get(`P118 Live Heizraum ${world.runId}`),
        'the seeded live site',
      ),
      name: equipmentName,
      manufacturer: 'WerkFlow Testtechnik',
      model: 'WP 18',
    });
    await Promise.all([
      adminPage.goto(`/service/anlagen/${equipmentNumber}`),
      bueroPage.goto(`/service/anlagen/${equipmentNumber}`),
    ]);
    await expect(bueroPage.getByRole('heading', { name: equipmentName })).toBeVisible();
    const liveModel = `WP 18 LIVE ${world.runId}-freshness`;
    await expectLiveWithin(visibleText(bueroPage, liveModel), {
      label: 'P1-18 equipment detail cross-session refresh',
      actingPage: adminPage,
      mutation: (beforeSubmit) =>
        updateInstalledEquipmentModel(
          adminPage,
          liveModel,
          'Typenschild für die Live-Aktualisierung berichtigt',
          beforeSubmit,
        ),
    });
  });
});

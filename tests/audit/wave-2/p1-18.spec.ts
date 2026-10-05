import { expectDefined } from '../../../lib/testing/spec-support/expect-defined';
import { expect, test } from '../support/fixtures';
import { seedCustomer } from '../../golden/support/db/customers';
import {
  getInstalledEquipmentState,
  seedInstalledEquipment,
  seedInstalledEquipmentReplacement,
} from '../../golden/support/db/service';
import { seedJob } from '../../golden/support/db/work';
import { dismissDialog } from '../../golden/support/steps/interaction';
import {
  EQUIPMENT_NOT_RECORDED,
  correctInstalledEquipmentTerminalAction,
  createInstalledEquipment,
  equipmentFact,
  equipmentNoIdentifierNotice,
  equipmentRelation,
  equipmentVoidedSuccessorNotice,
  equipmentWorkTargetPicker,
  expectDuplicateInstalledEquipmentRejected,
  filterEquipmentListByCategory,
  openInstalledEquipmentWorkLinkDialog,
  serviceEditButton,
} from '../../golden/support/steps/service';
import { SHARED_COPY, textInDom } from '../../golden/support/steps/shared';
import type { TestWorld } from '../../golden/support/world';

/** One customer site with one active root equipment, named for the calling test. */
async function seedEquipmentAtSite(
  world: TestWorld,
  testId: string,
  options: { serialNumber?: string; otherSite?: boolean } = {},
) {
  const names = {
    customer: `P118 Audit Kunde ${world.runId}-${testId}`,
    site: `P118 Audit Zentrale ${world.runId}-${testId}`,
    otherSite: `P118 Audit Außenstelle ${world.runId}-${testId}`,
    root: `P118 Audit Wärmeerzeuger ${world.runId}-${testId}`,
  };
  const customer = await seedCustomer({
    orgId: world.orgId,
    actorId: world.users.admin.id,
    name: names.customer,
    sites: [
      { name: names.site, street: 'Auditweg 18', postalCode: '10115', city: 'Berlin', isPrimary: true },
      ...(options.otherSite
        ? [{ name: names.otherSite, street: 'Auditweg 19', postalCode: '10115', city: 'Berlin' }]
        : []),
    ],
  });
  const siteId = expectDefined(customer.siteIds.get(names.site), 'the seeded P1-18 audit site');
  const root = await seedInstalledEquipment({
    orgId: world.orgId,
    actorId: world.users.admin.id,
    clientId: customer.clientId,
    siteId,
    name: names.root,
    manufacturer: 'Audit Hersteller',
    ...(options.serialNumber ? { serialNumber: options.serialNumber } : {}),
  });
  return { names, customer, siteId, root };
}

test.describe('P1-18 exhaustive installed-equipment audit @AUDIT-W2-P1-18 @AUDIT-W2', () => {
  test('registers a component under its root and shows unknown facts honestly', async ({
    adminPage,
    world,
  }) => {
    const { names, root } = await seedEquipmentAtSite(world, 'component');
    const componentName = `P118 Audit Umwälzpumpe ${world.runId}-component`;
    const componentNumber = await createInstalledEquipment(adminPage, {
      customerName: names.customer,
      siteName: names.site,
      name: componentName,
      category: 'system_component',
      parentName: names.root,
    });
    await expect(equipmentRelation(adminPage, 'parent', names.root)).toBeVisible();
    await expect(equipmentFact(adminPage, 'manufacturer')).toContainText(EQUIPMENT_NOT_RECORDED);
    await expect(equipmentFact(adminPage, 'commissioning')).toContainText(EQUIPMENT_NOT_RECORDED);
    await expect(equipmentNoIdentifierNotice(adminPage)).toBeVisible();
    await adminPage.goto(`/service/anlagen/${root.equipmentNumber}`);
    await expect(equipmentRelation(adminPage, 'component', componentName)).toBeVisible();
    const component = await getInstalledEquipmentState(world.orgId, componentNumber);
    expect(component.equipment.parent_equipment_id).toBe(root.id);

    await adminPage.goto('/service/anlagen');
    await filterEquipmentListByCategory(adminPage, 'system_component');
    await expect(adminPage.getByRole('link').filter({ hasText: componentName })).toBeVisible();
    await expect(adminPage.getByRole('link').filter({ hasText: names.root })).toHaveCount(0);
  });

  test('rejects a serial number that another asset already uses', async ({ adminPage, world }) => {
    const serialNumber = `P118-AUDIT-SER-${world.runId}-duplicate`;
    const { names } = await seedEquipmentAtSite(world, 'duplicate', { serialNumber });
    await expectDuplicateInstalledEquipmentRejected(adminPage, {
      customerName: names.customer,
      siteName: names.site,
      name: `P118 Audit Duplikat ${world.runId}-duplicate`,
      manufacturer: 'Audit Hersteller',
      serialNumber,
    });
  });

  test('offers only work at the equipment site for a work link', async ({ adminPage, world }) => {
    const { names, customer, siteId, root } = await seedEquipmentAtSite(world, 'work-site', {
      otherSite: true,
    });
    const sameSiteJob = `AUF-${world.runId}-P118-SAME-SITE`;
    const otherSiteJob = `AUF-${world.runId}-P118-OTHER-SITE`;
    await seedJob({
      orgId: world.orgId,
      actorId: world.users.admin.id,
      jobNumber: sameSiteJob,
      title: `P118 Audit gleicher Einsatzort ${world.runId}`,
      clientId: customer.clientId,
      siteId,
    });
    await seedJob({
      orgId: world.orgId,
      actorId: world.users.admin.id,
      jobNumber: otherSiteJob,
      title: `P118 Audit anderer Einsatzort ${world.runId}`,
      clientId: customer.clientId,
      siteId: expectDefined(customer.siteIds.get(names.otherSite), 'the seeded other site'),
    });
    await adminPage.goto(`/service/anlagen/${root.equipmentNumber}`);
    const workDialog = await openInstalledEquipmentWorkLinkDialog(adminPage);
    await equipmentWorkTargetPicker(workDialog).click();
    const listbox = adminPage.getByRole('listbox');
    await expect(listbox.getByText(sameSiteJob, { exact: false })).toBeVisible();
    await expect(listbox.getByText(otherSiteJob, { exact: false })).toHaveCount(0);
    await dismissDialog(listbox);
    await expect(listbox).toHaveCount(0);
    await workDialog.getByRole('button', { name: SHARED_COPY.action.cancel }).click();
  });

  test('corrects a replacement recorded on the wrong asset and keeps both identities', async ({
    adminPage,
    world,
  }) => {
    const { root } = await seedEquipmentAtSite(world, 'correction');
    const successor = await seedInstalledEquipmentReplacement({
      orgId: world.orgId,
      actorId: world.users.admin.id,
      predecessorId: root.id,
      inactiveReason: 'Vor dem Austausch kontrolliert außer Betrieb genommen',
      successorName: `P118 Audit Wärmeerzeuger neu ${world.runId}-correction`,
      successorSerialNumber: `P118-AUDIT-NEW-${world.runId}-correction`,
      reason: 'Austausch zunächst als Abschlussaktion dokumentiert',
    });
    await adminPage.goto(`/service/anlagen/${root.equipmentNumber}`);
    await correctInstalledEquipmentTerminalAction(
      adminPage,
      'Austausch wurde irrtümlich am falschen Gerät festgehalten',
    );
    const predecessor = await getInstalledEquipmentState(world.orgId, root.equipmentNumber);
    const voided = await getInstalledEquipmentState(world.orgId, successor.equipmentNumber);
    expect(predecessor.equipment.state).toBe('inactive');
    expect(predecessor.equipment.voided_at).toBeNull();
    expect(voided.equipment.voided_at).not.toBeNull();
    expect(predecessor.events.map((event) => event.event_type)).toContain('terminal_action_corrected');

    await adminPage.goto(`/service/anlagen/${successor.equipmentNumber}`);
    await expect(equipmentVoidedSuccessorNotice(adminPage)).toBeVisible();
    await expect(serviceEditButton(adminPage)).toBeDisabled();
  });

  test('keeps equipment detail from employees and other organizations', async ({
    employeePage,
    outsiderPage,
    world,
  }) => {
    const { names, root } = await seedEquipmentAtSite(world, 'denial');
    await employeePage.goto(`/service/anlagen/${root.equipmentNumber}`);
    await employeePage.waitForURL(/\/auftraege\/?$/, { timeout: 20_000 });
    await outsiderPage.goto(`/service/anlagen/${root.equipmentNumber}`);
    await expect(textInDom(outsiderPage, names.root)).toHaveCount(0);
  });
});

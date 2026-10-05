import { resolve } from 'node:path';

import { SERVICE_CASE_ERRORS } from '../../../components/service/service-case-form-state';
import { expectDefined } from '../../../lib/testing/spec-support/expect-defined';
import { expect, test } from '../support/fixtures';
import { seedCustomer } from '../../golden/support/db/customers';
import {
  getServiceCaseStateByNumber,
  seedInstalledEquipment,
  seedServiceCase,
} from '../../golden/support/db/service';
import { seedJob } from '../../golden/support/db/work';
import { uploadIntoDocumentsSection } from '../../golden/support/steps/documents';
import { dismissDialog } from '../../golden/support/steps/interaction';
import {
  serviceCaseJobPicker,
  serviceCaseListSearch,
  serviceEditButton,
  updateServiceCaseViaDialog,
} from '../../golden/support/steps/service';
import { SHARED_COPY, textInDom } from '../../golden/support/steps/shared';
import { artifactsDirectory, type TestWorld } from '../../golden/support/world';

/** One customer with a primary site (and optionally a second site), named for the calling test. */
async function seedServiceSite(world: TestWorld, testId: string, options: { otherSite?: boolean } = {}) {
  const names = {
    customer: `P119 Audit Kunde ${world.runId}-${testId}`,
    site: `P119 Audit Heizzentrale ${world.runId}-${testId}`,
    otherSite: `P119 Audit Außenstelle ${world.runId}-${testId}`,
  };
  const customer = await seedCustomer({
    orgId: world.orgId,
    actorId: world.users.admin.id,
    name: names.customer,
    sites: [
      {
        name: names.site,
        street: 'Auditserviceweg 19',
        postalCode: '10115',
        city: 'Berlin',
        isPrimary: true,
      },
      ...(options.otherSite
        ? [{ name: names.otherSite, street: 'Auditserviceweg 20', postalCode: '10115', city: 'Berlin' }]
        : []),
    ],
  });
  const siteId = expectDefined(customer.siteIds.get(names.site), 'the seeded P1-19 audit site');
  return { names, customer, siteId };
}

test.describe('P1-19 exhaustive reactive-service audit @AUDIT-W2-P1-19 @AUDIT-W2', () => {
  test('finds a case by its linked equipment without inventing links', async ({ adminPage, world }) => {
    const { customer, siteId } = await seedServiceSite(world, 'search');
    const equipmentName = `P119 Audit Heizgerät ${world.runId}-search`;
    const linkedSummary = `P119 Audit Direktfall ${world.runId}-search`;
    const unlinkedSummary = `P119 Audit Störungsmeldung ${world.runId}-search`;
    const equipment = await seedInstalledEquipment({
      orgId: world.orgId,
      actorId: world.users.admin.id,
      clientId: customer.clientId,
      siteId,
      name: equipmentName,
      manufacturer: 'Audit Service GmbH',
    });
    await seedServiceCase({
      orgId: world.orgId,
      actorId: world.users.admin.id,
      clientId: customer.clientId,
      siteId,
      summary: linkedSummary,
      statement: 'Seit dem letzten Besuch tritt derselbe Fehler erneut auf.',
      equipmentIds: [equipment.id],
    });
    await seedServiceCase({
      orgId: world.orgId,
      actorId: world.users.admin.id,
      clientId: customer.clientId,
      siteId,
      summary: unlinkedSummary,
      statement: 'Originale Meldung ohne Anlagenbezug.',
    });

    await adminPage.goto('/service/faelle');
    const search = serviceCaseListSearch(adminPage);
    await search.fill(equipmentName);
    await expect(adminPage.getByRole('link').filter({ hasText: linkedSummary })).toBeVisible();
    await expect(adminPage.getByRole('link').filter({ hasText: unlinkedSummary })).toHaveCount(0);
    await search.fill(unlinkedSummary);
    await expect(adminPage.getByRole('link').filter({ hasText: unlinkedSummary })).toBeVisible();
  });

  test('offers only jobs at the case site', async ({ adminPage, world }) => {
    const { names, customer, siteId } = await seedServiceSite(world, 'job-site', { otherSite: true });
    const sameSiteJob = `AUF-${world.runId}-P119-SAME-SITE`;
    const otherSiteJob = `AUF-${world.runId}-P119-OTHER-SITE`;
    await seedJob({
      orgId: world.orgId,
      actorId: world.users.admin.id,
      jobNumber: sameSiteJob,
      title: `P119 Audit Serviceeinsatz ${world.runId}`,
      clientId: customer.clientId,
      siteId,
    });
    await seedJob({
      orgId: world.orgId,
      actorId: world.users.admin.id,
      jobNumber: otherSiteJob,
      title: `P119 Audit falscher Ort ${world.runId}`,
      clientId: customer.clientId,
      siteId: expectDefined(customer.siteIds.get(names.otherSite), 'the seeded other site'),
    });
    const { caseNumber } = await seedServiceCase({
      orgId: world.orgId,
      actorId: world.users.admin.id,
      clientId: customer.clientId,
      siteId,
      summary: `P119 Audit Ortsbindung ${world.runId}`,
      statement: 'Die Heizung bleibt kalt.',
    });

    await adminPage.goto(`/service/faelle/${caseNumber}`);
    await serviceEditButton(adminPage).click();
    const dialog = adminPage.getByRole('dialog');
    await serviceCaseJobPicker(dialog).click();
    const listbox = adminPage.getByRole('listbox');
    await expect(listbox.getByText(sameSiteJob, { exact: false })).toBeVisible();
    await expect(listbox.getByText(otherSiteJob, { exact: false })).toHaveCount(0);
    await dismissDialog(listbox);
    await expect(listbox).toHaveCount(0);
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: SHARED_COPY.action.cancel }).click();
  });

  test('rejects a stale edit from a second manager without overwriting the newer state', async ({
    adminPage,
    bueroPage,
    world,
  }) => {
    const { customer, siteId } = await seedServiceSite(world, 'stale');
    const triageNote = 'Gewährleistung und Berechnung bleiben ausdrücklich ungeklärt.';
    const confirmedSummary = `P119 Audit freigegeben ${world.runId}`;
    const { caseNumber } = await seedServiceCase({
      orgId: world.orgId,
      actorId: world.users.admin.id,
      clientId: customer.clientId,
      siteId,
      summary: `P119 Audit Parallelprüfung ${world.runId}`,
      statement: 'Die Anlage schaltet sich wiederholt ab.',
      triageNote,
    });

    await adminPage.goto(`/service/faelle/${caseNumber}`);
    await bueroPage.goto(`/service/faelle/${caseNumber}`);
    await serviceEditButton(bueroPage).click();
    const staleDialog = bueroPage.getByRole('dialog');
    await staleDialog
      .locator('#service-triage')
      .fill('Diese Eingabe darf nicht den neueren Stand überschreiben.');
    await staleDialog.locator('#service-reason').fill('Parallelprüfung aus dem Büro');
    await updateServiceCaseViaDialog(adminPage, {
      summary: confirmedSummary,
      reason: 'Aktueller Stand durch Admin bestätigt',
    });
    await expect(adminPage.getByRole('heading', { name: confirmedSummary, exact: true })).toBeVisible({
      timeout: 20_000,
    });
    await staleDialog.getByRole('button', { name: SHARED_COPY.action.save, exact: true }).click();
    await expect(staleDialog.getByRole('alert')).toContainText(
      expectDefined(SERVICE_CASE_ERRORS.service_case_stale_version, 'the stale-version message'),
    );
    await staleDialog.getByRole('button', { name: SHARED_COPY.action.cancel }).click();

    const state = await getServiceCaseStateByNumber(world.orgId, caseNumber);
    expect(state.serviceCase.summary).toBe(confirmedSummary);
    expect(state.serviceCase.triage_note).toBe(triageNote);
  });

  test('links an uploaded document to the exact service case', async ({ adminPage, world }) => {
    const { customer, siteId } = await seedServiceSite(world, 'document');
    const { caseNumber } = await seedServiceCase({
      orgId: world.orgId,
      actorId: world.users.admin.id,
      clientId: customer.clientId,
      siteId,
      summary: `P119 Audit Dokumentfall ${world.runId}`,
      statement: 'Die Kundin schickt ein Foto des Fehlercodes.',
    });
    await adminPage.goto(`/service/faelle/${caseNumber}`);
    await uploadIntoDocumentsSection(
      adminPage,
      resolve(artifactsDirectory(), 'upload-fixture.pdf'),
      'upload-fixture',
    );
    const state = await getServiceCaseStateByNumber(world.orgId, caseNumber);
    expect(state.documentLinks).toHaveLength(1);
    expect(state.documentLinks[0]?.service_case_id).toBe(state.serviceCase.id);
  });

  test('keeps service cases from employees and other organizations', async ({
    employeePage,
    outsiderPage,
    world,
  }) => {
    const { customer, siteId } = await seedServiceSite(world, 'denial');
    const summary = `P119 Audit vertraulich ${world.runId}`;
    const { caseNumber } = await seedServiceCase({
      orgId: world.orgId,
      actorId: world.users.admin.id,
      clientId: customer.clientId,
      siteId,
      summary,
      statement: 'Interne Störungsmeldung.',
    });
    await employeePage.goto('/service/faelle');
    await expect(employeePage).not.toHaveURL(/\/service\/faelle/);
    await outsiderPage.goto(`/service/faelle/${caseNumber}`);
    await expect(textInDom(outsiderPage, summary)).toHaveCount(0);
    await expect(textInDom(outsiderPage, caseNumber)).toHaveCount(0);
  });
});

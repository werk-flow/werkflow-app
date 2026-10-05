import { expect, test } from '../support/fixtures';
import { ownedBerlinDateAtOffset } from '../../golden/support/date-ownership';
import { seedCustomer } from '../../golden/support/db/customers';
import { getCustomerNumber } from '../../golden/support/db/shared';
import { getProjectJobRelationState, seedProject } from '../../golden/support/db/work';
import {
  addContactButton,
  addContactOnCustomerDetail,
  addSiteOnCustomerDetail,
  adoptCustomerAddressAsSite,
  archiveCustomerRelation,
  CUSTOMER_TEXT,
  customerNumberField,
  openSeededCustomerDetail,
  restoreCustomerRelation,
  setCustomerNumber,
} from '../../golden/support/steps/customers';
import { dismissDialog } from '../../golden/support/steps/interaction';
import {
  customerPicker,
  customerPickerSearch,
  datePickerDigits,
  selectFromSearchable,
  SHARED_COPY,
  testData,
  visibleText,
} from '../../golden/support/steps/shared';
import {
  createJob,
  jobEditDialog,
  jobFormField,
  workCreateButton,
  workCreateTab,
} from '../../golden/support/steps/work';
import { expectDefined } from '../../../lib/testing/spec-support/expect-defined';
import { customerContactRow, customerSiteRow } from '../support/a2-steps';

// A2 customer master data: contacts, work sites, customer numbers, project
// defaults and the customer-detail route boundary. Every test seeds its own
// customer; the creation dialogs are proven by GG-01 and P1-01.

test.describe('A2 Kundenstamm @AUDIT-W1-A2', () => {
  test('A2-01/A2-02/A2-03: Hauptkontakte, Archiv/Wiederherstellung und Kundenadresse als Einsatzort', async ({
    adminPage,
    world,
  }) => {
    const customer = `A2 Kundenstamm ${world.runId}`;
    const firstContact = `A2 Erstkontakt ${world.runId}`;
    const primaryContact = `A2 Hauptkontakt ${world.runId}`;
    const secondarySite = `A2 Nebenstelle ${world.runId}`;
    const street = testData`A2 Hauptstraße 25`;
    const address = `${street}, 10115 Berlin`;
    const firstContactRole = testData`Technische Leitung`;
    const firstContactEmail = `technik-${world.runId}@example.test`;
    const firstContactNotes = testData`Entscheidet über Wartungsfreigaben`;
    const secondarySiteNotes = testData`Anlieferung nur über den Innenhof`;

    const seeded = await seedCustomer({
      orgId: world.orgId,
      actorId: world.users.admin.id,
      name: customer,
      clientType: 'gewerblich',
      address,
    });
    await openSeededCustomerDetail(adminPage, seeded.clientId);
    await addContactButton(adminPage).click();
    const contactDialog = adminPage.getByRole('dialog');
    await expect(contactDialog.locator('#contact-role')).toHaveAttribute('list', 'contact-role-suggestions');
    expect(
      await contactDialog
        .locator('#contact-role-suggestions option')
        .evaluateAll((options) => options.map((option) => option.getAttribute('value'))),
    ).toEqual([
      'Eigentümer/in',
      'Mieter/in',
      'Hausverwaltung',
      'Hausmeister/in',
      'Bauleitung',
      'Architekt/in',
      'Einkauf',
      'Rechnungsempfänger/in',
      'Notfallkontakt',
    ]);
    await contactDialog.getByRole('button', { name: SHARED_COPY.action.cancel }).click();
    await addContactOnCustomerDetail(adminPage, {
      name: firstContact,
      role: firstContactRole,
      phone: '+49 30 250001',
      email: firstContactEmail,
      notes: firstContactNotes,
    });
    await addContactOnCustomerDetail(adminPage, {
      name: primaryContact,
      phone: '+49 30 250002',
      isPrimary: true,
    });
    const firstContactRow = customerContactRow(adminPage, firstContact);
    const primaryContactRow = customerContactRow(adminPage, primaryContact);
    await expect(primaryContactRow).toContainText(CUSTOMER_TEXT.primaryContact);
    await expect(firstContactRow).not.toContainText(CUSTOMER_TEXT.primaryContact);

    await adoptCustomerAddressAsSite(adminPage);
    await expect(customerSiteRow(adminPage, CUSTOMER_TEXT.primarySite)).toContainText(address);
    await addSiteOnCustomerDetail(adminPage, {
      name: secondarySite,
      street: 'Nebenstraße 29',
      postalCode: '10117',
      city: 'Berlin',
      accessNotes: 'Schlüssel im Büro',
      notes: secondarySiteNotes,
      primaryContactName: primaryContact,
      isPrimary: true,
    });
    await expect(firstContactRow).toContainText(firstContactRole);
    await expect(firstContactRow).toContainText(firstContactEmail);
    await expect(firstContactRow).toContainText(firstContactNotes);
    await expect(customerSiteRow(adminPage, secondarySite)).toContainText(secondarySiteNotes);
    await expect(customerSiteRow(adminPage, secondarySite)).toContainText(CUSTOMER_TEXT.primarySite);
    await expect(
      customerSiteRow(adminPage, address).getByText(CUSTOMER_TEXT.primarySite, { exact: true }),
    ).toHaveCount(1);

    await archiveCustomerRelation(adminPage, 'contact', firstContact);
    await archiveCustomerRelation(adminPage, 'site', CUSTOMER_TEXT.primarySite);

    await adminPage.goto('/auftraege');
    await workCreateButton(adminPage).click();
    await workCreateTab(adminPage, 'job').click();
    await customerPicker(adminPage).click();
    await customerPickerSearch(adminPage).fill(customer);
    await adminPage.getByRole('listbox').getByRole('option').filter({ hasText: customer }).click();
    const jobDialog = adminPage.getByRole('dialog');
    await jobFormField(jobDialog, 'contact').click();
    const contactListbox = adminPage.getByRole('listbox');
    await expect(contactListbox).toBeVisible();
    await expect(contactListbox.getByRole('option').filter({ hasText: primaryContact })).toHaveCount(1);
    await expect(contactListbox.getByRole('option').filter({ hasText: firstContact })).toHaveCount(0);
    // Toggle the popover closed via its trigger; Escape would close the dialog.
    await jobFormField(jobDialog, 'contact').click();
    await jobFormField(jobDialog, 'site').click();
    await expect(
      adminPage.getByRole('listbox').getByRole('option').filter({ hasText: secondarySite }),
    ).toHaveCount(1);
    await expect(adminPage.getByRole('listbox').getByRole('option').filter({ hasText: street })).toHaveCount(
      0,
    );
    await jobFormField(jobDialog, 'site').click();
    await dismissDialog(jobDialog);

    await openSeededCustomerDetail(adminPage, seeded.clientId);
    await restoreCustomerRelation(adminPage, 'contact', firstContact);
    await restoreCustomerRelation(adminPage, 'site', CUSTOMER_TEXT.primarySite);
  });

  test('A2-04: Kundennummer ist manuell und organisationsweit eindeutig', async ({ adminPage, world }) => {
    const firstCustomer = `A2 Nummer Eins ${world.runId}`;
    const secondCustomer = `A2 Nummer Zwei ${world.runId}`;
    const customerNumber = `A2-K-${world.runId}`;
    const first = await seedCustomer({
      orgId: world.orgId,
      actorId: world.users.admin.id,
      name: firstCustomer,
    });
    const second = await seedCustomer({
      orgId: world.orgId,
      actorId: world.users.admin.id,
      name: secondCustomer,
    });

    await openSeededCustomerDetail(adminPage, first.clientId);
    await setCustomerNumber(adminPage, customerNumber);
    await expect(visibleText(adminPage, customerNumber)).toBeVisible({
      timeout: 15_000,
    });
    expect(await getCustomerNumber(world.orgId, firstCustomer)).toBe(customerNumber);

    await openSeededCustomerDetail(adminPage, second.clientId);
    await setCustomerNumber(adminPage, customerNumber);
    await expect(visibleText(adminPage, CUSTOMER_TEXT.customerNumberTaken)).toBeVisible({
      timeout: 15_000,
    });
    await adminPage.reload();
    expect(await getCustomerNumber(world.orgId, secondCustomer)).toBeNull();
    await expect(customerNumberField(adminPage)).toContainText('—');
  });

  test('A2-06: Projektvorgaben vererben sich, Auftrag darf abweichen und Kundenwechsel erhält Kinder', async ({
    adminPage,
    world,
  }) => {
    const sourceCustomer = `A2 Projektkunde ${world.runId}`;
    const targetCustomer = `A2 Projektkunde Neu ${world.runId}`;
    const inheritedContact = `A2 Projektkontakt ${world.runId}`;
    const overrideContact = `A2 Abweichender Kontakt ${world.runId}`;
    const inheritedSite = `A2 Projektstandort ${world.runId}`;
    const overrideSite = `A2 Abweichender Standort ${world.runId}`;
    const projectNumber = `A2-P-${world.runId}`;
    const plannedDateDigits = datePickerDigits(ownedBerlinDateAtOffset('a2-stammdaten', 25));

    const source = await seedCustomer({
      orgId: world.orgId,
      actorId: world.users.admin.id,
      name: sourceCustomer,
      contacts: [{ name: inheritedContact }, { name: overrideContact }],
      sites: [
        { name: inheritedSite, city: 'Berlin' },
        { name: overrideSite, city: 'Potsdam' },
      ],
    });
    await seedCustomer({ orgId: world.orgId, actorId: world.users.admin.id, name: targetCustomer });
    await seedProject({
      orgId: world.orgId,
      actorId: world.users.admin.id,
      projectNumber,
      name: `A2 Kundenwechsel ${world.runId}`,
      clientId: source.clientId,
      siteId: expectDefined(source.siteIds.get(inheritedSite), 'seeded project site'),
      contactId: expectDefined(source.contactIds.get(inheritedContact), 'seeded project contact'),
    });

    await createJob(adminPage, {
      jobNumber: `${projectNumber}-1`,
      title: `A2 geerbter Auftrag ${world.runId}`,
      clientName: sourceCustomer,
      projectNumber,
      expectedInheritedSiteName: inheritedSite,
      expectedInheritedContactName: inheritedContact,
      plannedDateDigits,
    });
    await createJob(adminPage, {
      jobNumber: `${projectNumber}-2`,
      title: `A2 abweichender Auftrag ${world.runId}`,
      clientName: sourceCustomer,
      projectNumber,
      siteName: overrideSite,
      contactName: overrideContact,
      plannedDateDigits,
    });

    const jobNumbers = [`${projectNumber}-1`, `${projectNumber}-2`];
    const before = await getProjectJobRelationState(world.orgId, projectNumber, jobNumbers);
    expect(before.jobs).toHaveLength(2);
    expect(before.jobs.every((job) => job.projectId === before.projectId)).toBe(true);
    expect(before.jobs[0]?.siteId).toBe(before.siteId);
    expect(before.jobs[0]?.contactId).toBe(before.contactId);
    expect(before.jobs[1]?.siteId).not.toBe(before.siteId);
    expect(before.jobs[1]?.contactId).not.toBe(before.contactId);

    await adminPage.goto(`/auftraege/${projectNumber}-2`);
    await adminPage.getByRole('button', { name: SHARED_COPY.action.openActions }).click();
    await adminPage.getByRole('menuitem', { name: SHARED_COPY.action.edit }).click();
    const jobDialog = jobEditDialog(adminPage);
    await selectFromSearchable(adminPage, jobDialog.locator('#edit-job-site'), inheritedSite);
    await selectFromSearchable(adminPage, jobDialog.locator('#edit-job-contact'), inheritedContact);
    await jobDialog.getByRole('button', { name: SHARED_COPY.action.save, exact: true }).click();
    await expect(jobDialog).toHaveCount(0, { timeout: 20_000 });
    const edited = await getProjectJobRelationState(world.orgId, projectNumber, jobNumbers);
    expect(edited.jobs[1]?.siteId).toBe(edited.siteId);
    expect(edited.jobs[1]?.contactId).toBe(edited.contactId);

    await adminPage.goto(`/auftraege/projekt/${projectNumber}`);
    await adminPage.getByRole('button', { name: SHARED_COPY.action.openActions }).click();
    await adminPage.getByRole('menuitem', { name: SHARED_COPY.action.edit }).click();
    const dialog = adminPage.getByRole('dialog');
    await selectFromSearchable(adminPage, dialog.locator('#edit-project-client'), targetCustomer);
    const saveProjectButton = dialog.getByRole('button', {
      name: SHARED_COPY.action.save,
      exact: true,
    });
    await expect(saveProjectButton).toBeEnabled();
    await saveProjectButton.click();
    await expect(dialog).toHaveCount(0, { timeout: 20_000 });

    const after = await getProjectJobRelationState(world.orgId, projectNumber, jobNumbers);
    expect(after.siteId).toBeNull();
    expect(after.contactId).toBeNull();
    expect(after.jobs).toHaveLength(2);
    for (const job of after.jobs) {
      expect(job.projectId).toBe(after.projectId);
      expect(job.clientId).toBe(after.clientId);
      expect(job.siteId).toBeNull();
      expect(job.contactId).toBeNull();
    }

    await adminPage.reload();
    await expect(visibleText(adminPage, targetCustomer)).toBeVisible();
    await expect(visibleText(adminPage, `${projectNumber}-1`)).toBeVisible();
    await expect(visibleText(adminPage, `${projectNumber}-2`)).toBeVisible();
  });

  test('A2-D01: Handwerker und fremde Organisation öffnen keinen Kundendatensatz direkt', async ({
    employeePage,
    outsiderPage,
    world,
  }) => {
    const { clientId } = await seedCustomer({
      orgId: world.orgId,
      actorId: world.users.admin.id,
      name: `A2 Geschützter Kunde ${world.runId}`,
    });
    await employeePage.goto(`/kunden/${clientId}`);
    await employeePage.waitForURL('**/dashboard', { timeout: 15_000 });
    await outsiderPage.goto(`/kunden/${clientId}`);
    await outsiderPage.waitForURL('**/kunden', { timeout: 15_000 });
  });
});

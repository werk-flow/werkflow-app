import { formatSiteAddress } from '../../lib/clients/types';
import { expect, test } from './support/fixtures';
import { seedCustomer } from './support/db/customers';
import { observeRouteRenders } from './support/route-renders';
import {
  addContactOnCustomerDetail,
  addSiteOnCustomerDetail,
  createCustomer,
  customerCountText,
  editSiteStreetOnCustomerDetail,
  openCustomerDetail,
  searchCustomers,
} from './support/steps/customers';
import { testData, visibleText, textInDom } from './support/steps/shared';
import { createJob, fieldPackCallLink, siteAccessText } from './support/steps/work';

// P1-01 — Customer contacts and work sites (@P1-01)
// Bounded outcome: Admin/Büro maintain multiple contacts and durable work
// sites per customer; work references the correct site/contact without
// duplicate customer records; site edits never rewrite recorded job locations.
// The audit file tests/audit/wave-1/a2-stammdaten.spec.ts owns primary flags,
// archiving, customer numbers, project defaults and the route boundary.

test.describe('P1-01 Kontakte und Einsatzorte @P1-01', () => {
  test('Kontakte und Einsatzorte tragen den Auftrag bis zum Handwerker, ohne erfasste Orte umzuschreiben', async ({
    adminPage,
    employeePage,
    world,
  }) => {
    const customer = `Hausverwaltung Weber ${world.runId}`;
    const jobNumber = `P101-${world.runId}-1`;
    const manager = {
      name: testData`Sabine Krause`,
      role: testData`Hausverwaltung`,
      phone: '030 1234567',
    };
    const buildingB = {
      name: testData`Gebäude B`,
      street: 'Beispielweg 2',
      postalCode: '10117',
      city: 'Berlin',
      accessNotes: 'Schlüssel beim Hausmeister',
    };

    // Each save renders the route once at most (tests/golden/route-renders.json).
    const renders = observeRouteRenders(adminPage, 'p1-01');

    await test.step('Admin pflegt Ansprechpartner und Einsatzorte am Kunden', async () => {
      await renders.forSave('customer.create', () => createCustomer(adminPage, customer));
      await openCustomerDetail(adminPage, customer);
      await renders.forSave('contact.add.first', () => addContactOnCustomerDetail(adminPage, manager));
      await renders.forSave('contact.add.second', () =>
        addContactOnCustomerDetail(adminPage, {
          name: 'Jörg Weber',
          role: 'Hausmeister/in',
        }),
      );
      await renders.forSave('site.add.first', () =>
        addSiteOnCustomerDetail(adminPage, {
          name: 'Gebäude A',
          street: 'Musterstraße 1',
          postalCode: '10115',
          city: 'Berlin',
        }),
      );
      await renders.forSave('site.add.second', () => addSiteOnCustomerDetail(adminPage, buildingB));
      await expect(visibleText(adminPage, manager.name)).toBeVisible();
      await expect(visibleText(adminPage, buildingB.name)).toBeVisible();
      await expect(visibleText(adminPage, formatSiteAddress(buildingB))).toBeVisible();
    });

    await test.step('Auftrag nutzt Einsatzort und Ansprechpartner ohne neuen Kundendatensatz', async () => {
      await createJob(adminPage, {
        jobNumber,
        title: 'Wartung Heizungsanlage Gebäude B',
        assignEmployeeName: 'Emil',
        clientName: customer,
        siteName: buildingB.name,
        contactName: manager.name,
      });
      // A second job at the same site reuses the same customer and site.
      await createJob(adminPage, {
        jobNumber: `P101-${world.runId}-2`,
        title: 'Nachbesserung Gebäude B',
        clientName: customer,
        siteName: buildingB.name,
      });
      // The job detail shows the selected site, the snapshot Ort, and contact.
      await adminPage.goto(`/auftraege/${jobNumber}`);
      await expect(visibleText(adminPage, buildingB.name)).toBeVisible();
      await expect(visibleText(adminPage, `${manager.name} (${manager.role})`)).toBeVisible();
      await expect(visibleText(adminPage, formatSiteAddress(buildingB))).toBeVisible();
      // Still exactly one customer record with this name.
      await adminPage.goto('/kunden');
      await expect(adminPage.getByRole('main').getByText(customer).filter({ visible: true })).toHaveCount(1);
    });

    await test.step('Handwerker sieht Einsatzort, Zugang und anrufbaren Ansprechpartner', async () => {
      await employeePage.goto(`/auftraege/${jobNumber}`);
      await expect(visibleText(employeePage, buildingB.name)).toBeVisible();
      await expect(visibleText(employeePage, formatSiteAddress(buildingB))).toBeVisible();
      await expect(visibleText(employeePage, siteAccessText(buildingB.accessNotes))).toBeVisible();
      const contact = employeePage.getByRole('main').getByTestId('field-work-pack-contact');
      await expect(contact.getByText(manager.name, { exact: true })).toBeVisible();
      await expect(contact.getByText(manager.role, { exact: true })).toBeVisible();
      // The contact's phone number is a click-to-call link (normalized href).
      await expect(fieldPackCallLink(employeePage, manager.name)).toHaveAttribute('href', 'tel:0301234567');
    });

    await test.step('Adressänderung am Einsatzort ändert den erfassten Auftrags-Ort nicht', async () => {
      const editedStreet = 'Beispielweg 99';
      await openCustomerDetail(adminPage, customer);
      await renders.forSave('site.edit', () =>
        editSiteStreetOnCustomerDetail(adminPage, buildingB.name, editedStreet),
      );
      await adminPage.goto(`/auftraege/${jobNumber}`);
      // The Ort snapshot keeps the address recorded at selection time…
      await expect(visibleText(adminPage, formatSiteAddress(buildingB))).toBeVisible();
      // …while the linked site shows the current master data.
      await expect(
        visibleText(adminPage, formatSiteAddress({ ...buildingB, street: editedStreet })),
      ).toBeVisible();
    });
  });

  test('Suche findet Kunden über Ansprechpartner und Einsatzort', async ({ bueroPage, world }) => {
    const customer = `Hausverwaltung Suche ${world.runId}`;
    const contact = `Petra Suchkontakt ${world.runId}`;
    const street = `Suchweg ${world.runId}`;
    await seedCustomer({
      orgId: world.orgId,
      actorId: world.users.admin.id,
      name: customer,
      contacts: [{ name: contact }],
      sites: [{ name: 'Gebäude Suche', street: `${street} 4`, postalCode: '10117', city: 'Berlin' }],
    });

    await searchCustomers(bueroPage, contact);
    await expect(visibleText(bueroPage, customer)).toBeVisible();

    await searchCustomers(bueroPage, street);
    await expect(visibleText(bueroPage, customer)).toBeVisible();

    await searchCustomers(bueroPage, 'gibtsnicht-xyz');
    // Wait for the filtered result count before asserting absence.
    await expect(visibleText(bueroPage, customerCountText(0))).toBeVisible();
    await expect(textInDom(bueroPage, customer)).toHaveCount(0);
  });
});

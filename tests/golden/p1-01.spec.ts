import { expect, test } from './support/fixtures';
import {
  addContactOnCustomerDetail,
  addSiteOnCustomerDetail,
  createCustomer,
  createJob,
  editSiteStreetOnCustomerDetail,
  openCustomerDetail,
  searchCustomers,
  visibleText,
  textInDom,
} from './support/steps';

// P1-01 — Customer contacts and work sites (@P1-01)
// Bounded outcome: Admin/Büro maintain multiple contacts and durable work
// sites per customer; work references the correct site/contact without
// duplicate customer records; site edits never rewrite recorded job locations.

test.describe.configure({ mode: 'serial' });

test.describe('P1-01 Kontakte und Einsatzorte @P1-01', () => {
  test('Admin pflegt Ansprechpartner und Einsatzorte am Kunden', async ({ adminPage, world }) => {
    await createCustomer(adminPage, `Hausverwaltung Weber ${world.runId}`);
    await openCustomerDetail(adminPage, `Hausverwaltung Weber ${world.runId}`);

    await addContactOnCustomerDetail(adminPage, {
      name: 'Sabine Krause',
      role: 'Hausverwaltung',
      phone: '030 1234567',
    });
    await addContactOnCustomerDetail(adminPage, {
      name: 'Jörg Weber',
      role: 'Hausmeister/in',
    });

    await addSiteOnCustomerDetail(adminPage, {
      name: 'Gebäude A',
      street: 'Musterstraße 1',
      postalCode: '10115',
      city: 'Berlin',
    });
    await addSiteOnCustomerDetail(adminPage, {
      name: 'Gebäude B',
      street: 'Beispielweg 2',
      postalCode: '10117',
      city: 'Berlin',
    });

    await expect(visibleText(adminPage, 'Sabine Krause')).toBeVisible();
    await expect(visibleText(adminPage, 'Gebäude B')).toBeVisible();
    await expect(visibleText(adminPage, 'Beispielweg 2, 10117 Berlin')).toBeVisible();
  });

  test('Auftrag nutzt Einsatzort und Ansprechpartner ohne neuen Kundendatensatz', async ({
    adminPage,
    world,
  }) => {
    await createJob(adminPage, {
      jobNumber: `P101-${world.runId}-1`,
      title: 'Wartung Heizungsanlage Gebäude B',
      assignEmployeeName: 'Emil',
      clientName: `Hausverwaltung Weber ${world.runId}`,
      siteName: 'Gebäude B',
      contactName: 'Sabine Krause',
    });

    // A second job at the same site reuses the same customer and site.
    await createJob(adminPage, {
      jobNumber: `P101-${world.runId}-2`,
      title: 'Nachbesserung Gebäude B',
      clientName: `Hausverwaltung Weber ${world.runId}`,
      siteName: 'Gebäude B',
    });

    // The job detail shows the selected site, the snapshot Ort, and contact.
    await adminPage.goto(`/auftraege/P101-${world.runId}-1`);
    await expect(visibleText(adminPage, 'Gebäude B')).toBeVisible();
    await expect(visibleText(adminPage, 'Sabine Krause (Hausverwaltung)')).toBeVisible();
    await expect(visibleText(adminPage, 'Beispielweg 2, 10117 Berlin')).toBeVisible();

    // Still exactly one customer record with this name.
    await adminPage.goto('/kunden');
    await expect(
      adminPage
        .getByRole('main')
        .getByText(`Hausverwaltung Weber ${world.runId}`)
        .filter({ visible: true })
    ).toHaveCount(1);
  });

  test('Adressänderung am Einsatzort ändert den erfassten Auftrags-Ort nicht', async ({
    adminPage,
    world,
  }) => {
    await openCustomerDetail(adminPage, `Hausverwaltung Weber ${world.runId}`);
    await editSiteStreetOnCustomerDetail(adminPage, 'Gebäude B', 'Beispielweg 99');

    await adminPage.goto(`/auftraege/P101-${world.runId}-1`);
    // The Ort snapshot keeps the address recorded at selection time…
    await expect(visibleText(adminPage, 'Beispielweg 2, 10117 Berlin')).toBeVisible();
    // …while the linked site shows the current master data.
    await expect(visibleText(adminPage, 'Beispielweg 99, 10117 Berlin')).toBeVisible();
  });

  test('Mitarbeiter sieht Einsatzort und Ansprechpartner am zugewiesenen Auftrag', async ({
    employeePage,
    world,
  }) => {
    await employeePage.goto(`/auftraege/P101-${world.runId}-1`);
    await expect(visibleText(employeePage, 'Gebäude B')).toBeVisible();
    const contact = employeePage.getByTestId('field-work-pack-contact');
    await expect(contact.getByText('Sabine Krause', { exact: true })).toBeVisible();
    await expect(contact.getByText('Hausverwaltung', { exact: true })).toBeVisible();
    // The contact's phone number is a click-to-call link (normalized href).
    await expect(employeePage.getByRole('link', { name: 'Sabine Krause anrufen' })).toHaveAttribute(
      'href',
      'tel:0301234567'
    );
  });

  test('Suche findet Kunden über Ansprechpartner und Einsatzort', async ({ bueroPage, world }) => {
    await searchCustomers(bueroPage, 'Sabine Krause');
    await expect(visibleText(bueroPage, `Hausverwaltung Weber ${world.runId}`)).toBeVisible();

    await searchCustomers(bueroPage, 'Beispielweg');
    await expect(visibleText(bueroPage, `Hausverwaltung Weber ${world.runId}`)).toBeVisible();

    await searchCustomers(bueroPage, 'gibtsnicht-xyz');
    // Wait for the filtered result count before asserting absence.
    await expect(visibleText(bueroPage, '0 Kunden')).toBeVisible();
    await expect(textInDom(bueroPage, `Hausverwaltung Weber ${world.runId}`)).toHaveCount(0);
  });

  test('Fremde Organisation sieht keine Kunden, Kontakte oder Einsatzorte', async ({
    outsiderPage,
    world,
  }) => {
    await outsiderPage.goto('/kunden');
    await expect(textInDom(outsiderPage, `Hausverwaltung Weber ${world.runId}`)).toHaveCount(0);
    await expect(textInDom(outsiderPage, 'Sabine Krause')).toHaveCount(0);
  });
});

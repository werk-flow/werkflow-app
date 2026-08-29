import { resolve } from 'node:path';

import { expect, test } from './support/fixtures';
import { getRequestConversionState } from './support/db';
import {
  addContactOnCustomerDetail,
  addSiteOnCustomerDetail,
  closeRequestViaDialog,
  convertRequestToJobViaDialog,
  createCustomer,
  createJob,
  createRequestViaDialog,
  expectRedirectedAway,
  openCustomerDetail,
  uploadDocumentOnRequestDetail,
  visibleText,
  textInDom,
} from './support/steps';
import { ARTIFACTS_DIR } from './support/world';

// GG-01 — Customer Request To Work (@GG-01)
// Roadmap scenario: create a commercial customer with multiple contacts/sites,
// capture a request while speaking to the caller, attach evidence, convert it
// once into operational work carrying the correct customer/contact/site and
// context, and verify direct repeat-job creation without a synthetic request.

test.describe.configure({ mode: 'serial' });

// The first request's id, captured on creation for the direct-URL
// authorization checks at the end of the serial suite.
let firstRequestId = '';

test.describe('GG-01 Anfrage zu Auftrag @GG-01', () => {
  test('Admin legt einen Gewerbekunden mit Ansprechpartnern und Einsatzorten an', async ({
    adminPage,
    world,
  }) => {
    await createCustomer(adminPage, `Bäckerei Brotmann ${world.runId}`, {
      type: 'Gewerblich',
    });
    await openCustomerDetail(adminPage, `Bäckerei Brotmann ${world.runId}`);

    await addContactOnCustomerDetail(adminPage, {
      name: 'Karin Brotmann',
      role: 'Eigentümer/in',
      phone: '089 555111',
    });
    await addContactOnCustomerDetail(adminPage, {
      name: 'Milan Petrovic',
      role: 'Hausmeister/in',
    });

    await addSiteOnCustomerDetail(adminPage, {
      name: 'Filiale Zentrum',
      street: 'Marktplatz 3',
      postalCode: '80331',
      city: 'München',
    });
    await addSiteOnCustomerDetail(adminPage, {
      name: 'Backstube Nord',
      street: 'Industriestraße 12',
      postalCode: '80807',
      city: 'München',
    });
  });

  test('Büro erfasst eine Anfrage während des Anrufs mit Anhang', async ({ bueroPage, world }) => {
    firstRequestId = await createRequestViaDialog(bueroPage, {
      summary: 'Durchlauferhitzer in der Backstube ausgefallen',
      requestNumber: `ANF-${world.runId}-1`,
      clientName: `Bäckerei Brotmann ${world.runId}`,
      siteName: 'Backstube Nord',
      contactName: 'Milan Petrovic',
      categoryLabel: 'Störung / Reparatur',
      urgencyLabel: 'Hoch',
    });

    // The request detail shows the linked customer identity, not copies.
    await expect(visibleText(bueroPage, `Bäckerei Brotmann ${world.runId}`)).toBeVisible();
    await expect(visibleText(bueroPage, 'Backstube Nord')).toBeVisible();
    await expect(visibleText(bueroPage, 'Milan Petrovic')).toBeVisible();

    await uploadDocumentOnRequestDetail(
      bueroPage,
      resolve(ARTIFACTS_DIR, 'upload-fixture.pdf'),
      'upload-fixture'
    );
  });

  test('Büro wandelt die Anfrage genau einmal in einen Auftrag um', async ({
    bueroPage,
    world,
  }) => {
    await bueroPage.goto('/anfragen');
    await visibleText(bueroPage, `ANF-${world.runId}-1`).click();
    await expect(
      visibleText(bueroPage, 'Durchlauferhitzer in der Backstube ausgefallen')
    ).toBeVisible();

    await convertRequestToJobViaDialog(bueroPage);

    // Once-only conversion: the action is gone and the DB records exactly one
    // attributable conversion target.
    await expect(bueroPage.getByRole('button', { name: 'Umwandeln' })).toHaveCount(0);
    const conversion = await getRequestConversionState(world.orgId, `ANF-${world.runId}-1`);
    expect(conversion.status).toBe('umgewandelt');
    expect(conversion.convertedJobId).not.toBeNull();
    expect(conversion.convertedProjectId).toBeNull();
    expect(conversion.convertedBy).toBe(world.users.buero.id);

    // The created job carries customer, site, contact, Ort snapshot, context,
    // and the attachment — nothing was retyped.
    await bueroPage.getByRole('link', { name: /Auftrag AUF-/ }).click();
    await expect(
      visibleText(bueroPage, 'Durchlauferhitzer in der Backstube ausgefallen')
    ).toBeVisible({ timeout: 15_000 });
    await expect(visibleText(bueroPage, `Bäckerei Brotmann ${world.runId}`)).toBeVisible();
    await expect(visibleText(bueroPage, 'Backstube Nord')).toBeVisible();
    await expect(visibleText(bueroPage, 'Milan Petrovic (Hausmeister/in)')).toBeVisible();
    await expect(visibleText(bueroPage, 'Industriestraße 12, 80807 München')).toBeVisible();
    await expect(visibleText(bueroPage, 'upload-fixture')).toBeVisible({
      timeout: 15_000,
    });
    // The work links back to its origin request.
    await expect(visibleText(bueroPage, 'Entstanden aus')).toBeVisible();
  });

  test('Unbekannte Anruferin wird erfasst und ohne Neueingabe zum Kunden', async ({
    bueroPage,
    world,
  }) => {
    await createRequestViaDialog(bueroPage, {
      summary: 'Tropfender Wasserhahn in der Küche',
      requestNumber: `ANF-${world.runId}-2`,
      callerName: `Renate Neuling ${world.runId}`,
      callerPhone: '089 555999',
      categoryLabel: 'Störung / Reparatur',
    });

    // Promote the caller into a customer straight from the captured data.
    await bueroPage.getByRole('button', { name: 'Als neuen Kunden anlegen' }).click();
    await expect(
      visibleText(bueroPage, 'Kunde wurde angelegt und der Anfrage zugeordnet.')
    ).toBeVisible({ timeout: 15_000 });
    await expect(
      bueroPage.getByRole('link', { name: `Renate Neuling ${world.runId}` })
    ).toBeVisible({ timeout: 15_000 });

    // The promoted customer exists once in the customer master.
    await bueroPage.goto('/kunden');
    await expect(
      bueroPage
        .getByRole('main')
        .getByText(`Renate Neuling ${world.runId}`)
        .filter({ visible: true })
    ).toHaveCount(1);
  });

  test('Eine Anfrage kann ohne Auftrag mit Grund geschlossen werden', async ({
    bueroPage,
    world,
  }) => {
    await createRequestViaDialog(bueroPage, {
      summary: 'Frage zu Wartungsintervallen',
      requestNumber: `ANF-${world.runId}-3`,
      categoryLabel: 'Allgemeine Frage',
    });

    await closeRequestViaDialog(bueroPage, 'Anderweitig gelöst');
    await expect(visibleText(bueroPage, 'Geschlossen')).toBeVisible();

    // History is retained: the request stays findable under its filter.
    await bueroPage.goto('/anfragen');
    await bueroPage.getByRole('tab', { name: 'Geschlossen' }).click();
    await expect(visibleText(bueroPage, `ANF-${world.runId}-3`)).toBeVisible();
  });

  test('Direkter Folgeauftrag funktioniert weiterhin ohne künstliche Anfrage', async ({
    adminPage,
    world,
  }) => {
    await createJob(adminPage, {
      jobNumber: `GG1-${world.runId}-D`,
      title: 'Filterwechsel Filiale Zentrum',
      clientName: `Bäckerei Brotmann ${world.runId}`,
      siteName: 'Filiale Zentrum',
    });

    await adminPage.goto('/auftraege');
    await expect(visibleText(adminPage, `GG1-${world.runId}-D`)).toBeVisible();

    // No synthetic request appeared for the direct job.
    await adminPage.goto('/anfragen');
    await adminPage.getByRole('tab', { name: 'Alle' }).click();
    await expect(textInDom(adminPage, 'Filterwechsel Filiale Zentrum')).toHaveCount(0);
  });

  test('Mitarbeiter hat keinen Zugriff auf Anfragen', async ({ employeePage }) => {
    await expectRedirectedAway(employeePage, '/anfragen');
    // The direct detail URL is equally protected.
    await expectRedirectedAway(employeePage, `/anfragen/${firstRequestId}`);
    await expect(
      textInDom(employeePage, 'Durchlauferhitzer in der Backstube ausgefallen')
    ).toHaveCount(0);
    await employeePage.goto('/dashboard');
    await expect(employeePage.getByRole('link', { name: 'Anfragen' })).toHaveCount(0);
  });

  test('Fremde Organisation sieht keine Anfragen', async ({ outsiderPage, world }) => {
    await outsiderPage.goto('/anfragen');
    await outsiderPage.getByRole('tab', { name: 'Alle' }).click();
    await expect(textInDom(outsiderPage, `ANF-${world.runId}-1`)).toHaveCount(0);
    await expect(
      textInDom(outsiderPage, 'Durchlauferhitzer in der Backstube ausgefallen')
    ).toHaveCount(0);

    // The direct detail URL of the other organization's request is not found.
    await outsiderPage.goto(`/anfragen/${firstRequestId}`);
    await expect(
      textInDom(outsiderPage, 'Durchlauferhitzer in der Backstube ausgefallen')
    ).toHaveCount(0);
    await expect(textInDom(outsiderPage, `ANF-${world.runId}-1`)).toHaveCount(0);
  });
});

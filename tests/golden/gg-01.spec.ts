import { resolve } from 'node:path';

import { formatSiteAddress } from '../../lib/clients/types';
import {
  REQUEST_CATEGORY_LABELS,
  REQUEST_CLOSE_REASON_LABELS,
  REQUEST_STATUS_LABELS,
  REQUEST_URGENCY_LABELS,
} from '../../lib/requests/types';
import { expect, test } from './support/fixtures';
import { getRequestConversionState } from './support/db/requests';
import {
  addContactOnCustomerDetail,
  addSiteOnCustomerDetail,
  createCustomer,
  CUSTOMER_DETAIL_TITLE,
  openCustomerDetail,
} from './support/steps/customers';
import {
  closeRequestViaDialog,
  convertedJobLink,
  convertRequestToJobViaDialog,
  createRequestViaDialog,
  promoteCallerButton,
  REQUEST_DETAIL_TEXT,
  requestConvertButton,
  showRequestStatus,
  uploadDocumentOnRequestDetail,
} from './support/steps/requests';
import { testData, visibleText, textInDom } from './support/steps/shared';
import { createJob } from './support/steps/work';
import { artifactsDirectory } from './support/world';

// GG-01 — Customer Request To Work (@GG-01)
// Roadmap scenario: create a commercial customer with multiple contacts/sites,
// capture a request while speaking to the caller, attach evidence, convert it
// once into operational work carrying the correct customer/contact/site and
// context, and verify direct repeat-job creation without a synthetic request.
// The audit file tests/audit/wave-1/a2-anfragen.spec.ts owns the edge cases
// and the employee and outside-organization boundaries.

test.describe('GG-01 Anfrage zu Auftrag @GG-01', () => {
  test('Gewerbekunde, Anfrage im Anruf, einmalige Umwandlung und direkter Folgeauftrag', async ({
    adminPage,
    bueroPage,
    world,
  }) => {
    const customer = `Bäckerei Brotmann ${world.runId}`;
    const requestNumber = `ANF-${world.runId}-1`;
    const summary = testData`Durchlauferhitzer in der Backstube ausgefallen`;
    const caretaker = { name: testData`Milan Petrovic`, role: testData`Hausmeister/in` };
    const centralSite = {
      name: testData`Filiale Zentrum`,
      street: 'Marktplatz 3',
      postalCode: '80331',
      city: 'München',
    };
    const bakerySite = {
      name: testData`Backstube Nord`,
      street: 'Industriestraße 12',
      postalCode: '80807',
      city: 'München',
    };
    const fileName = testData`upload-fixture`;
    const directJobTitle = testData`Filterwechsel Filiale Zentrum`;

    await test.step('Admin legt einen Gewerbekunden mit Ansprechpartnern und Einsatzorten an', async () => {
      await createCustomer(adminPage, customer, { type: 'gewerblich' });
      await openCustomerDetail(adminPage, customer);
      await addContactOnCustomerDetail(adminPage, {
        name: 'Karin Brotmann',
        role: 'Eigentümer/in',
        phone: '089 555111',
      });
      await addContactOnCustomerDetail(adminPage, caretaker);
      await addSiteOnCustomerDetail(adminPage, centralSite);
      await addSiteOnCustomerDetail(adminPage, bakerySite);
    });

    await test.step('Büro erfasst eine Anfrage während des Anrufs mit Anhang', async () => {
      await createRequestViaDialog(bueroPage, {
        summary,
        requestNumber,
        clientName: customer,
        siteName: bakerySite.name,
        contactName: caretaker.name,
        categoryLabel: REQUEST_CATEGORY_LABELS.stoerung_reparatur,
        urgencyLabel: REQUEST_URGENCY_LABELS.hoch,
      });
      // The request detail shows the linked customer identity, not copies.
      await expect(visibleText(bueroPage, customer)).toBeVisible();
      await expect(visibleText(bueroPage, bakerySite.name)).toBeVisible();
      await expect(visibleText(bueroPage, caretaker.name)).toBeVisible();
      await uploadDocumentOnRequestDetail(
        bueroPage,
        resolve(artifactsDirectory(), `${fileName}.pdf`),
        fileName,
      );
    });

    await test.step('Büro wandelt die Anfrage genau einmal in einen Auftrag um', async () => {
      await bueroPage.goto('/anfragen');
      await visibleText(bueroPage, requestNumber).click();
      await expect(visibleText(bueroPage, summary)).toBeVisible();
      await convertRequestToJobViaDialog(bueroPage);

      // Once-only conversion: the action is gone and the DB records exactly one
      // attributable conversion target.
      await expect(requestConvertButton(bueroPage)).toHaveCount(0);
      const conversion = await getRequestConversionState(world.orgId, requestNumber);
      expect(conversion.status).toBe('umgewandelt');
      expect(conversion.convertedJobId).not.toBeNull();
      expect(conversion.convertedProjectId).toBeNull();
      expect(conversion.convertedBy).toBe(world.users.buero.id);

      // The created job carries customer, site, contact, Ort snapshot, context,
      // and the attachment — nothing was retyped.
      await convertedJobLink(bueroPage).click();
      await expect(visibleText(bueroPage, summary)).toBeVisible({ timeout: 15_000 });
      await expect(visibleText(bueroPage, customer)).toBeVisible();
      await expect(visibleText(bueroPage, bakerySite.name)).toBeVisible();
      await expect(visibleText(bueroPage, `${caretaker.name} (${caretaker.role})`)).toBeVisible();
      await expect(visibleText(bueroPage, formatSiteAddress(bakerySite))).toBeVisible();
      await expect(visibleText(bueroPage, fileName)).toBeVisible({ timeout: 15_000 });
      // The work links back to its origin request.
      await expect(visibleText(bueroPage, REQUEST_DETAIL_TEXT.workOrigin)).toBeVisible();
    });

    await test.step('Direkter Folgeauftrag funktioniert ohne künstliche Anfrage', async () => {
      const directJobNumber = `GG1-${world.runId}-D`;
      await createJob(adminPage, {
        jobNumber: directJobNumber,
        title: directJobTitle,
        clientName: customer,
        siteName: centralSite.name,
      });
      await adminPage.goto('/auftraege');
      await expect(visibleText(adminPage, directJobNumber)).toBeVisible();
      // No synthetic request appeared for the direct job.
      await adminPage.goto('/anfragen');
      await showRequestStatus(adminPage, 'alle');
      await expect(textInDom(adminPage, directJobTitle)).toHaveCount(0);
    });
  });

  test('Unbekannte Anruferin wird erfasst und ohne Neueingabe zum Kunden', async ({ bueroPage, world }) => {
    const caller = `Renate Neuling ${world.runId}`;
    await createRequestViaDialog(bueroPage, {
      summary: 'Tropfender Wasserhahn in der Küche',
      requestNumber: `ANF-${world.runId}-2`,
      callerName: caller,
      callerPhone: '089 555999',
      categoryLabel: REQUEST_CATEGORY_LABELS.stoerung_reparatur,
    });

    // Promote the caller into a customer straight from the captured data.
    await promoteCallerButton(bueroPage).click();
    await expect(visibleText(bueroPage, REQUEST_DETAIL_TEXT.callerPromoted)).toBeVisible({
      timeout: 15_000,
    });
    const customerLink = bueroPage.getByRole('link', { name: caller, exact: true });
    await expect(customerLink).toBeVisible({ timeout: 15_000 });

    // The promoted customer carries the captured phone without retyping.
    await customerLink.click();
    await expect(visibleText(bueroPage, CUSTOMER_DETAIL_TITLE)).toBeVisible({ timeout: 15_000 });
    await expect(visibleText(bueroPage, '089 555999')).toBeVisible();

    // The promoted customer exists once in the customer master.
    await bueroPage.goto('/kunden');
    await expect(bueroPage.getByRole('main').getByText(caller).filter({ visible: true })).toHaveCount(1);
  });

  test('Eine Anfrage kann ohne Auftrag mit Grund geschlossen werden', async ({ bueroPage, world }) => {
    const requestNumber = `ANF-${world.runId}-3`;
    await createRequestViaDialog(bueroPage, {
      summary: 'Frage zu Wartungsintervallen',
      requestNumber,
      categoryLabel: REQUEST_CATEGORY_LABELS.allgemeine_frage,
    });

    await closeRequestViaDialog(bueroPage, REQUEST_CLOSE_REASON_LABELS.anderweitig_geloest);
    await expect(visibleText(bueroPage, REQUEST_STATUS_LABELS.geschlossen)).toBeVisible();

    // History is retained: the request stays findable under its filter.
    await bueroPage.goto('/anfragen');
    await showRequestStatus(bueroPage, 'geschlossen');
    await expect(visibleText(bueroPage, requestNumber)).toBeVisible();
  });
});

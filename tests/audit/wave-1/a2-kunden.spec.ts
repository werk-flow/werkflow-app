import { resolve } from 'node:path';
import type { Locator, Page } from '@playwright/test';

import { expect, test } from '../../golden/support/fixtures';
import { ARTIFACTS_DIR } from '../../golden/support/world';
import { berlinDateAtOffset, ownedBerlinDateAtOffset } from '../../golden/support/date-ownership';
import { requireVisiblePrecondition } from '../../golden/support/preconditions';
import {
  getConvertedRequestJobState,
  getCustomerNumber,
  getCustomerRelationshipState,
  getEmployeeRecordStateByUser,
  getJobSiteContactState,
  getPendingInviteCode,
  getProjectJobRelationState,
  getRequestAuditState,
  getRequestConversionState,
} from '../../golden/support/db';
import {
  addContactOnCustomerDetail,
  addSiteOnCustomerDetail,
  adoptCustomerAddressAsSite,
  archiveCustomerRelation,
  attentionTaskLink,
  closeRequestViaDialog,
  completeFollowUpOnCustomerDetail,
  configureCustomerCommunicationSettings,
  convertRequestToProjectViaDialog,
  createCustomer,
  createFollowUpOnCustomerDetail,
  createJob,
  createProject,
  createRequestViaDialog,
  inviteMember,
  joinOrganizationViaInviteLink,
  matchRequestToExistingCustomer,
  openAufgaben,
  openCustomerDetail,
  removeMemberFromDetail,
  restoreCustomerRelation,
  setCustomerCommunicationPreference,
  selectFromSearchable,
  setRequestStatusFromDetail,
  typeIntoDateTimeField,
  uploadDocumentOnJobPage,
  uploadDocumentOnRequestDetail,
  visibleText,
  textInDom,
} from '../../golden/support/steps';
import {
  contextualDocumentFileInput,
  customerContactRow,
  customerSiteRow,
  newestCustomerTimelineRow,
} from '../support/a2-steps';
import { waitForRouteIntercept } from '../support/network';

test.describe.configure({ mode: 'serial' });

function datePickerDigits(dateIso: string): string {
  const [year, month, day] = dateIso.split('-');
  return `${day}${month}${year}`;
}

function fullName(user: { firstName: string; lastName: string }): string {
  return `${user.firstName} ${user.lastName}`;
}

async function setCustomerNumber(page: Page, value: string): Promise<void> {
  const row = visibleText(page, 'Kundennummer').locator('..');
  await row.getByRole('button', { name: 'Kundennummer bearbeiten' }).click();
  await row.getByRole('textbox').fill(value);
  await row.getByRole('button', { name: 'Speichern', exact: true }).click();
}

async function openProject(page: Page, projectNumber: string): Promise<void> {
  await page.goto('/auftraege');
  await visibleText(page, projectNumber).click();
  await expect(page).toHaveURL(new RegExp(`/auftraege/projekt/${projectNumber}$`), {
    timeout: 15_000,
  });
}

async function expectSelectOptions(page: Page, trigger: Locator, labels: string[]): Promise<void> {
  await trigger.click();
  for (const label of labels) {
    await expect(page.getByRole('option', { name: label, exact: true })).toBeVisible();
  }
  await page.getByRole('option', { name: labels[0], exact: true }).click();
}

async function createTimelineFollowUp(
  page: Page,
  sourceText: string,
  sourceLabel: string,
  title: string,
  dueAtLocal: string
): Promise<void> {
  const sourceRow = page
    .getByTestId('customer-timeline')
    .locator('[data-timeline-key]')
    .filter({ hasText: sourceText })
    .filter({ has: page.getByRole('button', { name: 'Hierzu nachfassen' }) });
  await sourceRow.getByRole('button', { name: 'Hierzu nachfassen' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText(`Quelle: ${sourceLabel}`);
  await dialog.locator('#follow-up-title').fill(title);
  await typeIntoDateTimeField(dialog, 'follow-up-due', dueAtLocal);
  await dialog.getByRole('button', { name: 'Speichern', exact: true }).click();
  await expect(dialog).toHaveCount(0, { timeout: 15_000 });
  await expect(visibleText(page, title)).toBeVisible({ timeout: 15_000 });
}

test.describe('A2 Kundencluster @AUDIT-W1-A2', () => {
  test('A2-01/A2-02/A2-03: Hauptkontakte, Archiv/Wiederherstellung und Kundenadresse als Einsatzort', async ({
    adminPage,
    world,
  }) => {
    const customer = `A2 Kundenstamm ${world.runId}`;
    const firstContact = `A2 Erstkontakt ${world.runId}`;
    const primaryContact = `A2 Hauptkontakt ${world.runId}`;
    const secondarySite = `A2 Nebenstelle ${world.runId}`;
    const address = 'A2 Hauptstraße 25, 10115 Berlin';

    await createCustomer(adminPage, customer, { type: 'Gewerblich', address });
    await openCustomerDetail(adminPage, customer);
    await adminPage.getByRole('button', { name: 'Ansprechpartner hinzufügen' }).click();
    const contactDialog = adminPage.getByRole('dialog');
    await expect(contactDialog.locator('#contact-role')).toHaveAttribute(
      'list',
      'contact-role-suggestions'
    );
    expect(
      await contactDialog
        .locator('#contact-role-suggestions option')
        .evaluateAll((options) => options.map((option) => option.getAttribute('value')))
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
    await contactDialog.getByRole('button', { name: 'Abbrechen' }).click();
    await addContactOnCustomerDetail(adminPage, {
      name: firstContact,
      role: 'Technische Leitung',
      phone: '+49 30 250001',
      email: `technik-${world.runId}@example.test`,
      notes: 'Entscheidet über Wartungsfreigaben',
    });
    await addContactOnCustomerDetail(adminPage, {
      name: primaryContact,
      phone: '+49 30 250002',
      isPrimary: true,
    });
    const firstContactRow = customerContactRow(adminPage, firstContact);
    const primaryContactRow = customerContactRow(adminPage, primaryContact);
    await expect(primaryContactRow).toContainText('Hauptkontakt');
    await expect(firstContactRow).not.toContainText('Hauptkontakt');

    await adoptCustomerAddressAsSite(adminPage);
    await expect(
      customerSiteRow(adminPage, 'Hauptstandort')
    ).toContainText(address);
    await addSiteOnCustomerDetail(adminPage, {
      name: secondarySite,
      street: 'Nebenstraße 29',
      postalCode: '10117',
      city: 'Berlin',
      accessNotes: 'Schlüssel im Büro',
      notes: 'Anlieferung nur über den Innenhof',
      primaryContactName: primaryContact,
      isPrimary: true,
    });
    await expect(firstContactRow).toContainText('Technische Leitung');
    await expect(firstContactRow).toContainText(`technik-${world.runId}@example.test`);
    await expect(firstContactRow).toContainText('Entscheidet über Wartungsfreigaben');
    await expect(customerSiteRow(adminPage, secondarySite)).toContainText(
      'Anlieferung nur über den Innenhof'
    );
    await expect(customerSiteRow(adminPage, secondarySite)).toContainText('Hauptstandort');
    await expect(
      customerSiteRow(adminPage, address).getByText('Hauptstandort', { exact: true })
    ).toHaveCount(1);

    await archiveCustomerRelation(adminPage, 'Ansprechpartner', firstContact);
    await archiveCustomerRelation(adminPage, 'Einsatzort', 'Hauptstandort');

    await adminPage.goto('/auftraege');
    await adminPage.getByRole('button', { name: 'Erstellen', exact: true }).click();
    await adminPage.getByRole('tab', { name: 'Auftrag erstellen' }).click();
    await adminPage.getByRole('combobox').filter({ hasText: 'Kein Kunde' }).click();
    await adminPage.getByPlaceholder('Kunde suchen...').fill(customer);
    await adminPage.getByRole('listbox').getByRole('button').filter({ hasText: customer }).click();
    const jobDialog = adminPage.getByRole('dialog');
    await jobDialog.locator('#job-contact').click();
    const contactListbox = adminPage.getByRole('listbox');
    await expect(contactListbox).toBeVisible();
    await expect(contactListbox.getByRole('button').filter({ hasText: firstContact })).toHaveCount(
      0
    );
    // Toggle the popover closed via its trigger; Escape would close the dialog.
    await jobDialog.locator('#job-contact').click();
    await jobDialog.locator('#job-site').click();
    await expect(
      adminPage.getByRole('listbox').getByRole('button').filter({ hasText: 'A2 Hauptstraße 25' })
    ).toHaveCount(0);
    await jobDialog.locator('#job-site').click();
    await adminPage.keyboard.press('Escape');

    await openCustomerDetail(adminPage, customer);
    await restoreCustomerRelation(adminPage, 'Ansprechpartner', firstContact);
    await restoreCustomerRelation(adminPage, 'Einsatzort', 'Hauptstandort');
  });

  test('A2-04: Kundennummer ist manuell und organisationsweit eindeutig', async ({
    adminPage,
    world,
  }) => {
    const firstCustomer = `A2 Nummer Eins ${world.runId}`;
    const secondCustomer = `A2 Nummer Zwei ${world.runId}`;
    const customerNumber = `A2-K-${world.runId}`;

    await createCustomer(adminPage, firstCustomer);
    await openCustomerDetail(adminPage, firstCustomer);
    await setCustomerNumber(adminPage, customerNumber);
    await expect(visibleText(adminPage, customerNumber)).toBeVisible({
      timeout: 15_000,
    });
    expect(await getCustomerNumber(world.orgId, firstCustomer)).toBe(customerNumber);

    await createCustomer(adminPage, secondCustomer);
    await openCustomerDetail(adminPage, secondCustomer);
    await setCustomerNumber(adminPage, customerNumber);
    await expect(visibleText(adminPage, 'Diese Kundennummer ist bereits vergeben.')).toBeVisible({
      timeout: 15_000,
    });
    await adminPage.reload();
    expect(await getCustomerNumber(world.orgId, secondCustomer)).toBeNull();
    const numberRow = visibleText(adminPage, 'Kundennummer').locator('..');
    await expect(numberRow).toContainText('—');
  });

  // This serial journey intentionally reuses the customer relations created in
  // A2-01; the complete A2 spec remains the standalone execution boundary.
  test('A2-06: Projektvorgaben vererben sich, Auftrag darf abweichen und Kundenwechsel erhält Kinder', async ({
    adminPage,
    world,
  }) => {
    const sourceCustomer = `A2 Kundenstamm ${world.runId}`;
    const targetCustomer = `A2 Projektkunde Neu ${world.runId}`;
    const inheritedContact = `A2 Hauptkontakt ${world.runId}`;
    const overrideContact = `A2 Erstkontakt ${world.runId}`;
    const inheritedSite = `A2 Nebenstelle ${world.runId}`;
    const overrideSite = 'Hauptstandort';
    const projectNumber = `A2-P-${world.runId}`;

    await adminPage.goto('/kunden');
    await requireVisiblePrecondition(visibleText(adminPage, sourceCustomer), {
      test: 'A2-06',
      needs: 'the customer and relations created by A2-01',
      grep: 'A2-01|A2-06',
      suite: 'audit',
    });
    await visibleText(adminPage, sourceCustomer).click();
    await requireVisiblePrecondition(visibleText(adminPage, inheritedContact), {
      test: 'A2-06',
      needs: 'the customer and relations created by A2-01',
      grep: 'A2-01|A2-06',
      suite: 'audit',
    });
    await requireVisiblePrecondition(visibleText(adminPage, inheritedSite), {
      test: 'A2-06',
      needs: 'the customer and relations created by A2-01',
      grep: 'A2-01|A2-06',
      suite: 'audit',
    });

    await createCustomer(adminPage, targetCustomer);
    await createProject(adminPage, {
      projectNumber,
      title: `A2 Kundenwechsel ${world.runId}`,
      clientName: sourceCustomer,
      siteName: inheritedSite,
      contactName: inheritedContact,
    });
    await createJob(adminPage, {
      jobNumber: `${projectNumber}-1`,
      title: `A2 geerbter Auftrag ${world.runId}`,
      clientName: sourceCustomer,
      projectNumber,
      expectedInheritedSiteName: inheritedSite,
      expectedInheritedContactName: inheritedContact,
      plannedDateDigits: datePickerDigits(ownedBerlinDateAtOffset('a2-kunden', 25)),
    });
    await createJob(adminPage, {
      jobNumber: `${projectNumber}-2`,
      title: `A2 abweichender Auftrag ${world.runId}`,
      clientName: sourceCustomer,
      projectNumber,
      siteName: overrideSite,
      contactName: overrideContact,
      plannedDateDigits: datePickerDigits(ownedBerlinDateAtOffset('a2-kunden', 25)),
    });

    const jobNumbers = [`${projectNumber}-1`, `${projectNumber}-2`];
    const before = await getProjectJobRelationState(world.orgId, projectNumber, jobNumbers);
    expect(before.jobs).toHaveLength(2);
    expect(before.jobs.every((job) => job.projectId === before.projectId)).toBe(true);
    expect(before.jobs[0].siteId).toBe(before.siteId);
    expect(before.jobs[0].contactId).toBe(before.contactId);
    expect(before.jobs[1].siteId).not.toBe(before.siteId);
    expect(before.jobs[1].contactId).not.toBe(before.contactId);

    await adminPage.goto(`/auftraege/${projectNumber}-2`);
    await adminPage.getByRole('button', { name: 'Aktionen öffnen' }).click();
    await adminPage.getByRole('menuitem', { name: 'Bearbeiten' }).click();
    const jobDialog = adminPage.getByRole('dialog').filter({
      has: adminPage.getByRole('heading', { name: 'Auftrag bearbeiten' }),
    });
    await selectFromSearchable(adminPage, jobDialog.locator('#edit-job-site'), inheritedSite);
    await selectFromSearchable(adminPage, jobDialog.locator('#edit-job-contact'), inheritedContact);
    await jobDialog.getByRole('button', { name: 'Speichern', exact: true }).click();
    await expect(jobDialog).toHaveCount(0, { timeout: 20_000 });
    const edited = await getProjectJobRelationState(world.orgId, projectNumber, jobNumbers);
    expect(edited.jobs[1].siteId).toBe(edited.siteId);
    expect(edited.jobs[1].contactId).toBe(edited.contactId);

    await openProject(adminPage, projectNumber);
    await adminPage.getByRole('button', { name: 'Aktionen öffnen' }).click();
    await adminPage.getByRole('menuitem', { name: 'Bearbeiten' }).click();
    const dialog = adminPage.getByRole('dialog');
    await dialog.locator('#edit-project-client').click();
    await adminPage.getByPlaceholder('Kunde suchen...').fill(targetCustomer);
    await adminPage
      .getByRole('listbox')
      .getByRole('button')
      .filter({ hasText: targetCustomer })
      .click();
    await expect(dialog.locator('#edit-project-client')).toContainText(targetCustomer);
    await dialog.getByRole('button', { name: 'Speichern', exact: true }).click();
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

  test('A2-07: Handwerker sieht Adresse, Zugangshinweis und anrufbaren Ansprechpartner', async ({
    adminPage,
    employeePage,
    world,
  }) => {
    const customer = `A2 Außendienstkunde ${world.runId}`;
    const contact = `A2 Vor-Ort-Kontakt ${world.runId}`;
    const site = `A2 Heizraum ${world.runId}`;
    const jobNumber = `A2-J-26-${world.runId}`;

    await createCustomer(adminPage, customer);
    await openCustomerDetail(adminPage, customer);
    await addContactOnCustomerDetail(adminPage, {
      name: contact,
      phone: '+49 30 260026',
    });
    await addSiteOnCustomerDetail(adminPage, {
      name: site,
      street: 'Feldstraße 26',
      postalCode: '10115',
      city: 'Berlin',
      accessNotes: 'Seitentor, Schlüsselcode 2600',
      primaryContactName: contact,
    });
    await createJob(adminPage, {
      jobNumber,
      title: `A2 Wartung vor Ort ${world.runId}`,
      clientName: customer,
      siteName: site,
      contactName: contact,
      assignEmployeeName: fullName(world.users.employee),
      plannedDateDigits: datePickerDigits(ownedBerlinDateAtOffset('a2-kunden', 26)),
    });

    const relationState = await getJobSiteContactState(world.orgId, jobNumber);
    expect(relationState.siteId).not.toBeNull();
    expect(relationState.contactId).not.toBeNull();

    await employeePage.goto(`/auftraege/${jobNumber}`);
    await expect(visibleText(employeePage, site)).toBeVisible();
    await expect(visibleText(employeePage, 'Feldstraße 26, 10115 Berlin')).toBeVisible();
    await expect(visibleText(employeePage, 'Zugang: Seitentor, Schlüsselcode 2600')).toBeVisible();
    await expect(visibleText(employeePage, contact)).toBeVisible();
    // P1-16's field view renders the call action as an „Anrufen" link named
    // after the contact instead of showing the raw number as link text; the
    // callable-contact promise is the tel: href.
    await expect(employeePage.getByRole('link', { name: `${contact} anrufen` })).toHaveAttribute(
      'href',
      'tel:+4930260026'
    );
  });

  test('A2-09: Unbekannte Anruferin wird bestehendem Kunden zugeordnet und bleibt nachvollziehbar', async ({
    bueroPage,
    world,
  }) => {
    const customer = `A2 Zielkunde ${world.runId}`;
    const requestNumber = `A2-ANF-${world.runId}-09`;
    const caller = `A2 Unbekannte Anruferin ${world.runId}`;
    const phone = '+49 30 290009';
    const email = `anruf-${world.runId}@example.test`;
    const address = 'Anrufstraße 9, 10115 Berlin';

    await createCustomer(bueroPage, customer);
    await createRequestViaDialog(bueroPage, {
      summary: `A2 Bestehender Kunde zuordnen ${world.runId}`,
      requestNumber,
      callerName: caller,
      callerPhone: phone,
      callerEmail: email,
      callerAddress: address,
    });
    await matchRequestToExistingCustomer(bueroPage, customer);
    await bueroPage.reload();
    await expect(visibleText(bueroPage, customer)).toBeVisible();
    await expect(visibleText(bueroPage, 'Erfasste Anruferdaten')).toBeVisible();
    await expect(visibleText(bueroPage, caller)).toBeVisible();
    await expect(visibleText(bueroPage, phone)).toBeVisible();
    await expect(visibleText(bueroPage, email)).toBeVisible();
    await expect(visibleText(bueroPage, address)).toBeVisible();

    const state = await getRequestAuditState(world.orgId, requestNumber);
    expect(state.clientId).not.toBeNull();
    expect(state.callerName).toBe(caller);
    expect(state.callerPhone).toBe(phone);
    expect(state.callerEmail).toBe(email);
    expect(state.callerAddress).toBe(address);

    const promotedCaller = `A2 Neukundin ${world.runId}`;
    const promotedEmail = `neukundin-${world.runId}@example.test`;
    const promotedAddress = 'Neukundenweg 29, 10117 Berlin';
    await createRequestViaDialog(bueroPage, {
      summary: `A2 Anruferin wird Kundin ${world.runId}`,
      requestNumber: `A2-ANF-${world.runId}-09B`,
      callerName: promotedCaller,
      callerPhone: '+49 30 290010',
      callerEmail: promotedEmail,
      callerAddress: promotedAddress,
    });
    await bueroPage.getByRole('button', { name: 'Als neuen Kunden anlegen' }).click();
    await expect(
      visibleText(bueroPage, 'Kunde wurde angelegt und der Anfrage zugeordnet.')
    ).toBeVisible({ timeout: 15_000 });
    await bueroPage.getByRole('link', { name: promotedCaller, exact: true }).click();
    await expect(visibleText(bueroPage, promotedCaller)).toBeVisible();
    await expect(visibleText(bueroPage, '+49 30 290010')).toBeVisible();
    await expect(visibleText(bueroPage, promotedEmail)).toBeVisible();
    await expect(visibleText(bueroPage, promotedAddress)).toBeVisible();
  });

  test('A2-10/A2-11: Eigene Anfragenummer überlebt späten Vorschlag; Klärung und Wiederöffnung bleiben bestehen', async ({
    bueroPage,
    world,
  }) => {
    const requestNumber = `A2-ANF-${world.runId}-10`;
    const summary = `A2 Später Nummernvorschlag ${world.runId}`;
    let releaseSuggestion!: () => void;
    let markIntercepted!: () => void;
    const suggestionGate = new Promise<void>((resolve) => {
      releaseSuggestion = resolve;
    });
    const intercepted = new Promise<void>((resolve) => {
      markIntercepted = resolve;
    });
    let held = false;
    await bueroPage.route('**/anfragen', async (route) => {
      const request = route.request();
      if (!held && request.method() === 'POST' && Boolean(request.headers()['next-action'])) {
        held = true;
        markIntercepted();
        await suggestionGate;
      }
      await route.continue();
    });

    await bueroPage.goto('/anfragen');
    try {
      await bueroPage.getByRole('button', { name: 'Anfrage erfassen' }).click();
      try {
        await waitForRouteIntercept(intercepted);
      } catch {
        throw new Error(
          'The request-number suggestion server action was not intercepted within 15 seconds.'
        );
      }
      const dialog = bueroPage.getByRole('dialog');
      await dialog.locator('#request-summary').fill(summary);
      await dialog.locator('#request-number').fill(requestNumber);
      const suggestionResponse = bueroPage.waitForResponse(
        (response) =>
          response.request().method() === 'POST' &&
          new URL(response.url()).pathname === '/anfragen' &&
          Boolean(response.request().headers()['next-action']),
        { timeout: 15_000 }
      );
      releaseSuggestion();
      await suggestionResponse;
      await expect(dialog.locator('#request-number')).toHaveValue(requestNumber, {
        timeout: 15_000,
      });
      await bueroPage.getByRole('dialog').getByRole('button', { name: 'Anfrage erfassen' }).click();
      await bueroPage.waitForURL(/\/anfragen\/[0-9a-f-]{36}/, {
        timeout: 20_000,
      });
    } finally {
      releaseSuggestion();
      await bueroPage.unroute('**/anfragen');
    }
    expect((await getRequestAuditState(world.orgId, requestNumber)).status).toBe('offen');

    await setRequestStatusFromDetail(bueroPage, 'In Klärung setzen');
    expect((await getRequestAuditState(world.orgId, requestNumber)).status).toBe('in_klaerung');
    await closeRequestViaDialog(bueroPage, 'Kein Bedarf mehr');
    expect((await getRequestAuditState(world.orgId, requestNumber)).status).toBe('geschlossen');
    await setRequestStatusFromDetail(bueroPage, 'Wieder öffnen');
    expect((await getRequestAuditState(world.orgId, requestNumber)).status).toBe('offen');
  });

  test('A2-13: Anfrage wird genau einmal in ein Projekt umgewandelt und beidseitig verlinkt', async ({
    adminPage,
    world,
  }) => {
    const customer = `A2 Projektanfrage Kunde ${world.runId}`;
    const requestNumber = `A2-ANF-${world.runId}-13`;
    const projectNumber = `A2-RP-${world.runId}`;

    await createCustomer(adminPage, customer);
    await createRequestViaDialog(adminPage, {
      summary: `A2 Projekt aus Anfrage ${world.runId}`,
      requestNumber,
      clientName: customer,
    });
    await convertRequestToProjectViaDialog(adminPage, projectNumber);
    const requestLink = adminPage.getByRole('link', {
      name: new RegExp(projectNumber),
    });
    await expect(requestLink).toBeVisible();
    await expect(adminPage.getByRole('button', { name: 'Umwandeln' })).toHaveCount(0);
    await requestLink.click();
    await expect(adminPage.getByRole('link', { name: `Anfrage ${requestNumber}` })).toBeVisible();

    const state = await getRequestConversionState(world.orgId, requestNumber);
    expect(state.status).toBe('umgewandelt');
    expect(state.convertedProjectId).not.toBeNull();
    expect(state.convertedJobId).toBeNull();
  });

  test('A2-15/A2-17: Chronik bleibt absteigend; verwaiste Nachfassaktion wird von beiden Managern neu zugewiesen', async ({
    adminPage,
    bueroPage,
    browser,
    world,
  }) => {
    const inviteeName = fullName(world.invitee);
    const customer = `A2 Beziehungskunde ${world.runId}`;
    const title = `A2 Neuzuweisung ${world.runId}`;

    await inviteMember(adminPage, world.invitee.email, 'Büro');
    const inviteCode = await getPendingInviteCode(world.orgId, world.invitee.email);
    const inviteeContext = await browser.newContext();
    await joinOrganizationViaInviteLink(
      await inviteeContext.newPage(),
      inviteCode,
      world.invitee,
      world.orgId
    );
    await inviteeContext.close();

    await createCustomer(adminPage, customer);
    await openCustomerDetail(adminPage, customer);
    await createFollowUpOnCustomerDetail(adminPage, {
      title,
      dueAtLocal: `${berlinDateAtOffset(27)}T06:00`,
      ownerName: inviteeName,
      note: 'Nach Eigentümerwechsel neu zuweisen',
    });
    await removeMemberFromDetail(adminPage, inviteeName);

    const taskLabel = `Nachfassaktion ${title} für ${customer} öffnen`;
    await openAufgaben(adminPage);
    await expect(attentionTaskLink(adminPage, taskLabel)).toHaveCount(1, {
      timeout: 15_000,
    });
    await openAufgaben(bueroPage);
    await expect(attentionTaskLink(bueroPage, taskLabel)).toHaveCount(1, {
      timeout: 15_000,
    });

    await openCustomerDetail(adminPage, customer);
    const followUpRow = adminPage
      .getByRole('button', { name: `Nachfassaktion ${title} bearbeiten` })
      .locator('xpath=ancestor::*[@data-follow-up-id]');
    await expect(followUpRow).toContainText('Neu zuweisen');
    await followUpRow.getByRole('button', { name: `Nachfassaktion ${title} bearbeiten` }).click();
    const dialog = adminPage.getByRole('dialog');
    await selectFromSearchable(
      adminPage,
      dialog.locator('#follow-up-owner'),
      fullName(world.users.buero)
    );
    await dialog.getByRole('button', { name: 'Speichern', exact: true }).click();
    await expect(dialog).toHaveCount(0, { timeout: 15_000 });

    await openAufgaben(adminPage);
    await expect(attentionTaskLink(adminPage, taskLabel)).toHaveCount(0, {
      timeout: 15_000,
    });
    await openAufgaben(bueroPage);
    await expect(attentionTaskLink(bueroPage, taskLabel)).toHaveCount(1, {
      timeout: 15_000,
    });
    await openCustomerDetail(bueroPage, customer);
    await completeFollowUpOnCustomerDetail(bueroPage, title);

    const rawTimes = await bueroPage
      .getByTestId('customer-timeline')
      .locator('time')
      .evaluateAll((elements) => elements.map((element) => element.getAttribute('datetime')));
    expect(rawTimes.length).toBeGreaterThan(2);
    expect(rawTimes.every((value) => value !== null)).toBe(true);
    const times = rawTimes as string[];
    expect(times).toEqual([...times].sort((left, right) => Date.parse(right) - Date.parse(left)));

    const relationship = await getCustomerRelationshipState(world.orgId, customer);
    expect(relationship.followUps.find((followUp) => followUp.title === title)).toMatchObject({
      status: 'completed',
      ownerUserId: world.users.buero.id,
      completedBy: world.users.buero.id,
    });
    expect(relationship.followUpEventTypes).toEqual(['created', 'reassigned', 'completed']);
    const personnel = await getEmployeeRecordStateByUser(world.orgId, world.invitee.id);
    expect(personnel.membershipJoinedAt).toBeNull();
    expect(personnel.exitDate).not.toBeNull();
  });

  test('A2-R01: Anfrage erfasst alle optionalen Fakten und die vollständige Auswahl', async ({
    bueroPage,
    world,
  }) => {
    const customer = `A2 Kundenstamm ${world.runId}`;
    const requestNumber = `A2-ANF-${world.runId}-R01`;
    const summary = `A2 Vollständige Anfrage ${world.runId}`;
    const details = 'Heizkreis prüfen und Rückruf vorbereiten';
    const receivedAtLocal = `${berlinDateAtOffset(0)}T06:00`;
    const assignee = fullName(world.users.buero);

    await bueroPage.goto('/kunden');
    await requireVisiblePrecondition(visibleText(bueroPage, customer), {
      test: 'A2-R01',
      needs: 'the customer and relations created by A2-01',
      grep: 'A2-01|A2-R01',
      suite: 'audit',
    });
    await visibleText(bueroPage, customer).click();
    await requireVisiblePrecondition(visibleText(bueroPage, `A2 Nebenstelle ${world.runId}`), {
      test: 'A2-R01',
      needs: 'the customer and relations created by A2-01',
      grep: 'A2-01|A2-R01',
      suite: 'audit',
    });
    await requireVisiblePrecondition(visibleText(bueroPage, `A2 Hauptkontakt ${world.runId}`), {
      test: 'A2-R01',
      needs: 'the customer and relations created by A2-01',
      grep: 'A2-01|A2-R01',
      suite: 'audit',
    });

    await bueroPage.goto('/anfragen');
    await bueroPage.getByRole('button', { name: 'Anfrage erfassen' }).click();
    const dialog = bueroPage.getByRole('dialog');
    await expect(dialog.locator('#request-received-at-date')).toBeVisible();
    await expectSelectOptions(bueroPage, dialog.locator('#request-category'), [
      'Notfall',
      'Störung / Reparatur',
      'Wartung',
      'Angebotsanfrage',
      'Installation / Umbau',
      'Garantie / Mangel',
      'Allgemeine Frage',
      'Sonstiges',
    ]);
    await expectSelectOptions(bueroPage, dialog.locator('#request-urgency'), [
      'Niedrig',
      'Normal',
      'Hoch',
      'Notfall',
    ]);
    await expectSelectOptions(bueroPage, dialog.locator('#request-source'), [
      'Telefon',
      'E-Mail',
      'Vor Ort',
      'Sonstiges',
    ]);
    await dialog.locator('#request-assignee').click();
    const assigneeListbox = bueroPage.getByRole('listbox');
    await expect(assigneeListbox).toBeVisible();
    await expect(
      assigneeListbox.getByRole('button').filter({ hasText: 'Niemand zuständig' })
    ).toBeVisible();
    await expect(assigneeListbox.getByRole('button').filter({ hasText: assignee })).toBeVisible();
    await assigneeListbox.getByRole('button').filter({ hasText: 'Niemand zuständig' }).click();
    await bueroPage.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);

    await createRequestViaDialog(bueroPage, {
      summary,
      details,
      requestNumber,
      clientName: customer,
      siteName: `A2 Nebenstelle ${world.runId}`,
      contactName: `A2 Hauptkontakt ${world.runId}`,
      categoryLabel: 'Installation / Umbau',
      urgencyLabel: 'Notfall',
      sourceLabel: 'E-Mail',
      receivedAtLocal,
      assigneeName: assignee,
    });
    await expect(visibleText(bueroPage, details)).toBeVisible();
    await expect(visibleText(bueroPage, 'Installation / Umbau')).toBeVisible();
    await expect(visibleText(bueroPage, 'E-Mail')).toBeVisible();
    await expect(visibleText(bueroPage, assignee)).toBeVisible();
    await expect(visibleText(bueroPage, `A2 Nebenstelle ${world.runId}`)).toBeVisible();
    await expect(visibleText(bueroPage, `A2 Hauptkontakt ${world.runId}`)).toBeVisible();
    await expect(visibleText(bueroPage, 'Anfrage erfasst')).toBeVisible();

    const state = await getRequestAuditState(world.orgId, requestNumber);
    expect(state).toMatchObject({
      status: 'offen',
      details,
      category: 'installation_umbau',
      urgency: 'notfall',
      source: 'email',
      assignedTo: world.users.buero.id,
      eventTypes: ['created'],
      eventActorIds: [world.users.buero.id],
    });
    expect(state.clientId).not.toBeNull();
    expect(state.siteId).not.toBeNull();
    expect(state.contactId).not.toBeNull();
    expect(new Date(state.receivedAt).toISOString()).toBe(`${berlinDateAtOffset(0)}T04:00:00.000Z`);
  });

  test('A2-R02: Anfrage-Anhang öffnet im Viewer und landet im Papierkorb', async ({
    adminPage,
    world,
  }) => {
    const requestNumber = `A2-ANF-${world.runId}-R02`;
    await createRequestViaDialog(adminPage, {
      summary: `A2 Dokumentierte Anfrage ${world.runId}`,
      requestNumber,
    });
    await uploadDocumentOnRequestDetail(
      adminPage,
      resolve(ARTIFACTS_DIR, 'upload-fixture.pdf'),
      'upload-fixture'
    );
    const fileButton = adminPage.getByRole('button', {
      name: /upload-fixture/,
    });
    await fileButton.click();
    const viewer = adminPage.getByRole('dialog');
    await expect(viewer.getByRole('heading', { name: /upload-fixture/ })).toBeVisible({
      timeout: 20_000,
    });
    await expect(viewer.locator('iframe[title*="upload-fixture"]')).toBeVisible({
      timeout: 20_000,
    });
    await adminPage.keyboard.press('Escape');
    await expect(viewer).toHaveCount(0);

    const fileRow = fileButton.locator('..');
    await fileRow.getByRole('button', { name: 'Dateiaktionen öffnen' }).click();
    await adminPage.getByRole('menuitem', { name: 'In Papierkorb verschieben' }).click();
    await adminPage
      .getByRole('alertdialog')
      .getByRole('button', { name: 'In Papierkorb verschieben' })
      .click();
    await expect(visibleText(adminPage, 'Datei wurde in den Papierkorb verschoben.')).toBeVisible({
      timeout: 20_000,
    });
    await expect(adminPage.getByRole('button', { name: /upload-fixture/ })).toHaveCount(0);
    await adminPage.goto('/dokumente');
    await adminPage.getByRole('button', { name: 'Papierkorb' }).click();
    await expect(visibleText(adminPage, 'upload-fixture')).toBeVisible({
      timeout: 20_000,
    });
  });

  test('A2-R03: Abschlussgründe sind verpflichtend; umgewandelte Anfragen sind schreibgeschützt', async ({
    bueroPage,
    world,
  }) => {
    const requestNumber = `A2-ANF-${world.runId}-R03`;
    const convertedNumber = `A2-ANF-${world.runId}-13`;

    await bueroPage.goto('/anfragen');
    await bueroPage.getByRole('tab', { name: 'Umgewandelt' }).click();
    await requireVisiblePrecondition(visibleText(bueroPage, convertedNumber), {
      test: 'A2-R03',
      needs: 'the converted project request created by A2-13',
      grep: 'A2-13|A2-R03',
      suite: 'audit',
    });

    await createRequestViaDialog(bueroPage, {
      summary: `A2 Abschluss prüfen ${world.runId}`,
      requestNumber,
    });
    await bueroPage.getByRole('button', { name: 'Schließen', exact: true }).click();
    const closeDialog = bueroPage.getByRole('dialog');
    await expect(closeDialog.getByText('Grund *', { exact: true })).toBeVisible();
    await expectSelectOptions(bueroPage, closeDialog.locator('#close-reason'), [
      'Kein Bedarf mehr',
      'Abgelehnt',
      'Duplikat',
      'Anderweitig gelöst',
      'Sonstiges',
    ]);
    await expect(closeDialog.locator('#close-reason')).not.toHaveText('');
    await closeDialog.locator('#close-reason').click();
    await bueroPage.getByRole('option', { name: 'Duplikat', exact: true }).click();
    await closeDialog.getByRole('button', { name: 'Anfrage schließen' }).click();
    await expect(closeDialog).toHaveCount(0, { timeout: 15_000 });
    await bueroPage.reload();
    await expect(visibleText(bueroPage, 'Ohne Auftrag geschlossen:')).toBeVisible();
    await expect(visibleText(bueroPage, 'Duplikat')).toBeVisible();
    await setRequestStatusFromDetail(bueroPage, 'Wieder öffnen');

    await bueroPage.goto('/anfragen');
    await bueroPage.getByRole('tab', { name: 'Umgewandelt' }).click();
    await visibleText(bueroPage, convertedNumber).click();
    await expect(bueroPage.getByRole('button', { name: 'Umwandeln' })).toHaveCount(0);
    await expect(bueroPage.getByRole('button', { name: 'Bearbeiten' })).toHaveCount(0);
    await expect(bueroPage.getByRole('button', { name: 'Schließen' })).toHaveCount(0);
    await expect(contextualDocumentFileInput(bueroPage)).toHaveCount(0);
  });

  test('A2-R04: Auftragsumwandlung ist vollständig vorbefüllt, editierbar, ungeplant und versandfrei', async ({
    adminPage,
    world,
  }) => {
    const customer = `A2 Kundenstamm ${world.runId}`;
    const contact = `A2 Hauptkontakt ${world.runId}`;
    const site = `A2 Nebenstelle ${world.runId}`;
    const requestNumber = `A2-ANF-${world.runId}-R04`;
    const summary = `A2 Umwandlung komplett ${world.runId}`;
    const details = 'Ursprüngliche Anfragebeschreibung';
    const editedTitle = `A2 Editierter Auftrag ${world.runId}`;
    const editedDescription = 'Im Umwandlungsdialog bewusst ergänzt';

    await adminPage.goto('/kunden');
    await requireVisiblePrecondition(visibleText(adminPage, customer), {
      test: 'A2-R04',
      needs: 'the customer and relations created by A2-01',
      grep: 'A2-01|A2-R04',
      suite: 'audit',
    });
    await visibleText(adminPage, customer).click();
    await requireVisiblePrecondition(visibleText(adminPage, contact), {
      test: 'A2-R04',
      needs: 'the customer and relations created by A2-01',
      grep: 'A2-01|A2-R04',
      suite: 'audit',
    });
    await requireVisiblePrecondition(visibleText(adminPage, site), {
      test: 'A2-R04',
      needs: 'the customer and relations created by A2-01',
      grep: 'A2-01|A2-R04',
      suite: 'audit',
    });

    await createRequestViaDialog(adminPage, {
      summary,
      details,
      requestNumber,
      clientName: customer,
      siteName: site,
      contactName: contact,
      urgencyLabel: 'Notfall',
    });
    await adminPage.getByRole('button', { name: 'Umwandeln' }).click();
    const dialog = adminPage.getByRole('dialog');
    await expect(dialog.locator('#convert-title')).toHaveValue(summary);
    await expect(dialog.locator('#convert-description')).toHaveValue(details);
    await expect(dialog.getByRole('combobox').filter({ hasText: customer })).toBeVisible();
    await expect(dialog.locator('#convert-site')).toContainText(site);
    await expect(dialog.locator('#convert-contact')).toContainText(contact);
    await expect(dialog.locator('#convert-priority')).toContainText('Hoch');
    await expect(dialog.locator('#convert-date')).toContainText('Datum wählen');
    await expect(dialog.getByText('Es wird nichts automatisch terminiert.')).toBeVisible();
    await dialog.locator('#convert-title').fill(editedTitle);
    await dialog.locator('#convert-description').fill(editedDescription);
    await expect(dialog.locator('#convert-number')).toHaveValue(/.+/, {
      timeout: 15_000,
    });
    await dialog.getByRole('button', { name: 'In Auftrag umwandeln' }).click();
    await expect(dialog).toHaveCount(0, { timeout: 20_000 });
    const requestLink = adminPage.getByRole('link', { name: /Auftrag AUF-/ });
    await expect(requestLink).toBeVisible({ timeout: 15_000 });
    await requestLink.click();
    await expect(visibleText(adminPage, editedTitle)).toBeVisible();
    await expect(visibleText(adminPage, editedDescription)).toBeVisible();
    // Since P1-12/P1-14 a conversion no longer creates a passive parked state
    // (catalog P1-02-F05, BASE-WORK-F03): a date-less converted job is honest
    // unplanned open work, and parking stays a separate reasoned act.
    await expect(visibleText(adminPage, 'Nicht geplant')).toBeVisible();
    await expect(adminPage.getByRole('link', { name: `Anfrage ${requestNumber}` })).toBeVisible();

    const state = await getConvertedRequestJobState(world.orgId, requestNumber);
    expect(state).toMatchObject({
      title: editedTitle,
      description: editedDescription,
      priority: 'hoch',
      status: 'nicht_bearbeitet',
      plannedDate: null,
      planningCount: 0,
      dispatchCount: 0,
    });
    expect(state.clientId).not.toBeNull();
    expect(state.siteId).not.toBeNull();
    expect(state.contactId).not.toBeNull();
  });

  test('A2-R05: Chronik und Nachfassaktionen belegen alle Quellen, Filter und Attribution', async ({
    adminPage,
    world,
  }) => {
    const customer = `A2 Chronikkunde ${world.runId}`;
    const contact = `A2 Chronikkontakt ${world.runId}`;
    const site = `A2 Chronikstandort ${world.runId}`;
    const jobNumber = `A2-CHR-J-${world.runId}`;
    const jobTitle = `A2 Chronikauftrag ${world.runId}`;
    const projectNumber = `A2-CHR-P-${world.runId}`;
    const projectTitle = `A2 Chronikprojekt ${world.runId}`;
    const requestNumber = `A2-CHR-A-${world.runId}`;
    const requestSummary = `A2 Chronikanfrage ${world.runId}`;
    const actor = fullName(world.users.admin);

    await createCustomer(adminPage, customer);
    await openCustomerDetail(adminPage, customer);
    await addContactOnCustomerDetail(adminPage, {
      name: contact,
      phone: '+49 30 660001',
      email: `chronik-${world.runId}@example.test`,
    });
    await addSiteOnCustomerDetail(adminPage, { name: site, city: 'Berlin' });
    await createJob(adminPage, {
      jobNumber,
      title: jobTitle,
      clientName: customer,
    });
    await uploadDocumentOnJobPage(
      adminPage,
      jobNumber,
      resolve(ARTIFACTS_DIR, 'upload-fixture.pdf'),
      'upload-fixture'
    );
    await createProject(adminPage, {
      projectNumber,
      title: projectTitle,
      clientName: customer,
    });
    await createRequestViaDialog(adminPage, {
      summary: requestSummary,
      requestNumber,
      clientName: customer,
    });
    await setRequestStatusFromDetail(adminPage, 'In Klärung setzen');
    await adminPage.getByRole('button', { name: 'Zurück auf Offen' }).click();
    await expect(adminPage.getByRole('button', { name: 'In Klärung setzen' })).toBeVisible({
      timeout: 15_000,
    });
    await openCustomerDetail(adminPage, customer);

    const timeline = adminPage.getByTestId('customer-timeline');
    for (const [label, reference] of [
      ['Anfrage eingegangen', requestSummary],
      ['Anfrage aktualisiert', requestNumber],
      ['Auftrag angelegt', jobTitle],
      ['Projekt angelegt', projectTitle],
      ['Dokument verknüpft', 'upload-fixture'],
    ]) {
      const row = newestCustomerTimelineRow(adminPage, label, reference);
      await expect(row).toContainText(actor);
      await expect(row.getByRole('link', { name: 'Quelle öffnen' })).toHaveCount(1);
    }
    const stableKeys = await timeline
      .locator('[data-timeline-key]')
      .evaluateAll((rows) => rows.map((row) => row.getAttribute('data-timeline-key')));
    expect(new Set(stableKeys).size).toBe(stableKeys.length);

    const dueAt = `${berlinDateAtOffset(2)}T10:00`;
    const sources = [
      ['contact', contact, contact],
      ['site', site, site],
      ['request', requestSummary, requestNumber],
      ['job', jobTitle, jobNumber],
      ['project', projectTitle, projectNumber],
    ] as const;
    for (const [sourceType, sourceText, sourceLabel] of sources) {
      await createTimelineFollowUp(
        adminPage,
        sourceText,
        sourceLabel,
        `A2 Quelle ${sourceType} ${world.runId}`,
        dueAt
      );
    }
    await adminPage
      .getByRole('button', {
        name: `Nachfassaktion A2 Quelle contact ${world.runId} erledigen`,
      })
      .click();
    await expect(visibleText(adminPage, 'Nachfassaktion erledigt.')).toBeVisible();
    await adminPage
      .getByRole('button', {
        name: `Nachfassaktion A2 Quelle site ${world.runId} abbrechen`,
      })
      .click();
    await expect(visibleText(adminPage, 'Nachfassaktion abgebrochen.')).toBeVisible();

    await adminPage.getByRole('button', { name: 'Arbeit', exact: true }).click();
    await expect(timeline.getByText(jobTitle)).toBeVisible();
    await expect(timeline.getByText(projectTitle)).toBeVisible();
    await expect(timeline.getByText(contact)).toHaveCount(0);
    await adminPage.getByRole('button', { name: 'Dokumente', exact: true }).click();
    await expect(timeline.getByText('upload-fixture')).toBeVisible();
    await expect(timeline.getByText(jobTitle)).toHaveCount(0);
    await adminPage.getByRole('button', { name: 'Intern', exact: true }).click();
    await expect(timeline.getByText(contact)).toBeVisible();
    await expect(timeline.getByText(site)).toBeVisible();
    await expect(newestCustomerTimelineRow(adminPage, 'Nachfassaktion geändert')).toBeVisible();

    const relationship = await getCustomerRelationshipState(world.orgId, customer);
    expect(
      relationship.followUps
        .filter((followUp) => followUp.title.startsWith('A2 Quelle'))
        .map((followUp) => followUp.sourceType)
        .sort()
    ).toEqual(['contact', 'job', 'project', 'request', 'site']);
    expect(
      relationship.followUps.find((followUp) => followUp.title.includes('contact'))
    ).toMatchObject({ status: 'completed', completedBy: world.users.admin.id });
    expect(
      relationship.followUps.find((followUp) => followUp.title.includes('site'))
    ).toMatchObject({ status: 'cancelled', cancelledBy: world.users.admin.id });
  });

  test('A2-R06: Kommunikationspräferenzen sind vollständig automatisiert und E-Mail-Ausnahmen nachvollziehbar', async ({
    adminPage,
    world,
  }) => {
    const customer = `A2 Chronikkunde ${world.runId}`;
    const contact = `A2 Chronikkontakt ${world.runId}`;
    const email = `chronik-${world.runId}@example.test`;

    await adminPage.goto('/kunden');
    await requireVisiblePrecondition(visibleText(adminPage, customer), {
      test: 'A2-R06',
      needs: 'the relationship customer and contact created by A2-R05',
      grep: 'A2-R05|A2-R06',
      suite: 'audit',
    });
    await visibleText(adminPage, customer).click();
    await requireVisiblePrecondition(visibleText(adminPage, contact), {
      test: 'A2-R06',
      needs: 'the relationship customer and contact created by A2-R05',
      grep: 'A2-R05|A2-R06',
      suite: 'audit',
    });

    await openCustomerDetail(adminPage, customer);
    await expect(visibleText(adminPage, 'Noch nicht konfiguriert')).toBeVisible();
    await configureCustomerCommunicationSettings(adminPage, {
      preferredContactName: contact,
      preferredChannel: 'E-Mail',
      doNotContactInstruction: 'Nur nach interner Freigabe kontaktieren.',
      contactTimeNote: 'Werktags 08:00–11:00 Uhr',
      languageNote: 'Deutsch',
      accessibilityNote: 'Bitte langsam und deutlich sprechen',
      sourceNote: 'A2 Kundengespräch',
    });
    const section = adminPage.getByRole('region', { name: 'Kontaktvorgaben' });
    await expect(section).toContainText('E-Mail');
    await expect(section).toContainText('Werktags 08:00–11:00 Uhr');
    await expect(section).toContainText('Deutsch');
    await expect(section).toContainText('Bitte langsam und deutlich sprechen');
    await expect(section).toContainText('Es werden keine Nachrichten versendet.');
    await expect(section).toContainText(
      'Diese Angaben sind betriebliche Kontaktvorgaben und keine Aussage zur rechtlichen Zulässigkeit.'
    );

    await adminPage.getByRole('button', { name: 'Präferenz', exact: true }).click();
    const dialog = adminPage.getByRole('dialog');
    await expectSelectOptions(adminPage, dialog.locator('#preference-channel'), [
      'Telefon',
      'E-Mail',
      'SMS',
      'Brief',
      'Persönlich',
    ]);
    await expectSelectOptions(adminPage, dialog.locator('#preference-purpose'), [
      'Termin und Service',
      'Marketing',
      'Erforderliche kaufmännische Kommunikation',
    ]);
    await expectSelectOptions(adminPage, dialog.locator('#preference-state'), [
      'Erlaubt',
      'Nicht erlaubt',
      'Unbekannt',
    ]);
    await dialog.getByRole('button', { name: 'Abbrechen' }).click();

    await setCustomerCommunicationPreference(adminPage, {
      channel: 'Telefon',
      state: 'Erlaubt',
      purpose: 'Termin und Service',
    });
    await setCustomerCommunicationPreference(adminPage, {
      contactName: contact,
      channel: 'E-Mail',
      state: 'Nicht erlaubt',
      purpose: 'Termin und Service',
      sourceNote: 'E-Mail unerwünscht',
    });
    await setCustomerCommunicationPreference(adminPage, {
      channel: 'SMS',
      state: 'Unbekannt',
      purpose: 'Marketing',
    });
    await setCustomerCommunicationPreference(adminPage, {
      channel: 'Brief',
      state: 'Erlaubt',
      purpose: 'Erforderliche kaufmännische Kommunikation',
    });
    await setCustomerCommunicationPreference(adminPage, {
      channel: 'Persönlich',
      state: 'Nicht erlaubt',
      purpose: 'Marketing',
    });
    await adminPage.getByRole('link', { name: email, exact: true }).click();
    const warning = adminPage.getByRole('dialog');
    await expect(warning.getByText(/Nicht-kontaktieren-Hinweis/)).toBeVisible();
    await expect(warning.getByText(/Kontaktweg.*nicht erlaubt/)).toBeVisible();
    await expect(
      warning.getByText(/WerkFlow entscheidet nicht über die rechtliche Zulässigkeit/)
    ).toBeVisible();
    await expect(warning.getByRole('button', { name: 'Begründet fortfahren' })).toBeDisabled();
    await warning
      .locator('#contact-exception-reason')
      .fill('E-Mail ist für die laufende Störungsbehebung erforderlich');
    await warning.getByRole('button', { name: 'Begründet fortfahren' }).click();
    await expect(warning).toHaveCount(0, { timeout: 15_000 });

    const relationship = await getCustomerRelationshipState(world.orgId, customer);
    expect(relationship.communicationSettings).toMatchObject({
      preferredChannel: 'email',
      doNotContactInstruction: 'Nur nach interner Freigabe kontaktieren.',
      contactTimeNote: 'Werktags 08:00–11:00 Uhr',
      languageNote: 'Deutsch',
      accessibilityNote: 'Bitte langsam und deutlich sprechen',
    });
    expect(
      relationship.communicationPreferences.map((preference) => [
        preference.channel,
        preference.purpose,
        preference.state,
      ])
    ).toEqual([
      ['phone', 'appointment_service', 'allowed'],
      ['email', 'appointment_service', 'disallowed'],
      ['sms', 'marketing', 'unknown'],
      ['letter', 'commercial_required', 'allowed'],
      ['in_person', 'marketing', 'disallowed'],
    ]);
    expect(relationship.preferenceEventTypes).toContain('exception_acknowledged');
    await adminPage.getByRole('button', { name: 'Intern', exact: true }).click();
    const preferenceTimelineRow = newestCustomerTimelineRow(adminPage, 'Kontaktvorgabe geändert');
    await expect(preferenceTimelineRow).toContainText(fullName(world.users.admin));
    await expect(preferenceTimelineRow.getByRole('link', { name: 'Quelle öffnen' })).toHaveCount(1);
  });

  test('A2-R07: Anfragenliste filtert und sucht alle Katalogidentitäten', async ({
    bueroPage,
    world,
  }) => {
    const convertedNumber = `A2-ANF-${world.runId}-R04`;
    const activeNumber = `A2-ANF-${world.runId}-R01`;
    const closedNumber = `A2-ANF-${world.runId}-R07-CLOSED`;

    await bueroPage.goto('/anfragen');
    await requireVisiblePrecondition(visibleText(bueroPage, activeNumber), {
      test: 'A2-R07',
      needs: 'the searchable requests created by A2-09, A2-R01, and A2-R04',
      grep: 'A2-09|A2-R01|A2-R04|A2-R07',
      suite: 'audit',
    });
    const preconditionSearch = bueroPage.getByLabel('Anfragen durchsuchen');
    await preconditionSearch.fill(`A2 Unbekannte Anruferin ${world.runId}`);
    await requireVisiblePrecondition(visibleText(bueroPage, `A2-ANF-${world.runId}-09`), {
      test: 'A2-R07',
      needs: 'the searchable requests created by A2-09, A2-R01, and A2-R04',
      grep: 'A2-09|A2-R01|A2-R04|A2-R07',
      suite: 'audit',
    });
    await preconditionSearch.fill('');
    await bueroPage.getByRole('tab', { name: 'Umgewandelt' }).click();
    await requireVisiblePrecondition(visibleText(bueroPage, convertedNumber), {
      test: 'A2-R07',
      needs: 'the searchable requests created by A2-09, A2-R01, and A2-R04',
      grep: 'A2-09|A2-R01|A2-R04|A2-R07',
      suite: 'audit',
    });

    await createRequestViaDialog(bueroPage, {
      summary: `A2 Dauerhaft geschlossen ${world.runId}`,
      requestNumber: closedNumber,
    });
    await closeRequestViaDialog(bueroPage, 'Sonstiges');

    await bueroPage.goto('/anfragen');
    await expect(visibleText(bueroPage, activeNumber)).toBeVisible();
    await expect(textInDom(bueroPage, convertedNumber)).toHaveCount(0);
    await bueroPage.getByRole('tab', { name: 'Umgewandelt' }).click();
    await expect(visibleText(bueroPage, convertedNumber)).toBeVisible();
    await bueroPage.getByRole('tab', { name: 'Geschlossen' }).click();
    await expect(visibleText(bueroPage, closedNumber)).toBeVisible();
    await bueroPage.getByRole('tab', { name: 'Alle' }).click();
    await expect(visibleText(bueroPage, activeNumber)).toBeVisible();
    await expect(visibleText(bueroPage, convertedNumber)).toBeVisible();
    await expect(visibleText(bueroPage, closedNumber)).toBeVisible();

    const search = bueroPage.getByLabel('Anfragen durchsuchen');
    for (const [query, expected] of [
      [`A2 Vollständige Anfrage ${world.runId}`, activeNumber],
      [`A2 Kundenstamm ${world.runId}`, activeNumber],
      [`A2 Unbekannte Anruferin ${world.runId}`, `A2-ANF-${world.runId}-09`],
      [activeNumber, activeNumber],
      [fullName(world.users.buero), activeNumber],
    ]) {
      await search.fill(query);
      await expect(visibleText(bueroPage, expected)).toBeVisible();
    }
  });
});

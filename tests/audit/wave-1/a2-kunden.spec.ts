import type { Page } from '@playwright/test';

import { expect, test } from '../../golden/support/fixtures';
import {
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
  setRequestStatusFromDetail,
  visibleText,
} from '../../golden/support/steps';

test.describe.configure({ mode: 'serial' });

function berlinDateAtOffset(offsetDays: number): string {
  const formatter = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Europe/Berlin',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const date = new Date(`${formatter.format(new Date())}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + offsetDays);
  return date.toISOString().slice(0, 10);
}

function datePickerDigits(offsetDays: number): string {
  const [year, month, day] = berlinDateAtOffset(offsetDays).split('-');
  return `${day}${month}${year}`;
}

function fullName(user: { firstName: string; lastName: string }): string {
  return `${user.firstName} ${user.lastName}`;
}

async function setCustomerNumber(page: Page, value: string): Promise<void> {
  const row = page.getByText('Kundennummer', { exact: true }).locator('..');
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
    await addContactOnCustomerDetail(adminPage, {
      name: firstContact,
      phone: '+49 30 250001',
    });
    await addContactOnCustomerDetail(adminPage, {
      name: primaryContact,
      phone: '+49 30 250002',
      isPrimary: true,
    });
    const firstContactRow = adminPage.locator('li').filter({ hasText: firstContact }).first();
    const primaryContactRow = adminPage.locator('li').filter({ hasText: primaryContact }).first();
    await expect(primaryContactRow).toContainText('Hauptkontakt');
    await expect(firstContactRow).not.toContainText('Hauptkontakt');

    await adoptCustomerAddressAsSite(adminPage);
    await expect(adminPage.locator('li').filter({ hasText: 'Hauptstandort' }).first())
      .toContainText(address);
    await addSiteOnCustomerDetail(adminPage, {
      name: secondarySite,
      street: 'Nebenstraße 29',
      postalCode: '10117',
      city: 'Berlin',
      accessNotes: 'Schlüssel im Büro',
      primaryContactName: primaryContact,
      isPrimary: true,
    });
    await expect(adminPage.locator('li').filter({ hasText: secondarySite }).first())
      .toContainText('Hauptstandort');
    await expect(
      adminPage.locator('li').filter({ hasText: address }).first()
        .getByText('Hauptstandort', { exact: true })
    ).toHaveCount(1);

    await archiveCustomerRelation(adminPage, 'Ansprechpartner', firstContact);
    await archiveCustomerRelation(adminPage, 'Einsatzort', 'Hauptstandort');

    await adminPage.goto('/auftraege');
    await adminPage.getByRole('button', { name: 'Erstellen', exact: true }).click();
    await adminPage.getByRole('tab', { name: 'Auftrag erstellen' }).click();
    await adminPage.getByRole('combobox').filter({ hasText: 'Kein Kunde' }).click();
    await adminPage.getByPlaceholder('Kunde suchen...').fill(customer);
    await adminPage.getByRole('listbox').getByRole('button').filter({ hasText: customer }).click();
    await adminPage.locator('#job-contact').click();
    await expect(adminPage.getByRole('option', { name: firstContact, exact: true })).toHaveCount(0);
    await adminPage.keyboard.press('Escape');
    await adminPage.locator('#job-site').click();
    await expect(adminPage.getByRole('option').filter({ hasText: 'A2 Hauptstraße 25' })).toHaveCount(0);
    await adminPage.keyboard.press('Escape');
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
    await expect(visibleText(adminPage, customerNumber)).toBeVisible({ timeout: 15_000 });
    expect(await getCustomerNumber(world.orgId, firstCustomer)).toBe(customerNumber);

    await createCustomer(adminPage, secondCustomer);
    await openCustomerDetail(adminPage, secondCustomer);
    await setCustomerNumber(adminPage, customerNumber);
    await expect(
      adminPage.getByText('Diese Kundennummer ist bereits vergeben.', { exact: true })
    ).toBeVisible({ timeout: 15_000 });
    await adminPage.reload();
    expect(await getCustomerNumber(world.orgId, secondCustomer)).toBeNull();
    const numberRow = adminPage.getByText('Kundennummer', { exact: true }).locator('..');
    await expect(numberRow).toContainText('—');
  });

  // This serial journey intentionally reuses the customer relations created in
  // A2-01; the complete A2 spec remains the standalone execution boundary.
  test('A2-06: Projektvorgaben vererben sich, Auftrag darf abweichen und Kundenwechsel erhält Kinder', async ({
    adminPage,
    world,
  }) => {
    test.setTimeout(420_000);
    const sourceCustomer = `A2 Kundenstamm ${world.runId}`;
    const targetCustomer = `A2 Projektkunde Neu ${world.runId}`;
    const inheritedContact = `A2 Hauptkontakt ${world.runId}`;
    const overrideContact = `A2 Erstkontakt ${world.runId}`;
    const inheritedSite = `A2 Nebenstelle ${world.runId}`;
    const overrideSite = 'Hauptstandort';
    const projectNumber = `A2-P-${world.runId}`;

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
      plannedDateDigits: datePickerDigits(25),
    });
    await createJob(adminPage, {
      jobNumber: `${projectNumber}-2`,
      title: `A2 abweichender Auftrag ${world.runId}`,
      clientName: sourceCustomer,
      projectNumber,
      siteName: overrideSite,
      contactName: overrideContact,
      plannedDateDigits: datePickerDigits(25),
    });

    const jobNumbers = [`${projectNumber}-1`, `${projectNumber}-2`];
    const before = await getProjectJobRelationState(world.orgId, projectNumber, jobNumbers);
    expect(before.jobs).toHaveLength(2);
    expect(before.jobs.every((job) => job.projectId === before.projectId)).toBe(true);
    expect(before.jobs[0].siteId).toBe(before.siteId);
    expect(before.jobs[0].contactId).toBe(before.contactId);
    expect(before.jobs[1].siteId).not.toBe(before.siteId);
    expect(before.jobs[1].contactId).not.toBe(before.contactId);

    await openProject(adminPage, projectNumber);
    await adminPage.getByRole('button', { name: 'Aktionen öffnen' }).click();
    await adminPage.getByRole('menuitem', { name: 'Bearbeiten' }).click();
    const dialog = adminPage.getByRole('dialog');
    await dialog.getByRole('combobox').first().click();
    await adminPage.getByPlaceholder('Kunde suchen...').fill(targetCustomer);
    await adminPage.getByRole('listbox').getByRole('button').filter({ hasText: targetCustomer }).click();
    await expect(dialog.getByRole('combobox').first()).toContainText(targetCustomer);
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
    await addContactOnCustomerDetail(adminPage, { name: contact, phone: '+49 30 260026' });
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
      plannedDateDigits: datePickerDigits(26),
    });

    const relationState = await getJobSiteContactState(world.orgId, jobNumber);
    expect(relationState.siteId).not.toBeNull();
    expect(relationState.contactId).not.toBeNull();

    await employeePage.goto(`/auftraege/${jobNumber}`);
    await expect(visibleText(employeePage, site)).toBeVisible();
    await expect(visibleText(employeePage, 'Feldstraße 26, 10115 Berlin')).toBeVisible();
    await expect(visibleText(employeePage, 'Zugang: Seitentor, Schlüsselcode 2600')).toBeVisible();
    await expect(visibleText(employeePage, contact)).toBeVisible();
    await expect(employeePage.getByRole('link', { name: '+49 30 260026' }))
      .toHaveAttribute('href', 'tel:+4930260026');
  });

  test('A2-09: Unbekannte Anruferin wird bestehendem Kunden zugeordnet und bleibt nachvollziehbar', async ({
    bueroPage,
    world,
  }) => {
    const customer = `A2 Zielkunde ${world.runId}`;
    const requestNumber = `A2-ANF-${world.runId}-09`;
    const caller = `A2 Unbekannte Anruferin ${world.runId}`;
    const phone = '+49 30 290009';

    await createCustomer(bueroPage, customer);
    await createRequestViaDialog(bueroPage, {
      summary: `A2 Bestehender Kunde zuordnen ${world.runId}`,
      requestNumber,
      callerName: caller,
      callerPhone: phone,
    });
    await matchRequestToExistingCustomer(bueroPage, customer);
    await bueroPage.reload();
    await expect(visibleText(bueroPage, customer)).toBeVisible();
    await expect(visibleText(bueroPage, 'Erfasste Anruferdaten')).toBeVisible();
    await expect(visibleText(bueroPage, caller)).toBeVisible();
    await expect(visibleText(bueroPage, phone)).toBeVisible();

    const state = await getRequestAuditState(world.orgId, requestNumber);
    expect(state.clientId).not.toBeNull();
    expect(state.callerName).toBe(caller);
    expect(state.callerPhone).toBe(phone);
  });

  test('A2-10/A2-11: Eigene Anfragenummer überlebt späten Vorschlag; Klärung und Wiederöffnung bleiben bestehen', async ({
    bueroPage,
    world,
  }) => {
    test.setTimeout(300_000);
    const requestNumber = `A2-ANF-${world.runId}-10`;
    const summary = `A2 Später Nummernvorschlag ${world.runId}`;
    let releaseSuggestion!: () => void;
    let markIntercepted!: () => void;
    const suggestionGate = new Promise<void>((resolve) => { releaseSuggestion = resolve; });
    const intercepted = new Promise<void>((resolve) => { markIntercepted = resolve; });
    let held = false;
    await bueroPage.route('**/anfragen', async (route) => {
      const request = route.request();
      if (
        !held &&
        request.method() === 'POST' &&
        Boolean(request.headers()['next-action'])
      ) {
        held = true;
        markIntercepted();
        await suggestionGate;
      }
      await route.continue();
    });

    await bueroPage.goto('/anfragen');
    try {
      const suggestionRequest = bueroPage.waitForRequest(
        (request) =>
          request.method() === 'POST' &&
          new URL(request.url()).pathname === '/anfragen' &&
          Boolean(request.headers()['next-action']),
        { timeout: 15_000 }
      );
      await bueroPage.getByRole('button', { name: 'Anfrage erfassen' }).click();
      try {
        await suggestionRequest;
        await intercepted;
      } catch {
        throw new Error('The request-number suggestion server action was not intercepted within 15 seconds.');
      }
      await bueroPage.locator('#request-summary').fill(summary);
      await bueroPage.locator('#request-number').fill(requestNumber);
      releaseSuggestion();
      await expect(bueroPage.locator('#request-number')).toHaveValue(requestNumber, {
        timeout: 15_000,
      });
      await bueroPage.getByRole('dialog').getByRole('button', { name: 'Anfrage erfassen' }).click();
      await bueroPage.waitForURL(/\/anfragen\/[0-9a-f-]{36}/, { timeout: 20_000 });
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
    const requestLink = adminPage.getByRole('link', { name: new RegExp(projectNumber) });
    await expect(requestLink).toBeVisible();
    await expect(adminPage.getByRole('button', { name: 'Umwandeln' })).toHaveCount(0);
    await requestLink.click();
    await expect(adminPage.getByRole('link', { name: `Anfrage ${requestNumber}` }))
      .toBeVisible();

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
    await expect(attentionTaskLink(adminPage, taskLabel)).toHaveCount(1, { timeout: 15_000 });
    await openAufgaben(bueroPage);
    await expect(attentionTaskLink(bueroPage, taskLabel)).toHaveCount(1, { timeout: 15_000 });

    await openCustomerDetail(adminPage, customer);
    const followUpRow = adminPage.locator('[data-follow-up-id]').filter({ hasText: title });
    await expect(followUpRow).toContainText('Neu zuweisen');
    await followUpRow.getByRole('button', { name: `Nachfassaktion ${title} bearbeiten` }).click();
    const dialog = adminPage.getByRole('dialog');
    await dialog.locator('#follow-up-owner').click();
    await adminPage.getByRole('option', { name: fullName(world.users.buero), exact: true }).click();
    await dialog.getByRole('button', { name: 'Speichern', exact: true }).click();
    await expect(dialog).toHaveCount(0, { timeout: 15_000 });

    await openAufgaben(adminPage);
    await expect(attentionTaskLink(adminPage, taskLabel)).toHaveCount(0, { timeout: 15_000 });
    await openAufgaben(bueroPage);
    await expect(attentionTaskLink(bueroPage, taskLabel)).toHaveCount(1, { timeout: 15_000 });
    await openCustomerDetail(bueroPage, customer);
    await completeFollowUpOnCustomerDetail(bueroPage, title);

    const rawTimes = await bueroPage.locator('[data-testid="customer-timeline"] time')
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
});

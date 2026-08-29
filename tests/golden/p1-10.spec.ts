import { resolve } from 'node:path';

import { expect, test } from './support/fixtures';
import { ARTIFACTS_DIR } from './support/world';
import { getCustomerRelationshipState, getVisibleCustomerRelationshipStateAs } from './support/db';
import {
  addContactOnCustomerDetail,
  addSiteOnCustomerDetail,
  attentionTaskLink,
  completeFollowUpOnCustomerDetail,
  configureCustomerCommunicationSettings,
  createCustomer,
  createFollowUpOnCustomerDetail,
  createJob,
  openAufgaben,
  openCustomerDetail,
  proceedThroughContactWarning,
  setCustomerCommunicationPreference,
  uploadDocumentOnJobPage,
  visibleText,
} from './support/steps';
import { formatBerlinDateTimeInput } from '../../lib/customer-relationships/date-time';
import { expectLiveWithin } from './support/live';

// P1-10 sorts last. It owns no effective-date keys and uses run-scoped names,
// so it can start on the fresh seed or inherit the complete P1-09 world.
test.describe.configure({ mode: 'serial' });

function customerName(runId: string): string {
  return `P1-10 Kundenpflege ${runId}`;
}

function followUpTitle(runId: string): string {
  return `Rückruf Heizungsangebot ${runId}`;
}

function berlinDateTime(daysFromToday: number, hour: number): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + daysFromToday);
  return `${formatBerlinDateTimeInput(date).slice(0, 11)}${String(hour).padStart(2, '0')}:00`;
}

test.describe('P1-10 customer relationships @P1-10', () => {
  test('source-linked history orders facts deterministically and filters without copies', async ({
    adminPage,
    world,
  }) => {
    const customer = customerName(world.runId);
    await createCustomer(adminPage, customer);
    await openCustomerDetail(adminPage, customer);
    await expect(
      adminPage
        .getByRole('region', { name: 'Kontaktvorgaben' })
        .getByText('Noch nicht konfiguriert', { exact: true })
    ).toBeVisible();
    await addContactOnCustomerDetail(adminPage, {
      name: `Anna Ansprechpartnerin ${world.runId}`,
      phone: '+49 30 555001',
      email: `anna-${world.runId}@example.test`,
    });
    await addContactOnCustomerDetail(adminPage, {
      name: `Berta Ansprechpartnerin ${world.runId}`,
      phone: '+49 30 555002',
      email: `berta-${world.runId}@example.test`,
    });
    await addSiteOnCustomerDetail(adminPage, {
      name: `Heizraum ${world.runId}`,
      city: 'Berlin',
    });
    const jobTitle = `P1-10 Wartungsauftrag ${world.runId}`;
    await createJob(adminPage, {
      jobNumber: `AUF-${world.runId}-P110-1`,
      title: jobTitle,
      clientName: customer,
    });
    await uploadDocumentOnJobPage(
      adminPage,
      `AUF-${world.runId}-P110-1`,
      resolve(ARTIFACTS_DIR, 'upload-fixture.pdf'),
      'upload-fixture'
    );
    await openCustomerDetail(adminPage, customer);

    const timeline = adminPage.getByTestId('customer-timeline');
    await expect(timeline.getByText('Kunde angelegt')).toBeVisible();
    await expect(
      timeline.getByText('Ansprechpartner angelegt').filter({ visible: true })
    ).not.toHaveCount(0);
    await expect(timeline.getByText('Einsatzort angelegt')).toBeVisible();
    await expect(timeline.getByText(jobTitle)).toBeVisible();
    const keys = await timeline
      .locator('[data-timeline-key]')
      .evaluateAll((rows) => rows.map((row) => row.getAttribute('data-timeline-key')));
    expect(new Set(keys).size).toBe(keys.length);
    const sourceLinks = timeline.getByRole('link', { name: 'Quelle öffnen' });
    await expect(sourceLinks).not.toHaveCount(0);
    expect(
      await sourceLinks.evaluateAll((links) =>
        links.every((link) => link.getAttribute('href')?.includes('/'))
      )
    ).toBe(true);

    await adminPage.getByRole('button', { name: 'Arbeit', exact: true }).click();
    await expect(timeline.getByText(jobTitle)).toBeVisible();
    await expect(timeline.getByText(`Anna Ansprechpartnerin ${world.runId}`)).toHaveCount(0);

    await adminPage.getByRole('button', { name: 'Dokumente', exact: true }).click();
    const documentEntry = timeline
      .locator('[data-timeline-key]')
      .filter({ hasText: 'upload-fixture' });
    await expect(documentEntry).toHaveCount(1);
    await documentEntry.getByRole('link', { name: 'Quelle öffnen' }).click();
    await expect(adminPage).toHaveURL(/\/dokumente\?document=/);
    await expect(
      adminPage.getByRole('dialog').getByRole('heading', {
        name: /upload-fixture/,
      })
    ).toBeVisible({ timeout: 15_000 });
  });

  test('an overdue owned follow-up appears and clears in the shared attention pattern', async ({
    bueroPage,
    world,
  }) => {
    const customer = customerName(world.runId);
    const title = followUpTitle(world.runId);
    await openCustomerDetail(bueroPage, customer);
    await createFollowUpOnCustomerDetail(bueroPage, {
      title,
      dueAtLocal: berlinDateTime(-1, 9),
      note: 'Kundenzusage zum Angebot prüfen',
    });
    const followUpRow = bueroPage
      .getByRole('region', { name: 'Nachfassaktionen' })
      .locator('[data-follow-up-id]')
      .filter({ hasText: title });
    await expect(followUpRow).toHaveAttribute('data-overdue', 'true');

    await openAufgaben(bueroPage);
    const task = attentionTaskLink(bueroPage, `Nachfassaktion ${title} für ${customer} öffnen`);
    await expect(task).toHaveCount(1, { timeout: 15_000 });
    await task.click();
    await expect(followUpRow).toBeVisible({ timeout: 15_000 });
    await completeFollowUpOnCustomerDetail(bueroPage, title);

    await openAufgaben(bueroPage);
    await expect(
      attentionTaskLink(bueroPage, `Nachfassaktion ${title} für ${customer} öffnen`)
    ).toHaveCount(0, { timeout: 15_000 });

    const state = await getCustomerRelationshipState(world.orgId, customer);
    const followUp = state.followUps.find((row) => row.title === title);
    expect(followUp).toMatchObject({
      status: 'completed',
      ownerUserId: world.users.buero.id,
      completedBy: world.users.buero.id,
    });
    expect(state.followUpEventTypes).toEqual(['created', 'completed']);
  });

  test('communication preferences remain purpose-specific and warn for the wrong person or channel', async ({
    adminPage,
    world,
  }) => {
    const anna = `Anna Ansprechpartnerin ${world.runId}`;
    const berta = `Berta Ansprechpartnerin ${world.runId}`;
    await openCustomerDetail(adminPage, customerName(world.runId));
    await configureCustomerCommunicationSettings(adminPage, {
      preferredContactName: anna,
      doNotContactInstruction: 'Nur nach vorheriger Prüfung kontaktieren.',
      sourceNote: 'Kundengespräch P1-10',
    });
    await setCustomerCommunicationPreference(adminPage, {
      contactName: berta,
      channel: 'Telefon',
      state: 'Nicht erlaubt',
      purpose: 'Termin und Service',
      sourceNote: 'Telefonische Angabe P1-10',
    });
    await expect(visibleText(adminPage, 'Nicht erlaubt')).toBeVisible({
      timeout: 15_000,
    });

    await adminPage.getByRole('link', { name: '+49 30 555002' }).click();
    const warningDialog = adminPage.getByRole('dialog');
    await expect(warningDialog.getByText(/Nicht-kontaktieren-Hinweis/)).toBeVisible();
    await expect(warningDialog.getByText(/anderer Ansprechpartner/)).toBeVisible();
    await expect(warningDialog.getByText(/Kontaktweg.*nicht erlaubt/)).toBeVisible();
    await warningDialog.getByRole('button', { name: 'Abbrechen' }).click();

    await proceedThroughContactWarning(
      adminPage,
      '+49 30 555002',
      'Notwendiger Rückruf zur laufenden Terminabstimmung'
    );
    await expect
      .poll(async () => {
        const state = await getCustomerRelationshipState(world.orgId, customerName(world.runId));
        return state.preferenceEventTypes;
      })
      .toContain('exception_acknowledged');
  });

  test('Realtime updates open follow-ups for a second office user', async ({
    adminPage,
    bueroPage,
    world,
  }) => {
    const customer = customerName(world.runId);
    const title = `Realtime Nachfassen ${world.runId}`;
    await Promise.all([
      openCustomerDetail(adminPage, customer),
      openCustomerDetail(bueroPage, customer),
    ]);
    await createFollowUpOnCustomerDetail(adminPage, {
      title,
      dueAtLocal: berlinDateTime(2, 10),
    });
    await expectLiveWithin(visibleText(bueroPage, title), {
      label: 'p1-10 follow-up cross-session',
    });
  });

  test('employees and outside organizations cannot open customer relationships directly', async ({
    employeePage,
    outsiderPage,
    world,
  }) => {
    const state = await getCustomerRelationshipState(world.orgId, customerName(world.runId));
    await employeePage.goto(`/kunden/${state.clientId}`);
    await employeePage.waitForURL('**/dashboard', { timeout: 15_000 });
    await outsiderPage.goto(`/kunden/${state.clientId}`);
    await outsiderPage.waitForURL('**/kunden', { timeout: 15_000 });
  });

  test('RLS limits customer records, follow-ups, preferences, and history to same-organization managers', async ({
    world,
  }) => {
    const [adminView, bueroView, employeeView, outsiderView] = await Promise.all([
      getVisibleCustomerRelationshipStateAs(world.users.admin, world.orgId),
      getVisibleCustomerRelationshipStateAs(world.users.buero, world.orgId),
      getVisibleCustomerRelationshipStateAs(world.users.employee, world.orgId),
      getVisibleCustomerRelationshipStateAs(world.outsider.admin, world.orgId),
    ]);
    expect(adminView.clients).toBeGreaterThan(0);
    expect(adminView.client_follow_ups).toBeGreaterThan(0);
    expect(adminView.client_communication_preferences).toBeGreaterThan(0);
    expect(bueroView).toEqual(adminView);
    for (const count of Object.values(employeeView)) expect(count).toBe(0);
    for (const count of Object.values(outsiderView)) expect(count).toBe(0);
  });
});

import { resolve } from 'node:path';
import type { Locator, Page } from '@playwright/test';

import { expect, test } from '../support/fixtures';
import { artifactsDirectory } from '../../golden/support/world';
import { seedCustomer } from '../../golden/support/db/customers';
import {
  getConvertedRequestJobState,
  getRequestAuditState,
  getRequestConversionState,
  seedRequest,
} from '../../golden/support/db/requests';
import { seedProject } from '../../golden/support/db/work';
import {
  documentFileInputs,
  documentLibraryTrashButton,
  documentOpenButton,
  documentViewerHeading,
  visibleDocumentName,
} from '../../golden/support/steps/documents';
import { dismissDialog } from '../../golden/support/steps/interaction';
import { expectRedirectedAway } from '../../golden/support/steps/organization';
import {
  closeRequestViaDialog,
  convertedJobLink,
  convertRequestToProjectViaDialog,
  convertToJobSubmit,
  createRequestViaDialog,
  matchRequestToExistingCustomer,
  moveRequestDocumentToTrash,
  noAssigneeOption,
  REQUEST_DETAIL_TEXT,
  requestBacklink,
  requestCaptureButton,
  requestCloseButton,
  requestCloseReasonLabel,
  requestCloseSubmit,
  requestConvertButton,
  requestDocumentTrashedMessage,
  requestsNavLink,
  searchRequests,
  setRequestStatusFromDetail,
  showRequestStatus,
  uploadDocumentOnRequestDetail,
} from '../../golden/support/steps/requests';
import { SHARED_COPY, testData, textInDom, visibleText } from '../../golden/support/steps/shared';
import { lifecycleBadge } from '../../golden/support/steps/work';
import { formatBerlinDateTimeInput } from '../../../lib/customer-relationships/date-time';
import { JOB_PRIORITY_LABELS } from '../../../lib/jobs/types';
import {
  REQUEST_CATEGORY_LABELS,
  REQUEST_CLOSE_REASON_LABELS,
  REQUEST_SOURCE_LABELS,
  REQUEST_URGENCY_LABELS,
} from '../../../lib/requests/types';
import { expectDefined } from '../../../lib/testing/spec-support/expect-defined';
import { waitForRouteIntercept } from '../support/network';

// A2 requests: optional facts, number override, lifecycle edges, attachments,
// conversion into a project, the prefilled job conversion, list filters and the
// role boundary. GG-01 owns the capture-convert journey; every test here seeds
// the requests and customers it does not claim.

function fullName(user: { firstName: string; lastName: string }): string {
  return `${user.firstName} ${user.lastName}`;
}

async function expectSelectOptions(page: Page, trigger: Locator, labels: string[]): Promise<void> {
  const [firstLabel] = labels;
  if (!firstLabel) throw new Error('expectSelectOptions needs at least one label');
  await trigger.click();
  for (const label of labels) {
    await expect(page.getByRole('option', { name: label, exact: true })).toBeVisible();
  }
  await page.getByRole('option', { name: firstLabel, exact: true }).click();
}

test.describe('A2 Anfragen @AUDIT-W1-A2', () => {
  test('A2-09: Unbekannte Anruferin wird bestehendem Kunden zugeordnet und bleibt nachvollziehbar', async ({
    bueroPage,
    world,
  }) => {
    const customer = `A2 Zielkunde ${world.runId}`;
    const requestNumber = `A2-ANF-${world.runId}-09`;
    const caller = `A2 Unbekannte Anruferin ${world.runId}`;
    const phone = '+49 30 290009';
    const email = `anruf-${world.runId}@example.test`;
    const address = testData`Anrufstraße 9, 10115 Berlin`;

    await seedCustomer({ orgId: world.orgId, actorId: world.users.admin.id, name: customer });
    const requestId = await seedRequest({
      orgId: world.orgId,
      actorId: world.users.buero.id,
      summary: `A2 Bestehender Kunde zuordnen ${world.runId}`,
      requestNumber,
      callerName: caller,
      callerPhone: phone,
      callerEmail: email,
      callerAddress: address,
    });
    await bueroPage.goto(`/anfragen/${requestId}`);
    await matchRequestToExistingCustomer(bueroPage, customer);
    await bueroPage.reload();
    await expect(visibleText(bueroPage, customer)).toBeVisible();
    await expect(visibleText(bueroPage, REQUEST_DETAIL_TEXT.callerFacts)).toBeVisible();
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
  });

  test('A2-10/A2-11: Eigene Anfragenummer überlebt späten Vorschlag; Klärung und Wiederöffnung bleiben bestehen', async ({
    bueroPage,
    world,
  }) => {
    const requestNumber = `A2-ANF-${world.runId}-10`;
    const summary = `A2 Später Nummernvorschlag ${world.runId}`;
    let releaseSuggestion: () => void = () => undefined;
    let markIntercepted: () => void = () => undefined;
    const suggestionGate = new Promise<void>((resolveGate) => {
      releaseSuggestion = resolveGate;
    });
    const intercepted = new Promise<void>((resolveIntercept) => {
      markIntercepted = resolveIntercept;
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
      await requestCaptureButton(bueroPage).click();
      try {
        await waitForRouteIntercept(intercepted);
      } catch {
        throw new Error('The request-number suggestion server action was not intercepted within 15 seconds.');
      }
      const dialog = bueroPage.getByRole('dialog');
      await dialog.locator('#request-summary').fill(summary);
      await dialog.locator('#request-number').fill(requestNumber);
      const suggestionResponse = bueroPage.waitForResponse(
        (response) =>
          response.request().method() === 'POST' &&
          new URL(response.url()).pathname === '/anfragen' &&
          Boolean(response.request().headers()['next-action']),
        { timeout: 15_000 },
      );
      releaseSuggestion();
      await suggestionResponse;
      await expect(dialog.locator('#request-number')).toHaveValue(requestNumber, {
        timeout: 15_000,
      });
      await requestCaptureButton(dialog).click();
      await bueroPage.waitForURL(/\/anfragen\/[0-9a-f-]{36}/, {
        timeout: 20_000,
      });
    } finally {
      releaseSuggestion();
      await bueroPage.unroute('**/anfragen');
    }
    expect((await getRequestAuditState(world.orgId, requestNumber)).status).toBe('offen');

    await setRequestStatusFromDetail(bueroPage, 'clarify');
    expect((await getRequestAuditState(world.orgId, requestNumber)).status).toBe('in_klaerung');
    await closeRequestViaDialog(bueroPage, REQUEST_CLOSE_REASON_LABELS.kein_bedarf);
    expect((await getRequestAuditState(world.orgId, requestNumber)).status).toBe('geschlossen');
    await setRequestStatusFromDetail(bueroPage, 'reopen');
    expect((await getRequestAuditState(world.orgId, requestNumber)).status).toBe('offen');
  });

  test('A2-13: Anfrage wird genau einmal in ein Projekt umgewandelt und beidseitig verlinkt', async ({
    adminPage,
    world,
  }) => {
    const requestNumber = `A2-ANF-${world.runId}-13`;
    const projectNumber = `A2-RP-${world.runId}`;
    const { clientId } = await seedCustomer({
      orgId: world.orgId,
      actorId: world.users.admin.id,
      name: `A2 Projektanfrage Kunde ${world.runId}`,
    });
    const requestId = await seedRequest({
      orgId: world.orgId,
      actorId: world.users.admin.id,
      summary: `A2 Projekt aus Anfrage ${world.runId}`,
      requestNumber,
      clientId,
    });

    await adminPage.goto(`/anfragen/${requestId}`);
    await convertRequestToProjectViaDialog(adminPage, projectNumber);
    const requestLink = adminPage.getByRole('link', {
      name: new RegExp(projectNumber),
    });
    await expect(requestLink).toBeVisible();
    await expect(requestConvertButton(adminPage)).toHaveCount(0);
    await requestLink.click();
    await expect(requestBacklink(adminPage, requestNumber)).toBeVisible();

    const state = await getRequestConversionState(world.orgId, requestNumber);
    expect(state.status).toBe('umgewandelt');
    expect(state.convertedProjectId).not.toBeNull();
    expect(state.convertedJobId).toBeNull();
  });

  test('A2-R01: Anfrage erfasst alle optionalen Fakten und die vollständige Auswahl', async ({
    bueroPage,
    businessDate,
    world,
  }) => {
    const customer = `A2 Vollständiger Kunde ${world.runId}`;
    const site = `A2 Nebenstelle ${world.runId}`;
    const contact = `A2 Hauptkontakt ${world.runId}`;
    const requestNumber = `A2-ANF-${world.runId}-R01`;
    const details = testData`Heizkreis prüfen und Rückruf vorbereiten`;
    const assignee = fullName(world.users.buero);

    await seedCustomer({
      orgId: world.orgId,
      actorId: world.users.admin.id,
      name: customer,
      contacts: [{ name: contact }],
      sites: [{ name: site, city: 'Berlin' }],
    });

    await bueroPage.goto('/anfragen');
    await requestCaptureButton(bueroPage).click();
    const dialog = bueroPage.getByRole('dialog');
    await expect(dialog.locator('#request-received-at-date')).toBeVisible();
    await expectSelectOptions(bueroPage, dialog.locator('#request-category'), [
      REQUEST_CATEGORY_LABELS.notfall,
      REQUEST_CATEGORY_LABELS.stoerung_reparatur,
      REQUEST_CATEGORY_LABELS.wartung,
      REQUEST_CATEGORY_LABELS.angebotsanfrage,
      REQUEST_CATEGORY_LABELS.installation_umbau,
      REQUEST_CATEGORY_LABELS.garantie_mangel,
      REQUEST_CATEGORY_LABELS.allgemeine_frage,
      REQUEST_CATEGORY_LABELS.sonstiges,
    ]);
    await expectSelectOptions(bueroPage, dialog.locator('#request-urgency'), [
      REQUEST_URGENCY_LABELS.niedrig,
      REQUEST_URGENCY_LABELS.normal,
      REQUEST_URGENCY_LABELS.hoch,
      REQUEST_URGENCY_LABELS.notfall,
    ]);
    await expectSelectOptions(bueroPage, dialog.locator('#request-source'), [
      REQUEST_SOURCE_LABELS.telefon,
      REQUEST_SOURCE_LABELS.email,
      REQUEST_SOURCE_LABELS.vor_ort,
      REQUEST_SOURCE_LABELS.sonstiges,
    ]);
    await dialog.locator('#request-assignee').click();
    const assigneeListbox = bueroPage.getByRole('listbox');
    await expect(assigneeListbox).toBeVisible();
    await expect(noAssigneeOption(assigneeListbox)).toBeVisible();
    await expect(assigneeListbox.getByRole('option').filter({ hasText: assignee })).toBeVisible();
    await noAssigneeOption(assigneeListbox).click();
    await dismissDialog(dialog);
    await expect(dialog).toHaveCount(0);

    await createRequestViaDialog(bueroPage, {
      summary: `A2 Vollständige Anfrage ${world.runId}`,
      details,
      requestNumber,
      clientName: customer,
      siteName: site,
      contactName: contact,
      categoryLabel: REQUEST_CATEGORY_LABELS.installation_umbau,
      urgencyLabel: REQUEST_URGENCY_LABELS.notfall,
      sourceLabel: REQUEST_SOURCE_LABELS.email,
      receivedAtLocal: `${businessDate}T06:00`,
      assigneeName: assignee,
    });
    await expect(visibleText(bueroPage, details)).toBeVisible();
    await expect(visibleText(bueroPage, REQUEST_CATEGORY_LABELS.installation_umbau)).toBeVisible();
    await expect(visibleText(bueroPage, REQUEST_SOURCE_LABELS.email)).toBeVisible();
    await expect(visibleText(bueroPage, assignee)).toBeVisible();
    await expect(visibleText(bueroPage, site)).toBeVisible();
    await expect(visibleText(bueroPage, contact)).toBeVisible();
    await expect(visibleText(bueroPage, REQUEST_DETAIL_TEXT.captured)).toBeVisible();

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
    // The stored instant reads back as the entered Berlin wall time in either season.
    expect(formatBerlinDateTimeInput(state.receivedAt)).toBe(`${businessDate}T06:00`);
  });

  test('A2-R02: Anfrage-Anhang öffnet im Viewer und landet im Papierkorb', async ({ adminPage, world }) => {
    const requestId = await seedRequest({
      orgId: world.orgId,
      actorId: world.users.admin.id,
      summary: `A2 Dokumentierte Anfrage ${world.runId}`,
      requestNumber: `A2-ANF-${world.runId}-R02`,
    });
    await adminPage.goto(`/anfragen/${requestId}`);
    await uploadDocumentOnRequestDetail(
      adminPage,
      resolve(artifactsDirectory(), 'upload-fixture.pdf'),
      'upload-fixture',
    );
    await documentOpenButton(adminPage, 'upload-fixture').click();
    const viewer = adminPage.getByRole('dialog');
    await expect(documentViewerHeading(adminPage, 'upload-fixture')).toBeVisible({
      timeout: 20_000,
    });
    await expect(viewer.locator('iframe[title*="upload-fixture"]')).toBeVisible({
      timeout: 20_000,
    });
    await dismissDialog(viewer);
    await expect(viewer).toHaveCount(0);

    await moveRequestDocumentToTrash(adminPage, 'upload-fixture');
    await expect(requestDocumentTrashedMessage(adminPage)).toBeVisible({
      timeout: 20_000,
    });
    await expect(documentOpenButton(adminPage, 'upload-fixture')).toHaveCount(0);
    await adminPage.goto('/dokumente');
    await documentLibraryTrashButton(adminPage).click();
    await expect(visibleDocumentName(adminPage, 'upload-fixture')).toBeVisible({
      timeout: 20_000,
    });
  });

  test('A2-R03: Abschlussgründe sind verpflichtend; umgewandelte Anfragen sind schreibgeschützt', async ({
    bueroPage,
    world,
  }) => {
    const openRequestId = await seedRequest({
      orgId: world.orgId,
      actorId: world.users.buero.id,
      summary: `A2 Abschluss prüfen ${world.runId}`,
      requestNumber: `A2-ANF-${world.runId}-R03`,
    });
    const projectId = await seedProject({
      orgId: world.orgId,
      actorId: world.users.admin.id,
      projectNumber: `A2-R03-P-${world.runId}`,
      name: `A2 Schreibschutzprojekt ${world.runId}`,
    });
    const convertedRequestId = await seedRequest({
      orgId: world.orgId,
      actorId: world.users.admin.id,
      summary: `A2 Bereits umgewandelt ${world.runId}`,
      requestNumber: `A2-ANF-${world.runId}-R03-CONV`,
      outcome: { status: 'umgewandelt', projectId },
    });

    await bueroPage.goto(`/anfragen/${openRequestId}`);
    await requestCloseButton(bueroPage).click();
    const closeDialog = bueroPage.getByRole('dialog');
    await expect(requestCloseReasonLabel(closeDialog)).toBeVisible();
    await expectSelectOptions(bueroPage, closeDialog.locator('#close-reason'), [
      REQUEST_CLOSE_REASON_LABELS.kein_bedarf,
      REQUEST_CLOSE_REASON_LABELS.abgelehnt,
      REQUEST_CLOSE_REASON_LABELS.duplikat,
      REQUEST_CLOSE_REASON_LABELS.anderweitig_geloest,
      REQUEST_CLOSE_REASON_LABELS.sonstiges,
    ]);
    await expect(closeDialog.locator('#close-reason')).not.toHaveText('');
    await closeDialog.locator('#close-reason').click();
    await bueroPage.getByRole('option', { name: REQUEST_CLOSE_REASON_LABELS.duplikat, exact: true }).click();
    await requestCloseSubmit(closeDialog).click();
    await expect(closeDialog).toHaveCount(0, { timeout: 15_000 });
    await bueroPage.reload();
    await expect(visibleText(bueroPage, REQUEST_DETAIL_TEXT.closedWithoutWork)).toBeVisible();
    await expect(visibleText(bueroPage, REQUEST_CLOSE_REASON_LABELS.duplikat)).toBeVisible();

    await bueroPage.goto(`/anfragen/${convertedRequestId}`);
    await expect(visibleText(bueroPage, REQUEST_DETAIL_TEXT.converted)).toBeVisible({
      timeout: 15_000,
    });
    await expect(requestConvertButton(bueroPage)).toHaveCount(0);
    await expect(bueroPage.getByRole('button', { name: SHARED_COPY.action.edit })).toHaveCount(0);
    await expect(bueroPage.getByRole('button', { name: SHARED_COPY.action.close })).toHaveCount(0);
    await expect(documentFileInputs(bueroPage)).toHaveCount(0);
  });

  test('A2-R04: Auftragsumwandlung ist vollständig vorbefüllt, editierbar, ungeplant und versandfrei', async ({
    adminPage,
    world,
  }) => {
    const customer = `A2 Umwandlungskunde ${world.runId}`;
    const contact = `A2 Umwandlungskontakt ${world.runId}`;
    const site = `A2 Umwandlungsstandort ${world.runId}`;
    const requestNumber = `A2-ANF-${world.runId}-R04`;
    const summary = `A2 Umwandlung komplett ${world.runId}`;
    const details = testData`Ursprüngliche Anfragebeschreibung`;
    const editedTitle = `A2 Editierter Auftrag ${world.runId}`;
    const editedDescription = testData`Im Umwandlungsdialog bewusst ergänzt`;

    const seeded = await seedCustomer({
      orgId: world.orgId,
      actorId: world.users.admin.id,
      name: customer,
      contacts: [{ name: contact }],
      sites: [{ name: site, city: 'Berlin' }],
    });
    const siteId = expectDefined(seeded.siteIds.get(site), 'seeded conversion site');
    const contactId = expectDefined(seeded.contactIds.get(contact), 'seeded conversion contact');
    const requestId = await seedRequest({
      orgId: world.orgId,
      actorId: world.users.admin.id,
      summary,
      details,
      requestNumber,
      clientId: seeded.clientId,
      siteId,
      contactId,
      urgency: 'notfall',
    });
    await adminPage.goto(`/anfragen/${requestId}`);
    await requestConvertButton(adminPage).click();
    const dialog = adminPage.getByRole('dialog');
    await expect(dialog.locator('#convert-title')).toHaveValue(summary);
    await expect(dialog.locator('#convert-description')).toHaveValue(details);
    await expect(dialog.getByRole('combobox').filter({ hasText: customer })).toBeVisible();
    await expect(dialog.locator('#convert-site')).toContainText(site);
    await expect(dialog.locator('#convert-contact')).toContainText(contact);
    await expect(dialog.locator('#convert-priority')).toContainText(JOB_PRIORITY_LABELS.hoch);
    await expect(dialog.locator('#convert-date')).toContainText(REQUEST_DETAIL_TEXT.noPlannedDate);
    await expect(dialog.getByText(REQUEST_DETAIL_TEXT.noAutomaticScheduling)).toBeVisible();
    await dialog.locator('#convert-title').fill(editedTitle);
    await dialog.locator('#convert-description').fill(editedDescription);
    await expect(dialog.locator('#convert-number')).toHaveValue(/.+/, {
      timeout: 15_000,
    });
    await convertToJobSubmit(dialog).click();
    await expect(dialog).toHaveCount(0, { timeout: 20_000 });
    const jobLink = convertedJobLink(adminPage);
    await expect(jobLink).toBeVisible({ timeout: 15_000 });
    await jobLink.click();
    await expect(visibleText(adminPage, editedTitle)).toBeVisible();
    await expect(visibleText(adminPage, editedDescription)).toBeVisible();
    // Since P1-12/P1-14 a conversion no longer creates a passive parked state
    // (catalog P1-02-F05, BASE-WORK-F03): a date-less converted job is honest
    // unplanned open work, and parking stays a separate reasoned act.
    await expect(lifecycleBadge(adminPage, 'unplanned')).toBeVisible();

    const state = await getConvertedRequestJobState(world.orgId, requestNumber);
    expect(state).toMatchObject({
      title: editedTitle,
      description: editedDescription,
      priority: 'hoch',
      status: 'nicht_bearbeitet',
      plannedDate: null,
      planningCount: 0,
      dispatchCount: 0,
      clientId: seeded.clientId,
      siteId,
      contactId,
    });
  });

  test('A2-R07: Anfragenliste filtert und sucht alle Katalogidentitäten', async ({ bueroPage, world }) => {
    const customer = `A2 Suchkunde ${world.runId}`;
    const caller = `A2 Suchanruferin ${world.runId}`;
    const activeSummary = `A2 Aktive Suchanfrage ${world.runId}`;
    const activeNumber = `A2-ANF-${world.runId}-R07-AKTIV`;
    const callerNumber = `A2-ANF-${world.runId}-R07-ANRUF`;
    const convertedNumber = `A2-ANF-${world.runId}-R07-CONV`;
    const closedNumber = `A2-ANF-${world.runId}-R07-CLOSED`;

    const { clientId } = await seedCustomer({
      orgId: world.orgId,
      actorId: world.users.admin.id,
      name: customer,
    });
    await seedRequest({
      orgId: world.orgId,
      actorId: world.users.buero.id,
      summary: activeSummary,
      requestNumber: activeNumber,
      clientId,
      assignedTo: world.users.buero.id,
    });
    await seedRequest({
      orgId: world.orgId,
      actorId: world.users.buero.id,
      summary: `A2 Anruferanfrage ${world.runId}`,
      requestNumber: callerNumber,
      callerName: caller,
    });
    const projectId = await seedProject({
      orgId: world.orgId,
      actorId: world.users.admin.id,
      projectNumber: `A2-R07-P-${world.runId}`,
      name: `A2 Suchprojekt ${world.runId}`,
    });
    await seedRequest({
      orgId: world.orgId,
      actorId: world.users.admin.id,
      summary: `A2 Umgewandelte Suchanfrage ${world.runId}`,
      requestNumber: convertedNumber,
      outcome: { status: 'umgewandelt', projectId },
    });
    await seedRequest({
      orgId: world.orgId,
      actorId: world.users.buero.id,
      summary: `A2 Dauerhaft geschlossen ${world.runId}`,
      requestNumber: closedNumber,
      outcome: { status: 'geschlossen', reason: 'sonstiges' },
    });

    await bueroPage.goto('/anfragen');
    await expect(visibleText(bueroPage, activeNumber)).toBeVisible();
    await expect(textInDom(bueroPage, convertedNumber)).toHaveCount(0);
    await expect(textInDom(bueroPage, closedNumber)).toHaveCount(0);
    await showRequestStatus(bueroPage, 'umgewandelt');
    await expect(visibleText(bueroPage, convertedNumber)).toBeVisible();
    await expect(textInDom(bueroPage, activeNumber)).toHaveCount(0);
    await showRequestStatus(bueroPage, 'geschlossen');
    await expect(visibleText(bueroPage, closedNumber)).toBeVisible();
    await showRequestStatus(bueroPage, 'alle');
    await expect(visibleText(bueroPage, activeNumber)).toBeVisible();
    await expect(visibleText(bueroPage, convertedNumber)).toBeVisible();
    await expect(visibleText(bueroPage, closedNumber)).toBeVisible();

    // The server searches: each query commits its own URL before the row is read.
    for (const [query, expected] of [
      [activeSummary, activeNumber],
      [customer, activeNumber],
      [caller, callerNumber],
      [activeNumber, activeNumber],
      [fullName(world.users.buero), activeNumber],
    ] as const) {
      await searchRequests(bueroPage, query);
      await expect(visibleText(bueroPage, expected)).toBeVisible();
    }
  });

  test('A2-D02: Handwerker und fremde Organisation erreichen keine Anfrage', async ({
    employeePage,
    outsiderPage,
    world,
  }) => {
    const summary = `A2 Geschützte Anfrage ${world.runId}`;
    const requestNumber = `A2-ANF-${world.runId}-D02`;
    const requestId = await seedRequest({
      orgId: world.orgId,
      actorId: world.users.buero.id,
      summary,
      requestNumber,
    });

    await expectRedirectedAway(employeePage, '/anfragen');
    await expectRedirectedAway(employeePage, `/anfragen/${requestId}`);
    await expect(textInDom(employeePage, summary)).toHaveCount(0);
    await employeePage.goto('/dashboard');
    await expect(requestsNavLink(employeePage)).toHaveCount(0);

    await outsiderPage.goto(`/anfragen/${requestId}`);
    await expect(textInDom(outsiderPage, summary)).toHaveCount(0);
    await expect(textInDom(outsiderPage, requestNumber)).toHaveCount(0);
  });
});

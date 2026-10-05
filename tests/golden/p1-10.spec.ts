import { resolve } from 'node:path';

import { expect, test } from './support/fixtures';
import { artifactsDirectory } from './support/world';
import { berlinDateAtOffset } from './support/date-ownership';
import { getCustomerRelationshipState, seedCustomer } from './support/db/customers';
import { seedJob } from './support/db/work';
import { followUpTaskLink, openAufgaben } from './support/steps/attention';
import {
  completeFollowUpOnCustomerDetail,
  configureCustomerCommunicationSettings,
  contactWarningReason,
  createFollowUpOnCustomerDetail,
  customerTimeline,
  customerTimelineEntries,
  customerTimelineEntry,
  customerTimelineFact,
  customerTimelineFilter,
  followUpRow,
  forbiddenPreferenceState,
  openSeededCustomerDetail,
  proceedThroughContactWarning,
  setCustomerCommunicationPreference,
  timelineSourceLinks,
} from './support/steps/customers';
import { documentViewerHeading, uploadDocumentOnJobPage } from './support/steps/documents';
import { SHARED_COPY, testData, visibleText } from './support/steps/shared';
import { expectLiveWithin } from './support/live';

// P1-10 owns no effective-date keys. Every test seeds its own run-scoped
// customer; the audit file tests/audit/wave-1/a2-beziehungen.spec.ts owns the
// source matrix, reassignment and the complete preference matrix, and
// supabase/tests/customer_relationships.sql owns the manager-only RLS boundary.

test.describe('P1-10 customer relationships @P1-10', () => {
  test('source-linked history orders facts deterministically and filters without copies', async ({
    adminPage,
    world,
  }) => {
    const customer = `P1-10 Chronik ${world.runId}`;
    const anna = testData`Anna Ansprechpartnerin ${world.runId}`;
    const jobNumber = `AUF-${world.runId}-P110-1`;
    const jobTitle = testData`P1-10 Wartungsauftrag ${world.runId}`;
    const { clientId } = await seedCustomer({
      orgId: world.orgId,
      actorId: world.users.admin.id,
      name: customer,
      contacts: [
        { name: anna, phone: '+49 30 555001' },
        { name: `Berta Ansprechpartnerin ${world.runId}`, phone: '+49 30 555002' },
      ],
      sites: [{ name: `Heizraum ${world.runId}`, city: 'Berlin' }],
    });
    await seedJob({
      orgId: world.orgId,
      actorId: world.users.admin.id,
      jobNumber,
      title: jobTitle,
      clientId,
    });
    await uploadDocumentOnJobPage(
      adminPage,
      jobNumber,
      resolve(artifactsDirectory(), 'upload-fixture.pdf'),
      'upload-fixture',
    );
    await openSeededCustomerDetail(adminPage, clientId);

    const timeline = customerTimeline(adminPage.getByRole('main'));
    await expect(customerTimelineFact(timeline, 'customerCreated')).toBeVisible();
    await expect(customerTimelineFact(timeline, 'contactCreated').filter({ visible: true })).not.toHaveCount(
      0,
    );
    await expect(customerTimelineFact(timeline, 'siteCreated')).toBeVisible();
    await expect(timeline.getByText(jobTitle)).toBeVisible();
    const keys = await customerTimelineEntries(timeline).evaluateAll((rows) =>
      rows.map((row) => row.getAttribute('data-timeline-key')),
    );
    expect(new Set(keys).size).toBe(keys.length);
    // Newest first: every entry carries a machine-readable time in descending order.
    const times = await timeline
      .locator('time')
      .evaluateAll((elements) => elements.map((element) => element.getAttribute('datetime') ?? ''));
    expect(times.length).toBeGreaterThan(2);
    expect(times.every((value) => !Number.isNaN(Date.parse(value)))).toBe(true);
    expect(times).toEqual([...times].sort((left, right) => Date.parse(right) - Date.parse(left)));
    const sourceLinks = timelineSourceLinks(timeline);
    await expect(sourceLinks).not.toHaveCount(0);
    expect(
      await sourceLinks.evaluateAll((links) =>
        links.every((link) => link.getAttribute('href')?.includes('/')),
      ),
    ).toBe(true);

    await customerTimelineFilter(adminPage, 'work').click();
    await expect(timeline.getByText(jobTitle)).toBeVisible();
    await expect(adminPage.getByTestId('customer-timeline').getByText(anna)).toHaveCount(0);

    await customerTimelineFilter(adminPage, 'documents').click();
    const documentEntry = customerTimelineEntry(timeline, 'upload-fixture');
    await expect(documentEntry).toHaveCount(1);
    await expect(adminPage.getByTestId('customer-timeline').getByText(jobTitle)).toHaveCount(0);
    await timelineSourceLinks(documentEntry).click();
    await expect(adminPage).toHaveURL(/\/dokumente\?document=/);
    await expect(documentViewerHeading(adminPage, 'upload-fixture')).toBeVisible({ timeout: 15_000 });
  });

  test('an overdue owned follow-up appears and clears in the shared attention pattern', async ({
    bueroPage,
    world,
  }) => {
    const customer = `P1-10 Wiedervorlage ${world.runId}`;
    const title = `Rückruf Heizungsangebot ${world.runId}`;
    const { clientId } = await seedCustomer({
      orgId: world.orgId,
      actorId: world.users.admin.id,
      name: customer,
    });
    await openSeededCustomerDetail(bueroPage, clientId);
    await createFollowUpOnCustomerDetail(bueroPage, {
      title,
      dueAtLocal: `${berlinDateAtOffset(-1)}T09:00`,
      note: 'Kundenzusage zum Angebot prüfen',
    });
    const followUp = followUpRow(bueroPage, title);
    await expect(followUp).toHaveAttribute('data-overdue', 'true');

    await openAufgaben(bueroPage);
    const task = followUpTaskLink(bueroPage, title, customer);
    await expect(task).toHaveCount(1, { timeout: 15_000 });
    await task.click();
    await expect(followUp).toBeVisible({ timeout: 15_000 });
    await completeFollowUpOnCustomerDetail(bueroPage, title);

    await openAufgaben(bueroPage);
    await expect(followUpTaskLink(bueroPage, title, customer)).toHaveCount(0, { timeout: 15_000 });

    const state = await getCustomerRelationshipState(world.orgId, customer);
    expect(state.followUps.find((row) => row.title === title)).toMatchObject({
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
    const customer = `P1-10 Kontaktvorgaben ${world.runId}`;
    const anna = `Anna Ansprechpartnerin ${world.runId}`;
    const berta = `Berta Ansprechpartnerin ${world.runId}`;
    const { clientId } = await seedCustomer({
      orgId: world.orgId,
      actorId: world.users.admin.id,
      name: customer,
      contacts: [
        { name: anna, phone: '+49 30 555001' },
        { name: berta, phone: '+49 30 555002' },
      ],
    });
    await openSeededCustomerDetail(adminPage, clientId);
    await configureCustomerCommunicationSettings(adminPage, {
      preferredContactName: anna,
      doNotContactInstruction: 'Nur nach vorheriger Prüfung kontaktieren.',
      sourceNote: 'Kundengespräch P1-10',
    });
    await setCustomerCommunicationPreference(adminPage, {
      contactName: berta,
      channel: 'phone',
      state: 'disallowed',
      purpose: 'appointment_service',
      sourceNote: 'Telefonische Angabe P1-10',
    });
    await expect(forbiddenPreferenceState(adminPage)).toBeVisible({
      timeout: 15_000,
    });

    await adminPage.getByRole('link', { name: '+49 30 555002' }).click();
    const warningDialog = adminPage.getByRole('dialog');
    await expect(contactWarningReason(warningDialog, 'doNotContact')).toBeVisible();
    await expect(contactWarningReason(warningDialog, 'otherContact')).toBeVisible();
    await expect(contactWarningReason(warningDialog, 'channelForbidden')).toBeVisible();
    await warningDialog.getByRole('button', { name: SHARED_COPY.action.cancel }).click();

    await proceedThroughContactWarning(
      adminPage,
      '+49 30 555002',
      'Notwendiger Rückruf zur laufenden Terminabstimmung',
    );
    await expect
      .poll(async () => {
        const state = await getCustomerRelationshipState(world.orgId, customer);
        return state.preferenceEventTypes;
      })
      .toContain('exception_acknowledged');
  });

  test('Realtime updates open follow-ups for a second office user @FRESHNESS', async ({
    adminPage,
    bueroPage,
    world,
  }) => {
    const { clientId } = await seedCustomer({
      orgId: world.orgId,
      actorId: world.users.admin.id,
      name: `P1-10 Live ${world.runId}`,
    });
    const title = testData`Realtime Nachfassen ${world.runId}`;
    await Promise.all([
      openSeededCustomerDetail(adminPage, clientId),
      openSeededCustomerDetail(bueroPage, clientId),
    ]);
    await expectLiveWithin(visibleText(bueroPage, title), {
      label: 'p1-10 follow-up cross-session',
      actingPage: adminPage,
      mutation: (beforeSubmit) =>
        createFollowUpOnCustomerDetail(adminPage, {
          title,
          dueAtLocal: `${berlinDateAtOffset(2)}T10:00`,
          beforeSubmit,
        }),
    });
  });
});

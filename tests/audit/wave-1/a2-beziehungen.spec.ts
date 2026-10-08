import type { Locator, Page } from '@playwright/test';

import { expect, test } from '../support/fixtures';
import { berlinDateAtOffset } from '../../golden/support/date-ownership';
import { getCustomerRelationshipState, seedCustomer } from '../../golden/support/db/customers';
import { seedRequest } from '../../golden/support/db/requests';
import { getPendingInviteCode } from '../../golden/support/db/shared';
import { seedJob, seedProject } from '../../golden/support/db/work';
import { followUpTaskLink, openAufgaben } from '../../golden/support/steps/attention';
import {
  addPreferenceButton,
  communicationPreferencesRegion,
  completeFollowUpOnCustomerDetail,
  configureCustomerCommunicationSettings,
  contactWarningContinueButton,
  contactWarningLegalNote,
  contactWarningReason,
  createFollowUpFromTimeline,
  createFollowUpOnCustomerDetail,
  CUSTOMER_TEXT,
  customerTimeline,
  customerTimelineFilter,
  editableFollowUpRow,
  followUpActionButton,
  openSeededCustomerDetail,
  setCustomerCommunicationPreference,
  timelineSourceLinks,
} from '../../golden/support/steps/customers';
import {
  inviteMember,
  joinOrganizationViaInviteLink,
  removeMemberFromDetail,
} from '../../golden/support/steps/organization';
import {
  expectGone,
  selectFromSearchable,
  SHARED_COPY,
  testData,
  visibleText,
} from '../../golden/support/steps/shared';
import {
  CHANNEL_LABELS,
  PURPOSE_LABELS,
  STATE_LABELS,
} from '../../../components/kunden/communication-preference-labels';
import { newestCustomerTimelineRow } from '../support/a2-steps';

// A2 customer relationships: orphaned follow-up reassignment, the complete
// source and attribution matrix of the history, and the complete preference
// matrix with the reason validation. P1-10 owns the history, follow-up,
// preference and live journeys; these tests seed the records they read.

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

test.describe('A2 Kundenbeziehungen @AUDIT-W1-A2', () => {
  test('A2-17: verwaiste Nachfassaktion wird von beiden Managern gesehen und neu zugewiesen', async ({
    adminPage,
    bueroPage,
    browser,
    world,
  }) => {
    const inviteeName = fullName(world.invitee);
    const customer = `A2 Beziehungskunde ${world.runId}`;
    const title = `A2 Neuzuweisung ${world.runId}`;

    await inviteMember(adminPage, world.invitee.email, 'buero');
    const inviteCode = await getPendingInviteCode(world.orgId, world.invitee.email);
    const inviteeContext = await browser.newContext();
    await joinOrganizationViaInviteLink(
      await inviteeContext.newPage(),
      inviteCode,
      world.invitee,
      world.orgId,
    );
    await inviteeContext.close();

    const { clientId } = await seedCustomer({
      orgId: world.orgId,
      actorId: world.users.admin.id,
      name: customer,
    });
    await openSeededCustomerDetail(adminPage, clientId);
    await createFollowUpOnCustomerDetail(adminPage, {
      title,
      dueAtLocal: `${berlinDateAtOffset(28)}T06:00`,
      ownerName: inviteeName,
      note: 'Nach Eigentümerwechsel neu zuweisen',
    });
    await removeMemberFromDetail(adminPage, inviteeName);

    await openAufgaben(adminPage);
    await expect(followUpTaskLink(adminPage, title, customer)).toHaveCount(1, {
      timeout: 15_000,
    });
    await openAufgaben(bueroPage);
    await expect(followUpTaskLink(bueroPage, title, customer)).toHaveCount(1, {
      timeout: 15_000,
    });

    await openSeededCustomerDetail(adminPage, clientId);
    const followUpRow = editableFollowUpRow(adminPage, title);
    await expect(followUpRow).toContainText(CUSTOMER_TEXT.followUpNeedsReassignment);
    await followUpActionButton(followUpRow, title, 'edit').click();
    const dialog = adminPage.getByRole('dialog');
    await selectFromSearchable(adminPage, dialog.locator('#follow-up-owner'), fullName(world.users.buero));
    await dialog.getByRole('button', { name: SHARED_COPY.action.save, exact: true }).click();
    await expect(dialog).toHaveCount(0, { timeout: 15_000 });

    await openAufgaben(adminPage);
    await expectGone(followUpTaskLink(adminPage, title, customer), {
      timeout: 15_000,
    });
    await openAufgaben(bueroPage);
    await expect(followUpTaskLink(bueroPage, title, customer)).toHaveCount(1, {
      timeout: 15_000,
    });
    await openSeededCustomerDetail(bueroPage, clientId);
    await completeFollowUpOnCustomerDetail(bueroPage, title);

    const relationship = await getCustomerRelationshipState(world.orgId, customer);
    expect(relationship.followUps.find((followUp) => followUp.title === title)).toMatchObject({
      status: 'completed',
      ownerUserId: world.users.buero.id,
      completedBy: world.users.buero.id,
    });
    expect(relationship.followUpEventTypes).toEqual(['created', 'reassigned', 'completed']);
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

    const { clientId } = await seedCustomer({
      orgId: world.orgId,
      actorId: world.users.admin.id,
      name: customer,
      contacts: [{ name: contact, phone: '+49 30 660001' }],
      sites: [{ name: site, city: 'Berlin' }],
    });
    await seedJob({
      orgId: world.orgId,
      actorId: world.users.admin.id,
      jobNumber,
      title: jobTitle,
      clientId,
    });
    await seedProject({
      orgId: world.orgId,
      actorId: world.users.admin.id,
      projectNumber,
      name: projectTitle,
      clientId,
    });
    await seedRequest({
      orgId: world.orgId,
      actorId: world.users.admin.id,
      summary: requestSummary,
      requestNumber,
      clientId,
      eventTypes: ['status_changed'],
    });
    await openSeededCustomerDetail(adminPage, clientId);

    const timeline = customerTimeline(adminPage.getByRole('main'));
    for (const [event, reference] of [
      ['requestReceived', requestSummary],
      ['requestUpdated', requestNumber],
      ['jobCreated', jobTitle],
      ['projectCreated', projectTitle],
    ] as const) {
      const row = newestCustomerTimelineRow(adminPage, event, reference);
      await expect(row).toContainText(actor);
      await expect(timelineSourceLinks(row)).toHaveCount(1);
    }

    const dueAt = `${berlinDateAtOffset(2)}T10:00`;
    const sources = [
      ['contact', contact, contact],
      ['site', site, site],
      ['request', requestSummary, requestNumber],
      ['job', jobTitle, jobNumber],
      ['project', projectTitle, projectNumber],
    ] as const;
    for (const [sourceType, sourceText, sourceLabel] of sources) {
      await createFollowUpFromTimeline(adminPage, {
        sourceText,
        sourceLabel,
        title: `A2 Quelle ${sourceType} ${world.runId}`,
        dueAtLocal: dueAt,
      });
    }
    await followUpActionButton(adminPage, `A2 Quelle contact ${world.runId}`, 'complete').click();
    await expect(visibleText(adminPage, CUSTOMER_TEXT.followUpCompleted)).toBeVisible();
    await followUpActionButton(adminPage, `A2 Quelle site ${world.runId}`, 'cancel').click();
    await expect(visibleText(adminPage, CUSTOMER_TEXT.followUpCancelled)).toBeVisible();

    await customerTimelineFilter(adminPage, 'internal').click();
    await expect(timeline.getByText(contact)).toBeVisible();
    await expect(timeline.getByText(site)).toBeVisible();
    const followUpEventRow = newestCustomerTimelineRow(adminPage, 'followUpChanged');
    await expect(followUpEventRow).toContainText(actor);

    const relationship = await getCustomerRelationshipState(world.orgId, customer);
    expect(
      relationship.followUps
        .filter((followUp) => followUp.title.startsWith('A2 Quelle'))
        .map((followUp) => followUp.sourceType)
        .sort(),
    ).toEqual(['contact', 'job', 'project', 'request', 'site']);
    expect(relationship.followUps.find((followUp) => followUp.title.includes('contact'))).toMatchObject({
      status: 'completed',
      completedBy: world.users.admin.id,
    });
    expect(relationship.followUps.find((followUp) => followUp.title.includes('site'))).toMatchObject({
      status: 'cancelled',
      cancelledBy: world.users.admin.id,
    });
  });

  test('A2-R06: Kommunikationspräferenzen sind vollständig automatisiert und E-Mail-Ausnahmen nachvollziehbar', async ({
    adminPage,
    world,
  }) => {
    const customer = `A2 Präferenzkunde ${world.runId}`;
    const contact = `A2 Präferenzkontakt ${world.runId}`;
    const email = `praeferenz-${world.runId}@example.test`;
    const doNotContactInstruction = testData`Nur nach interner Freigabe kontaktieren.`;
    const contactTimeNote = testData`Werktags 08:00–11:00 Uhr`;
    const languageNote = testData`Deutsch`;
    const accessibilityNote = testData`Bitte langsam und deutlich sprechen`;

    const { clientId } = await seedCustomer({
      orgId: world.orgId,
      actorId: world.users.admin.id,
      name: customer,
      contacts: [{ name: contact, email }],
    });
    await openSeededCustomerDetail(adminPage, clientId);
    await expect(visibleText(adminPage, CUSTOMER_TEXT.communicationNotConfigured)).toBeVisible();
    await configureCustomerCommunicationSettings(adminPage, {
      preferredContactName: contact,
      preferredChannel: 'email',
      doNotContactInstruction,
      contactTimeNote,
      languageNote,
      accessibilityNote,
      sourceNote: 'A2 Kundengespräch',
    });
    const section = communicationPreferencesRegion(adminPage);
    await expect(section).toContainText(CHANNEL_LABELS.email);
    await expect(section).toContainText(contactTimeNote);
    await expect(section).toContainText(languageNote);
    await expect(section).toContainText(accessibilityNote);
    await expect(section).toContainText(CUSTOMER_TEXT.communicationNoMessagesSent);
    await expect(section).toContainText(CUSTOMER_TEXT.communicationDisclaimer);

    await addPreferenceButton(adminPage).click();
    const dialog = adminPage.getByRole('dialog');
    await expectSelectOptions(adminPage, dialog.locator('#preference-channel'), [
      CHANNEL_LABELS.phone,
      CHANNEL_LABELS.email,
      CHANNEL_LABELS.sms,
      CHANNEL_LABELS.letter,
      CHANNEL_LABELS.in_person,
    ]);
    await expectSelectOptions(adminPage, dialog.locator('#preference-purpose'), [
      PURPOSE_LABELS.appointment_service,
      PURPOSE_LABELS.marketing,
      PURPOSE_LABELS.commercial_required,
    ]);
    await expectSelectOptions(adminPage, dialog.locator('#preference-state'), [
      STATE_LABELS.allowed,
      STATE_LABELS.disallowed,
      STATE_LABELS.unknown,
    ]);
    await dialog.getByRole('button', { name: SHARED_COPY.action.cancel }).click();

    await setCustomerCommunicationPreference(adminPage, {
      channel: 'phone',
      state: 'allowed',
      purpose: 'appointment_service',
    });
    await setCustomerCommunicationPreference(adminPage, {
      contactName: contact,
      channel: 'email',
      state: 'disallowed',
      purpose: 'appointment_service',
      sourceNote: 'E-Mail unerwünscht',
    });
    await setCustomerCommunicationPreference(adminPage, {
      channel: 'sms',
      state: 'unknown',
      purpose: 'marketing',
    });
    await setCustomerCommunicationPreference(adminPage, {
      channel: 'letter',
      state: 'allowed',
      purpose: 'commercial_required',
    });
    await setCustomerCommunicationPreference(adminPage, {
      channel: 'in_person',
      state: 'disallowed',
      purpose: 'marketing',
    });

    // P1-10 proves the reasoned exception it records; this case proves the
    // e-mail warning wording and that an empty reason is refused in place.
    await adminPage.getByRole('link', { name: email, exact: true }).click();
    const warning = adminPage.getByRole('dialog');
    await expect(contactWarningReason(warning, 'doNotContact')).toBeVisible();
    await expect(contactWarningReason(warning, 'channelForbidden')).toBeVisible();
    await expect(contactWarningLegalNote(warning)).toBeVisible();
    const continueButton = contactWarningContinueButton(warning);
    const exceptionReason = warning.locator('#contact-exception-reason');
    await expect(continueButton).toBeEnabled();
    await continueButton.click();
    await expect(warning.getByText(CUSTOMER_TEXT.contactExceptionReasonRequired)).toBeVisible();
    await expect(exceptionReason).toHaveAttribute('aria-invalid', 'true');
    await expect(exceptionReason).toBeFocused();
    await warning.getByRole('button', { name: SHARED_COPY.action.cancel }).click();
    await expect(warning).toHaveCount(0, { timeout: 15_000 });

    const relationship = await getCustomerRelationshipState(world.orgId, customer);
    expect(relationship.communicationSettings).toMatchObject({
      preferredChannel: 'email',
      doNotContactInstruction,
      contactTimeNote,
      languageNote,
      accessibilityNote,
    });
    expect(
      relationship.communicationPreferences.map((preference) => [
        preference.channel,
        preference.purpose,
        preference.state,
      ]),
    ).toEqual([
      ['phone', 'appointment_service', 'allowed'],
      ['email', 'appointment_service', 'disallowed'],
      ['sms', 'marketing', 'unknown'],
      ['letter', 'commercial_required', 'allowed'],
      ['in_person', 'marketing', 'disallowed'],
    ]);
    expect(relationship.preferenceEventTypes).not.toContain('exception_acknowledged');
    await customerTimelineFilter(adminPage, 'internal').click();
    const preferenceTimelineRow = newestCustomerTimelineRow(adminPage, 'preferenceChanged');
    await expect(preferenceTimelineRow).toContainText(fullName(world.users.admin));
    await expect(timelineSourceLinks(preferenceTimelineRow)).toHaveCount(1);
  });
});

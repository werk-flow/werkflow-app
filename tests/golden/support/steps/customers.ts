import { expect, type Locator, type Page } from '@playwright/test';
import {
  CHANNEL_LABELS,
  PURPOSE_LABELS,
  STATE_LABELS,
} from '../../../../components/kunden/communication-preference-labels';
import { CLIENT_TYPE_LABELS, type ClientType } from '../../../../lib/jobs/types';
import type {
  CommunicationChannel,
  CommunicationPreferenceState,
  CommunicationPurpose,
} from '../../../../lib/customer-relationships/types';
import {
  expectBannerAfter,
  expectVisibleAfterSave,
  metadataField,
  selectFromSearchable,
  SHARED_COPY,
  typeIntoDateTimeField,
  visibleText,
} from './shared';

// Reusable business-step helpers. Golden-gate specs compose these steps; when
// a slice changes the UI, update the step here once and every gate follows.

/**
 * Copy of the customer list, the customer dialogs and the customer detail that
 * no pure product module owns (client components hold it). Customer types,
 * communication channels, purposes and states come from their product owners.
 */
const CUSTOMER_COPY = {
  addCustomer: 'Kunde hinzufügen',
  createTitle: 'Neuen Kunden anlegen',
  createSubmit: 'Kunde erstellen',
  created: 'Kunde erfolgreich erstellt!',
  inlineCreate: 'Neuen Kunden erstellen',
  search: 'Kunden durchsuchen',
  detailTitle: 'Kundendetails',
  customerNumber: 'Kundennummer',
  deleteCustomer: 'Kunde löschen',
  addContact: 'Ansprechpartner hinzufügen',
  addPreference: 'Präferenz',
  communicationPreferences: 'Kontaktvorgaben',
  followUpFromTimeline: 'Hierzu nachfassen',
  followUpSourcePrefix: 'Quelle: ',
  continueWithReason: 'Begründet fortfahren',
  contactWarningLegalNote: /WerkFlow entscheidet nicht über die rechtliche Zulässigkeit/,
} as const;

/** The fields of the customer creation dialog, by their labels. */
const CUSTOMER_FORM_FIELDS = {
  name: 'Name *',
  type: 'Typ',
  email: 'E-Mail',
  phone: 'Telefon',
  address: 'Adresse',
  notes: 'Notizen',
} as const;

const FOLLOW_UP_ACTIONS = {
  edit: 'bearbeiten',
  complete: 'erledigen',
  cancel: 'abbrechen',
} as const;

/** Texts of the customer detail that specs assert. */
export const CUSTOMER_TEXT = {
  primaryContact: 'Hauptkontakt',
  /** The badge of the primary site, and the name an adopted customer address gets. */
  primarySite: 'Hauptstandort',
  customerNumberTaken: 'Diese Kundennummer ist bereits vergeben.',
  followUpNeedsReassignment: 'Neu zuweisen',
  followUpCompleted: 'Nachfassaktion erledigt.',
  followUpCancelled: 'Nachfassaktion abgebrochen.',
  communicationNotConfigured: 'Noch nicht konfiguriert',
  communicationNoMessagesSent: 'Es werden keine Nachrichten versendet.',
  communicationDisclaimer:
    'Diese Angaben sind betriebliche Kontaktvorgaben und keine Aussage zur rechtlichen Zulässigkeit.',
  contactExceptionReasonRequired: 'Bitte begründe die Ausnahme.',
} as const;

export function addCustomerButton(page: Page): Locator {
  return page.getByRole('button', { name: CUSTOMER_COPY.addCustomer });
}

/** The heading of the customer creation dialog, from the list or inline from a work form. */
export function customerCreateHeading(page: Page): Locator {
  return page.getByRole('heading', { name: CUSTOMER_COPY.createTitle });
}

export function customerCreateDialog(page: Page): Locator {
  return page.getByRole('dialog').filter({ has: customerCreateHeading(page) });
}

export function customerFormField(scope: Locator, field: keyof typeof CUSTOMER_FORM_FIELDS): Locator {
  return scope.getByLabel(CUSTOMER_FORM_FIELDS[field]);
}

export function customerCreateSubmit(scope: Page | Locator): Locator {
  return scope.getByRole('button', { name: CUSTOMER_COPY.createSubmit });
}

/** The work form's customer picker action that creates a customer inline. */
export function inlineCustomerCreateButton(page: Page): Locator {
  return page.getByRole('button', { name: CUSTOMER_COPY.inlineCreate });
}

export function customerSearchField(page: Page): Locator {
  return page.getByLabel(CUSTOMER_COPY.search);
}

/** The customer detail's title that proves the detail opened. */
export const CUSTOMER_DETAIL_TITLE = CUSTOMER_COPY.detailTitle;

const CUSTOMER_COUNT_NOUN = { one: 'Kunde', many: 'Kunden' } as const;

/** The customer list's result count as it reads: „1 Kunde“ or „2 Kunden“. */
export function customerCountText(count: number): string {
  return `${count} ${count === 1 ? CUSTOMER_COUNT_NOUN.one : CUSTOMER_COUNT_NOUN.many}`;
}

/** The customer list's result count, „1 Kunde“ or „2 Kunden“. */
export function customerCountPattern(count: number): RegExp {
  return new RegExp(`^${count} ${CUSTOMER_COUNT_NOUN.one}(?:n)?$`);
}

/** The visible result count of the customer list, whatever the count; the responsive views duplicate it. */
export function customerCountLabel(page: Page): Locator {
  return page
    .getByText(new RegExp(`^\\d+ ${CUSTOMER_COUNT_NOUN.one}n?$`))
    .filter({ visible: true })
    .first();
}

export function customerDeleteMenuItem(page: Page): Locator {
  return page.getByRole('menuitem', { name: CUSTOMER_COPY.deleteCustomer });
}

export function addContactButton(page: Page): Locator {
  return page.getByRole('button', { name: CUSTOMER_COPY.addContact });
}

/** The customer number row of the „Kundendetails“ card. */
export function customerNumberField(page: Page): Locator {
  const details = page.getByRole('region', { name: CUSTOMER_COPY.detailTitle, exact: true });
  return metadataField(details, CUSTOMER_COPY.customerNumber);
}

/** Edits the customer number inline and saves it; the caller asserts the outcome. */
export async function setCustomerNumber(page: Page, value: string): Promise<void> {
  const row = customerNumberField(page);
  await row.getByRole('button', { name: `${CUSTOMER_COPY.customerNumber} bearbeiten` }).click();
  await row.getByRole('textbox').fill(value);
  await row.getByRole('button', { name: SHARED_COPY.action.save, exact: true }).click();
}

/** The „Kontaktvorgaben“ section of the customer detail. */
export function communicationPreferencesRegion(page: Page): Locator {
  return page.getByRole('region', { name: CUSTOMER_COPY.communicationPreferences });
}

/** Opens the dialog that adds one communication preference. */
export function addPreferenceButton(page: Page): Locator {
  return page.getByRole('button', { name: CUSTOMER_COPY.addPreference, exact: true });
}

/** A follow-up's edit, complete or cancel button; its name carries the title. */
export function followUpActionButton(
  scope: Page | Locator,
  title: string,
  action: keyof typeof FOLLOW_UP_ACTIONS,
): Locator {
  return scope.getByRole('button', {
    name: `Nachfassaktion ${title} ${FOLLOW_UP_ACTIONS[action]}`,
    exact: true,
  });
}

/** The follow-up row that offers editing this follow-up. */
export function editableFollowUpRow(page: Page, title: string): Locator {
  return page.locator('[data-follow-up-id]').filter({ has: followUpActionButton(page, title, 'edit') });
}

/** The contact warning's button that continues with a reason. */
export function contactWarningContinueButton(dialog: Locator): Locator {
  return dialog.getByRole('button', { name: CUSTOMER_COPY.continueWithReason });
}

/** The warning's note that WerkFlow does not decide legal admissibility. */
export function contactWarningLegalNote(dialog: Locator): Locator {
  return dialog.getByText(CUSTOMER_COPY.contactWarningLegalNote);
}

export async function createCustomer(
  page: Page,
  name: string,
  options?: {
    type?: ClientType;
    address?: string;
    beforeSubmit?: () => void | Promise<void>;
    /**
     * The caller already prepared the page on /kunden (for example after
     * waiting for its own Realtime readiness). A fresh navigation would
     * restart that page's load burst inside a measured window.
     */
    navigate?: boolean;
  },
): Promise<void> {
  if (options?.navigate !== false) await page.goto('/kunden');
  await addCustomerButton(page).click();
  await expect(customerCreateHeading(page)).toBeVisible();
  await page.locator('#client-name').fill(name);
  if (options?.type) {
    await page.locator('#client-type').click();
    await page.getByRole('option', { name: CLIENT_TYPE_LABELS[options.type], exact: true }).click();
  }
  if (options?.address) await page.locator('#client-address').fill(options.address);
  await options?.beforeSubmit?.();
  await customerCreateSubmit(page).click();
  await expect(page.getByText(CUSTOMER_COPY.created)).toBeVisible();
  // Dialog closes itself after the success flash.
  await expect(customerCreateHeading(page)).toBeHidden({
    timeout: 10_000,
  });
}

export async function openCustomerDetail(page: Page, customerName: string): Promise<void> {
  await page.goto('/kunden');
  const customerRow = page.locator('tbody tr:visible').filter({ hasText: customerName }).first();
  await expect(customerRow).toBeVisible({ timeout: 15_000 });
  const customerLink = customerRow.getByRole('link', {
    name: customerName,
    exact: true,
  });
  const customerHref = await customerLink.getAttribute('href');
  if (!customerHref?.match(/^\/kunden\/[0-9a-f-]{36}$/)) {
    throw new Error(`openCustomerDetail: invalid customer detail link for ${customerName}`);
  }
  // The customer list can refresh between pointer-down and navigation. Use
  // the verified semantic link target for one deterministic read-only goto.
  await page.goto(customerHref);
  await page.waitForURL(/\/kunden\/[0-9a-f-]{36}$/, { timeout: 15_000 });
  await expect(visibleText(page, CUSTOMER_COPY.detailTitle)).toBeVisible({
    timeout: 15_000,
  });
}

/** Opens the detail page of a customer whose id the test seeded. */
export async function openSeededCustomerDetail(page: Page, clientId: string): Promise<void> {
  await page.goto(`/kunden/${clientId}`);
  await expect(visibleText(page, CUSTOMER_COPY.detailTitle)).toBeVisible({
    timeout: 15_000,
  });
}

export async function addContactOnCustomerDetail(
  page: Page,
  contact: {
    name: string;
    role?: string;
    phone?: string;
    email?: string;
    notes?: string;
    isPrimary?: boolean;
  },
): Promise<void> {
  await addContactButton(page).click();
  await expect(page.getByRole('heading', { name: CUSTOMER_COPY.addContact })).toBeVisible();
  await page.locator('#contact-name').fill(contact.name);
  if (contact.role) await page.locator('#contact-role').fill(contact.role);
  if (contact.phone) await page.locator('#contact-phone').fill(contact.phone);
  if (contact.email) await page.locator('#contact-email').fill(contact.email);
  if (contact.notes) await page.locator('#contact-notes').fill(contact.notes);
  if (contact.isPrimary) {
    const checkbox = page.getByRole('checkbox', {
      name: 'Als Hauptkontakt festlegen',
    });
    if (!(await checkbox.isChecked())) await checkbox.click();
  }
  // The dialog closes and the row shows with the click; the banner confirms
  // the write, and a refusal reopens the dialog instead.
  await expectBannerAfter(page, 'Ansprechpartner gespeichert.', () =>
    page.getByRole('dialog').getByRole('button', { name: SHARED_COPY.action.save }).click(),
  );
  await expect(page.getByRole('dialog')).toHaveCount(0, { timeout: 15_000 });
  await expectVisibleAfterSave(page, contact.name);
}

// P1-10: customer relationship timeline, manual follow-ups, and communication
// guidance. These helpers keep Radix interaction details out of the spec.
export async function createFollowUpOnCustomerDetail(
  page: Page,
  input: {
    title: string;
    dueAtLocal: string;
    ownerName?: string;
    note?: string;
    beforeSubmit?: () => void | Promise<void>;
  },
): Promise<void> {
  await page.getByRole('button', { name: 'Nachfassaktion anlegen', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('heading', { name: 'Nachfassaktion anlegen' })).toBeVisible();
  await dialog.locator('#follow-up-title').fill(input.title);
  await typeIntoDateTimeField(dialog, 'follow-up-due', input.dueAtLocal);
  if (input.note) await dialog.locator('#follow-up-note').fill(input.note);
  if (input.ownerName) {
    await selectFromSearchable(page, dialog.locator('#follow-up-owner'), input.ownerName);
  }
  await input.beforeSubmit?.();
  await dialog.getByRole('button', { name: SHARED_COPY.action.save, exact: true }).click();
  await expect(dialog).toHaveCount(0, { timeout: 15_000 });
  await expectVisibleAfterSave(page, input.title);
}

/**
 * Creates a follow-up from the timeline entry that names the source record.
 * The dialog must name the source before the title and due date are filled.
 */
export async function createFollowUpFromTimeline(
  page: Page,
  input: { sourceText: string; sourceLabel: string; title: string; dueAtLocal: string },
): Promise<void> {
  const followUpButton = page.getByRole('button', { name: CUSTOMER_COPY.followUpFromTimeline });
  const sourceRow = customerTimelineEntries(customerTimeline(page.getByRole('main')))
    .filter({ hasText: input.sourceText })
    .filter({ has: followUpButton });
  await sourceRow.getByRole('button', { name: CUSTOMER_COPY.followUpFromTimeline }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText(`${CUSTOMER_COPY.followUpSourcePrefix}${input.sourceLabel}`);
  await dialog.locator('#follow-up-title').fill(input.title);
  await typeIntoDateTimeField(dialog, 'follow-up-due', input.dueAtLocal);
  await dialog.getByRole('button', { name: SHARED_COPY.action.save, exact: true }).click();
  await expect(dialog).toHaveCount(0, { timeout: 15_000 });
  await expect(visibleText(page, input.title)).toBeVisible({ timeout: 15_000 });
}

export async function completeFollowUpOnCustomerDetail(page: Page, title: string): Promise<void> {
  await followUpActionButton(page, title, 'complete').click();
  await expect(page.getByText(CUSTOMER_TEXT.followUpCompleted)).toBeVisible({
    timeout: 15_000,
  });
}

export async function configureCustomerCommunicationSettings(
  page: Page,
  input: {
    preferredContactName?: string;
    preferredChannel?: CommunicationChannel;
    doNotContactInstruction?: string;
    contactTimeNote?: string;
    languageNote?: string;
    accessibilityNote?: string;
    sourceNote?: string;
  },
): Promise<void> {
  await page.getByRole('button', { name: 'Allgemein bearbeiten' }).click();
  const dialog = page.getByRole('dialog');
  if (input.preferredContactName) {
    await selectFromSearchable(page, dialog.locator('#preferred-contact'), input.preferredContactName);
  }
  if (input.preferredChannel) {
    await dialog.locator('#preferred-channel').click();
    await page.getByRole('option', { name: CHANNEL_LABELS[input.preferredChannel], exact: true }).click();
  }
  if (input.doNotContactInstruction) {
    await dialog.locator('#dnc-note').fill(input.doNotContactInstruction);
  }
  if (input.contactTimeNote) {
    await dialog.locator('#contact-time').fill(input.contactTimeNote);
  }
  if (input.languageNote) {
    await dialog.locator('#language-note').fill(input.languageNote);
  }
  if (input.accessibilityNote) {
    await dialog.locator('#accessibility-note').fill(input.accessibilityNote);
  }
  if (input.sourceNote) {
    await dialog.locator('#settings-source').fill(input.sourceNote);
  }
  await dialog.getByRole('button', { name: SHARED_COPY.action.save, exact: true }).click();
  await expect(dialog).toHaveCount(0, { timeout: 15_000 });
  if (input.preferredContactName) {
    const communicationSection = page.locator('section[aria-labelledby="communication-heading"]');
    const preferredContactEntry = communicationSection
      .locator('dl > div')
      .filter({ hasText: 'Bevorzugter Kontakt' });
    await expect(preferredContactEntry).toContainText(input.preferredContactName);
  }
}

export async function setCustomerCommunicationPreference(
  page: Page,
  input: {
    contactName?: string;
    channel: CommunicationChannel;
    state: CommunicationPreferenceState;
    purpose?: CommunicationPurpose;
    sourceNote?: string;
  },
): Promise<void> {
  await addPreferenceButton(page).click();
  const dialog = page.getByRole('dialog');
  if (input.contactName) {
    await selectFromSearchable(page, dialog.locator('#preference-contact'), input.contactName);
  }
  await dialog.locator('#preference-channel').click();
  await page.getByRole('option', { name: CHANNEL_LABELS[input.channel], exact: true }).click();
  await dialog.locator('#preference-state').click();
  await page.getByRole('option', { name: STATE_LABELS[input.state], exact: true }).click();
  if (input.purpose) {
    await dialog.locator('#preference-purpose').click();
    await page.getByRole('option', { name: PURPOSE_LABELS[input.purpose], exact: true }).click();
  }
  if (input.sourceNote) {
    await dialog.locator('#preference-source').fill(input.sourceNote);
  }
  await dialog.getByRole('button', { name: SHARED_COPY.action.save, exact: true }).click();
  await expect(dialog).toHaveCount(0, { timeout: 15_000 });
}

export async function proceedThroughContactWarning(
  page: Page,
  contactHrefText: string,
  reason: string,
): Promise<void> {
  await page.getByRole('link', { name: contactHrefText, exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('heading', { name: 'Kontaktvorgabe prüfen' })).toBeVisible();
  await dialog.locator('#contact-exception-reason').fill(reason);
  // Chromium keeps the page open when no external tel:/mailto: handler is
  // registered; the database assertion proves the exception write.
  await contactWarningContinueButton(dialog).click();
}

export async function addSiteOnCustomerDetail(
  page: Page,
  site: {
    name: string;
    street?: string;
    postalCode?: string;
    city?: string;
    accessNotes?: string;
    notes?: string;
    primaryContactName?: string;
    isPrimary?: boolean;
  },
): Promise<void> {
  await page.getByRole('button', { name: 'Einsatzort hinzufügen' }).click();
  await expect(page.getByRole('heading', { name: 'Einsatzort hinzufügen' })).toBeVisible();
  await page.locator('#site-name').fill(site.name);
  if (site.street) await page.locator('#site-street').fill(site.street);
  if (site.postalCode) await page.locator('#site-postal-code').fill(site.postalCode);
  if (site.city) await page.locator('#site-city').fill(site.city);
  if (site.accessNotes) await page.locator('#site-access-notes').fill(site.accessNotes);
  if (site.notes) await page.locator('#site-notes').fill(site.notes);
  if (site.primaryContactName) {
    await selectFromSearchable(page, page.locator('#site-primary-contact'), site.primaryContactName);
  }
  if (site.isPrimary) {
    const checkbox = page.getByRole('checkbox', {
      name: 'Als Hauptstandort festlegen',
    });
    if (!(await checkbox.isChecked())) await checkbox.click();
  }
  // The dialog closes and the row shows with the click; the banner confirms
  // the write, and a refusal reopens the dialog instead.
  await expectBannerAfter(page, 'Einsatzort gespeichert.', () =>
    page.getByRole('dialog').getByRole('button', { name: SHARED_COPY.action.save }).click(),
  );
  await expect(page.getByRole('dialog')).toHaveCount(0, { timeout: 15_000 });
  await expectVisibleAfterSave(page, site.name);
}

/** The customer's relations as their row actions name them („Ansprechpartner archivieren“). */
const CUSTOMER_RELATION_NAMES = { contact: 'Ansprechpartner', site: 'Einsatzort' } as const;

export async function archiveCustomerRelation(
  page: Page,
  relation: keyof typeof CUSTOMER_RELATION_NAMES,
  name: string,
): Promise<void> {
  const kind = CUSTOMER_RELATION_NAMES[relation];
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const row = page
    .locator('li')
    .filter({ has: page.getByRole('button', { name: `${kind} archivieren` }) })
    .filter({
      has: page.locator('p').filter({ hasText: new RegExp(`^${escapedName}$`) }),
    })
    .filter({ visible: true })
    .first();
  await row.getByRole('button', { name: `${kind} archivieren` }).click();
  const archivedRow = page
    .locator('li')
    .filter({
      has: page.getByRole('button', { name: `${kind} wiederherstellen` }),
    })
    .filter({ hasText: name })
    .filter({ visible: true });
  await expect(archivedRow).toHaveCount(1, {
    timeout: 15_000,
  });
  // The row moves with the click and stays disabled until the refreshed
  // relations arrive; a refusal moves it back.
  await expect(archivedRow.getByRole('button', { name: `${kind} wiederherstellen` })).toBeEnabled({
    timeout: 15_000,
  });
}

export async function restoreCustomerRelation(
  page: Page,
  relation: keyof typeof CUSTOMER_RELATION_NAMES,
  name: string,
): Promise<void> {
  const kind = CUSTOMER_RELATION_NAMES[relation];
  const row = page
    .locator('li')
    .filter({
      has: page.getByRole('button', { name: `${kind} wiederherstellen` }),
    })
    .filter({ hasText: name })
    .filter({ visible: true })
    .first();
  await row.getByRole('button', { name: `${kind} wiederherstellen` }).click();
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const activeRow = () =>
    page
      .locator('li')
      .filter({
        has: page.getByRole('button', { name: `${kind} archivieren` }),
      })
      .filter({
        has: page.locator('p').filter({ hasText: new RegExp(`^${escapedName}$`) }),
      })
      .filter({ visible: true })
      .first();
  // Enabled, not only visible: the row moves with the click and stays
  // disabled until the refreshed relations arrive.
  await expect(activeRow().getByRole('button', { name: `${kind} archivieren` })).toBeEnabled({
    timeout: 15_000,
  });
}

export async function adoptCustomerAddressAsSite(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Adresse als Einsatzort übernehmen' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('heading', { name: 'Einsatzort hinzufügen' })).toBeVisible();
  await expectBannerAfter(page, 'Einsatzort gespeichert.', () =>
    dialog.getByRole('button', { name: SHARED_COPY.action.save, exact: true }).click(),
  );
  await expect(dialog).toHaveCount(0, { timeout: 15_000 });
  await expectVisibleAfterSave(page, CUSTOMER_TEXT.primarySite);
}

export async function editSiteStreetOnCustomerDetail(
  page: Page,
  siteName: string,
  newStreet: string,
): Promise<void> {
  const siteRow = page.locator('li').filter({ hasText: siteName }).filter({ visible: true }).first();
  await siteRow.getByRole('button', { name: 'Einsatzort bearbeiten' }).click();
  await expect(page.getByRole('heading', { name: 'Einsatzort bearbeiten' })).toBeVisible();
  await page.locator('#site-street').fill(newStreet);
  // The dialog closes and the row shows with the click; the banner confirms
  // the write, and a refusal reopens the dialog instead.
  await expectBannerAfter(page, 'Einsatzort gespeichert.', () =>
    page.getByRole('dialog').getByRole('button', { name: SHARED_COPY.action.save }).click(),
  );
  await expect(page.getByRole('dialog')).toHaveCount(0, { timeout: 15_000 });
  await expectVisibleAfterSave(page, newStreet);
}

export async function searchCustomers(page: Page, query: string): Promise<void> {
  await page.goto('/kunden');
  await customerSearchField(page).fill(query);
}

// ---------------------------------------------------------------------------
// P1-10: the relationship timeline, the follow-up section and the contact
// warning on the customer detail.

const TIMELINE_FACTS = {
  customerCreated: 'Kunde angelegt',
  contactCreated: 'Ansprechpartner angelegt',
  siteCreated: 'Einsatzort angelegt',
} as const;

const TIMELINE_FILTERS = { work: 'Arbeit', documents: 'Dokumente', internal: 'Intern' } as const;

const CONTACT_WARNING_REASONS = {
  doNotContact: /Nicht-kontaktieren-Hinweis/,
  otherContact: /anderer Ansprechpartner/,
  channelForbidden: /Kontaktweg.*nicht erlaubt/,
} as const;

const TIMELINE_COPY = { sourceLink: 'Quelle öffnen', followUps: 'Nachfassaktionen' } as const;

/** The customer's relationship timeline inside its owner (`main`). */
export function customerTimeline(scope: Locator): Locator {
  return scope.getByTestId('customer-timeline');
}

/** A fact the timeline records for the customer itself. */
export function customerTimelineFact(timeline: Locator, fact: keyof typeof TIMELINE_FACTS): Locator {
  return timeline.getByText(TIMELINE_FACTS[fact]);
}

/** Every timeline entry, each carrying its deduplication key. */
export function customerTimelineEntries(timeline: Locator): Locator {
  return timeline.locator('[data-timeline-key]');
}

/** The timeline entry that names this record. */
export function customerTimelineEntry(timeline: Locator, text: string): Locator {
  return customerTimelineEntries(timeline).filter({ hasText: text });
}

/** The source links of the timeline or of one entry. */
export function timelineSourceLinks(scope: Locator): Locator {
  return scope.getByRole('link', { name: TIMELINE_COPY.sourceLink });
}

/** A timeline filter button. */
export function customerTimelineFilter(page: Page, filter: keyof typeof TIMELINE_FILTERS): Locator {
  return page.getByRole('button', { name: TIMELINE_FILTERS[filter], exact: true });
}

/** A follow-up row in the customer's Nachfassaktionen section. */
export function followUpRow(page: Page, title: string): Locator {
  return page
    .getByRole('region', { name: TIMELINE_COPY.followUps })
    .locator('[data-follow-up-id]')
    .filter({ hasText: title });
}

/** The visible „Nicht erlaubt“ state of a communication preference. */
export function forbiddenPreferenceState(page: Page): Locator {
  return visibleText(page, STATE_LABELS.disallowed);
}

/** One reason the contact warning dialog names before a contact. */
export function contactWarningReason(dialog: Locator, reason: keyof typeof CONTACT_WARNING_REASONS): Locator {
  return dialog.getByText(CONTACT_WARNING_REASONS[reason]);
}

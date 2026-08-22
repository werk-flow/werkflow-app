import { expect, type Locator, type Page } from '@playwright/test';

// Pages often render the same text twice (desktop table + hidden mobile card);
// assertions must target the visible instance.
export function visibleText(page: Page, text: string): Locator {
  return page.getByText(text).filter({ visible: true }).first();
}

// Reusable business-step helpers. Golden-gate specs compose these steps; when
// a slice changes the UI, update the step here once and every gate follows.

export async function createCustomer(
  page: Page,
  name: string,
  options?: { type?: 'Privat' | 'Gewerblich'; address?: string }
): Promise<void> {
  await page.goto('/kunden');
  await page.getByRole('button', { name: 'Kunde hinzufügen' }).click();
  await expect(page.getByRole('heading', { name: 'Neuen Kunden anlegen' })).toBeVisible();
  await page.locator('#client-name').fill(name);
  if (options?.type) {
    await page.locator('#client-type').click();
    await page.getByRole('option', { name: options.type, exact: true }).click();
  }
  if (options?.address) await page.locator('#client-address').fill(options.address);
  await page.getByRole('button', { name: 'Kunde erstellen' }).click();
  await expect(page.getByText('Kunde erfolgreich erstellt!')).toBeVisible();
  // Dialog closes itself after the success flash.
  await expect(page.getByRole('heading', { name: 'Neuen Kunden anlegen' })).toBeHidden({
    timeout: 10_000,
  });
}

export async function createJob(
  page: Page,
  options: {
    jobNumber: string;
    title: string;
    assignEmployeeName?: string;
    // P1-01: pick the customer and its site/contact through the dialog.
    clientName?: string;
    projectNumber?: string;
    siteName?: string;
    contactName?: string;
    expectedInheritedSiteName?: string;
    expectedInheritedContactName?: string;
    qualificationOverrideReason?: string;
    plannedDateDigits?: string;
  }
): Promise<void> {
  await page.goto('/auftraege');
  await page.getByRole('button', { name: 'Erstellen', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Neuen Auftrag oder Projekt erstellen' })
  ).toBeVisible();
  await page.getByRole('tab', { name: 'Auftrag erstellen' }).click();

  await page.locator('#job-number').fill(options.jobNumber);
  await page.locator('#job-title').fill(options.title);

  if (options.plannedDateDigits) {
    await typeIntoDatePicker(
      page.getByRole('dialog'),
      'Datum',
      options.plannedDateDigits
    );
  }

  if (options.clientName) {
    // The customer picker is a searchable combobox showing "Kein Kunde".
    await page.getByRole('combobox').filter({ hasText: 'Kein Kunde' }).click();
    await page.getByPlaceholder('Kunde suchen...').fill(options.clientName);
    await page
      .getByRole('listbox')
      .getByRole('button')
      .filter({ hasText: options.clientName })
      .first()
      .click();
  }

  if ((options.siteName || options.contactName) && !options.clientName) {
    throw new Error('createJob: siteName/contactName require clientName');
  }

  if (options.projectNumber) {
    await page.getByRole('combobox').filter({ hasText: 'Kein Projekt' }).click();
    await page.getByPlaceholder('Projekt suchen...').fill(options.projectNumber);
    const projectOption = page
      .getByRole('listbox')
      .getByRole('button')
      .filter({ hasText: `${options.projectNumber} –` });
    await expect(projectOption).toHaveCount(1, { timeout: 15_000 });
    await projectOption.click();
    if (options.expectedInheritedSiteName) {
      await expect(page.locator('#job-site')).toContainText(
        options.expectedInheritedSiteName,
        { timeout: 15_000 }
      );
    }
    if (options.expectedInheritedContactName) {
      await expect(page.locator('#job-contact')).toContainText(
        options.expectedInheritedContactName,
        { timeout: 15_000 }
      );
    }
  }

  if (options.siteName) {
    // The site picker appears once the customer's sites finished loading.
    await expect(page.locator('#job-site')).toBeEnabled({ timeout: 15_000 });
    await selectFromSearchable(page, page.locator('#job-site'), options.siteName);
  }

  if (options.contactName) {
    await expect(page.locator('#job-contact')).toBeEnabled({ timeout: 15_000 });
    await selectFromSearchable(page, page.locator('#job-contact'), options.contactName);
  }

  if (options.assignEmployeeName) {
    // The employee picker renders as a combobox showing its placeholder text.
    await page.getByRole('combobox').filter({ hasText: 'Mitarbeiter zuweisen' }).click();
    await page.getByPlaceholder('Mitarbeiter suchen...').fill(options.assignEmployeeName);
    // Options render as buttons inside the picker's listbox.
    await page
      .getByRole('listbox')
      .getByRole('button')
      .filter({ hasText: options.assignEmployeeName })
      .first()
      .click();
    // Dismiss the picker by clicking elsewhere in the dialog; Escape would
    // close the whole creation dialog.
    await page
      .getByRole('heading', { name: 'Neuen Auftrag oder Projekt erstellen' })
      .click();
    await expect(page.getByPlaceholder('Mitarbeiter suchen...')).toBeHidden();
  }

  await page.getByRole('button', { name: 'Auftrag erstellen', exact: true }).click();
  if (options.qualificationOverrideReason) {
    const warningDialog = page
      .getByRole('dialog')
      .filter({ has: page.getByRole('heading', { name: 'Zuweisung prüfen' }) });
    await expect(warningDialog).toBeVisible({ timeout: 15_000 });
    await warningDialog
      .locator('#qualification-override-reason')
      .fill(options.qualificationOverrideReason);
    await warningDialog
      .getByRole('button', { name: 'Trotz Hinweis zuweisen' })
      .click();
    await expect(warningDialog).toHaveCount(0, { timeout: 15_000 });
  }
  // The dialog closes on success; the caller asserts the job row afterwards.
  await expect(
    page.getByRole('heading', { name: 'Neuen Auftrag oder Projekt erstellen' })
  ).toBeHidden({ timeout: 15_000 });
}

export async function createProject(
  page: Page,
  options: {
    projectNumber: string;
    title: string;
    clientName?: string;
    siteName?: string;
    contactName?: string;
  }
): Promise<void> {
  if ((options.siteName || options.contactName) && !options.clientName) {
    throw new Error('createProject: siteName/contactName require clientName');
  }
  await page.goto('/auftraege');
  await page.getByRole('button', { name: 'Erstellen', exact: true }).click();
  const dialog = page
    .getByRole('dialog')
    .filter({ has: page.getByRole('heading', { name: 'Neuen Auftrag oder Projekt erstellen' }) });
  await dialog.getByRole('tab', { name: 'Projekt erstellen' }).click();
  const projectNumberInput = dialog.locator('#create-project-number');
  await expect(projectNumberInput).not.toHaveValue('', { timeout: 15_000 });
  await projectNumberInput.fill(options.projectNumber);
  await dialog.locator('#create-project-name').fill(options.title);
  if (options.clientName) {
    await dialog.getByRole('combobox').filter({ hasText: 'Kein Kunde' }).click();
    await page.getByPlaceholder('Kunde suchen...').fill(options.clientName);
    await page
      .getByRole('listbox')
      .getByRole('button')
      .filter({ hasText: options.clientName })
      .first()
      .click();
  }
  if (options.siteName) {
    await expect(dialog.locator('#create-project-site')).toBeVisible({ timeout: 15_000 });
    await selectFromSearchable(
      page,
      dialog.locator('#create-project-site'),
      options.siteName
    );
  }
  if (options.contactName) {
    await expect(dialog.locator('#create-project-contact')).toBeVisible({ timeout: 15_000 });
    await selectFromSearchable(
      page,
      dialog.locator('#create-project-contact'),
      options.contactName
    );
  }
  await dialog.getByRole('button', { name: 'Projekt erstellen', exact: true }).click();
  await expect(dialog).toHaveCount(0, { timeout: 15_000 });
}

// Uploads into the "Dokumente & Bilder" section of the page currently open.
// Shared by the job-page and request-page upload steps.
async function uploadIntoDocumentsSection(
  page: Page,
  filePath: string,
  expectedFileName: string
): Promise<void> {
  await expect(page.getByText('Dokumente & Bilder')).toBeVisible();

  const section = page
    .locator('section, div')
    .filter({ has: page.getByText('Dokumente & Bilder') });
  await section.locator('input[type="file"]').first().setInputFiles(filePath);

  // Direct-to-R2 upload dialog: wait for completion and require actual success —
  // "abgeschlossen" alone also counts failed files.
  await expect(page.getByText('1 von 1 abgeschlossen')).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText('Upload fehlgeschlagen.')).toHaveCount(0);

  const closeButton = page.getByRole('button', { name: 'Schließen' });
  if (await closeButton.isVisible().catch(() => false)) {
    await closeButton.click();
  }
  // Dialog must be gone before asserting, so the file name match can only come
  // from the documents section itself, not from the dialog's row list.
  await expect(page.getByRole('dialog')).toHaveCount(0, { timeout: 10_000 });

  await expect(visibleText(page, expectedFileName)).toBeVisible({ timeout: 15_000 });
}

export async function uploadDocumentOnJobPage(
  page: Page,
  jobNumber: string,
  filePath: string,
  expectedFileName: string
): Promise<void> {
  await page.goto(`/auftraege/${jobNumber}`);
  await uploadIntoDocumentsSection(page, filePath, expectedFileName);
}

export async function clockInOnJob(page: Page, jobTitle?: string): Promise<void> {
  await page.goto('/dashboard');
  // The clock control is a floating action button named via its title attribute.
  await page.locator('button[title="Einstempeln"]').click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('heading', { name: 'Einstempeln' })).toBeVisible();

  if (jobTitle) {
    await selectFromSearchable(
      page,
      dialog.locator('#job-picker-job'),
      jobTitle
    );
  }

  await dialog.getByRole('button', { name: 'Einstempeln', exact: true }).click();
  await expect(page.locator('button[title="Ausstempeln"]')).toBeVisible({ timeout: 15_000 });
}

export async function clockOut(page: Page): Promise<void> {
  await page.locator('button[title="Ausstempeln"]').click();
  await expect(page.locator('button[title="Einstempeln"]')).toBeVisible({ timeout: 15_000 });
}

export async function startClockBreak(page: Page): Promise<void> {
  await page.locator('button[title="Pause starten"]').click();
  await expect(page.locator('button[title="Arbeit fortsetzen"]')).toBeVisible({
    timeout: 15_000,
  });
}

export async function endClockBreak(page: Page, jobTitle?: string): Promise<void> {
  await page.locator('button[title="Arbeit fortsetzen"]').click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('heading', { name: 'Arbeit fortsetzen' })).toBeVisible();
  if (jobTitle) {
    await selectFromSearchable(
      page,
      dialog.locator('#job-picker-job'),
      jobTitle
    );
  }
  // Without a job the picker keeps its default „Ohne Auftrag" selection.
  await dialog.getByRole('button', { name: 'Fortsetzen', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Arbeit fortsetzen' })).toBeHidden({
    timeout: 15_000,
  });
  await expect(page.locator('button[title="Pause starten"]')).toBeVisible({
    timeout: 15_000,
  });
}

export async function switchClockJob(page: Page, jobTitle: string): Promise<void> {
  await page.locator('button[title="Auftrag wechseln"]').click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('heading', { name: 'Auftrag wechseln' })).toBeVisible();
  await selectFromSearchable(page, dialog.locator('#job-picker-job'), jobTitle);
  await dialog.getByRole('button', { name: 'Wechseln', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Auftrag wechseln' })).toBeHidden({
    timeout: 15_000,
  });
}

export async function createInventoryLocation(
  page: Page,
  name: string
): Promise<void> {
  await page.goto('/inventar');
  await page.getByRole('button', { name: 'Lager', exact: true }).click();
  const dialog = page
    .getByRole('dialog')
    .filter({ has: page.getByRole('heading', { name: 'Lager anlegen' }) });
  await dialog.locator('#inventory-location-name').fill(name);
  await dialog.getByRole('button', { name: 'Speichern' }).click();
  await expect(dialog).toHaveCount(0, { timeout: 15_000 });
}

export async function createInventoryItem(
  page: Page,
  options: {
    name: string;
    locationName?: string;
    initialQuantity?: number;
    supplierName?: string;
  }
): Promise<void> {
  if (options.initialQuantity !== undefined) {
    if (!options.locationName) {
      throw new Error(
        'createInventoryItem: initialQuantity requires a locationName'
      );
    }
    if (!Number.isFinite(options.initialQuantity)) {
      throw new Error('createInventoryItem: initialQuantity must be finite');
    }
  }

  await page.goto('/inventar');
  await page.getByRole('button', { name: 'Artikel', exact: true }).click();
  const dialog = page
    .getByRole('dialog')
    .filter({ has: page.getByRole('heading', { name: 'Artikel anlegen' }) });
  await dialog.locator('#inventory-item-name').fill(options.name);
  if (options.locationName) {
    await dialog.locator('#inventory-item-initial-location').click();
    const locationPicker = page
      .getByRole('dialog')
      .filter({ has: page.getByPlaceholder('Lager suchen...') });
    await locationPicker
      .getByRole('button')
      .filter({ hasText: options.locationName })
      .click();
    await dialog
      .locator('#inventory-item-initial-quantity')
      .fill(String(options.initialQuantity ?? 0));
  }
  if (options.supplierName) {
    // SelectWithCreate: the action row opens a quick-create dialog that stages
    // the new supplier name; the supplier row is created on item save.
    await dialog.locator('#inventory-item-supplier').click();
    await page
      .getByRole('listbox')
      .getByRole('button', { name: 'Neuen Lieferanten anlegen' })
      .click();
    const supplierDialog = page
      .getByRole('dialog')
      .filter({
        has: page.getByRole('heading', { name: 'Neuen Lieferanten anlegen' }),
      });
    await supplierDialog
      .locator('#inventory-new-supplier-name')
      .fill(options.supplierName);
    await supplierDialog.getByRole('button', { name: 'Übernehmen' }).click();
    await expect(supplierDialog).toHaveCount(0, { timeout: 10_000 });
  }
  await dialog.getByRole('button', { name: 'Speichern' }).click();
  await expect(dialog).toHaveCount(0, { timeout: 15_000 });
}

export async function inviteMember(
  page: Page,
  email: string,
  roleLabel: 'Büro' | 'Handwerker/in'
): Promise<void> {
  await page.goto('/mitarbeiter');
  await page.getByRole('button', { name: 'Mitarbeiter hinzufügen' }).click();
  await expect(page.getByRole('heading', { name: 'Mitarbeiter einladen' })).toBeVisible();
  await page.locator('#email').fill(email);
  // Role picker is a Radix select; its options render with role "option".
  await page.locator('#role').click();
  await page.getByRole('option', { name: roleLabel, exact: true }).click();
  await page.getByRole('button', { name: 'Einladung senden' }).click();
  // The invite action inserts the invite and sends the email before reporting
  // success; the dialog closes itself two seconds after the flash.
  await expect(page.getByText('Einladung erfolgreich gesendet!')).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByRole('heading', { name: 'Mitarbeiter einladen' })).toBeHidden({
    timeout: 10_000,
  });
}

// Simulates the invited existing user clicking the email's invite link:
// /auth/callback?invite_code=... bounces to /login, and a successful login
// redeems the invite and lands on /dashboard?joined=<orgId>.
export async function joinOrganizationViaInviteLink(
  page: Page,
  inviteCode: string,
  credentials: { email: string; password: string },
  expectedOrgId: string
): Promise<void> {
  // already_member also counts: it means an earlier (slow) attempt already
  // redeemed the invite before the retry re-opened the link.
  const confirmationUrl = new RegExp(
    `/dashboard\\?(joined|already_member)=${expectedOrgId}`
  );

  let joined = false;
  for (let attempt = 1; attempt <= 3 && !joined; attempt++) {
    // The invite link itself is idempotent: logged-out users bounce to
    // /login?invite_code=..., logged-in users are redeemed server-side and
    // land directly on the dashboard confirmation URL.
    await page.goto(`/auth/callback?invite_code=${inviteCode}`);
    if (confirmationUrl.test(page.url())) {
      joined = true;
      break;
    }
    if (!page.url().includes('/login')) {
      continue;
    }

    // Same pre-hydration caution as the global setup's login helper.
    await page.waitForLoadState('networkidle');
    await page.locator('input[autocomplete="email"]').fill(credentials.email);
    await page.locator('input[autocomplete="current-password"]').fill(credentials.password);
    await page.getByRole('button', { name: 'Anmelden' }).click();
    joined = await page
      .waitForURL(confirmationUrl, { timeout: 30_000 })
      .then(() => true)
      .catch(() => false);
  }
  if (!joined) {
    throw new Error(
      `Invited user ${credentials.email} did not reach /dashboard?joined=${expectedOrgId}`
    );
  }
}

export async function takeMaterialOnJobPage(
  page: Page,
  jobNumber: string,
  itemName: string,
  quantity: number
): Promise<void> {
  await page.goto(`/auftraege/${jobNumber}`);
  await expect(page.getByText('Material & Inventar')).toBeVisible();
  await page.getByRole('button', { name: 'Aus Lager entnehmen' }).click();
  await expect(page.getByRole('heading', { name: 'Entnahme buchen' })).toBeVisible();

  // Pick the item from the search list; a row with quantity 1 appears.
  await page.getByRole('dialog').getByRole('button').filter({ hasText: itemName }).first().click();
  await page.locator('input[id^="material-row-"][id$="-quantity"]').fill(String(quantity));

  // The line rows outside the dialog also carry an "Entnahme buchen" button,
  // so the confirm click must stay scoped to the dialog.
  await page.getByRole('dialog').getByRole('button', { name: 'Entnahme buchen' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0, { timeout: 15_000 });
}

export async function returnMaterialOnJobPage(
  page: Page,
  jobNumber: string,
  quantity: number
): Promise<void> {
  await page.goto(`/auftraege/${jobNumber}`);
  await expect(page.getByText('Material & Inventar')).toBeVisible();
  await page.getByRole('button', { name: 'Zurücklegen' }).first().click();
  await expect(page.getByRole('heading', { name: 'Material zurücklegen' })).toBeVisible();

  await page.locator('input[id^="material-row-"][id$="-quantity"]').fill(String(quantity));
  await page.getByRole('dialog').getByRole('button', { name: 'Zurücklegen' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0, { timeout: 15_000 });
}

// P1-01: customer contact and work-site management on the customer detail.

// The customer detail refreshes itself after each save, but under suite load
// that refresh has repeatedly landed only after 15-30s (or been superseded by
// a concurrent Realtime-triggered refresh). One manual reload keeps the
// business assertion strict — the saved row must exist and render — without
// making the gate a latency lottery. GG-00's dedicated Realtime test remains
// the freshness guard.
export async function expectVisibleAfterSave(page: Page, text: string): Promise<void> {
  try {
    await expect(visibleText(page, text)).toBeVisible({ timeout: 15_000 });
  } catch {
    await page.reload();
    await expect(visibleText(page, text)).toBeVisible({ timeout: 15_000 });
  }
}

export async function openCustomerDetail(page: Page, customerName: string): Promise<void> {
  await page.goto('/kunden');
  const customerRow = page.locator('tbody tr:visible').filter({ hasText: customerName }).first();
  await expect(customerRow).toBeVisible({ timeout: 15_000 });
  await customerRow.click();
  await page.waitForURL(/\/kunden\/[0-9a-f-]{36}$/, { timeout: 15_000 });
  await expect(visibleText(page, 'Kundendetails')).toBeVisible({ timeout: 15_000 });
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
  }
): Promise<void> {
  await page.getByRole('button', { name: 'Ansprechpartner hinzufügen' }).click();
  await expect(
    page.getByRole('heading', { name: 'Ansprechpartner hinzufügen' })
  ).toBeVisible();
  await page.locator('#contact-name').fill(contact.name);
  if (contact.role) await page.locator('#contact-role').fill(contact.role);
  if (contact.phone) await page.locator('#contact-phone').fill(contact.phone);
  if (contact.email) await page.locator('#contact-email').fill(contact.email);
  if (contact.notes) await page.locator('#contact-notes').fill(contact.notes);
  if (contact.isPrimary) {
    const checkbox = page.getByRole('checkbox', { name: 'Als Hauptkontakt festlegen' });
    if (!(await checkbox.isChecked())) await checkbox.click();
  }
  await page.getByRole('dialog').getByRole('button', { name: 'Speichern' }).click();
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
  }
): Promise<void> {
  await page.getByRole('button', { name: 'Nachfassaktion', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('heading', { name: 'Nachfassaktion anlegen' })).toBeVisible();
  await dialog.locator('#follow-up-title').fill(input.title);
  await typeIntoDateTimeField(dialog, 'follow-up-due', input.dueAtLocal);
  if (input.note) await dialog.locator('#follow-up-note').fill(input.note);
  if (input.ownerName) {
    await selectFromSearchable(page, dialog.locator('#follow-up-owner'), input.ownerName);
  }
  await dialog.getByRole('button', { name: 'Speichern', exact: true }).click();
  await expect(dialog).toHaveCount(0, { timeout: 15_000 });
  await expectVisibleAfterSave(page, input.title);
}

export async function completeFollowUpOnCustomerDetail(
  page: Page,
  title: string
): Promise<void> {
  await page
    .getByRole('button', { name: `Nachfassaktion ${title} erledigen`, exact: true })
    .click();
  await expect(page.getByText('Nachfassaktion erledigt.')).toBeVisible({
    timeout: 15_000,
  });
}

export async function configureCustomerCommunicationSettings(
  page: Page,
  input: {
    preferredContactName?: string;
    preferredChannel?: 'Telefon' | 'E-Mail' | 'SMS' | 'Brief' | 'Persönlich';
    doNotContactInstruction?: string;
    contactTimeNote?: string;
    languageNote?: string;
    accessibilityNote?: string;
    sourceNote?: string;
  }
): Promise<void> {
  await page.getByRole('button', { name: 'Allgemein bearbeiten' }).click();
  const dialog = page.getByRole('dialog');
  if (input.preferredContactName) {
    await selectFromSearchable(
      page,
      dialog.locator('#preferred-contact'),
      input.preferredContactName
    );
  }
  if (input.preferredChannel) {
    await dialog.locator('#preferred-channel').click();
    await page
      .getByRole('option', { name: input.preferredChannel, exact: true })
      .click();
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
  await dialog.getByRole('button', { name: 'Speichern', exact: true }).click();
  await expect(dialog).toHaveCount(0, { timeout: 15_000 });
  if (input.preferredContactName) {
    const communicationSection = page.locator(
      'section[aria-labelledby="communication-heading"]'
    );
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
    channel: 'Telefon' | 'E-Mail' | 'SMS' | 'Brief' | 'Persönlich';
    state: 'Erlaubt' | 'Nicht erlaubt' | 'Unbekannt';
    purpose?:
      | 'Termin und Service'
      | 'Marketing'
      | 'Erforderliche kaufmännische Kommunikation';
    sourceNote?: string;
  }
): Promise<void> {
  await page.getByRole('button', { name: 'Präferenz', exact: true }).click();
  const dialog = page.getByRole('dialog');
  if (input.contactName) {
    await selectFromSearchable(
      page,
      dialog.locator('#preference-contact'),
      input.contactName
    );
  }
  await dialog.locator('#preference-channel').click();
  await page.getByRole('option', { name: input.channel, exact: true }).click();
  await dialog.locator('#preference-state').click();
  await page.getByRole('option', { name: input.state, exact: true }).click();
  if (input.purpose) {
    await dialog.locator('#preference-purpose').click();
    await page.getByRole('option', { name: input.purpose, exact: true }).click();
  }
  if (input.sourceNote) {
    await dialog.locator('#preference-source').fill(input.sourceNote);
  }
  await dialog.getByRole('button', { name: 'Speichern', exact: true }).click();
  await expect(dialog).toHaveCount(0, { timeout: 15_000 });
}

export async function proceedThroughContactWarning(
  page: Page,
  contactHrefText: string,
  reason: string
): Promise<void> {
  await page.getByRole('link', { name: contactHrefText, exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('heading', { name: 'Kontaktvorgabe prüfen' })).toBeVisible();
  await dialog.locator('#contact-exception-reason').fill(reason);
  // Chromium keeps the page open when no external tel:/mailto: handler is
  // registered; the database assertion proves the exception write.
  await dialog.getByRole('button', { name: 'Begründet fortfahren' }).click();
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
  }
): Promise<void> {
  await page.getByRole('button', { name: 'Einsatzort hinzufügen' }).click();
  await expect(
    page.getByRole('heading', { name: 'Einsatzort hinzufügen' })
  ).toBeVisible();
  await page.locator('#site-name').fill(site.name);
  if (site.street) await page.locator('#site-street').fill(site.street);
  if (site.postalCode) await page.locator('#site-postal-code').fill(site.postalCode);
  if (site.city) await page.locator('#site-city').fill(site.city);
  if (site.accessNotes) await page.locator('#site-access-notes').fill(site.accessNotes);
  if (site.notes) await page.locator('#site-notes').fill(site.notes);
  if (site.primaryContactName) {
    await selectFromSearchable(
      page,
      page.locator('#site-primary-contact'),
      site.primaryContactName
    );
  }
  if (site.isPrimary) {
    const checkbox = page.getByRole('checkbox', { name: 'Als Hauptstandort festlegen' });
    if (!(await checkbox.isChecked())) await checkbox.click();
  }
  await page.getByRole('dialog').getByRole('button', { name: 'Speichern' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0, { timeout: 15_000 });
  await expectVisibleAfterSave(page, site.name);
}

export async function archiveCustomerRelation(
  page: Page,
  kind: 'Ansprechpartner' | 'Einsatzort',
  name: string
): Promise<void> {
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const row = page.locator('li')
    .filter({ has: page.getByRole('button', { name: `${kind} archivieren` }) })
    .filter({
      has: page.locator('p').filter({ hasText: new RegExp(`^${escapedName}$`) }),
    })
    .filter({ visible: true })
    .first();
  await row.getByRole('button', { name: `${kind} archivieren` }).click();
  await expect(page.locator('li').filter({
    has: page.getByRole('button', { name: `${kind} wiederherstellen` }),
  }).filter({ hasText: name }).filter({ visible: true })).toHaveCount(1, {
    timeout: 15_000,
  });
}

export async function restoreCustomerRelation(
  page: Page,
  kind: 'Ansprechpartner' | 'Einsatzort',
  name: string
): Promise<void> {
  const row = page.locator('li').filter({
    has: page.getByRole('button', { name: `${kind} wiederherstellen` }),
  }).filter({ hasText: name }).filter({ visible: true }).first();
  await row.getByRole('button', { name: `${kind} wiederherstellen` }).click();
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const activeRow = () => page.locator('li')
    .filter({ has: page.getByRole('button', { name: `${kind} archivieren` }) })
    .filter({
      has: page.locator('p').filter({ hasText: new RegExp(`^${escapedName}$`) }),
    })
    .filter({ visible: true })
    .first();
  await expect(activeRow().getByRole('button', { name: `${kind} archivieren` }))
    .toBeVisible({ timeout: 15_000 });
}

export async function adoptCustomerAddressAsSite(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Adresse als Einsatzort übernehmen' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('heading', { name: 'Einsatzort hinzufügen' })).toBeVisible();
  await dialog.getByRole('button', { name: 'Speichern', exact: true }).click();
  await expect(dialog).toHaveCount(0, { timeout: 15_000 });
  await expectVisibleAfterSave(page, 'Hauptstandort');
}

export async function editSiteStreetOnCustomerDetail(
  page: Page,
  siteName: string,
  newStreet: string
): Promise<void> {
  const siteRow = page
    .locator('li')
    .filter({ hasText: siteName })
    .filter({ visible: true })
    .first();
  await siteRow.getByRole('button', { name: 'Einsatzort bearbeiten' }).click();
  await expect(
    page.getByRole('heading', { name: 'Einsatzort bearbeiten' })
  ).toBeVisible();
  await page.locator('#site-street').fill(newStreet);
  await page.getByRole('dialog').getByRole('button', { name: 'Speichern' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0, { timeout: 15_000 });
  await expectVisibleAfterSave(page, newStreet);
}

export async function searchCustomers(page: Page, query: string): Promise<void> {
  await page.goto('/kunden');
  await page.getByLabel('Kunden durchsuchen').fill(query);
}

// P1-02: Anfragen (customer requests) and their conversion into work.

export async function createRequestViaDialog(
  page: Page,
  options: {
    summary: string;
    requestNumber?: string;
    clientName?: string;
    siteName?: string;
    contactName?: string;
    callerName?: string;
    callerPhone?: string;
    callerEmail?: string;
    callerAddress?: string;
    details?: string;
    categoryLabel?: string;
    urgencyLabel?: string;
    sourceLabel?: string;
    receivedAtLocal?: string;
    assigneeName?: string;
  }
): Promise<string> {
  if ((options.siteName || options.contactName) && !options.clientName) {
    throw new Error('createRequestViaDialog: siteName/contactName require clientName');
  }

  await page.goto('/anfragen');
  await page.getByRole('button', { name: 'Anfrage erfassen' }).click();
  await expect(page.getByRole('heading', { name: 'Neue Anfrage erfassen' })).toBeVisible();

  await page.locator('#request-summary').fill(options.summary);
  if (options.requestNumber !== undefined) {
    await page.locator('#request-number').fill(options.requestNumber);
  }

  if (options.categoryLabel) {
    await page.locator('#request-category').click();
    await page.getByRole('option', { name: options.categoryLabel, exact: true }).click();
  }
  if (options.urgencyLabel) {
    await page.locator('#request-urgency').click();
    await page.getByRole('option', { name: options.urgencyLabel, exact: true }).click();
  }
  if (options.receivedAtLocal) {
    await typeIntoDateTimeField(
      page.getByRole('dialog'),
      'request-received-at',
      options.receivedAtLocal
    );
  }

  if (options.clientName) {
    // Same searchable customer combobox as the job dialog.
    await page.getByRole('combobox').filter({ hasText: 'Kein Kunde' }).click();
    await page.getByPlaceholder('Kunde suchen...').fill(options.clientName);
    await page
      .getByRole('listbox')
      .getByRole('button')
      .filter({ hasText: options.clientName })
      .first()
      .click();
  }

  if (options.siteName) {
    await expect(page.locator('#request-site')).toBeVisible({ timeout: 15_000 });
    await selectFromSearchable(page, page.locator('#request-site'), options.siteName);
  }
  if (options.contactName) {
    await expect(page.locator('#request-contact')).toBeVisible({ timeout: 15_000 });
    await selectFromSearchable(page, page.locator('#request-contact'), options.contactName);
  }

  if (options.callerName) {
    await page.locator('#request-caller-name').fill(options.callerName);
  }
  if (options.callerPhone) {
    await page.locator('#request-caller-phone').fill(options.callerPhone);
  }
  if (options.callerEmail) {
    await page.locator('#request-caller-email').fill(options.callerEmail);
  }
  if (options.callerAddress) {
    await page.locator('#request-caller-address').fill(options.callerAddress);
  }
  if (options.details) {
    await page.locator('#request-details').fill(options.details);
  }
  if (options.sourceLabel) {
    await page.locator('#request-source').click();
    await page.getByRole('option', { name: options.sourceLabel, exact: true }).click();
  }
  if (options.assigneeName) {
    await selectFromSearchable(
      page,
      page.locator('#request-assignee'),
      options.assigneeName
    );
  }

  // The submit button carries the same label as the header trigger; scope it
  // to the dialog. Success navigates straight to the new request detail.
  await page.getByRole('dialog').getByRole('button', { name: 'Anfrage erfassen' }).click();
  await page.waitForURL(/\/anfragen\/[0-9a-f-]{36}/, { timeout: 20_000 });
  await expect(visibleText(page, options.summary)).toBeVisible({ timeout: 15_000 });

  const match = page.url().match(/\/anfragen\/([0-9a-f-]{36})/);
  if (!match) {
    throw new Error('createRequestViaDialog: could not read the request id from the URL');
  }
  return match[1];
}

export async function uploadDocumentOnRequestDetail(
  page: Page,
  filePath: string,
  expectedFileName: string
): Promise<void> {
  // Assumes the request detail page is already open.
  await uploadIntoDocumentsSection(page, filePath, expectedFileName);
}

export async function convertRequestToJobViaDialog(
  page: Page,
  options?: { clientName?: string; plannedDate?: string }
): Promise<void> {
  await page.getByRole('button', { name: 'Umwandeln' }).click();
  await expect(page.getByRole('heading', { name: 'Anfrage umwandeln' })).toBeVisible();

  if (options?.clientName) {
    // Unknown-caller requests must resolve the customer inside the dialog.
    await page
      .getByRole('dialog')
      .getByRole('combobox')
      .filter({ hasText: 'Kein Kunde' })
      .click();
    await page.getByPlaceholder('Kunde suchen...').fill(options.clientName);
    await page
      .getByRole('listbox')
      .getByRole('button')
      .filter({ hasText: options.clientName })
      .first()
      .click();
  }

  if (options?.plannedDate) {
    await typeIntoDatePickerById(
      page.getByRole('dialog'),
      'convert-date',
      options.plannedDate
    );
  }

  // The job number is suggested asynchronously after the dialog opens;
  // submitting before it arrives fails validation like it would for a user.
  await expect(page.locator('#convert-number')).toHaveValue(/.+/, {
    timeout: 15_000,
  });

  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'In Auftrag umwandeln' })
    .click();
  await expect(page.getByRole('dialog')).toHaveCount(0, { timeout: 20_000 });
  await expect(visibleText(page, 'Diese Anfrage wurde umgewandelt')).toBeVisible({
    timeout: 15_000,
  });
}

export async function matchRequestToExistingCustomer(
  page: Page,
  clientName: string
): Promise<void> {
  await page.getByRole('button', { name: 'Vorhandenem Kunden zuordnen' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('heading', { name: 'Kunden zuordnen' })).toBeVisible();
  await dialog.getByRole('combobox').filter({ hasText: 'Kein Kunde' }).click();
  await page.getByPlaceholder('Kunde suchen...').fill(clientName);
  await page.getByRole('listbox').getByRole('button').filter({ hasText: clientName }).first().click();
  await dialog.getByRole('button', { name: 'Zuordnen', exact: true }).click();
  await expect(dialog).toHaveCount(0, { timeout: 15_000 });
  await expectVisibleAfterSave(page, clientName);
}

export async function convertRequestToProjectViaDialog(
  page: Page,
  projectNumber: string
): Promise<void> {
  await page.getByRole('button', { name: 'Umwandeln' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('heading', { name: 'Anfrage umwandeln' })).toBeVisible();
  await dialog.getByRole('tab', { name: 'Projekt' }).click();
  await expect(dialog.locator('#convert-number')).toHaveValue(/.+/, { timeout: 15_000 });
  await dialog.locator('#convert-number').fill(projectNumber);
  await dialog.getByRole('button', { name: 'In Projekt umwandeln' }).click();
  await expect(dialog).toHaveCount(0, { timeout: 20_000 });
  await expect(visibleText(page, 'Diese Anfrage wurde umgewandelt')).toBeVisible({ timeout: 15_000 });
}

export async function setRequestStatusFromDetail(
  page: Page,
  action: 'In Klärung setzen' | 'Wieder öffnen'
): Promise<void> {
  await page.getByRole('button', { name: action, exact: true }).click();
  const expectedAction = page.getByRole('button', {
    name: action === 'In Klärung setzen' ? 'Zurück auf Offen' : 'In Klärung setzen',
    exact: true,
  });
  await expect(expectedAction).toBeVisible({ timeout: 15_000 });
  await page.reload();
  await expect(expectedAction).toBeVisible({ timeout: 15_000 });
}

export async function closeRequestViaDialog(
  page: Page,
  reasonLabel: string
): Promise<void> {
  const detailUrl = page.url();
  for (let attempt = 0; attempt < 2; attempt += 1) {
    if (page.url() !== detailUrl) await page.goto(detailUrl);
    // The request-created event can reach the newly mounted detail page after
    // navigation. Drain the shared 200 ms router-refresh debounce first.
    await page.waitForTimeout(300);
    if (page.url() !== detailUrl) {
      if (attempt === 0) continue;
      throw new Error('closeRequestViaDialog: detail route refreshed away');
    }

    await page.getByRole('button', { name: 'Schließen', exact: true }).click();
    await expect(
      page.getByRole('heading', { name: 'Anfrage ohne Auftrag schließen' })
    ).toBeVisible();
    const dialog = page.getByRole('dialog');
    try {
      await dialog.locator('#close-reason').click({ timeout: 5_000 });
      await page
        .getByRole('option', { name: reasonLabel, exact: true })
        .click({ timeout: 5_000 });
      await dialog
        .getByRole('button', { name: 'Anfrage schließen' })
        .click({ timeout: 5_000 });
      await expect(page.getByRole('dialog')).toHaveCount(0, { timeout: 15_000 });
    } catch (error) {
      const dialogWasInterrupted =
        page.url() !== detailUrl || !(await dialog.isVisible().catch(() => false));
      if (attempt === 0 && dialogWasInterrupted) continue;
      throw error;
    }

    // Reload from the server so success cannot be confused with a client-side
    // modal close that raced the Realtime refresh.
    await page.goto(detailUrl);
    const persistedClosedReason = await expect(
      visibleText(page, 'Ohne Auftrag geschlossen:')
    )
      .toBeVisible({ timeout: 5_000 })
      .then(() => true)
      .catch(() => false);
    if (persistedClosedReason) return;
    if (attempt === 1) {
      throw new Error('closeRequestViaDialog: request remained open after retry');
    }
  }
}

// P1-03: personnel identity and date-effective employment conditions.

export async function openMemberDetailFromList(page: Page, name: string): Promise<void> {
  await page.goto('/mitarbeiter');
  const desktopRow = page.locator('tbody tr:visible').filter({ hasText: name }).first();
  await expect(desktopRow).toBeVisible({ timeout: 20_000 });
  await desktopRow.click();
  await page.waitForURL(/\/mitarbeiter\/[0-9a-f-]{36}/, { timeout: 20_000 });
  await expect(visibleText(page, 'Personalien')).toBeVisible({ timeout: 15_000 });
}

// Inline edit of one Personalien field through the shared MetadataSection
// pencil-edit flow (text fields only; dates use the segmented DatePicker).
export async function editPersonnelTextField(
  page: Page,
  fieldLabel: string,
  value: string
): Promise<void> {
  await editMetadataTextField(page, fieldLabel, value);
}

export async function editMetadataTextField(
  page: Page,
  fieldLabel: string,
  value: string
): Promise<void> {
  await page
    .getByRole('button', { name: `${fieldLabel} bearbeiten`, exact: true })
    .click();
  // The field editor autofocuses its input; targeting :focus avoids matching
  // unrelated inputs elsewhere on the detail page (e.g. table search boxes).
  const input = page.locator('input:focus, textarea:focus');
  await expect(input).toBeVisible();
  await input.fill(value);
  await page.getByRole('button', { name: 'Speichern', exact: true }).click();
  await expectVisibleAfterSave(page, value);
}

// The segmented DatePicker (dd.mm.yyyy) is driven by typing digits after
// focusing the group; segments auto-advance after two/two/four digits. The
// group's accessible name is the field label (e.g. "Gültig ab").
export async function typeIntoDatePicker(
  scope: Locator,
  groupName: string,
  digits: string,
  delayMs = 50
): Promise<void> {
  const group = scope.getByRole('group', { name: groupName });
  await group.click();
  // The click may land on any segment; ArrowLeft twice normalizes to the day
  // segment because the control has exactly day, month, and year segments.
  await group.press('ArrowLeft');
  await group.press('ArrowLeft');
  await group.pressSequentially(digits, { delay: delayMs });
}

// (TimeInput already has a shared helper: typeIntoTimeInput below, addressed
// by element id. Reuse it for every migrated time field.)

// DatePicker addressed by element id instead of accessible name — for the
// DateTimeField composite and standalone pickers with known ids.
export async function typeIntoDatePickerById(
  scope: Locator,
  id: string,
  isoDate: string // 'YYYY-MM-DD'
): Promise<void> {
  const digits = `${isoDate.slice(8, 10)}${isoDate.slice(5, 7)}${isoDate.slice(0, 4)}`;
  const group = scope.locator(`#${id}`);
  await group.click();
  await group.press('ArrowLeft');
  await group.press('ArrowLeft');
  await group.pressSequentially(digits, { delay: 50 });
}

// DateTimeField (DatePicker + TimeInput over one combined value). Accepts the
// former datetime-local string format so migrated steps stay drop-in.
export async function typeIntoDateTimeField(
  scope: Locator,
  idPrefix: string,
  localValue: string // 'YYYY-MM-DDTHH:mm'
): Promise<void> {
  const [datePart, timePart] = localValue.split('T');
  await typeIntoDatePickerById(scope, `${idPrefix}-date`, datePart);
  if (timePart) {
    await typeIntoTimeInput(scope, `${idPrefix}-time`, timePart.replace(':', ''));
  }
}

// UI/UX consolidation shared steps: every SearchableSelect/-MultiSelect in the
// app has the same anatomy (combobox trigger → search textbox → option buttons
// in a listbox). Specs pass the trigger locator (by id or by visible text via
// page.getByRole('combobox').filter({ hasText })). Migrating a form onto the
// registry components means switching its spec steps to these helpers, so a
// future component change touches only this file.

export async function selectFromSearchable(
  page: Page,
  trigger: Locator,
  optionText: string,
  options?: { searchFirst?: boolean }
): Promise<void> {
  await trigger.click();
  const listbox = page.getByRole('listbox');
  await expect(listbox).toBeVisible();
  if (options?.searchFirst ?? true) {
    await listbox
      .locator('..')
      .getByRole('textbox')
      .fill(optionText);
  }
  await listbox
    .getByRole('button')
    .filter({ hasText: optionText })
    .first()
    .click();
  // Single select closes its popover on selection.
  await expect(listbox).toBeHidden();
}

export async function toggleInSearchableMulti(
  page: Page,
  trigger: Locator,
  optionTexts: string[]
): Promise<void> {
  await trigger.click();
  const listbox = page.getByRole('listbox');
  await expect(listbox).toBeVisible();
  const search = listbox.locator('..').getByRole('textbox');
  for (const optionText of optionTexts) {
    await search.fill(optionText);
    await listbox
      .getByRole('button')
      .filter({ hasText: optionText })
      .first()
      .click();
  }
  // The multi popover stays open; close by toggling the trigger. Never press
  // Escape here — inside a dialog it closes the whole dialog (known gotcha).
  await trigger.click();
  await expect(listbox).toBeHidden();
}

// P1-05: scoped responsibilities, effective previews, and substitutions.

export async function previewResponsibilityChange(
  page: Page,
  options: {
    responsibility: 'time_approval' | 'leave_approval';
    selectedNames?: string[];
    gainedNames?: string[];
    lostNames?: string[];
  }
): Promise<void> {
  await page.goto('/einstellungen/mitarbeiter');
  const card = page.getByTestId(`responsibility-${options.responsibility}`);
  await card.getByRole('button', { name: 'Verantwortung ändern' }).click();
  const dialog = page.getByRole('dialog');

  if (options.selectedNames) {
    await dialog.locator(`#${options.responsibility}-mode`).click();
    await page.getByRole('option', { name: 'Bestimmte Personen' }).click();
    await expect(dialog.getByRole('checkbox').first()).toBeVisible({
      timeout: 15_000,
    });
    for (const checkbox of await dialog.getByRole('checkbox').all()) {
      if (await checkbox.isChecked()) await checkbox.uncheck();
    }
    for (const name of options.selectedNames) {
      await dialog.getByRole('checkbox', { name: new RegExp(name) }).check();
    }
  } else {
    await dialog.locator(`#${options.responsibility}-mode`).click();
    await page
      .getByRole('option', { name: 'Standardrollen: Admin und Büro' })
      .click();
  }

  await dialog.getByRole('button', { name: 'Wirkung prüfen' }).click();
  const preview = page.getByTestId('effective-access-preview');
  await expect(preview).toBeVisible({ timeout: 15_000 });
  const gainedSection = preview.getByTestId('preview-gained');
  const lostSection = preview.getByTestId('preview-lost');
  for (const name of options.gainedNames ?? []) {
    await expect(gainedSection.getByText(name, { exact: false })).toBeVisible();
  }
  for (const name of options.lostNames ?? []) {
    await expect(lostSection.getByText(name, { exact: false })).toBeVisible();
  }
}

export async function confirmResponsibilityPreview(page: Page): Promise<void> {
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Änderung bestätigen' })
    .click();
  await expect(page.getByRole('dialog')).toHaveCount(0, { timeout: 15_000 });
}

export async function createResponsibilityDelegationViaSettings(
  page: Page,
  options: {
    responsibility: 'time_approval' | 'leave_approval';
    delegatorName: string;
    substituteName: string;
    validFromDigits: string;
    validUntilDigits: string;
  }
): Promise<void> {
  await page.goto('/einstellungen/mitarbeiter');
  const card = page.getByTestId(`responsibility-${options.responsibility}`);
  await card.getByRole('button', { name: 'Vertretung eintragen' }).click();
  const dialog = page.getByRole('dialog');

  const delegatorTrigger = dialog.locator(
    `#${options.responsibility}-delegator`
  );
  await expect(delegatorTrigger).toBeVisible({ timeout: 15_000 });
  if (!(await delegatorTrigger.textContent())?.includes(options.delegatorName)) {
    await selectFromSearchable(page, delegatorTrigger, options.delegatorName);
  }
  await selectFromSearchable(
    page,
    dialog.locator(`#${options.responsibility}-substitute`),
    options.substituteName
  );
  await typeIntoDatePicker(dialog, 'Gültig ab', options.validFromDigits);
  await typeIntoDatePicker(dialog, 'Gültig bis', options.validUntilDigits);
  await dialog.getByRole('button', { name: 'Vertretung speichern' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0, { timeout: 15_000 });
  const activeDelegationRow = (scope: Locator) =>
    scope
      .locator('li')
      .filter({ hasText: options.substituteName })
      .filter({ has: page.getByRole('button', { name: 'Heute beenden' }) })
      .first();
  try {
    await expect(activeDelegationRow(card)).toBeVisible({ timeout: 15_000 });
  } catch {
    await page.reload();
    await expect(
      activeDelegationRow(
        page.getByTestId(`responsibility-${options.responsibility}`)
      )
    ).toBeVisible({ timeout: 15_000 });
  }
}

export async function endResponsibilityDelegationViaSettings(
  page: Page,
  responsibility: 'time_approval' | 'leave_approval',
  substituteName: string
): Promise<void> {
  await page.goto('/einstellungen/mitarbeiter');
  const card = page.getByTestId(`responsibility-${responsibility}`);
  const row = card
    .locator('li')
    .filter({ hasText: substituteName })
    .filter({ has: page.getByRole('button', { name: 'Heute beenden' }) })
    .first();
  await row.getByRole('button', { name: 'Heute beenden' }).click();
  const endedRow = card
    .locator('li')
    .filter({ hasText: substituteName })
    .filter({ has: page.getByText('Beendet', { exact: true }) })
    .first();
  await expect(endedRow.getByText('Beendet', { exact: true })).toBeVisible({
    timeout: 15_000,
  });
}

export async function typeIntoTimeInput(
  dialog: Locator,
  id: string,
  digits: string
): Promise<void> {
  if (!/^\d{4}$/.test(digits)) {
    throw new Error('typeIntoTimeInput requires exactly four HHMM digits');
  }
  const group = dialog.locator(`#${id}`);
  await group.focus();
  await group.press('ArrowLeft');
  await group.press('Delete');
  await group.pressSequentially(digits.slice(0, 2), { delay: 50 });
  await group.press('ArrowRight');
  await group.press('Delete');
  await group.pressSequentially(digits.slice(2), { delay: 50 });
}

export async function createOwnManualTimeEntry(
  page: Page,
  options: {
    memberName?: string;
    dateDigits: string;
    clockInDigits: string;
    clockOutDigits: string;
  }
): Promise<void> {
  await page.goto('/zeiterfassung');
  await page.getByRole('button', { name: 'Manuelle Eintragung' }).click();
  const dialog = page.getByRole('dialog');
  if (options.memberName) {
    await dialog.locator('#manual-entry-member').click();
    await dialog
      .getByRole('button', { name: new RegExp(options.memberName) })
      .click();
  }
  await typeIntoDatePicker(dialog, 'Datum', options.dateDigits);
  await typeIntoTimeInput(dialog, 'clockInTime', options.clockInDigits);
  await typeIntoTimeInput(dialog, 'clockOutTime', options.clockOutDigits);
  await dialog.getByRole('button', { name: 'Speichern', exact: true }).click();
  // Close-then-banner: the dialog closes immediately and the global banner
  // confirms the save (M5).
  await expect(
    page.getByText(/Antrag wurde zur Genehmigung eingereicht\.|Eintrag erfolgreich erstellt!/)
  ).toBeVisible({ timeout: 15_000 });
  await expect(dialog).toHaveCount(0, { timeout: 15_000 });
}

export async function openTimeApprovals(page: Page): Promise<void> {
  await page.goto('/zeiterfassung?tab=approvals');
  await expect(page.getByRole('tab', { name: /Anträge/ })).toHaveAttribute(
    'aria-selected',
    'true',
    { timeout: 15_000 }
  );
  await expect(page.getByTestId('pending-approvals-panel')).toHaveAttribute(
    'data-loaded',
    'true',
    {
    timeout: 30_000,
    }
  );
}

function pendingTimeApprovalCard(page: Page, userId: string): Locator {
  return page.locator(
    `[data-testid^="pending-session-"][data-user-id="${userId}"]`
  );
}

export async function expectPendingTimeApprovalVisible(
  page: Page,
  userId: string
): Promise<void> {
  await expect(pendingTimeApprovalCard(page, userId)).toBeVisible({
    timeout: 15_000,
  });
}

export async function expectPendingTimeApprovalHidden(
  page: Page,
  userId: string
): Promise<void> {
  await expect(pendingTimeApprovalCard(page, userId)).toHaveCount(0, {
    timeout: 15_000,
  });
}

export async function approvePendingTimeEntry(
  page: Page,
  userId: string,
  visibleText?: string | RegExp
): Promise<void> {
  const cards = pendingTimeApprovalCard(page, userId);
  const card = visibleText ? cards.filter({ hasText: visibleText }) : cards;
  await expect(card).toHaveCount(1, { timeout: 15_000 });
  await card.getByTitle('Genehmigen - Eintrag bleibt erhalten').click();
  await expect(card).toHaveCount(0, { timeout: 15_000 });
}

export async function expectExpiredResponsibilityDeniedAtAction(
  page: Page,
  userId: string
): Promise<void> {
  const card = pendingTimeApprovalCard(page, userId);
  await card.getByTitle('Genehmigen - Eintrag bleibt erhalten').click();
  await expect(
    page.getByText(
      'Du bist für diese Freigabe nicht mehr verantwortlich. Die Ansicht wurde aktualisiert.'
    )
  ).toBeVisible({ timeout: 15_000 });
  await expect(card).toHaveCount(0, { timeout: 15_000 });
}

export async function expectMemberRemovalBlockedByResponsibility(
  page: Page,
  memberName: string
): Promise<void> {
  await openMemberDetailFromList(page, memberName);
  await page.getByRole('button', { name: 'Aktionen', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Entfernen' }).click();
  const dialog = page.getByRole('alertdialog');
  await expect(
    dialog.getByText(
      'Vor dem Entfernen muss die Verantwortung für Zeitfreigaben neu zugewiesen oder auf den Standard zurückgestellt werden.'
    )
  ).toBeVisible({ timeout: 15_000 });
  await expect(
    dialog.getByRole('button', { name: 'Zuerst neu zuweisen' })
  ).toBeDisabled();
}

export async function addConditionViaDialog(
  page: Page,
  options: {
    // ddmmyyyy digits for the valid-from date; omitted = keep today's default.
    validFromDigits?: string;
    employmentTypeLabel: string;
    weeklyHours?: string;
    vacationDays?: string;
    note?: string;
  }
): Promise<void> {
  const detailUrl = page.url();
  for (let attempt = 0; attempt < 2; attempt += 1) {
    if (page.url() !== detailUrl) await page.goto(detailUrl);
    // Drain a pending refresh from the preceding serial scenario before the
    // modal owns user input. The hook itself debounces for 200 ms.
    await page.waitForTimeout(300);
    if (page.url() !== detailUrl) {
      if (attempt === 0) continue;
      throw new Error('addConditionViaDialog: detail route refreshed away');
    }
    await page.getByRole('button', { name: 'Kondition hinzufügen' }).click();
    await expect(
      page.getByRole('heading', { name: 'Kondition hinzufügen' })
    ).toBeVisible();

    const dialog = page.getByRole('dialog');
    try {
      if (options.validFromDigits) {
        // Keep controlled date entry below the shared 200 ms Realtime debounce.
        await typeIntoDatePicker(dialog, 'Gültig ab', options.validFromDigits, 10);
      }

      await dialog.locator('#condition-type').click({ timeout: 5_000 });
      await page
        .getByRole('option', { name: options.employmentTypeLabel, exact: true })
        .click({ timeout: 5_000 });

      if (options.weeklyHours !== undefined) {
        await dialog
          .locator('#condition-weekly-hours')
          .fill(options.weeklyHours, { timeout: 5_000 });
      }
      if (options.vacationDays !== undefined) {
        await dialog
          .locator('#condition-vacation-days')
          .fill(options.vacationDays, { timeout: 5_000 });
      }
      if (options.note !== undefined) {
        await dialog
          .locator('#condition-note')
          .fill(options.note, { timeout: 5_000 });
      }

      await dialog
        .getByRole('button', { name: 'Speichern', exact: true })
        .click({ timeout: 5_000 });
      await expect(page.getByRole('dialog')).toHaveCount(0, { timeout: 15_000 });
      return;
    } catch (error) {
      const dialogWasInterrupted =
        page.url() !== detailUrl || !(await dialog.isVisible().catch(() => false));
      if (attempt === 0 && dialogWasInterrupted) continue;
      throw error;
    }
  }
}

export async function editConditionWeeklyHours(
  page: Page,
  validFromLabel: string,
  weeklyHours: string
): Promise<void> {
  const row = page
    .locator('li')
    .filter({ hasText: `Gültig ab ${validFromLabel}` })
    .filter({ visible: true })
    .first();
  await row
    .getByRole('button', { name: `Aktionen für Kondition vom ${validFromLabel}` })
    .click();
  await page.getByRole('menuitem', { name: 'Bearbeiten' }).click();
  await expect(
    page.getByRole('heading', { name: 'Kondition bearbeiten' })
  ).toBeVisible();
  await page.locator('#condition-weekly-hours').fill(weeklyHours);
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'Speichern', exact: true })
    .click();
  await expect(page.getByRole('dialog')).toHaveCount(0, { timeout: 15_000 });
}

export async function createPersonnelRecordViaDialog(
  page: Page,
  options: {
    firstName?: string;
    lastName: string;
    entryDateDigits?: string;
    employeeNumber?: string;
  }
): Promise<string> {
  await page.goto('/mitarbeiter');
  await page.getByRole('button', { name: 'Personalakte anlegen' }).click();
  await expect(
    page.getByRole('heading', { name: 'Personalakte anlegen' })
  ).toBeVisible();

  const dialog = page.getByRole('dialog');
  if (options.firstName) {
    await page.locator('#personnel-first-name').fill(options.firstName);
  }
  await page.locator('#personnel-last-name').fill(options.lastName);
  if (options.employeeNumber !== undefined) {
    await page.locator('#personnel-number').fill(options.employeeNumber);
  } else {
    // The number suggestion arrives asynchronously; wait so the submit cannot
    // race it (mirrors the request/job dialogs).
    await expect(page.locator('#personnel-number')).toHaveValue(/.+/, {
      timeout: 15_000,
    });
  }
  if (options.entryDateDigits) {
    await typeIntoDatePicker(dialog, 'Eintrittsdatum', options.entryDateDigits);
  }

  await dialog
    .getByRole('button', { name: 'Personalakte anlegen', exact: true })
    .click();
  const reachedDetail = await page
    .waitForURL(/\/mitarbeiter\/[0-9a-f-]{36}/, { timeout: 20_000 })
    .then(() => true)
    .catch(() => false);
  if (!reachedDetail) {
    // Realtime can refresh the list after the insert and win the race against
    // the action's detail redirect. Follow the persisted row instead.
    const recordName = [options.firstName, options.lastName]
      .filter(Boolean)
      .join(' ');
    const recordLink = page.getByRole('link', {
      name: recordName,
      exact: true,
    });
    await expect(recordLink).toBeVisible({ timeout: 30_000 });
    await recordLink.click();
    await page.waitForURL(/\/mitarbeiter\/[0-9a-f-]{36}/, { timeout: 20_000 });
  }

  const match = page.url().match(/\/mitarbeiter\/([0-9a-f-]{36})/);
  if (!match) {
    throw new Error('createPersonnelRecordViaDialog: could not read the record id');
  }
  return match[1];
}

export async function sendInviteFromPersonnelRecord(
  page: Page,
  email: string,
  roleLabel: 'Büro' | 'Handwerker/in'
): Promise<void> {
  await page.getByRole('button', { name: 'Zugang einladen' }).click();
  await expect(
    page.getByRole('heading', { name: /Zugang für .* einladen/ })
  ).toBeVisible();
  await page.locator('#personnel-invite-email').fill(email);
  await page.locator('#personnel-invite-role').click();
  await page.getByRole('option', { name: roleLabel, exact: true }).click();
  await page.getByRole('button', { name: 'Einladung senden' }).click();
  // A Realtime refresh can replace the dialog before its short success flash
  // is observed. Assert the persisted personnel state and audit entry instead.
  await expect(page.getByRole('dialog')).toHaveCount(0, {
    timeout: 30_000,
  });
  await expect(visibleText(page, 'Eingeladen')).toBeVisible();
  await expect(visibleText(page, 'Einladung versendet')).toBeVisible();
}

// P1-04: date-effective work schedules and holiday/closure context.

export async function addWorkScheduleViaDialog(
  page: Page,
  options: {
    // ddmmyyyy digits for the valid-from date; omitted = keep today's default.
    validFromDigits?: string;
    // Hours per weekday as typed strings, index 0 = Montag … 6 = Sonntag;
    // omitted = keep the dialog's full-time default (Mo–Fr 8, weekend 0).
    dayHours?: string[];
    note?: string;
  }
): Promise<void> {
  const detailUrl = page.url();
  for (let attempt = 0; attempt < 2; attempt += 1) {
    if (page.url() !== detailUrl) await page.goto(detailUrl);
    // A schedule event from the preceding serial action can arrive after
    // navigation. Let the 200 ms router-refresh debounce settle first.
    await page.waitForTimeout(300);
    if (page.url() !== detailUrl) {
      if (attempt === 0) continue;
      throw new Error('addWorkScheduleViaDialog: detail route refreshed away');
    }
    await page.getByRole('button', { name: 'Wochenplan hinzufügen' }).click();
    await expect(
      page.getByRole('heading', { name: 'Wochenplan hinzufügen' })
    ).toBeVisible();

    const dialog = page.getByRole('dialog');
    try {
      if (options.validFromDigits) {
        // Keep this controlled input below the shared 200 ms Realtime debounce.
        await typeIntoDatePicker(
          dialog,
          'Gültig ab',
          options.validFromDigits,
          10
        );
      }
      if (options.dayHours) {
        for (let index = 0; index < options.dayHours.length; index++) {
          await dialog
            .locator(`#schedule-day-${index}`)
            .fill(options.dayHours[index], { timeout: 5_000 });
        }
      }
      if (options.note !== undefined) {
        await dialog
          .locator('#schedule-note')
          .fill(options.note, { timeout: 5_000 });
      }
      await dialog
        .getByRole('button', { name: 'Speichern', exact: true })
        .click({ timeout: 5_000 });
      await expect(page.getByRole('dialog')).toHaveCount(0, { timeout: 15_000 });
      return;
    } catch (error) {
      const dialogWasInterrupted =
        page.url() !== detailUrl || !(await dialog.isVisible().catch(() => false));
      if (attempt === 0 && dialogWasInterrupted) continue;
      throw error;
    }
  }
}

export async function setHolidayRegionViaSettings(
  page: Page,
  regionLabel: string
): Promise<void> {
  await page.goto('/einstellungen/zeiterfassung');
  await selectFromSearchable(
    page,
    page.locator('#holiday-region'),
    regionLabel
  );
  await page
    .getByRole('button', { name: 'Feiertagskalender speichern' })
    .click();
  await expect(
    page.getByText('Der Feiertagskalender wurde gespeichert.')
  ).toBeVisible({ timeout: 15_000 });
}

export async function addClosureDayViaSettings(
  page: Page,
  options: { dateDigits: string; label?: string }
): Promise<void> {
  await page.goto('/einstellungen/zeiterfassung');
  await typeIntoDatePicker(
    page.locator('body'),
    'Datum der Betriebsruhe',
    options.dateDigits
  );
  if (options.label !== undefined) {
    await page.locator('#closure-label').fill(options.label);
  }
  await page.getByRole('button', { name: 'Eintragen' }).click();
  await expect(
    page.getByText('Der Betriebsruhe-Tag wurde eingetragen.')
  ).toBeVisible({ timeout: 15_000 });
}

// dateLabel: dd.mm.yyyy — the aria-label also contains the weekday, so match
// via regular expression around the date.
export async function removeClosureDayViaSettings(
  page: Page,
  dateLabel: string
): Promise<void> {
  await page.goto('/einstellungen/zeiterfassung');
  const escaped = dateLabel.replace(/\./g, '\\.');
  await page
    .getByRole('button', { name: new RegExp(`Betriebsruhe am .*${escaped} entfernen`) })
    .click();
  await expect(
    page.getByText('Der Betriebsruhe-Tag wurde entfernt.')
  ).toBeVisible({ timeout: 15_000 });
}

export async function removeMemberFromDetail(page: Page, name: string): Promise<void> {
  await openMemberDetailFromList(page, name);
  await page.getByRole('button', { name: 'Aktionen' }).click();
  await page.getByRole('menuitem', { name: 'Entfernen' }).click();
  await expect(
    page.getByRole('heading', { name: 'Mitglied entfernen?' })
  ).toBeVisible();
  await page.getByRole('button', { name: 'Entfernen', exact: true }).click();
  await page.waitForURL(/\/mitarbeiter\?removed_member=/, { timeout: 20_000 });
}

export async function expectRedirectedAway(page: Page, path: string): Promise<void> {
  await page.goto(path);
  await expect(page).not.toHaveURL(new RegExp(`${path.replace('/', '\\/')}$`), {
    timeout: 15_000,
  });
}

export async function loginViaUi(
  page: Page,
  credentials: { email: string; password: string }
): Promise<void> {
  let loggedIn = false;
  // Same pre-hydration retry the global setup uses.
  for (let attempt = 1; attempt <= 3 && !loggedIn; attempt++) {
    await page.goto('/login');
    await page.waitForLoadState('networkidle');
    await page.locator('input[autocomplete="email"]').fill(credentials.email);
    await page.locator('input[autocomplete="current-password"]').fill(credentials.password);
    await page.getByRole('button', { name: 'Anmelden' }).click();
    loggedIn = await page
      .waitForURL('**/dashboard**', { timeout: 20_000 })
      .then(() => true)
      .catch(() => false);
  }
  if (!loggedIn) {
    throw new Error(`Login did not reach the dashboard for ${credentials.email}`);
  }
}

export async function signOutViaUi(page: Page): Promise<void> {
  await page.goto('/dashboard');
  const directButton = page.getByRole('button', { name: 'Abmelden' });
  if (await directButton.isVisible().catch(() => false)) {
    await directButton.click();
  } else {
    // The sign-out control sits in the sidebar profile card menu.
    await page.locator('[data-sidebar="footer"] button, aside button').last().click();
    await page.getByRole('menuitem', { name: 'Abmelden' }).click();
  }
  await page.waitForURL('**/login', { timeout: 20_000 });
}

// ============================================
// P1-06 — Vacation requests, decisions, balance
// ============================================

// The employee vacation surface lives on the /zeiterfassung overview
// (dashboard) for every role.
export async function openOwnVacationSection(page: Page): Promise<void> {
  await page.goto('/zeiterfassung');
  await expect(
    visibleText(page, 'Urlaub & Abwesenheit')
  ).toBeVisible({ timeout: 15_000 });
}

export async function createOwnVacationRequestViaDialog(
  page: Page,
  options: {
    startDigits: string;
    endDigits: string;
    halfDay?: boolean;
    comment?: string;
  }
): Promise<void> {
  await openOwnVacationSection(page);
  await page.getByRole('button', { name: 'Urlaub beantragen' }).click();
  await expect(
    page.getByRole('heading', { name: 'Urlaub beantragen' })
  ).toBeVisible();

  const dialog = page.getByRole('dialog');
  await typeIntoDatePicker(dialog, 'Von', options.startDigits);
  await typeIntoDatePicker(dialog, 'Bis', options.endDigits);
  if (options.halfDay) {
    await dialog.locator('#vacation-half-day').click();
  }
  if (options.comment !== undefined) {
    await dialog.locator('#vacation-comment').fill(options.comment);
  }
  await dialog.getByRole('button', { name: 'Antrag einreichen' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0, { timeout: 15_000 });
}

// Submitting an overlapping range must fail with an understandable message
// while the dialog stays open (the database exclusion constraint decides).
export async function expectVacationOverlapRejectedViaDialog(
  page: Page,
  options: { startDigits: string; endDigits: string }
): Promise<void> {
  await openOwnVacationSection(page);
  await page.getByRole('button', { name: 'Urlaub beantragen' }).click();
  const dialog = page.getByRole('dialog');
  await typeIntoDatePicker(dialog, 'Von', options.startDigits);
  await typeIntoDatePicker(dialog, 'Bis', options.endDigits);
  await dialog.getByRole('button', { name: 'Antrag einreichen' }).click();
  await expect(
    dialog.getByText(
      'Für diesen Zeitraum existiert bereits ein offener oder genehmigter Urlaubsantrag.'
    )
  ).toBeVisible({ timeout: 15_000 });
  await dialog.getByRole('button', { name: 'Abbrechen' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
}

export async function withdrawOwnPendingVacationRequest(
  page: Page
): Promise<void> {
  await openOwnVacationSection(page);
  // Exactly one pending request is expected when this step runs. The button's
  // accessible name carries the request's date range. Success is the button
  // disappearing — a "Zurückgezogen" text alone would be satisfied by an
  // older withdrawn request inherited from an earlier spec before the new
  // withdrawal has actually committed (a race GG-02's full run exposed).
  const withdrawButton = page.getByRole('button', {
    name: /^Urlaubsantrag vom .* zurückziehen$/,
  });
  await withdrawButton.click();
  await expect(withdrawButton).toHaveCount(0, { timeout: 15_000 });
  await expect(visibleText(page, 'Zurückgezogen')).toBeVisible({
    timeout: 15_000,
  });
}

export async function openVacationApprovals(page: Page): Promise<void> {
  await page.goto('/zeiterfassung?tab=approvals');
  await expect(page.getByRole('tab', { name: /Anträge/ })).toBeVisible({
    timeout: 15_000,
  });
}

export async function approveVacationRequestFor(
  page: Page,
  personName: string
): Promise<void> {
  await openVacationApprovals(page);
  await page
    .getByRole('button', {
      name: `Urlaubsantrag von ${personName} genehmigen`,
    })
    .click();
  await expect(
    page.getByRole('button', {
      name: `Urlaubsantrag von ${personName} genehmigen`,
    })
  ).toHaveCount(0, { timeout: 15_000 });
}

export async function rejectVacationRequestFor(
  page: Page,
  personName: string,
  reason: string
): Promise<void> {
  await openVacationApprovals(page);
  await page
    .getByRole('button', { name: `Urlaubsantrag von ${personName} ablehnen` })
    .click();
  const dialog = page.getByRole('dialog');
  await expect(
    dialog.getByRole('heading', { name: 'Urlaubsantrag ablehnen' })
  ).toBeVisible();
  await dialog.locator('#vacation-decision-reason').fill(reason);
  await dialog.getByRole('button', { name: 'Ablehnen', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0, { timeout: 15_000 });
}

export async function cancelApprovedVacationFor(
  page: Page,
  personName: string,
  reason: string
): Promise<void> {
  await openVacationApprovals(page);
  await page
    .getByRole('button', {
      name: `Genehmigten Urlaub von ${personName} stornieren`,
    })
    .click();
  const dialog = page.getByRole('dialog');
  await expect(
    dialog.getByRole('heading', { name: 'Genehmigten Urlaub stornieren' })
  ).toBeVisible();
  await dialog.locator('#vacation-decision-reason').fill(reason);
  await dialog.getByRole('button', { name: 'Stornieren', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0, { timeout: 15_000 });
}

// ============================================
// P1-07 — Shared attention pattern (/aufgaben)
// ============================================

export async function openAufgaben(page: Page): Promise<void> {
  await page.goto('/aufgaben');
  await expect(
    page.locator('[data-testid="aufgaben-content"][data-loaded="true"]')
  ).toBeVisible({ timeout: 15_000 });
}

// Task links carry stable German aria-labels (`Urlaubsantrag von X öffnen`,
// `Zeitfreigabe von X öffnen`, `Anfrage <Nummer> öffnen`). Counting via the
// accessible name doubles as the per-viewer deduplication assertion.
export function attentionTaskLink(page: Page, ariaLabel: string): Locator {
  return page.getByRole('link', { name: ariaLabel, exact: true });
}

export function attentionNotificationRow(
  page: Page,
  sourceId: string
): Locator {
  return page.locator(`[data-notification-source="${sourceId}"]`);
}

export async function markAttentionNotificationReadViaButton(
  page: Page,
  sourceId: string
): Promise<void> {
  const row = attentionNotificationRow(page, sourceId);
  await row
    .getByRole('button', { name: /^Benachrichtigung vom .* als gelesen markieren$/ })
    .click();
  await expect(row).toHaveAttribute('data-unread', 'false', {
    timeout: 15_000,
  });
}

export async function markAllAttentionNotificationsReadViaButton(
  page: Page
): Promise<void> {
  await page
    .getByRole('button', { name: 'Alle als gelesen markieren' })
    .click();
  await expect(page.locator('[data-unread="true"]')).toHaveCount(0, {
    timeout: 15_000,
  });
}

// The sidebar badge on the Aufgaben entry (desktop sidebar only; the mobile
// drawer is unmounted while closed, so this locator never double-matches).
export function aufgabenSidebarBadge(page: Page): Locator {
  return page.locator('aside a[href="/aufgaben"] [data-testid="sidebar-badge"]');
}

// Assigns a responsible person on the currently open request detail page via
// the edit dialog (P1-02 storage, first surfaced as an ownership signal here).
export async function assignRequestAssigneeViaEditDialog(
  page: Page,
  assigneeName: string
): Promise<void> {
  await page.getByRole('button', { name: 'Bearbeiten', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await selectFromSearchable(
    page,
    dialog.locator('#edit-request-assignee'),
    assigneeName
  );
  await dialog.getByRole('button', { name: 'Speichern', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0, { timeout: 15_000 });
  await expectVisibleAfterSave(page, assigneeName);
}

// Cancels one specific approved vacation when a person has several approved
// ranges: the range text disambiguates where the per-person aria-label alone
// would be ambiguous (strict mode).
export async function cancelApprovedVacationForRangeText(
  page: Page,
  personName: string,
  rangeText: string,
  reason: string
): Promise<void> {
  await openVacationApprovals(page);
  await page
    .locator('[data-slot="card"]')
    .filter({ hasText: rangeText })
    .getByRole('button', { name: `Genehmigten Urlaub von ${personName} stornieren` })
    .click();
  const dialog = page.getByRole('dialog');
  await expect(
    dialog.getByRole('heading', { name: 'Genehmigten Urlaub stornieren' })
  ).toBeVisible();
  await dialog.locator('#vacation-decision-reason').fill(reason);
  await dialog.getByRole('button', { name: 'Stornieren', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0, { timeout: 15_000 });
}

// The clock-in contradiction rule: on an approved full-day vacation day the
// FAB flow is denied server-side with an understandable banner.
export async function expectClockInBlockedByVacation(page: Page): Promise<void> {
  await page.goto('/dashboard');
  await page.locator('button[title="Einstempeln"]').click();
  await expect(page.getByRole('heading', { name: 'Einstempeln' })).toBeVisible();
  await page.locator('button:not([title])', { hasText: 'Einstempeln' }).click();
  await expect(
    visibleText(page, 'Heute ist Urlaub genehmigt')
  ).toBeVisible({ timeout: 15_000 });
  // Still clocked out: the FAB keeps offering Einstempeln, never Ausstempeln.
  await expect(page.locator('button[title="Ausstempeln"]')).toHaveCount(0);
}

// P1-08: sickness / privacy-sensitive absence. A report is a fact, not a
// request — every step asserts the resulting state transition, never a
// transient flash (inherited rows could satisfy texts alone).

export async function openOwnSicknessSection(page: Page): Promise<void> {
  await page.goto('/zeiterfassung');
  await expect(visibleText(page, 'Krankmeldung')).toBeVisible({
    timeout: 15_000,
  });
}

// Self-report. `endDigits` undefined = open-ended („bis auf Weiteres").
// The overlap hint against approved vacation is mode-dependent state, so the
// caller passes `expectVacationOverlapHint` derived from the database.
export async function reportOwnSicknessViaDialog(
  page: Page,
  options: {
    startDigits: string;
    endDigits?: string;
    halfDay?: boolean;
    typeLabel?: 'Krankheit' | 'Kind krank' | 'Sonstige Abwesenheit';
    expectVacationOverlapHint?: boolean;
  }
): Promise<void> {
  await openOwnSicknessSection(page);
  await page.getByRole('button', { name: 'Krank melden' }).click();
  await expect(
    page.getByRole('heading', { name: 'Krank melden' })
  ).toBeVisible();

  const dialog = page.getByRole('dialog');
  if (options.typeLabel) {
    await dialog.locator('#sickness-type').click();
    await page
      .getByRole('option', { name: options.typeLabel, exact: true })
      .click();
  }
  await typeIntoDatePicker(dialog, 'Ab', options.startDigits);
  if (options.endDigits !== undefined) {
    await dialog.locator('#sickness-end-known').click();
    await typeIntoDatePicker(dialog, 'Bis', options.endDigits);
    if (options.halfDay) {
      await dialog.locator('#sickness-half-day').click();
    }
  }
  await dialog.getByRole('button', { name: 'Krank melden' }).click();
  if (options.expectVacationOverlapHint) {
    // The saved report shows the overlap hint until explicitly acknowledged.
    await expect(
      dialog.getByText('überschneidet sich mit genehmigtem Urlaub')
    ).toBeVisible({ timeout: 15_000 });
    await dialog.getByRole('button', { name: 'Verstanden' }).click();
  }
  await expect(page.getByRole('dialog')).toHaveCount(0, { timeout: 15_000 });
}

// Overlapping own active sickness is impossible (gist exclusion constraint);
// the dialog stays open with an understandable error.
export async function expectSicknessOverlapRejectedViaDialog(
  page: Page,
  options: { startDigits: string; endDigits?: string }
): Promise<void> {
  await openOwnSicknessSection(page);
  await page.getByRole('button', { name: 'Krank melden' }).click();
  const dialog = page.getByRole('dialog');
  await typeIntoDatePicker(dialog, 'Ab', options.startDigits);
  if (options.endDigits !== undefined) {
    await dialog.locator('#sickness-end-known').click();
    await typeIntoDatePicker(dialog, 'Bis', options.endDigits);
  }
  await dialog.getByRole('button', { name: 'Krank melden' }).click();
  await expect(
    dialog.getByText(
      'Für diesen Zeitraum ist bereits eine Krankmeldung erfasst.'
    )
  ).toBeVisible({ timeout: 15_000 });
  await dialog.getByRole('button', { name: 'Abbrechen' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0, { timeout: 15_000 });
}

// Own close-out: set the end date on an active report identified by its
// current range text (aria-label). Success = the dialog closes and the row
// shows the new range.
export async function setOwnSicknessEndDateViaDialog(
  page: Page,
  options: { rangeText: string; endDigits: string; expectedRangeText: string }
): Promise<void> {
  await openOwnSicknessSection(page);
  await page
    .getByRole('button', {
      name: `Enddatum für die Krankmeldung vom ${options.rangeText} setzen`,
    })
    .click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await typeIntoDatePicker(dialog, 'Letzter Tag', options.endDigits);
  await dialog.getByRole('button', { name: 'Enddatum speichern' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0, { timeout: 15_000 });
  await expect(visibleText(page, options.expectedRangeText)).toBeVisible({
    timeout: 15_000,
  });
}

// Office entry on the currently open member/personnel detail (the 7:00
// phone-call-in path). `endDigits` undefined = open-ended.
export async function recordSicknessForMemberViaSection(
  page: Page,
  options: {
    startDigits: string;
    endDigits?: string;
    halfDay?: boolean;
    typeLabel?: 'Krankheit' | 'Kind krank' | 'Sonstige Abwesenheit';
    evidenceRequired?: boolean;
    expectVacationOverlapHint?: boolean;
  }
): Promise<void> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    await page.waitForTimeout(300);
    await page.getByRole('button', { name: 'Krankmeldung erfassen' }).click();
    await expect(
      page.getByRole('heading', { name: 'Krankmeldung erfassen' })
    ).toBeVisible();
    const dialog = page.getByRole('dialog');
    let submitted = false;
    try {
      if (options.typeLabel) {
        await dialog.locator('#record-sickness-type').click();
        await page
          .getByRole('option', { name: options.typeLabel, exact: true })
          .click();
      }
      await typeIntoDatePicker(dialog, 'Ab', options.startDigits);
      if (options.endDigits !== undefined) {
        await dialog.locator('#record-sickness-end-known').click();
        await typeIntoDatePicker(dialog, 'Bis', options.endDigits);
        if (options.halfDay) {
          await dialog.locator('#record-sickness-half-day').click();
        }
      }
      if (options.evidenceRequired) {
        await dialog.locator('#record-sickness-evidence').click();
      }
      submitted = true;
      await dialog.getByRole('button', { name: 'Krankmeldung erfassen' }).click();
      if (options.expectVacationOverlapHint) {
        // The saved report shows the overlap hint until explicitly acknowledged.
        await expect(
          dialog.getByText('überschneidet sich mit genehmigtem Urlaub')
        ).toBeVisible({ timeout: 15_000 });
        await dialog.getByRole('button', { name: 'Verstanden' }).click();
      }
      await expect(page.getByRole('dialog')).toHaveCount(0, { timeout: 15_000 });
      return;
    } catch (error) {
      const interruptedBeforeSubmit =
        !submitted && !(await dialog.isVisible().catch(() => false));
      if (attempt === 0 && interruptedBeforeSubmit) continue;
      throw error;
    }
  }

  throw new Error('recordSicknessForMemberViaSection: dialog remained interrupted');
}

// Manager actions on one report row of the member-detail section, addressed
// by the report's range text (the per-item aria-label disambiguates).
async function openSicknessReportMenu(
  page: Page,
  rangeText: string,
  itemName: string | RegExp
): Promise<void> {
  await page
    .getByRole('button', {
      name: `Aktionen für die Krankmeldung vom ${rangeText}`,
    })
    .click();
  await page.getByRole('menuitem', { name: itemName }).click();
}

export async function setSicknessEvidenceViaMenu(
  page: Page,
  rangeText: string,
  options: { required: boolean; received?: boolean }
): Promise<void> {
  await openSicknessReportMenu(page, rangeText, 'Nachweis verwalten');
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  const requiredBox = dialog.locator('#evidence-required');
  const isChecked =
    (await requiredBox.getAttribute('data-state')) === 'checked';
  if (isChecked !== options.required) {
    await requiredBox.click();
  }
  if (options.required) {
    const receivedBox = dialog.locator('#evidence-received');
    const receivedChecked =
      (await receivedBox.getAttribute('data-state')) === 'checked';
    if (receivedChecked !== (options.received ?? false)) {
      await receivedBox.click();
    }
  }
  await dialog.getByRole('button', { name: 'Speichern', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0, { timeout: 15_000 });
}

export async function endSicknessReportViaMenu(
  page: Page,
  rangeText: string,
  endDigits: string
): Promise<void> {
  await openSicknessReportMenu(page, rangeText, /Enddatum (setzen|ändern)/);
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await typeIntoDatePicker(dialog, 'Letzter Tag', endDigits);
  await dialog.getByRole('button', { name: 'Enddatum speichern' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0, { timeout: 15_000 });
}

export async function cancelSicknessReportViaMenuWithReason(
  page: Page,
  rangeText: string,
  reason: string
): Promise<void> {
  await openSicknessReportMenu(page, rangeText, 'Stornieren');
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await dialog.locator('#cancel-sickness-reason').fill(reason);
  await dialog.getByRole('button', { name: 'Stornieren', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0, { timeout: 15_000 });
  // The row flips to the terminal state — the precise transition, not a text
  // an inherited row could already satisfy.
  await expect(
    page
      .locator('[data-sickness-report]')
      .filter({ hasText: rangeText })
      .getByText('Storniert')
      .first()
  ).toBeVisible({ timeout: 15_000 });
}

// Clock-in on a sick day succeeds with a visible notice (warn, never block).
export async function expectClockInNoticeForSickness(
  page: Page
): Promise<void> {
  await page.goto('/dashboard');
  await page.locator('button[title="Einstempeln"]').click();
  await expect(
    page.getByRole('heading', { name: 'Einstempeln' })
  ).toBeVisible();
  await page.locator('button:not([title])', { hasText: 'Einstempeln' }).click();
  await expect(
    visibleText(page, 'Für heute liegt eine Krankmeldung vor')
  ).toBeVisible({ timeout: 15_000 });
  // Clocked IN despite the notice — the warn-not-block contract.
  await expect(page.locator('button[title="Ausstempeln"]')).toBeVisible({
    timeout: 15_000,
  });
}

// P1-09: teams and qualifications. These steps use stable semantic controls
// and data identities because Realtime refreshes may replace rows mid-step.
export async function createTeamViaManagement(
  page: Page,
  teamName: string
): Promise<void> {
  await page.goto('/mitarbeiter');
  await page.getByRole('tab', { name: 'Teams', exact: true }).click();
  await page.locator('#new-team-name').fill(teamName);
  await page.getByRole('button', { name: 'Team anlegen' }).click();
  await expect(
    page
      .getByTestId('team-card')
      .filter({ hasText: teamName })
  ).toBeVisible({ timeout: 15_000 });
}

export async function addTeamMemberViaManagement(
  page: Page,
  options: { teamName: string; employeeName: string; validFrom?: string }
): Promise<void> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    await page.goto('/mitarbeiter');
    await page.getByRole('tab', { name: 'Teams', exact: true }).click();
    const card = page
      .getByTestId('team-card')
      .filter({ hasText: options.teamName });
    await expect(card).toBeVisible({ timeout: 15_000 });
    const memberRow = card
      .getByTestId('team-member-row')
      .filter({ hasText: options.employeeName })
      .first();
    if (await memberRow.isVisible().catch(() => false)) return;

    await selectFromSearchable(
      page,
      card.getByRole('combobox', {
        name: `Mitglied zu ${options.teamName} hinzufügen`,
      }),
      options.employeeName
    );
    if (options.validFrom) {
      // ISO date → DDMMYYYY segment digits for the DatePicker group.
      const digits = `${options.validFrom.slice(8, 10)}${options.validFrom.slice(5, 7)}${options.validFrom.slice(0, 4)}`;
      await typeIntoDatePicker(
        card,
        `Teamzugehörigkeit zu ${options.teamName} gültig ab`,
        digits
      );
    }
    await card.getByRole('button', { name: 'Hinzufügen' }).click();
    if (
      await memberRow
        .waitFor({ state: 'visible', timeout: 10_000 })
        .then(() => true)
        .catch(() => false)
    ) {
      return;
    }
  }

  throw new Error(`Team member ${options.employeeName} was not persisted`);
}

export async function createCapabilityViaManagement(
  page: Page,
  options: {
    name: string;
    kind: 'Fähigkeit' | 'Zertifizierung';
    warningDays?: number;
  }
): Promise<void> {
  await page.goto('/mitarbeiter');
  await page.getByRole('tab', { name: 'Qualifikationen', exact: true }).click();
  await page.locator('#capability-kind').click();
  await page.getByRole('option', { name: options.kind, exact: true }).click();
  await page.locator('#capability-name').fill(options.name);
  if (options.kind === 'Zertifizierung' && options.warningDays !== undefined) {
    await page
      .locator('#capability-warning-days')
      .fill(String(options.warningDays));
  }
  await page.getByRole('button', { name: 'Anlegen', exact: true }).click();
  const definitionRow = page
    .getByTestId('capability-definition-row')
    .filter({ hasText: options.name });
  try {
    await expect(definitionRow).toBeVisible({ timeout: 15_000 });
  } catch {
    await page.reload();
    await page.getByRole('tab', { name: 'Qualifikationen', exact: true }).click();
    await expect(definitionRow).toBeVisible({ timeout: 15_000 });
  }
}

export async function assignCapabilityViaManagement(
  page: Page,
  options: {
    employeeName: string;
    capabilityName: string;
    validFrom: string;
    validUntil?: string;
    issuer?: string;
    renewalDueDate?: string;
    confirmed?: boolean;
    evidence?: 'Nicht erforderlich' | 'Ausstehend' | 'Erhalten';
    operationalNote?: string;
  }
): Promise<void> {
  await page.goto('/mitarbeiter');
  await page.getByRole('tab', { name: 'Qualifikationen', exact: true }).click();
  await selectFromSearchable(
    page,
    page.getByRole('combobox', { name: 'Mitarbeiter für Qualifikation' }),
    options.employeeName
  );
  await selectFromSearchable(
    page,
    page.getByRole('combobox', { name: 'Qualifikation auswählen' }),
    options.capabilityName
  );
  await typeIntoDatePickerById(
    page.locator('body'),
    'qualification-valid-from',
    options.validFrom
  );
  if (options.validUntil) {
    await typeIntoDatePickerById(
      page.locator('body'),
      'qualification-valid-until',
      options.validUntil
    );
  }
  if (options.issuer !== undefined) {
    await page.locator('#qualification-issuer').fill(options.issuer);
  }
  if (options.renewalDueDate) {
    await typeIntoDatePickerById(
      page.locator('body'),
      'qualification-renewal-date',
      options.renewalDueDate
    );
  }
  if (options.evidence) {
    await page.getByRole('combobox', { name: 'Nachweisstatus' }).click();
    await page.getByRole('option', { name: options.evidence, exact: true }).click();
  }
  const confirmation = page.locator('#qualification-confirmed');
  if (options.confirmed && !(await confirmation.isChecked())) {
    await confirmation.click();
  }
  if (options.operationalNote) {
    await page
      .locator('#qualification-operational-note')
      .fill(options.operationalNote);
  }
  await page.getByRole('button', { name: 'Eintrag speichern' }).click();
  await expect(
    page
      .getByTestId('employee-capability-row')
      .filter({ hasText: options.employeeName })
      .filter({ hasText: options.capabilityName })
  ).toBeVisible({ timeout: 15_000 });
}

export async function renewCapabilityViaManagement(
  page: Page,
  options: {
    employeeName: string;
    capabilityName: string;
    validFrom: string;
    validUntil: string;
  }
): Promise<void> {
  await page.goto('/mitarbeiter');
  await page.getByRole('tab', { name: 'Qualifikationen', exact: true }).click();
  const row = page
    .getByTestId('employee-capability-row')
    .filter({ hasText: options.employeeName })
    .filter({ hasText: options.capabilityName });
  await row.getByRole('button', { name: 'Erneuern' }).click();
  await typeIntoDatePickerById(
    page.locator('body'),
    'qualification-valid-from',
    options.validFrom
  );
  await typeIntoDatePickerById(
    page.locator('body'),
    'qualification-valid-until',
    options.validUntil
  );
  await page.getByRole('button', { name: 'Erneuerung speichern' }).click();
  await expect(
    page
      .getByTestId('employee-capability-row')
      .filter({ hasText: options.capabilityName })
      .filter({ hasText: `bis ${options.validUntil}` })
  ).toBeVisible({ timeout: 15_000 });
}

export async function setApprenticeWarningViaManagement(
  page: Page,
  enabled: boolean
): Promise<void> {
  await page.goto('/mitarbeiter');
  await page.getByRole('tab', { name: 'Qualifikationen', exact: true }).click();
  const checkbox = page.getByRole('checkbox', {
    name: 'Ausbildungs-Hinweis aktivieren',
  });
  if ((await checkbox.isChecked()) !== enabled) {
    await checkbox.click();
    await expect(page.getByText('Einstellung gespeichert.')).toBeVisible({
      timeout: 15_000,
    });
  }
  await expect(checkbox).toBeChecked({ checked: enabled });
}

export async function addJobCapabilityRequirement(
  page: Page,
  options: {
    jobNumber: string;
    capabilityName: string;
    requireConfirmation?: boolean;
  }
): Promise<void> {
  await page.goto(`/auftraege/${options.jobNumber}`);
  await expect(
    page.getByRole('heading', { name: 'Qualifikationsabdeckung' })
  ).toBeVisible({ timeout: 15_000 });
  await selectFromSearchable(
    page,
    page.locator('#job-qualification-capability'),
    options.capabilityName
  );
  if (options.requireConfirmation) {
    await page.locator('#job-require-confirmation').click();
  }
  await page.getByRole('button', { name: 'Hinzufügen' }).click();
  await expect(
    page
      .getByTestId('qualification-coverage-row')
      .filter({ hasText: options.capabilityName })
  ).toBeVisible({ timeout: 15_000 });
}

export async function assignJobWithQualificationWarning(
  page: Page,
  options: {
    jobNumber: string;
    employeeName?: string;
    teamName?: string;
    expectedStatus: string;
    overrideReason: string;
  }
): Promise<void> {
  await page.goto(`/auftraege/${options.jobNumber}`);
  await page.getByRole('button', { name: 'Zuweisen', exact: true }).click();
  const assignmentDialog = page
    .getByRole('dialog')
    .filter({ has: page.getByRole('heading', { name: 'Mitarbeiter zuweisen' }) });
  if (options.teamName) {
    await assignmentDialog
      .getByRole('button', { name: options.teamName, exact: true })
      .click();
  } else if (options.employeeName) {
    await assignmentDialog
      .getByRole('combobox')
      .filter({ hasText: 'Mitarbeiter zuweisen' })
      .click();
    await page.getByPlaceholder('Mitarbeiter suchen...').fill(options.employeeName);
    await page
      .getByRole('listbox')
      .getByRole('button')
      .filter({ hasText: options.employeeName })
      .first()
      .click();
    await assignmentDialog
      .getByRole('heading', { name: 'Mitarbeiter zuweisen' })
      .click();
  }
  await assignmentDialog.getByRole('button', { name: 'Speichern' }).click();
  const warningDialog = page
    .getByRole('dialog')
    .filter({ has: page.getByRole('heading', { name: 'Zuweisung prüfen' }) });
  await expect(warningDialog).toBeVisible({ timeout: 15_000 });
  await expect(
    warningDialog.getByText(options.expectedStatus).first()
  ).toBeVisible();
  await warningDialog
    .locator('#qualification-override-reason')
    .fill(options.overrideReason);
  await warningDialog
    .getByRole('button', { name: 'Trotz Hinweis zuweisen' })
    .click();
  await expect(warningDialog).toHaveCount(0, { timeout: 15_000 });
  if (options.employeeName) {
    await expect(visibleText(page, options.employeeName)).toBeVisible({
      timeout: 15_000,
    });
  }
}

// P1-11: recurring and multi-visit planning. These helpers keep the golden
// spec at the business-action level while the controls remain keyboard-usable.
export type PlanningEntryStepOptions = {
  kind: 'job_visit' | 'internal';
  jobSearch?: string;
  internalTitle?: string;
  internalType?: 'meeting' | 'internal_work' | 'training' | 'other';
  date: string;
  time?: string;
  durationHours?: number;
  durationDays?: number;
  employeeNames?: string[];
  teamNames?: string[];
  recurrence?: {
    frequency?: 'daily' | 'weekly' | 'monthly';
    count: number;
    // German weekday labels (Mo/Di/…) that must be pressed for weekly series;
    // the form preselects the start date's weekday automatically.
    weekdayLabels?: string[];
  };
  overrideReason?: string;
};

async function selectPlanningOption(
  dialog: Locator,
  triggerText: string,
  searchPlaceholder: RegExp,
  optionText: string
): Promise<void> {
  const comboboxes = dialog.getByRole('combobox');
  const alreadySelected = comboboxes.filter({ hasText: optionText }).first();
  if (await alreadySelected.isVisible().catch(() => false)) return;

  await comboboxes.filter({ hasText: triggerText }).click();
  await dialog.getByPlaceholder(searchPlaceholder).fill(optionText);
  await dialog
    .getByRole('listbox')
    .getByRole('button')
    .filter({ hasText: optionText })
    .first()
    .click();
  await dialog.getByRole('heading').first().click();
}

async function finishPlanningSave(
  dialog: Locator,
  firstButtonName: RegExp,
  overrideReason?: string
): Promise<void> {
  await dialog.getByRole('button', { name: firstButtonName }).click();
  await expect
    .poll(async () => {
      if (!(await dialog.isVisible().catch(() => false))) return 'closed';
      if (await dialog.locator('[data-planning-warning]').isVisible().catch(() => false)) {
        return 'warning';
      }
      return 'pending';
    }, { timeout: 30_000 })
    .not.toBe('pending');

  if (!(await dialog.isVisible().catch(() => false))) return;
  if (!overrideReason) {
    throw new Error('Planning produced warnings but no override reason was supplied');
  }
  const reasonInput = dialog.locator(
    '#planning-override, #planning-edit-reason'
  ).first();
  await reasonInput.fill(overrideReason);
  await dialog
    .getByRole('button', {
      name: /Mit Begr.ndung planen|.nderung speichern/,
    })
    .click();
  await expect(dialog).toHaveCount(0, { timeout: 30_000 });
}

export async function createPlannedCalendarEntry(
  page: Page,
  options: PlanningEntryStepOptions
): Promise<void> {
  await page.goto('/kalender');
  await page.getByRole('button', { name: 'Kalendereintrag' }).click();
  const dialog = page
    .getByRole('dialog')
    .filter({ has: page.getByRole('heading', { name: 'Kalendereintrag erstellen' }) });
  await expect(dialog.getByRole('tab', { name: 'Termin planen' })).toBeVisible({
    timeout: 15_000,
  });
  await dialog.getByRole('tab', { name: 'Termin planen' }).click();
  await expect(dialog.locator('#planning-date')).toBeVisible({ timeout: 15_000 });

  if (options.kind === 'job_visit') {
    if (!options.jobSearch) throw new Error('A job search value is required');
    await selectPlanningOption(
      dialog,
      'Auftrag auswählen',
      /Auftrag suchen/,
      options.jobSearch
    );
  } else {
    await dialog.getByRole('button', { name: 'Interner Termin' }).click();
    if (options.internalType && options.internalType !== 'meeting') {
      await dialog.locator('#planning-internal-type').click();
      const internalTypeLabels = {
        internal_work: /Interne Arbeit/,
        training: /Schulung/,
        other: /Sonstiges/,
      } as const;
      await page
        .getByRole('option', { name: internalTypeLabels[options.internalType] })
        .click();
    }
    await dialog
      .locator('#planning-title')
      .fill(options.internalTitle ?? 'Interner Termin');
  }

  await typeIntoDatePickerById(dialog, 'planning-date', options.date);
  if (options.durationDays !== undefined) {
    await dialog.locator('#planning-time-kind').click();
    await page.getByRole('option', { name: /Ganzt.gig/ }).click();
    await dialog.locator('#planning-days').fill(String(options.durationDays));
  } else {
    await typeIntoTimeInput(
      dialog,
      'planning-time',
      (options.time ?? '09:00').replace(':', '')
    );
    // DurationHoursInput keeps the element id on its inner text input.
    await dialog
      .locator('#planning-duration')
      .fill(String(options.durationHours ?? 1));
  }

  for (const employeeName of options.employeeNames ?? []) {
    await selectPlanningOption(
      dialog,
      (options.employeeNames?.length ?? 0) > 1
        ? 'Mitarbeiter'
        : 'Mitarbeiter zuweisen',
      /Mitarbeiter suchen/,
      employeeName
    );
  }
  for (const teamName of options.teamNames ?? []) {
    await dialog.getByRole('button', { name: teamName, exact: true }).click();
  }

  if (options.recurrence) {
    await dialog.getByText('Wiederholen', { exact: true }).click();
    if (options.recurrence.frequency) {
      const frequencyLabels = {
        daily: /T.glich/,
        weekly: /W.chentlich/,
        monthly: /Monatlich/,
      } as const;
      const recurrenceBlock = dialog
        .getByText('Rhythmus', { exact: true })
        .locator('..');
      await recurrenceBlock.getByRole('combobox').click();
      await page
        .getByRole('option', { name: frequencyLabels[options.recurrence.frequency] })
        .click();
    }
    // Scope weekday toggles to the Wochentage row so short labels (Mo/Di/…)
    // can never match another dialog button (e.g. a team named alike).
    const weekdayRow = dialog
      .getByText('Wochentage', { exact: true })
      .locator('..');
    for (const weekdayLabel of options.recurrence.weekdayLabels ?? []) {
      const weekdayButton = weekdayRow.getByRole('button', {
        name: weekdayLabel,
        exact: true,
      });
      if ((await weekdayButton.getAttribute('aria-pressed')) !== 'true') {
        await weekdayButton.click();
      }
    }
    await dialog
      .locator('#planning-count')
      .fill(String(options.recurrence.count));
  }

  await finishPlanningSave(
    dialog,
    /Planung pr.fen und speichern/,
    options.overrideReason
  );
}

export function plannedCalendarEvent(
  page: Page,
  title: string,
  index = 0
): Locator {
  return page.locator('.fc-event-job').filter({ hasText: title }).nth(index);
}

export async function showPlanningMonth(
  page: Page,
  targetDate?: string
): Promise<void> {
  await page.goto('/kalender');
  await page.getByRole('tab', { name: 'Monat', exact: true }).click();
  if (!targetDate) return;
  const todayParts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Europe/Berlin',
      year: 'numeric',
      month: '2-digit',
    })
      .formatToParts(new Date())
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, Number(part.value)])
  );
  const [targetYear, targetMonth] = targetDate.split('-').map(Number);
  const monthDifference =
    (targetYear - todayParts.year) * 12 +
    (targetMonth - todayParts.month);
  const direction = monthDifference >= 0 ? 'Weiter' : /Zur.ck/;
  for (let index = 0; index < Math.abs(monthDifference); index += 1) {
    await page.getByRole('button', { name: direction }).click();
  }
}

export async function editPlannedCalendarOccurrence(
  page: Page,
  options: {
    title: string;
    eventIndex?: number;
    scope: 'one' | 'future' | 'series';
    date?: string;
    time?: string;
    durationHours?: number;
    overrideReason?: string;
    calendarDate?: string;
  }
): Promise<void> {
  await showPlanningMonth(page, options.calendarDate);
  const event = plannedCalendarEvent(page, options.title, options.eventIndex ?? 0);
  await expect(event).toBeVisible({ timeout: 20_000 });
  await event.click();
  await page.getByRole('button', { name: 'Termin bearbeiten' }).click();
  const dialog = page
    .getByRole('dialog')
    .filter({ has: page.getByRole('heading', { name: 'Geplanten Termin bearbeiten' }) });
  if (options.scope !== 'one') {
    await dialog.locator('#planning-edit-scope').click();
    const scopeLabels = {
      future: /Dieser und zuk.nftige/,
      series: /Ganze Serie/,
    } as const;
    await page
      .getByRole('option')
      .filter({ hasText: scopeLabels[options.scope] })
      .first()
      .click();
  }
  if (options.date) {
    await typeIntoDatePickerById(dialog, 'planning-edit-date', options.date);
  }
  if (options.time) {
    await typeIntoTimeInput(
      dialog,
      'planning-edit-time',
      options.time.replace(':', '')
    );
  }
  if (options.durationHours !== undefined) {
    await dialog
      .locator('#planning-edit-duration')
      .fill(String(options.durationHours));
  }
  await finishPlanningSave(dialog, /.nderung speichern/, options.overrideReason);
}

export async function setPlannedCalendarOccurrenceStatus(
  page: Page,
  options: {
    title: string;
    eventIndex?: number;
    calendarDate: string;
    status: 'skip' | 'cancel';
    reason: string;
  }
): Promise<void> {
  await showPlanningMonth(page, options.calendarDate);
  const event = plannedCalendarEvent(page, options.title, options.eventIndex ?? 0);
  await expect(event).toBeVisible({ timeout: 20_000 });
  await event.click();
  await page.getByRole('button', { name: 'Termin bearbeiten' }).click();
  const dialog = page
    .getByRole('dialog')
    .filter({ has: page.getByRole('heading', { name: 'Geplanten Termin bearbeiten' }) });
  await dialog
    .getByRole('button', {
      // The cancel action renders as "Termin absagen" in the dialog footer.
      name: options.status === 'skip' ? 'Auslassen' : 'Termin absagen',
      exact: true,
    })
    .click();
  await dialog.locator('#planning-status-reason').fill(options.reason);
  await dialog.getByRole('button', { name: 'Status speichern' }).click();
  await expect(dialog).toHaveCount(0, { timeout: 20_000 });
}

// P1-12: dispatch, Parkplatz context, customer commitments, batch moves.

export async function openDispatchPanel(page: Page): Promise<void> {
  await page.goto('/kalender');
  await page.getByTestId('dispatch-panel-toggle').click();
  await expect(page.locator('[data-dispatch-panel]')).toBeVisible({
    timeout: 15_000,
  });
}

export function dispatchOccurrenceRow(page: Page, title: string): Locator {
  return page
    .locator('[data-dispatch-occurrence]')
    .filter({ hasText: title });
}

// Issues the dispatch for the earliest panel row matching the title, and
// asserts the honest readiness picture on the way: tools are never assessed
// in this slice and must render as the labeled unknown, never as success.
export async function issueDispatchForOccurrence(
  page: Page,
  title: string
): Promise<void> {
  const row = dispatchOccurrenceRow(page, title).first();
  await expect(row).toBeVisible({ timeout: 20_000 });
  await row.getByRole('button', { name: 'Einsatz senden' }).click();
  const dialog = page
    .getByRole('dialog')
    .filter({ has: page.getByRole('heading', { name: 'Einsatz senden' }) });
  await expect(
    dialog.locator('[data-readiness-key="tools"][data-readiness-state="unknown"]')
  ).toBeVisible({ timeout: 20_000 });
  await dialog.getByRole('button', { name: 'Einsatz senden' }).click();
  await expect(dialog).toHaveCount(0, { timeout: 20_000 });
  await expect(row.locator('[data-recipient-state]').first()).toBeVisible({
    timeout: 20_000,
  });
}

export async function expectDispatchStateOnJobPage(
  page: Page,
  jobNumber: string,
  state: string
): Promise<void> {
  await page.goto(`/auftraege/${jobNumber}`);
  const section = page.getByTestId('job-dispatch-section');
  await expect(
    section.locator(`[data-dispatch-state="${state}"]`)
  ).toBeVisible({ timeout: 20_000 });
}

export async function acknowledgeDispatchOnJobPage(
  page: Page,
  jobNumber: string
): Promise<void> {
  await page.goto(`/auftraege/${jobNumber}`);
  const section = page.getByTestId('job-dispatch-section');
  await expect(section).toBeVisible({ timeout: 20_000 });
  await section.getByRole('button', { name: 'Einsatz bestätigen' }).click();
  await expect(
    section.locator('[data-dispatch-state="bestaetigt"]')
  ).toBeVisible({ timeout: 20_000 });
}

export async function challengeDispatchOnJobPage(
  page: Page,
  jobNumber: string,
  reason: string
): Promise<void> {
  await page.goto(`/auftraege/${jobNumber}`);
  const section = page.getByTestId('job-dispatch-section');
  await expect(section).toBeVisible({ timeout: 20_000 });
  await section.getByRole('button', { name: 'Rückfrage stellen' }).click();
  const dialog = page
    .getByRole('dialog')
    .filter({ has: page.getByRole('heading', { name: 'Rückfrage zum Einsatz' }) });
  await dialog.locator('#dispatch-challenge-reason').fill(reason);
  await dialog.getByRole('button', { name: 'Rückfrage senden' }).click();
  await expect(dialog).toHaveCount(0, { timeout: 20_000 });
  await expect(
    section.locator('[data-dispatch-state="rueckfrage"]')
  ).toBeVisible({ timeout: 20_000 });
}

export async function resolveDispatchChallengeInPanel(
  page: Page,
  reason: string
): Promise<void> {
  const panel = page.locator('[data-dispatch-panel]');
  await panel
    .getByRole('button', { name: /Plan beibehalten/ })
    .first()
    .click();
  const dialog = page
    .getByRole('dialog')
    .filter({ has: page.getByRole('heading', { name: 'Plan beibehalten' }) });
  await dialog.locator('#dispatch-reason-dialog').fill(reason);
  await dialog.getByRole('button', { name: 'Beibehalten', exact: true }).click();
  await expect(dialog).toHaveCount(0, { timeout: 20_000 });
}

export async function openParkplatzPanel(page: Page): Promise<void> {
  await page.goto('/kalender');
  // The button's accessible name includes the live count badge.
  await page.getByRole('button', { name: /^Parkplatz/ }).click();
  await expect(page.locator('[data-parkplatz-panel]')).toBeVisible({
    timeout: 15_000,
  });
}

export function parkplatzCard(page: Page, title: string): Locator {
  // Filter instead of interpolating the title into a CSS selector.
  return page
    .locator('[data-parkplatz-pill]')
    .filter({ has: page.getByText(title, { exact: true }) });
}

export async function setParkingContextFromParkplatz(
  page: Page,
  options: {
    jobTitle: string;
    reasonLabel: string;
    note?: string;
    responsibleName?: string;
    reviewDigits?: string;
  }
): Promise<void> {
  const card = parkplatzCard(page, options.jobTitle);
  await expect(card).toBeVisible({ timeout: 20_000 });
  // The buttons carry job-specific aria-labels ("Parkplatz-Kontext für <Titel>
  // ergänzen"); match the full accessible name.
  await card
    .getByRole('button', { name: /Kontext.*(ergänzen|bearbeiten)/ })
    .click();
  const dialog = page
    .getByRole('dialog')
    .filter({ has: page.getByRole('heading', { name: 'Parkplatz-Kontext' }) });
  await dialog.locator('#parking-reason').click();
  await page.getByRole('option', { name: options.reasonLabel, exact: true }).click();
  if (options.note) await dialog.locator('#parking-note').fill(options.note);
  if (options.responsibleName) {
    await selectFromSearchable(
      page,
      dialog.locator('#parking-responsible'),
      options.responsibleName
    );
  }
  if (options.reviewDigits) {
    await typeIntoDatePicker(dialog, 'Wiedervorlagedatum', options.reviewDigits);
  }
  await dialog.getByRole('button', { name: 'Kontext speichern' }).click();
  await expect(dialog).toHaveCount(0, { timeout: 20_000 });
}

export async function dispatchParkedJobFromParkplatz(
  page: Page,
  options: { jobTitle: string; recipientName: string }
): Promise<void> {
  const card = parkplatzCard(page, options.jobTitle);
  await expect(card).toBeVisible({ timeout: 20_000 });
  await card
    .getByRole('button', { name: /^Einsatz für .* senden$/ })
    .click();
  const dialog = page
    .getByRole('dialog')
    .filter({ has: page.getByRole('heading', { name: 'Einsatz senden' }) });
  await expect(
    dialog.locator('[data-readiness-key="tools"][data-readiness-state="unknown"]')
  ).toBeVisible({ timeout: 20_000 });
  await dialog
    .getByRole('checkbox', {
      name: `${options.recipientName} als Empfänger auswählen`,
    })
    .check();
  await dialog.getByRole('button', { name: 'Einsatz senden' }).click();
  await expect(dialog).toHaveCount(0, { timeout: 20_000 });
}

// Records a date-only customer commitment for the panel row (the dialog
// prefills the occurrence's Berlin date). Recording sends NO message.
export async function recordCommitmentForOccurrence(
  page: Page,
  title: string
): Promise<void> {
  const row = dispatchOccurrenceRow(page, title).first();
  await expect(row).toBeVisible({ timeout: 20_000 });
  await row
    .getByRole('button', { name: /^(Zusage erfassen|Neue Zusage erfassen)$/ })
    .click();
  const dialog = page
    .getByRole('dialog')
    .filter({ has: page.getByRole('heading', { name: 'Kundenzusage erfassen' }) });
  await dialog.getByRole('button', { name: 'Zusage erfassen' }).click();
  await expect(dialog).toHaveCount(0, { timeout: 20_000 });
}

export async function startBatchRescheduleInPanel(
  page: Page,
  options: {
    titles: string[];
    /** Total rows the selection must cover across all titles. */
    expectedCount: number;
    dayShiftText: string;
    reason: string;
  }
): Promise<Locator> {
  const panel = page.locator('[data-dispatch-panel]');
  await panel.getByRole('button', { name: 'Verschieben', exact: true }).click();
  for (const title of options.titles) {
    const rows = panel
      .locator('[data-dispatch-occurrence]')
      .filter({ hasText: title });
    const rowCount = await rows.count();
    for (let index = 0; index < rowCount; index += 1) {
      await rows.nth(index).getByRole('checkbox').check();
    }
  }
  // A Realtime re-render between clicks could reorder rows; the panel's own
  // selection counter is the authoritative proof every row got selected.
  await expect(
    panel.getByText(
      `${options.expectedCount} Besuch${options.expectedCount === 1 ? '' : 'e'} ausgewählt`,
      { exact: true }
    )
  ).toBeVisible({ timeout: 10_000 });
  await panel.locator('#batch-day-shift').fill(options.dayShiftText);
  await panel.locator('#batch-reason').fill(options.reason);
  await panel.getByRole('button', { name: 'Auswirkungen prüfen' }).click();
  const preview = page
    .getByRole('dialog')
    .filter({ has: page.getByRole('heading', { name: 'Verschiebung prüfen' }) });
  await expect(preview).toBeVisible({ timeout: 30_000 });
  return preview;
}

// Commits the previewed batch. The separate planning-warning dialog appears
// only when the shared assessment found conflicts (e.g. the focused world has
// no schedules); supplying the override reason covers both modes.
export async function confirmBatchReschedule(
  page: Page,
  preview: Locator,
  overrideReason: string
): Promise<void> {
  await preview.getByRole('button', { name: 'Jetzt verschieben' }).click();
  const warning = page
    .getByRole('dialog')
    .filter({ has: page.getByRole('heading', { name: 'Planungshinweise prüfen' }) });
  await expect
    .poll(
      async () => {
        if (await warning.isVisible().catch(() => false)) return 'warning';
        if (!(await preview.isVisible().catch(() => false))) return 'closed';
        return 'pending';
      },
      { timeout: 30_000 }
    )
    .not.toBe('pending');
  if (await warning.isVisible().catch(() => false)) {
    await warning.locator('#planning-warning-reason').fill(overrideReason);
    await warning
      .getByRole('button', { name: 'Mit Begründung speichern' })
      .click();
  }
  await expect(preview).toHaveCount(0, { timeout: 30_000 });
}

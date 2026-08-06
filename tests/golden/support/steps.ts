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
  options?: { type?: 'Privat' | 'Gewerblich' }
): Promise<void> {
  await page.goto('/kunden');
  await page.getByRole('button', { name: 'Kunde hinzufügen' }).click();
  await expect(page.getByRole('heading', { name: 'Neuen Kunden anlegen' })).toBeVisible();
  await page.locator('#client-name').fill(name);
  if (options?.type) {
    await page.locator('#client-type').click();
    await page.getByRole('option', { name: options.type, exact: true }).click();
  }
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
    siteName?: string;
    contactName?: string;
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

  if (options.siteName) {
    // The site select appears once the customer's sites finished loading.
    await expect(page.locator('#job-site')).toBeVisible({ timeout: 15_000 });
    await page.locator('#job-site').click();
    await page
      .getByRole('option')
      .filter({ hasText: options.siteName })
      .first()
      .click();
  }

  if (options.contactName) {
    await expect(page.locator('#job-contact')).toBeVisible({ timeout: 15_000 });
    await page.locator('#job-contact').click();
    await page
      .getByRole('option')
      .filter({ hasText: options.contactName })
      .first()
      .click();
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
  // The dialog closes on success; the caller asserts the job row afterwards.
  await expect(
    page.getByRole('heading', { name: 'Neuen Auftrag oder Projekt erstellen' })
  ).toBeHidden({ timeout: 15_000 });
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
  await expect(page.getByRole('heading', { name: 'Einstempeln' })).toBeVisible();

  if (jobTitle) {
    await page.getByRole('button').filter({ hasText: jobTitle }).first().click();
  }

  // The modal's confirm button also says "Einstempeln" but has no title attr.
  await page.locator('button:not([title])', { hasText: 'Einstempeln' }).click();
  await expect(page.locator('button[title="Ausstempeln"]')).toBeVisible({ timeout: 15_000 });
}

export async function clockOut(page: Page): Promise<void> {
  await page.locator('button[title="Ausstempeln"]').click();
  await expect(page.locator('button[title="Einstempeln"]')).toBeVisible({ timeout: 15_000 });
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
  await visibleText(page, customerName).click();
  await expect(visibleText(page, 'Kundendetails')).toBeVisible({ timeout: 15_000 });
}

export async function addContactOnCustomerDetail(
  page: Page,
  contact: { name: string; role?: string; phone?: string }
): Promise<void> {
  await page.getByRole('button', { name: 'Ansprechpartner hinzufügen' }).click();
  await expect(
    page.getByRole('heading', { name: 'Ansprechpartner hinzufügen' })
  ).toBeVisible();
  await page.locator('#contact-name').fill(contact.name);
  if (contact.role) await page.locator('#contact-role').fill(contact.role);
  if (contact.phone) await page.locator('#contact-phone').fill(contact.phone);
  await page.getByRole('dialog').getByRole('button', { name: 'Speichern' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0, { timeout: 15_000 });
  await expectVisibleAfterSave(page, contact.name);
}

export async function addSiteOnCustomerDetail(
  page: Page,
  site: { name: string; street?: string; postalCode?: string; city?: string }
): Promise<void> {
  await page.getByRole('button', { name: 'Einsatzort hinzufügen' }).click();
  await expect(
    page.getByRole('heading', { name: 'Einsatzort hinzufügen' })
  ).toBeVisible();
  await page.locator('#site-name').fill(site.name);
  if (site.street) await page.locator('#site-street').fill(site.street);
  if (site.postalCode) await page.locator('#site-postal-code').fill(site.postalCode);
  if (site.city) await page.locator('#site-city').fill(site.city);
  await page.getByRole('dialog').getByRole('button', { name: 'Speichern' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0, { timeout: 15_000 });
  await expectVisibleAfterSave(page, site.name);
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
    categoryLabel?: string;
    urgencyLabel?: string;
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
    await page.locator('#request-site').click();
    await page.getByRole('option').filter({ hasText: options.siteName }).first().click();
  }
  if (options.contactName) {
    await expect(page.locator('#request-contact')).toBeVisible({ timeout: 15_000 });
    await page.locator('#request-contact').click();
    await page.getByRole('option').filter({ hasText: options.contactName }).first().click();
  }

  if (options.callerName) {
    await page.locator('#request-caller-name').fill(options.callerName);
  }
  if (options.callerPhone) {
    await page.locator('#request-caller-phone').fill(options.callerPhone);
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
    await page.locator('#convert-date').fill(options.plannedDate);
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

export async function closeRequestViaDialog(
  page: Page,
  reasonLabel: string
): Promise<void> {
  await page.getByRole('button', { name: 'Schließen', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Anfrage ohne Auftrag schließen' })
  ).toBeVisible();
  await page.locator('#close-reason').click();
  await page.getByRole('option', { name: reasonLabel, exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Anfrage schließen' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0, { timeout: 15_000 });
  await expect(visibleText(page, 'Ohne Auftrag geschlossen:')).toBeVisible({
    timeout: 15_000,
  });
}

// P1-03: personnel identity and date-effective employment conditions.

export async function openMemberDetailFromList(page: Page, name: string): Promise<void> {
  await page.goto('/mitarbeiter');
  await visibleText(page, name).click();
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
  digits: string
): Promise<void> {
  const group = scope.getByRole('group', { name: groupName });
  await group.click();
  // The click may land on any segment; ArrowLeft twice normalizes to the day
  // segment because the control has exactly day, month, and year segments.
  await group.press('ArrowLeft');
  await group.press('ArrowLeft');
  await group.pressSequentially(digits, { delay: 50 });
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
    await delegatorTrigger.click();
    await page.getByRole('option', { name: options.delegatorName }).click();
  }
  await dialog.locator(`#${options.responsibility}-substitute`).click();
  await page.getByRole('option', { name: options.substituteName }).click();
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

async function typeIntoTimeInput(
  dialog: Locator,
  id: string,
  digits: string
): Promise<void> {
  const group = dialog.locator(`#${id}`);
  await group.click();
  // TimeInput has hour and minute segments, so one ArrowLeft reaches hours.
  await group.press('ArrowLeft');
  await group.pressSequentially(digits, { delay: 50 });
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
  await expect(dialog.getByText('Antrag wurde zur Genehmigung eingereicht.')).toBeVisible({
    timeout: 15_000,
  });
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
    timeout: 15_000,
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
  userId: string
): Promise<void> {
  const card = pendingTimeApprovalCard(page, userId);
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
  await page.getByRole('button', { name: 'Kondition hinzufügen' }).click();
  await expect(
    page.getByRole('heading', { name: 'Kondition hinzufügen' })
  ).toBeVisible();

  const dialog = page.getByRole('dialog');
  if (options.validFromDigits) {
    await typeIntoDatePicker(dialog, 'Gültig ab', options.validFromDigits);
  }

  await page.locator('#condition-type').click();
  await page
    .getByRole('option', { name: options.employmentTypeLabel, exact: true })
    .click();

  if (options.weeklyHours !== undefined) {
    await page.locator('#condition-weekly-hours').fill(options.weeklyHours);
  }
  if (options.vacationDays !== undefined) {
    await page.locator('#condition-vacation-days').fill(options.vacationDays);
  }
  if (options.note !== undefined) {
    await page.locator('#condition-note').fill(options.note);
  }

  await dialog.getByRole('button', { name: 'Speichern', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0, { timeout: 15_000 });
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
  await page.waitForURL(/\/mitarbeiter\/[0-9a-f-]{36}/, { timeout: 20_000 });

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
  await expect(page.getByText('Einladung erfolgreich gesendet!')).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByRole('dialog')).toHaveCount(0, { timeout: 10_000 });
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
  await page.getByRole('button', { name: 'Wochenplan hinzufügen' }).click();
  await expect(
    page.getByRole('heading', { name: 'Wochenplan hinzufügen' })
  ).toBeVisible();

  const dialog = page.getByRole('dialog');
  if (options.validFromDigits) {
    await typeIntoDatePicker(dialog, 'Gültig ab', options.validFromDigits);
  }
  if (options.dayHours) {
    for (let index = 0; index < options.dayHours.length; index++) {
      await page.locator(`#schedule-day-${index}`).fill(options.dayHours[index]);
    }
  }
  if (options.note !== undefined) {
    await page.locator('#schedule-note').fill(options.note);
  }

  await dialog.getByRole('button', { name: 'Speichern', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0, { timeout: 15_000 });
}

export async function setHolidayRegionViaSettings(
  page: Page,
  regionLabel: string
): Promise<void> {
  await page.goto('/einstellungen/zeiterfassung');
  await page.locator('#holiday-region').click();
  await page.getByRole('option', { name: regionLabel, exact: true }).click();
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
  // Exactly one pending request is expected when this step runs.
  const row = page
    .locator('li')
    .filter({ has: page.getByRole('button', { name: 'Zurückziehen' }) })
    .filter({ visible: true })
    .first();
  await row.getByRole('button', { name: 'Zurückziehen' }).click();
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

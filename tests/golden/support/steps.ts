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
  // The list appears after a router.refresh of the heavy customer detail;
  // shared-database latency spikes have pushed this past 15s in real runs.
  await expect(visibleText(page, contact.name)).toBeVisible({ timeout: 30_000 });
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
  // Same slow-refresh allowance as addContactOnCustomerDetail.
  await expect(visibleText(page, site.name)).toBeVisible({ timeout: 30_000 });
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
  await expect(visibleText(page, newStreet)).toBeVisible({ timeout: 15_000 });
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
): Promise<void> {
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

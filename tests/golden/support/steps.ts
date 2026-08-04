import { expect, type Locator, type Page } from '@playwright/test';

// Pages often render the same text twice (desktop table + hidden mobile card);
// assertions must target the visible instance.
export function visibleText(page: Page, text: string): Locator {
  return page.getByText(text).filter({ visible: true }).first();
}

// Reusable business-step helpers. Golden-gate specs compose these steps; when
// a slice changes the UI, update the step here once and every gate follows.

export async function createCustomer(page: Page, name: string): Promise<void> {
  await page.goto('/kunden');
  await page.getByRole('button', { name: 'Kunde hinzufügen' }).click();
  await expect(page.getByRole('heading', { name: 'Neuen Kunden anlegen' })).toBeVisible();
  await page.locator('#client-name').fill(name);
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

export async function uploadDocumentOnJobPage(
  page: Page,
  jobNumber: string,
  filePath: string,
  expectedFileName: string
): Promise<void> {
  await page.goto(`/auftraege/${jobNumber}`);
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

export async function expectRedirectedAway(page: Page, path: string): Promise<void> {
  await page.goto(path);
  await expect(page).not.toHaveURL(new RegExp(`${path.replace('/', '\\/')}$`), {
    timeout: 15_000,
  });
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

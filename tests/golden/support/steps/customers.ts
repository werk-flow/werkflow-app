import { expect, type Page } from "@playwright/test";
import { expectVisibleAfterSave, selectFromSearchable, typeIntoDateTimeField, visibleText } from './shared';

// Reusable business-step helpers. Golden-gate specs compose these steps; when
// a slice changes the UI, update the step here once and every gate follows.

export async function createCustomer(
  page: Page,
  name: string,
  options?: { type?: "Privat" | "Gewerblich"; address?: string;
    beforeSubmit?: () => void | Promise<void>;
    /**
     * The caller already prepared the page on /kunden (for example after
     * waiting for its own Realtime readiness). A fresh navigation would
     * restart that page's load burst inside a measured window.
     */
    navigate?: boolean;
  },
): Promise<void> {
  if (options?.navigate !== false) await page.goto("/kunden");
  await page.getByRole("button", { name: "Kunde hinzufügen" }).click();
  await expect(
    page.getByRole("heading", { name: "Neuen Kunden anlegen" }),
  ).toBeVisible();
  await page.locator("#client-name").fill(name);
  if (options?.type) {
    await page.locator("#client-type").click();
    await page.getByRole("option", { name: options.type, exact: true }).click();
  }
  if (options?.address)
    await page.locator("#client-address").fill(options.address);
  await options?.beforeSubmit?.();
  await page.getByRole("button", { name: "Kunde erstellen" }).click();
  await expect(page.getByText("Kunde erfolgreich erstellt!")).toBeVisible();
  // Dialog closes itself after the success flash.
  await expect(
    page.getByRole("heading", { name: "Neuen Kunden anlegen" }),
  ).toBeHidden({
    timeout: 10_000,
  });
}

export async function openCustomerDetail(
  page: Page,
  customerName: string,
): Promise<void> {
  await page.goto("/kunden");
  const customerRow = page
    .locator("tbody tr:visible")
    .filter({ hasText: customerName })
    .first();
  await expect(customerRow).toBeVisible({ timeout: 15_000 });
  const customerLink = customerRow.getByRole("link", {
    name: customerName,
    exact: true,
  });
  const customerHref = await customerLink.getAttribute("href");
  if (!customerHref?.match(/^\/kunden\/[0-9a-f-]{36}$/)) {
    throw new Error(
      `openCustomerDetail: invalid customer detail link for ${customerName}`,
    );
  }
  // The customer list can refresh between pointer-down and navigation. Use
  // the verified semantic link target for one deterministic read-only goto.
  await page.goto(customerHref);
  await page.waitForURL(/\/kunden\/[0-9a-f-]{36}$/, { timeout: 15_000 });
  await expect(visibleText(page, "Kundendetails")).toBeVisible({
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
  await page
    .getByRole("button", { name: "Ansprechpartner hinzufügen" })
    .click();
  await expect(
    page.getByRole("heading", { name: "Ansprechpartner hinzufügen" }),
  ).toBeVisible();
  await page.locator("#contact-name").fill(contact.name);
  if (contact.role) await page.locator("#contact-role").fill(contact.role);
  if (contact.phone) await page.locator("#contact-phone").fill(contact.phone);
  if (contact.email) await page.locator("#contact-email").fill(contact.email);
  if (contact.notes) await page.locator("#contact-notes").fill(contact.notes);
  if (contact.isPrimary) {
    const checkbox = page.getByRole("checkbox", {
      name: "Als Hauptkontakt festlegen",
    });
    if (!(await checkbox.isChecked())) await checkbox.click();
  }
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Speichern" })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0, { timeout: 15_000 });
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
  await page
    .getByRole("button", { name: "Nachfassaktion", exact: true })
    .click();
  const dialog = page.getByRole("dialog");
  await expect(
    dialog.getByRole("heading", { name: "Nachfassaktion anlegen" }),
  ).toBeVisible();
  await dialog.locator("#follow-up-title").fill(input.title);
  await typeIntoDateTimeField(dialog, "follow-up-due", input.dueAtLocal);
  if (input.note) await dialog.locator("#follow-up-note").fill(input.note);
  if (input.ownerName) {
    await selectFromSearchable(
      page,
      dialog.locator("#follow-up-owner"),
      input.ownerName,
    );
  }
  await input.beforeSubmit?.();
  await dialog.getByRole("button", { name: "Speichern", exact: true }).click();
  await expect(dialog).toHaveCount(0, { timeout: 15_000 });
  await expectVisibleAfterSave(page, input.title);
}

export async function completeFollowUpOnCustomerDetail(
  page: Page,
  title: string,
): Promise<void> {
  await page
    .getByRole("button", {
      name: `Nachfassaktion ${title} erledigen`,
      exact: true,
    })
    .click();
  await expect(page.getByText("Nachfassaktion erledigt.")).toBeVisible({
    timeout: 15_000,
  });
}

export async function configureCustomerCommunicationSettings(
  page: Page,
  input: {
    preferredContactName?: string;
    preferredChannel?: "Telefon" | "E-Mail" | "SMS" | "Brief" | "Persönlich";
    doNotContactInstruction?: string;
    contactTimeNote?: string;
    languageNote?: string;
    accessibilityNote?: string;
    sourceNote?: string;
  },
): Promise<void> {
  await page.getByRole("button", { name: "Allgemein bearbeiten" }).click();
  const dialog = page.getByRole("dialog");
  if (input.preferredContactName) {
    await selectFromSearchable(
      page,
      dialog.locator("#preferred-contact"),
      input.preferredContactName,
    );
  }
  if (input.preferredChannel) {
    await dialog.locator("#preferred-channel").click();
    await page
      .getByRole("option", { name: input.preferredChannel, exact: true })
      .click();
  }
  if (input.doNotContactInstruction) {
    await dialog.locator("#dnc-note").fill(input.doNotContactInstruction);
  }
  if (input.contactTimeNote) {
    await dialog.locator("#contact-time").fill(input.contactTimeNote);
  }
  if (input.languageNote) {
    await dialog.locator("#language-note").fill(input.languageNote);
  }
  if (input.accessibilityNote) {
    await dialog.locator("#accessibility-note").fill(input.accessibilityNote);
  }
  if (input.sourceNote) {
    await dialog.locator("#settings-source").fill(input.sourceNote);
  }
  await dialog.getByRole("button", { name: "Speichern", exact: true }).click();
  await expect(dialog).toHaveCount(0, { timeout: 15_000 });
  if (input.preferredContactName) {
    const communicationSection = page.locator(
      'section[aria-labelledby="communication-heading"]',
    );
    const preferredContactEntry = communicationSection
      .locator("dl > div")
      .filter({ hasText: "Bevorzugter Kontakt" });
    await expect(preferredContactEntry).toContainText(
      input.preferredContactName,
    );
  }
}

export async function setCustomerCommunicationPreference(
  page: Page,
  input: {
    contactName?: string;
    channel: "Telefon" | "E-Mail" | "SMS" | "Brief" | "Persönlich";
    state: "Erlaubt" | "Nicht erlaubt" | "Unbekannt";
    purpose?:
      | "Termin und Service"
      | "Marketing"
      | "Erforderliche kaufmännische Kommunikation";
    sourceNote?: string;
  },
): Promise<void> {
  await page.getByRole("button", { name: "Präferenz", exact: true }).click();
  const dialog = page.getByRole("dialog");
  if (input.contactName) {
    await selectFromSearchable(
      page,
      dialog.locator("#preference-contact"),
      input.contactName,
    );
  }
  await dialog.locator("#preference-channel").click();
  await page.getByRole("option", { name: input.channel, exact: true }).click();
  await dialog.locator("#preference-state").click();
  await page.getByRole("option", { name: input.state, exact: true }).click();
  if (input.purpose) {
    await dialog.locator("#preference-purpose").click();
    await page
      .getByRole("option", { name: input.purpose, exact: true })
      .click();
  }
  if (input.sourceNote) {
    await dialog.locator("#preference-source").fill(input.sourceNote);
  }
  await dialog.getByRole("button", { name: "Speichern", exact: true }).click();
  await expect(dialog).toHaveCount(0, { timeout: 15_000 });
}

export async function proceedThroughContactWarning(
  page: Page,
  contactHrefText: string,
  reason: string,
): Promise<void> {
  await page.getByRole("link", { name: contactHrefText, exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(
    dialog.getByRole("heading", { name: "Kontaktvorgabe prüfen" }),
  ).toBeVisible();
  await dialog.locator("#contact-exception-reason").fill(reason);
  // Chromium keeps the page open when no external tel:/mailto: handler is
  // registered; the database assertion proves the exception write.
  await dialog.getByRole("button", { name: "Begründet fortfahren" }).click();
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
  await page.getByRole("button", { name: "Einsatzort hinzufügen" }).click();
  await expect(
    page.getByRole("heading", { name: "Einsatzort hinzufügen" }),
  ).toBeVisible();
  await page.locator("#site-name").fill(site.name);
  if (site.street) await page.locator("#site-street").fill(site.street);
  if (site.postalCode)
    await page.locator("#site-postal-code").fill(site.postalCode);
  if (site.city) await page.locator("#site-city").fill(site.city);
  if (site.accessNotes)
    await page.locator("#site-access-notes").fill(site.accessNotes);
  if (site.notes) await page.locator("#site-notes").fill(site.notes);
  if (site.primaryContactName) {
    await selectFromSearchable(
      page,
      page.locator("#site-primary-contact"),
      site.primaryContactName,
    );
  }
  if (site.isPrimary) {
    const checkbox = page.getByRole("checkbox", {
      name: "Als Hauptstandort festlegen",
    });
    if (!(await checkbox.isChecked())) await checkbox.click();
  }
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Speichern" })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0, { timeout: 15_000 });
  await expectVisibleAfterSave(page, site.name);
}

export async function archiveCustomerRelation(
  page: Page,
  kind: "Ansprechpartner" | "Einsatzort",
  name: string,
): Promise<void> {
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const row = page
    .locator("li")
    .filter({ has: page.getByRole("button", { name: `${kind} archivieren` }) })
    .filter({
      has: page
        .locator("p")
        .filter({ hasText: new RegExp(`^${escapedName}$`) }),
    })
    .filter({ visible: true })
    .first();
  await row.getByRole("button", { name: `${kind} archivieren` }).click();
  await expect(
    page
      .locator("li")
      .filter({
        has: page.getByRole("button", { name: `${kind} wiederherstellen` }),
      })
      .filter({ hasText: name })
      .filter({ visible: true }),
  ).toHaveCount(1, {
    timeout: 15_000,
  });
}

export async function restoreCustomerRelation(
  page: Page,
  kind: "Ansprechpartner" | "Einsatzort",
  name: string,
): Promise<void> {
  const row = page
    .locator("li")
    .filter({
      has: page.getByRole("button", { name: `${kind} wiederherstellen` }),
    })
    .filter({ hasText: name })
    .filter({ visible: true })
    .first();
  await row.getByRole("button", { name: `${kind} wiederherstellen` }).click();
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const activeRow = () =>
    page
      .locator("li")
      .filter({
        has: page.getByRole("button", { name: `${kind} archivieren` }),
      })
      .filter({
        has: page
          .locator("p")
          .filter({ hasText: new RegExp(`^${escapedName}$`) }),
      })
      .filter({ visible: true })
      .first();
  await expect(
    activeRow().getByRole("button", { name: `${kind} archivieren` }),
  ).toBeVisible({
    timeout: 15_000,
  });
}

export async function adoptCustomerAddressAsSite(page: Page): Promise<void> {
  await page
    .getByRole("button", { name: "Adresse als Einsatzort übernehmen" })
    .click();
  const dialog = page.getByRole("dialog");
  await expect(
    dialog.getByRole("heading", { name: "Einsatzort hinzufügen" }),
  ).toBeVisible();
  await dialog.getByRole("button", { name: "Speichern", exact: true }).click();
  await expect(dialog).toHaveCount(0, { timeout: 15_000 });
  await expectVisibleAfterSave(page, "Hauptstandort");
}

export async function editSiteStreetOnCustomerDetail(
  page: Page,
  siteName: string,
  newStreet: string,
): Promise<void> {
  const siteRow = page
    .locator("li")
    .filter({ hasText: siteName })
    .filter({ visible: true })
    .first();
  await siteRow.getByRole("button", { name: "Einsatzort bearbeiten" }).click();
  await expect(
    page.getByRole("heading", { name: "Einsatzort bearbeiten" }),
  ).toBeVisible();
  await page.locator("#site-street").fill(newStreet);
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Speichern" })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0, { timeout: 15_000 });
  await expectVisibleAfterSave(page, newStreet);
}

export async function searchCustomers(
  page: Page,
  query: string,
): Promise<void> {
  await page.goto("/kunden");
  await page.getByLabel("Kunden durchsuchen").fill(query);
}

import { expect, type Page } from "@playwright/test";
import { uploadIntoDocumentsSection } from './documents';
import { expectVisibleAfterSave, selectFromSearchable, typeIntoDatePickerById, typeIntoDateTimeField, visibleText } from './shared';

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
  },
): Promise<string> {
  if ((options.siteName || options.contactName) && !options.clientName) {
    throw new Error(
      "createRequestViaDialog: siteName/contactName require clientName",
    );
  }

  await page.goto("/anfragen");
  await page.getByRole("button", { name: "Anfrage erfassen" }).click();
  await expect(
    page.getByRole("heading", { name: "Neue Anfrage erfassen" }),
  ).toBeVisible();

  await page.locator("#request-summary").fill(options.summary);
  if (options.requestNumber !== undefined) {
    const requestNumberInput = page.locator("#request-number");
    // The generated suggestion arrives asynchronously. Let it settle before
    // replacing it so Playwright cannot interleave both controlled updates.
    await expect(requestNumberInput).toHaveValue(/.+/, { timeout: 15_000 });
    await requestNumberInput.fill(options.requestNumber);
    await expect(requestNumberInput).toHaveValue(options.requestNumber);
  }

  if (options.categoryLabel) {
    await page.locator("#request-category").click();
    await page
      .getByRole("option", { name: options.categoryLabel, exact: true })
      .click();
  }
  if (options.urgencyLabel) {
    await page.locator("#request-urgency").click();
    await page
      .getByRole("option", { name: options.urgencyLabel, exact: true })
      .click();
  }
  if (options.receivedAtLocal) {
    await typeIntoDateTimeField(
      page.getByRole("dialog"),
      "request-received-at",
      options.receivedAtLocal,
    );
  }

  if (options.clientName) {
    // Same searchable customer combobox as the job dialog.
    await page.getByRole("combobox").filter({ hasText: "Kein Kunde" }).click();
    await page.getByPlaceholder("Kunde suchen...").fill(options.clientName);
    await page
      .getByRole("listbox")
      .getByRole("option")
      .filter({ hasText: options.clientName })
      .first()
      .click();
  }

  if (options.siteName) {
    await expect(page.locator("#request-site")).toBeVisible({
      timeout: 15_000,
    });
    await selectFromSearchable(
      page,
      page.locator("#request-site"),
      options.siteName,
    );
  }
  if (options.contactName) {
    await expect(page.locator("#request-contact")).toBeVisible({
      timeout: 15_000,
    });
    await selectFromSearchable(
      page,
      page.locator("#request-contact"),
      options.contactName,
    );
  }

  if (options.callerName) {
    await page.locator("#request-caller-name").fill(options.callerName);
  }
  if (options.callerPhone) {
    await page.locator("#request-caller-phone").fill(options.callerPhone);
  }
  if (options.callerEmail) {
    await page.locator("#request-caller-email").fill(options.callerEmail);
  }
  if (options.callerAddress) {
    await page.locator("#request-caller-address").fill(options.callerAddress);
  }
  if (options.details) {
    await page.locator("#request-details").fill(options.details);
  }
  if (options.sourceLabel) {
    await page.locator("#request-source").click();
    await page
      .getByRole("option", { name: options.sourceLabel, exact: true })
      .click();
  }
  if (options.assigneeName) {
    await selectFromSearchable(
      page,
      page.locator("#request-assignee"),
      options.assigneeName,
    );
  }

  // The submit button carries the same label as the header trigger; scope it
  // to the dialog. Success navigates straight to the new request detail.
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Anfrage erfassen" })
    .click();
  await page.waitForURL(/\/anfragen\/[0-9a-f-]{36}/, { timeout: 20_000 });
  await expect(visibleText(page, options.summary)).toBeVisible({
    timeout: 15_000,
  });

  const requestId = page.url().match(/\/anfragen\/([0-9a-f-]{36})/)?.[1];
  if (!requestId) {
    throw new Error(
      "createRequestViaDialog: could not read the request id from the URL",
    );
  }
  return requestId;
}

export async function uploadDocumentOnRequestDetail(
  page: Page,
  filePath: string,
  expectedFileName: string,
): Promise<void> {
  // Assumes the request detail page is already open.
  await uploadIntoDocumentsSection(page, filePath, expectedFileName);
}

export async function convertRequestToJobViaDialog(
  page: Page,
  options?: {
    clientName?: string;
    plannedDate?: string;
    workTemplateName?: string;
    qualificationOverrideReason?: string;
  },
): Promise<void> {
  await page.getByRole("button", { name: "Umwandeln" }).click();
  await expect(
    page.getByRole("heading", { name: "Anfrage umwandeln" }),
  ).toBeVisible();

  if (options?.clientName) {
    // Unknown-caller requests must resolve the customer inside the dialog.
    await page
      .getByRole("dialog")
      .getByRole("combobox")
      .filter({ hasText: "Kein Kunde" })
      .click();
    await page.getByPlaceholder("Kunde suchen...").fill(options.clientName);
    await page
      .getByRole("listbox")
      .getByRole("option")
      .filter({ hasText: options.clientName })
      .first()
      .click();
  }

  if (options?.plannedDate) {
    await typeIntoDatePickerById(
      page.getByRole("dialog"),
      "convert-date",
      options.plannedDate,
    );
  }
  if (options?.workTemplateName) {
    await selectFromSearchable(
      page,
      page.getByRole("dialog").locator("#work-template-job"),
      options.workTemplateName,
    );
  }

  // The job number is suggested asynchronously after the dialog opens;
  // submitting before it arrives fails validation like it would for a user.
  await expect(page.locator("#convert-number")).toHaveValue(/.+/, {
    timeout: 15_000,
  });

  await page
    .getByRole("dialog")
    .getByRole("button", { name: "In Auftrag umwandeln" })
    .click();
  if (options?.qualificationOverrideReason) {
    const warningDialog = page
      .getByRole("dialog")
      .filter({ has: page.getByRole("heading", { name: "Zuweisung prüfen" }) });
    await expect(warningDialog).toBeVisible({ timeout: 15_000 });
    await warningDialog
      .locator("#qualification-override-reason")
      .fill(options.qualificationOverrideReason);
    await warningDialog
      .getByRole("button", { name: "Trotz Hinweis zuweisen" })
      .click();
  }
  await expect(page.getByRole("dialog")).toHaveCount(0, { timeout: 20_000 });
  await expect(
    visibleText(page, "Diese Anfrage wurde umgewandelt"),
  ).toBeVisible({
    timeout: 15_000,
  });
}

export async function matchRequestToExistingCustomer(
  page: Page,
  clientName: string,
): Promise<void> {
  await page
    .getByRole("button", { name: "Vorhandenem Kunden zuordnen" })
    .click();
  const dialog = page.getByRole("dialog");
  await expect(
    dialog.getByRole("heading", { name: "Kunden zuordnen" }),
  ).toBeVisible();
  await dialog.getByRole("combobox").filter({ hasText: "Kein Kunde" }).click();
  await page.getByPlaceholder("Kunde suchen...").fill(clientName);
  await page
    .getByRole("listbox")
    .getByRole("option")
    .filter({ hasText: clientName })
    .first()
    .click();
  await dialog.getByRole("button", { name: "Zuordnen", exact: true }).click();
  await expect(dialog).toHaveCount(0, { timeout: 15_000 });
  await expectVisibleAfterSave(page, clientName);
}

export async function convertRequestToProjectViaDialog(
  page: Page,
  projectNumber: string,
  workTemplateName?: string,
): Promise<void> {
  await page.getByRole("button", { name: "Umwandeln" }).click();
  const dialog = page.getByRole("dialog");
  await expect(
    dialog.getByRole("heading", { name: "Anfrage umwandeln" }),
  ).toBeVisible();
  await dialog.getByRole("tab", { name: "Projekt" }).click();
  await expect(dialog.locator("#convert-number")).toHaveValue(/.+/, {
    timeout: 15_000,
  });
  await dialog.locator("#convert-number").fill(projectNumber);
  if (workTemplateName) {
    await selectFromSearchable(
      page,
      dialog.locator("#work-template-project"),
      workTemplateName,
    );
  }
  await dialog.getByRole("button", { name: "In Projekt umwandeln" }).click();
  await expect(dialog).toHaveCount(0, { timeout: 20_000 });
  await expect(
    visibleText(page, "Diese Anfrage wurde umgewandelt"),
  ).toBeVisible({
    timeout: 15_000,
  });
}

export async function setRequestStatusFromDetail(
  page: Page,
  action: "In Klärung setzen" | "Wieder öffnen",
): Promise<void> {
  await page.getByRole("button", { name: action, exact: true }).click();
  const expectedAction = page.getByRole("button", {
    name:
      action === "In Klärung setzen" ? "Zurück auf Offen" : "In Klärung setzen",
    exact: true,
  });
  await expect(expectedAction).toBeVisible({ timeout: 15_000 });
  await page.reload();
  await expect(expectedAction).toBeVisible({ timeout: 15_000 });
}

export async function closeRequestViaDialog(
  page: Page,
  reasonLabel: string,
): Promise<void> {
  const detailUrl = page.url();
  for (let attempt = 0; attempt < 2; attempt += 1) {
    if (page.url() !== detailUrl) await page.goto(detailUrl);
    // The request-created event can reach the newly mounted detail page after
    // navigation. Drain the shared 150 ms router-refresh debounce (REALTIME_DEBOUNCE_MS) first.
    await page.waitForTimeout(300);
    if (page.url() !== detailUrl) {
      if (attempt === 0) continue;
      throw new Error("closeRequestViaDialog: detail route refreshed away");
    }

    await page.getByRole("button", { name: "Schließen", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "Anfrage ohne Auftrag schließen" }),
    ).toBeVisible();
    const dialog = page.getByRole("dialog");
    try {
      await dialog.locator("#close-reason").click({ timeout: 5_000 });
      await page
        .getByRole("option", { name: reasonLabel, exact: true })
        .click({ timeout: 5_000 });
      await dialog
        .getByRole("button", { name: "Anfrage schließen" })
        .click({ timeout: 5_000 });
      await expect(page.getByRole("dialog")).toHaveCount(0, {
        timeout: 15_000,
      });
    } catch (error) {
      const dialogWasInterrupted =
        page.url() !== detailUrl ||
        !(await dialog.isVisible().catch(() => false));
      if (attempt === 0 && dialogWasInterrupted) continue;
      throw error;
    }

    // Reload from the server so success cannot be confused with a client-side
    // modal close that raced the Realtime refresh.
    await page.goto(detailUrl);
    const persistedClosedReason = await expect(
      visibleText(page, "Ohne Auftrag geschlossen:"),
    )
      .toBeVisible({ timeout: 5_000 })
      .then(() => true)
      .catch(() => false);
    if (persistedClosedReason) return;
    if (attempt === 1) {
      throw new Error(
        "closeRequestViaDialog: request remained open after retry",
      );
    }
  }
}

// Assigns a responsible person on the currently open request detail page via
// the edit dialog (P1-02 storage, first surfaced as an ownership signal here).
export async function assignRequestAssigneeViaEditDialog(
  page: Page,
  assigneeName: string,
): Promise<void> {
  await page.getByRole("button", { name: "Bearbeiten", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await selectFromSearchable(
    page,
    dialog.locator("#edit-request-assignee"),
    assigneeName,
  );
  await dialog.getByRole("button", { name: "Speichern", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0, { timeout: 15_000 });
  await expectVisibleAfterSave(page, assigneeName);
}

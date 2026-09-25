import { expect, type Locator, type Page } from "@playwright/test";
import { escapeRegExp, selectFromSearchable, typeIntoDatePickerById, visibleText } from './shared';

export async function createMaintenanceCoverageViaDialog(
  page: Page,
  options: {
    clientName: string;
    siteName: string;
    reference: string;
    validFrom: string;
    validUntil: string;
    noticeDate: string;
    renewalDate: string;
    reviewDueDate: string;
    operationalNote?: string;
  },
): Promise<void> {
  await page.goto("/service/wartung");
  await page.getByRole("button", { name: "Abdeckung erfassen" }).click();
  const dialog = page.getByRole("dialog");
  await selectFromSearchable(
    page,
    dialog.locator("#coverage-client"),
    options.clientName,
  );
  await selectFromSearchable(
    page,
    dialog.locator("#coverage-site"),
    options.siteName,
  );
  await dialog.locator("#coverage-reference").fill(options.reference);
  await typeIntoDatePickerById(
    dialog,
    "coverage-valid-from",
    options.validFrom,
  );
  await typeIntoDatePickerById(
    dialog,
    "coverage-valid-until",
    options.validUntil,
  );
  await typeIntoDatePickerById(dialog, "coverage-notice", options.noticeDate);
  await typeIntoDatePickerById(dialog, "coverage-renewal", options.renewalDate);
  await typeIntoDatePickerById(
    dialog,
    "coverage-review",
    options.reviewDueDate,
  );
  if (options.operationalNote) {
    await dialog.locator("#coverage-note").fill(options.operationalNote);
  }
  await dialog.getByRole("button", { name: "Abdeckung speichern" }).click();
  await expect(dialog).toHaveCount(0, { timeout: 20_000 });
  await page.getByRole("tab", { name: /Abdeckungen/ }).click();
  await expect(visibleText(page, options.reference)).toBeVisible({
    timeout: 20_000,
  });
}

export async function createMaintenancePlanViaDialog(
  page: Page,
  options: {
    clientName: string;
    siteName: string;
    coverageReference?: string;
    templateName: string;
    equipmentName: string;
    effectiveFrom: string;
    firstDue: string;
    intervalMonths?: string;
    instructions?: string;
    overlapReason?: string;
  },
): Promise<void> {
  await page.goto("/service/wartung");
  await page.getByRole("button", { name: "Wartungsplan anlegen" }).click();
  const dialog = page.getByRole("dialog");
  await selectFromSearchable(
    page,
    dialog.locator("#maintenance-client"),
    options.clientName,
  );
  await selectFromSearchable(
    page,
    dialog.locator("#maintenance-site"),
    options.siteName,
  );
  if (options.coverageReference) {
    await selectFromSearchable(
      page,
      dialog.locator("#maintenance-coverage"),
      options.coverageReference,
    );
  }
  await selectFromSearchable(
    page,
    dialog.locator("#maintenance-template"),
    options.templateName,
  );
  await typeIntoDatePickerById(
    dialog,
    "maintenance-effective",
    options.effectiveFrom,
  );
  await typeIntoDatePickerById(
    dialog,
    "maintenance-first-due",
    options.firstDue,
  );
  if (options.intervalMonths) {
    await dialog.locator("#maintenance-interval").fill(options.intervalMonths);
  }
  await dialog
    .getByText(options.equipmentName, { exact: true })
    .locator("..")
    .click();
  if (options.instructions) {
    await dialog
      .locator("#maintenance-instructions")
      .fill(options.instructions);
  }
  if (options.overlapReason) {
    await dialog.locator("#maintenance-overlap").fill(options.overlapReason);
  }
  await dialog.getByRole("button", { name: "Wartungsplan anlegen" }).click();
  await expect(dialog).toHaveCount(0, { timeout: 20_000 });
  await page.getByRole("tab", { name: /Pläne/ }).click();
  await expect(
    page.getByRole("main")
      .getByTestId("maintenance-plan-card")
      .filter({ hasText: options.clientName })
      .filter({ hasText: options.equipmentName }),
  ).toBeVisible({ timeout: 20_000 });
}

export async function createInstalledEquipment(
  page: Page,
  options: {
    customerName: string;
    siteName: string;
    name: string;
    category?: string;
    parentName?: string;
    state?: "Unbekannt" | "Aktiv" | "Vorübergehend außer Betrieb";
    manufacturer?: string;
    model?: string;
    serialNumber?: string;
    location?: string;
    installationDate?: string;
    commissioningDate?: string;
    warrantyProvider?: string;
    warrantyEndDate?: string;
  },
): Promise<string> {
  await page.goto("/service/anlagen");
  await page.getByRole("button", { name: "Anlage erfassen" }).first().click();
  const dialog = page.getByRole("dialog");
  await expect(
    dialog.getByRole("heading", { name: "Anlage erfassen" }),
  ).toBeVisible();
  await selectFromSearchable(
    page,
    dialog.locator("#equipment-client"),
    options.customerName,
  );
  await selectFromSearchable(
    page,
    dialog.locator("#equipment-site"),
    options.siteName,
  );
  await dialog.getByLabel("Bezeichnung").fill(options.name);
  if (options.category) {
    await dialog.locator("#equipment-category").click();
    await page
      .getByRole("option", { name: options.category, exact: true })
      .click();
  }
  if (options.parentName) {
    await selectFromSearchable(
      page,
      dialog.locator("#equipment-parent"),
      options.parentName,
    );
  }
  if (options.state) {
    await dialog.locator("#equipment-state").click();
    await page
      .getByRole("option", { name: options.state, exact: true })
      .click();
  }
  if (options.location)
    await dialog.getByLabel("Position am Einsatzort").fill(options.location);
  if (options.manufacturer || options.model || options.serialNumber) {
    await dialog
      .getByRole("button", { name: "Technische Angaben und Kennungen" })
      .click();
    if (options.manufacturer) {
      await dialog
        .getByLabel("Hersteller", { exact: true })
        .fill(options.manufacturer);
    }
    if (options.model)
      await dialog.getByLabel("Modell", { exact: true }).fill(options.model);
    if (options.serialNumber) {
      await dialog
        .getByLabel("Seriennummer", { exact: true })
        .fill(options.serialNumber);
    }
  }
  if (
    options.installationDate ||
    options.commissioningDate ||
    options.warrantyProvider ||
    options.warrantyEndDate
  ) {
    await dialog
      .getByRole("button", {
        name: "Installation, Inbetriebnahme und Gewährleistung",
      })
      .click();
    if (options.installationDate) {
      await typeIntoDatePickerById(
        dialog,
        "equipment-installation-date",
        options.installationDate,
      );
    }
    if (options.commissioningDate) {
      await typeIntoDatePickerById(
        dialog,
        "equipment-commissioning-date",
        options.commissioningDate,
      );
    }
    if (options.warrantyProvider) {
      await dialog
        .getByLabel("Gewährleistungsgeber")
        .fill(options.warrantyProvider);
    }
    if (options.warrantyEndDate) {
      await typeIntoDatePickerById(
        dialog,
        "equipment-warranty-end",
        options.warrantyEndDate,
      );
    }
  }
  await dialog.getByRole("button", { name: "Speichern", exact: true }).click();
  await expect(dialog).toHaveCount(0, { timeout: 15_000 });
  await expect(
    page.locator("[data-pending-row]").filter({ hasText: options.name }),
  ).toHaveCount(0, { timeout: 20_000 });
  const equipmentLink = page.getByRole("link", {
    name: options.name,
    exact: true,
  });
  await expect(equipmentLink).toBeVisible({ timeout: 20_000 });
  await equipmentLink.click();
  await page.waitForURL(/\/service\/anlagen\/ANL-\d{4}-\d{3}$/i, {
    timeout: 20_000,
  });
  const equipmentNumber = page.url().split("/").at(-1);
  if (!equipmentNumber)
    throw new Error("Equipment number missing from detail route.");
  return decodeURIComponent(equipmentNumber);
}

export async function linkInstalledEquipmentToJob(
  page: Page,
  jobNumber: string,
): Promise<void> {
  const dialog = await openInstalledEquipmentWorkLinkDialog(page);
  await selectFromSearchable(
    page,
    dialog.locator("#equipment-work-target"),
    jobNumber,
  );
  await dialog.getByRole("button", { name: "Verknüpfen", exact: true }).click();
  await expect(dialog).toHaveCount(0, { timeout: 20_000 });
  const section = page.locator("section").filter({
    has: page.getByRole("heading", { name: "Verknüpfte Arbeit" }),
  });
  await expect(
    section.getByRole("link").filter({ hasText: jobNumber }),
  ).toBeVisible();
}

export async function openInstalledEquipmentWorkLinkDialog(
  page: Page,
): Promise<Locator> {
  const section = page.locator("section").filter({
    has: page.getByRole("heading", { name: "Verknüpfte Arbeit" }),
  });
  await section.getByRole("button", { name: "Verknüpfen" }).click();
  const dialog = page.getByRole("dialog");
  await expect(
    dialog.getByRole("heading", { name: "Arbeit verknüpfen" }),
  ).toBeVisible();
  return dialog;
}

export async function transitionInstalledEquipment(
  page: Page,
  stateLabel: string,
  reason: string,
): Promise<void> {
  await page.getByRole("button", { name: "Zustand ändern" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.locator("#equipment-target-state").click();
  await page.getByRole("option", { name: stateLabel, exact: true }).click();
  await dialog.getByLabel("Begründung").fill(reason);
  await dialog.getByRole("button", { name: "Änderung speichern" }).click();
  await expect(dialog).toHaveCount(0, { timeout: 20_000 });
  await expect(
    page.getByText(stateLabel, { exact: true }).first(),
  ).toBeVisible();
}

export async function openInstalledEquipmentByName(
  page: Page,
  equipmentName: string,
): Promise<string> {
  await page.goto("/service/anlagen");
  await page.getByLabel("Anlagen durchsuchen").fill(equipmentName);
  const link = page
    .getByRole("link")
    .filter({ hasText: equipmentName })
    .first();
  await expect(link).toBeVisible({ timeout: 20_000 });
  const href = await link.getAttribute("href");
  if (!href)
    throw new Error(`Equipment detail link missing for ${equipmentName}.`);
  await page.goto(href);
  await expect(page).toHaveURL(/\/service\/anlagen\/ANL-\d{4}-\d{3}$/i, {
    timeout: 20_000,
  });
  return decodeURIComponent(href.split("/").at(-1) ?? "");
}

export async function updateInstalledEquipmentModel(
  page: Page,
  model: string,
  reason: string,
  beforeSubmit?: () => void | Promise<void>,
): Promise<void> {
  await page.getByRole("button", { name: "Bearbeiten" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Modell", { exact: true }).fill(model);
  await dialog.getByLabel("Grund der Änderung").fill(reason);
  await beforeSubmit?.();
  await dialog.getByRole("button", { name: "Speichern", exact: true }).click();
  await expect(dialog).toHaveCount(0, { timeout: 20_000 });
  await expect(visibleText(page, model)).toBeVisible({ timeout: 20_000 });
}

export async function linkInstalledEquipmentSourceToJob(
  page: Page,
  jobNumber: string,
  reason: string,
): Promise<void> {
  await page
    .getByRole("button", { name: "Herkunftsnachweis verknüpfen" })
    .click();
  const dialog = page.getByRole("dialog");
  await selectFromSearchable(
    page,
    dialog.locator("#equipment-source"),
    jobNumber,
  );
  await dialog.getByLabel("Bedeutung des Nachweises").fill(reason);
  await dialog.getByRole("button", { name: "Verknüpfen", exact: true }).click();
  await expect(dialog).toHaveCount(0, { timeout: 20_000 });
  await expect(
    page.getByRole("link").filter({ hasText: jobNumber }).last(),
  ).toBeVisible();
}

export async function replaceInstalledEquipment(
  page: Page,
  options: { successorName: string; serialNumber: string; reason: string },
): Promise<string> {
  const predecessorUrl = page.url();
  await page.getByRole("button", { name: "Ersetzen" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Bezeichnung").fill(options.successorName);
  await dialog
    .getByRole("button", { name: "Technische Angaben und Kennungen" })
    .click();
  await dialog
    .getByLabel("Seriennummer", { exact: true })
    .fill(options.serialNumber);
  await dialog.getByLabel("Grund der Änderung").fill(options.reason);
  await dialog.getByRole("button", { name: "Nachfolger anlegen" }).click();
  await page.waitForURL(
    (url) =>
      url.href !== predecessorUrl &&
      /\/service\/anlagen\/ANL-\d{4}-\d{3}$/i.test(url.pathname),
    { timeout: 20_000 },
  );
  await expect(
    page.getByRole("heading", { name: options.successorName }),
  ).toBeVisible();
  return decodeURIComponent(page.url().split("/").at(-1) ?? "");
}

export async function expectDuplicateInstalledEquipmentRejected(
  page: Page,
  options: {
    customerName: string;
    siteName: string;
    name: string;
    manufacturer: string;
    serialNumber: string;
  },
): Promise<void> {
  await page.goto("/service/anlagen");
  await page.getByRole("button", { name: "Anlage erfassen" }).first().click();
  const dialog = page.getByRole("dialog");
  await selectFromSearchable(
    page,
    dialog.locator("#equipment-client"),
    options.customerName,
  );
  await selectFromSearchable(
    page,
    dialog.locator("#equipment-site"),
    options.siteName,
  );
  await dialog.getByLabel("Bezeichnung").fill(options.name);
  await dialog
    .getByRole("button", { name: "Technische Angaben und Kennungen" })
    .click();
  await dialog
    .getByLabel("Hersteller", { exact: true })
    .fill(options.manufacturer);
  await dialog
    .getByLabel("Seriennummer", { exact: true })
    .fill(options.serialNumber);
  await dialog.getByRole("button", { name: "Speichern", exact: true }).click();
  await expect(dialog).toHaveCount(0, { timeout: 15_000 });
  await expect(
    page.getByText("Diese Kennung wird bereits verwendet.", { exact: true }),
  ).toBeVisible({ timeout: 20_000 });
}

export async function correctInstalledEquipmentTerminalAction(
  page: Page,
  reason: string,
): Promise<void> {
  await page
    .getByRole("button", { name: "Abschlussaktion korrigieren" })
    .click();
  const dialog = page.getByRole("alertdialog");
  await dialog.getByLabel("Korrekturgrund").fill(reason);
  await dialog.getByRole("button", { name: "Korrektur festhalten" }).click();
  await expect(dialog).toHaveCount(0, { timeout: 20_000 });
  await expect(visibleText(page, "Abschlussaktion korrigiert")).toBeVisible();
}

// P1-19: reactive service cases and exact links to existing work owners.

async function selectRadixOption(
  page: Page,
  trigger: Locator,
  optionName: string | RegExp,
): Promise<void> {
  await trigger.click();
  const option = page.getByRole("option", {
    name: optionName,
    exact: typeof optionName === "string",
  });
  await expect(option).toBeVisible({ timeout: 15_000 });
  await option.click();
}

export async function createDirectServiceCase(
  page: Page,
  options: {
    customerName: string;
    siteName: string;
    statement: string;
    summary: string;
    urgencyLabel?: string;
    chargeContextLabel?: string;
    accessInstructions?: string;
    triageNote?: string;
    equipmentName?: string;
  },
): Promise<string> {
  await page.goto("/service/faelle");
  await page.getByRole("button", { name: "Servicefall erfassen" }).click();
  const dialog = page.getByRole("dialog");
  await expect(
    dialog.getByRole("heading", { name: "Servicefall erfassen" }),
  ).toBeVisible();
  await selectFromSearchable(
    page,
    dialog.locator("#service-client"),
    options.customerName,
  );
  await selectFromSearchable(
    page,
    dialog.locator("#service-site"),
    options.siteName,
  );
  await dialog.locator("#service-statement").fill(options.statement);
  await dialog.locator("#service-summary").fill(options.summary);
  if (options.urgencyLabel) {
    await selectRadixOption(
      page,
      dialog.locator("#service-urgency"),
      options.urgencyLabel,
    );
  }
  if (options.chargeContextLabel) {
    await selectRadixOption(
      page,
      dialog.locator("#service-charge"),
      options.chargeContextLabel,
    );
  }
  if (options.accessInstructions) {
    await dialog.locator("#service-access").fill(options.accessInstructions);
  }
  if (options.triageNote) {
    await dialog.locator("#service-triage").fill(options.triageNote);
  }
  if (options.equipmentName) {
    const equipmentCheckbox = dialog
      .getByRole("checkbox", {
        name: new RegExp(escapeRegExp(options.equipmentName)),
      })
      .first();
    await expect(equipmentCheckbox).toBeVisible({ timeout: 15_000 });
    if (!(await equipmentCheckbox.isChecked())) await equipmentCheckbox.click();
    await expect(equipmentCheckbox).toBeChecked();
  }
  await dialog.getByRole("button", { name: "Speichern", exact: true }).click();
  await expect(dialog).toHaveCount(0, { timeout: 15_000 });
  await expect(
    page.locator("[data-pending-row]").filter({ hasText: options.summary }),
  ).toHaveCount(0, { timeout: 20_000 });
  const serviceCaseLink = page.getByRole("link", {
    name: options.summary,
    exact: true,
  });
  await expect(serviceCaseLink).toBeVisible({ timeout: 20_000 });
  await serviceCaseLink.click();
  await page.waitForURL(/\/service\/faelle\/SRV-\d{4}-\d{3}/, {
    timeout: 20_000,
  });
  const serviceCaseNumber = page.url().match(/\/service\/faelle\/(SRV-\d{4}-\d{3})/)?.[1];
  if (!serviceCaseNumber)
    throw new Error("createDirectServiceCase: service case number missing");
  await expect(visibleText(page, options.statement)).toBeVisible({
    timeout: 15_000,
  });
  return serviceCaseNumber;
}

export async function convertRequestToServiceCase(page: Page): Promise<string> {
  await page
    .getByRole("button", { name: "Als Servicefall übernehmen" })
    .click();
  const dialog = page.getByRole("dialog");
  await expect(
    dialog.getByRole("heading", {
      name: "Anfrage als Servicefall übernehmen?",
    }),
  ).toBeVisible();
  await dialog.getByRole("button", { name: "Übernehmen", exact: true }).click();
  await page.waitForURL(/\/service\/faelle\/SRV-\d{4}-\d{3}/, {
    timeout: 20_000,
  });
  const serviceCaseNumber = page.url().match(/\/service\/faelle\/(SRV-\d{4}-\d{3})/)?.[1];
  if (!serviceCaseNumber)
    throw new Error("convertRequestToServiceCase: service case number missing");
  return serviceCaseNumber;
}

export async function updateServiceCaseViaDialog(
  page: Page,
  options: {
    summary?: string;
    statusLabel?: string;
    urgencyLabel?: string;
    chargeContextLabel?: string;
    jobNumber?: string;
    accessInstructions?: string;
    triageNote?: string;
    resolutionNote?: string;
    equipmentName?: string;
    reason: string;
    beforeSubmit?: () => void | Promise<void>;
  },
): Promise<void> {
  await page.getByRole("button", { name: "Bearbeiten" }).click();
  const dialog = page.getByRole("dialog");
  if (options.summary !== undefined) {
    await dialog.locator("#service-summary").fill(options.summary);
  }
  if (options.statusLabel) {
    await selectRadixOption(
      page,
      dialog.locator("#service-status"),
      options.statusLabel,
    );
  }
  if (options.urgencyLabel) {
    await selectRadixOption(
      page,
      dialog.locator("#service-urgency"),
      options.urgencyLabel,
    );
  }
  if (options.chargeContextLabel) {
    await selectRadixOption(
      page,
      dialog.locator("#service-charge"),
      options.chargeContextLabel,
    );
  }
  if (options.jobNumber) {
    await selectFromSearchable(
      page,
      dialog.locator("#service-job"),
      options.jobNumber,
    );
  }
  if (options.accessInstructions !== undefined) {
    await dialog.locator("#service-access").fill(options.accessInstructions);
  }
  if (options.triageNote !== undefined) {
    await dialog.locator("#service-triage").fill(options.triageNote);
  }
  if (options.resolutionNote !== undefined) {
    await dialog.locator("#service-resolution").fill(options.resolutionNote);
  }
  if (options.equipmentName) {
    const checkbox = dialog.getByRole("checkbox", {
      name: new RegExp(options.equipmentName),
    });
    if (!(await checkbox.isChecked())) await checkbox.click();
  }
  await dialog.locator("#service-reason").fill(options.reason);
  await options.beforeSubmit?.();
  await dialog.getByRole("button", { name: "Speichern", exact: true }).click();
  await expect(dialog).toHaveCount(0, { timeout: 20_000 });
}

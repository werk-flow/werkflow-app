import { expect, type Page } from "@playwright/test";
import { selectFromSearchable, typeIntoDatePicker, typeIntoDatePickerById, visibleText } from './shared';

// P1-09: teams and qualifications. These steps use stable semantic controls
// and data identities because Realtime refreshes may replace rows mid-step.
export async function createTeamViaManagement(
  page: Page,
  teamName: string,
): Promise<void> {
  await page.goto("/mitarbeiter");
  await page.getByRole("tab", { name: "Teams", exact: true }).click();
  await page.locator("#new-team-name").fill(teamName);
  await page.getByRole("button", { name: "Team anlegen" }).click();
  await expect(
    page.getByRole("main").getByTestId("team-card").filter({ hasText: teamName }),
  ).toBeVisible({
    timeout: 15_000,
  });
}

export async function addTeamMemberViaManagement(
  page: Page,
  options: { teamName: string; employeeName: string; validFrom?: string },
): Promise<void> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    await page.goto("/mitarbeiter");
    await page.getByRole("tab", { name: "Teams", exact: true }).click();
    const card = page.getByRole("main")
      .getByTestId("team-card")
      .filter({ hasText: options.teamName });
    await expect(card).toBeVisible({ timeout: 15_000 });
    const memberRow = card
      .getByTestId("team-member-row")
      .filter({ hasText: options.employeeName })
      .first();
    if (await memberRow.isVisible().catch(() => false)) return;

    await selectFromSearchable(
      page,
      card.getByRole("combobox", {
        name: `Mitglied zu ${options.teamName} hinzufügen`,
      }),
      options.employeeName,
    );
    if (options.validFrom) {
      // ISO date → DDMMYYYY segment digits for the DatePicker group.
      const digits = `${options.validFrom.slice(8, 10)}${options.validFrom.slice(5, 7)}${options.validFrom.slice(0, 4)}`;
      await typeIntoDatePicker(
        card,
        `Teamzugehörigkeit zu ${options.teamName} gültig ab`,
        digits,
      );
    }
    await card.getByRole("button", { name: "Hinzufügen" }).click();
    if (
      await memberRow
        .waitFor({ state: "visible", timeout: 10_000 })
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
    kind: "Fähigkeit" | "Zertifizierung";
    warningDays?: number;
  },
): Promise<void> {
  await page.goto("/mitarbeiter");
  await page.getByRole("tab", { name: "Qualifikationen", exact: true }).click();
  await page.locator("#capability-kind").click();
  await page.getByRole("option", { name: options.kind, exact: true }).click();
  await page.locator("#capability-name").fill(options.name);
  if (options.kind === "Zertifizierung" && options.warningDays !== undefined) {
    await page
      .locator("#capability-warning-days")
      .fill(String(options.warningDays));
  }
  await page.getByRole("button", { name: "Anlegen", exact: true }).click();
  const definitionRow = page.getByRole("main")
    .getByTestId("capability-definition-row")
    .filter({ hasText: options.name });
  try {
    await expect(definitionRow).toBeVisible({ timeout: 15_000 });
  } catch {
    await page.reload();
    await page
      .getByRole("tab", { name: "Qualifikationen", exact: true })
      .click();
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
    evidence?: "Nicht erforderlich" | "Ausstehend" | "Erhalten";
    operationalNote?: string;
  },
): Promise<void> {
  await page.goto("/mitarbeiter");
  await page.getByRole("tab", { name: "Qualifikationen", exact: true }).click();
  await selectFromSearchable(
    page,
    page.getByRole("combobox", { name: "Mitarbeiter für Qualifikation" }),
    options.employeeName,
  );
  await selectFromSearchable(
    page,
    page.getByRole("combobox", { name: "Qualifikation auswählen" }),
    options.capabilityName,
  );
  await typeIntoDatePickerById(
    page.locator("body"),
    "qualification-valid-from",
    options.validFrom,
  );
  if (options.validUntil) {
    await typeIntoDatePickerById(
      page.locator("body"),
      "qualification-valid-until",
      options.validUntil,
    );
  }
  if (options.issuer !== undefined) {
    await page.locator("#qualification-issuer").fill(options.issuer);
  }
  if (options.renewalDueDate) {
    await typeIntoDatePickerById(
      page.locator("body"),
      "qualification-renewal-date",
      options.renewalDueDate,
    );
  }
  if (options.evidence) {
    await page.getByRole("combobox", { name: "Nachweisstatus" }).click();
    await page
      .getByRole("option", { name: options.evidence, exact: true })
      .click();
  }
  const confirmation = page.locator("#qualification-confirmed");
  if (options.confirmed && !(await confirmation.isChecked())) {
    await confirmation.click();
  }
  if (options.operationalNote) {
    await page
      .locator("#qualification-operational-note")
      .fill(options.operationalNote);
  }
  await page.getByRole("button", { name: "Eintrag speichern" }).click();
  await expect(
    page.getByRole("main")
      .getByTestId("employee-capability-row")
      .filter({ hasText: options.employeeName })
      .filter({ hasText: options.capabilityName }),
  ).toBeVisible({ timeout: 15_000 });
}

export async function renewCapabilityViaManagement(
  page: Page,
  options: {
    employeeName: string;
    capabilityName: string;
    validFrom: string;
    validUntil: string;
  },
): Promise<void> {
  await page.goto("/mitarbeiter");
  await page.getByRole("tab", { name: "Qualifikationen", exact: true }).click();
  const row = page.getByRole("main")
    .getByTestId("employee-capability-row")
    .filter({ hasText: options.employeeName })
    .filter({ hasText: options.capabilityName });
  await row.getByRole("button", { name: "Erneuern" }).click();
  await typeIntoDatePickerById(
    page.locator("body"),
    "qualification-valid-from",
    options.validFrom,
  );
  await typeIntoDatePickerById(
    page.locator("body"),
    "qualification-valid-until",
    options.validUntil,
  );
  await page.getByRole("button", { name: "Erneuerung speichern" }).click();
  await expect(
    page.getByRole("main")
      .getByTestId("employee-capability-row")
      .filter({ hasText: options.capabilityName })
      .filter({ hasText: `bis ${options.validUntil}` }),
  ).toBeVisible({ timeout: 15_000 });
}

export async function setApprenticeWarningViaManagement(
  page: Page,
  enabled: boolean,
): Promise<void> {
  await page.goto("/mitarbeiter");
  await page.getByRole("tab", { name: "Qualifikationen", exact: true }).click();
  const checkbox = page.getByRole("checkbox", {
    name: "Ausbildungs-Hinweis aktivieren",
  });
  if ((await checkbox.isChecked()) !== enabled) {
    await checkbox.click();
    await expect(page.getByText("Einstellung gespeichert.")).toBeVisible({
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
  },
): Promise<void> {
  await page.goto(`/auftraege/${options.jobNumber}`);
  await expect(
    page.getByRole("heading", { name: "Qualifikationsabdeckung" }),
  ).toBeVisible({
    timeout: 15_000,
  });
  await selectFromSearchable(
    page,
    page.locator("#job-qualification-capability"),
    options.capabilityName,
  );
  if (options.requireConfirmation) {
    await page.locator("#job-require-confirmation").click();
  }
  await page.getByRole("button", { name: "Hinzufügen" }).click();
  await expect(
    page.getByRole("main")
      .getByTestId("qualification-coverage-row")
      .filter({ hasText: options.capabilityName }),
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
  },
): Promise<void> {
  await page.goto(`/auftraege/${options.jobNumber}`);
  await page.getByRole("button", { name: "Zuweisen", exact: true }).click();
  const assignmentDialog = page.getByRole("dialog").filter({
    has: page.getByRole("heading", { name: "Mitarbeiter zuweisen" }),
  });
  if (options.teamName) {
    await assignmentDialog
      .getByRole("button", { name: options.teamName, exact: true })
      .click();
  } else if (options.employeeName) {
    await assignmentDialog
      .getByRole("combobox")
      .filter({ hasText: "Mitarbeiter zuweisen" })
      .click();
    await page
      .getByPlaceholder("Mitarbeiter suchen...")
      .fill(options.employeeName);
    await page
      .getByRole("listbox")
      .getByRole("option")
      .filter({ hasText: options.employeeName })
      .first()
      .click();
    await assignmentDialog
      .getByRole("heading", { name: "Mitarbeiter zuweisen" })
      .click();
  }
  await assignmentDialog.getByRole("button", { name: "Speichern" }).click();
  const warningDialog = page
    .getByRole("dialog")
    .filter({ has: page.getByRole("heading", { name: "Zuweisung prüfen" }) });
  await expect(warningDialog).toBeVisible({ timeout: 15_000 });
  await expect(
    warningDialog.getByText(options.expectedStatus).first(),
  ).toBeVisible();
  await warningDialog
    .locator("#qualification-override-reason")
    .fill(options.overrideReason);
  await warningDialog
    .getByRole("button", { name: "Trotz Hinweis zuweisen" })
    .click();
  await expect(warningDialog).toHaveCount(0, { timeout: 15_000 });
  if (options.employeeName) {
    await page.reload();
    await expect(visibleText(page, options.employeeName)).toBeVisible({
      timeout: 15_000,
    });
  }
}

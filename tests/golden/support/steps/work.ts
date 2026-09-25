import { expect, type Locator, type Page } from "@playwright/test";
import { selectFromSearchable, toggleInSearchableMulti, typeIntoDatePicker, typeIntoDatePickerById, visibleText } from './shared';

export function workHandoverSection(page: Page): Locator {
  return page.getByRole('main').getByTestId('work-handover-section');
}

export function workLifecycleCard(page: Page): Locator {
  return page.getByRole('main').getByTestId('work-lifecycle-card');
}

export async function selectAllHandoverSources(
  section: Locator,
): Promise<void> {
  await expect(section.getByRole("checkbox").first()).toBeAttached({
    timeout: 20_000,
  });
  const sourceCheckboxes = await section.getByRole("checkbox").all();
  for (const checkbox of sourceCheckboxes) {
    if (!(await checkbox.isChecked())) await checkbox.check();
  }
}

export async function createJob(
  page: Page,
  options: {
    jobNumber: string;
    title: string;
    description?: string;
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
    workTemplateName?: string;
  },
): Promise<void> {
  await page.goto("/auftraege");
  await page.getByRole("button", { name: "Erstellen", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Neuen Auftrag oder Projekt erstellen" }),
  ).toBeVisible();
  await page.getByRole("tab", { name: "Auftrag erstellen" }).click();

  await page.locator("#job-number").fill(options.jobNumber);
  await page.locator("#job-title").fill(options.title);
  if (options.description)
    await page.locator("#job-description").fill(options.description);

  if (options.workTemplateName) {
    await expect(page.locator("#work-template-job")).toBeVisible({
      timeout: 15_000,
    });
    await selectFromSearchable(
      page,
      page.locator("#work-template-job"),
      options.workTemplateName,
    );
  }

  if (options.plannedDateDigits) {
    await typeIntoDatePicker(
      page.getByRole("dialog"),
      "Datum",
      options.plannedDateDigits,
    );
  }

  if (options.clientName) {
    // The customer picker is a searchable combobox showing "Kein Kunde".
    await page.getByRole("combobox").filter({ hasText: "Kein Kunde" }).click();
    await page.getByPlaceholder("Kunde suchen...").fill(options.clientName);
    await page
      .getByRole("listbox")
      .getByRole("option")
      .filter({ hasText: options.clientName })
      .first()
      .click();
  }

  if ((options.siteName || options.contactName) && !options.clientName) {
    throw new Error("createJob: siteName/contactName require clientName");
  }

  if (options.projectNumber) {
    await page
      .getByRole("combobox")
      .filter({ hasText: "Kein Projekt" })
      .click();
    await page
      .getByPlaceholder("Projekt suchen...")
      .fill(options.projectNumber);
    const projectOption = page
      .getByRole("listbox")
      .getByRole("option")
      .filter({ hasText: `${options.projectNumber} –` });
    await expect(projectOption).toHaveCount(1, { timeout: 15_000 });
    await projectOption.click();
    if (options.expectedInheritedSiteName) {
      await expect(page.locator("#job-site")).toContainText(
        options.expectedInheritedSiteName,
        {
          timeout: 15_000,
        },
      );
    }
    if (options.expectedInheritedContactName) {
      await expect(page.locator("#job-contact")).toContainText(
        options.expectedInheritedContactName,
        { timeout: 15_000 },
      );
    }
  }

  if (options.siteName) {
    // The site picker appears once the customer's sites finished loading.
    await expect(page.locator("#job-site")).toBeEnabled({ timeout: 15_000 });
    await selectFromSearchable(
      page,
      page.locator("#job-site"),
      options.siteName,
    );
  }

  if (options.contactName) {
    await expect(page.locator("#job-contact")).toBeEnabled({ timeout: 15_000 });
    await selectFromSearchable(
      page,
      page.locator("#job-contact"),
      options.contactName,
    );
  }

  if (options.assignEmployeeName) {
    // The employee picker renders as a combobox showing its placeholder text.
    await page
      .getByRole("combobox")
      .filter({ hasText: "Mitarbeiter zuweisen" })
      .click();
    await page
      .getByPlaceholder("Mitarbeiter suchen...")
      .fill(options.assignEmployeeName);
    // Options render as buttons inside the picker's listbox.
    await page
      .getByRole("listbox")
      .getByRole("option")
      .filter({ hasText: options.assignEmployeeName })
      .first()
      .click();
    // Dismiss the picker by clicking elsewhere in the dialog; Escape would
    // close the whole creation dialog.
    await page
      .getByRole("heading", { name: "Neuen Auftrag oder Projekt erstellen" })
      .click();
    await expect(page.getByPlaceholder("Mitarbeiter suchen...")).toBeHidden();
  }

  await page
    .getByRole("button", { name: "Auftrag erstellen", exact: true })
    .click();
  if (options.qualificationOverrideReason) {
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
    await expect(warningDialog).toHaveCount(0, { timeout: 15_000 });
  }
  // The dialog closes on success; the caller asserts the job row afterwards.
  await expect(
    page.getByRole("heading", { name: "Neuen Auftrag oder Projekt erstellen" }),
  ).toBeHidden({ timeout: 15_000 });

  // Phase 5 creation is optimistic: validation closes the dialog before the
  // server action settles. A child row is not mounted while its project is
  // collapsed, so expand the owning project before observing the pending
  // marker. Otherwise the absence check passes vacuously and a prefix match
  // on the project number can be mistaken for the confirmed child.
  if (options.projectNumber) {
    const projectNumber = visibleText(page, options.projectNumber, true);
    await expect(projectNumber).toBeVisible({ timeout: 15_000 });
    const projectRow = projectNumber.locator("xpath=ancestor::tr[1]");
    const expandProjectButton = projectRow.getByRole("button", {
      name: "Projekt aufklappen",
    });
    if (await expandProjectButton.isVisible().catch(() => false)) {
      await expandProjectButton.click();
    }
  }

  // Do not let a following navigation abort the request. The mounted pending
  // marker clearing proves the action response landed; the exact visible job
  // number then proves the confirmed result replaced the draft.
  await expect(
    page.locator("[data-pending-row]").filter({ hasText: options.jobNumber }),
  ).toHaveCount(0, { timeout: 15_000 });
  const confirmedJobNumber = visibleText(page, options.jobNumber, true);
  await expect(confirmedJobNumber).toBeVisible({
    timeout: 15_000,
  });
}

export async function createProject(
  page: Page,
  options: {
    projectNumber: string;
    title: string;
    clientName?: string;
    siteName?: string;
    contactName?: string;
    workTemplateName?: string;
  },
): Promise<void> {
  if ((options.siteName || options.contactName) && !options.clientName) {
    throw new Error("createProject: siteName/contactName require clientName");
  }
  await page.goto("/auftraege");
  await page.getByRole("button", { name: "Erstellen", exact: true }).click();
  const dialog = page.getByRole("dialog").filter({
    has: page.getByRole("heading", {
      name: "Neuen Auftrag oder Projekt erstellen",
    }),
  });
  await dialog.getByRole("tab", { name: "Projekt erstellen" }).click();
  const projectNumberInput = dialog.locator("#create-project-number");
  await expect(projectNumberInput).not.toHaveValue("", { timeout: 15_000 });
  await projectNumberInput.fill(options.projectNumber);
  await dialog.locator("#create-project-name").fill(options.title);
  if (options.workTemplateName) {
    await expect(dialog.locator("#work-template-project")).toBeVisible({
      timeout: 15_000,
    });
    await selectFromSearchable(
      page,
      dialog.locator("#work-template-project"),
      options.workTemplateName,
    );
  }
  if (options.clientName) {
    await dialog
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
  if (options.siteName) {
    await expect(dialog.locator("#create-project-site")).toBeVisible({
      timeout: 15_000,
    });
    await selectFromSearchable(
      page,
      dialog.locator("#create-project-site"),
      options.siteName,
    );
  }
  if (options.contactName) {
    await expect(dialog.locator("#create-project-contact")).toBeVisible({
      timeout: 15_000,
    });
    await selectFromSearchable(
      page,
      dialog.locator("#create-project-contact"),
      options.contactName,
    );
  }
  await dialog
    .getByRole("button", { name: "Projekt erstellen", exact: true })
    .click();
  await expect(dialog).toHaveCount(0, { timeout: 15_000 });
  await expect(
    page
      .locator("[data-pending-row]")
      .filter({ hasText: options.projectNumber }),
  ).toHaveCount(0, { timeout: 15_000 });
  await expect(visibleText(page, options.projectNumber)).toBeVisible({
    timeout: 15_000,
  });
}

export async function createAndPublishWorkTemplate(
  page: Page,
  options: {
    name: string;
    targetType: "job" | "project";
    firstItem: string;
    secondItem?: string;
    evidenceDescription?: string;
  },
): Promise<void> {
  await page.goto("/arbeitsvorlagen");
  await page
    .getByRole("button", { name: /Vorlage erstellen|Erste Vorlage erstellen/ })
    .first()
    .click();
  const createDialog = page.getByRole("dialog").filter({
    has: page.getByRole("heading", { name: "Arbeitsvorlage erstellen" }),
  });
  await createDialog.locator("#new-template-name").fill(options.name);
  if (options.targetType === "project") {
    await createDialog.locator("#new-template-target").click();
    await page.getByRole("option", { name: "Projekte", exact: true }).click();
  }
  await createDialog
    .getByRole("button", { name: "Erstellen", exact: true })
    .click();
  await expect(createDialog).toHaveCount(0, { timeout: 15_000 });

  const editor = page.getByRole("dialog").filter({
    has: page.getByRole("heading", { name: /Entwurf · Version 1/ }),
  });
  await expect(editor).toBeVisible({ timeout: 20_000 });
  await editor.getByRole("button", { name: "Eintrag", exact: true }).click();
  await editor.getByLabel("Bezeichnung").last().fill(options.firstItem);
  if (options.evidenceDescription) {
    await editor.getByRole("button", { name: "Nachweis", exact: true }).click();
    await editor
      .getByLabel("Nachweisbeschreibung")
      .last()
      .fill(options.evidenceDescription);
  }
  if (options.secondItem) {
    await editor.getByRole("button", { name: "Eintrag", exact: true }).click();
    const labels = editor.getByLabel("Bezeichnung");
    await labels.last().fill(options.secondItem);
    const secondCard = labels
      .last()
      .locator('xpath=ancestor::*[@data-slot="card"][1]');
    await secondCard
      .getByRole("combobox", {
        name: `Verbindlichkeit für ${options.secondItem}`,
      })
      .click();
    await page.getByRole("option", { name: "Optional", exact: true }).click();
    await toggleInSearchableMulti(
      page,
      secondCard.getByRole("combobox", {
        name: `Voraussetzungen für ${options.secondItem}`,
      }),
      [options.firstItem],
    );
  }
  await editor
    .getByRole("button", { name: "Veröffentlichen", exact: true })
    .click();
  await expect(editor).toHaveCount(0, { timeout: 20_000 });
}

// P1-16: employee work-pack actions. These keep the audit and Golden specs on
// business language while the shared components retain their own selectors.
export async function openFieldWorkPack(
  page: Page,
  jobNumber: string,
  projectNumber?: string,
): Promise<Locator> {
  const path = projectNumber
    ? `/auftraege/projekt/${encodeURIComponent(projectNumber)}/${encodeURIComponent(jobNumber)}`
    : `/auftraege/${encodeURIComponent(jobNumber)}`;
  await page.goto(path);
  // Scope to the active application surface. During an RSC navigation Next.js
  // may retain a hidden transition copy outside <main>; a document-wide test-id
  // lookup would then fail strict mode despite one user-visible work pack.
  const pack = page.getByRole("main").getByTestId("field-work-pack");
  await expect(pack).toBeVisible({ timeout: 20_000 });
  await expect(pack.getByTestId("field-work-pack-overview")).toHaveAttribute(
    "data-realtime-ready",
    "true",
    { timeout: 20_000 },
  );
  return pack;
}

export async function setInstructionCompletionOnJobPage(
  page: Page,
  label: string,
  completed: boolean,
): Promise<void> {
  const actionName = completed
    ? "Punkt als erledigt markieren"
    : "Punkt als offen markieren";
  const item = page.getByRole("main").getByTestId("job-instruction-item").filter({
    has: page.getByText(label, { exact: true }),
  });
  const action = item.getByRole("button", { name: actionName });
  await expect(action).toBeEnabled({ timeout: 20_000 });
  await action.click();
  await expect(
    item.getByRole("button", {
      name: completed
        ? "Punkt als offen markieren"
        : "Punkt als erledigt markieren",
    }),
  ).toBeEnabled({ timeout: 20_000 });
}

export async function transitionWorkOnJobPage(
  page: Page,
  label: string,
  reason?: string,
): Promise<void> {
  const lifecycle = workLifecycleCard(page);
  await lifecycle.getByRole("button", { name: label, exact: true }).click();
  const dialog = page.getByRole("dialog");
  if (reason) await dialog.locator("#work-transition-reason").fill(reason);
  await dialog.getByRole("button", { name: "Änderung speichern" }).click();
  await expect(dialog).toHaveCount(0, { timeout: 20_000 });
}

export async function changeTimeOnWorkPack(
  page: Page,
  action: "start" | "stop" | "switch",
): Promise<void> {
  const pack = page.getByRole("main").getByTestId("field-work-pack");
  const label =
    action === "start"
      ? "Arbeitszeit starten"
      : action === "stop"
        ? "Arbeitszeit beenden"
        : "Zu diesem Auftrag wechseln";
  await pack.getByRole("button", { name: label, exact: true }).click();
  const expected =
    action === "stop" ? "Arbeitszeit starten" : "Arbeitszeit beenden";
  await expect(
    pack.getByRole("button", { name: label, exact: true }),
  ).toHaveCount(0, {
    timeout: 20_000,
  });
  await expect(
    pack.getByRole("button", { name: expected, exact: true }),
  ).toBeVisible({
    timeout: 20_000,
  });
}

export async function reportOwnBlockerOnJobPage(
  page: Page,
  details: string,
): Promise<void> {
  const lifecycle = workLifecycleCard(page);
  await lifecycle.getByRole("button", { name: "Blocker", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await selectFromSearchable(
    page,
    dialog.locator("#work-blocker-reason"),
    "Zugang zum Einsatzort",
  );
  await dialog.locator("#work-blocker-details").fill(details);
  await dialog.getByRole("button", { name: "Speichern", exact: true }).click();
  await expect(dialog).toHaveCount(0, { timeout: 20_000 });
}

export async function resolveOwnBlockerOnJobPage(
  page: Page,
  reason: string,
): Promise<void> {
  const lifecycle = workLifecycleCard(page);
  await lifecycle.getByRole("button", { name: "Lösen", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.locator("#work-reason").fill(reason);
  await dialog.getByRole("button", { name: "Lösen", exact: true }).click();
  await expect(dialog).toHaveCount(0, { timeout: 20_000 });
}

export async function parkJobOnJobPage(
  page: Page,
  jobNumber: string,
  details: string,
  responsibleName: string,
  reviewDate: string,
): Promise<void> {
  await page.goto(`/auftraege/${encodeURIComponent(jobNumber)}`);
  const lifecycle = workLifecycleCard(page);
  await lifecycle.getByRole("button", { name: "Parken", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await selectFromSearchable(page, dialog.locator("#work-blocker-reason"), "Material");
  await dialog.locator("#work-blocker-details").fill(details);
  await selectFromSearchable(
    page,
    dialog.locator("#work-blocker-owner"),
    responsibleName,
  );
  await typeIntoDatePickerById(dialog, "work-blocker-review", reviewDate);
  await dialog.getByRole("button", { name: "Speichern", exact: true }).click();
  await expect(dialog).toHaveCount(0, { timeout: 20_000 });
}

export async function removeJobAssignment(
  page: Page,
  jobNumber: string,
  employeeName: string,
): Promise<void> {
  await page.goto(`/auftraege/${encodeURIComponent(jobNumber)}`);
  await page
    .getByRole("button", {
      name: `Zuweisung für ${employeeName} entfernen`,
    })
    .click();
  await expect(
    page.getByRole("button", {
      name: `Zuweisung für ${employeeName} entfernen`,
    }),
  ).toHaveCount(0, { timeout: 20_000 });
}

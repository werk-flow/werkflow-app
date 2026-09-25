import { expect, type Locator, type Page } from "@playwright/test";
import { openMemberDetailFromList } from './personnel';
import { escapeRegExp, selectFromSearchable, typeIntoDatePicker, typeIntoTimeInput } from './shared';

// The job picker is deliberately a FLAT LIST (search bar + always-visible
// radio rows), not a SearchableSelect — see components/job-picker-modal.tsx.
// A row's accessible name is its full text (title + number/client/project
// line), so match by substring, never exact.
async function selectJobInPicker(
  dialog: ReturnType<Page["getByRole"]>,
  jobTitle: string,
): Promise<void> {
  await dialog
    .getByRole("radio", { name: new RegExp(escapeRegExp(jobTitle)) })
    .first()
    .click();
}

// The clock button opens a sheet of next actions (pre-Wave-3 step 3); one tap
// per transition, the job picker for job choices, "Weitere Aktivitäten …" for
// the full activity dialog. These helpers are the one home per flow.
function openClockSheet(page: Page, expectRunning: boolean): Locator {
  return page.getByRole("dialog").filter({
    has: page.getByRole("heading", {
      name: expectRunning ? "Laufende Zeiterfassung" : "Zeiterfassung starten",
    }),
  });
}

async function openRunningClockSheet(page: Page): Promise<Locator> {
  await page.locator('button[title="Zeiterfassung öffnen"]').click();
  const sheet = openClockSheet(page, true);
  await expect(sheet).toBeVisible();
  return sheet;
}

/** Opens the full activity dialog from the running sheet ("Weitere Aktivitäten …"). */
export async function openActivityDialogFromSheet(page: Page): Promise<Locator> {
  const sheet = await openRunningClockSheet(page);
  await sheet.getByRole("button", { name: "Weitere Aktivitäten …" }).click();
  const dialog = page.getByRole("dialog").filter({
    has: page.getByRole("heading", { name: "Aktivität wechseln" }),
  });
  await expect(dialog).toBeVisible();
  return dialog;
}

export async function clockInOnJob(
  page: Page,
  jobTitle?: string,
): Promise<void> {
  await page.goto("/dashboard");
  await page.locator('button[title="Zeiterfassung starten"]').click();
  const sheet = openClockSheet(page, false);
  await expect(sheet).toBeVisible();

  if (jobTitle) {
    await sheet.getByRole("button", { name: "Arbeit an Auftrag …" }).click();
    const picker = page.getByRole("dialog").filter({
      has: page.getByRole("heading", { name: "Einstempeln" }),
    });
    await selectJobInPicker(picker, jobTitle);
    await picker.getByRole("button", { name: "Einstempeln", exact: true }).click();
  } else {
    await sheet.getByRole("button", { name: "Arbeit starten", exact: true }).click();
  }

  await expect(sheet).toHaveCount(0, { timeout: 15_000 });
  await expect(page.locator('button[title="Zeiterfassung öffnen"]')).toBeVisible({
    timeout: 15_000,
  });
}

export async function clockOut(page: Page): Promise<void> {
  const sheet = await openRunningClockSheet(page);
  await sheet.getByRole("button", { name: "Erfassung beenden" }).click();
  await expect(page.locator('button[title="Zeiterfassung starten"]')).toBeVisible({
    timeout: 15_000,
  });
}

export async function startClockBreak(page: Page): Promise<void> {
  const sheet = await openRunningClockSheet(page);
  await sheet.getByRole("button", { name: "Pause", exact: true }).click();
  await expect(sheet).toHaveCount(0, { timeout: 15_000 });
  // The pill above the button names the running break.
  await expect(page.getByRole("button", { name: /^Pause/ })).toBeVisible({
    timeout: 15_000,
  });
}

export async function endClockBreak(
  page: Page,
  jobTitle?: string,
): Promise<void> {
  const sheet = await openRunningClockSheet(page);
  if (jobTitle) {
    await sheet.getByRole("button", { name: "Anderer Auftrag …" }).click();
    const picker = page.getByRole("dialog").filter({
      has: page.getByRole("heading", { name: "Arbeit fortsetzen" }),
    });
    await selectJobInPicker(picker, jobTitle);
    await picker.getByRole("button", { name: "Fortsetzen", exact: true }).click();
  } else {
    await sheet.getByRole("button", { name: /^Weiter/ }).first().click();
  }
  await expect(sheet).toHaveCount(0, { timeout: 15_000 });
}

export async function switchClockJob(
  page: Page,
  jobTitle: string,
): Promise<void> {
  const sheet = await openRunningClockSheet(page);
  await sheet.getByRole("button", { name: /^Auftrag (wechseln|zuordnen) …$/ }).click();
  const picker = page.getByRole("dialog").filter({
    has: page.getByRole("heading", { name: "Auftrag wechseln" }),
  });
  await selectJobInPicker(picker, jobTitle);
  await picker.getByRole("button", { name: "Wechseln", exact: true }).click();
  await expect(sheet).toHaveCount(0, { timeout: 15_000 });
}

export async function createOwnManualTimeEntry(
  page: Page,
  options: {
    memberName?: string;
    dateDigits: string;
    clockInDigits: string;
    clockOutDigits: string;
  },
): Promise<void> {
  await page.goto("/zeiterfassung");
  await page.getByRole("button", { name: "Manuelle Eintragung" }).click();
  const dialog = page.getByRole("dialog");
  if (options.memberName) {
    await selectFromSearchable(page, dialog.locator("#manual-entry-member"), options.memberName);
  }
  await typeIntoDatePicker(dialog, "Datum", options.dateDigits);
  await typeIntoTimeInput(dialog, "clockInTime", options.clockInDigits);
  await typeIntoTimeInput(dialog, "clockOutTime", options.clockOutDigits);
  await dialog.getByRole("button", { name: "Speichern", exact: true }).click();
  // Close-then-banner: the dialog closes immediately and the global banner
  // confirms the save (M5).
  await expect(
    page.getByText(
      /Antrag wurde zur Genehmigung eingereicht\.|Eintrag erfolgreich erstellt!/,
    ),
  ).toBeVisible({ timeout: 15_000 });
  await expect(dialog).toHaveCount(0, { timeout: 15_000 });
}

export async function openTimeApprovals(page: Page): Promise<void> {
  await page.goto("/zeiterfassung?tab=approvals");
  await expect(page.getByRole("tab", { name: /Anträge/ })).toHaveAttribute(
    "aria-selected",
    "true",
    { timeout: 15_000 },
  );
  await expect(page.getByRole("main").getByTestId("pending-approvals-panel")).toHaveAttribute(
    "data-loaded",
    "true",
    {
      timeout: 30_000,
    },
  );
}

export async function expectTimeApprovalsUnavailable(page: Page): Promise<void> {
  await page.goto("/zeiterfassung?tab=approvals");
  await expect(page.getByRole("tab", { name: /Anträge/ })).toHaveAttribute(
    "aria-selected",
    "true",
    { timeout: 15_000 },
  );
  await expect(page.getByTestId("pending-approvals-panel")).toHaveCount(0, {
    timeout: 15_000,
  });
  await expect(page.getByRole("heading", { name: "Zeitkorrekturen prüfen" })).toHaveCount(0, {
    timeout: 15_000,
  });
}

function pendingTimeApprovalCard(page: Page, userId: string): Locator {
  return page.locator(
    `[data-testid^="pending-session-"][data-user-id="${userId}"]`,
  );
}

export async function expectPendingTimeApprovalVisible(
  page: Page,
  userId: string,
): Promise<void> {
  await expect(pendingTimeApprovalCard(page, userId)).toBeVisible({
    timeout: 15_000,
  });
}

export async function expectPendingTimeApprovalHidden(
  page: Page,
  userId: string,
): Promise<void> {
  await expect(pendingTimeApprovalCard(page, userId)).toHaveCount(0, {
    timeout: 15_000,
  });
}

export async function approvePendingTimeEntry(
  page: Page,
  userId: string,
  visibleText?: string | RegExp,
): Promise<void> {
  const cards = pendingTimeApprovalCard(page, userId);
  const card = visibleText ? cards.filter({ hasText: visibleText }) : cards;
  await expect(card).toHaveCount(1, { timeout: 15_000 });
  await card.getByTitle("Genehmigen - Eintrag bleibt erhalten").click();
  await expect(card).toHaveCount(0, { timeout: 15_000 });
}

export async function expectExpiredResponsibilityDeniedAtAction(
  page: Page,
  userId: string,
): Promise<void> {
  const card = pendingTimeApprovalCard(page, userId);
  await card.getByTitle("Genehmigen - Eintrag bleibt erhalten").click();
  await expect(
    page.getByText(
      "Du bist für diese Freigabe nicht mehr verantwortlich. Die Ansicht wurde aktualisiert.",
    ),
  ).toBeVisible({ timeout: 15_000 });
  await expect(card).toHaveCount(0, { timeout: 15_000 });
}

export async function expectMemberRemovalBlockedByResponsibility(
  page: Page,
  memberName: string,
): Promise<void> {
  await openMemberDetailFromList(page, memberName);
  await page.getByRole("button", { name: "Aktionen", exact: true }).click();
  await page.getByRole("menuitem", { name: "Entfernen" }).click();
  const dialog = page.getByRole("alertdialog");
  await expect(
    dialog.getByText(
      "Vor dem Entfernen muss die Verantwortung für Zeitfreigaben neu zugewiesen oder auf den Standard zurückgestellt werden.",
    ),
  ).toBeVisible({ timeout: 15_000 });
  await expect(
    dialog.getByRole("button", { name: "Zuerst neu zuweisen" }),
  ).toBeDisabled();
}

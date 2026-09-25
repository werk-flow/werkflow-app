import { expect, type Page } from "@playwright/test";
import { typeIntoDatePicker, visibleText } from './shared';

// ============================================
// P1-06 — Vacation requests, decisions, balance
// ============================================

// The employee vacation surface lives on the /zeiterfassung overview
// (dashboard) for every role.
export async function openOwnVacationSection(page: Page): Promise<void> {
  await page.goto("/zeiterfassung");
  await expect(visibleText(page, "Urlaub & Abwesenheit")).toBeVisible({
    timeout: 15_000,
  });
}

export async function createOwnVacationRequestViaDialog(
  page: Page,
  options: {
    startDigits: string;
    endDigits: string;
    halfDay?: boolean;
    comment?: string;
  },
): Promise<void> {
  await openOwnVacationSection(page);
  await page.getByRole("button", { name: "Urlaub beantragen" }).click();
  await expect(
    page.getByRole("heading", { name: "Urlaub beantragen" }),
  ).toBeVisible();

  const dialog = page.getByRole("dialog");
  await typeIntoDatePicker(dialog, "Von", options.startDigits);
  await typeIntoDatePicker(dialog, "Bis", options.endDigits);
  if (options.halfDay) {
    await dialog.locator("#vacation-half-day").click();
  }
  if (options.comment !== undefined) {
    await dialog.locator("#vacation-comment").fill(options.comment);
  }
  await dialog.getByRole("button", { name: "Antrag einreichen" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0, { timeout: 15_000 });
}

// Submitting an overlapping range must fail with an understandable message
// while the dialog stays open (the database exclusion constraint decides).
export async function expectVacationOverlapRejectedViaDialog(
  page: Page,
  options: { startDigits: string; endDigits: string },
): Promise<void> {
  await openOwnVacationSection(page);
  await page.getByRole("button", { name: "Urlaub beantragen" }).click();
  const dialog = page.getByRole("dialog");
  await typeIntoDatePicker(dialog, "Von", options.startDigits);
  await typeIntoDatePicker(dialog, "Bis", options.endDigits);
  await dialog.getByRole("button", { name: "Antrag einreichen" }).click();
  await expect(
    dialog.getByText(
      "Für diesen Zeitraum existiert bereits ein offener oder genehmigter Urlaubsantrag.",
    ),
  ).toBeVisible({ timeout: 15_000 });
  await dialog.getByRole("button", { name: "Abbrechen" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
}

export async function withdrawOwnPendingVacationRequest(
  page: Page,
): Promise<void> {
  await openOwnVacationSection(page);
  // Exactly one pending request is expected when this step runs. The button's
  // accessible name carries the request's date range. Success is the button
  // disappearing — a "Zurückgezogen" text alone would be satisfied by an
  // older withdrawn request inherited from an earlier spec before the new
  // withdrawal has actually committed (a race GG-02's full run exposed).
  const withdrawButton = page.getByRole("button", {
    name: /^Urlaubsantrag vom .* zurückziehen$/,
  });
  await withdrawButton.click();
  await expect(withdrawButton).toHaveCount(0, { timeout: 15_000 });
  await expect(visibleText(page, "Zurückgezogen")).toBeVisible({
    timeout: 15_000,
  });
}

export async function openVacationApprovals(page: Page): Promise<void> {
  await page.goto("/zeiterfassung?tab=approvals");
  await expect(page.getByRole("tab", { name: /Anträge/ })).toBeVisible({
    timeout: 15_000,
  });
}

export async function approveVacationRequestFor(
  page: Page,
  personName: string,
): Promise<void> {
  await openVacationApprovals(page);
  await page
    .getByRole("button", {
      name: `Urlaubsantrag von ${personName} genehmigen`,
    })
    .click();
  await expect(
    page.getByRole("button", {
      name: `Urlaubsantrag von ${personName} genehmigen`,
    }),
  ).toHaveCount(0, { timeout: 15_000 });
}

export async function rejectVacationRequestFor(
  page: Page,
  personName: string,
  reason: string,
): Promise<void> {
  await openVacationApprovals(page);
  await page
    .getByRole("button", { name: `Urlaubsantrag von ${personName} ablehnen` })
    .click();
  const dialog = page.getByRole("dialog");
  await expect(
    dialog.getByRole("heading", { name: "Urlaubsantrag ablehnen" }),
  ).toBeVisible();
  await dialog.locator("#vacation-decision-reason").fill(reason);
  await dialog.getByRole("button", { name: "Ablehnen", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0, { timeout: 15_000 });
}

export async function cancelApprovedVacationFor(
  page: Page,
  personName: string,
  reason: string,
): Promise<void> {
  await openVacationApprovals(page);
  await page
    .getByRole("button", {
      name: `Genehmigten Urlaub von ${personName} stornieren`,
    })
    .click();
  const dialog = page.getByRole("dialog");
  await expect(
    dialog.getByRole("heading", { name: "Genehmigten Urlaub stornieren" }),
  ).toBeVisible();
  await dialog.locator("#vacation-decision-reason").fill(reason);
  await dialog.getByRole("button", { name: "Stornieren", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0, { timeout: 15_000 });
}

// Cancels one specific approved vacation when a person has several approved
// ranges: the range text disambiguates where the per-person aria-label alone
// would be ambiguous (strict mode).
export async function cancelApprovedVacationForRangeText(
  page: Page,
  personName: string,
  rangeText: string,
  reason: string,
): Promise<void> {
  await openVacationApprovals(page);
  await page
    .locator('[data-slot="card"]')
    .filter({ hasText: rangeText })
    .getByRole("button", {
      name: `Genehmigten Urlaub von ${personName} stornieren`,
    })
    .click();
  const dialog = page.getByRole("dialog");
  await expect(
    dialog.getByRole("heading", { name: "Genehmigten Urlaub stornieren" }),
  ).toBeVisible();
  await dialog.locator("#vacation-decision-reason").fill(reason);
  await dialog.getByRole("button", { name: "Stornieren", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0, { timeout: 15_000 });
}

// The clock-in contradiction rule: on an approved full-day vacation day the
// FAB flow is denied server-side with an understandable banner.
export async function expectClockInBlockedByVacation(
  page: Page,
): Promise<void> {
  await page.goto("/dashboard");
  await page.getByRole("button", { name: "Zeiterfassung starten" }).click();
  await expect(
    page.getByRole("heading", { name: "Zeiterfassung starten" }),
  ).toBeVisible();
  await page.getByRole("dialog").getByRole("button", { name: "Arbeit starten", exact: true }).click();
  await expect(visibleText(page, "Heute ist Urlaub genehmigt")).toBeVisible({
    timeout: 15_000,
  });
  // Still clocked out: the FAB keeps offering a start, never an active session.
  await expect(page.getByRole("button", { name: "Zeiterfassung starten" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Laufende Zeiterfassung öffnen" })).toHaveCount(0);
}

import { expect, type Locator, type Page } from "@playwright/test";
import { showPlanningMonth } from './calendar';

// P1-12: dispatch, Parkplatz context, customer commitments, batch moves.

export async function openDispatchPanel(
  page: Page,
  calendarDate?: string,
): Promise<void> {
  await showPlanningMonth(page, calendarDate);
  await page.getByRole("main").getByTestId("dispatch-panel-toggle").click();
  await expect(page.locator("[data-dispatch-panel]")).toBeVisible({
    timeout: 15_000,
  });
}

export function dispatchOccurrenceRow(page: Page, title: string): Locator {
  return page.locator("[data-dispatch-occurrence]").filter({ hasText: title });
}

// Issues the dispatch for the earliest panel row matching the title, and
// asserts the honest readiness picture on the way: tools are never assessed
// in this slice and must render as the labeled unknown, never as success.
export async function issueDispatchForOccurrence(
  page: Page,
  title: string,
  beforeSubmit?: () => void | Promise<void>,
): Promise<void> {
  const row = dispatchOccurrenceRow(page, title).first();
  await expect(row).toBeVisible({ timeout: 20_000 });
  await row.getByRole("button", { name: "Einsatz senden" }).click();
  const dialog = page
    .getByRole("dialog")
    .filter({ has: page.getByRole("heading", { name: "Einsatz senden" }) });
  await expect(
    dialog.locator(
      '[data-readiness-key="tools"][data-readiness-state="unknown"]',
    ),
  ).toBeVisible({ timeout: 20_000 });
  await beforeSubmit?.();
  await dialog.getByRole("button", { name: "Einsatz senden" }).click();
  await expect(dialog).toHaveCount(0, { timeout: 20_000 });
  await expect(row.locator("[data-recipient-state]").first()).toBeVisible({
    timeout: 20_000,
  });
}

export function jobDispatchSection(page: Page): Locator {
  return page.getByRole('main').getByTestId('job-dispatch-section');
}

export async function expectDispatchStateOnJobPage(
  page: Page,
  jobNumber: string,
  state: string,
): Promise<void> {
  await page.goto(`/auftraege/${jobNumber}`);
  const section = jobDispatchSection(page);
  await expect(section.locator(`[data-dispatch-state="${state}"]`)).toBeVisible(
    {
      timeout: 20_000,
    },
  );
}

export async function acknowledgeDispatchOnJobPage(
  page: Page,
  jobNumber: string,
): Promise<void> {
  await page.goto(`/auftraege/${jobNumber}`);
  const section = jobDispatchSection(page);
  await expect(section).toBeVisible({ timeout: 20_000 });
  await section.getByRole("button", { name: "Einsatz bestätigen" }).click();
  await expect(
    section.locator('[data-dispatch-state="bestaetigt"]'),
  ).toBeVisible({
    timeout: 20_000,
  });
}

export async function challengeDispatchOnJobPage(
  page: Page,
  jobNumber: string,
  reason: string,
): Promise<void> {
  await page.goto(`/auftraege/${jobNumber}`);
  const section = jobDispatchSection(page);
  await expect(section).toBeVisible({ timeout: 20_000 });
  await section.getByRole("button", { name: "Rückfrage stellen" }).click();
  const dialog = page.getByRole("dialog").filter({
    has: page.getByRole("heading", { name: "Rückfrage zum Einsatz" }),
  });
  await dialog.locator("#dispatch-challenge-reason").fill(reason);
  await dialog.getByRole("button", { name: "Rückfrage senden" }).click();
  await expect(dialog).toHaveCount(0, { timeout: 20_000 });
  await expect(
    section.locator('[data-dispatch-state="rueckfrage"]'),
  ).toBeVisible({
    timeout: 20_000,
  });
}

export async function resolveDispatchChallengeInPanel(
  page: Page,
  reason: string,
): Promise<void> {
  const panel = page.locator("[data-dispatch-panel]");
  await panel
    .getByRole("button", { name: /Plan beibehalten/ })
    .first()
    .click();
  const dialog = page
    .getByRole("dialog")
    .filter({ has: page.getByRole("heading", { name: "Plan beibehalten" }) });
  await dialog.locator("#dispatch-reason-dialog").fill(reason);
  await dialog
    .getByRole("button", { name: "Beibehalten", exact: true })
    .click();
  await expect(dialog).toHaveCount(0, { timeout: 20_000 });
}

export async function openParkplatzPanel(page: Page): Promise<void> {
  await page.goto("/kalender");
  // The button's accessible name includes the live count badge.
  await page.getByRole("button", { name: /^Parkplatz/ }).click();
  await expect(page.locator("[data-parkplatz-panel]")).toBeVisible({
    timeout: 15_000,
  });
}

export function parkplatzCard(page: Page, title: string): Locator {
  // Filter instead of interpolating the title into a CSS selector.
  return page
    .locator("[data-parkplatz-card]")
    .filter({ has: page.getByText(title, { exact: true }) });
}

export async function dispatchParkedJobFromParkplatz(
  page: Page,
  options: { jobTitle: string; recipientName: string },
): Promise<void> {
  const card = parkplatzCard(page, options.jobTitle);
  await expect(card).toBeVisible({ timeout: 20_000 });
  await card.getByRole("button", { name: /^Einsatz für .* senden$/ }).click();
  const dialog = page
    .getByRole("dialog")
    .filter({ has: page.getByRole("heading", { name: "Einsatz senden" }) });
  await expect(
    dialog.locator(
      '[data-readiness-key="tools"][data-readiness-state="unknown"]',
    ),
  ).toBeVisible({ timeout: 20_000 });
  await dialog
    .getByRole("checkbox", {
      name: `${options.recipientName} als Empfänger auswählen`,
    })
    .check();
  await dialog.getByRole("button", { name: "Einsatz senden" }).click();
  await expect(dialog).toHaveCount(0, { timeout: 20_000 });
}

// Records a date-only customer commitment for the panel row (the dialog
// prefills the occurrence's Berlin date). Recording sends NO message.
export async function recordCommitmentForOccurrence(
  page: Page,
  title: string,
): Promise<void> {
  const row = dispatchOccurrenceRow(page, title).first();
  await expect(row).toBeVisible({ timeout: 20_000 });
  await row
    .getByRole("button", { name: /^(Zusage erfassen|Neue Zusage erfassen)$/ })
    .click();
  const dialog = page.getByRole("dialog").filter({
    has: page.getByRole("heading", { name: "Kundenzusage erfassen" }),
  });
  await dialog.getByRole("button", { name: "Zusage erfassen" }).click();
  await expect(dialog).toHaveCount(0, { timeout: 20_000 });
}

export async function startBatchRescheduleInPanel(
  page: Page,
  options: {
    titles: string[];
    /** Total rows the selection must cover across all titles. */
    expectedCount: number;
    dayShiftText: string;
    reason: string;
  },
): Promise<Locator> {
  const panel = page.locator("[data-dispatch-panel]");
  await panel.getByRole("button", { name: "Verschieben", exact: true }).click();
  for (const title of options.titles) {
    const rows = panel
      .locator("[data-dispatch-occurrence]")
      .filter({ hasText: title });
    const rowCount = await rows.count();
    for (let index = 0; index < rowCount; index += 1) {
      await rows.nth(index).getByRole("checkbox").check();
    }
  }
  // A Realtime re-render between clicks could reorder rows; the panel's own
  // selection counter is the authoritative proof every row got selected.
  await expect(
    panel.getByText(
      `${options.expectedCount} Besuch${options.expectedCount === 1 ? "" : "e"} ausgewählt`,
      { exact: true },
    ),
  ).toBeVisible({ timeout: 10_000 });
  await panel.locator("#batch-day-shift").fill(options.dayShiftText);
  await panel.locator("#batch-reason").fill(options.reason);
  await panel.getByRole("button", { name: "Auswirkungen prüfen" }).click();
  const preview = page.getByRole("dialog").filter({
    has: page.getByRole("heading", { name: "Verschiebung prüfen" }),
  });
  await expect(preview).toBeVisible({ timeout: 30_000 });
  return preview;
}

// Commits the previewed batch. The separate planning-warning dialog appears
// only when the shared assessment found conflicts (e.g. the focused world has
// no schedules); supplying the override reason covers both modes.
export async function confirmBatchReschedule(
  page: Page,
  preview: Locator,
  overrideReason: string,
): Promise<void> {
  await preview.getByRole("button", { name: "Jetzt verschieben" }).click();
  const warning = page.getByRole("dialog").filter({
    has: page.getByRole("heading", { name: "Planungshinweise prüfen" }),
  });
  await expect
    .poll(
      async () => {
        if (await warning.isVisible().catch(() => false)) return "warning";
        if (!(await preview.isVisible().catch(() => false))) return "closed";
        return "pending";
      },
      { timeout: 30_000 },
    )
    .not.toBe("pending");
  if (await warning.isVisible().catch(() => false)) {
    await warning.locator("#planning-warning-reason").fill(overrideReason);
    await warning
      .getByRole("button", { name: "Mit Begründung speichern" })
      .click();
  }
  await expect(preview).toHaveCount(0, { timeout: 30_000 });
}

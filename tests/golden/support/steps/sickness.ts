import { expect, type Page } from "@playwright/test";
import { typeIntoDatePicker, visibleText } from './shared';

// P1-08: sickness / privacy-sensitive absence. A report is a fact, not a
// request — every step asserts the resulting state transition, never a
// transient flash (inherited rows could satisfy texts alone).

export async function openOwnSicknessSection(page: Page): Promise<void> {
  await page.goto("/zeiterfassung");
  await expect(visibleText(page, "Krankmeldung")).toBeVisible({
    timeout: 15_000,
  });
}

// Self-report. `endDigits` undefined = open-ended („bis auf Weiteres").
// The overlap hint against approved vacation is mode-dependent state, so the
// caller passes `expectVacationOverlapHint` derived from the database.
export async function reportOwnSicknessViaDialog(
  page: Page,
  options: {
    startDigits: string;
    endDigits?: string;
    halfDay?: boolean;
    typeLabel?: "Krankheit" | "Kind krank" | "Sonstige Abwesenheit";
    expectVacationOverlapHint?: boolean;
  },
): Promise<void> {
  await openOwnSicknessSection(page);
  await page.getByRole("button", { name: "Krank melden" }).click();
  await expect(
    page.getByRole("heading", { name: "Krank melden" }),
  ).toBeVisible();

  const dialog = page.getByRole("dialog");
  if (options.typeLabel) {
    await dialog.locator("#sickness-type").click();
    await page
      .getByRole("option", { name: options.typeLabel, exact: true })
      .click();
  }
  await typeIntoDatePicker(dialog, "Ab", options.startDigits);
  if (options.endDigits !== undefined) {
    await dialog.locator("#sickness-end-known").click();
    await typeIntoDatePicker(dialog, "Bis", options.endDigits);
    if (options.halfDay) {
      await dialog.locator("#sickness-half-day").click();
    }
  }
  await dialog.getByRole("button", { name: "Krank melden" }).click();
  if (options.expectVacationOverlapHint) {
    // The saved report shows the overlap hint until explicitly acknowledged.
    await expect(
      dialog.getByText("überschneidet sich mit genehmigtem Urlaub"),
    ).toBeVisible({
      timeout: 15_000,
    });
    await dialog.getByRole("button", { name: "Verstanden" }).click();
  }
  await expect(page.getByRole("dialog")).toHaveCount(0, { timeout: 15_000 });
}

// Overlapping own active sickness is impossible (gist exclusion constraint);
// the dialog stays open with an understandable error.
export async function expectSicknessOverlapRejectedViaDialog(
  page: Page,
  options: { startDigits: string; endDigits?: string },
): Promise<void> {
  await openOwnSicknessSection(page);
  await page.getByRole("button", { name: "Krank melden" }).click();
  const dialog = page.getByRole("dialog");
  await typeIntoDatePicker(dialog, "Ab", options.startDigits);
  if (options.endDigits !== undefined) {
    await dialog.locator("#sickness-end-known").click();
    await typeIntoDatePicker(dialog, "Bis", options.endDigits);
  }
  await dialog.getByRole("button", { name: "Krank melden" }).click();
  await expect(
    dialog.getByText(
      "Für diesen Zeitraum ist bereits eine Krankmeldung erfasst.",
    ),
  ).toBeVisible({ timeout: 15_000 });
  await dialog.getByRole("button", { name: "Abbrechen" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0, { timeout: 15_000 });
}

// Own close-out: set the end date on an active report identified by its
// current range text (aria-label). Success = the dialog closes and the row
// shows the new range.
export async function setOwnSicknessEndDateViaDialog(
  page: Page,
  options: { rangeText: string; endDigits: string; expectedRangeText: string },
): Promise<void> {
  await openOwnSicknessSection(page);
  await page
    .getByRole("button", {
      name: `Enddatum für die Krankmeldung vom ${options.rangeText} setzen`,
    })
    .click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await typeIntoDatePicker(dialog, "Letzter Tag", options.endDigits);
  await dialog.getByRole("button", { name: "Enddatum speichern" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0, { timeout: 15_000 });
  await expect(visibleText(page, options.expectedRangeText)).toBeVisible({
    timeout: 15_000,
  });
}

// Office entry on the currently open member/personnel detail (the 7:00
// phone-call-in path). `endDigits` undefined = open-ended.
export async function recordSicknessForMemberViaSection(
  page: Page,
  options: {
    startDigits: string;
    endDigits?: string;
    halfDay?: boolean;
    typeLabel?: "Krankheit" | "Kind krank" | "Sonstige Abwesenheit";
    evidenceRequired?: boolean;
    expectVacationOverlapHint?: boolean;
  },
): Promise<void> {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    await page.waitForTimeout(300);
    await page.getByRole("button", { name: "Krankmeldung erfassen" }).click();
    await expect(
      page.getByRole("heading", { name: "Krankmeldung erfassen" }),
    ).toBeVisible();
    const dialog = page.getByRole("dialog");
    let submitted = false;
    try {
      if (options.typeLabel) {
        await dialog.locator("#record-sickness-type").click();
        await page
          .getByRole("option", { name: options.typeLabel, exact: true })
          .click();
      }
      await typeIntoDatePicker(dialog, "Ab", options.startDigits);
      if (options.endDigits !== undefined) {
        await dialog.locator("#record-sickness-end-known").click();
        await typeIntoDatePicker(dialog, "Bis", options.endDigits);
        if (options.halfDay) {
          await dialog.locator("#record-sickness-half-day").click();
        }
      }
      if (options.evidenceRequired) {
        await dialog.locator("#record-sickness-evidence").click();
      }
      submitted = true;
      await dialog
        .getByRole("button", { name: "Krankmeldung erfassen" })
        .click();
      if (options.expectVacationOverlapHint) {
        // The saved report shows the overlap hint until explicitly acknowledged.
        await expect(
          dialog.getByText("überschneidet sich mit genehmigtem Urlaub"),
        ).toBeVisible({
          timeout: 15_000,
        });
        await dialog.getByRole("button", { name: "Verstanden" }).click();
      }
      await expect(page.getByRole("dialog")).toHaveCount(0, {
        timeout: 15_000,
      });
      return;
    } catch (error) {
      const interruptedBeforeSubmit =
        !submitted && !(await dialog.isVisible().catch(() => false));
      if (attempt === 0 && interruptedBeforeSubmit) continue;
      throw error;
    }
  }

  throw new Error(
    "recordSicknessForMemberViaSection: dialog remained interrupted",
  );
}

// Manager actions on one report row of the member-detail section, addressed
// by the report's range text (the per-item aria-label disambiguates).
async function openSicknessReportMenu(
  page: Page,
  rangeText: string,
  itemName: string | RegExp,
): Promise<void> {
  await page
    .getByRole("button", {
      name: `Aktionen für die Krankmeldung vom ${rangeText}`,
    })
    .click();
  await page.getByRole("menuitem", { name: itemName }).click();
}

export async function setSicknessEvidenceViaMenu(
  page: Page,
  rangeText: string,
  options: { required: boolean; received?: boolean },
): Promise<void> {
  await openSicknessReportMenu(page, rangeText, "Nachweis verwalten");
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  const requiredBox = dialog.locator("#evidence-required");
  const isChecked =
    (await requiredBox.getAttribute("data-state")) === "checked";
  if (isChecked !== options.required) {
    await requiredBox.click();
  }
  if (options.required) {
    const receivedBox = dialog.locator("#evidence-received");
    const receivedChecked =
      (await receivedBox.getAttribute("data-state")) === "checked";
    if (receivedChecked !== (options.received ?? false)) {
      await receivedBox.click();
    }
  }
  await dialog.getByRole("button", { name: "Speichern", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0, { timeout: 15_000 });
}

export async function cancelSicknessReportViaMenuWithReason(
  page: Page,
  rangeText: string,
  reason: string,
): Promise<void> {
  await openSicknessReportMenu(page, rangeText, "Stornieren");
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await dialog.locator("#cancel-sickness-reason").fill(reason);
  await dialog.getByRole("button", { name: "Stornieren", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0, { timeout: 15_000 });
  // The row flips to the terminal state — the precise transition, not a text
  // an inherited row could already satisfy.
  await expect(
    page
      .locator("[data-sickness-report]")
      .filter({ hasText: rangeText })
      .getByText("Storniert")
      .first(),
  ).toBeVisible({ timeout: 15_000 });
}

// Clock-in on a sick day succeeds with a visible notice (warn, never block).
export async function expectClockInNoticeForSickness(
  page: Page,
): Promise<void> {
  await page.goto("/dashboard");
  await page.getByRole("button", { name: "Zeiterfassung starten" }).click();
  await expect(
    page.getByRole("heading", { name: "Zeiterfassung starten" }),
  ).toBeVisible();
  await page.getByRole("dialog").getByRole("button", { name: "Arbeit starten", exact: true }).click();
  await expect(
    visibleText(page, "Für heute liegt eine Krankmeldung vor"),
  ).toBeVisible({
    timeout: 15_000,
  });
  // Clocked IN despite the notice — the warn-not-block contract.
  await expect(page.getByRole("button", { name: "Laufende Zeiterfassung öffnen" })).toBeVisible({
    timeout: 15_000,
  });
}

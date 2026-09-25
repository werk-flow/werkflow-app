import { expect, type Locator, type Page } from "@playwright/test";
import { expectVisibleAfterSave, selectFromSearchable, typeIntoDatePicker, visibleText } from './shared';

// P1-03: personnel identity and date-effective employment conditions.

export async function openMemberDetailFromList(
  page: Page,
  name: string,
): Promise<void> {
  await page.goto("/mitarbeiter");
  const memberLink = page.getByRole("link", { name, exact: true });
  await expect(memberLink).toBeVisible({ timeout: 20_000 });
  const memberHref = await memberLink.getAttribute("href");
  if (!memberHref) {
    throw new Error(`openMemberDetailFromList: link for ${name} has no href`);
  }
  // This helper often follows a settings mutation whose Realtime event can
  // still refresh the list and supersede an App Router transition. Follow the
  // semantic link directly while establishing the persisted setup state.
  await page.goto(memberHref);
  await page.waitForURL(/\/mitarbeiter\/[0-9a-f-]{36}/, { timeout: 20_000 });
  await expect(visibleText(page, "Personalien")).toBeVisible({
    timeout: 15_000,
  });
}

// Inline edit of one Personalien field through the shared MetadataSection
// pencil-edit flow (text fields only; dates use the segmented DatePicker).
export async function editPersonnelTextField(
  page: Page,
  fieldLabel: string,
  value: string,
): Promise<void> {
  await editMetadataTextField(page, fieldLabel, value);
}

export async function editMetadataTextField(
  page: Page,
  fieldLabel: string,
  value: string,
): Promise<void> {
  await page
    .getByRole("button", { name: `${fieldLabel} bearbeiten`, exact: true })
    .click();
  // The field editor autofocuses its input; targeting :focus avoids matching
  // unrelated inputs elsewhere on the detail page (e.g. table search boxes).
  const input = page.locator("input:focus, textarea:focus");
  await expect(input).toBeVisible();
  await input.fill(value);
  await page.getByRole("button", { name: "Speichern", exact: true }).click();
  await expectVisibleAfterSave(page, value);
}

// P1-05: scoped responsibilities, effective previews, and substitutions.

export async function previewResponsibilityChange(
  page: Page,
  options: {
    responsibility: "time_approval" | "leave_approval";
    selectedNames?: string[];
    gainedNames?: string[];
    lostNames?: string[];
  },
): Promise<void> {
  await page.goto("/einstellungen/mitarbeiter");
  const card = page.getByRole("main").getByTestId(`responsibility-${options.responsibility}`);
  await card.getByRole("button", { name: "Verantwortung ändern" }).click();
  const dialog = page.getByRole("dialog");

  if (options.selectedNames) {
    await dialog.locator(`#${options.responsibility}-mode`).click();
    await page.getByRole("option", { name: "Bestimmte Personen" }).click();
    await expect(dialog.getByRole("checkbox").first()).toBeVisible({
      timeout: 15_000,
    });
    for (const checkbox of await dialog.getByRole("checkbox").all()) {
      if (await checkbox.isChecked()) await checkbox.uncheck();
    }
    for (const name of options.selectedNames) {
      await dialog.getByRole("checkbox", { name: new RegExp(name) }).check();
    }
  } else {
    await dialog.locator(`#${options.responsibility}-mode`).click();
    await page
      .getByRole("option", { name: "Standardrollen: Admin und Büro" })
      .click();
  }

  await dialog.getByRole("button", { name: "Wirkung prüfen" }).click();
  const preview = dialog.getByTestId("effective-access-preview");
  await expect(preview).toBeVisible({ timeout: 15_000 });
  const gainedSection = preview.getByTestId("preview-gained");
  const lostSection = preview.getByTestId("preview-lost");
  for (const name of options.gainedNames ?? []) {
    await expect(gainedSection.getByText(name, { exact: false })).toBeVisible();
  }
  for (const name of options.lostNames ?? []) {
    await expect(lostSection.getByText(name, { exact: false })).toBeVisible();
  }
}

export async function confirmResponsibilityPreview(page: Page): Promise<void> {
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Änderung bestätigen" })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0, { timeout: 15_000 });
}

export async function createResponsibilityDelegationViaSettings(
  page: Page,
  options: {
    responsibility: "time_approval" | "leave_approval";
    delegatorName: string;
    substituteName: string;
    validFromDigits: string;
    validUntilDigits: string;
  },
): Promise<void> {
  await page.goto("/einstellungen/mitarbeiter");
  const card = page.getByRole("main").getByTestId(`responsibility-${options.responsibility}`);
  await card.getByRole("button", { name: "Vertretung eintragen" }).click();
  const dialog = page.getByRole("dialog");

  const delegatorTrigger = dialog.locator(
    `#${options.responsibility}-delegator`,
  );
  await expect(delegatorTrigger).toBeVisible({ timeout: 15_000 });
  if (
    !(await delegatorTrigger.textContent())?.includes(options.delegatorName)
  ) {
    await selectFromSearchable(page, delegatorTrigger, options.delegatorName);
  }
  await selectFromSearchable(
    page,
    dialog.locator(`#${options.responsibility}-substitute`),
    options.substituteName,
  );
  await typeIntoDatePicker(dialog, "Gültig ab", options.validFromDigits);
  await typeIntoDatePicker(dialog, "Gültig bis", options.validUntilDigits);
  await dialog.getByRole("button", { name: "Vertretung speichern" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0, { timeout: 15_000 });
  const activeDelegationRow = (scope: Locator) =>
    scope
      .locator("li")
      .filter({ hasText: options.substituteName })
      .filter({ has: page.getByRole("button", { name: "Heute beenden" }) })
      .first();
  try {
    await expect(activeDelegationRow(card)).toBeVisible({ timeout: 15_000 });
  } catch {
    await page.reload();
    await expect(
      activeDelegationRow(
        page.getByRole("main").getByTestId(`responsibility-${options.responsibility}`),
      ),
    ).toBeVisible({ timeout: 15_000 });
  }
}

export async function endResponsibilityDelegationViaSettings(
  page: Page,
  responsibility: "time_approval" | "leave_approval",
  substituteName: string,
): Promise<void> {
  await page.goto("/einstellungen/mitarbeiter");
  const card = page.getByRole("main").getByTestId(`responsibility-${responsibility}`);
  const row = card
    .locator("li")
    .filter({ hasText: substituteName })
    .filter({ has: page.getByRole("button", { name: "Heute beenden" }) })
    .first();
  await row.getByRole("button", { name: "Heute beenden" }).click();
  const endedRow = card
    .locator("li")
    .filter({ hasText: substituteName })
    .filter({ has: page.getByText("Beendet", { exact: true }) })
    .first();
  await expect(endedRow.getByText("Beendet", { exact: true })).toBeVisible({
    timeout: 15_000,
  });
}

export async function addConditionViaDialog(
  page: Page,
  options: {
    // ddmmyyyy digits for the valid-from date; omitted = keep today's default.
    validFromDigits?: string;
    employmentTypeLabel: string;
    weeklyHours?: string;
    vacationDays?: string;
    note?: string;
  },
): Promise<void> {
  const detailUrl = page.url();
  for (let attempt = 0; attempt < 2; attempt += 1) {
    if (page.url() !== detailUrl) await page.goto(detailUrl);
    // Drain a pending refresh from the preceding test of the file before the
    // modal owns user input. The hook itself debounces for 150 ms (REALTIME_DEBOUNCE_MS).
    await page.waitForTimeout(300);
    if (page.url() !== detailUrl) {
      if (attempt === 0) continue;
      throw new Error("addConditionViaDialog: detail route refreshed away");
    }
    await page.getByRole("button", { name: "Kondition hinzufügen" }).click();
    await expect(
      page.getByRole("heading", { name: "Kondition hinzufügen" }),
    ).toBeVisible();

    const dialog = page.getByRole("dialog");
    try {
      if (options.validFromDigits) {
        // Keep controlled date entry below the shared 150 ms Realtime debounce.
        await typeIntoDatePicker(
          dialog,
          "Gültig ab",
          options.validFromDigits,
          10,
        );
      }

      await dialog.locator("#condition-type").click({ timeout: 5_000 });
      await page
        .getByRole("option", { name: options.employmentTypeLabel, exact: true })
        .click({ timeout: 5_000 });

      if (options.weeklyHours !== undefined) {
        await dialog
          .locator("#condition-weekly-hours")
          .fill(options.weeklyHours, { timeout: 5_000 });
      }
      if (options.vacationDays !== undefined) {
        await dialog
          .locator("#condition-vacation-days")
          .fill(options.vacationDays, { timeout: 5_000 });
      }
      if (options.note !== undefined) {
        await dialog
          .locator("#condition-note")
          .fill(options.note, { timeout: 5_000 });
      }

      await dialog
        .getByRole("button", { name: "Speichern", exact: true })
        .click({ timeout: 5_000 });
      await expect(page.getByRole("dialog")).toHaveCount(0, {
        timeout: 15_000,
      });
      return;
    } catch (error) {
      const dialogWasInterrupted =
        page.url() !== detailUrl ||
        !(await dialog.isVisible().catch(() => false));
      if (attempt === 0 && dialogWasInterrupted) continue;
      throw error;
    }
  }
}

export async function editConditionWeeklyHours(
  page: Page,
  validFromLabel: string,
  weeklyHours: string,
): Promise<void> {
  const row = page
    .locator("li")
    .filter({ hasText: `Gültig ab ${validFromLabel}` })
    .filter({ visible: true })
    .first();
  await row
    .getByRole("button", {
      name: `Aktionen für Kondition vom ${validFromLabel}`,
    })
    .click();
  await page.getByRole("menuitem", { name: "Bearbeiten" }).click();
  await expect(
    page.getByRole("heading", { name: "Kondition bearbeiten" }),
  ).toBeVisible();
  await page.locator("#condition-weekly-hours").fill(weeklyHours);
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Speichern", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0, { timeout: 15_000 });
}

export async function createPersonnelRecordViaDialog(
  page: Page,
  options: {
    firstName?: string;
    lastName: string;
    entryDateDigits?: string;
    employeeNumber?: string;
  },
): Promise<string> {
  await page.goto("/mitarbeiter");
  await page.getByRole("button", { name: "Personalakte anlegen" }).click();
  await expect(
    page.getByRole("heading", { name: "Personalakte anlegen" }),
  ).toBeVisible();

  const dialog = page.getByRole("dialog");
  if (options.firstName) {
    await page.locator("#personnel-first-name").fill(options.firstName);
  }
  await page.locator("#personnel-last-name").fill(options.lastName);
  if (options.employeeNumber !== undefined) {
    await page.locator("#personnel-number").fill(options.employeeNumber);
  } else {
    // The number suggestion arrives asynchronously; wait so the submit cannot
    // race it (mirrors the request/job dialogs).
    await expect(page.locator("#personnel-number")).toHaveValue(/.+/, {
      timeout: 15_000,
    });
  }
  if (options.entryDateDigits) {
    await typeIntoDatePicker(dialog, "Eintrittsdatum", options.entryDateDigits);
  }

  await dialog
    .getByRole("button", { name: "Personalakte anlegen", exact: true })
    .click();
  const reachedDetail = await page
    .waitForURL(/\/mitarbeiter\/[0-9a-f-]{36}/, { timeout: 20_000 })
    .then(() => true)
    .catch(() => false);
  if (!reachedDetail) {
    // Realtime can refresh the list after the insert and win the race against
    // the action's detail redirect. Follow the persisted row instead.
    const recordName = [options.firstName, options.lastName]
      .filter(Boolean)
      .join(" ");
    const recordLink = page.getByRole("link", {
      name: recordName,
      exact: true,
    });
    await expect(recordLink).toBeVisible({ timeout: 30_000 });
    await recordLink.click();
    await page.waitForURL(/\/mitarbeiter\/[0-9a-f-]{36}/, { timeout: 20_000 });
  }

  const recordId = page.url().match(/\/mitarbeiter\/([0-9a-f-]{36})/)?.[1];
  if (!recordId) {
    throw new Error(
      "createPersonnelRecordViaDialog: could not read the record id",
    );
  }
  return recordId;
}

export async function sendInviteFromPersonnelRecord(
  page: Page,
  email: string,
  roleLabel: "Büro" | "Handwerker/in",
): Promise<void> {
  await page.getByRole("button", { name: "Zugang einladen" }).click();
  await expect(
    page.getByRole("heading", { name: /Zugang für .* einladen/ }),
  ).toBeVisible();
  await page.locator("#personnel-invite-email").fill(email);
  await page.locator("#personnel-invite-role").click();
  await page.getByRole("option", { name: roleLabel, exact: true }).click();
  await page.getByRole("button", { name: "Einladung senden" }).click();
  // A Realtime refresh can replace the dialog before its short success flash
  // is observed. Assert the persisted personnel state and audit entry instead.
  await expect(page.getByRole("dialog")).toHaveCount(0, {
    timeout: 30_000,
  });
  await expect(visibleText(page, "Eingeladen")).toBeVisible();
  await expect(visibleText(page, "Einladung versendet")).toBeVisible();
}

// P1-04: date-effective work schedules and holiday/closure context.

export async function addWorkScheduleViaDialog(
  page: Page,
  options: {
    // ddmmyyyy digits for the valid-from date; omitted = keep today's default.
    validFromDigits?: string;
    // Hours per weekday as typed strings, index 0 = Montag … 6 = Sonntag;
    // omitted = keep the dialog's full-time default (Mo–Fr 8, weekend 0).
    dayHours?: string[];
    note?: string;
  },
): Promise<void> {
  const detailUrl = page.url();
  for (let attempt = 0; attempt < 2; attempt += 1) {
    if (page.url() !== detailUrl) await page.goto(detailUrl);
    // A schedule event from the preceding test's action can arrive after
    // navigation. Let the 150 ms router-refresh debounce (REALTIME_DEBOUNCE_MS) settle first.
    await page.waitForTimeout(300);
    if (page.url() !== detailUrl) {
      if (attempt === 0) continue;
      throw new Error("addWorkScheduleViaDialog: detail route refreshed away");
    }
    await page.getByRole("button", { name: "Wochenplan hinzufügen" }).click();
    await expect(
      page.getByRole("heading", { name: "Wochenplan hinzufügen" }),
    ).toBeVisible();

    const dialog = page.getByRole("dialog");
    try {
      if (options.validFromDigits) {
        // Keep this controlled input below the shared 150 ms Realtime debounce.
        await typeIntoDatePicker(
          dialog,
          "Gültig ab",
          options.validFromDigits,
          10,
        );
      }
      if (options.dayHours) {
        for (const [index, hours] of options.dayHours.entries()) {
          await dialog
            .locator(`#schedule-day-${index}`)
            .fill(hours, { timeout: 5_000 });
        }
      }
      if (options.note !== undefined) {
        await dialog
          .locator("#schedule-note")
          .fill(options.note, { timeout: 5_000 });
      }
      await dialog
        .getByRole("button", { name: "Speichern", exact: true })
        .click({ timeout: 5_000 });
      await expect(page.getByRole("dialog")).toHaveCount(0, {
        timeout: 15_000,
      });
      return;
    } catch (error) {
      const dialogWasInterrupted =
        page.url() !== detailUrl ||
        !(await dialog.isVisible().catch(() => false));
      if (attempt === 0 && dialogWasInterrupted) continue;
      throw error;
    }
  }
}

export async function setHolidayRegionViaSettings(
  page: Page,
  regionLabel: string,
): Promise<void> {
  await page.goto("/einstellungen/zeiterfassung");
  await selectFromSearchable(
    page,
    page.locator("#holiday-region"),
    regionLabel,
  );
  await page
    .getByRole("button", { name: "Feiertagskalender speichern" })
    .click();
  await expect(
    page.getByText("Der Feiertagskalender wurde gespeichert."),
  ).toBeVisible({
    timeout: 15_000,
  });
}

export async function addClosureDayViaSettings(
  page: Page,
  options: { dateDigits: string; label?: string; beforeSubmit?: () => Promise<void> },
): Promise<void> {
  await page.goto("/einstellungen/zeiterfassung");
  await typeIntoDatePicker(
    page.locator("body"),
    "Datum der Betriebsruhe",
    options.dateDigits,
  );
  if (options.label !== undefined) {
    await page.locator("#closure-label").fill(options.label);
  }
  await options.beforeSubmit?.();
  await page.getByRole("button", { name: "Eintragen" }).click();
  await expect(
    page.getByText("Der Betriebsruhe-Tag wurde eingetragen."),
  ).toBeVisible({
    timeout: 15_000,
  });
}

// dateLabel: dd.mm.yyyy — the aria-label also contains the weekday, so match
// via regular expression around the date.
export async function removeClosureDayViaSettings(
  page: Page,
  dateLabel: string,
  beforeSubmit?: () => Promise<void>,
): Promise<void> {
  await page.goto("/einstellungen/zeiterfassung");
  const escaped = dateLabel.replace(/\./g, "\\.");
  await beforeSubmit?.();
  await page
    .getByRole("button", {
      name: new RegExp(`Betriebsruhe am .*${escaped} entfernen`),
    })
    .click();
  await expect(
    page.getByText("Der Betriebsruhe-Tag wurde entfernt."),
  ).toBeVisible({
    timeout: 15_000,
  });
}

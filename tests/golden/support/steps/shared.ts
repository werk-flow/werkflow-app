import { expect, type Locator, type Page } from "@playwright/test";
import { retryBeforeSubmit } from "../../../../lib/testing/retry-before-submit";

// Pages often render the same text twice (desktop table + hidden mobile card);
// assertions must target the visible instance.
/** First visible match of a pattern; responsive views can render the same text twice. */
export function visibleMatchingText(page: Page, text: RegExp): Locator {
  return page.getByText(text).filter({ visible: true }).first();
}

export function visibleText(
  container: Page | Locator,
  text: string,
  exact = false,
): Locator {
  return container.getByText(text, { exact }).filter({ visible: true }).first();
}

// Absence and privacy assertions must inspect every matching DOM node. A
// visible-only lookup would let forbidden data survive in a hidden responsive
// render while the boundary test still passed.
export function textInDom(page: Page, text: string): Locator {
  return page.getByText(text);
}

// Dialog suspension drops a *scheduled* refresh timer, but it cannot cancel a
// router.refresh already in flight — a refresh that fired just before the
// dialog opened can still land mid-interaction and unmount the dialog
// (structural gap recorded at Stage B closure, 2026-08-28; it closed the
// Zurücklegen dialog under a running fill and hung an unbounded retry 287 s).
// "The dialog vanished under me" is therefore a bounded, retryable condition,
// never something to wait out. Preparation contains no submission. Once
// submit starts, an error cannot safely distinguish a rejected click from a
// committed write whose response was lost, so submission never retries.
export async function retryDialogTransaction(input: {
  open: () => Promise<void>;
  dialog: Locator;
  prepare: () => Promise<void>;
  submit: () => Promise<void>;
  /** Bounded open/prepare attempts, default 3. Submission runs once. */
  attempts?: number;
}): Promise<void> {
  await retryBeforeSubmit({
    prepare: async () => {
      await input.open();
      await input.prepare();
    },
    submit: input.submit,
    canRetryPreparation: async () => (await input.dialog.count()) === 0,
    ...(input.attempts !== undefined ? { attempts: input.attempts } : {}),
  });
  await expect(input.dialog).toHaveCount(0, { timeout: 20_000 });
}

export async function openDialogWithRetry(input: {
  trigger: Locator;
  dialog: Locator;
  attempts?: number;
}): Promise<void> {
  const attempts = input.attempts ?? 3;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    await input.trigger.click({ timeout: 15_000 });
    if (
      await input.dialog
        .waitFor({ state: "visible", timeout: 2_500 })
        .then(() => true)
        .catch(() => false)
    ) {
      return;
    }
  }
  throw new Error("Dialog did not open after bounded retries");
}

/** Finds the labelled input whose current DOM value matches exactly. */
export async function inputByValue(
  container: Page | Locator,
  label: string,
  value: string,
): Promise<Locator> {
  const inputs = container.getByLabel(label);
  await expect(inputs).not.toHaveCount(0, { timeout: 15_000 });
  const count = await inputs.count();
  for (let index = 0; index < count; index += 1) {
    const input = inputs.nth(index);
    if ((await input.inputValue()) === value) return input;
  }
  throw new Error(`No input labelled "${label}" has the value "${value}".`);
}

export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// P1-01: customer contact and work-site management on the customer detail.

// The customer detail refreshes itself after each save, but under suite load
// that refresh has landed after 15-30s, and a single Realtime delivery can be
// missed entirely (documented transient class; a certification failure showed
// the committed row with a still-empty list after 30s). Wait within the live
// envelope first, then use the one sanctioned reload as an explicit goto to
// the captured route — a bare reload racing a concurrent router refresh has
// landed on Dashboard before — and assert the server-rendered persisted row.
export async function expectVisibleAfterSave(
  page: Page,
  text: string,
): Promise<void> {
  try {
    await expect(visibleText(page, text)).toBeVisible({ timeout: 30_000 });
  } catch {
    const route = page.url();
    await page.goto(route);
    await expect(visibleText(page, text)).toBeVisible({ timeout: 15_000 });
  }
}

// The segmented DatePicker (dd.mm.yyyy) is driven by typing digits after
// focusing the group; segments auto-advance after two/two/four digits. The
// group's accessible name is the field label (e.g. "Gültig ab").
export async function typeIntoDatePicker(
  scope: Locator,
  groupName: string,
  digits: string,
  delayMs = 50,
): Promise<void> {
  const group = scope.getByRole("group", { name: groupName });
  await group.click();
  // The click may land on any segment; ArrowLeft twice normalizes to the day
  // segment because the control has exactly day, month, and year segments.
  await group.press("ArrowLeft");
  await group.press("ArrowLeft");
  await group.pressSequentially(digits, { delay: delayMs });
}

// (TimeInput already has a shared helper: typeIntoTimeInput below, addressed
// by element id. Reuse it for every migrated time field.)

// DatePicker addressed by element id instead of accessible name — for the
// DateTimeField composite and standalone pickers with known ids.
export async function typeIntoDatePickerById(
  scope: Locator,
  id: string,
  isoDate: string, // 'YYYY-MM-DD'
  options?: { timeout?: number },
): Promise<void> {
  const digits = `${isoDate.slice(8, 10)}${isoDate.slice(5, 7)}${isoDate.slice(0, 4)}`;
  const group = scope.locator(`#${id}`);
  const timeoutOptions = options?.timeout !== undefined ? { timeout: options.timeout } : {};
  await group.click(timeoutOptions);
  await group.press("ArrowLeft", timeoutOptions);
  await group.press("ArrowLeft", timeoutOptions);
  await group.pressSequentially(digits, { delay: 50, ...timeoutOptions });
}

// DateTimeField (DatePicker + TimeInput over one combined value). Accepts the
// former datetime-local string format so migrated steps stay drop-in.
export async function typeIntoDateTimeField(
  scope: Locator,
  idPrefix: string,
  localValue: string, // 'YYYY-MM-DDTHH:mm'
  options?: { timeout?: number },
): Promise<void> {
  const [datePart, timePart] = localValue.split("T");
  if (!datePart) throw new Error("typeIntoDateTimeField requires a 'YYYY-MM-DD[THH:mm]' value");
  await typeIntoDatePickerById(scope, `${idPrefix}-date`, datePart, options);
  if (timePart) {
    await typeIntoTimeInput(
      scope,
      `${idPrefix}-time`,
      timePart.replace(":", ""),
      options,
    );
  }
}

// UI/UX consolidation shared steps: every SearchableSelect/-MultiSelect in the
// app has the same anatomy (combobox trigger → search textbox → semantic options
// in a listbox). Specs pass the trigger locator (by id or by visible text via
// page.getByRole('combobox').filter({ hasText })). Migrating a form onto the
// registry components means switching its spec steps to these helpers, so a
// future component change touches only this file.

export async function selectFromSearchable(
  page: Page,
  trigger: Locator,
  optionText: string,
  options?: { searchFirst?: boolean },
): Promise<void> {
  const listbox = page.getByRole("listbox").filter({ visible: true }).first();
  const triggerId = await trigger.getAttribute("id");
  const stableTrigger = triggerId ? page.locator(`#${triggerId}`) : trigger;
  const openPicker = async (): Promise<void> => {
    if (await listbox.isVisible().catch(() => false)) return;
    await expect(stableTrigger).toBeVisible({ timeout: 15_000 });
    await expect(stableTrigger).toBeEnabled({ timeout: 15_000 });
    let lastError: unknown;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        await stableTrigger.click({ timeout: 2_000 });
        await expect(listbox).toBeVisible({ timeout: 2_000 });
        return;
      } catch (error) {
        lastError = error;
        // Retry the same semantic trigger when a live refresh remounts it.
      }
    }
    throw new Error("Searchable picker could not be opened.", {
      cause: lastError,
    });
  };
  const searchFirst = options?.searchFirst ?? true;
  const restoreOpenState = async (): Promise<void> => {
    let lastError: unknown;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      await openPicker();
      if (!searchFirst) return;
      try {
        await listbox
          .locator("..")
          .getByRole("textbox")
          .fill(optionText, { timeout: 2_000 });
        return;
      } catch (error) {
        lastError = error;
        // Realtime can remount the open picker while its search field is
        // filling. Reopen it and resolve the current textbox on the next pass.
      }
    }
    throw new Error("Searchable picker search could not be restored.", {
      cause: lastError,
    });
  };
  await restoreOpenState();
  const optionName = new RegExp(
    `(?:^|\\s|·)${escapeRegExp(optionText)}(?:$|\\s)`,
  );
  const optionButton = listbox
    .getByRole("option", { name: optionName })
    .first();
  let selected = false;
  let lastSelectionError: unknown;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      await restoreOpenState();
      await expect(optionButton).toBeVisible({ timeout: 5_000 });
      await optionButton.click({ timeout: 5_000 },
      );
      if (triggerId) {
        await expect(stableTrigger).toContainText(optionText, {
          timeout: 5_000,
        });
      } else {
        await expect(listbox).toBeHidden({ timeout: 2_000 });
      }
      selected = true;
      break;
    } catch (error) {
      lastSelectionError = error;
      // A remount also closes the popover. The next attempt restores it and
      // any search text before resolving the same exact option again.
    }
  }
  if (!selected) {
    throw new Error(`Searchable option could not be selected: ${optionText}`, {
      cause: lastSelectionError,
    });
  }
  // Single select closes its popover on selection.
  await expect(listbox).toBeHidden();
}

export async function toggleInSearchableMulti(
  page: Page,
  trigger: Locator,
  optionTexts: string[],
): Promise<void> {
  await trigger.click();
  const listbox = page.getByRole("listbox");
  await expect(listbox).toBeVisible();
  const search = listbox.locator("..").getByRole("textbox");
  for (const optionText of optionTexts) {
    await search.fill(optionText);
    await listbox
      .getByRole("option")
      .filter({ hasText: optionText })
      .first()
      .click();
  }
  // The multi popover stays open; close by toggling the trigger. Never press
  // Escape here — inside a dialog it closes the whole dialog (known gotcha).
  await trigger.click();
  await expect(listbox).toBeHidden();
}

export async function typeIntoTimeInput(
  dialog: Locator,
  id: string,
  digits: string,
  options?: { timeout?: number },
): Promise<void> {
  if (!/^\d{4}$/.test(digits)) {
    throw new Error("typeIntoTimeInput requires exactly four HHMM digits");
  }
  const group = dialog.locator(`#${id}`);
  const timeoutOptions = options?.timeout !== undefined ? { timeout: options.timeout } : {};
  await group.focus(timeoutOptions);
  await group.press("ArrowLeft", timeoutOptions);
  await group.press("Delete", timeoutOptions);
  await group.pressSequentially(digits.slice(0, 2), { delay: 50, ...timeoutOptions });
  await group.press("ArrowRight", timeoutOptions);
  await group.press("Delete", timeoutOptions);
  await group.pressSequentially(digits.slice(2), { delay: 50, ...timeoutOptions });
}

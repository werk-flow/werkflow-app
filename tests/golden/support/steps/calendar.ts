import { expect, type Locator, type Page } from "@playwright/test";
import { typeIntoDatePickerById, typeIntoTimeInput } from './shared';

// P1-11: recurring and multi-visit planning. These helpers keep the golden
// spec at the business-action level while the controls remain keyboard-usable.
export type PlanningEntryStepOptions = {
  kind: "job_visit" | "internal";
  jobSearch?: string;
  internalTitle?: string;
  internalType?: "meeting" | "internal_work" | "training" | "other";
  date: string;
  time?: string;
  durationHours?: number;
  durationDays?: number;
  employeeNames?: string[];
  teamNames?: string[];
  recurrence?: {
    frequency?: "daily" | "weekly" | "monthly";
    count: number;
    // German weekday labels (Mo/Di/…) that must be pressed for weekly series;
    // the form preselects the start date's weekday automatically.
    weekdayLabels?: string[];
  };
  overrideReason?: string;
  /**
   * Submission boundary for measured freshness: runs immediately before the
   * click that persists the entry. With an override reason it runs before
   * the override click; a save that closes without the expected warning
   * then fails the measurement instead of starting its clock late.
   */
  beforeSubmit?: () => void | Promise<void>;
};

async function selectPlanningOption(
  dialog: Locator,
  triggerText: string,
  searchPlaceholder: RegExp,
  optionText: string,
): Promise<void> {
  const comboboxes = dialog.getByRole("combobox");
  const alreadySelected = comboboxes.filter({ hasText: optionText }).first();
  if (await alreadySelected.isVisible().catch(() => false)) return;

  await comboboxes.filter({ hasText: triggerText }).click();
  // The searchable popover portals to <body> (not into the dialog — see the
  // portaling invariant in components/ui/searchable-select.tsx), so its
  // search input and listbox must be located PAGE-scoped, never dialog-scoped.
  const page = dialog.page();
  await page.getByPlaceholder(searchPlaceholder).fill(optionText);
  await page
    .getByRole("listbox")
    .getByRole("option")
    .filter({ hasText: optionText })
    .first()
    .click();
  await dialog.getByRole("heading").first().click();
}

async function finishPlanningSave(
  dialog: Locator,
  firstButtonName: RegExp,
  overrideReason?: string,
  beforeSubmit?: () => void | Promise<void>,
): Promise<void> {
  if (!overrideReason) await beforeSubmit?.();
  await dialog.getByRole("button", { name: firstButtonName }).click();
  await expect
    .poll(
      async () => {
        if (!(await dialog.isVisible().catch(() => false))) return "closed";
        if (
          await dialog
            .locator("[data-planning-warning]")
            .isVisible()
            .catch(() => false)
        ) {
          return "warning";
        }
        return "pending";
      },
      { timeout: 30_000 },
    )
    .not.toBe("pending");

  if (!(await dialog.isVisible().catch(() => false))) {
    if (overrideReason && beforeSubmit) {
      throw new Error(
        "Planning saved without the expected warning; the measured submission boundary was never marked.",
      );
    }
    return;
  }
  if (!overrideReason) {
    throw new Error(
      "Planning produced warnings but no override reason was supplied",
    );
  }
  const reasonInput = dialog
    .locator("#planning-override, #planning-edit-reason")
    .first();
  await reasonInput.fill(overrideReason);
  await beforeSubmit?.();
  await dialog
    .getByRole("button", {
      name: /Mit Begr.ndung planen|.nderung speichern/,
    })
    .click();
  await expect(dialog).toHaveCount(0, { timeout: 30_000 });
}

export async function createPlannedCalendarEntry(
  page: Page,
  options: PlanningEntryStepOptions,
): Promise<void> {
  await page.goto("/kalender");
  await page.getByRole("button", { name: "Kalendereintrag" }).click();
  const dialog = page.getByRole("dialog").filter({
    has: page.getByRole("heading", { name: "Kalendereintrag erstellen" }),
  });
  await expect(dialog.getByRole("tab", { name: "Termin planen" })).toBeVisible({
    timeout: 15_000,
  });
  await dialog.getByRole("tab", { name: "Termin planen" }).click();
  await expect(dialog.locator("#planning-date")).toBeVisible({
    timeout: 15_000,
  });

  if (options.kind === "job_visit") {
    if (!options.jobSearch) throw new Error("A job search value is required");
    await selectPlanningOption(
      dialog,
      "Auftrag auswählen",
      /Auftrag suchen/,
      options.jobSearch,
    );
  } else {
    await dialog.getByRole("button", { name: "Interner Termin" }).click();
    if (options.internalType && options.internalType !== "meeting") {
      await dialog.locator("#planning-internal-type").click();
      const internalTypeLabels = {
        internal_work: /Interne Arbeit/,
        training: /Schulung/,
        other: /Sonstiges/,
      } as const;
      await page
        .getByRole("option", { name: internalTypeLabels[options.internalType] })
        .click();
    }
    await dialog
      .locator("#planning-title")
      .fill(options.internalTitle ?? "Interner Termin");
  }

  await typeIntoDatePickerById(dialog, "planning-date", options.date);
  if (options.durationDays !== undefined) {
    await dialog.locator("#planning-time-kind").click();
    await page.getByRole("option", { name: /Ganzt.gig/ }).click();
    await dialog.locator("#planning-days").fill(String(options.durationDays));
  } else {
    await typeIntoTimeInput(
      dialog,
      "planning-time",
      (options.time ?? "09:00").replace(":", ""),
    );
    // DurationHoursInput keeps the element id on its inner text input.
    await dialog
      .locator("#planning-duration")
      .fill(String(options.durationHours ?? 1));
  }

  for (const employeeName of options.employeeNames ?? []) {
    await selectPlanningOption(
      dialog,
      (options.employeeNames?.length ?? 0) > 1
        ? "Mitarbeiter"
        : "Mitarbeiter zuweisen",
      /Mitarbeiter suchen/,
      employeeName,
    );
  }
  for (const teamName of options.teamNames ?? []) {
    await dialog.getByRole("button", { name: teamName, exact: true }).click();
  }

  if (options.recurrence) {
    await dialog.getByText("Wiederholen", { exact: true }).click();
    if (options.recurrence.frequency) {
      const frequencyLabels = {
        daily: /T.glich/,
        weekly: /W.chentlich/,
        monthly: /Monatlich/,
      } as const;
      // The Rhythmus Field wires its id onto the select trigger.
      await dialog.locator("#planning-frequency").click();
      await page
        .getByRole("option", {
          name: frequencyLabels[options.recurrence.frequency],
        })
        .click();
    }
    // Scope weekday toggles to the Wochentage row so short labels (Mo/Di/…)
    // can never match another dialog button (e.g. a team named alike).
    const weekdayRow = dialog
      .getByText("Wochentage", { exact: true })
      .locator("..");
    for (const weekdayLabel of options.recurrence.weekdayLabels ?? []) {
      const weekdayButton = weekdayRow.getByRole("button", {
        name: weekdayLabel,
        exact: true,
      });
      if ((await weekdayButton.getAttribute("aria-pressed")) !== "true") {
        await weekdayButton.click();
      }
    }
    await dialog
      .locator("#planning-count")
      .fill(String(options.recurrence.count));
  }

  await finishPlanningSave(
    dialog,
    /Planung pr.fen und speichern/,
    options.overrideReason,
    options.beforeSubmit,
  );
}

export function plannedCalendarEvent(
  page: Page,
  title: string,
  index = 0,
): Locator {
  return page.locator("[data-calendar-card]").filter({ hasText: title }).nth(index);
}

/** A completed pointer gesture is evidence only after the calendar drag engine owns the drag. */
export async function dragPlanningMonthEvent(
  page: Page,
  input: { title: string; sourceDate: string; targetDate: string },
): Promise<void> {
  if (input.sourceDate === input.targetDate || ![input.sourceDate, input.targetDate].every((date) => /^\d{4}-\d{2}-\d{2}$/.test(date))) {
    throw new Error('A month drag requires two distinct explicit calendar dates.');
  }
  const main = page.getByRole('main');
  const sourceDay = main.locator(`[data-month-day="${input.sourceDate}"]`);
  // The cell background sits under its day column; the column is the hit area.
  const targetDay = main.locator(`[data-month-day="${input.targetDate}"]`);
  const event = sourceDay.locator('[data-calendar-card]').filter({ hasText: input.title });
  await expect(event).toHaveCount(1);
  await expect(event).toBeVisible();
  await expect(event).toHaveClass(/\bcursor-grab\b/);
  await targetDay.scrollIntoViewIfNeeded();
  await event.scrollIntoViewIfNeeded();

  async function visiblePoint(locator: Locator): Promise<{ x: number; y: number; left: number; right: number }> {
    return locator.evaluate((element) => {
      const bounds = element.getBoundingClientRect();
      let left = Math.max(0, bounds.left);
      let right = Math.min(innerWidth, bounds.right);
      let top = Math.max(0, bounds.top);
      let bottom = Math.min(innerHeight, bounds.bottom);
      for (let ancestor = element.parentElement; ancestor; ancestor = ancestor.parentElement) {
        const style = getComputedStyle(ancestor);
        const clip = ancestor.getBoundingClientRect();
        if (/(auto|scroll|hidden|clip)/.test(style.overflowX)) { left = Math.max(left, clip.left); right = Math.min(right, clip.right); }
        if (/(auto|scroll|hidden|clip)/.test(style.overflowY)) { top = Math.max(top, clip.top); bottom = Math.min(bottom, clip.bottom); }
      }
      if (right - left < 8 || bottom - top < 8) throw new Error('The month drag source and target must both expose safe visible hit areas.');
      const x = (left + right) / 2;
      const y = (top + bottom) / 2;
      const hit = document.elementFromPoint(x, y);
      if (!hit || !element.contains(hit)) throw new Error('The month drag hit point is covered by another surface.');
      return { x, y, left, right };
    });
  }

  const start = await visiblePoint(event);
  const thresholdX = start.x + 12 < start.right - 2 ? start.x + 12 : start.x - 12;
  if (thresholdX <= start.left + 2) throw new Error('The source event is too narrow to engage a drag safely.');
  await visiblePoint(targetDay);
  const canCancelOutside = await main.locator('[data-month-view]').evaluateAll((calendars) => calendars.every((calendar) => {
    const bounds = calendar.getBoundingClientRect();
    return 1 < bounds.left || 1 > bounds.right || 1 < bounds.top || 1 > bounds.bottom;
  }));
  if (!canCancelOutside) throw new Error('No safe outside-calendar release point is available.');
  const body = page.locator('body');
  await expect(body).not.toHaveClass(/\bis-dragging\b/);
  await page.mouse.move(start.x, start.y);
  let held = false;
  try {
    await page.mouse.down();
    held = true;
    await page.mouse.move(thresholdX, start.y, { steps: 3 });
    await expect(body, 'The drag engine must engage the drag before moving to another date').toHaveClass(/\bis-dragging\b/, { timeout: 5_000 });
    const target = await visiblePoint(targetDay);
    await page.mouse.move(target.x, target.y, { steps: 10 });
    await expect(body, 'The drag engine must retain the drag until the destination release').toHaveClass(/\bis-dragging\b/, { timeout: 5_000 });
    // Exactly one destination release. Business warning and persisted-date
    // assertions remain with the scenario; an unknown outcome is never retried.
    held = false;
    await page.mouse.up();
  } finally {
    if (held) {
      await page.mouse.move(1, 1);
      await page.mouse.up();
    }
  }
}

export async function showPlanningMonth(
  page: Page,
  targetDate?: string,
): Promise<void> {
  await page.goto("/kalender");
  await page.getByRole("tab", { name: "Monat", exact: true }).click();
  if (!targetDate) return;
  const dayCells = page.locator("[data-month-cell]");
  const primaryMonthDayCells = page.locator(
    '[data-month-cell][data-in-month="true"]',
  );
  await expect(dayCells.first()).toBeVisible({ timeout: 15_000 });
  for (let attempt = 1; attempt <= 24; attempt += 1) {
    const primaryMonthDates = await primaryMonthDayCells.evaluateAll((cells) =>
      cells
        .map((cell) => cell.getAttribute("data-month-cell"))
        .filter((date): date is string => Boolean(date)),
    );
    if (primaryMonthDates.includes(targetDate)) return;
    const [firstPrimaryMonthDate] = primaryMonthDates;
    if (!firstPrimaryMonthDate) {
      throw new Error("The planning month grid has no primary-month cells.");
    }
    const previousGrid = primaryMonthDates.join(",");
    const direction = targetDate < firstPrimaryMonthDate ? /Zur.ck/ : "Weiter";
    await page.getByRole("button", { name: direction }).click();
    await expect
      .poll(
        () =>
          primaryMonthDayCells.evaluateAll((cells) =>
            cells.map((cell) => cell.getAttribute("data-month-cell")).join(","),
          ),
        { timeout: 10_000 },
      )
      .not.toBe(previousGrid);
  }
  throw new Error(`Planning month could not reach ${targetDate}.`);
}

export async function editPlannedCalendarOccurrence(
  page: Page,
  options: {
    title: string;
    eventIndex?: number;
    scope: "one" | "future" | "series";
    date?: string;
    time?: string;
    durationHours?: number;
    overrideReason?: string;
    calendarDate?: string;
  },
): Promise<void> {
  await showPlanningMonth(page, options.calendarDate);
  const event = plannedCalendarEvent(
    page,
    options.title,
    options.eventIndex ?? 0,
  );
  await expect(event).toBeVisible({ timeout: 20_000 });
  await event.click();
  await page.getByRole("button", { name: "Termin bearbeiten" }).click();
  const dialog = page.getByRole("dialog").filter({
    has: page.getByRole("heading", { name: "Geplanten Termin bearbeiten" }),
  });
  if (options.scope !== "one") {
    await dialog.locator("#planning-edit-scope").click();
    const scopeLabels = {
      future: /Dieser und zuk.nftige/,
      series: /Ganze Serie/,
    } as const;
    await page
      .getByRole("option")
      .filter({ hasText: scopeLabels[options.scope] })
      .first()
      .click();
  }
  if (options.date) {
    await typeIntoDatePickerById(dialog, "planning-edit-date", options.date);
  }
  if (options.time) {
    await typeIntoTimeInput(
      dialog,
      "planning-edit-time",
      options.time.replace(":", ""),
    );
  }
  if (options.durationHours !== undefined) {
    await dialog
      .locator("#planning-edit-duration")
      .fill(String(options.durationHours));
  }
  await finishPlanningSave(
    dialog,
    /.nderung speichern/,
    options.overrideReason,
  );
}

export async function setPlannedCalendarOccurrenceStatus(
  page: Page,
  options: {
    title: string;
    eventIndex?: number;
    calendarDate: string;
    status: "skip" | "cancel";
    reason: string;
  },
): Promise<void> {
  await showPlanningMonth(page, options.calendarDate);
  const event = plannedCalendarEvent(
    page,
    options.title,
    options.eventIndex ?? 0,
  );
  await expect(event).toBeVisible({ timeout: 20_000 });
  await event.click();
  await page.getByRole("button", { name: "Termin bearbeiten" }).click();
  const dialog = page.getByRole("dialog").filter({
    has: page.getByRole("heading", { name: "Geplanten Termin bearbeiten" }),
  });
  await dialog
    .getByRole("button", {
      // The cancel action renders as "Termin absagen" in the dialog footer.
      name: options.status === "skip" ? "Auslassen" : "Termin absagen",
      exact: true,
    })
    .click();
  await dialog.locator("#planning-status-reason").fill(options.reason);
  await dialog.getByRole("button", { name: "Status speichern" }).click();
  await expect(dialog).toHaveCount(0, { timeout: 20_000 });
}

import { expectReadyWithin, TIME_CORRECTION_READY_MS } from "../../golden/support/live";
import { expect, type Page } from "@playwright/test";
import {
  retryDialogTransaction,
  selectFromSearchable,
  typeIntoDateTimeField,
} from "../../golden/support/steps";

export async function submitMissedTime(
  page: Page,
  input: { date: string; reason: string; personName?: string; beforeSubmit?: () => Promise<void> },
): Promise<void> {
  await page.goto("/zeiterfassung?tab=history");
  const dialog = page.getByRole("dialog").filter({
    has: page.getByRole("heading", { name: "Zeitkorrektur" }),
  });
  await retryDialogTransaction({
    dialog,
    open: async () => {
      await expectReadyWithin(dialog.getByRole("combobox", { name: "Art der Zeitkorrektur", exact: true }), {
        label: "P1-22 audit time correction form options",
        targetMs: TIME_CORRECTION_READY_MS,
        trigger: () => page.getByRole("button", { name: "Zeit nachtragen" }).click({ timeout: 10_000 }),
      });
    },
    prepare: async () => {
      const bounded = { timeout: 5_000 };
      if (input.personName) {
        await selectFromSearchable(
          page,
          dialog.getByRole("combobox", { name: "Person für Zeitkorrektur" }),
          input.personName,
        );
      }
      await typeIntoDateTimeField(
        dialog,
        "time-correction-start",
        `${input.date}T07:00`,
        bounded,
      );
      await typeIntoDateTimeField(
        dialog,
        "time-correction-end",
        `${input.date}T09:30`,
        bounded,
      );
      await dialog.getByLabel("Grund").fill(input.reason, bounded);
      const formId = await dialog.locator("form").getAttribute("id");
      expect(formId).toBeTruthy();
      await expect(
        dialog.getByRole("button", { name: "Speichern", exact: true }),
      ).toHaveAttribute("form", formId!);
    },
    submit: async () => {
      await input.beforeSubmit?.();
      await dialog
        .getByRole("button", { name: "Speichern" })
        .press("Enter", { timeout: 5_000 });
    },
  });
}

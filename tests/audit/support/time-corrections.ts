import { expect, type Page } from '@playwright/test';
import { expectDefined } from '../../../lib/testing/spec-support/expect-defined';
import { pressKey } from '../../golden/support/steps/interaction';
import { retryDialogTransaction } from '../../golden/support/steps/shared';
import { expectReadyWithin, TIME_CORRECTION_READY_MS } from '../../golden/support/live';
import {
  addMissedTimeButton,
  fillMissedTime,
  timeCorrectionDialog,
  timeCorrectionKindField,
  timeCorrectionSaveButton,
} from '../../golden/support/steps/time-tracking';

export async function submitMissedTime(
  page: Page,
  input: { date: string; reason: string; personName?: string; beforeSubmit?: () => Promise<void> },
): Promise<void> {
  await page.goto('/zeiterfassung?tab=history');
  const dialog = timeCorrectionDialog(page);
  const save = timeCorrectionSaveButton(dialog);
  await retryDialogTransaction({
    dialog,
    // The opening readiness is measured here: the runner's timing registry
    // names this module as the readiness source of its importers.
    open: async () => {
      await expectReadyWithin(timeCorrectionKindField(dialog), {
        label: 'P1-22 audit time correction form options',
        targetMs: TIME_CORRECTION_READY_MS,
        trigger: () => addMissedTimeButton(page).click({ timeout: 10_000 }),
      });
    },
    prepare: async () => {
      await fillMissedTime(page, dialog, {
        date: input.date,
        from: '07:00',
        to: '09:30',
        reason: input.reason,
        ...(input.personName ? { personName: input.personName } : {}),
      });
      const formId = expectDefined(
        await dialog.locator('form').getAttribute('id'),
        'the id of the time correction form',
      );
      await expect(save).toHaveAttribute('form', formId);
    },
    submit: async () => {
      await input.beforeSubmit?.();
      // Enter on the save button submits the form it names by its form attribute.
      await pressKey(dialog, 'Enter', { into: save });
    },
  });
}

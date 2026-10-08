import type { Locator, Page } from '@playwright/test';

import { expect } from '../../golden/support/fixtures';
import { dispatchTaskGroup, dispatchTaskLink, openAufgaben } from '../../golden/support/steps/attention';
import {
  dispatchPanel,
  dispatchSendButton,
  jobDispatchSection,
  openIssueDialogForPanelRow,
} from '../../golden/support/steps/dispatch';
import { confirmed, SHARED_COPY } from '../../golden/support/steps/shared';
import { jobDetailMenuItem, jobEditDialog } from '../../golden/support/steps/work';

// A travel warning can appear on both affected occurrence rows. This assertion
// needs one visible copy, not a positional business identity.
export function firstDispatchPanelText(page: Page, text: string | RegExp): Locator {
  return dispatchPanel(page).getByText(text).first();
}

export function unscheduledDispatchRow(page: Page, title: string): Locator {
  return confirmed(page.locator('[data-dispatch-job]').filter({ hasText: title }));
}

/** Sends the panel row's dispatch with a note. */
export async function sendDispatchWithNote(page: Page, title: string, note: string): Promise<void> {
  const dialog = await openIssueDialogForPanelRow(page, title);
  await dialog.locator('#dispatch-note').fill(note);
  await dispatchSendButton(dialog).click();
  await expect(dialog).toHaveCount(0, { timeout: 20_000 });
}

// The /aufgaben deep link is the catalog's second confirmation path — no
// direct goto to the job page here, the task link IS the navigation.
export async function openJobViaDispatchTask(page: Page, title: string): Promise<void> {
  await openAufgaben(page);
  const taskGroup = dispatchTaskGroup(page);
  await expect(taskGroup).toBeVisible({ timeout: 20_000 });
  await dispatchTaskLink(taskGroup, title).click();
  await page.waitForURL(/\/auftraege\//, { timeout: 20_000 });
  await expect(jobDispatchSection(page)).toBeVisible({ timeout: 20_000 });
}

/** Changes the job's location through the job page's actions menu and saves. */
export async function editJobLocation(page: Page, jobNumber: string, location: string): Promise<void> {
  await page.goto(`/auftraege/${jobNumber}`);
  await page.getByRole('button', { name: SHARED_COPY.action.openActions }).click();
  await jobDetailMenuItem(page, 'edit').click();
  const dialog = jobEditDialog(page);
  await expect(dialog).toBeVisible({ timeout: 15_000 });
  await dialog.locator('#edit-job-location').fill(location);
  await dialog.getByRole('button', { name: SHARED_COPY.action.save }).click();
  await expect(dialog).toHaveCount(0, { timeout: 20_000 });
}

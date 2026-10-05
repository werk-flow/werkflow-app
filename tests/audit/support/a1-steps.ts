import { expect, type Locator, type Page } from '@playwright/test';

import { WORK_EXECUTION_LABELS } from '../../../lib/work-lifecycle/types';
import { materialRowLocation, materialRowQuantity } from '../../golden/support/steps/inventory';
import { detailsRegion, retryDialogTransaction } from '../../golden/support/steps/shared';
import { lifecycleAction, transitionWork, workLifecycleCard } from '../../golden/support/steps/work';

/** The search field of the material dialog's location picker, named by its placeholder. */
const MATERIAL_LOCATION_SEARCH = 'Lager suchen …';

/** A presigned storage URL, as the document viewer's links and downloads use it. */
export const SIGNED_URL_PATTERN = /^https?:\/\/.+X-Amz-(Algorithm|Signature)=/;

export async function bookMaterialDialog(
  page: Page,
  openButton: Locator,
  heading: string,
  quantity: string,
  submitLabel: string = heading,
): Promise<void> {
  const dialog = page.getByRole('dialog').filter({
    has: page.getByRole('heading', { name: heading }),
  });
  await retryDialogTransaction({
    open: () => openButton.click({ timeout: 15_000 }),
    dialog,
    prepare: async () => {
      // These suffix selectors distinguish the generated material controls;
      // every action stays bounded because Realtime can unmount the dialog.
      await materialRowQuantity(dialog).fill(quantity, { timeout: 15_000 });
      await materialRowLocation(dialog).click({ timeout: 15_000 });
      const listbox = page.getByRole('listbox');
      await expect(listbox).toBeVisible({ timeout: 15_000 });
      await page.getByRole('textbox', { name: MATERIAL_LOCATION_SEARCH }).fill('Hauptlager (Golden)', {
        timeout: 15_000,
      });
      await listbox
        .getByRole('option')
        .filter({ hasText: 'Hauptlager (Golden)' })
        .first()
        .click({ timeout: 15_000 });
    },
    submit: () => dialog.getByRole('button', { name: submitLabel }).click({ timeout: 15_000 }),
  });
}

/** The work states a1 specs move a fresh job into. */
type SettableJobState = 'in_progress' | 'execution_complete';

/**
 * Moves a not-started job to the work state through the lifecycle card and
 * checks that its Details card shows that state.
 */
export async function setJobStatus(page: Page, state: SettableJobState): Promise<void> {
  if (state === 'in_progress') {
    await transitionWork(page, 'not_started', 'in_progress');
  } else {
    await expect(workLifecycleCard(page)).toBeVisible({ timeout: 20_000 });
    const canStart = await lifecycleAction(page, 'not_started', 'in_progress')
      .waitFor({ state: 'visible', timeout: 2_000 })
      .then(() => true)
      .catch(() => false);
    if (canStart) await transitionWork(page, 'not_started', 'in_progress');
    await transitionWork(page, 'in_progress', 'execution_complete');
  }
  await expect(detailsRegion(page.getByRole('main'))).toContainText(WORK_EXECUTION_LABELS[state]);
}

export async function expectSignedWindowOpen(page: Page, clickDownload: () => Promise<void>): Promise<void> {
  await page.evaluate(() => {
    document.documentElement.dataset.signedWindowOpenUrl = '';
    const originalOpen = window.open.bind(window);
    window.open = (...args: Parameters<typeof window.open>) => {
      document.documentElement.dataset.signedWindowOpenUrl = String(args[0] ?? '');
      return originalOpen(...args);
    };
  });
  const popupPromise = page.waitForEvent('popup');
  await clickDownload();
  const popup = await popupPromise;
  await expect
    .poll(() => page.evaluate(() => document.documentElement.dataset.signedWindowOpenUrl ?? ''))
    .toMatch(SIGNED_URL_PATTERN);
  await popup.close().catch(() => undefined);
}

export async function readOrganizationCode(page: Page): Promise<string> {
  // The generated code is rendered as bare code text without a semantic label.
  return (
    (
      await page
        .locator('code')
        .filter({ hasText: /[A-Z0-9]{6}/ })
        .textContent()
    )?.trim() ?? ''
  );
}

export function upgradeChoiceLink(page: Page): Locator {
  // The full-card onboarding link has no accessible name in the current markup.
  return page.locator('a[href="/upgrade"]');
}

export function visibleCalendarTimeBlock(page: Page, title: RegExp): Locator {
  // Responsive calendar layers can duplicate blocks; only one is interactive.
  return page.getByTitle(title).filter({ visible: true }).first();
}

/** Drags a day-view calendar block vertically onto the named member's row. */
export async function moveCalendarBlockToMember(
  page: Page,
  block: Locator,
  memberName: string,
): Promise<void> {
  const member = page.getByRole('main').getByText(memberName, { exact: true }).filter({ visible: true });
  await expect(member).toBeVisible();
  const sourceBox = await block.boundingBox();
  const targetBox = await member.boundingBox();
  if (!sourceBox || !targetBox) throw new Error('Calendar drag source or named member has no bounding box');
  const horizontalPosition = sourceBox.x + sourceBox.width / 2;
  await page.mouse.move(horizontalPosition, sourceBox.y + sourceBox.height / 2);
  await page.mouse.down();
  try {
    await page.mouse.move(horizontalPosition, targetBox.y + targetBox.height / 2, { steps: 12 });
  } finally {
    await page.mouse.up();
  }
}

export function clockOutTimeGroup(dialog: Locator): Locator {
  return dialog.getByRole('group', { name: 'Arbeitsende', exact: true });
}

import { expect, type Locator, type Page } from '@playwright/test';

export function dayJobBlock(page: Page): Locator {
  return page.getByRole('region', { name: 'Tageskalender', exact: true }).locator('div[title="Prüfauftrag ziehen"]');
}

// JobBlock exposes pointer-only resize handles, without individual semantic labels.
// The final direct child is its right resize handle; this geometry boundary owns
// that explicit positional dependency while the test runs the real pointer hook.
export async function resizeJob(page: Page): Promise<void> {
  const block = dayJobBlock(page);
  const handle = block.locator(':scope > div').last();
  await handle.scrollIntoViewIfNeeded();
  const bounds = await handle.boundingBox();
  if (!bounds) throw new Error('Real job resize handle has no layout.');
  const startX = bounds.x + bounds.width / 2;
  const startY = bounds.y + bounds.height / 2;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX + 50, startY, { steps: 4 });
  await page.mouse.up();
  await expect.poll(() => page.evaluate(() => window.dayViewContract.calls.length)).toBe(1);
  expect(await page.evaluate(() => window.dayViewContract.calls[0]?.input.estimatedDurationMinutes)).toBeGreaterThan(60);
}

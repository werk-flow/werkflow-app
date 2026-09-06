import { expect, type Locator, type Page, type TestInfo } from '@playwright/test';

/** Capture the real responsive section and restore the scenario's viewport even on failure. */
export async function captureResponsiveSection(
  page: Page,
  testInfo: TestInfo,
  section: Locator,
  name: string,
  verify?: (width: number) => Promise<void | Locator>,
): Promise<void> {
  const previousViewport = page.viewportSize();
  try {
    for (const viewport of [
      { name: 'desktop', width: 1280, height: 900 },
      { name: 'phone', width: 375, height: 812 },
    ]) {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await expect(section).toBeVisible();
      // Long lists can return an exact representative row. A screenshot of
      // their full-height panel cannot reveal content clipped by PageBody.
      const target = (await verify?.(viewport.width)) ?? section;
      if (target !== section) {
        // Keep short evidence rows away from the fixed clock launcher at the
        // viewport edge. This scrolls the real page without hiding any UI.
        await target.evaluate((element) => element.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' }));
        await expect(target).toBeInViewport({ ratio: 1 });
      }
      const evidenceName = `${name}-${viewport.name}`;
      const path = testInfo.outputPath(`${evidenceName}.png`);
      await target.screenshot({ path });
      await testInfo.attach(evidenceName, { path, contentType: 'image/png' });
    }
  } finally {
    if (previousViewport) await page.setViewportSize(previousViewport);
  }
}

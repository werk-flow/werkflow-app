import { expect, type Browser } from '@playwright/test';
import type { StandaloneScreen } from '../../../lib/testing/selection/standalone-route-inventory';
import type { TestWorld } from '../../golden/support/world';
import { expectNoAxeViolations } from './axe';
import { expectNoSidewaysOverflow, nextFrames } from './layout-measure';
import { VIEWPORT_HEIGHT } from './open-layer';
import { openStandaloneScreen } from './standalone-sessions';

// The rendered audit of the screens outside the app shell (werkflow-design,
// "Checklist"): each screen of lib/testing/selection/standalone-route-inventory.ts
// opens with its own session and passes the sideways measures and axe (WCAG
// 2.1 A/AA with the landmark and heading rules) at 375 and 1280 px in both
// themes. These screens scroll the document themselves, so the app shell's
// vertical-scroll measure does not apply.

const WIDTHS = [1280, 375] as const;

/** Audits one standalone screen in a context of its own and closes it. */
export async function auditStandaloneScreen(input: {
  browser: Browser;
  baseURL: string | undefined;
  world: TestWorld;
  screen: StandaloneScreen;
}): Promise<void> {
  const { context, page } = await openStandaloneScreen(input);
  try {
    // A screen whose own read failed is a defect, not a layout to measure.
    await expect(page.locator('[data-slot="section-error"]:visible'), input.screen.route).toHaveCount(0);
    for (const width of WIDTHS) {
      await page.setViewportSize({ width, height: VIEWPORT_HEIGHT[width] ?? 800 });
      const label = `${input.screen.session} ${input.screen.route} at ${width} px`;
      await expectNoSidewaysOverflow(page, label);
      for (const scheme of ['light', 'dark'] as const) {
        await page.emulateMedia({ colorScheme: scheme });
        await nextFrames(page);
        await expectNoAxeViolations(page, `${label}, ${scheme}`);
      }
      await page.emulateMedia({ colorScheme: 'light' });
    }
  } finally {
    await context.close();
  }
}

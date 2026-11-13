import { expect, type Browser, type TestInfo } from '@playwright/test';
import { standaloneScreen } from '../../../lib/testing/selection/standalone-route-inventory';
import { settled } from '../../golden/support/steps/interaction';
import type { TestWorld } from '../../golden/support/world';
import { writeCapture } from './acceptance-captures';
import type { StandaloneCaptureSpec } from './acceptance-rounds';
import { SKELETON_SELECTOR, standaloneTarget } from './acceptance-state-plan';
import { withStandaloneLoading } from './acceptance-states';
import { VIEWPORT_HEIGHT } from './open-layer-plan';
import { openStandaloneScreen } from './standalone-sessions';

/**
 * Captures a screen outside the app shell at each width and scheme. The screen
 * opens with the session its inventory entry names, and the session helper
 * refuses a redirect, so the image shows the requested screen. Its own module:
 * only the groups that capture such a screen import the standalone sessions.
 */
export async function captureStandalone(
  input: { browser: Browser; baseURL: string | undefined; world: TestWorld; testInfo: TestInfo },
  set: string,
  capture: StandaloneCaptureSpec,
): Promise<void> {
  const screen = standaloneScreen(capture.screen);
  const { context, page, path } = await openStandaloneScreen({ ...input, screen });
  try {
    const identity = { id: capture.id, role: screen.session, view: 'standalone' } as const;
    // A capture may open the screen at another address of the same route, such as other filters.
    const target = standaloneTarget(path, capture.query);
    const { address } = target;
    const captureSchemes = async (width: number, ready: () => Promise<void>): Promise<void> => {
      for (const scheme of capture.schemes) {
        await page.emulateMedia({ colorScheme: scheme });
        await ready();
        await expect(page.locator('[data-slot="section-error"]:visible')).toHaveCount(0);
        await page.evaluate(async () => {
          await document.fonts.ready;
        });
        await writeCapture(page, input.testInfo, set, identity, address, width, scheme);
      }
    };
    for (const width of capture.widths) {
      await page.setViewportSize({ width, height: VIEWPORT_HEIGHT[width] ?? 800 });
      if (capture.loadingFrom !== undefined) {
        await withStandaloneLoading(page, { from: capture.loadingFrom, to: target }, () =>
          captureSchemes(width, () => expect(page.locator(SKELETON_SELECTOR).first()).toBeVisible()),
        );
        continue;
      }
      if (address !== path) await page.goto(address);
      await captureSchemes(width, () => settled(page));
    }
  } finally {
    await context.close();
  }
}

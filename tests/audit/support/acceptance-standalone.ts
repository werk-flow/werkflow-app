import { expect, type Browser, type TestInfo } from '@playwright/test';
import { standaloneScreen } from '../../../lib/testing/selection/standalone-route-inventory';
import { settled } from '../../golden/support/steps/interaction';
import type { TestWorld } from '../../golden/support/world';
import { writeCapture } from './acceptance-captures';
import type { StandaloneCaptureSpec } from './acceptance-rounds';
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
  const { context, page } = await openStandaloneScreen({ ...input, screen });
  try {
    const identity = { id: capture.id, role: screen.session, view: 'standalone' } as const;
    for (const width of capture.widths) {
      await page.setViewportSize({ width, height: VIEWPORT_HEIGHT[width] ?? 800 });
      for (const scheme of capture.schemes) {
        await page.emulateMedia({ colorScheme: scheme });
        await settled(page);
        await expect(page.locator('[data-slot="section-error"]:visible')).toHaveCount(0);
        await page.evaluate(async () => {
          await document.fonts.ready;
        });
        await writeCapture(page, input.testInfo, set, identity, screen.path, width, scheme);
      }
    }
  } finally {
    await context.close();
  }
}

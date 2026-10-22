import { expect, type Locator } from '@playwright/test';
import { pressKey, settled, settledBeforeTimeout } from '../../golden/support/steps/interaction';
import type { DialogOpener } from './dialog-opener';
import type { SurfaceContext } from './surface-fixtures';
import { openSurface } from './surface-routes';

export const DESKTOP = { width: 1280, height: 800 } as const;

/** The audited heights of the canon's widths. */
export const VIEWPORT_HEIGHT: Readonly<Record<number, number>> = {
  375: 812,
  768: 1024,
  1024: 768,
  1280: 800,
  1680: 1050,
};

/**
 * Opens a dialog of the inventory the way a user at this width opens it: the
 * page loads at the width, the opener brings its trigger on screen, and Enter
 * opens the layer. A trigger that exists on the desktop only (a table row's
 * menu) opens there and the viewport then narrows, as a window does.
 */
export async function openLayerAt(
  context: SurfaceContext,
  opener: DialogOpener,
  width: number,
  options: { fresh: boolean },
): Promise<{ trigger: Locator; layer: Locator }> {
  const { page } = context;
  const viewport = opener.viewport ?? { width, height: VIEWPORT_HEIGHT[width] ?? 800 };
  const desktopFirst = opener.opensOn === 'desktop' && viewport.width < DESKTOP.width;
  await page.setViewportSize(desktopFirst ? DESKTOP : viewport);
  if (options.fresh) await openSurface(page, { route: context.route });
  let trigger = await opener.trigger(context);
  const onScreen =
    !desktopFirst && (await settledBeforeTimeout(trigger.waitFor({ state: 'visible', timeout: 3_000 })));
  if (!onScreen && !desktopFirst) {
    await page.setViewportSize(DESKTOP);
    await openSurface(page, { route: context.route });
    trigger = await opener.trigger(context);
  }
  await expect(trigger, 'the trigger is on screen').toBeVisible();
  await trigger.focus();
  await pressKey(page, 'Enter');
  const layer = opener.layer(page);
  await expect(layer, 'Enter on the trigger opens the dialog').toBeVisible();
  await settled(layer);
  if (!onScreen) await page.setViewportSize(viewport);
  return { trigger, layer };
}

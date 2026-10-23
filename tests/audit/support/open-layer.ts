import { expect, type Locator } from '@playwright/test';
import { pressKey, settled } from '../../golden/support/steps/interaction';
import type { DialogOpener } from './dialog-opener';
import { offScreenTriggerMessage, openingPlan } from './open-layer-plan';
import type { SurfaceContext } from './surface-fixtures';
import { openSurface } from './surface-routes';

/**
 * Opens a dialog of the inventory the way a user at this width opens it: the
 * page loads at the width, the opener brings its trigger on screen, and Enter
 * opens the layer. A trigger declared desktop-only (the board's toolbar, a
 * drag on the day timeline; a phone user does not need the dialog) opens on
 * the desktop and the viewport then narrows,
 * as a window does. Any other trigger off screen at the width fails by name.
 * A state capture intercepts the dialog's reads in `beforeOpen`, before the
 * trigger takes focus (which may already start a read), and leaves a held
 * read's skeleton unsettled.
 */
export async function openLayerAt(
  context: SurfaceContext,
  opener: DialogOpener,
  width: number,
  options: { fresh: boolean; beforeOpen?: () => Promise<void>; settleLayer?: boolean },
): Promise<{ trigger: Locator; layer: Locator }> {
  const { page } = context;
  const plan = openingPlan(opener, width);
  await page.setViewportSize(plan.openAt);
  if (options.fresh) await openSurface(page, { route: context.route });
  const trigger = await opener.trigger(context);
  await expect(trigger, offScreenTriggerMessage(plan.openAt.width)).toBeVisible();
  await options.beforeOpen?.();
  await trigger.focus();
  await pressKey(page, 'Enter');
  const layer = opener.layer(page);
  await expect(layer, 'Enter on the trigger opens the dialog').toBeVisible();
  if (options.settleLayer ?? true) await settled(layer);
  if (plan.narrowTo) await page.setViewportSize(plan.narrowTo);
  return { trigger, layer };
}

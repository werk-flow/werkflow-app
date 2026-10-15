import type { Locator, Page } from '@playwright/test';
import type { SurfaceContext } from './surface-fixtures';

/**
 * How the rendered audit reaches one dialog of the inventory
 * (lib/testing/selection/dialog-inventory.ts). The opener only brings the
 * trigger on screen and names the layer; the audit focuses the trigger, opens
 * the layer with Enter, measures it and closes it with Escape without saving.
 * Copy and structure hooks come from the area modules under
 * tests/golden/support/steps/.
 */
export type DialogOpener = {
  /**
   * Brings the trigger on screen from the loaded page and returns it: a header
   * button, a row menu item after opening its menu, a button inside a parent
   * dialog after opening the parent. Seeds what the dialog needs first.
   */
  trigger: (context: SurfaceContext) => Promise<Locator>;
  /** The open layer by its role (`dialog` or `alertdialog`) and accessible name. */
  layer: (page: Page) => Locator;
  /** Where focus returns after Escape when it is not the trigger, such as a row menu's button. */
  returnFocus?: (context: SurfaceContext) => Locator;
  /** Parent layers to close after the audited one, innermost first. */
  parents?: (page: Page) => readonly Locator[];
  /** The viewport the trigger exists at, when it is not the desktop (a phone-only filter button). */
  viewport?: { width: number; height: number };
  /**
   * The trigger lives in a layout that only the desktop renders (a table row's
   * menu, the board, the day timeline). At a narrower width the dialog opens
   * on the desktop and the window then narrows; the phone's own path to the
   * dialog (a card menu, the day list) is not part of this audit.
   */
  opensOn?: 'desktop';
};

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
} & (
  | {
      /**
       * The trigger is on screen at every audited width; where the phone
       * renders another layout (a card's menu, the day list, the menu sheet),
       * the opener drives that path, as a phone user does.
       */
      opensOn?: undefined;
      phoneUse?: undefined;
    }
  | {
      /**
       * The trigger lives in a layout that only the desktop renders (the
       * board's toolbar, a drag on the day timeline). At a narrower width the
       * dialog opens on the desktop and the window then narrows.
       */
      opensOn: 'desktop';
      /**
       * Why a phone user does not need this dialog by design. A dialog that a
       * phone user needs gets an opener of its phone path instead; when the
       * product offers no such path, that is a product defect.
       */
      phoneUse: { kind: 'none'; reason: string };
    }
);

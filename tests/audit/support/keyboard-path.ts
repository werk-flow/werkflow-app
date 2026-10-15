import { expect, type Locator, type Page } from '@playwright/test';
import { pressKey } from '../../golden/support/steps/interaction';

// The keyboard path of an open dialog, sheet or confirmation (werkflow-design,
// "Checklist"): focus moves into the layer, starts on its first control, its
// cancel action (a confirmation) or the layer itself, and Tab never leaves it.
// Soft by default, so the surface audit names every defect of a page.

/** Where focus sits in the layer: on its first control, its cancel action, the layer itself, or elsewhere. */
async function focusPosition(
  layer: Locator,
): Promise<{ onFirst: boolean; onLayer: boolean; tabbables: number; focused: string }> {
  return layer.evaluate((root) => {
    const candidates = Array.from(
      root.querySelectorAll<HTMLElement>(
        'a[href], button, input, textarea, select, [tabindex], [contenteditable="true"]',
      ),
    ).filter((element) => {
      if (element.tabIndex < 0) return false;
      // A roving-focus container (a tab strip, a toolbar) is one tab stop
      // that hands focus to its active item, so the item is the control.
      if (element.matches('[role="tablist"], [role="toolbar"], [role="menubar"], [role="radiogroup"]'))
        return false;
      if ((element as HTMLButtonElement).disabled) return false;
      if (element.closest('[inert]')) return false;
      const box = element.getBoundingClientRect();
      return box.width > 0 && box.height > 0 && getComputedStyle(element).visibility !== 'hidden';
    });
    const active = document.activeElement;
    const describe = (element: Element | null): string =>
      element
        ? `${element.tagName.toLowerCase()} „${(element.getAttribute('aria-label') ?? element.textContent ?? '').trim().slice(0, 40)}“`
        : 'nothing';
    return {
      // A destructive confirmation starts on its least destructive action
      // (werkflow-design, "Destructive confirmations").
      onFirst:
        active === candidates[0] ||
        (root.getAttribute('role') === 'alertdialog' &&
          active?.getAttribute('data-slot') === 'alert-dialog-cancel'),
      onLayer: active === root,
      tabbables: candidates.length,
      focused: describe(active),
    };
  });
}

async function focusInside(layer: Locator): Promise<boolean> {
  return layer.evaluate((root) => root.contains(document.activeElement));
}

/**
 * The keyboard path inside an open layer: focus starts on its first control or
 * on the layer itself, and Tab never leaves it.
 */
export async function expectKeyboardPath(
  page: Page,
  layer: Locator,
  label: string,
  options: { soft?: boolean } = {},
): Promise<void> {
  const check = options.soft === false ? expect : expect.soft;
  // The primitive moves focus in an effect after the open frame.
  await expect
    .poll(() => focusInside(layer), {
      message: `${label}: focus moves into the opened dialog`,
      timeout: 3_000,
    })
    .toBe(true)
    .catch(() => undefined);
  const start = await focusPosition(layer);
  check(
    start.onFirst || start.onLayer,
    `${label}: focus starts on the first control or the dialog, not on ${start.focused}`,
  ).toBe(true);
  const presses = Math.min(start.tabbables + 1, 40);
  for (let press = 0; press < presses; press += 1) {
    await pressKey(layer, 'Tab', { into: page.locator(':focus') });
    if (!(await focusInside(layer))) {
      check(false, `${label}: Tab press ${press + 1} moved focus out of the dialog`).toBe(true);
      return;
    }
  }
}

import { expect, type Locator, type Page } from '@playwright/test';
import {
  BUSY_SIGNAL_SELECTOR,
  ROUTE_REFRESH_SIGNAL,
  SETTLED_CALENDAR_STATES,
} from '../../../../lib/testing/spec-support/busy-signals';

/**
 * The one home of settling and key presses in browser tests (testing.md,
 * "Write a spec that stands alone"). A spec acts only after the app's own busy
 * signals are clear (lib/testing/spec-support/busy-signals.ts): `aria-busy`,
 * `data-pending`, a skeleton, a spinner, a queued or running route refresh,
 * and the calendar's `data-calendar-state`. Two races
 * that failed runs proved are unwritable through these steps: Escape while a
 * dialog still saves, and a shortcut key typed into a focused combobox.
 *
 * Compare-then-act values (a badge against list counts) are read together in
 * one `expect.poll`, never one after another.
 */

type Scope = Page | Locator;

const TEXT_ENTRY_ROLES = new Set(['combobox', 'listbox', 'textbox', 'searchbox', 'spinbutton']);

function isPage(scope: Scope): scope is Page {
  return 'goto' in scope;
}

function pageOf(scope: Scope): Page {
  return isPage(scope) ? scope : scope.page();
}

/** Describes the busy elements inside a scope, the scope itself included; empty when settled. */
async function busyElements(scope: Scope): Promise<string[]> {
  const root = isPage(scope) ? scope.locator('body') : scope;
  return root.evaluateAll(
    (elements, { selector, routeRefresh, settledCalendarStates }) => {
      const describe = (element: Element): string => {
        const name =
          element.getAttribute('aria-label') ??
          element.getAttribute('data-testid') ??
          element.textContent?.trim().slice(0, 60) ??
          '';
        return `<${element.tagName.toLowerCase()} role="${element.getAttribute('role') ?? ''}"> ${name}`;
      };
      const busy: string[] = [];
      if (document.documentElement.hasAttribute(routeRefresh)) busy.push('route refresh queued or running');
      for (const element of elements) {
        const candidates = [element, ...element.querySelectorAll(selector)];
        for (const candidate of candidates) {
          if (!candidate.matches(selector)) continue;
          const box = candidate.getBoundingClientRect();
          // A hidden responsive copy is not what the user waits on.
          if (box.width === 0 && box.height === 0) continue;
          busy.push(describe(candidate));
        }
        for (const calendar of element.querySelectorAll('[data-calendar-state]')) {
          const state = calendar.getAttribute('data-calendar-state') ?? '';
          if (!settledCalendarStates.includes(state)) busy.push(`calendar in state ${state}`);
        }
      }
      return busy;
    },
    {
      selector: BUSY_SIGNAL_SELECTOR,
      routeRefresh: ROUTE_REFRESH_SIGNAL,
      settledCalendarStates: [...SETTLED_CALENDAR_STATES],
    },
  );
}

/** Waits until nothing inside the scope is busy; a failure names the busy elements. */
export async function settled(scope: Scope, options: { timeout?: number } = {}): Promise<void> {
  await expect
    .poll(() => busyElements(scope), {
      message:
        'The scope settles: no aria-busy, pending dialog, skeleton, spinner or route refresh, and every calendar ready',
      ...(options.timeout !== undefined ? { timeout: options.timeout } : {}),
    })
    .toEqual([]);
}

/**
 * Settles the scope, then presses the key. Without `into`, focus must not sit
 * in a text field, combobox or listbox, where a shortcut becomes typed text.
 * With `into`, the key goes to that field (Enter in a search box).
 */
export async function pressKey(
  scope: Scope,
  key: string,
  options: { into?: Locator; timeout?: number } = {},
): Promise<void> {
  const timeout = options.timeout !== undefined ? { timeout: options.timeout } : {};
  await settled(scope, timeout);
  if (options.into) {
    await options.into.press(key, timeout);
    return;
  }
  const page = pageOf(scope);
  const focusedRole = await page.evaluate(() => {
    const element = document.activeElement;
    if (!element || element === document.body) return null;
    const explicit = element.getAttribute('role');
    if (explicit) return explicit;
    if (element instanceof HTMLTextAreaElement) return 'textbox';
    if (element instanceof HTMLSelectElement) return 'combobox';
    if (element instanceof HTMLInputElement)
      return ['button', 'checkbox', 'radio', 'submit', 'reset', 'range', 'file', 'color'].includes(
        element.type,
      )
        ? 'control'
        : 'textbox';
    return (element as HTMLElement).isContentEditable ? 'textbox' : 'other';
  });
  if (focusedRole && TEXT_ENTRY_ROLES.has(focusedRole))
    throw new Error(
      `pressKey("${key}") refused: focus is in a ${focusedRole}, where the key would be typed or consumed. Move focus first or pass { into }.`,
    );
  await page.keyboard.press(key);
}

/** Closes a dialog or popover with Escape after its request settled; a layer that refuses fails here. */
export async function dismissDialog(layer: Locator): Promise<void> {
  await settled(layer);
  await expect(layer, 'A pending layer refuses dismissal').not.toHaveAttribute('data-pending', 'true');
  await layer.page().keyboard.press('Escape');
  await expect(layer).toBeHidden();
}

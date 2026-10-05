/** The part of a DOM element the guard reads. */
export interface ShortcutTarget {
  closest(selector: string): unknown;
}

/** The part of a `KeyboardEvent` the guard reads. */
export interface ShortcutKeyEvent {
  defaultPrevented: boolean;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  target: ShortcutTarget | null;
}

/**
 * Fields, open dialogs, confirmations, menus, pickers and the job popover own
 * their keys: `z` in the delete confirmation of an entry undid the last
 * calendar move, and `c` in the account menu opened the create dialog.
 */
const SHORTCUT_OWNING_SELECTOR = [
  'input',
  'textarea',
  'select',
  '[contenteditable="true"]',
  '[role="dialog"]',
  '[role="alertdialog"]',
  '[role="menu"]',
  '[role="listbox"]',
  '[role="combobox"]',
  '[data-job-popover]',
].join(', ');

/**
 * True when a key press is a calendar shortcut: nothing consumed it yet, it
 * does not belong to a field, dialog, menu or picker, and no modifier other
 * than Shift is held (browser and system shortcuts stay theirs).
 */
export function isCalendarShortcutKey(event: ShortcutKeyEvent): boolean {
  if (event.defaultPrevented) return false;
  if (event.metaKey || event.ctrlKey || event.altKey) return false;
  if (event.target && event.target.closest(SHORTCUT_OWNING_SELECTOR)) return false;
  return true;
}

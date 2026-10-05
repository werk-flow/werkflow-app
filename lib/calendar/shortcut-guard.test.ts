import { describe, expect, test } from 'bun:test';
import { isCalendarShortcutKey, type ShortcutKeyEvent, type ShortcutTarget } from './shortcut-guard';

// A minimal element with ancestors: `closest` matches the simple selectors the
// guard uses (a tag name, `[attr]` and `[attr="value"]`) against the element
// and each ancestor, like the DOM does.
interface FakeElement {
  tag: string;
  attributes?: Record<string, string>;
  parent?: FakeElement;
}

function matchesSimple(element: FakeElement, selector: string): boolean {
  const attribute = /^\[([\w-]+)(?:="([^"]*)")?\]$/.exec(selector);
  if (!attribute) return element.tag === selector;
  const [, name = '', value] = attribute;
  const actual = element.attributes?.[name];
  return actual !== undefined && (value === undefined || actual === value);
}

function target(element: FakeElement): ShortcutTarget {
  return {
    closest(selector: string) {
      const selectors = selector.split(',').map((part) => part.trim());
      for (let node: FakeElement | undefined = element; node; node = node.parent) {
        if (selectors.some((simple) => matchesSimple(node, simple))) return node;
      }
      return null;
    },
  };
}

function keyEvent(element: FakeElement | null, overrides: Partial<ShortcutKeyEvent> = {}): ShortcutKeyEvent {
  return {
    defaultPrevented: false,
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    target: element ? target(element) : null,
    ...overrides,
  };
}

const body: FakeElement = { tag: 'body' };
const insideBody = (tag: string, attributes?: Record<string, string>): FakeElement => ({
  tag: 'span',
  parent: { tag, ...(attributes ? { attributes } : {}), parent: body },
});

describe('calendar shortcut guard', () => {
  test('a plain key on the page is a shortcut', () => {
    expect(isCalendarShortcutKey(keyEvent(body))).toBe(true);
    expect(isCalendarShortcutKey(keyEvent({ tag: 'div', parent: body }))).toBe(true);
    expect(isCalendarShortcutKey(keyEvent(null))).toBe(true);
  });

  test('a key another handler already consumed is not a shortcut', () => {
    expect(isCalendarShortcutKey(keyEvent(body, { defaultPrevented: true }))).toBe(false);
  });

  test.each(['metaKey', 'ctrlKey', 'altKey'] as const)('a key with %s stays with the browser', (modifier) => {
    expect(isCalendarShortcutKey(keyEvent(body, { [modifier]: true }))).toBe(false);
    expect(isCalendarShortcutKey(keyEvent(null, { [modifier]: true }))).toBe(false);
  });

  test.each(['input', 'textarea', 'select'])('a key typed into %s belongs to the field', (tag) => {
    expect(isCalendarShortcutKey(keyEvent({ tag, parent: body }))).toBe(false);
  });

  test('a key in an editable region belongs to the region', () => {
    expect(isCalendarShortcutKey(keyEvent(insideBody('div', { contenteditable: 'true' })))).toBe(false);
  });

  test.each(['dialog', 'alertdialog', 'menu', 'listbox', 'combobox'])(
    'a key inside role="%s" belongs to it, also from a nested element',
    (role) => {
      expect(isCalendarShortcutKey(keyEvent(insideBody('div', { role })))).toBe(false);
    },
  );

  test('a key inside the job popover belongs to the popover', () => {
    expect(isCalendarShortcutKey(keyEvent(insideBody('div', { 'data-job-popover': '' })))).toBe(false);
  });

  test('an unrelated role does not swallow the key', () => {
    expect(isCalendarShortcutKey(keyEvent(insideBody('div', { role: 'grid' })))).toBe(true);
  });
});

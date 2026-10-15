import { describe, expect, test } from 'bun:test';

import { inlineScrollDelta } from './tab-strip-scroll';

const view = { left: 16, right: 216 };

describe('inlineScrollDelta', () => {
  test('a visible tab leaves the strip where it is', () => {
    expect(inlineScrollDelta(view, { left: 20, right: 120 })).toBe(0);
    expect(inlineScrollDelta(view, { left: 116, right: 216 })).toBe(0);
  });

  test('a tab past the right edge scrolls the strip on until its end is visible', () => {
    expect(inlineScrollDelta(view, { left: 250, right: 350 })).toBe(134);
  });

  test('a tab before the left edge scrolls the strip back until its start is visible', () => {
    expect(inlineScrollDelta(view, { left: -84, right: 16 })).toBe(-100);
  });

  test('a tab wider than the strip keeps its start visible', () => {
    expect(inlineScrollDelta(view, { left: 66, right: 366 })).toBe(50);
  });
});

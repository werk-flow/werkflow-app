import { describe, expect, test } from 'bun:test';

import type { PageMargins } from './model';
import { stationeryMarginsFit, stationeryPageShortages } from './page-geometry';

// The settings form and the save both judge stationery margins with these
// functions, so a draft the form accepts is one the renderer lays out
// (werk-flow/werkflow-planning#378).

const margins = (topMm: number, rightMm: number, bottomMm: number, leftMm: number): PageMargins => ({
  topMm,
  rightMm,
  bottomMm,
  leftMm,
});

describe('stationery margins', () => {
  test.each([
    ['the defaults', 'firstPage', margins(45, 20, 25, 25), []],
    ['the defaults', 'followingPages', margins(30, 20, 25, 25), []],
    [
      'each side allowed alone, too wide together',
      'firstPage',
      margins(45, 80, 25, 80),
      ['width', 'info_block'],
    ],
    ['each side allowed alone, too wide together', 'followingPages', margins(30, 80, 25, 80), ['width']],
    ['a right margin the info block needs', 'firstPage', margins(45, 35, 25, 25), ['info_block']],
    ['a right margin without an info block', 'followingPages', margins(30, 35, 25, 25), []],
    ['a top margin that moves the content too low', 'firstPage', margins(150, 20, 25, 25), ['height']],
    ['a top margin that leaves too little height', 'followingPages', margins(150, 20, 25, 25), ['height']],
  ] as const)('%s on %s: %p', (_case, page, pageMargins, expected) => {
    expect(stationeryPageShortages(page, pageMargins)).toEqual([...expected]);
  });

  test('the save fits only margins that leave both pages their room', () => {
    expect(
      stationeryMarginsFit({ firstPage: margins(45, 20, 25, 25), followingPages: margins(30, 20, 25, 25) }),
    ).toBe(true);
    expect(stationeryMarginsFit({ firstPage: margins(45, 20, 25, 25), followingPages: null })).toBe(true);
    expect(
      stationeryMarginsFit({ firstPage: margins(45, 20, 25, 25), followingPages: margins(30, 80, 25, 80) }),
    ).toBe(false);
    expect(stationeryMarginsFit({ firstPage: margins(45, 80, 25, 80), followingPages: null })).toBe(false);
  });
});

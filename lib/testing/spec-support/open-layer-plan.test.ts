import { expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Page } from '@playwright/test';
import type { DialogOpener } from '../../../tests/audit/support/dialog-opener';
import { DESKTOP, openingPlan } from '../../../tests/audit/support/open-layer-plan';

const PHONE = { width: 375, height: 812 };
const OPENERS = resolve(import.meta.dir, '../../../tests/audit/support/dialog-openers');

/**
 * The dialogs whose trigger only the desktop renders and that a phone user
 * does not need by design. A dialog joins only with the owner's decision; a
 * dialog a phone user needs gets an opener of its phone path instead.
 */
const DESKTOP_ONLY_DIALOGS = ['calendar.shortcuts', 'calendar.time-correction'];

/** The opener ids of an area module whose entry declares `opensOn: 'desktop'`. */
function desktopOnlyOpeners(source: string): string[] {
  const keys = [...source.matchAll(/^ {2}'([\w-]+\.[\w-]+)': /gm)];
  return keys
    .filter((key, index) =>
      source.slice(key.index, keys[index + 1]?.index ?? source.length).includes("opensOn: 'desktop'"),
    )
    .map((key) => key[1] ?? '');
}

test('a dialog opens at the audited width unless its opener declares a desktop-only trigger', () => {
  expect(openingPlan({}, 375)).toEqual({ openAt: PHONE, narrowTo: null });
  expect(openingPlan({ opensOn: 'desktop' }, 375)).toEqual({ openAt: DESKTOP, narrowTo: PHONE });
  // At the desktop width a desktop-only trigger needs no detour.
  expect(openingPlan({ opensOn: 'desktop' }, 1280)).toEqual({ openAt: DESKTOP, narrowTo: null });
  // A phone-only trigger opens at its own viewport.
  expect(openingPlan({ viewport: PHONE }, 1280)).toEqual({ openAt: PHONE, narrowTo: null });
});

test('probe: the opener has no silent desktop fallback for a trigger off screen at its width', () => {
  const source = readFileSync(resolve(import.meta.dir, '../../../tests/audit/support/open-layer.ts'), 'utf8');
  // Before package R the helper reloaded at 1280 px when a phone trigger stayed hidden for 3 s.
  expect(source).not.toContain('settledBeforeTimeout');
  expect(source.match(/setViewportSize\(/g)).toHaveLength(2);
  expect(source).toContain('offScreenTriggerMessage(plan.openAt.width)');
});

test('probe: a desktop-only opener states why a phone user does not need the dialog, and nothing else compiles', () => {
  const stub = {
    trigger: () => Promise.reject(new Error('A type probe never opens a dialog.')),
    layer: (page: Page) => page.getByRole('dialog'),
  };
  const reviewed: DialogOpener = {
    ...stub,
    opensOn: 'desktop',
    phoneUse: { kind: 'none', reason: 'Only a drag opens it.' },
  };
  // @ts-expect-error A desktop-only opener without the reason must not compile.
  const silent: DialogOpener = { ...stub, opensOn: 'desktop' };
  // @ts-expect-error A phone path is an opener of its own, not a sentence beside a desktop opener.
  const described: DialogOpener = { ...stub, opensOn: 'desktop', phonePath: 'The card menu.' };
  // @ts-expect-error A reason belongs only to a desktop-only opener.
  const stray: DialogOpener = { ...stub, phoneUse: { kind: 'none', reason: 'None.' } };
  expect([reviewed, silent, described, stray].map((opener) => opener.opensOn)).toEqual([
    'desktop',
    'desktop',
    'desktop',
    undefined,
  ]);
});

test('only the dialogs a phone user does not need open on the desktop at 375 px', () => {
  const sources = readdirSync(OPENERS).map((file) => readFileSync(resolve(OPENERS, file), 'utf8'));
  expect(sources.flatMap(desktopOnlyOpeners).sort()).toEqual(DESKTOP_ONLY_DIALOGS);
  expect(sources.join('\n')).not.toContain('phonePath');
});

test('probe: the desktop-only scan finds a declaration after comments and other keys', () => {
  const source = [
    "  'calendar.entry-create': {",
    '    trigger: async ({ page }) => button(page),',
    '  },',
    "  'calendar.planned': {",
    '    // The board toolbar.',
    "    opensOn: 'desktop',",
    '  },',
  ].join('\n');
  expect(desktopOnlyOpeners(source)).toEqual(['calendar.planned']);
});

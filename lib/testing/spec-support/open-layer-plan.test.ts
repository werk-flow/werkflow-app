import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DESKTOP, openingPlan } from '../../../tests/audit/support/open-layer-plan';

const PHONE = { width: 375, height: 812 };

test('a dialog opens at the audited width unless its opener names a desktop-only trigger and its phone path', () => {
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

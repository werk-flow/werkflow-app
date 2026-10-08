// Rule test: the browser settle steps wait on the app's busy attributes only.
import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { BUSY_SIGNAL_SELECTOR, ROUTE_REFRESH_SIGNAL } from './busy-signals';

const ROOT = join(import.meta.dir, '../../..');
const read = (path: string): string => readFileSync(join(ROOT, path), 'utf8');

test('the busy selector names exactly the four attributes the registry sets', () => {
  expect(BUSY_SIGNAL_SELECTOR.split(',').map((part) => part.trim())).toEqual([
    '[aria-busy="true"]',
    '[data-pending="true"]',
    '[data-slot="skeleton"]',
    '[data-slot="spinner"]',
  ]);
  expect(ROUTE_REFRESH_SIGNAL).toBe('data-route-refresh');
});

test('the registry primitives set the attributes the selector names', () => {
  expect(read('components/ui/skeleton.tsx')).toContain('data-slot="skeleton"');
  expect(read('components/ui/spinner.tsx')).toContain('data-slot="spinner"');
  expect(read('components/ui/button.tsx')).toMatch(/aria-busy=\{busy/);
  expect(read('components/ui/refresh-button.tsx')).toContain('markRouteRefresh(holder, true)');
  expect(read('hooks/use-realtime-router-refresh.ts')).toContain('markRouteRefresh(queuedHolder, true)');
});

test('settled and the visual settle wait on the shared selector, never on a class or a local list', () => {
  const interaction = read('tests/golden/support/steps/interaction.ts');
  expect(interaction).toContain('selector: BUSY_SIGNAL_SELECTOR');
  expect(interaction).toContain('routeRefresh: ROUTE_REFRESH_SIGNAL');
  expect(interaction).not.toMatch(/'\[aria-busy|"\[aria-busy/);
  const visual = read('tests/audit/support/visual-references.ts');
  expect(visual).toMatch(/export async function settlePage[\s\S]*?await settled\(page\);/);
  expect(visual).not.toMatch(/animate-(pulse|spin)/);
});

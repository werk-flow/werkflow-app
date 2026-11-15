// Rule test: the browser settle steps wait on the app's busy attributes only.
import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  BUSY_SIGNAL_SELECTOR,
  type BusyElementFacts,
  describeBusyElements,
  ROUTE_REFRESH_SIGNAL,
  UNCONFIRMED_LAYER_SIGNAL,
} from './busy-signals';

const ROOT = join(import.meta.dir, '../../..');
const read = (path: string): string => readFileSync(join(ROOT, path), 'utf8');

test('the busy selector names exactly the five attributes the registry sets', () => {
  expect(BUSY_SIGNAL_SELECTOR.split(',').map((part) => part.trim())).toEqual([
    '[aria-busy="true"]',
    '[data-pending="true"]',
    '[data-slot="skeleton"]',
    '[data-slot="spinner"]',
    '[data-unconfirmed]',
  ]);
  expect(ROUTE_REFRESH_SIGNAL).toBe('data-route-refresh');
  expect(UNCONFIRMED_LAYER_SIGNAL).toBe('data-unconfirmed-layer');
});

test('the registry primitives set the attributes the selector names', () => {
  expect(read('components/ui/skeleton.tsx')).toContain('data-slot="skeleton"');
  expect(read('components/ui/spinner.tsx')).toContain('data-slot="spinner"');
  expect(read('components/ui/button.tsx')).toMatch(/aria-busy=\{busy/);
  expect(read('components/ui/refresh-button.tsx')).toContain('markRouteRefresh(holder, true)');
  expect(read('hooks/use-realtime-router-refresh.ts')).toContain('markRouteRefresh(queuedHolder, true)');
  for (const primitive of ['list-row', 'table', 'card', 'inline-pending'])
    expect(read(`components/ui/${primitive}.tsx`)).toContain('{...unconfirmedMarker(');
  expect(read('components/ui/pending-row.tsx')).toMatch(/^\s+unconfirmed\r?$/m);
  expect(read('hooks/use-optimistic-list.ts')).toContain('markUnconfirmedLayer(holder, true)');
});

test('settled and the visual settle wait on the shared selector, never on a class or a local list', () => {
  const reader = read('tests/golden/support/busy-elements.ts');
  expect(reader).toContain('selector: BUSY_SIGNAL_SELECTOR');
  expect(reader).toContain('routeRefresh: ROUTE_REFRESH_SIGNAL');
  expect(reader).toContain('unconfirmedLayer: UNCONFIRMED_LAYER_SIGNAL');
  for (const source of [reader, read('tests/golden/support/steps/interaction.ts')])
    expect(source).not.toMatch(/'\[aria-busy|"\[aria-busy/);
  const visual = read('tests/audit/support/visual-references.ts');
  expect(visual).toMatch(/export async function settlePage[\s\S]*?await settled\(page\);/);
  expect(visual).not.toMatch(/animate-(pulse|spin)/);
});

const bareSkeleton: BusyElementFacts = {
  tag: 'div',
  role: '',
  signals: ['skeleton'],
  name: '',
  region: 'main',
};

test('a failed settle names the signal and region of a bare placeholder and counts repeats once', () => {
  expect(
    describeBusyElements([
      bareSkeleton,
      {
        tag: 'div',
        role: 'status',
        signals: ['aria-busy'],
        name: 'Dokumente werden geladen',
        region: 'main',
      },
      bareSkeleton,
      { ...bareSkeleton, region: 'status "Dokumente werden geladen"' },
      bareSkeleton,
    ]),
  ).toEqual([
    '3× skeleton <div> in main',
    'aria-busy <div role="status"> "Dokumente werden geladen" in main',
    'skeleton <div> in status "Dokumente werden geladen"',
  ]);
});

test('a busy element that matches two signals names both', () => {
  expect(
    describeBusyElements([
      { tag: 'button', role: '', signals: ['aria-busy', 'unconfirmed'], name: 'Speichern', region: '' },
    ]),
  ).toEqual(['aria-busy + unconfirmed <button> "Speichern"']);
});

// tests/ui-contracts/busy-elements.spec.ts proves what tests/golden/support/busy-elements.ts collects in a page.

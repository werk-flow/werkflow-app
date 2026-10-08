import { expect, mock, test } from 'bun:test';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { Check } from 'lucide-react';
import { createElement, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Spinner } from '@/components/ui/spinner';

// Loading canon (werkflow-design skill): every route segment ships its own
// `loading.tsx` whose skeleton mirrors that page. Without one, a page inherits
// the nearest ancestor's skeleton and shows another page's layout while it
// loads (the four handover routes and ten settings subpages, 2026-10-01).

const appRoot = resolve(import.meta.dir, '../../app/(app)');

// Pages that only redirect never render, so they have nothing to mirror.
const REDIRECT_ONLY_PAGES: readonly string[] = ['service/page.tsx'];

const pages = readdirSync(appRoot, { recursive: true, encoding: 'utf8' })
  .map((name) => name.replaceAll('\\', '/'))
  .filter((name) => name === 'page.tsx' || name.endsWith('/page.tsx'));

test('every authenticated page has a loading.tsx in its own folder', () => {
  const missing = pages.filter(
    (page) =>
      !REDIRECT_ONLY_PAGES.includes(page) && !existsSync(resolve(appRoot, dirname(page), 'loading.tsx')),
  );
  expect(missing).toEqual([]);
});

test('the redirect-only exceptions still only redirect', () => {
  for (const page of REDIRECT_ONLY_PAGES) {
    const source = readFileSync(resolve(appRoot, page), 'utf8');
    expect(source, page).toMatch(/redirect\(/);
    expect(source, page).not.toMatch(/return\s*[(<]/);
  }
});

test('a loading file renders a skeleton instead of re-exporting another route', () => {
  const reExports = readdirSync(appRoot, { recursive: true, encoding: 'utf8' })
    .map((name) => name.replaceAll('\\', '/'))
    .filter((name) => name.endsWith('loading.tsx'))
    .filter((name) => /from ['"]@\/app\//.test(readFileSync(resolve(appRoot, name), 'utf8')));
  // The project-scoped job detail is the same page component as the
  // standalone job detail, so it shares that route's loading file.
  expect(reExports).toEqual(['auftraege/projekt/[projectNumber]/[jobNumber]/loading.tsx']);
});

// Busy signals (werkflow-design skill, "Loading states"): a placeholder is
// Skeleton, whose data-slot the browser settle step waits on
// (lib/testing/spec-support/busy-signals.ts). The app shell once pulsed through
// hand-built divs that no attribute named, so the visual settle had to wait on
// an animation class.
const SKELETON_SLOT = 'data-slot="skeleton"';
// A loading file may import a module that also serves the page, and the
// settings skeleton picks its section from the path.
mock.module('server-only', () => ({}));
const navigation = await import('next/navigation');
mock.module('next/navigation', () => ({ ...navigation, usePathname: () => '/einstellungen/profil' }));

/** Pulsing elements outside the Skeleton primitive; empty when every placeholder is Skeleton. */
function rawPulses(markup: string): string[] {
  return [...markup.matchAll(/<[a-z]+\b[^>]*\banimate-pulse\b[^>]*>/g)]
    .map(([tag]) => tag)
    .filter((tag) => !tag.includes(SKELETON_SLOT));
}

async function renderDefault(path: string): Promise<string> {
  const loaded: unknown = await import(path);
  const component = (loaded as { default?: unknown }).default;
  if (typeof component !== 'function') throw new Error(`${path} has no default component`);
  return renderToStaticMarkup(createElement(component as () => ReactElement));
}

test('every loading file renders registry skeletons only', async () => {
  const loadingFiles = readdirSync(appRoot, { recursive: true, encoding: 'utf8' })
    .map((name) => name.replaceAll('\\', '/'))
    .filter((name) => name === 'loading.tsx' || name.endsWith('/loading.tsx'));
  const findings: string[] = [];
  for (const name of loadingFiles) {
    const markup = await renderDefault(resolve(appRoot, name));
    if (!markup.includes(SKELETON_SLOT)) findings.push(`${name}: no Skeleton`);
    for (const pulse of rawPulses(markup)) findings.push(`${name}: ${pulse}`);
  }
  expect(findings).toEqual([]);
});

// The app shell fallback is read as source: a layout fixture replaces the
// module in the shared unit-test process (lib/testing/fixtures/app-layout-runtime.tsx).
test('the app shell placeholders render Skeleton', () => {
  for (const file of ['components/sidebar/app-shell-skeleton.tsx', 'components/sidebar/app-shell.tsx']) {
    const source = readFileSync(resolve(import.meta.dir, '../..', file), 'utf8');
    expect(source, file).toContain('<Skeleton ');
    expect(source, file).not.toMatch(/animate-pulse/);
  }
});

test('the placeholder check catches a raw pulse and passes the same shape through Skeleton', () => {
  const raw = renderToStaticMarkup(
    createElement('div', { className: 'h-4 w-24 rounded bg-muted animate-pulse' }),
  );
  const registry = renderToStaticMarkup(createElement(Skeleton, { className: 'h-4 w-24 rounded' }));
  expect(rawPulses(raw)).toHaveLength(1);
  expect(rawPulses(registry)).toEqual([]);
  expect(registry).toContain(SKELETON_SLOT);
});

test('the running-action primitives carry the busy signals', () => {
  const button = renderToStaticMarkup(
    createElement(Button, { pending: true }, createElement(Check), 'Speichern'),
  );
  expect(button).toContain('aria-busy="true"');
  expect(button).toContain('disabled=""');
  expect(button).toContain('data-slot="spinner"');
  const idle = renderToStaticMarkup(createElement(Button, { pending: false }, 'Speichern'));
  expect(idle).not.toContain('aria-busy');
  expect(idle).not.toContain('data-slot="spinner"');
  // A slotted button passes its one child through untouched (React.Children.only).
  const link = renderToStaticMarkup(
    createElement(Button, { asChild: true, pending: false }, createElement('a', { href: '/x' }, 'Öffnen')),
  );
  expect(link).toStartWith('<a');
  expect(renderToStaticMarkup(createElement(Spinner))).toContain('data-slot="spinner"');
  expect(renderToStaticMarkup(createElement(Spinner, { label: 'Wird geladen' }))).toContain('role="status"');
});

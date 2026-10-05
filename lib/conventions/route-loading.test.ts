import { expect, test } from 'bun:test';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

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

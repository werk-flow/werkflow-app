// Rule test: every page outside the app shell is in the standalone inventory, so the standalone audit opens it.
import { existsSync, readdirSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { expect, test } from 'bun:test';
import { STANDALONE_REDIRECTS, STANDALONE_SCREENS } from './standalone-route-inventory';

const appRoot = resolve(import.meta.dir, '../../../app');

/** The page routes under app/ outside the app shell and the API, with route groups removed. */
function standalonePages(): string[] {
  const pages: string[] = [];
  function visit(directory: string): void {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        if (path === join(appRoot, '(app)') || path === join(appRoot, 'api')) continue;
        visit(path);
      } else if (entry.name === 'page.tsx') {
        const route = relative(appRoot, directory)
          .replaceAll('\\', '/')
          .split('/')
          .filter((segment) => segment !== '' && !/^\(.+\)$/.test(segment))
          .join('/');
        pages.push(`/${route}`);
      }
    }
  }
  visit(appRoot);
  return pages;
}

test('every page outside the app shell has a standalone audit entry or a tested redirect', () => {
  const registered: string[] = [
    ...STANDALONE_SCREENS.map((screen) => screen.route).filter((route) => route !== 'not-found'),
    ...STANDALONE_REDIRECTS.map((redirect) => redirect.route),
  ];
  expect(new Set(registered).size).toBe(registered.length);
  expect(registered.toSorted()).toEqual(standalonePages().toSorted());
});

test('the root not-found page is audited while it exists', () => {
  expect(existsSync(join(appRoot, 'not-found.tsx'))).toBe(true);
  expect(STANDALONE_SCREENS.some((screen) => screen.route === 'not-found')).toBe(true);
});

test('each screen opens at its own route, and the not-found address matches no page', () => {
  const pages = new Set(standalonePages());
  for (const screen of STANDALONE_SCREENS) {
    const pathname = screen.path.split('?')[0] ?? screen.path;
    if (screen.route === 'not-found') expect(pages.has(pathname), screen.path).toBe(false);
    else expect(pathname, screen.route).toBe(screen.route);
  }
});

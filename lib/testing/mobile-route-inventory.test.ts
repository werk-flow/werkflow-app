import { readdirSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { expect, test } from 'bun:test';
import { DYNAMIC_PHONE_ROUTES, MANAGER_PHONE_ROUTES, PHONE_REDIRECTS } from './mobile-route-inventory';

test('every authenticated page has a phone audit case or a tested redirect', () => {
  const root = resolve(import.meta.dir, '../../app/(app)');
  const pages: string[] = [];
  function visit(directory: string): void {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) visit(path);
      else if (entry.name === 'page.tsx') pages.push('/' + relative(root, directory).replaceAll('\\', '/'));
    }
  }
  visit(root);
  const registered: string[] = [...MANAGER_PHONE_ROUTES, ...DYNAMIC_PHONE_ROUTES, ...PHONE_REDIRECTS.map(item => item.route)];
  expect(new Set(registered).size).toBe(registered.length);
  expect(registered.toSorted()).toEqual(pages.toSorted());
});

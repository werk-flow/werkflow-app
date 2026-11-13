import { expect, test } from 'bun:test';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import { isNavItemActive, navItemsFor } from '@/components/sidebar/sidebar-nav-items';

// Every authenticated page highlights exactly one sidebar entry, so the user
// always sees which area they are in. `/service/anlagen` and `/service/wartung`
// highlighted nothing until the Service item learned `activePrefix` (third
// review pass); this test keeps a new route from being orphaned again.

const appRoot = resolve(import.meta.dir, '../../app/(app)');

// The settings area and the own problem reports are reached through the
// profile card, which highlights itself on these routes instead of a nav item.
const PROFILE_CARD_SECTIONS = ['/einstellungen', '/meldungen'];

const routes = readdirSync(appRoot, { recursive: true, encoding: 'utf8' })
  .map((name) => name.replaceAll('\\', '/'))
  .filter((name) => name === 'page.tsx' || name.endsWith('/page.tsx'))
  .map((page) => {
    const folder = dirname(page);
    const segments = folder === '.' ? [] : folder.split('/');
    return '/' + segments.map((segment) => (segment.startsWith('[') ? 'beispiel' : segment)).join('/');
  });

test('the route inventory finds the authenticated pages', () => {
  expect(routes).toContain('/dashboard');
  expect(routes).toContain('/service/wartung');
});

test('every authenticated route highlights exactly one sidebar entry', () => {
  const unmapped = routes.flatMap((route) => {
    const owners = navItemsFor('admin')
      .filter((item) => isNavItemActive(item, route))
      .map((item) => item.label);
    const ownedByProfileCard = PROFILE_CARD_SECTIONS.some((href) => isNavItemActive({ href }, route));
    const count = owners.length + (ownedByProfileCard ? 1 : 0);
    return count === 1 ? [] : [`${route}: ${count === 0 ? 'no entry' : owners.join(', ')}`];
  });
  expect(unmapped).toEqual([]);
});

test('the profile card still owns the settings and report highlights', () => {
  const source = readFileSync(
    resolve(import.meta.dir, '../../components/sidebar/sidebar-profile-card.tsx'),
    'utf8',
  );
  for (const section of PROFILE_CARD_SECTIONS) expect(source).toContain(`'${section}'`);
});

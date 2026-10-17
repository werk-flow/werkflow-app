// Rule test: every page of the inventories has a visual family, and every family has its references in both themes.
import { readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test } from 'bun:test';
import {
  APP_FAMILIES,
  STANDALONE_FAMILIES,
  familyReferenceNames,
} from '../../../tests/audit/support/visual-families';
import {
  DYNAMIC_PHONE_ROUTES,
  EMPLOYEE_PHONE_ROUTES,
  EMPLOYEE_WORK_PACKS,
  MANAGER_PHONE_ROUTES,
} from './mobile-route-inventory';
import { STANDALONE_SCREENS } from './standalone-route-inventory';

// "An accepted screen keeps its look: every page family has a visual
// reference" (werkflow-design, Checklist). The reference list once named 27
// families by hand with six dark images, and nothing tied it to the route
// inventory, so the settings subpages, the onboarding and sign-in screens and
// most dark pages had none (UI audit of 2026-10-15). A family stands for the
// routes that render its page; each family keeps a desktop reference in light
// and dark mode and a phone reference, image and text.

const SNAPSHOTS = resolve(import.meta.dir, '../../../tests/audit/visual/references.spec.ts-snapshots');
const PLATFORM_SUFFIX = '-win32';

/** Every inventoried page as `<session> <route>`. */
function inventoriedPages(): string[] {
  return [
    ...[...MANAGER_PHONE_ROUTES, ...DYNAMIC_PHONE_ROUTES].map((route) => `admin ${route}`),
    ...[...EMPLOYEE_PHONE_ROUTES, ...EMPLOYEE_WORK_PACKS].map((route) => `employee ${route}`),
    ...STANDALONE_SCREENS.map((screen) => `${screen.session} ${screen.route}`),
  ];
}

/** Every page a family stands for, as `<session> <route>`. */
function familyPages(): string[] {
  return [
    ...APP_FAMILIES.flatMap((family) => family.covers.map((route) => `${family.role} ${route}`)),
    ...STANDALONE_FAMILIES.map((family) => {
      const screen = STANDALONE_SCREENS.find((entry) => entry.route === family.screen);
      return `${screen?.session ?? 'unknown'} ${family.screen}`;
    }),
  ];
}

/** The reference names a set of family ids requires, with the image and the text file. */
function requiredFiles(ids: readonly string[]): string[] {
  return ids.flatMap((id) =>
    familyReferenceNames(id).flatMap((name) => [
      `${name}${PLATFORM_SUFFIX}.png`,
      `${name}${PLATFORM_SUFFIX}.txt`,
    ]),
  );
}

test('every page of the inventories belongs to exactly one visual family', () => {
  const covered = familyPages();
  expect(covered.filter((page, index) => covered.indexOf(page) !== index)).toEqual([]);
  expect(covered.toSorted()).toEqual(inventoriedPages().toSorted());
});

test('family ids are unique', () => {
  const ids = [...APP_FAMILIES, ...STANDALONE_FAMILIES].map((family) => family.id);
  expect(new Set(ids).size).toBe(ids.length);
});

test('every family has its desktop references in light and dark and its phone reference, and no reference is orphaned', () => {
  const ids = [...APP_FAMILIES, ...STANDALONE_FAMILIES].map((family) => family.id);
  const present = new Set(readdirSync(SNAPSHOTS));
  const required = requiredFiles(ids);
  expect(required.filter((file) => !present.has(file))).toEqual([]);
  expect([...present].filter((file) => !required.includes(file)).toSorted()).toEqual([]);
});

test('probe: a missing dark reference and a page without a family are reported', () => {
  expect(requiredFiles(['probe'])).toContain('probe-desktop-dark-win32.png');
  expect(requiredFiles(['probe'])).toContain('probe-phone-light-win32.txt');
  expect(inventoriedPages()).toContain('admin /einstellungen/kunden');
  expect(inventoriedPages()).toContain('newcomer /onboarding/start');
});

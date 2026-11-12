// Rule test: every top-level page area of the app shell has its organization-switch skeleton.
import { expect, test } from 'bun:test';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

// While the organization switches, the shell hides the page and shows the
// area's skeleton from components/sidebar/org-switch-overlay.tsx; an area
// without one showed an empty content region (found for /meldungen in the
// review of werk-flow/werkflow-planning#334).
const appRoot = resolve(import.meta.dir, '../../app/(app)');
const overlaySource = readFileSync(
  resolve(import.meta.dir, '../../components/sidebar/org-switch-overlay.tsx'),
  'utf8',
);

test('every top-level page area has an organization-switch skeleton', () => {
  const areas = readdirSync(appRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith('(') && !entry.name.startsWith('['))
    .filter(
      (entry) =>
        existsSync(resolve(appRoot, entry.name, 'page.tsx')) ||
        existsSync(resolve(appRoot, entry.name, 'layout.tsx')),
    )
    .map((entry) => `/${entry.name}`);
  expect(areas).toContain('/meldungen');
  const registered = (area: string): boolean => new RegExp(`\\[\\s*'${area}'`).test(overlaySource);
  expect(areas.filter((area) => !registered(area))).toEqual([]);
});

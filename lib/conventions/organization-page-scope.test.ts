// Rule test: every page renders inside the organization page scope, keyed by the organization the server rendered.
import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Review found page state of the previous organization after a switch again and again: drafts,
// selections, client reads and late banners (werk-flow/werkflow-planning#437). The scope makes it
// unwritable for every page at once; tests/ui-contracts/organization.spec.ts proves the scope.
const layout = readFileSync(resolve(import.meta.dir, '../../app/(app)/layout.tsx'), 'utf8');

test('the app layout keys all page content by the server-resolved organization', () => {
  const scoped =
    /<OrganizationPageScope organizationId=\{activeOrgId\}>\s*<div [^>]*>\s*\{children\}\s*<\/div>\s*<\/OrganizationPageScope>/;
  expect(layout).toMatch(scoped);
  expect(layout.match(/\{children\}/g)?.length).toBe(2);
});

// Rule test: a change plan selects the layout sweeps whose audited pages, tabs and dialogs render a changed product file, and a shared control selects none.
// Rule test: a change plan selects the visual references when a file any page renders changed, a shared control and a reader under lib/ included.
import { expect, test } from 'bun:test';
import { Glob } from 'bun';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { sourceImportGraph } from '../evidence/group-evidence';
import { groupSelections } from './group-selection';
import { MANAGER_PHONE_ROUTES, DYNAMIC_PHONE_ROUTES } from './mobile-route-inventory';
import {
  renderedGroupFiles,
  renderedSurfaceFiles,
  SHARED_SURFACE_LIMIT,
  surfaceRoots,
  VISUAL_REFERENCE_GROUP,
} from './surface-closure';
import { SURFACE_GROUPS, surfaceTests } from './surface-groups';

const ROOT = resolve(import.meta.dir, '../../..');
const ROOTS = surfaceRoots(ROOT);
const FILES = ['app', 'components', 'hooks', 'lib'].flatMap((directory) =>
  [...new Glob('**/*').scanSync({ cwd: join(ROOT, directory), onlyFiles: true })].map(
    (file) => `${directory}/${file.replaceAll('\\', '/')}`,
  ),
);
const ROUTE_FILES = FILES.filter((file) =>
  /^app\/(?:.*\/)?(?:page|layout|template|loading|error|global-error|not-found|route)\.tsx?$/.test(file),
);
const GRAPH = sourceImportGraph(ROOT, FILES, [...[...ROOTS.values()].flat(), ...ROUTE_FILES]);
const RENDERED = renderedSurfaceFiles(GRAPH, ROOTS);
const sweepsOf = (file: string): string[] =>
  [...RENDERED].filter(([, files]) => files.includes(file)).map(([group]) => group);

test('every audited page and dialog selects the sweep that audits it', () => {
  for (const group of SURFACE_GROUPS) {
    const rendered = RENDERED.get(`audit:layout:${group}`) ?? [];
    for (const piece of surfaceTests(group)) {
      // A route the inventory names without its page would select nothing, so the next page could fall outside.
      if (piece.defaultView) {
        const page = `app/(app)${piece.route}/page.tsx`;
        expect(existsSync(join(ROOT, page)), `${piece.route} has ${page}`).toBe(true);
        expect(rendered, `${group} renders ${page}`).toContain(page);
      }
      for (const dialog of piece.dialogs) {
        const component = dialog.key.slice(0, dialog.key.indexOf('#'));
        expect(existsSync(join(ROOT, component)), `${dialog.opener} lives in ${component}`).toBe(true);
        expect(rendered, `${group} renders ${component}`).toContain(component);
      }
    }
  }
});

test('the job pages and the edit dialog of #393 select the job sweep', () => {
  expect(sweepsOf('components/auftraege/job-detail/job-detail-header.tsx')).toContain('audit:layout:job');
  expect(sweepsOf('components/auftraege/forms/edit-job-dialog.tsx')).toContain('audit:layout:job');
});

test('a shared control selects no sweep, and the data layer and tests select none', () => {
  for (const file of ['components/ui/button.tsx', 'components/ui/dialog.tsx'])
    expect(sweepsOf(file), `${file} is rendered by more than ${SHARED_SURFACE_LIMIT} sweeps`).toEqual([]);
  for (const files of RENDERED.values())
    expect(files.filter((file) => !/^(?:app|components|hooks)\//.test(file))).toEqual([]);
});

const VISUAL = renderedGroupFiles(ROOT, GRAPH).get(VISUAL_REFERENCE_GROUP) ?? [];

/** Why a change plan selects the visual references for `changedFiles`, or undefined. */
function visualSelection(changedFiles: readonly string[]) {
  return groupSelections({
    mode: 'change',
    groups: [
      {
        id: VISUAL_REFERENCE_GROUP,
        kind: 'audit',
        trigger: 'release-only',
        executionInputs: [],
        renderedFiles: VISUAL,
      },
    ],
    changedFiles,
    unresolvedGroupIds: [],
  }).get(VISUAL_REFERENCE_GROUP);
}

test('#694 changed the offer header through its page and its reader, and selects the visual references', () => {
  // Its merge-queue run selected no visual reference, and the next full run failed angebot-desktop-light.txt.
  const changed = [
    'app/(app)/angebote/[offerId]/page.tsx',
    'components/angebote/offer-revision-start.tsx',
    'components/angebote/offer-revisions.tsx',
    'lib/offers/reads.ts',
    'lib/offers/types.ts',
    'supabase/migrations/20270701090000_start_the_next_revision_of_a_sent_offer.sql',
    'tests/ui-contracts/offers.spec.ts',
  ];
  expect(visualSelection(changed)).toEqual({
    reason: 'Audited surface changed',
    changedFiles: changed.filter((file) => !/^(?:supabase|tests)\//.test(file)),
  });
});

test('a change to another family, a shared control or the global styles selects the visual references', () => {
  for (const file of [
    'components/zeiterfassung/zeiterfassung-dashboard-hero.tsx',
    'hooks/use-weekly-time-data.ts',
    'components/ui/button.tsx',
    'app/globals.css',
  ])
    expect(visualSelection([file])?.changedFiles, file).toEqual([file]);
});

test('every inventoried page is a root of the visual references, and test code selects none', () => {
  for (const route of [...MANAGER_PHONE_ROUTES, ...DYNAMIC_PHONE_ROUTES])
    expect(VISUAL, route).toContain(`app/(app)${route}/page.tsx`);
  expect(
    VISUAL.filter((file) => /^(?:tests|lib\/testing)\//.test(file) || /\.test\.tsx?$/.test(file)),
  ).toEqual([]);
  expect(
    visualSelection(['tests/ui-contracts/offers.spec.ts', 'lib/testing/selection/fast-tier.ts']),
  ).toBeUndefined();
});

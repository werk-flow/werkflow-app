// Rule test: a detail page and its loading skeleton share their columns, and the columns follow the content width.
import { expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { DYNAMIC_PHONE_ROUTES } from '@/lib/testing/selection/mobile-route-inventory';

// Columns by content width (werkflow-design, "Density and layout"):
// `DetailColumns` (components/shared/detail-columns.tsx) owns the `detail`
// size container and every column layout. The job and project skeletons once
// switched to two columns at a screen width where their pages stayed at one,
// so the layout jumped while the page loaded, and the service case and
// equipment details sized their columns by the screen (UI audit of
// 2026-10-15). A detail page and the skeleton its route shows name the same
// layouts in the same order.

const root = resolve(import.meta.dir, '../..');
const HOME = 'components/shared/detail-columns.tsx';

type DetailPage = {
  route: (typeof DYNAMIC_PHONE_ROUTES)[number];
  /** The components that render the route's columns, one per page variant. */
  pages: readonly string[];
  /** The file that renders the skeleton of the route's loading.tsx. */
  skeleton: string;
};

const DETAIL_PAGES: readonly DetailPage[] = [
  {
    route: '/auftraege/[jobNumber]',
    pages: ['components/auftraege/job-detail/job-detail-content.tsx'],
    skeleton: 'app/(app)/auftraege/[jobNumber]/loading.tsx',
  },
  {
    route: '/auftraege/projekt/[projectNumber]',
    pages: ['components/auftraege/project-detail/project-detail-content.tsx'],
    skeleton: 'app/(app)/auftraege/projekt/[projectNumber]/loading.tsx',
  },
  {
    route: '/kunden/[clientId]',
    pages: ['components/kunden/kunden-detail-content.tsx'],
    skeleton: 'app/(app)/kunden/[clientId]/loading.tsx',
  },
  {
    // A member with a login opens the member detail; a record without one the
    // personnel record. The role is known only once the data resolves, so the
    // skeleton mirrors the member detail, the page most people open.
    route: '/mitarbeiter/[userId]',
    pages: ['components/mitarbeiter/mitarbeiter-detail-content.tsx'],
    skeleton: 'app/(app)/mitarbeiter/[userId]/loading.tsx',
  },
  {
    route: '/anfragen/[requestId]',
    pages: ['components/anfragen/request-detail-content.tsx'],
    skeleton: 'app/(app)/anfragen/[requestId]/loading.tsx',
  },
  {
    route: '/service/faelle/[caseNumber]',
    pages: ['components/service/service-case-detail-content.tsx'],
    skeleton: 'components/loading-states/service-cases-page-skeleton.tsx',
  },
  {
    route: '/service/anlagen/[equipmentNumber]',
    pages: ['components/service/equipment-detail-content.tsx'],
    skeleton: 'components/loading-states/equipment-page-skeleton.tsx',
  },
];

/** Pages that render columns but share a route whose skeleton mirrors another variant, with the reason. */
const VARIANT_PAGES: Readonly<Record<string, string>> = {
  'components/mitarbeiter/personnel-record-detail-content.tsx':
    'the record without a login at /mitarbeiter/[userId]; the skeleton mirrors the member detail',
};

/** Detail routes without page columns, with the reason. */
const SINGLE_COLUMN_DETAILS: Readonly<Partial<Record<(typeof DYNAMIC_PHONE_ROUTES)[number], string>>> = {
  '/auftraege/[jobNumber]/uebergabe': 'the handover workspace is one column',
  '/auftraege/projekt/[projectNumber]/uebergabe': 'the handover workspace is one column',
  '/auftraege/projekt/[projectNumber]/[jobNumber]': 'the job detail page of /auftraege/[jobNumber]',
  '/auftraege/projekt/[projectNumber]/[jobNumber]/uebergabe': 'the handover workspace is one column',
  '/auftraege/uebergaben/[targetType]/[targetId]': 'the handover workspace is one column',
  '/zeiterfassung/perioden/[periodId]': 'the period result is one column of cards and lists',
};

/** The `DetailColumns` layouts a source renders, in order. */
function layoutsOf(source: string): string[] {
  return [...source.matchAll(/<DetailColumns\s+layout="([a-z-]+)"/g)].map((match) => match[1] ?? '');
}

function read(file: string): string {
  return readFileSync(resolve(root, file), 'utf8');
}

function sourceFiles(): string[] {
  return ['app', 'components'].flatMap((directory) =>
    readdirSync(resolve(root, directory), { recursive: true, encoding: 'utf8' })
      .map((name) => `${directory}/${name.replaceAll('\\', '/')}`)
      .filter((file) => /\.tsx?$/.test(file)),
  );
}

test('every detail route of the inventory has its columns paired or a reason for one column', () => {
  const paired = DETAIL_PAGES.map((entry) => entry.route);
  const single = Object.keys(SINGLE_COLUMN_DETAILS);
  expect(paired.filter((route) => single.includes(route))).toEqual([]);
  expect([...paired, ...single].toSorted()).toEqual([...DYNAMIC_PHONE_ROUTES].toSorted());
});

test('a detail page and its skeleton name the same column layouts', () => {
  for (const entry of DETAIL_PAGES) {
    const skeleton = layoutsOf(read(entry.skeleton));
    expect(skeleton.length, `${entry.skeleton} renders DetailColumns`).toBeGreaterThan(0);
    for (const page of entry.pages)
      expect(layoutsOf(read(page)), `${page} against ${entry.skeleton}`).toEqual(skeleton);
  }
});

test('every file that renders DetailColumns is a paired page, its skeleton or a named variant', () => {
  const known = new Set([
    HOME,
    ...DETAIL_PAGES.flatMap((entry) => [...entry.pages, entry.skeleton]),
    ...Object.keys(VARIANT_PAGES),
  ]);
  const unpaired = sourceFiles().filter((file) => !known.has(file) && read(file).includes('<DetailColumns'));
  expect(unpaired).toEqual([]);
  for (const file of Object.keys(VARIANT_PAGES))
    expect(layoutsOf(read(file)).length, file).toBeGreaterThan(0);
});

test('the detail container and the screen-width page columns have no other home', () => {
  const offenders = sourceFiles()
    .filter((file) => file !== HOME)
    .filter((file) => read(file).includes('@container/detail'));
  expect(offenders).toEqual([]);
  for (const file of [
    ...DETAIL_PAGES.flatMap((entry) => [...entry.pages, entry.skeleton]),
    ...Object.keys(VARIANT_PAGES),
  ])
    expect(read(file), file).not.toMatch(/(^|[\s"'`])(md|lg|xl|2xl):grid-cols-/);
});

test('probe: a skeleton with another layout or none is told apart', () => {
  expect(layoutsOf('<DetailColumns layout="halves"><div /></DetailColumns>')).toEqual(['halves']);
  expect(layoutsOf('<div className="grid lg:grid-cols-[1fr_1fr]" />')).toEqual([]);
  expect(layoutsOf('<DetailColumns layout="halves" />')).not.toEqual(
    layoutsOf('<DetailColumns layout="pair" />'),
  );
});

import { describe, expect, test } from 'bun:test';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

// Structural check of the loading canon (werkflow-design skill, "Loading
// states"; enforcement ladder Tier 2, UI/UX hardening Phase 4, 2026-09-03):
// a skeleton mirrors the hover of what it loads because both render from one
// column definition and one `interactive` flag. ESLint bans the hover class
// literal; this scan pins the two things a selector cannot see — a loading
// file that hand-builds rows next to the real list, and a column definition
// that feeds only one of header and skeleton.

const REPO_ROOT = join(import.meta.dir, '..', '..');

function listTsxFiles(directory: string): string[] {
  return readdirSync(join(REPO_ROOT, directory), { recursive: true, encoding: 'utf8' })
    .filter((name) => name.endsWith('.tsx'))
    .map((name) => join(directory, name).replaceAll('\\', '/'));
}

const productFiles = [...listTsxFiles('app'), ...listTsxFiles('components')].filter(
  (path) => !path.startsWith('components/ui/')
);
const sources = new Map(
  productFiles.map((path) => [path, readFileSync(join(REPO_ROOT, path), 'utf8')] as const)
);
const loadingFiles = productFiles.filter(
  (path) => path.startsWith('components/loading-states/') || path.endsWith('/loading.tsx')
);

// A hand-built table or card row in a loading file is the drift the column
// definition exists to prevent: it is written once for the real list and once
// here, and only one of them gets the next change.
const HAND_BUILT_ROW_PATTERNS: Array<[RegExp, string]> = [
  [/from ['"]@\/components\/ui\/table['"]/, 'imports the table primitives'],
  [/rounded-lg border bg-card px-3 py-2\.5/, 'hand-builds a ListRow box'],
  [/\bhover:/, 'carries a hover class'],
  [/\bcursor-pointer\b/, 'carries cursor-pointer'],
  [/SkeletonColumn\[\]/, 'declares its own column definition'],
];

describe('skeleton pairing (design canon, Loading states)', () => {
  test('scans the loading files', () => {
    expect(loadingFiles.length).toBeGreaterThan(20);
  });

  for (const path of loadingFiles) {
    test(`${path} renders rows only through the list skeleton components`, () => {
      const source = sources.get(path) ?? '';
      const offences = HAND_BUILT_ROW_PATTERNS.filter(([pattern]) => pattern.test(source)).map(
        ([, label]) => label
      );
      expect(offences).toEqual([]);
    });
  }

  // Every declared column definition renders both the header (`X.map(`) and
  // a skeleton (`columns={X` or a helper that derives from it), somewhere in
  // the product tree. A definition consumed by only one side is drift waiting
  // to happen.
  // Only typed definitions count; other `*_COLUMNS` constants (CSV mappings,
  // preference lists) are not table columns.
  const columnDeclaration = /const ([A-Z][A-Z0-9_]*_COLUMNS)\b[^=\n]*SkeletonColumn\[\]/g;
  const declared = new Map<string, string>();
  for (const [path, source] of sources) {
    for (const match of source.matchAll(columnDeclaration)) {
      declared.set(match[1], path);
    }
  }

  test('finds the column definitions', () => {
    expect(declared.size).toBeGreaterThanOrEqual(8);
  });

  // Lists that render synchronously from the page payload have no loading
  // state, so there is no skeleton to pair. Name them here with the reason;
  // an entry without a reason is a review flag.
  const NO_LOADING_STATE: Record<string, string> = {
    INVENTORY_MOVEMENT_COLUMNS:
      'the movements tab renders from the inventory page payload; the route skeleton mirrors the items tab',
  };

  for (const [identifier, path] of declared) {
    if (identifier in NO_LOADING_STATE) continue;
    test(`${identifier} (${path}) feeds both header and skeleton`, () => {
      // A list may derive its final column list through a helper
      // (`memberColumns(showActions)`) and render header cells from a
      // `columns` prop; both count as consuming the definition.
      const declaringSource = sources.get(path) ?? '';
      const helperNames = [...declaringSource.matchAll(/function (\w+)\([^)]*\)[^{]*\{[^}]*\b\w*_COLUMNS\b/g)]
        .filter((match) => match[0].includes(identifier))
        .map((match) => match[1]);
      const consumers = [identifier, ...helperNames];
      const rendersHeader = [...sources.values()].some(
        (source) =>
          consumers.some((name) => new RegExp(`${name}\\b[^\\n]*\\.map\\(`).test(source)) ||
          (consumers.some((name) => source.includes(`columns={${name}`)) &&
            /<TableHead\b/.test(source) &&
            /\bcolumns\.map\(/.test(source))
      );
      const rendersSkeleton = [...sources.values()].some(
        (source) =>
          consumers.some((name) => source.includes(`columns={${name}`)) &&
          /Skeleton(Rows|Table)\b/.test(source)
      );
      expect({ rendersHeader, rendersSkeleton }).toEqual({
        rendersHeader: true,
        rendersSkeleton: true,
      });
    });
  }
});

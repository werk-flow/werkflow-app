import { expect, test } from 'bun:test';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import exceptions from './boundary-coverage-exceptions.json';
import {
  actionModules,
  boundaryCoverage,
  idArgumentProblems,
  type ReadSource,
  type SourceFile,
} from '@/lib/conventions/boundary-coverage-scan';

// Tier 2 for the boundary-test rule (docs/technical/security.md, "Add a
// Server Action or route handler", step 8). Every exported action of a 'use
// server' module is driven by a boundary fixture or test that imports its
// module, names the action beyond the import and asserts a refusal (a
// foreign organization's id or a lower role). A boundary file is a test under
// lib/, or a fixture under lib/testing/fixtures/ that a test runs, which
// builds on action-boundary-world.ts or is named as a boundary, authorization
// or access check.
//
// boundary-coverage-exceptions.json holds the two other categories:
// `selfScoped` are actions that act only on the session user's own rows, and
// this test proves each takes no id argument; `missing` lists, per module,
// the actions without a fixture yet and why. `missing` only shrinks: a new
// uncovered action fails, and so does a listed action that gained a fixture.

const repositoryRoot = resolve(import.meta.dir, '../..');
const MINIMUM_REASON_LENGTH = 30;

type MissingModule = { readonly reason: string; readonly actions: readonly string[] };
const SELF_SCOPED: Readonly<Record<string, string>> = exceptions.selfScoped;
const MISSING: Readonly<Record<string, MissingModule>> = exceptions.missing;

function listFiles(root: string): string[] {
  const found: string[] = [];
  function visit(relative: string): void {
    for (const entry of readdirSync(resolve(repositoryRoot, relative), { withFileTypes: true })) {
      if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
      const path = `${relative}/${entry.name}`;
      if (entry.isDirectory()) visit(path);
      else if (/\.tsx?$/.test(entry.name)) found.push(path);
    }
  }
  visit(root);
  return found;
}

function read(path: string): SourceFile {
  return { path, text: readFileSync(resolve(repositoryRoot, path), 'utf8') };
}

const readSource: ReadSource = (path) => {
  const absolute = resolve(repositoryRoot, path);
  return existsSync(absolute) ? readFileSync(absolute, 'utf8') : null;
};

function missingKeys(): string[] {
  return Object.entries(MISSING).flatMap(([path, entry]) =>
    entry.actions.map((action) => `${path}#${action}`),
  );
}

test('every exported action has a boundary fixture, is proven self-scoped, or has a reviewed entry that only shrinks', () => {
  const product = ['app', 'components', 'hooks', 'lib']
    .flatMap(listFiles)
    .filter((path) => !path.startsWith('lib/testing/'))
    .map(read);
  const modules = actionModules(product);
  expect(modules.length).toBeGreaterThan(40);
  const tests = listFiles('lib').filter((path) => /\.test\.tsx?$/.test(path));
  const candidates = [...tests, ...listFiles('lib/testing/fixtures')].map(read);
  const runnerText = tests.map((path) => read(path).text).join('\n');
  const coverage = boundaryCoverage(modules, candidates, runnerText);
  const actions = modules.flatMap((actionModule) =>
    actionModule.actions.map((action) => `${actionModule.path}#${action}`),
  );
  const uncovered = actions.filter((key) => !coverage.has(key) && !(key in SELF_SCOPED));
  const listed = new Set(missingKeys());
  expect(
    uncovered.filter((key) => !listed.has(key)),
    "Copy lib/testing/fixtures/join-request-boundaries.ts: drive each new action on action-boundary-world.ts with a foreign id and a lower role, and run the fixture from a test. An action on the caller's own rows only goes into selfScoped.",
  ).toEqual([]);
  expect(
    [...listed].filter((key) => !uncovered.includes(key)),
    'These actions now have a boundary fixture or are gone; remove them from boundary-coverage-exceptions.json "missing".',
  ).toEqual([]);
  expect(
    Object.keys(SELF_SCOPED).filter((key) => !actions.includes(key)),
    'These selfScoped actions are gone; remove their entry.',
  ).toEqual([]);
});

test('a self-scoped action takes no id argument, and every exception states its reason', () => {
  const problems = Object.keys(SELF_SCOPED).flatMap((key) => {
    const [path = '', action = ''] = key.split('#');
    const text = readSource(path);
    if (text === null) return [`${key}: the module is gone`];
    return idArgumentProblems({ path, text }, action, readSource).map((problem) => `${key}: ${problem}`);
  });
  expect(problems, 'A self-scoped action may take no id; drive it in a boundary fixture instead.').toEqual(
    [],
  );
  const shortReasons = [
    ...Object.entries(SELF_SCOPED).map(([key, reason]) => [key, reason] as const),
    ...Object.entries(MISSING).map(([key, entry]) => [key, entry.reason] as const),
  ].filter(([, reason]) => reason.trim().length < MINIMUM_REASON_LENGTH);
  expect(shortReasons).toEqual([]);
});

test('planted coverage cases: an action without a fixture, and one with', () => {
  const modules = actionModules([
    {
      path: 'lib/widgets/actions.ts',
      text: "'use server';\nexport async function saveWidget(input: unknown) {}\nexport async function listWidgets() {}\nexport const archiveWidget = async () => {};\nasync function restoreWidget() {}\nexport { restoreWidget };\nexport type Widget = { name: string };\n",
    },
    { path: 'lib/widgets/helpers.ts', text: 'export function helper() {}\n' },
  ]);
  // Every value export form is an action; a type export is not.
  expect(modules).toEqual([
    {
      path: 'lib/widgets/actions.ts',
      actions: ['saveWidget', 'listWidgets', 'archiveWidget', 'restoreWidget'],
    },
  ]);
  const fixture = (text: string, path = 'lib/testing/fixtures/widget-boundaries.ts'): SourceFile => ({
    path,
    text,
  });
  const drives =
    "import { installActionWorld } from './action-boundary-world';\nconst { saveWidget } = await import('@/lib/widgets/actions');\nassert.deepEqual(await saveWidget({ id: foreignId }), { success: false, error: 'not_authorized' });\n";
  const runner = "Bun.spawn([process.execPath, 'lib/testing/fixtures/widget-boundaries.ts'])";
  expect(boundaryCoverage(modules, [], runner).size).toBe(0);
  // Per action: the driven action is covered, its sibling in the same module is not.
  expect([...boundaryCoverage(modules, [fixture(drives)], runner).entries()]).toEqual([
    ['lib/widgets/actions.ts#saveWidget', ['lib/testing/fixtures/widget-boundaries.ts']],
  ]);
  // Not run by any test, no refusal asserted, or the action never driven: no coverage.
  expect(boundaryCoverage(modules, [fixture(drives)], '').size).toBe(0);
  expect(
    boundaryCoverage(modules, [fixture(drives.replace("'not_authorized'", "'saved'"))], runner).size,
  ).toBe(0);
  expect(
    boundaryCoverage(
      modules,
      [fixture("import '@/lib/widgets/actions';\nconst code = 'not_authorized';\n")],
      runner,
    ).size,
  ).toBe(0);
});

test('planted self-scope proofs: an id parameter, an id property or schema, and a type that cannot be proven', () => {
  const files: Record<string, string> = {
    'lib/widgets/schemas.ts':
      "import { z } from '@/lib/zod';\nexport const prefsSchema = z.object({ columns: z.array(z.enum(['a', 'b'])) });\nexport type Prefs = z.infer<typeof prefsSchema>;\nexport const ownerSchema = z.object({ ownerId: z.string() });\nexport const codeSchema = z.object({ code: uuidSchema });\n",
    'lib/widgets/actions.ts': [
      "'use server';",
      "import { codeSchema, ownerSchema, type Prefs } from './schemas';",
      'type Profile = { firstName: string; lastName: string };',
      'export async function signOut() {}',
      'export async function saveProfile(input: Profile) {}',
      'export async function savePrefs(input: Prefs) {}',
      'export async function readWidget(widgetIdInput: string) {}',
      'export async function saveOwner(input: { name: string; teamIds: string[] }) {}',
      'export async function saveOwnerBySchema(input: z.infer<typeof ownerSchema>) {}',
      'export async function redeem(input: z.infer<typeof codeSchema>) {}',
      'export async function saveAnything(input: unknown) {}',
      'export async function saveForm(form: FormData) {}',
      'export async function saveCode(input: z.infer<typeof inlineUuid>) {}',
      'export async function saveBuilt(input: z.infer<typeof built>) {}',
      'export async function saveRows(input: { rows: unknown[] }) {}',
      'export async function saveMember(input: { member_id: string }) {}',
      "export async function saveQuoted(input: { 'organization_id': string }) {}",
      'export async function saveWrapped(input: WithId<typeof ownerSchema>) {}',
      'interface Settings { name: string; columns: string[] }',
      'export async function saveSettings(input: Settings) {}',
      'const inlineUuid = z.object({ code: z.string().uuid() });',
      'function buildSchema() { return z.object({ recordId: uuidSchema }); }',
      'const built = buildSchema();',
    ].join('\n'),
  };
  const readPlanted: ReadSource = (path) => files[path] ?? null;
  const file = { path: 'lib/widgets/actions.ts', text: files['lib/widgets/actions.ts'] ?? '' };
  const problems = (action: string): string[] => idArgumentProblems(file, action, readPlanted);
  expect(problems('signOut')).toEqual([]);
  expect(problems('saveProfile')).toEqual([]);
  expect(problems('savePrefs')).toEqual([]);
  expect(problems('readWidget')).toEqual(['parameter widgetIdInput is an id']);
  expect(problems('saveOwner')).toEqual(['property teamIds is an id']);
  expect(problems('saveOwnerBySchema')).toEqual(['property ownerId is an id']);
  expect(problems('redeem')).toEqual(['uuidSchema parses an id']);
  expect(problems('saveAnything')).toEqual(['unknown cannot be proven free of ids']);
  expect(problems('saveForm')).toEqual(['FormData cannot be resolved inside the repository']);
  expect(problems('saveCode')).toEqual(['z.string().uuid parses an id']);
  expect(problems('saveBuilt')).toEqual(['buildSchema() builds the value and cannot be proven free of ids']);
  expect(problems('saveRows')).toEqual(['unknown cannot be proven free of ids']);
  expect(problems('saveMember')).toEqual(['property member_id is an id']);
  expect(problems('saveQuoted')).toEqual(['property organization_id is an id']);
  expect(problems('saveWrapped')).toEqual(['WithId cannot be resolved inside the repository']);
  expect(problems('saveSettings')).toEqual([]);
  expect(problems('missing')).toEqual(['missing is not an exported function of lib/widgets/actions.ts']);
});

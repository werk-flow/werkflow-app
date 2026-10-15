import { expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { posix, resolve } from 'node:path';

// Tier 2 for the boundary-test rule (docs/technical/security.md, "Add a
// Server Action or route handler", step 8). Every 'use server' module needs a
// boundary fixture or test that imports it, drives at least one of its
// actions and asserts a refusal (a foreign organization's id or a lower
// role). A boundary file is a test under lib/, or a fixture under
// lib/testing/fixtures/ that a test runs, which builds on
// action-boundary-world.ts or is named as a boundary, authorization or access
// check. MISSING_BOUNDARY_FIXTURES lists the modules without one today; it
// only shrinks: a new module without a fixture fails, and so does a listed
// module that gained one.

const repositoryRoot = resolve(import.meta.dir, '../..');

/** "module path" -> what the module exposes without an action-level boundary fixture yet. */
const MISSING_BOUNDARY_FIXTURES: Readonly<Record<string, string>> = {
  'lib/auth/actions.ts':
    "deleteAccount and invalidateProfileCache take no id and act on the session user's own account.",
  'lib/calendar/actions.ts':
    'getCalendarWindow reads the active organization; calendar-window-http.ts covers its read failures, not a foreign id.',
  'lib/calendar/board-actions.ts':
    "getCalendarBoardContext reads the active organization's board; calendar-board-http.ts covers read failures only.",
  'lib/calendar/preferences-actions.ts':
    "saveCalendarPreferences writes the caller's own preference row; sql:user-preference-writes proves the function.",
  'lib/commitments/actions.ts':
    'record and withdraw customer commitment take occurrence and commitment ids; no fixture sends a foreign id.',
  'lib/customer-relationships/actions.ts':
    'Eight follow-up and communication actions on one customer; the requireManagerAndClient guard is driven only for lib/clients.',
  'lib/dispatch/actions.ts':
    'Ten dispatch actions; planning_dispatch.sql proves the function refusals, no fixture sends a foreign dispatch id.',
  'lib/installed-equipment/actions.ts':
    'Eleven equipment actions behind requireServiceManager; the guard is driven only for lib/maintenance.',
  'lib/jobs/auftraege-column-preferences-actions.ts':
    "saveAuftraegeColumnPreferences writes the caller's own column preference in the active organization.",
  'lib/jobs/list-actions.ts':
    "getProjectJobPage reads one project's jobs; no fixture sends a foreign project id.",
  'lib/org/actions.ts':
    'active-organization-cookie.ts drives setActiveOrgCookie with a foreign organization without the boundary world; createOrganization runs before any membership.',
  'lib/org/calendar-actions.ts':
    'Holiday region and closure days of the active organization, Admin and Büro only; no fixture drives an employee.',
  'lib/org/delete-action.ts':
    'deleteOrganization deletes the active organization; no fixture drives a non-admin caller.',
  'lib/org/settings-actions.ts':
    'updateOrganizationSettings for the active organization; no fixture drives a lower role.',
  'lib/personnel/target-actions.ts':
    "Weekly and daily targets; another member's targets need Admin or Büro, and no fixture drives an employee.",
  'lib/qualifications/actions.ts':
    'Nineteen team and capability actions; no fixture sends a foreign employee or team id.',
  'lib/responsibilities/actions.ts':
    'Responsibility configuration and delegations; no fixture drives a lower role or a foreign delegation id.',
  'lib/service-cases/actions.ts':
    'Seven service-case actions behind requireServiceManager; no fixture sends a foreign case or client id.',
  'lib/settings/actions.ts': "Profile settings and avatar of the session user's own account; no id is taken.",
  'lib/sickness/actions.ts':
    'Nine sickness actions including recording for another member; calendar fixtures cover reads, not a foreign record id.',
  'lib/subscription/actions.ts':
    'simulatePayment acts on the session user before any organization exists; subscription-payment.ts covers activation.',
  'lib/time-accounts/actions.ts':
    'Thirteen period, adjustment and payroll actions; the SQL groups prove the functions, no fixture sends a foreign period id.',
  'lib/time-tracking/settings-actions.ts':
    'updateTimeTrackingSettings for the active organization; no fixture drives an employee caller.',
  'lib/vacation/actions.ts':
    "Nine vacation actions including decisions on another member's request; no fixture sends a foreign request id.",
  'lib/work-handover/actions.ts':
    'Eight handover actions; no fixture sends a foreign job or handover package id.',
  'lib/work-templates/actions.ts':
    'Ten template actions including applyWorkTemplate on a job; no fixture sends a foreign template or job id.',
};

type SourceFile = { path: string; text: string };
type ActionModule = { path: string; actions: readonly string[] };

const REFUSAL = /'(not_authorized|not_a_member|no_active_org)'|_not_found'/;
const BOUNDARY_NAME = /boundar|authorization|access/;

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

function hasModuleDirective(text: string): boolean {
  return /^(?:\s|\/\/[^\n]*\n|\/\*[\s\S]*?\*\/)*['"]use server['"]/.test(text);
}

/** The 'use server' modules and the names of their exported actions. */
function actionModules(files: readonly SourceFile[]): ActionModule[] {
  return files
    .filter((file) => !/\.(test|spec)\.tsx?$/.test(file.path) && hasModuleDirective(file.text))
    .map((file) => ({
      path: file.path,
      actions: [...file.text.matchAll(/^export (?:async )?function (\w+)|^export const (\w+) =/gm)].flatMap(
        (match) => ((match[1] ?? match[2]) ? [match[1] ?? match[2] ?? ''] : []),
      ),
    }));
}

/** Repository paths (without extension) that a file imports, statically or dynamically. */
function importedModules(file: SourceFile): Set<string> {
  const modules = new Set<string>();
  for (const match of file.text.matchAll(/(?:from\s+|import\(\s*)['"]([^'"]+)['"]/g)) {
    const specifier = match[1] ?? '';
    if (specifier.startsWith('@/')) modules.add(specifier.slice(2).replace(/\.tsx?$/, ''));
    else if (specifier.startsWith('.')) {
      modules.add(posix.normalize(posix.join(posix.dirname(file.path), specifier)).replace(/\.tsx?$/, ''));
    }
  }
  return modules;
}

/**
 * The boundary files that cover each module: they import it, name one of its
 * actions beyond the import (a call or a reference) and assert a refusal.
 */
function boundaryCoverage(
  modules: readonly ActionModule[],
  candidates: readonly SourceFile[],
  runnerText: string,
): Map<string, string[]> {
  const boundaries = candidates.filter((file) => {
    const base = posix.basename(file.path).replace(/\.tsx?$/, '');
    const isTest = /\.test\.tsx?$/.test(file.path);
    const marked = BOUNDARY_NAME.test(base) || file.text.includes('action-boundary-world');
    return marked && REFUSAL.test(file.text) && (isTest || runnerText.includes(base));
  });
  const coverage = new Map<string, string[]>();
  for (const actionModule of modules) {
    const modulePath = actionModule.path.replace(/\.tsx?$/, '');
    const covering = boundaries.filter(
      (file) =>
        importedModules(file).has(modulePath) &&
        actionModule.actions.some(
          (action) => (file.text.match(new RegExp(`\\b${action}\\b`, 'g')) ?? []).length >= 2,
        ),
    );
    if (covering.length === 0) continue;
    coverage.set(
      actionModule.path,
      covering.map((file) => file.path),
    );
  }
  return coverage;
}

function read(path: string): SourceFile {
  return { path, text: readFileSync(resolve(repositoryRoot, path), 'utf8') };
}

test('every use-server module has a boundary fixture, or a reviewed entry that only shrinks', () => {
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
  const uncovered = modules.map((actionModule) => actionModule.path).filter((path) => !coverage.has(path));
  expect(
    uncovered.filter((path) => !(path in MISSING_BOUNDARY_FIXTURES)),
    "Copy lib/testing/fixtures/join-request-boundaries.ts: drive the new module's actions on action-boundary-world.ts with a foreign id and a lower role, and run the fixture from a test.",
  ).toEqual([]);
  expect(
    Object.keys(MISSING_BOUNDARY_FIXTURES).filter((path) => !uncovered.includes(path)),
    'These modules now have a boundary fixture or are gone; remove their MISSING_BOUNDARY_FIXTURES entry.',
  ).toEqual([]);
});

test('planted coverage cases: a new module without a fixture, and one with', () => {
  const modules = actionModules([
    {
      path: 'lib/widgets/actions.ts',
      text: "'use server';\nexport async function saveWidget(input: unknown) {}\n",
    },
    { path: 'lib/widgets/helpers.ts', text: 'export function helper() {}\n' },
  ]);
  expect(modules).toEqual([{ path: 'lib/widgets/actions.ts', actions: ['saveWidget'] }]);
  const fixture = (text: string, path = 'lib/testing/fixtures/widget-boundaries.ts'): SourceFile => ({
    path,
    text,
  });
  const drives =
    "import { installActionWorld } from './action-boundary-world';\nconst { saveWidget } = await import('@/lib/widgets/actions');\nassert.deepEqual(await saveWidget({ id: foreignId }), { success: false, error: 'not_authorized' });\n";
  const runner = "Bun.spawn([process.execPath, 'lib/testing/fixtures/widget-boundaries.ts'])";
  expect(boundaryCoverage(modules, [], runner).has('lib/widgets/actions.ts')).toBe(false);
  expect(boundaryCoverage(modules, [fixture(drives)], runner).get('lib/widgets/actions.ts')).toEqual([
    'lib/testing/fixtures/widget-boundaries.ts',
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

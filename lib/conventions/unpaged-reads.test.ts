import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import ts from 'typescript';
import { listProductSources, parseProductSource, repositoryRoot } from './product-sources';
import {
  boundName,
  chainCalls,
  continuationCalls,
  enclosingFunction,
  organizationTables,
  stringValue,
  unwrap,
  type ChainCall,
} from './query-chains';

// Tier 2 for complete reads (AGENTS.md "2. Performance and immediate
// feedback"). PostgREST stops a response at its row cap without an error, so
// a `.select()` on an organization-sized table without a page boundary loses
// rows silently once a company grows. Every read chain rooted at
// `.from('<table>')` on such a table is bounded when it, or the builder
// variable it is assigned to, calls `.range`, `.limit`, `.single`,
// `.maybeSingle`, `.eq('id', …)`, `.in('id', …)` or counts with
// `{ head: true }`, or when it runs inside the page callback of `readAllRows`,
// `readCompleteRows` or `readInBatches`. A builder returned by a local factory
// (`const base = () => admin.from(…)…`) is bounded when every call of the
// factory is. Reads bounded by one parent record (the sites of one customer,
// the entries of one day) are listed below with their bound; the list only
// shrinks.

/**
 * Organization tables whose rows stay few per company: settings, policies,
 * people, catalogs of names, folders and templates, and one row per month.
 * The complete lists of the app's pickers are named in
 * docs/technical/realtime-and-caching.md ("Complete lists").
 */
const SMALL_ORGANIZATION_TABLES = new Set([
  'organization_settings',
  'organization_members',
  'organization_invites',
  'organization_join_requests',
  'organization_capabilities',
  'organization_closure_days',
  'organization_qualification_settings',
  'organization_responsibility_assignments',
  'organization_responsibility_configurations',
  'organization_responsibility_delegations',
  'organization_user_preferences',
  'employee_records',
  'teams',
  'team_memberships',
  'inventory_categories',
  'inventory_locations',
  'inventory_suppliers',
  'document_folders',
  'work_templates',
  'work_template_versions',
  'personnel_onboarding_templates',
  'personnel_onboarding_template_versions',
  'personnel_onboarding_template_items',
  'time_account_policies',
  'time_account_policy_versions',
  'time_account_policy_credit_rules',
  'time_account_policy_supplement_rules',
  'time_account_policy_warning_rules',
  'payroll_mapping_profiles',
  'payroll_mapping_versions',
  'payroll_code_mappings',
  'payroll_employee_mappings',
  'payroll_exports',
  'time_periods',
]);

const BOUNDING_METHODS = new Set(['range', 'limit', 'single', 'maybeSingle']);
const WRITE_METHODS = new Set(['insert', 'upsert', 'update', 'delete']);
const PAGED_READERS = new Set(['readAllRows', 'readCompleteRows', 'readInBatches']);

/**
 * Reads whose size one parent record bounds, keyed `file::function::table`,
 * with the bound in words. An entry that matches no read fails as stale.
 */
const ONE_JOB = 'the rows of one job: its assigned people';
const ONE_OCCURRENCE = 'the people assigned to one calendar visit';
const ONE_EMPLOYEE =
  'the history of one employee record: conditions, schedules, absences or onboarding items';
const ONE_USER_ACTIVE_JOBS = 'the active job assignments of one person';
const ONE_ARTIFACT = 'the revisions and lines of one Arbeitsnachweis';
const ONE_USER_DAY = "one person's time rows of one day or one open session";
const REVIEWED_UNPAGED_READS: Readonly<Record<string, string>> = {
  'app/(app)/anfragen/[requestId]/page.tsx::AnfrageDetailPage::client_request_events':
    'the history of one customer request',
  'lib/attention/actions.ts::deriveOwnNotifications::vacation_requests': `${ONE_EMPLOYEE}, inside the 60-day notification window`,
  'lib/dispatch/readiness-target.ts::composeReadinessForTarget::planning_occurrence_assignments':
    ONE_OCCURRENCE,
  'lib/dispatch/server.ts::loadEmployeeDispatchCards::planning_dispatches':
    'the active dispatches of one job',
  'lib/documents/access.ts::getAuthorizedDocument::document_links': 'the links of one document',
  'lib/documents/actions.ts::getDocumentDetails::document_versions': 'the versions of one document',
  'lib/jobs/actions.ts::replaceJobAssignmentsAfterAssessment::job_assignments': ONE_JOB,
  'lib/jobs/actions.ts::readJobDetails::job_assignments': ONE_JOB,
  'lib/jobs/update-preparation.ts::prepareJobUpdate::job_assignments': ONE_JOB,
  'lib/maintenance/actions.ts::createMaintenanceVisit::maintenance_due_work_events':
    'the replay events of one idempotency key',
  'lib/personnel/actions.ts::getPersonnelDetail::employment_conditions': ONE_EMPLOYEE,
  'lib/personnel/actions.ts::getPersonnelDetail::work_schedules': ONE_EMPLOYEE,
  'lib/personnel/lifecycle-actions.ts::getPersonnelLifecycle::personnel_documents': ONE_EMPLOYEE,
  'lib/personnel/lifecycle-actions.ts::getPersonnelLifecycle::personnel_onboarding_plans': ONE_EMPLOYEE,
  'lib/personnel/lifecycle-actions.ts::getPersonnelLifecycle::personnel_onboarding_requirements':
    ONE_EMPLOYEE,
  'lib/personnel/lifecycle-actions.ts::getPersonnelLifecycle::job_assignments': ONE_USER_ACTIVE_JOBS,
  'lib/personnel/lifecycle-actions.ts::loadTransitionInventory::job_assignments': ONE_USER_ACTIVE_JOBS,
  'lib/personnel/lifecycle-actions.ts::getOwnPersonnelActions::personnel_onboarding_requirements':
    ONE_EMPLOYEE,
  'lib/personnel/lifecycle-actions.ts::getOwnPersonnelActions::personnel_documents': ONE_EMPLOYEE,
  'lib/personnel/target-actions.ts::getWeeklyTargets::work_schedules': ONE_EMPLOYEE,
  'lib/personnel/target-actions.ts::getWeeklyTargets::employment_conditions': ONE_EMPLOYEE,
  'lib/planning/actions.ts::extendPlanningSeriesHorizon::planning_occurrence_assignments': ONE_OCCURRENCE,
  'lib/planning/actions.ts::updatePlanningCalendarEntry::planning_occurrence_assignments': ONE_OCCURRENCE,
  'lib/planning/actions.ts::resolveSeriesRescheduleAssignments::planning_occurrence_assignments':
    ONE_OCCURRENCE,
  'lib/sickness/server.ts::loadSicknessReportsForRecord::sickness_reports': ONE_EMPLOYEE,
  'lib/time-corrections/actions.ts::resubmitTimeCorrection::time_correction_request_sources':
    'the sources of one revision of one correction request',
  'lib/time-tracking/actions.ts::getUserEntriesForDay::time_entries': ONE_USER_DAY,
  'lib/time-tracking/actions.ts::clockOutBeforeSignOut::time_sessions': ONE_USER_DAY,
  'lib/time-tracking/actions.ts::getTimeEntriesForProjectJobs::jobs': 'the jobs of one project',
  'lib/time-tracking/open-session-orgs.ts::getOpenSessionOrgsForUserOnDay::time_entries': ONE_USER_DAY,
  'lib/time-tracking/segment-actions.ts::getCanonicalClockState::time_segments': ONE_USER_DAY,
  'lib/vacation/server.ts::loadVacationCountingContext::work_schedules': ONE_EMPLOYEE,
  'lib/vacation/server.ts::loadVacationCountingContext::employment_conditions': ONE_EMPLOYEE,
  'lib/vacation/server.ts::loadVacationRequestsForRecord::vacation_requests': ONE_EMPLOYEE,
  'lib/work-artifacts/actions.ts::getWorkArtifactDetail::work_artifact_revisions': ONE_ARTIFACT,
  'lib/work-artifacts/actions.ts::getWorkArtifactDetail::work_artifact_actions': ONE_ARTIFACT,
  'lib/work-artifacts/actions.ts::getWorkArtifactDetail::work_artifact_measurement_lines': ONE_ARTIFACT,
  'lib/work-artifacts/actions.ts::getWorkArtifactDetail::work_artifact_defect_details': ONE_ARTIFACT,
  'lib/work-artifacts/actions.ts::getWorkArtifactDetail::work_artifact_change_details': ONE_ARTIFACT,
  'lib/work-artifacts/actions.ts::getWorkArtifactDetail::work_artifact_revision_documents': ONE_ARTIFACT,
  'lib/work-artifacts/actions.ts::getWorkArtifactDetail::work_artifact_revision_sources': ONE_ARTIFACT,
  'lib/work-handover/actions.ts::loadWorkspace::work_handover_draft_items':
    'the draft items of one handover package',
  'lib/work-handover/actions.ts::loadWorkspace::work_handover_releases':
    'the releases of one handover package',
};

type UnpagedRead = { key: string; line: number };

function bounds({ method, call }: ChainCall): boolean {
  if (BOUNDING_METHODS.has(method)) return true;
  if ((method === 'eq' || method === 'in') && stringValue(call.arguments[0]) === 'id') return true;
  if (method !== 'select') return false;
  const options = call.arguments[1] && unwrap(call.arguments[1]);
  return (
    options !== undefined &&
    ts.isObjectLiteralExpression(options) &&
    options.properties.some(
      (property) =>
        ts.isPropertyAssignment(property) &&
        ts.isIdentifier(property.name) &&
        property.name.text === 'head' &&
        property.initializer.kind === ts.SyntaxKind.TrueKeyword,
    )
  );
}

/** True when `node` sits inside an argument of a `readAllRows`, `readCompleteRows` or `readInBatches` call. */
function insidePagedReader(node: ts.Node): boolean {
  for (let current = node.parent; current; current = current.parent) {
    if (
      ts.isCallExpression(current) &&
      ts.isIdentifier(current.expression) &&
      PAGED_READERS.has(current.expression.text) &&
      current.arguments.some((argument) => argument.pos <= node.pos && node.end <= argument.end)
    )
      return true;
  }
  return false;
}

/** Every use of the local name `name` in the file, without its declaration and property names. */
function references(source: ts.SourceFile, name: string): ts.Identifier[] {
  const found: ts.Identifier[] = [];
  ts.forEachChild(source, function visit(node) {
    if (ts.isIdentifier(node) && node.text === name) {
      const parent = node.parent;
      const declaration =
        (ts.isVariableDeclaration(parent) || ts.isFunctionDeclaration(parent)) && parent.name === node;
      const member =
        (ts.isPropertyAccessExpression(parent) && parent.name === node) ||
        (ts.isPropertyAssignment(parent) && parent.name === node);
      if (!declaration && !member) found.push(node);
    }
    ts.forEachChild(node, visit);
  });
  return found;
}

/** The name a function is declared or bound under. */
function declaredName(fn: ts.Node): string | undefined {
  if (ts.isFunctionDeclaration(fn) && fn.name) return fn.name.text;
  const holder = fn.parent;
  return holder && ts.isVariableDeclaration(holder) && ts.isIdentifier(holder.name)
    ? holder.name.text
    : undefined;
}

/** True when an enclosing function is a page callback: written inside a complete-read call or passed to one by name. */
function inPageCallback(node: ts.Node, source: ts.SourceFile): boolean {
  if (insidePagedReader(node)) return true;
  for (let fn = enclosingFunction(node); fn; fn = enclosingFunction(fn)) {
    const name = declaredName(fn);
    if (name !== undefined && references(source, name).some(insidePagedReader)) return true;
  }
  return false;
}

/** Calls the builder receives through the variables it flows into: `let query = …; const ordered = query.order(…); ordered.range(…)`. */
function builderCalls(top: ts.Expression, depth = 0): ChainCall[] {
  const name = boundName(top);
  const calls = continuationCalls(top);
  if (depth > 2) return calls;
  const followed = calls.flatMap(({ call }) => {
    const next = chainCalls(call).top;
    const nextName = boundName(next);
    return nextName !== undefined && nextName !== name ? builderCalls(next, depth + 1) : [];
  });
  return [...calls, ...followed];
}

function bounded(start: ts.Expression): boolean {
  const { calls, top } = chainCalls(start);
  return [...calls, ...builderCalls(top)].some(bounds);
}

/** True when the function returns the builder variable `name` itself. */
function returnsIdentifier(fn: ts.Node | undefined, name: string): boolean {
  if (!fn) return false;
  let found = false;
  ts.forEachChild(fn, function visit(node) {
    if (found || (ts.isFunctionLike(node) && node !== fn)) return;
    if (ts.isReturnStatement(node) && node.expression) {
      const returned = unwrap(node.expression);
      if (ts.isIdentifier(returned) && returned.text === name) found = true;
    }
    ts.forEachChild(node, visit);
  });
  return found;
}

/** The local factory whose returned builder is this chain: `const base = () => chain`, `return chain` or `return query`. */
function factoryOf(top: ts.Expression): ts.Node | undefined {
  let node: ts.Node = top;
  while (node.parent && (ts.isParenthesizedExpression(node.parent) || ts.isAsExpression(node.parent)))
    node = node.parent;
  const parent = node.parent;
  if (parent && ts.isArrowFunction(parent) && parent.body === node) return parent;
  if (parent && ts.isReturnStatement(parent)) return enclosingFunction(parent);
  const name = boundName(top);
  const fn = enclosingFunction(top);
  return name !== undefined && returnsIdentifier(fn, name) ? fn : undefined;
}

/** True when every use of the factory pages or bounds the builder it returns. */
function factoryBounded(factory: ts.Node, source: ts.SourceFile): boolean {
  const name = declaredName(factory);
  if (name === undefined) return false;
  const uses = references(source, name);
  return (
    uses.length > 0 &&
    uses.every(
      (use) =>
        insidePagedReader(use) ||
        (ts.isCallExpression(use.parent) && use.parent.expression === use && bounded(use.parent)),
    )
  );
}

function functionName(node: ts.Node): string {
  for (let current = enclosingFunction(node); current; current = enclosingFunction(current)) {
    if (ts.isMethodDeclaration(current) && current.name) return current.name.getText();
    const name = declaredName(current);
    if (name !== undefined) return name;
    const parent = current.parent;
    if (parent && ts.isPropertyAssignment(parent)) return parent.name.getText();
  }
  return '<module>';
}

export function unpagedReads(file: string, text: string, tables: ReadonlySet<string>): UnpagedRead[] {
  const source = parseProductSource(file, text);
  const found: UnpagedRead[] = [];
  ts.forEachChild(source, function visit(node) {
    ts.forEachChild(node, visit);
    if (!ts.isCallExpression(node) || !ts.isPropertyAccessExpression(node.expression)) return;
    if (node.expression.name.text !== 'from') return;
    const receiver = node.expression.expression;
    if (ts.isPropertyAccessExpression(receiver) && receiver.name.text === 'storage') return;
    const table = stringValue(node.arguments[0]);
    if (table === undefined || !tables.has(table)) return;
    const { calls, top } = chainCalls(node);
    const own = [...calls, ...builderCalls(top)];
    if (own.some(({ method }) => WRITE_METHODS.has(method))) return;
    if (!own.some(({ method }) => method === 'select')) return;
    if (own.some(bounds) || inPageCallback(node, source)) return;
    const factory = factoryOf(top);
    if (factory !== undefined && factoryBounded(factory, source)) return;
    found.push({
      key: `${file}::${functionName(node)}::${table}`,
      line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1,
    });
  });
  return found;
}

function organizationSizedTables(): Set<string> {
  return new Set([...organizationTables()].filter((table) => !SMALL_ORGANIZATION_TABLES.has(table)));
}

test('every read of an organization-sized table has a page boundary or a reviewed bound', () => {
  const tables = organizationSizedTables();
  expect(tables.has('clients') && tables.has('jobs') && tables.has('projects')).toBe(true);
  const reads = listProductSources().flatMap((file) => {
    const text = readFileSync(resolve(repositoryRoot, file), 'utf8');
    return text.includes('.from(') ? unpagedReads(file, text, tables) : [];
  });
  const keys = new Set(reads.map((read) => read.key));
  expect(
    reads
      .filter((read) => !(read.key in REVIEWED_UNPAGED_READS))
      .map((read) => `${read.key.split('::')[0]}:${read.line} reads ${read.key.split('::')[2]}`),
    'PostgREST stops at 1,000 rows without an error. Read through readCompleteRows or readAllRows, add .range or .limit, or use a server search; a read bounded by one parent record goes into REVIEWED_UNPAGED_READS with its bound.',
  ).toEqual([]);
  expect(
    Object.keys(REVIEWED_UNPAGED_READS).filter((key) => !keys.has(key)),
    'These REVIEWED_UNPAGED_READS entries match no read; remove them.',
  ).toEqual([]);
}, 120_000);

test('every small-table exception names an organization table', () => {
  const tables = organizationTables();
  expect([...SMALL_ORGANIZATION_TABLES].filter((table) => !tables.has(table))).toEqual([]);
});

const plantedTables = new Set(['projects', 'jobs']);
const planted = (code: string): string[] =>
  unpagedReads('lib/planted.ts', code, plantedTables).map((read) => read.key);

test('the scan reports the silently truncated read and accepts the bounded forms', () => {
  // The Mitarbeiter detail read before the pickers package: every project of the company in one request.
  expect(
    planted(
      `async function load(admin, id) { return admin.from('projects').select('*').eq('organization_id', id).order('created_at'); }`,
    ),
  ).toEqual(['lib/planted.ts::load::projects']);
  expect(
    planted(
      `async function load(admin, id) { return readCompleteRows((from, to) => admin.from('projects').select('*').eq('organization_id', id).order('id').range(from, to), LIST_ROW_CAP); }`,
    ),
  ).toEqual([]);
  expect(
    planted(
      `async function load(admin, id, q) { let query = admin.from('jobs').select('id').eq('organization_id', id); if (q) query = query.ilike('title', q); const ordered = query.order('id'); return ordered.range(0, 50); }`,
    ),
  ).toEqual([]);
  expect(
    planted(
      `async function load(admin, id, ids) { const base = () => admin.from('jobs').select('id').eq('organization_id', id); return Promise.all([base().range(0, 50), readInBatches(ids, (batch) => base().in('id', batch))]); }`,
    ),
  ).toEqual([]);
  // A factory with one unbounded use is reported at its chain.
  expect(
    planted(
      `async function load(admin, id) { const base = () => admin.from('jobs').select('id').eq('organization_id', id); await base().range(0, 50); return base(); }`,
    ),
  ).toEqual(['lib/planted.ts::base::jobs']);
  expect(
    planted(
      `async function load(admin, id) { const read = (from, to) => { const query = admin.from('jobs').select('id').eq('organization_id', id); return (x ? query.eq('status', x) : query).range(from, to); }; return readCompleteRows(read, 10); }`,
    ),
  ).toEqual([]);
  expect(
    planted(
      `async function count(admin, id) { return admin.from('jobs').select('id', { count: 'exact', head: true }).eq('organization_id', id); }`,
    ),
  ).toEqual([]);
  expect(
    planted(
      `async function one(admin, id) { return admin.from('jobs').select('*').eq('id', id).eq('organization_id', org); }`,
    ),
  ).toEqual([]);
  expect(
    planted(
      `async function write(admin, id) { return admin.from('jobs').update({ title: 'x' }).eq('organization_id', id).select('id'); }`,
    ),
  ).toEqual([]);
});

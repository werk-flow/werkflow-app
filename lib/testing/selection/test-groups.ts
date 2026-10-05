import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, posix } from 'node:path';
import ts from 'typescript';
import { scenariosForFiles } from '../measured-scenarios';

export interface TestGroup {
  readonly id: string;
  readonly kind: 'golden' | 'audit' | 'ui' | 'unit' | 'sql' | 'canary' | 'static';
  readonly files: readonly string[];
  readonly scopes: readonly string[];
  readonly isolation: 'group-world' | 'process' | 'database-transaction' | 'cloud-world';
  readonly timing: GroupTimingRequirements;
  /** Package script a static group runs; declared here so the registry is its only home. */
  readonly script?: string;
}

export interface GroupTimingRequirements {
  readonly requireFreshness: boolean;
  readonly requireReadiness: boolean;
  readonly exclusive: boolean;
  /** Registered measured-scenario ids the group must record (Step 2). */
  readonly requiredScenarios?: readonly string[];
}

const untimed: GroupTimingRequirements = {
  requireFreshness: false,
  requireReadiness: false,
  exclusive: false,
};
const freshnessFiles = new Set([
  'tests/golden/gg-00.spec.ts',
  'tests/golden/p1-10.spec.ts',
  'tests/golden/p1-11.spec.ts',
  'tests/golden/p1-12.spec.ts',
  'tests/golden/p1-18.spec.ts',
  'tests/golden/p1-19.spec.ts',
  'tests/golden/p1-24.spec.ts',
  'tests/golden/p1-24a.spec.ts',
  'tests/canary/canary.spec.ts',
  'tests/audit/performance/calendar-live.spec.ts',
  'tests/audit/performance/planning-benchmark.spec.ts',
  'tests/audit/performance/field.spec.ts',
]);
// Audit P1-22 measures opening readiness inside its imported submission helper.
// This ownership declaration must survive a helper refactor or removal of a timing call.
const readinessSources: Readonly<Record<string, string>> = {
  'tests/golden/p1-22.spec.ts': 'tests/golden/p1-22.spec.ts',
  'tests/golden/p1-11.spec.ts': 'tests/golden/p1-11.spec.ts',
  'tests/audit/wave-2/p1-22.spec.ts': 'tests/audit/support/time-corrections.ts',
  'tests/audit/performance/calendar-live.spec.ts': 'tests/audit/support/time-corrections.ts',
};

function declaredTiming(files: readonly string[]): GroupTimingRequirements {
  const requireFreshness = files.some((file) => freshnessFiles.has(file));
  const requireReadiness = files.some((file) => readinessSources[file] !== undefined);
  const requiredScenarios = scenariosForFiles(files).map((scenario) => scenario.id);
  return {
    requireFreshness,
    requireReadiness,
    requiredScenarios,
    exclusive: requireFreshness || requireReadiness || requiredScenarios.length > 0,
  };
}

// Prefixes describe ownership, not proof that a change cannot affect another area.
// A changed file under a prefix selects the browser groups that declare its scope;
// a product file no prefix owns selects the core set (group-selection.ts).
// An entry ending in "/" owns a directory; any other entry owns exactly one file,
// for a shared file whose feature is obvious (a hook, a skeleton, an API route).
// Every entry must exist on disk (test-scope-prefixes.test.ts): an entry that names
// nothing owns nothing (the customer library was listed as lib/customers/
// while it lives in lib/clients/, 2026-09-14).
export const TEST_SCOPE_PREFIXES: Readonly<Record<string, readonly string[]>> = {
  customers: [
    'lib/clients/',
    'lib/customer-relationships/',
    'lib/requests/',
    'components/kunden/',
    'components/anfragen/',
    'app/(app)/kunden/',
    'app/(app)/anfragen/',
    'app/(app)/einstellungen/kunden/',
    'app/api/customer-page/',
    'components/loading-states/anfragen-page-skeleton.tsx',
    'components/loading-states/kunden-content-skeleton.tsx',
    'components/loading-states/kunden-page-skeleton.tsx',
  ],
  work: [
    'lib/jobs/',
    'lib/projects/',
    'lib/work-lifecycle/',
    'lib/work-templates/',
    'lib/work-artifacts/',
    'lib/work-handover/',
    'lib/parking/',
    'components/auftraege/',
    'components/arbeitsvorlagen/',
    'app/(app)/auftraege/',
    'app/(app)/arbeitsvorlagen/',
    'app/(app)/einstellungen/auftraege-projekte/',
    'hooks/use-active-jobs.ts',
    'hooks/use-job-entity-options.ts',
    'hooks/use-live-auftraege-data.ts',
    'components/active-jobs-provider.tsx',
    'components/shared/embedded-auftraege-section.tsx',
    'components/settings/auftraege-column-settings-form.tsx',
    'components/loading-states/auftraege-content-skeleton.tsx',
    'components/loading-states/auftraege-page-skeleton.tsx',
    'components/loading-states/work-templates-page-skeleton.tsx',
  ],
  planning: [
    'lib/calendar/',
    'lib/planning/',
    'lib/dispatch/',
    'lib/commitments/',
    'components/kalender/',
    'app/(app)/kalender/',
    'app/(app)/einstellungen/kalender/',
    'app/api/calendar-board/',
    'app/api/calendar-window/',
    'hooks/use-planning-options.ts',
    'components/loading-states/kalender-content-skeleton.tsx',
    'components/loading-states/kalender-page-skeleton.tsx',
  ],
  personnel: [
    'lib/personnel/',
    'lib/responsibilities/',
    'lib/qualifications/',
    'lib/sickness/',
    'lib/vacation/',
    'lib/members/',
    'lib/invites/',
    'components/mitarbeiter/',
    'app/(app)/mitarbeiter/',
    'app/(app)/qualifikationen/',
    'app/(app)/einstellungen/mitarbeiter/',
    'hooks/use-member-status.ts',
    'components/settings/personnel-onboarding-template-settings.tsx',
    'components/settings/responsibility-settings.tsx',
    'components/loading-states/mitarbeiter-content-skeleton.tsx',
    'components/loading-states/mitarbeiter-page-skeleton.tsx',
    'components/loading-states/qualifikationen-page-skeleton.tsx',
  ],
  time: [
    'lib/time-tracking/',
    'lib/time-corrections/',
    'lib/time-accounts/',
    'components/zeiterfassung/',
    'app/(app)/zeiterfassung/',
    'app/(app)/einstellungen/zeiterfassung/',
    'app/api/time-tracking-state/',
    'hooks/use-weekly-time-data.ts',
    'components/clock-action-list.tsx',
    'components/clock-fab.tsx',
    'components/clock-state-provider.tsx',
    'components/manual-entry-dialog.tsx',
    'components/manual-entry-form-content.tsx',
    'components/time-activity-dialog.tsx',
    'components/settings/holiday-calendar-settings.tsx',
    'components/settings/time-tracking-settings-form.tsx',
    'components/loading-states/zeiterfassung-content-skeleton.tsx',
    'components/loading-states/zeiterfassung-dashboard-skeleton.tsx',
    'components/loading-states/zeiterfassung-time-account-skeletons.tsx',
  ],
  documents: [
    'lib/documents/',
    'lib/storage/',
    'components/dokumente/',
    'app/(app)/dokumente/',
    'components/loading-states/dokumente-page-skeleton.tsx',
  ],
  inventory: [
    'lib/inventory/',
    'components/inventar/',
    'app/(app)/inventar/',
    'components/loading-states/inventar-page-skeleton.tsx',
  ],
  service: [
    'lib/installed-equipment/',
    'lib/service-cases/',
    'lib/maintenance/',
    'components/service/',
    'app/(app)/service/',
    'components/loading-states/equipment-page-skeleton.tsx',
    'components/loading-states/maintenance-page-skeleton.tsx',
    'components/loading-states/service-cases-page-skeleton.tsx',
  ],
  attention: [
    'lib/attention/',
    'components/aufgaben/',
    'app/(app)/aufgaben/',
    'app/api/attention-counts/',
    'components/realtime/attention-count-provider.tsx',
    'components/loading-states/aufgaben-page-skeleton.tsx',
  ],
};

/** A directory entry ("…/") owns everything below it; any other entry owns exactly that file. */
export function scopeEntryOwns(entry: string, file: string): boolean {
  return entry.endsWith('/') ? file.startsWith(entry) : file === entry;
}

const auditDefinitions: readonly (readonly [string, string, readonly string[]])[] = [
  ['wave-1:a1-organisation', 'wave-1/a1-organisation.spec.ts', ['personnel', 'time', 'customers', 'work']],
  ['wave-1:a1-kunden', 'wave-1/a1-kunden.spec.ts', ['customers', 'work']],
  ['wave-1:a1-auftraege', 'wave-1/a1-auftraege.spec.ts', ['work', 'customers']],
  ['wave-1:a1-kalender', 'wave-1/a1-kalender.spec.ts', ['planning', 'time', 'work', 'personnel']],
  ['wave-1:a1-zeiten', 'wave-1/a1-zeiten.spec.ts', ['time', 'planning', 'work', 'personnel']],
  ['wave-1:a1-dokumente', 'wave-1/a1-dokumente.spec.ts', ['documents', 'work', 'customers']],
  ['wave-1:a1-inventar', 'wave-1/a1-inventar.spec.ts', ['inventory', 'work']],
  ['wave-1:a2-stammdaten', 'wave-1/a2-stammdaten.spec.ts', ['customers', 'work']],
  ['wave-1:a2-anfragen', 'wave-1/a2-anfragen.spec.ts', ['customers', 'work', 'documents']],
  ['wave-1:a2-beziehungen', 'wave-1/a2-beziehungen.spec.ts', ['customers', 'attention', 'personnel']],
  ['wave-1:a3', 'wave-1/a3-personal.spec.ts', ['personnel', 'time', 'attention']],
  ['wave-1:a4', 'wave-1/a4-abwesenheit.spec.ts', ['personnel', 'time', 'planning', 'documents', 'attention']],
  ['wave-1:a5', 'wave-1/a5-aufgaben-qualifikationen.spec.ts', ['personnel', 'attention', 'time', 'planning']],
  ['wave-1:a6', 'wave-1/a6-planung.spec.ts', ['planning', 'work', 'personnel', 'time']],
  ['wave-1:a7', 'wave-1/a7-einsaetze.spec.ts', ['planning', 'work', 'personnel', 'attention', 'time']],
  ['wave-2:p1-13', 'wave-2/p1-13.spec.ts', ['work', 'inventory', 'personnel', 'customers']],
  ['wave-2:p1-14', 'wave-2/p1-14.spec.ts', ['work', 'planning', 'time', 'attention', 'inventory']],
  ['wave-2:p1-15', 'wave-2/p1-15.spec.ts', ['work', 'documents', 'personnel', 'attention', 'time']],
  [
    'wave-2:p1-16',
    'wave-2/p1-16.spec.ts',
    ['work', 'planning', 'time', 'documents', 'inventory', 'customers'],
  ],
  ['wave-2:p1-17', 'wave-2/p1-17.spec.ts', ['work', 'documents', 'personnel', 'customers']],
  ['wave-2:p1-18', 'wave-2/p1-18.spec.ts', ['service', 'customers', 'documents', 'work']],
  [
    'wave-2:p1-19',
    'wave-2/p1-19.spec.ts',
    ['service', 'work', 'planning', 'customers', 'documents', 'attention'],
  ],
  [
    'wave-2:p1-20',
    'wave-2/p1-20.spec.ts',
    ['service', 'work', 'planning', 'customers', 'documents', 'attention'],
  ],
  ['wave-2:p1-21', 'wave-2/p1-21.spec.ts', ['time', 'work', 'personnel', 'planning']],
  ['wave-2:p1-22', 'wave-2/p1-22.spec.ts', ['time', 'personnel', 'attention', 'work', 'planning']],
  ['wave-2:p1-23', 'wave-2/p1-23.spec.ts', ['time', 'personnel', 'documents']],
  ['wave-2:p1-24', 'wave-2/p1-24.spec.ts', ['personnel', 'documents', 'time', 'work', 'attention']],
  ['wave-3:p1-24a', 'wave-3/p1-24a.spec.ts', ['planning', 'time', 'personnel', 'work', 'attention']],
  ['layout', 'layout/mobile-viewport.spec.ts', ['*']],
  // Reference screenshots of every page family; release mode and explicit request only.
  ['visual', 'visual/references.spec.ts', ['*']],
  ['security:account', 'security/account.spec.ts', ['*']],
  ['list-pagination', 'pagination/list-pagination.spec.ts', ['inventory', 'documents', 'work']],
  // Measured navigation and view switches against the typical data profile (Step 2).
  [
    'performance:calendar',
    'performance/calendar.spec.ts',
    ['planning', 'time', 'customers', 'work', 'personnel'],
  ],
  ['performance:lists', 'performance/lists.spec.ts', ['customers', 'work', 'personnel']],
  ['performance:calendar-live', 'performance/calendar-live.spec.ts', ['planning', 'time', 'personnel']],
  ['performance:planning', 'performance/planning-benchmark.spec.ts', ['planning', 'work', 'personnel']],
  ['performance:field', 'performance/field.spec.ts', ['time', 'personnel', 'attention']],
];

// One row per SQL group: id, its assertion files under supabase/tests/, and its scopes.
const sqlDefinitions: readonly (readonly [string, readonly string[], readonly string[]])[] = [
  ['p1-13', ['p1_13_work_templates.sql'], ['work', 'inventory', 'personnel']],
  ['work-execution', ['work_execution_boundaries.sql'], ['work', 'time', 'documents', 'inventory']],
  ['p1-21', ['p1_21_time_segments.sql'], ['time', 'personnel', 'work']],
  ['p1-22', ['p1_22_time_corrections.sql'], ['time', 'personnel', 'work']],
  ['a1-time-history', ['a1_time_history.sql'], ['time', 'personnel']],
  ['p1-23', ['p1_23_time_accounts.sql'], ['time', 'personnel', 'work']],
  ['p1-24', ['p1_24_people_lifecycle.sql'], ['personnel', 'documents', 'time', 'work']],
  ['people', ['people_boundaries.sql'], ['personnel', 'attention', 'time']],
  ['join-requests', ['organization_join_requests.sql'], ['personnel', 'attention']],
  ['attention-read-writes', ['attention_read_writes.sql'], ['attention', 'personnel']],
  ['people-atomic-writes', ['people_atomic_writes.sql'], ['personnel']],
  ['qualification-history-writes', ['qualification_history_writes.sql'], ['personnel']],
  ['employee-capability-history-writes', ['employee_capability_history_writes.sql'], ['personnel']],
  ['personnel-history-writes', ['personnel_history_writes.sql'], ['personnel']],
  ['planning-options', ['planning_option_search.sql'], ['planning']],
  ['customer-relationships', ['customer_relationships.sql'], ['customers']],
  ['customer-atomic-writes', ['customer_atomic_writes.sql'], ['customers']],
  ['request-history-writes', ['request_history_writes.sql'], ['customers']],
  ['sickness-report-writes', ['sickness_report_writes.sql'], ['personnel']],
  ['vacation-history-writes', ['vacation_history_writes.sql'], ['personnel']],
  ['planning', ['planning_occurrences.sql', 'planning_dispatch.sql'], ['planning', 'work']],
  ['service', ['service_boundaries.sql'], ['service', 'customers', 'work']],
  ['service-atomic-writes', ['service_atomic_writes.sql'], ['service', 'planning']],
  ['inventory-ledger', ['inventory_ledger.sql', 'inventory_atomic_writes.sql'], ['inventory']],
  ['closed-period-writes', ['closed_period_writes.sql'], ['time']],
  ['entry-change-request-decisions', ['entry_change_request_decisions.sql'], ['time']],
  ['document-writes', ['document_writes.sql'], ['documents', 'work']],
  ['payroll-export-recovery', ['payroll_export_recovery.sql'], ['time']],
  ['time-settings-atomic-writes', ['time_settings_atomic_writes.sql'], ['time']],
  ['work-atomic-writes', ['work_atomic_writes.sql'], ['work']],
  ['work-creation-writes', ['work_creation_writes.sql'], ['work', 'customers', 'documents', 'service']],
  ['unpark-into-schedule', ['unpark_into_schedule.sql'], ['work', 'planning']],
  ['job-plan-bridge', ['job_plan_bridge.sql'], ['work', 'planning']],
  ['rate-limits', ['rate_limits.sql'], ['*']],
  ['record-numbers', ['record_numbers.sql'], ['work', 'customers', 'personnel', 'service']],
  [
    'list-pagination',
    [
      'operational_list_pages.sql',
      'inventory_pagination.sql',
      'service_list_pages.sql',
      'maintenance_list_pages.sql',
      'time_correction_history_pages.sql',
      'record_number_options.sql',
    ],
    ['customers', 'work', 'documents', 'inventory', 'service', 'time'],
  ],
  [
    'security',
    [
      'security_boundaries.sql',
      'email_change_boundaries.sql',
      'event_ledger_boundaries.sql',
      'realtime_deletions.sql',
    ],
    ['*'],
  ],
];

/** Measured performance specs judge their deadlines in release mode and on explicit request only. */
export function isPerformanceSpec(file: string): boolean {
  return file.startsWith('tests/audit/performance/');
}

/** Performance and visual reference specs run in release mode and on explicit request only. */
export function isReleaseOnlySpec(file: string): boolean {
  return isPerformanceSpec(file) || file.startsWith('tests/audit/visual/');
}

export function listTestFiles(repositoryRoot: string, directory: string, pattern: RegExp): string[] {
  const result: string[] = [];
  function visit(relative: string): void {
    for (const entry of readdirSync(join(repositoryRoot, relative), { withFileTypes: true })) {
      if (entry.name.startsWith('.')) continue;
      const path = `${relative}/${entry.name}`;
      if (entry.isDirectory()) visit(path);
      else if (pattern.test(entry.name)) result.push(path);
    }
  }
  visit(directory);
  return result.sort();
}

export function getTestGroups(repositoryRoot: string): TestGroup[] {
  const groups: TestGroup[] = auditDefinitions.map(([id, file, scopes]) => ({
    id: `audit:${id}`,
    kind: 'audit',
    files: [`tests/audit/${file}`],
    scopes,
    isolation: 'group-world',
    timing: declaredTiming([`tests/audit/${file}`]),
  }));
  groups.push(
    {
      id: 'ui:contracts',
      kind: 'ui',
      files: listTestFiles(repositoryRoot, 'tests/ui-contracts', /\.spec\.ts$/),
      scopes: ['*'],
      isolation: 'process',
      timing: untimed,
    },
    {
      id: 'unit:all',
      kind: 'unit',
      files: listTestFiles(repositoryRoot, 'lib', /\.test\.(?:ts|tsx|mjs)$/),
      scopes: ['*'],
      isolation: 'process',
      timing: untimed,
    },
    {
      id: 'canary:providers',
      kind: 'canary',
      files: ['tests/canary/canary.spec.ts'],
      scopes: ['*'],
      isolation: 'cloud-world',
      timing: declaredTiming(['tests/canary/canary.spec.ts']),
    },
    {
      id: 'canary:security',
      kind: 'canary',
      files: ['tests/canary/security-boundaries.spec.ts'],
      scopes: ['*'],
      isolation: 'cloud-world',
      timing: { ...untimed, exclusive: true },
    },
  );
  const goldenFiles = listTestFiles(repositoryRoot, 'tests/golden', /\.spec\.ts$/);
  for (const file of goldenFiles) {
    const basename = (file.split('/').at(-1) ?? file).replace('.spec.ts', '');
    // A golden slice shares the scopes of its audit definition, whichever wave registered it.
    const sliceScopes = auditDefinitions.find(([id]) => id.endsWith(`:${basename}`))?.[2];
    const earlyScopes: Readonly<Record<string, readonly string[]>> = {
      'gg-01': ['customers', 'work', 'documents'],
      'p1-01': ['customers', 'work'],
      'p1-03': ['personnel'],
      'p1-04': ['personnel', 'time'],
      'p1-05': ['personnel', 'attention'],
      'p1-06': ['personnel', 'time', 'planning'],
      'p1-07': ['attention', 'personnel', 'time'],
      'p1-08': ['personnel', 'documents', 'time'],
      'p1-09': ['personnel', 'planning'],
      'p1-10': ['customers', 'attention', 'documents'],
      'p1-11': ['planning', 'work'],
      'p1-12': ['planning', 'work', 'attention'],
    };
    groups.push({
      id: `golden:${basename}`,
      kind: 'golden',
      files: [file],
      scopes: sliceScopes ?? earlyScopes[basename] ?? ['*'],
      isolation: 'group-world',
      timing: declaredTiming([file]),
    });
  }
  for (const [id, files, scopes] of sqlDefinitions) {
    groups.push({
      id: `sql:${id}`,
      kind: 'sql',
      files: files.map((file) => `supabase/tests/${file}`),
      scopes,
      isolation: 'database-transaction',
      timing: untimed,
    });
  }
  groups.push({
    id: 'static:dependencies',
    kind: 'static',
    files: [
      'scripts/check-dependency-security.ts',
      'lib/security/dependency-exceptions.json',
      'bun.lock',
      'package.json',
    ],
    scopes: ['*'],
    isolation: 'process',
    timing: untimed,
    script: 'security:dependencies',
  });
  for (const [id, file, script] of [
    ['typecheck', 'tsconfig.json', 'typecheck'],
    ['lint', 'eslint.config.mjs', 'lint'],
    ['docs', 'scripts/check-docs.ts', 'docs:check'],
    ['coverage', 'scripts/check-test-coverage.ts', 'test:coverage'],
    ['unused', 'knip.jsonc', 'unused:check'],
    ['format', '.prettierrc.json', 'format:check'],
  ] as const) {
    groups.push({
      id: `static:${id}`,
      kind: 'static',
      files: [file],
      scopes: ['*'],
      isolation: 'process',
      timing: untimed,
      script,
    });
  }
  return groups;
}

/** Metadata pins required evidence; AST inspection also catches direct new timing calls. */
export function getGroupTimingRequirements(
  group: TestGroup,
  repositoryRoot: string,
): GroupTimingRequirements {
  if (!['golden', 'audit', 'canary'].includes(group.kind)) return group.timing;
  const files = group.files;
  const declared = declaredTiming(files);
  let requireFreshness = group.timing.requireFreshness || declared.requireFreshness;
  let requireReadiness = group.timing.requireReadiness || declared.requireReadiness;
  const requiredScenarios = [
    ...(group.timing.requiredScenarios ?? []),
    ...(declared.requiredScenarios ?? []),
  ];
  for (const file of files) {
    const source = ts.createSourceFile(
      file,
      readFileSync(join(repositoryRoot, file), 'utf8'),
      ts.ScriptTarget.Latest,
      true,
    );
    const sourceTiming = readSourceTiming(source);
    requireFreshness ||= sourceTiming.requireFreshness;
    requireReadiness ||= sourceTiming.requireReadiness;
    // A scenario call in source must be registered for this file, and a
    // registration must still have its call: neither can drift silently.
    const registered = new Set(scenariosForFiles([file]).map((scenario) => scenario.id));
    for (const id of sourceTiming.scenarioIds) {
      if (!registered.has(id))
        throw new Error(
          `${file} measures unregistered scenario ${id}. Register it in lib/testing/measured-scenarios.ts before running.`,
        );
    }
    for (const id of registered) {
      if (!sourceTiming.scenarioIds.has(id))
        throw new Error(
          `Registered scenario ${id} is no longer measured in ${file}. Reconcile the registry before running.`,
        );
    }
    const readinessSource = readinessSources[file];
    if (readinessSource && readinessSource !== file) {
      const imports = source.statements.filter(ts.isImportDeclaration).flatMap((declaration) => {
        if (!ts.isStringLiteral(declaration.moduleSpecifier)) return [];
        const specifier = declaration.moduleSpecifier.text;
        if (!specifier.startsWith('.')) return [];
        return [posix.normalize(`${dirname(file).replaceAll('\\', '/')}/${specifier}`).replace(/\.js$/, '')];
      });
      if (!imports.includes(readinessSource.replace(/\.ts$/, '')))
        throw new Error(
          `Readiness owner ${file} no longer imports ${readinessSource}. Reconcile the timing registry before running.`,
        );
      const helper = ts.createSourceFile(
        readinessSource,
        readFileSync(join(repositoryRoot, readinessSource), 'utf8'),
        ts.ScriptTarget.Latest,
        true,
      );
      if (!readSourceTiming(helper).requireReadiness)
        throw new Error(`Required opening-readiness measurement is missing from ${readinessSource}.`);
    }
  }
  return {
    requireFreshness,
    requireReadiness,
    requiredScenarios: [...new Set(requiredScenarios)],
    exclusive: group.timing.exclusive || requireFreshness || requireReadiness || requiredScenarios.length > 0,
  };
}

const SCENARIO_HELPERS = new Set(['expectUsableWithin', 'expectScenarioLiveWithin']);

function readSourceTiming(
  source: ts.SourceFile,
): Pick<GroupTimingRequirements, 'requireFreshness' | 'requireReadiness'> & { scenarioIds: Set<string> } {
  const freshnessNames = new Set<string>();
  const readinessNames = new Set<string>();
  const scenarioNames = new Set<string>();
  const namespaces = new Set<string>();
  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement)) continue;
    const bindings = statement.importClause?.namedBindings;
    if (bindings && ts.isNamespaceImport(bindings)) namespaces.add(bindings.name.text);
    if (!bindings || !ts.isNamedImports(bindings)) continue;
    for (const element of bindings.elements) {
      const imported = (element.propertyName ?? element.name).text;
      if (imported === 'expectLiveWithin') freshnessNames.add(element.name.text);
      if (imported === 'expectReadyWithin') readinessNames.add(element.name.text);
      if (SCENARIO_HELPERS.has(imported)) scenarioNames.add(element.name.text);
    }
  }
  let requireFreshness = false;
  let requireReadiness = false;
  const scenarioIds = new Set<string>();
  function visit(node: ts.Node): void {
    if (ts.isCallExpression(node)) {
      const title = node.arguments[0];
      const namespaceMember =
        ts.isPropertyAccessExpression(node.expression) &&
        ts.isIdentifier(node.expression.expression) &&
        namespaces.has(node.expression.expression.text)
          ? node.expression.name.text
          : undefined;
      if (title && ts.isStringLiteralLike(title) && /@FRESHNESS\b/.test(title.text)) requireFreshness = true;
      if (
        (ts.isIdentifier(node.expression) && freshnessNames.has(node.expression.text)) ||
        namespaceMember === 'expectLiveWithin'
      )
        requireFreshness = true;
      if (
        (ts.isIdentifier(node.expression) && readinessNames.has(node.expression.text)) ||
        namespaceMember === 'expectReadyWithin'
      )
        requireReadiness = true;
      if (
        (ts.isIdentifier(node.expression) && scenarioNames.has(node.expression.text)) ||
        (namespaceMember !== undefined && SCENARIO_HELPERS.has(namespaceMember))
      ) {
        // The scenario id must be a literal so the registry check stays static.
        if (!title || !ts.isStringLiteralLike(title))
          throw new Error(`${source.fileName}: a measured scenario id must be a string literal.`);
        scenarioIds.add(title.text);
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  return { requireFreshness, requireReadiness, scenarioIds };
}

export function validateTestGroupInventory(
  groups: readonly TestGroup[],
  discoveredFiles: readonly string[],
): string[] {
  const problems: string[] = [];
  const ids = new Set<string>();
  const owners = new Map<string, string>();
  for (const group of groups) {
    if (ids.has(group.id)) problems.push(`Duplicate test group: ${group.id}`);
    ids.add(group.id);
    if (!group.files.length || !group.scopes.length) problems.push(`Empty files or scopes: ${group.id}`);
    for (const file of group.files) {
      const owner = owners.get(file);
      if (owner) problems.push(`Test file has two owners: ${file} (${owner}, ${group.id})`);
      owners.set(file, group.id);
    }
  }
  for (const file of discoveredFiles) if (!owners.has(file)) problems.push(`Unregistered test file: ${file}`);
  return problems;
}

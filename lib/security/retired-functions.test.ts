import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { listProductSources, repositoryRoot } from '../conventions/product-sources';

// Tier 2 for retired database functions. Every public function in the
// generated types (which `types:check` keeps equal to DEV) is reached by code:
//   1. product source or an edge function names it as a string literal (an
//      `.rpc('name'` call, or a literal union that a dynamic `.rpc` takes), or
//   2. SQL_CALLERS names the database function or the policies that call it,
//      and the caller's latest committed definition contains the name, or
//   3. KEPT_FOR_DEPLOYED_BUILD names the release that may drop it.
// An uncalled function is executable surface without an owner: drop it in a
// migration with a `@destructive` marker once the deployed build no longer
// calls it (docs/technical/environments.md#the-migration-rule, item 8).
// A function that a committed migration drops counts as gone before DEV and
// the types catch up.

/**
 * Function -> its SQL caller: a public function, an `app_private.` function
 * (listed here in turn with its own caller), or 'RLS policies'.
 */
const SQL_CALLERS: Readonly<Record<string, string>> = {
  acknowledge_personnel_item_review_base: 'acknowledge_personnel_item',
  apply_work_template_unserialized: 'apply_work_template',
  close_time_period_p1_23_base: 'close_time_period',
  close_time_session_for_member_removal: 'remove_member_with_time_capture',
  create_maintenance_plan: 'create_maintenance_plan_with_due_work',
  create_payroll_mapping_version_p1_23_base: 'create_payroll_mapping_version',
  fail_payroll_export_p1_23_base: 'fail_payroll_export',
  finalize_personnel_document_metadata_base: 'finalize_personnel_document_metadata',
  finalize_work_artifact_export: 'export_work_artifact',
  'app_private.generate_due_work_for_active_plan': 'create_maintenance_plan_with_due_work',
  generate_maintenance_due_work: 'app_private.generate_due_work_for_active_plan',
  get_user_admin_or_manager_org_ids: 'RLS policies',
  get_user_org_ids: 'RLS policies',
  link_maintenance_due_visit: 'create_maintenance_visit_job',
  prepare_time_period_p1_23_base: 'prepare_time_period',
  publish_personnel_onboarding_template_base: 'publish_personnel_onboarding_template',
  record_work_artifact_action_p1_17_inner: 'record_work_artifact_action',
  release_work_handover_p1_17_inner: 'release_work_handover',
  reopen_time_period_p1_23_base: 'reopen_time_period',
  return_work_handover_for_correction_p1_17_inner: 'return_work_handover_for_correction',
  revise_maintenance_plan: 'revise_maintenance_plan_with_due_work',
  save_work_handover_draft_p1_17_inner: 'save_work_handover_draft',
  set_maintenance_due_occurrence: 'schedule_maintenance_visit',
  set_personnel_access_transition_p1_24_base: 'set_personnel_access_transition_review_base',
  set_personnel_access_transition_review_base: 'set_personnel_access_transition',
  transition_maintenance_plan: 'transition_maintenance_plan_with_due_work',
  transition_work_execution_p1_15: 'transition_work_execution',
  unlink_installed_equipment_document: 'update_document_links',
  unlink_maintenance_coverage_document: 'update_document_links',
  unlink_service_case_document: 'update_document_links',
  withdraw_work_handover_p1_17_inner: 'withdraw_work_handover',
};

/** Function -> why it stays although the current build does not call it. */
const KEPT_FOR_DEPLOYED_BUILD: Readonly<Record<string, string>> = {
  renew_employee_capability:
    'the deployed production build still calls it; drop it in the first migration after the next production release',
};

const migrationsDirectory = join(repositoryRoot, 'supabase/migrations');
const migrations = readdirSync(migrationsDirectory)
  .filter((file) => file.endsWith('.sql'))
  .sort()
  .map((file) => readFileSync(join(migrationsDirectory, file), 'utf8').replace(/--[^\n]*/g, ''));

function publicFunctionNames(): string[] {
  const types = readFileSync(join(repositoryRoot, 'lib/supabase/database.types.ts'), 'utf8');
  const publicSchema = types.slice(types.indexOf('\n  public: {'));
  const block = publicSchema.slice(
    publicSchema.indexOf('\n    Functions: {'),
    publicSchema.indexOf('\n    Enums: {'),
  );
  return [...block.matchAll(/^ {6}([a-z_0-9]+):/gm)].flatMap((match) => (match[1] ? [match[1]] : []));
}

/** Names whose last create or drop statement in the committed migrations is a drop. */
function droppedByMigration(): Set<string> {
  const dropped = new Set<string>();
  const event =
    /\b(create\s+(?:or\s+replace\s+)?function|drop\s+function(?:\s+if\s+exists)?)\s+public\.([a-z_0-9]+)\s*\(/gi;
  for (const sql of migrations) {
    for (const match of sql.matchAll(event)) {
      const [, verb = '', name = ''] = match;
      if (verb.toLowerCase().startsWith('drop')) dropped.add(name);
      else dropped.delete(name);
    }
  }
  return dropped;
}

/** Every snake_case string literal in product source and the edge functions. */
function literalsInCode(): Set<string> {
  const edgeFunctions = join(repositoryRoot, 'supabase/functions');
  const edgeSources = readdirSync(edgeFunctions, { recursive: true, encoding: 'utf8' })
    .filter((file) => file.endsWith('.ts'))
    .map((file) => readFileSync(join(edgeFunctions, file), 'utf8'));
  const productSources = listProductSources().map((file) => readFileSync(join(repositoryRoot, file), 'utf8'));
  const literals = new Set<string>();
  for (const source of [...productSources, ...edgeSources]) {
    for (const match of source.matchAll(/['"`]([a-z_0-9]+)['"`]/g)) if (match[1]) literals.add(match[1]);
  }
  return literals;
}

const isPrivate = (name: string): boolean => name.startsWith('app_private.');
const unqualified = (name: string): string => name.replace(/^app_private\./, '');

/** The latest committed statement that creates `name` (public unless qualified), or '' when none does. */
function latestDefinition(name: string): string {
  const schema = isPrivate(name) ? 'app_private' : 'public';
  const start = new RegExp(
    `create\\s+(?:or\\s+replace\\s+)?function\\s+${schema}\\.${unqualified(name)}\\s*\\(`,
    'gi',
  );
  for (const sql of [...migrations].reverse()) {
    const matches = [...sql.matchAll(start)];
    const last = matches.at(-1);
    if (!last) continue;
    const body = sql.slice(last.index);
    const tag = /\$[A-Za-z_]*\$/.exec(body);
    if (!tag) return body;
    const close = body.indexOf(tag[0], tag.index + tag[0].length);
    return body.slice(0, close < 0 ? undefined : close);
  }
  return '';
}

const policyStatements = migrations.flatMap((sql) => sql.match(/create\s+policy[^;]*;/gi) ?? []).join('\n');

function referencedByPolicy(name: string): boolean {
  return new RegExp(`\\b${name}\\s*\\(`).test(policyStatements);
}

describe('retired database functions', () => {
  const dropped = droppedByMigration();
  const functions = publicFunctionNames().filter((name) => !dropped.has(name));
  const literals = literalsInCode();
  const calledByCode = (name: string): boolean => literals.has(name);

  test('the generated types list the public functions', () => {
    expect(functions.length).toBeGreaterThan(100);
    expect(functions).toContain('get_user_org_ids');
  });

  test('every public function has a caller in code, in SQL, or a named reason to stay', () => {
    const uncalled = functions.filter(
      (name) => !calledByCode(name) && !(name in SQL_CALLERS) && !(name in KEPT_FOR_DEPLOYED_BUILD),
    );
    expect(
      uncalled,
      'Drop each function in a migration with a @destructive marker once the deployed build no longer calls it, or name its SQL caller in SQL_CALLERS',
    ).toEqual([]);
  });

  test('every SQL caller entry is reached from code through a committed definition', () => {
    const reached = (name: string, seen: ReadonlySet<string>): boolean => {
      if (calledByCode(name)) return true;
      const caller = SQL_CALLERS[name];
      if (!caller || seen.has(name)) return false;
      if (caller === 'RLS policies') return referencedByPolicy(name);
      return (
        (isPrivate(caller) || functions.includes(caller)) &&
        new RegExp(`\\b${unqualified(name)}\\s*\\(`).test(latestDefinition(caller)) &&
        reached(caller, new Set([...seen, name]))
      );
    };
    const broken = Object.entries(SQL_CALLERS)
      .filter(
        ([name]) =>
          !(isPrivate(name) ? latestDefinition(name) : functions.includes(name)) ||
          calledByCode(name) ||
          !reached(name, new Set()),
      )
      .map(([name, caller]) => `${name} <- ${caller}`);
    expect(
      broken,
      'Remove or correct each entry: the function is gone, called by code, or its caller no longer calls it',
    ).toEqual([]);
  });

  test('every kept function still exists and is still uncalled by the current build', () => {
    const stale = Object.keys(KEPT_FOR_DEPLOYED_BUILD).filter(
      (name) => !functions.includes(name) || calledByCode(name),
    );
    expect(stale, 'Remove the entry: the function is gone or the current build calls it again').toEqual([]);
  });
});

// Rule test: an SQL test's assertion fails on NULL and counts only its own organizations' rows.
import { expect, test } from 'bun:test';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { repositoryRoot } from './product-sources';
import { organizationTables } from './query-chains';
import { sqlAssertionFindings } from './sql-test-assertions-scan';

// Tier 2 for two ways an SQL assertion passes for the wrong reason (testing.md,
// "Choose the boundary for a rule"; werk-flow/werkflow-planning#438).
// 1. `if a <> b then raise` raises nothing when a or b is NULL: a missing key,
//    row or field passes the check. Compare with `is distinct from` unless
//    both sides can never be NULL (a literal, `sqlerrm`, a scalar
//    `select count(*)`, `exists (…)`, a `coalesce` with such an argument).
// 2. Every worktree shares the local stack, and browser worlds commit rows in
//    other organizations. A `count(*)` or `exists (select …)` over a table with
//    an `organization_id` column filters by the organization, a fixture id or
//    an id column in an `=`, `in`, `like` or `is not distinct from`, or
//    inner-joins the test's own temporary rows on a column. A read under the
//    `authenticated` or `anon` role is exempt: there it proves a policy, and a
//    filter would hide a leak.
// The scan cannot see a nullable `<`, `>` or `not`, or an id filter on a
// non-fixture value; review owns those.
const testsDirectory = resolve(repositoryRoot, 'supabase/tests');
const tenantTables = organizationTables();

// werk-flow/werkflow-app#406 adds these tables; its finding below needs them before it merges.
const fixtureTables = new Set([
  ...tenantTables,
  'company_document_profiles',
  'company_document_profile_events',
]);

const findings = (sql: string) =>
  sqlAssertionFindings(sql, fixtureTables).map(({ line, rule, code }) => ({ line, rule, code }));

const assertion = (condition: string) =>
  `do $$ begin\n  if ${condition} then raise exception 'x'; end if;\nend $$;`;

test('the scan flags the flagged code of each real NULL finding and passes its fix', () => {
  // werk-flow/werkflow-app#395, supabase/tests/work_billing_parties.sql
  expect(findings(assertion("(app_private.current_work_billing_parties('7')).source <> 'anfrage'"))).toEqual([
    {
      line: 2,
      rule: 'null-safe',
      code: "(app_private.current_work_billing_parties('7')).source <> 'anfrage'",
    },
  ]);
  expect(
    findings(
      assertion("(app_private.current_work_billing_parties('1', '7')).source is distinct from 'anfrage'"),
    ),
  ).toEqual([]);
  // werk-flow/werkflow-app#410, supabase/tests/leistung_prices.sql
  expect(
    findings(assertion("(v_page ->> 'total')::integer <> 2 or not (v_page ->> 'hasAny')::boolean")),
  ).toEqual([{ line: 2, rule: 'null-safe', code: "(v_page ->> 'total')::integer <> 2" }]);
  expect(
    findings(
      assertion(
        "(v_page ->> 'total')::integer is distinct from 2 or (v_page ->> 'hasAny')::boolean is distinct from true",
      ),
    ),
  ).toEqual([]);
  // werk-flow/werkflow-app#422, supabase/tests/work_leads.sql
  const scope = (operator: string) =>
    assertion(
      `(select array_agg(id::uuid order by id) from jsonb_array_elements_text(
        public.read_work_lead_scope(v_org, v_lead)->'projectIds') id) ${operator} array[v_project_a]`,
    );
  expect(findings(scope('<>')).map(({ rule, line }) => ({ rule, line }))).toEqual([
    { rule: 'null-safe', line: 3 },
  ]);
  expect(findings(scope('is distinct from'))).toEqual([]);
});

test('a count is never NULL only as a bare scalar count, and coalesce with any literal is never NULL', () => {
  expect(
    findings(
      [
        assertion('(select count(*) + v_extra from public.jobs where id = v_job) <> 1'),
        assertion('(select count(*) from public.jobs where id = v_job having false) <> 1'),
        assertion('coalesce(v_total, 0, v_other) <> 1'),
        assertion("(select count(*) filter (where status = 'offen') from public.jobs where id = v_job) <> 1"),
        // LIMIT 0 and OFFSET 1 remove the count's one row, so the subquery is NULL.
        assertion('(select count(*) from public.jobs where id = v_job limit 0) <> 1'),
        assertion('(select count(*) from public.jobs where id = v_job offset 1) <> 1'),
        // A row comparison is NULL when a field is.
        assertion('row(null::integer) <> row(1)'),
      ].join('\n'),
    ).map(({ line, rule }) => ({ line, rule })),
  ).toEqual([
    { line: 2, rule: 'null-safe' },
    { line: 5, rule: 'null-safe' },
    { line: 14, rule: 'null-safe' },
    { line: 17, rule: 'null-safe' },
    { line: 20, rule: 'null-safe' },
  ]);
});

test('only a restricting filter or an inner join with own rows scopes a read', () => {
  expect(
    findings(
      [
        assertion('(select count(organization_id) from public.jobs) <> 0'),
        assertion(
          'exists (select 1 from public.jobs where status in (select status from public.jobs where id = v_job))',
        ),
        assertion('exists (select 1 from public.jobs cross join generate_series(1, 2))'),
        "select 'set role authenticated';",
        assertion('exists (select 1 from public.jobs)'),
        "do $$ begin execute 'reset role'; end $$;",
        // An organization token scopes only in a restricting comparison.
        assertion('exists (select 1 from public.jobs where organization_id <> v_org)'),
        assertion('exists (select 1 from public.jobs where status = v_state and v_org is not null)'),
        assertion('exists (select 1 from public.jobs where organization_id is not distinct from v_org)'),
        // A join `on true` is a cross join: it restricts nothing.
        assertion('exists (select 1 from public.jobs job join pg_temp.ids fixture on true)'),
      ].join('\n'),
    ).map(({ line, rule }) => ({ line, rule })),
  ).toEqual([
    { line: 2, rule: 'org-scope' },
    { line: 5, rule: 'org-scope' },
    { line: 8, rule: 'org-scope' },
    { line: 12, rule: 'org-scope' },
    { line: 16, rule: 'org-scope' },
    { line: 19, rule: 'org-scope' },
    { line: 25, rule: 'org-scope' },
  ]);
});

test('the scan reads an operator without spaces whole, as PostgreSQL does', () => {
  expect(findings(assertion("result#>>'{options,0,name}'<>'Artikel' or v_total<>-1"))).toEqual([
    { line: 2, rule: 'null-safe', code: "result#>>'{options,0,name}'<>'Artikel'" },
    { line: 2, rule: 'null-safe', code: 'v_total<>-1' },
  ]);
});

test('the scan flags the flagged code of each real scope finding and passes its fix', () => {
  // werk-flow/werkflow-app#370, supabase/tests/client_site_roles.sql
  expect(
    findings(
      assertion(`(select count(*) from public.client_master_events
      where event_type = 'role_started' and event_payload ->> 'role' = 'eigentuemer') <> 1`),
    ),
  ).toEqual([{ line: 2, rule: 'org-scope', code: 'select count(*) from public.client_master_events' }]);
  expect(
    findings(
      assertion(`(select count(*) from public.client_master_events
      where organization_id = '45000000-0000-0000-0000-000000000010'
        and event_type = 'role_started' and event_payload ->> 'role' = 'eigentuemer') <> 1`),
    ),
  ).toEqual([]);
  // werk-flow/werkflow-app#379, supabase/tests/work_artifact_draft_attach.sql
  expect(findings(assertion('exists (select 1 from public.work_artifact_draft_operations)'))).toEqual([
    { line: 2, rule: 'org-scope', code: 'select 1 from public.work_artifact_draft_operations' },
  ]);
  expect(
    findings(
      assertion('exists (select 1 from public.work_artifact_draft_operations where organization_id = v_org)'),
    ),
  ).toEqual([]);
  // werk-flow/werkflow-app#406, supabase/tests/company_document_profiles.sql
  expect(
    findings(
      assertion(
        'exists (select 1 from public.company_document_profiles)\n    or exists (select 1 from public.company_document_profile_events)',
      ),
    ).map(({ rule, line }) => ({ rule, line })),
  ).toEqual([
    { rule: 'org-scope', line: 2 },
    { rule: 'org-scope', line: 3 },
  ]);
  expect(
    findings(
      assertion(
        'exists (select 1 from public.company_document_profiles where organization_id in (v_org, v_foreign))',
      ),
    ),
  ).toEqual([]);
  // werk-flow/werkflow-app#410, supabase/tests/leistung_prices.sql
  expect(
    findings(
      assertion(
        'not exists (select 1 from public.leistung_price_versions where sale_price_cents = 7100 and cost_rate_cents = 4500)',
      ),
    ),
  ).toEqual([{ line: 2, rule: 'org-scope', code: 'select 1 from public.leistung_price_versions' }]);
  expect(
    findings(
      assertion(`not exists (select 1 from public.leistung_price_versions
      where organization_id = '47000000-0000-0000-0000-000000000010' and leistung_id = (select montage from ids)
        and sale_price_cents = 7100 and cost_rate_cents = 4500)`),
    ),
  ).toEqual([]);
});

test('the scan spares operands that are never NULL and comparisons inside a subquery', () => {
  expect(
    findings(
      [
        "do $$ begin exception when others then if sqlerrm <> 'not_authorized' then raise; end if; end $$;",
        assertion('(select count(*) from public.jobs where organization_id = v_org) <> 2'),
        assertion('2 <> (select count(*)::int from public.jobs where id = v_job)'),
        assertion(
          "coalesce(v_total, 0) <> 3 and exists (select 1 from public.jobs where status <> 'offen' and id = v_job)",
        ),
        // Only a raise makes a condition an assertion.
        "do $$ begin if v_state <> 'offen' then v_count := 1; end if; end $$;",
      ].join('\n'),
    ),
  ).toEqual([]);
  expect(findings(assertion('(select count(*) from public.jobs group by status) <> 2'))).toEqual([
    { line: 2, rule: 'null-safe', code: '(select count(*) from public.jobs group by status) <> 2' },
    { line: 2, rule: 'org-scope', code: 'select count(*) from public.jobs' },
  ]);
});

test('the scope rule spares reads under a client role, fixture literals and joins with own rows', () => {
  expect(
    findings(
      [
        'set local role authenticated;',
        assertion('exists (select 1 from public.jobs)'),
        "do $$ begin execute 'reset role'; end $$;",
        assertion(
          "exists (select 1 from public.storage_purge_queue where storage_path like '28700000-0000-0000-0000-000000000010/%')",
        ),
        assertion(
          'exists (select 1 from public.storage_purge_queue queued join resized_parts part on part.archive_path = queued.storage_path)',
        ),
        assertion(
          'exists (select 1 from resized_parts part join public.storage_purge_queue queued on part.archive_path = queued.storage_path)',
        ),
        assertion('exists (select 1 from public.jobs)'),
      ].join('\n'),
    ),
  ).toEqual([{ line: 16, rule: 'org-scope', code: 'select 1 from public.jobs' }]);
});

test('every SQL test asserts NULL-safely over its own organizations', () => {
  const breaches = readdirSync(testsDirectory)
    .filter((name) => name.endsWith('.sql'))
    .flatMap((name) =>
      sqlAssertionFindings(readFileSync(resolve(testsDirectory, name), 'utf8'), tenantTables).map(
        ({ line, rule, code }) => `supabase/tests/${name}:${line} ${rule}: ${code}`,
      ),
    );
  expect(
    breaches,
    'null-safe: compare with `is distinct from`. org-scope: filter the read by organization_id or a fixture id.',
  ).toEqual([]);
});

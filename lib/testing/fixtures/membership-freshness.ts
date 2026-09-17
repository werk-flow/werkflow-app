import assert from 'node:assert/strict';
import { mock } from 'bun:test';
import type { ReadonlyRequestCookies } from 'next/dist/server/web/spec-extension/adapters/request-cookies';

mock.module('server-only', () => ({}));
// Model persistent framework caching so restoring it makes this check fail.
const persistent = new Map<string, Promise<unknown>>();
mock.module('next/cache', () => ({ unstable_cache: <Arguments extends string[], Result>(read: (...args: Arguments) => Promise<Result>, keys: string[]) => (...args: Arguments): Promise<unknown> => {
  const key = JSON.stringify([keys, args]);
  const pending = persistent.get(key) ?? read(...args);
  persistent.set(key, pending);
  return pending;
} }));
let authenticated = true;
mock.module('next/headers', () => ({ cookies: async () => ({ get: () => ({ value: 'new' }) }) }));
mock.module('@/lib/supabase/server', () => ({ createSupabaseServerClient: () => ({ auth: {
  getUser: async () => ({ data: { user: authenticated ? { id: 'caller' } : null }, error: null }),
} }) }));
mock.module('@/lib/profile-avatar', () => ({ getProfileAvatarUrl: () => null }));
mock.module('@/lib/personnel/calendar-reader', () => ({ readOrganizationCalendar: () => { throw new Error('Unexpected calendar read'); } }));

let organizations = ['old'];
let role = 'admin';
let state = 'active';
let failed = false;
let queryCount = 0;
let wrongUser = false;
let wrongOrganization = false;
let blocked = false;
let scheduled = false;
mock.module('@/lib/supabase/admin', () => ({ createSupabaseAdminClient: () => ({ from: (table: string) => {
  assert.equal(table, 'organization_members');
  const filters: unknown[][] = [];
  const query = {
    select: (selection: string) => {
      assert.ok(selection.includes('personnel_access_lifecycles!personnel_access_lifecycles_employee_org_fkey'));
      assert.ok(selection.includes('personnel_onboarding_requirements!personnel_onboarding_requirements_employee_org_fkey'));
      return query;
    },
    eq: (...args: unknown[]) => { filters.push(args); return query; },
    not: (...args: unknown[]) => { filters.push(args); return query; },
    limit: (count: number, options: { referencedTable: string }) => {
      assert.equal(count, 1);
      assert.equal(options.referencedTable, 'organizations.employee_records.personnel_onboarding_requirements');
      return query;
    },
    then: (resolve: (result: { data: unknown[]; error: Error | null }) => void) => {
      queryCount++;
      assert.deepEqual(filters, [
        ['user_id', 'caller'], ['organizations.employee_records.user_id', 'caller'],
        ['organizations.employee_records.personnel_onboarding_requirements.blocks_access', true],
        ['organizations.employee_records.personnel_onboarding_requirements.state', 'in', '(fulfilled,waived,cancelled)'],
      ]);
      const data = organizations.map((id) => ({
        organization_id: id, role, joined_at: '2026-01-01',
        organizations: { id: wrongOrganization ? 'foreign' : id, name: id, unique_code: id, employee_records: [{
          id: `employee-${id}`, user_id: wrongUser ? 'foreign' : 'caller',
          personnel_access_lifecycles: [{ state, scheduled_state: scheduled ? 'active' : null, scheduled_for: scheduled ? '2020-01-01T00:00:00Z' : null }],
          personnel_onboarding_requirements: blocked ? [{ id: 'blocker' }] : [],
        }] },
      }));
      resolve({ data, error: failed ? new Error('Synthetic membership failure') : null });
    },
  };
  return query;
} }) }));

const { withReadRequest } = await import('@/lib/data/read-request-cache');
const { getCachedMemberships } = await import('@/lib/data/cached');
const { resolveActiveOrgId } = await import('@/lib/org/cookies');
const freshRead = <Result>(read: () => Promise<Result>): Promise<Result> => withReadRequest(new Request('https://fixture.invalid/read'), read);
await freshRead(async () => {
  const results = await Promise.all(Array.from({ length: 4 }, () => getCachedMemberships('caller')));
  assert.equal(queryCount, 1, 'Parallel consumers share one joined membership/lifecycle read within a GET');
  assert.ok(results.every((result) => result === results[0]));
});
organizations = ['old', 'new'];
// Only get() is consumed; use the real resolver with a narrow cookie boundary.
const cookies = { get: () => ({ name: 'current_org_id', value: 'new' }) } as ReadonlyRequestCookies;
assert.equal(await freshRead(() => resolveActiveOrgId(cookies, 'caller')), 'new', 'A newly created membership must not fall back and overwrite its cookie');
role = 'employee';
assert.equal((await freshRead(() => getCachedMemberships('caller')))[1]?.role, 'employee');
organizations = ['old'];
assert.equal(await freshRead(() => resolveActiveOrgId(cookies, 'caller')), 'old', 'A revoked membership must not remain selectable');
state = 'suspended';
assert.deepEqual(await freshRead(() => getCachedMemberships('caller')), [], 'A later request must enforce changed lifecycle access');
state = 'active';
failed = true;
await assert.rejects(freshRead(() => getCachedMemberships('caller')), /Synthetic membership failure/);
failed = false;
assert.equal((await freshRead(() => getCachedMemberships('caller'))).length, 1, 'Failure must not poison later requests');

wrongUser = true;
await assert.rejects(freshRead(() => getCachedMemberships('caller')), /crossed its requested scope/);
wrongUser = false;
wrongOrganization = true;
await assert.rejects(freshRead(() => getCachedMemberships('caller')), /crossed its requested scope/);
wrongOrganization = false;
scheduled = true;
blocked = true;
assert.deepEqual(await freshRead(() => getCachedMemberships('caller')), [], 'Unresolved blockers prevent a due activation');
blocked = false;
assert.equal((await freshRead(() => getCachedMemberships('caller'))).length, 1);

const { authenticateAndAuthorize } = await import('@/lib/jobs/auth');
scheduled = false;
organizations = ['old', 'new'];
role = 'buero';
let before = queryCount;
assert.deepEqual(await authenticateAndAuthorize(), { success: true, context: {
  userId: 'caller', orgId: 'new', role: 'buero', isManagerOrAbove: true,
} });
assert.equal(queryCount - before, 1, 'An action resolves selected organization and role with one current membership query');
organizations = ['old'];
role = 'employee';
assert.deepEqual(await authenticateAndAuthorize(), { success: true, context: {
  userId: 'caller', orgId: 'old', role: 'employee', isManagerOrAbove: false,
} });
state = 'suspended';
assert.deepEqual(await authenticateAndAuthorize(), { success: false, error: 'no_active_org' });
authenticated = false;
before = queryCount;
assert.deepEqual(await authenticateAndAuthorize(), { success: false, error: 'not_authenticated' });
assert.equal(queryCount, before, 'Anonymous callers never read privileged memberships');

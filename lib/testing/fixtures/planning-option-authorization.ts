import { expect, mock } from 'bun:test';
import { resolve } from 'node:path';

const root = resolve(import.meta.dir, '../../..');
const organizationId = '75000000-0000-4000-8000-000000000010';
let authenticated = true;
let manager = true;
const reads: unknown[] = [];
mock.module('server-only', () => ({}));
mock.module('next/cache', () => ({ updateTag: () => {} }));
mock.module(resolve(root, 'lib/data/cached.ts'), () => ({
  CACHE_TAGS: { jobs: () => 'jobs', projects: () => 'projects' },
}));
mock.module(resolve(root, 'lib/supabase/admin.ts'), () => ({
  createSupabaseAdminClient: () => {
    throw new Error('Options must delegate to their authorized reader');
  },
}));
mock.module(resolve(root, 'lib/jobs/auth.ts'), () => ({
  authenticateAndAuthorize: async () =>
    authenticated
      ? { success: true, context: { orgId: organizationId, userId: 'actor', isManagerOrAbove: manager } }
      : { success: false, error: 'not_authenticated' },
}));
mock.module(resolve(root, 'lib/planning/server.ts'), () => ({
  assessPlanningOccurrences: () => {},
  expandPlanningTeamsForDates: () => {},
  loadPlanningCalendarEntries: () => {},
  loadPlanningOptions: async (orgId: string, input: unknown) => {
    reads.push({ orgId, input });
    return { success: true, options: [], selected: [], hasMore: false };
  },
}));
const { getPlanningOptions } = await import('../../planning/actions');
const input = { organizationId, kind: 'employees' as const };
authenticated = false;
expect(await getPlanningOptions(input)).toEqual({ success: false, error: 'not_authenticated' });
authenticated = true;
manager = false;
expect(await getPlanningOptions(input)).toEqual({ success: false, error: 'not_authorized' });
manager = true;
expect(
  await getPlanningOptions({ ...input, organizationId: '75000000-0000-4000-8000-000000000011' }),
).toEqual({ success: false, error: 'organization_changed' });
for (const invalid of [
  { offset: -1 },
  { query: 'x'.repeat(121) },
  { selectedIds: Array.from({ length: 101 }, () => organizationId) },
  { selectedIds: [organizationId], defaultUserIds: Array.from({ length: 100 }, () => organizationId) },
]) {
  expect(await getPlanningOptions({ ...input, ...invalid })).toEqual({
    success: false,
    error: 'invalid_input',
  });
}
expect(reads).toHaveLength(0);
expect(await getPlanningOptions(input)).toEqual({ success: true, options: [], selected: [], hasMore: false });
expect(reads).toEqual([
  { orgId: organizationId, input: { ...input, query: '', offset: 0, selectedIds: [], defaultUserIds: [] } },
]);

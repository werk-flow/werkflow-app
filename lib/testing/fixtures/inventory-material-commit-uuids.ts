import { expect, mock } from 'bun:test';
import { resolve } from 'node:path';

// Run in a child process so replaced framework modules cannot leak into other tests.
const root = resolve(import.meta.dir, '../../..');
let committed = false;
let writes = 0;
let readsAfterCommit = 0;
let manager = true;
let writeFailure = false;
class Query {
  private write = false;
  private organization: string | undefined;
  constructor(private table: string) {}
  select(): this {
    return this;
  }
  eq(column: string, value: string): this {
    if (column === 'organization_id') this.organization = value;
    return this;
  }
  in(): this {
    return this;
  }
  insert(row: { organization_id: string }): this {
    this.write = true;
    this.organization = row.organization_id;
    return this;
  }
  update(): this {
    this.write = true;
    return this;
  }
  async maybeSingle() {
    return this.execute();
  }
  async single() {
    return this.execute();
  }
  then(resolveResult: (value: ReturnType<Query['execute']>) => unknown) {
    return Promise.resolve(this.execute()).then(resolveResult);
  }
  execute(): { data: Record<string, unknown> | null; error: { message: string } | null } {
    expect(this.organization).toBe('owned-org');
    if (committed && !this.write) {
      readsAfterCommit += 1;
      return { data: null, error: { message: 'Hydration offline' } };
    }
    if (this.write) {
      if (writeFailure) return { data: null, error: { message: 'Write rejected' } };
      committed = true;
      writes += 1;
    }
    return {
      data: {
        id:
          this.table === 'inventory_items'
            ? '00000000-0000-4000-8000-0000000000a2'
            : '00000000-0000-4000-8000-0000000000a1',
        item_id: '00000000-0000-4000-8000-0000000000a2',
        project_id: null,
        is_billable: true,
        item_type: 'material',
        unit: 'piece',
      },
      error: null,
    };
  }
}
mock.module('server-only', () => ({}));
mock.module('next/cache', () => ({ revalidatePath: () => {}, updateTag: () => {} }));
mock.module(resolve(root, 'lib/data/cached.ts'), () => ({
  CACHE_TAGS: { inventory: () => 'inventory', jobs: () => 'jobs', projects: () => 'projects' },
}));
mock.module(resolve(root, 'lib/jobs/auth.ts'), () => ({
  authenticateAndAuthorize: async () => ({
    success: true,
    context: { orgId: 'owned-org', userId: 'actor', isManagerOrAbove: manager },
  }),
}));
mock.module(resolve(root, 'lib/supabase/admin.ts'), () => ({
  createSupabaseAdminClient: () => ({ from: (table: string) => new Query(table) }),
}));
const { createJobMaterialLine, createProjectMaterialLine, updateJobMaterialLine } = await import(
  '../../inventory/actions'
);
const actions = [
  () =>
    createJobMaterialLine({
      jobId: '00000000-0000-4000-8000-0000000000a3',
      itemId: '00000000-0000-4000-8000-0000000000a2',
      plannedQuantity: 2,
    }),
  () =>
    createProjectMaterialLine({
      projectId: '00000000-0000-4000-8000-0000000000a4',
      itemId: '00000000-0000-4000-8000-0000000000a2',
      plannedQuantity: 2,
    }),
  () => updateJobMaterialLine({ lineId: '00000000-0000-4000-8000-0000000000a1', plannedQuantity: 2 }),
];
for (const action of actions) {
  committed = false;
  writes = 0;
  readsAfterCommit = 0;
  manager = true;
  writeFailure = false;
  expect(await action()).toEqual({ success: true, lineId: '00000000-0000-4000-8000-0000000000a1' });
  expect(writes).toBe(1);
  expect(readsAfterCommit).toBe(0);
  committed = false;
  writes = 0;
  manager = false;
  expect(await action()).toEqual({ success: false, error: 'not_authorized' });
  expect(writes).toBe(0);
  manager = true;
  writeFailure = true;
  expect((await action()).success).toBe(false);
  expect(writes).toBe(0);
}

import { expect, mock, test } from 'bun:test';

import { jobOptionRequestSchema } from './option-types';

let reads = 0;
const untouchedDatabase = {
  from: () => {
    reads += 1;
    throw new Error('no read expected');
  },
};
mock.module('server-only', () => ({}));
mock.module('@/lib/supabase/admin', () => ({ createSupabaseAdminClient: () => untouchedDatabase }));
mock.module('@/lib/supabase/server', () => ({ createSupabaseServerClient: async () => untouchedDatabase }));

const { loadJobEntityOptions } = await import('./option-server');

const organizationId = '00000000-0000-4000-8000-000000000001';
const employee = {
  userId: 'user',
  orgId: organizationId,
  role: 'employee' as const,
  isManagerOrAbove: false,
};

test('an employee cannot search installed equipment or projects, and no read starts', async () => {
  for (const kind of ['equipment', 'projects'] as const) {
    const result = await loadJobEntityOptions(
      employee,
      jobOptionRequestSchema.parse({ organizationId, kind }),
    );
    expect(result).toEqual({ success: false, error: 'not_authorized' });
  }
  expect(reads).toBe(0);
});

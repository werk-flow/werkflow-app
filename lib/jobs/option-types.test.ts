import { expect, test } from 'bun:test';
import { jobOptionRequestSchema } from './option-types';

const organizationId = '00000000-0000-4000-8000-000000000001';

test('option requests validate search, pagination, and all scope identities before a privileged query', () => {
  for (const input of [
    { organizationId, kind: 'clients', offset: -1 },
    { organizationId, kind: 'jobs', query: 'x'.repeat(121) },
    { organizationId, kind: 'projects', selectedIds: ['foreign-looking-input'] },
    { organizationId, kind: 'jobs', clientId: 'invalid' },
    { organizationId, kind: 'jobs', projectId: 'invalid' },
    { organizationId: 'invalid', kind: 'clients' },
    { organizationId, kind: 'arbitrary-table' },
  ]) expect(jobOptionRequestSchema.safeParse(input).success).toBe(false);
});

test('option paging does not truncate selected identities to the fifty visible choices', () => {
  const selectedIds = Array.from({ length: 1200 }, (_, index) => `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`);
  const parsed = jobOptionRequestSchema.parse({ organizationId, kind: 'jobs', offset: 1050, selectedIds });
  expect(parsed.selectedIds).toEqual(selectedIds);
  expect(parsed.offset).toBe(1050);
});

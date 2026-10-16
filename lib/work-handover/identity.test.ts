import { describe, expect, test } from 'bun:test';

import { isUuid } from '@/lib/validation/uuid';
import { deterministicWorkHandoverUuid, workHandoverPackageId } from './identity';

describe('work handover identity', () => {
  test('keeps a missing package stable across independent server loads', () => {
    const organizationId = '10000000-0000-4000-8000-000000000001';
    const targetId = '10000000-0000-4000-8000-000000000002';
    expect(workHandoverPackageId(organizationId, 'job', targetId)).toBe(
      workHandoverPackageId(organizationId, 'job', targetId),
    );
  });

  test('separates organizations and target kinds and emits an RFC 4122 UUID', () => {
    const targetId = '10000000-0000-4000-8000-000000000002';
    const jobId = workHandoverPackageId('10000000-0000-4000-8000-000000000001', 'job', targetId);
    const projectId = workHandoverPackageId('10000000-0000-4000-8000-000000000001', 'project', targetId);
    expect(jobId).not.toBe(projectId);
    expect(jobId).not.toBe(workHandoverPackageId('10000000-0000-4000-8000-000000000003', 'job', targetId));
    // RFC 4122 version 5 with the RFC variant: the version nibble, then the variant nibble.
    expect(isUuid(jobId)).toBe(true);
    expect([jobId[14], '89ab'.includes(jobId[19] ?? '')]).toEqual(['5', true]);
    expect(deterministicWorkHandoverUuid('draft', 'source')).not.toBe(jobId);
  });
});

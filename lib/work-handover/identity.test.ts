import { describe, expect, test } from 'bun:test';

import { deterministicWorkHandoverUuid, workHandoverPackageId } from './identity';

describe('work handover identity', () => {
  test('keeps a missing package stable across independent server loads', () => {
    const organizationId = '10000000-0000-4000-8000-000000000001';
    const targetId = '10000000-0000-4000-8000-000000000002';
    expect(workHandoverPackageId(organizationId, 'job', targetId)).toBe(
      workHandoverPackageId(organizationId, 'job', targetId)
    );
  });

  test('separates organizations and target kinds and emits an RFC 4122 UUID', () => {
    const targetId = '10000000-0000-4000-8000-000000000002';
    const jobId = workHandoverPackageId(
      '10000000-0000-4000-8000-000000000001', 'job', targetId
    );
    const projectId = workHandoverPackageId(
      '10000000-0000-4000-8000-000000000001', 'project', targetId
    );
    expect(jobId).not.toBe(projectId);
    expect(jobId).not.toBe(workHandoverPackageId(
      '10000000-0000-4000-8000-000000000003', 'job', targetId
    ));
    expect(jobId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(deterministicWorkHandoverUuid('draft', 'source')).not.toBe(jobId);
  });
});

// An Anfrage taken over as a Servicefall counts as a completed request in the
// usage statistics (werk-flow/werkflow-planning#280); a Servicefall captured
// without an Anfrage counts nothing.
import assert from 'node:assert/strict';
import { mock } from 'bun:test';
import { ORGANIZATION_A, installActionWorld, signInAs } from './action-boundary-world';

const caseId = '8d000000-0000-4000-8000-000000000001';
const idempotencyKey = '8d000000-0000-4000-8000-000000000002';
const requestId = '8d000000-0000-4000-8000-000000000003';
const clientId = '8d000000-0000-4000-8000-000000000004';
const siteId = '8d000000-0000-4000-8000-000000000005';

const world = installActionWorld({ service_cases: [] });
const captured: string[] = [];
mock.module('@/lib/usage-statistics/capture', () => ({
  captureUsage: (organizationId: string, workflow: string, step: string) => {
    assert.equal(organizationId, ORGANIZATION_A);
    captured.push(`${workflow}_${step}`);
  },
}));
const { createServiceCase } = await import('@/lib/service-cases/actions');
world.rpc = () => ({ data: { id: caseId, case_number: 'SF-0002' }, error: null });

async function countedBy(input: Parameters<typeof createServiceCase>[0]): Promise<string[]> {
  captured.length = 0;
  const result = await createServiceCase(input);
  assert.equal(result.success, true, JSON.stringify(result));
  return [...captured];
}

signInAs(world, 'buero');
const base = { serviceCaseId: caseId, idempotencyKey, chargeContext: 'unknown' as const, equipmentIds: [] };
assert.deepEqual(await countedBy({ ...base, sourceRequestId: requestId }), ['request_completed']);
assert.deepEqual(
  await countedBy({ ...base, clientId, siteId, originalStatement: 'Heizung fällt aus', summary: 'Heizung' }),
  [],
  'a Servicefall without an Anfrage counts nothing',
);

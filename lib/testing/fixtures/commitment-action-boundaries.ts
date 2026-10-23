// Actual customer-commitment actions over the in-memory database: a field
// worker records or withdraws no commitment, and a visit or commitment of
// another organization is refused by the one call that names the caller's.
import assert from 'node:assert/strict';
import { ORGANIZATION_A, installActionWorld, signInAs } from './action-boundary-world';
import { assertRefused, refuseForeignIds } from './operations-boundary-refusals';

const foreignOccurrenceId = '8a000000-0000-4000-8000-000000000001';
const foreignCommitmentId = '8a000000-0000-4000-8000-000000000002';

const world = installActionWorld({});
const { recordCustomerCommitment, withdrawCustomerCommitment } = await import('@/lib/commitments/actions');

const record = [
  'recordCustomerCommitment',
  () =>
    recordCustomerCommitment({
      occurrenceId: foreignOccurrenceId,
      committedDate: '2026-11-03',
      windowStartTime: '08:00',
      windowEndTime: '10:00',
      source: 'telefonisch',
      contactId: null,
    }),
] as const;
const withdraw = [
  'withdrawCustomerCommitment',
  () => withdrawCustomerCommitment(foreignCommitmentId, 'Kunde hat abgesagt'),
] as const;

// Field workers are refused before the service-role client exists.
signInAs(world, 'employee');
await assertRefused(world, [record, withdraw], { success: false, error: 'not_authorized' }, 'none');

// The write functions refuse another organization's visit or commitment
// because the action passes the caller's organization; one call each.
signInAs(world, 'buero');
refuseForeignIds(
  world,
  new Map([
    [foreignOccurrenceId, 'commitment_occurrence_not_found'],
    [foreignCommitmentId, 'commitment_not_found'],
  ]),
);
await assertRefused(
  world,
  [record],
  { success: false, error: 'commitment_occurrence_not_found' },
  'one-call',
);
assert.equal(world.rpcCalls[0]?.args.p_organization_id, ORGANIZATION_A);
await assertRefused(world, [withdraw], { success: false, error: 'commitment_not_found' }, 'one-call');
assert.equal(world.rpcCalls[0]?.args.p_organization_id, ORGANIZATION_A);

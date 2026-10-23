// Actual responsibility actions over the in-memory database: only the
// organization's owner configures responsibilities, so an admin who is not
// the owner is refused before any write; a delegation of another
// organization is not found, and a foreign employee record is refused by the
// one call that names the caller's organization.
import assert from 'node:assert/strict';
import {
  CALLER_ID,
  ORGANIZATION_A,
  ORGANIZATION_B,
  installActionWorld,
  signInAs,
} from './action-boundary-world';
import { assertRefused, refuseForeignIds } from './operations-boundary-refusals';

const otherOwnerId = '87000000-0000-4000-8000-000000000001';
const foreignRecordId = '87000000-0000-4000-8000-000000000002';
const ownRecordId = '87000000-0000-4000-8000-000000000003';
const foreignDelegationId = '87000000-0000-4000-8000-000000000004';

const world = installActionWorld({
  organizations: [
    { id: ORGANIZATION_A, admin_id: otherOwnerId },
    { id: ORGANIZATION_B, admin_id: otherOwnerId },
  ],
  organization_responsibility_delegations: [{ id: foreignDelegationId, organization_id: ORGANIZATION_B }],
});
const {
  previewResponsibilityConfiguration,
  applyResponsibilityConfiguration,
  createResponsibilityDelegation,
  endResponsibilityDelegation,
} = await import('@/lib/responsibilities/actions');

const configuration = {
  responsibility: 'time_approval' as const,
  mode: 'selected' as const,
  employeeRecordIds: [foreignRecordId],
};
const calls = [
  ['previewResponsibilityConfiguration', () => previewResponsibilityConfiguration(configuration)],
  [
    'applyResponsibilityConfiguration',
    () => applyResponsibilityConfiguration({ ...configuration, expectedConfigurationId: null }),
  ],
  [
    'createResponsibilityDelegation',
    () =>
      createResponsibilityDelegation({
        responsibility: 'time_approval',
        delegatorEmployeeRecordId: foreignRecordId,
        substituteEmployeeRecordId: ownRecordId,
        validFrom: '2026-11-02',
        validUntil: '2026-11-13',
        note: 'Urlaubsvertretung',
      }),
  ],
  ['endResponsibilityDelegation', () => endResponsibilityDelegation(foreignDelegationId)],
] as const;

// An admin, Büro member or field worker who is not the owner is refused after
// the owner read, before any write.
for (const role of ['admin', 'buero', 'employee'] as const) {
  signInAs(world, role);
  await assertRefused(world, calls, { success: false, error: 'not_authorized' }, 'reads');
}

// The owner does not find another organization's delegation.
const ownOrganization = world.tables.organizations?.find((row) => row.id === ORGANIZATION_A);
assert.ok(ownOrganization);
ownOrganization.admin_id = CALLER_ID;
signInAs(world, 'admin');
await assertRefused(
  world,
  [calls[3]],
  { success: false, error: 'responsibility_delegation_not_found' },
  'reads',
);

// The write functions refuse another organization's employee record because
// the action passes the caller's organization; one call each.
refuseForeignIds(world, new Map([[foreignRecordId, 'responsibility_holder_not_active_member']]));
await assertRefused(
  world,
  [calls[1]],
  { success: false, error: 'responsibility_holder_not_active_member' },
  'one-call',
);
assert.equal(world.rpcCalls[0]?.args.p_organization_id, ORGANIZATION_A);
refuseForeignIds(world, new Map([[foreignRecordId, 'responsibility_delegator_not_current_holder']]));
await assertRefused(
  world,
  [calls[2]],
  { success: false, error: 'responsibility_delegator_not_current_holder' },
  'one-call',
);
assert.equal(world.rpcCalls[0]?.args.p_organization_id, ORGANIZATION_A);

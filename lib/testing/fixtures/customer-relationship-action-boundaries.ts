// Actual customer follow-up and communication actions over the in-memory
// database: a field worker is refused before any database access, a customer
// of another organization is not found before any write, and a follow-up of
// another organization is refused by the one call that names the caller's.
import assert from 'node:assert/strict';
import { ORGANIZATION_A, ORGANIZATION_B, installActionWorld, signInAs } from './action-boundary-world';
import { assertRefused, refuseForeignIds } from './operations-boundary-refusals';

const ownClientId = '83000000-0000-4000-8000-000000000001';
const foreignClientId = '83000000-0000-4000-8000-000000000002';
const foreignFollowUpId = '83000000-0000-4000-8000-000000000003';
const ownerUserId = '83000000-0000-4000-8000-000000000004';

const world = installActionWorld({
  clients: [
    { id: ownClientId, organization_id: ORGANIZATION_A, name: 'Kunde' },
    { id: foreignClientId, organization_id: ORGANIZATION_B, name: 'Fremder Kunde' },
  ],
});
const {
  getCustomerRelationshipBundle,
  createCustomerFollowUp,
  updateCustomerFollowUp,
  transitionCustomerFollowUp,
  saveCustomerCommunicationSettings,
  saveCustomerCommunicationPreference,
  evaluateCustomerCommunicationGuidance,
  recordCustomerCommunicationException,
} = await import('@/lib/customer-relationships/actions');

const followUp = { title: 'Rückruf', ownerUserId, dueAt: '2026-11-02T09:00:00.000Z' };
const preference = {
  channel: 'phone',
  purpose: 'marketing',
  state: 'disallowed',
} as const;
const guidance = { contactId: null, channel: 'phone', purpose: 'marketing' } as const;
const callsFor = (clientId: string) =>
  [
    ['getCustomerRelationshipBundle', () => getCustomerRelationshipBundle(clientId)],
    ['createCustomerFollowUp', () => createCustomerFollowUp(clientId, followUp)],
    ['updateCustomerFollowUp', () => updateCustomerFollowUp(clientId, foreignFollowUpId, followUp)],
    [
      'transitionCustomerFollowUp',
      () => transitionCustomerFollowUp(clientId, foreignFollowUpId, 'completed'),
    ],
    [
      'saveCustomerCommunicationSettings',
      () => saveCustomerCommunicationSettings(clientId, { preferredChannel: 'email' }),
    ],
    ['saveCustomerCommunicationPreference', () => saveCustomerCommunicationPreference(clientId, preference)],
    [
      'evaluateCustomerCommunicationGuidance',
      () => evaluateCustomerCommunicationGuidance(clientId, guidance),
    ],
    [
      'recordCustomerCommunicationException',
      () => recordCustomerCommunicationException(clientId, { ...guidance, reason: 'Kunde bat darum' }),
    ],
  ] as const;

// Field workers are refused before the service-role client exists.
signInAs(world, 'employee');
await assertRefused(world, callsFor(ownClientId), { success: false, error: 'not_authorized' }, 'none');

// Büro does not find another organization's customer and writes nothing.
signInAs(world, 'buero');
await assertRefused(world, callsFor(foreignClientId), { success: false, error: 'client_not_found' }, 'reads');

// On an own customer, a foreign follow-up is refused by the write function,
// which receives the caller's organization; one call, nothing else written.
refuseForeignIds(world, new Map([[foreignFollowUpId, 'client_follow_up_not_found']]));
const [, , update, transition] = callsFor(ownClientId);
await assertRefused(world, [update], { success: false, error: 'update_failed' }, 'one-call');
assert.equal(world.rpcCalls[0]?.args.p_organization_id, ORGANIZATION_A);
await assertRefused(world, [transition], { success: false, error: 'transition_failed' }, 'one-call');
assert.equal(world.rpcCalls[0]?.args.p_organization_id, ORGANIZATION_A);

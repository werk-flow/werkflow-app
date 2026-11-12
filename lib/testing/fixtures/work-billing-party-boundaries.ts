// Actual billing party actions over the in-memory database: a field worker
// reads and chooses no Auftraggeber or Rechnungsempfänger before any database
// access; a manager reaches no other organization's work or customer, and a
// refused call writes nothing. The database function's own refusals are
// proven by supabase/tests/work_billing_parties.sql.
import assert from 'node:assert/strict';
import { ORGANIZATION_A, installActionWorld, signInAs } from './action-boundary-world';
import { assertRefused, refuseForeignIds } from './operations-boundary-refusals';

const ownJobId = '8f000000-0000-4000-8000-000000000001';
const ownClientId = '8f000000-0000-4000-8000-000000000002';
const foreignJobId = '8f000000-0000-4000-8000-000000000009';
const foreignClientId = '8f000000-0000-4000-8000-00000000000a';

const world = installActionWorld({});
const { setWorkBillingParties } = await import('@/lib/billing-parties/actions');
const { getWorkBillingParties } = await import('@/lib/billing-parties/server');

const choose = (workId: string, recipientClientId: string) => () =>
  setWorkBillingParties({ kind: 'job', workId, clientId: ownClientId, recipientClientId });

// Field workers are refused before the service-role client exists: the
// recipient never reaches them.
signInAs(world, 'employee');
await assertRefused(
  world,
  [
    ['setWorkBillingParties', choose(ownJobId, ownClientId)],
    ['getWorkBillingParties', () => getWorkBillingParties({ kind: 'job', id: ownJobId })],
  ],
  { success: false, error: 'not_authorized' },
  'none',
);

// The one database call refuses a foreign work or customer with the code the
// real function raises; the action passes the caller's organization.
signInAs(world, 'buero');
refuseForeignIds(
  world,
  new Map([
    [foreignJobId, 'work_not_found'],
    [foreignClientId, 'recipient_not_found'],
  ]),
);
await assertRefused(
  world,
  [['setWorkBillingParties', choose(foreignJobId, ownClientId)]],
  { success: false, error: 'work_not_found' },
  'one-call',
);
await assertRefused(
  world,
  [['setWorkBillingParties', choose(ownJobId, foreignClientId)]],
  { success: false, error: 'recipient_not_found' },
  'one-call',
);
assert.equal(world.rpcCalls.at(-1)?.args.p_organization_id, ORGANIZATION_A);

// The read of another organization's work finds nothing in the caller's.
world.rpc = ({ args }) => ({
  data: args.p_organization_id === ORGANIZATION_A && args.p_work_id === foreignJobId ? null : {},
  error: null,
});
await assertRefused(
  world,
  [['getWorkBillingParties', () => getWorkBillingParties({ kind: 'job', id: foreignJobId })]],
  { success: false, error: 'work_not_found' },
  'one-call',
);

// Malformed input never reaches the database.
await assertRefused(
  world,
  [['setWorkBillingParties', choose('not-a-uuid', ownClientId)]],
  { success: false, error: 'invalid_input' },
  'none',
);

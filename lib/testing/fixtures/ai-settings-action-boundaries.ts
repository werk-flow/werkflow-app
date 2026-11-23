// The real WerkFlow KI switch action over the in-memory database: only an
// Admin of the released organization the card showed switches, always for
// that organization and as themselves; Büro, an employee, a suspended Admin,
// a signed-out caller and a caller who is no member of the named
// organization write nothing.
import assert from 'node:assert/strict';
import {
  CALLER_ID,
  ORGANIZATION_A,
  ORGANIZATION_B,
  installActionWorld,
  signInAs,
} from './action-boundary-world';

process.env.AI_ORGANIZATION_IDS = `${ORGANIZATION_A}, ${ORGANIZATION_B}`;
const world = installActionWorld({});
world.rpc = ({ name, args }) => {
  assert.equal(name, 'set_ai_organization_enabled');
  return {
    data: [{ id: 'switch-row', enabled: args.p_enabled, updated_at: '2026-11-23T10:00:00.000000+00:00' }],
    error: null,
  };
};
const { setAiEnabled } = await import('@/lib/ai/settings-actions');

async function assertRefused(
  expected: { success: false; error: string },
  organizationId: string = ORGANIZATION_A,
): Promise<void> {
  const calls = world.rpcCalls.length;
  assert.deepEqual(await setAiEnabled({ organizationId, enabled: true }), expected);
  assert.equal(world.rpcCalls.length, calls, `${expected.error} still wrote the switch`);
}

world.callerId = null;
await assertRefused({ success: false, error: 'not_authenticated' });

for (const role of ['buero', 'employee'] as const) {
  signInAs(world, role);
  await assertRefused({ success: false, error: 'not_authorized' });
}

// A suspended Admin has no operational membership left.
signInAs(world, 'admin');
world.memberships = [{ orgId: ORGANIZATION_A, role: 'admin', accessState: 'suspended' }];
await assertRefused({ success: false, error: 'not_a_member' });

// An Admin of A names B, whose member they are not: refused, whatever the cookie says.
signInAs(world, 'admin');
world.activeOrganizationCookie = ORGANIZATION_B;
await assertRefused({ success: false, error: 'not_a_member' }, ORGANIZATION_B);

// A card left open for A writes A, even after the caller switched to B in another tab.
world.memberships = [
  { orgId: ORGANIZATION_A, role: 'admin' },
  { orgId: ORGANIZATION_B, role: 'admin' },
];
assert.deepEqual(await setAiEnabled({ organizationId: ORGANIZATION_A, enabled: true }), {
  success: true,
  enabled: true,
  id: 'switch-row',
  updatedAt: '2026-11-23T10:00:00.000000+00:00',
});
assert.deepEqual(world.rpcCalls.at(-1)?.args, {
  p_organization_id: ORGANIZATION_A,
  p_actor_id: CALLER_ID,
  p_enabled: true,
});

// A malformed input and an unreleased organization write nothing.
signInAs(world, 'admin');
const calls = world.rpcCalls.length;
assert.deepEqual(await setAiEnabled(JSON.parse(`{"organizationId":"${ORGANIZATION_A}","enabled":"ja"}`)), {
  success: false,
  error: 'invalid_input',
});
assert.deepEqual(await setAiEnabled({ organizationId: 'not-an-id', enabled: true }), {
  success: false,
  error: 'invalid_input',
});
assert.equal(world.rpcCalls.length, calls);
process.env.AI_ORGANIZATION_IDS = ORGANIZATION_B;
await assertRefused({ success: false, error: 'not_released' });
process.env.AI_ORGANIZATION_IDS = ORGANIZATION_A;

// The database's own refusal of a non-admin stays a refusal.
world.rpc = () => ({ data: null, error: { message: 'ai_setting_not_admin' } });
assert.deepEqual(await setAiEnabled({ organizationId: ORGANIZATION_A, enabled: false }), {
  success: false,
  error: 'not_authorized',
});

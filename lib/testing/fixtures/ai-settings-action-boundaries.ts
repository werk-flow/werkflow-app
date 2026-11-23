// The real WerkFlow KI switch action over the in-memory database: only an
// Admin of the active, released organization switches, always for that
// organization and as themselves; Büro, an employee, a suspended Admin, a
// signed-out caller and a caller whose cookie names a foreign organization
// write nothing.
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
  return { data: args.p_enabled, error: null };
};
const { setAiEnabled } = await import('@/lib/ai/settings-actions');

async function assertRefused(expected: { success: false; error: string }): Promise<void> {
  const calls = world.rpcCalls.length;
  assert.deepEqual(await setAiEnabled({ enabled: true }), expected);
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
await assertRefused({ success: false, error: 'org_not_found' });

// A cookie naming a foreign organization selects the caller's own membership:
// the write goes to organization A, never to B.
signInAs(world, 'admin');
world.activeOrganizationCookie = ORGANIZATION_B;
assert.deepEqual(await setAiEnabled({ enabled: true }), { success: true, enabled: true });
assert.deepEqual(world.rpcCalls.at(-1)?.args, {
  p_organization_id: ORGANIZATION_A,
  p_actor_id: CALLER_ID,
  p_enabled: true,
});

// A malformed input and an unreleased organization write nothing.
signInAs(world, 'admin');
const calls = world.rpcCalls.length;
assert.deepEqual(await setAiEnabled(JSON.parse('{"enabled":"ja"}')), { success: false, error: 'invalid_input' });
assert.equal(world.rpcCalls.length, calls);
process.env.AI_ORGANIZATION_IDS = ORGANIZATION_B;
await assertRefused({ success: false, error: 'not_released' });
process.env.AI_ORGANIZATION_IDS = ORGANIZATION_A;

// The database's own refusal of a non-admin stays a refusal.
world.rpc = () => ({ data: null, error: { message: 'ai_setting_not_admin' } });
assert.deepEqual(await setAiEnabled({ enabled: false }), { success: false, error: 'not_authorized' });

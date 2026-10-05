// Actual mail-sending and activation actions with the real rate limiter over
// the in-memory database: a reached limit answers too_many_attempts and sends
// no mail, writes no invite and activates nothing; a limiter outage refuses
// with the action's retryable failure; under the limit the action proceeds.
import assert from 'node:assert/strict';
import { mock } from 'bun:test';
import { CALLER_ID, ORGANIZATION_A, installActionWorld, signInAs, tableRows } from './action-boundary-world';

// Fixture-only values: the secret keys the limiter hash and the OTP hash, the site URL builds the invite link.
process.env.SUPABASE_SECRET_KEY = 'fixture-secret-key';
process.env.NEXT_PUBLIC_SITE_URL = 'https://app.example.test';
process.env.EMAIL_OTP_HASH_SECRET = 'fixture-only-rate-limit-secret';
console.error = () => {};

type LimiterOutcome = 'allow' | 'refuse' | 'fail';
const world = installActionWorld(
  {
    organizations: [{ id: ORGANIZATION_A, admin_id: CALLER_ID, name: 'Muster Haustechnik' }],
    organization_members: [],
    organization_invites: [],
    profiles: [{ id: CALLER_ID, first_name: 'Carla', last_name: 'Caller' }],
    subscriptions: [],
    email_change_challenges: [],
  },
  { organization_invites: () => ({ status: 'pending' }) },
);
const idleState = {
  step: 'idle',
  currentEmail: 'caller@example.test',
  newEmail: null,
  currentOtpExpiresAt: null,
  currentOtpResendAvailableAt: null,
  currentEmailVerifiedExpiresAt: null,
  newEmailOtpExpiresAt: null,
  newEmailResendAvailableAt: null,
};
mock.module('@/lib/settings/email-change-state', () => ({
  getInitialEmailChangeWizardState: async () => idleState,
}));
mock.module('@/lib/subscription/helpers', () => ({ userHasOrganizations: async () => false }));

/** Which limiter action answers how; every other action allows. */
let limiterOutcomes: Record<string, LimiterOutcome> = {};
world.rpc = ({ name, args }) => {
  if (name === 'consume_rate_limit') {
    const outcome = limiterOutcomes[String(args.p_action)] ?? 'allow';
    if (outcome === 'fail') return { data: null, error: { code: '08006', message: 'connection failure' } };
    return { data: outcome === 'allow', error: null };
  }
  if (name === 'check_user_exists_by_email')
    return { data: [{ user_exists: false, user_id: null }], error: null };
  // Stands in for the invite function: one pending invite per call.
  if (name === 'create_organization_invite') {
    const inviteId = `00000000-0000-4000-8000-${String(world.rpcCalls.length).padStart(12, '0')}`;
    tableRows(world, 'organization_invites').push({
      id: inviteId,
      organization_id: args.p_organization_id,
      email: args.p_email,
      status: 'pending',
    });
    return { data: [{ invite_id: inviteId, replaced_invite_id: null }], error: null };
  }
  if (name === 'transition_email_change') return { data: { status: 'ok' }, error: null };
  throw new Error(`unexpected rpc ${name}`);
};
const { sendOrgInvite } = await import('@/lib/invites/actions');
const { requestCurrentEmailChangeOtp, savePendingNewEmailVerification } = await import(
  '@/lib/settings/email-change-actions'
);
const { simulatePayment } = await import('@/lib/subscription/actions');

const limiterActions = (): unknown[] =>
  world.rpcCalls.filter((call) => call.name === 'consume_rate_limit').map((call) => call.args.p_action);
const businessRpcs = (): string[] =>
  world.rpcCalls.filter((call) => call.name !== 'consume_rate_limit').map((call) => call.name);
function reset(outcomes: Record<string, LimiterOutcome>): void {
  limiterOutcomes = outcomes;
  world.rpcCalls.length = 0;
  world.functionCalls.length = 0;
}

// Invites: limited per organization and per recipient, before the invite is written or mailed.
signInAs(world, 'admin');
for (const action of ['invite_send_per_organization', 'invite_send_per_recipient']) {
  reset({ [action]: 'refuse' });
  assert.deepEqual(await sendOrgInvite('new@example.test'), { success: false, error: 'too_many_attempts' });
  assert.equal(world.functionCalls.length, 0, action);
  assert.deepEqual(tableRows(world, 'organization_invites'), [], action);
}
reset({ invite_send_per_recipient: 'fail' });
assert.deepEqual(await sendOrgInvite('new@example.test'), { success: false, error: 'unexpected_error' });
assert.equal(world.functionCalls.length, 0);
assert.deepEqual(tableRows(world, 'organization_invites'), []);
reset({});
assert.equal((await sendOrgInvite('new@example.test')).success, true);
assert.deepEqual(limiterActions(), ['invite_send_per_organization', 'invite_send_per_recipient']);
assert.deepEqual(
  world.functionCalls.map((call) => call.name),
  ['send-invite-email'],
);

// Email change codes: limited per account and per recipient before the challenge changes or a mail leaves.
for (const action of ['email_change_code_per_user', 'email_change_code_per_recipient']) {
  reset({ [action]: 'refuse' });
  const current = await requestCurrentEmailChangeOtp();
  assert.deepEqual([current.success, current.error], [false, 'too_many_attempts'], action);
  const next = await savePendingNewEmailVerification('next@example.test');
  assert.deepEqual([next.success, next.error], [false, 'too_many_attempts'], action);
  assert.deepEqual(businessRpcs(), [], action);
  assert.equal(world.functionCalls.length, 0, action);
}
reset({ email_change_code_per_user: 'fail' });
assert.equal((await requestCurrentEmailChangeOtp()).error, 'unexpected_error');
assert.deepEqual(businessRpcs(), []);
assert.equal(world.functionCalls.length, 0);
reset({});
assert.equal((await requestCurrentEmailChangeOtp()).success, true);
assert.equal((await savePendingNewEmailVerification('next@example.test')).success, true);
assert.deepEqual(businessRpcs(), ['transition_email_change', 'transition_email_change']);
assert.deepEqual(
  world.functionCalls.map((call) => [call.name, call.body.to, call.body.kind]),
  [
    ['send-email-change-current-otp', 'caller@example.test', 'current'],
    ['send-email-change-current-otp', 'next@example.test', 'new'],
  ],
);

// The simulated payment: a reached limit or an outage activates nothing.
reset({ subscription_activation_per_user: 'refuse' });
assert.deepEqual(await simulatePayment(), { success: false, error: 'too_many_attempts' });
reset({ subscription_activation_per_user: 'fail' });
assert.deepEqual(await simulatePayment(), { success: false, error: 'subscription_activation_failed' });
assert.deepEqual(tableRows(world, 'subscriptions'), []);
assert.deepEqual(limiterActions(), ['subscription_activation_per_user']);

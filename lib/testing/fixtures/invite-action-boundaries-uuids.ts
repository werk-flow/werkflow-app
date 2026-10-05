// Actual invite actions over the in-memory database: input is validated
// before identity, only managers of the active organization invite, cancel
// and delete, and an invite of another organization is unreachable.
import assert from 'node:assert/strict';
import {
  CALLER_ID,
  ORGANIZATION_A,
  ORGANIZATION_B,
  installActionWorld,
  signInAs,
  tableRows,
} from './action-boundary-world';

// Fixture-only values: the secret is forwarded to the replaced edge function, the site URL builds the invite link.
process.env.SUPABASE_SECRET_KEY = 'fixture-secret-key';
process.env.NEXT_PUBLIC_SITE_URL = 'https://app.example.test';
// Keys the rate limiter's subject hash; lib/security/rate-limit.test.ts covers the limits.
process.env.EMAIL_OTP_HASH_SECRET = 'fixture-only-rate-limit-secret';

const existingUserId = '30000000-0000-4000-8000-000000000004';
const memberUserId = '30000000-0000-4000-8000-000000000005';
// The original fixture keyed its invites by readable names; the actions now
// require uuids, so the addresses keep the readable names.
const inviteNames: Readonly<Record<string, string>> = {
  '00000000-0000-4000-8000-0000000000c1': 'pending',
  '00000000-0000-4000-8000-0000000000c2': 'cancelled',
  '00000000-0000-4000-8000-0000000000c3': 'accepted',
  '00000000-0000-4000-8000-0000000000c4': 'expired',
  '00000000-0000-4000-8000-0000000000c5': 'foreign-pending',
  '00000000-0000-4000-8000-0000000000c6': 'foreign-cancelled',
};
const inviteRow = (id: string, organizationId: string, status: string): Record<string, unknown> => ({
  id,
  organization_id: organizationId,
  email: `${inviteNames[id] ?? id}@example.test`,
  invite_code: `code-${inviteNames[id] ?? id}`,
  invited_role: 'employee',
  status,
});

const world = installActionWorld(
  {
    organizations: [
      { id: ORGANIZATION_A, admin_id: CALLER_ID, name: 'Muster Haustechnik' },
      { id: ORGANIZATION_B, admin_id: 'someone-else', name: 'Fremde Firma' },
    ],
    organization_members: [
      { id: 'membership-1', organization_id: ORGANIZATION_A, user_id: memberUserId, role: 'employee' },
    ],
    organization_invites: [
      inviteRow('00000000-0000-4000-8000-0000000000c1', ORGANIZATION_A, 'pending'),
      inviteRow('00000000-0000-4000-8000-0000000000c2', ORGANIZATION_A, 'cancelled'),
      inviteRow('00000000-0000-4000-8000-0000000000c3', ORGANIZATION_A, 'accepted'),
      inviteRow('00000000-0000-4000-8000-0000000000c4', ORGANIZATION_A, 'expired'),
      inviteRow('00000000-0000-4000-8000-0000000000c5', ORGANIZATION_B, 'pending'),
      inviteRow('00000000-0000-4000-8000-0000000000c6', ORGANIZATION_B, 'cancelled'),
    ],
    profiles: [{ id: CALLER_ID, first_name: 'Carla', last_name: 'Caller' }],
  },
  { organization_invites: () => ({ status: 'pending' }) },
);
const { sendOrgInvite } = await import('@/lib/invites/actions');
const { cancelInvite } = await import('@/lib/invites/cancel-action');
const { deleteInvite } = await import('@/lib/invites/delete-action');

const inviteStatus = (id: string): unknown =>
  tableRows(world, 'organization_invites').find((invite) => invite.id === id)?.status;
const invitesFor = (email: string): Array<Record<string, unknown>> =>
  tableRows(world, 'organization_invites').filter((invite) => invite.email === email);
const databaseSnapshot = (): string => JSON.stringify(world.tables);
const initialDatabase = databaseSnapshot();
/** Which accounts the replaced `check_user_exists_by_email` lookup knows. */
const knownAccounts: Record<string, string> = {
  'known@example.test': existingUserId,
  'member@example.test': memberUserId,
};
/**
 * Stands in for the invite functions (proved in supabase/tests/people_atomic_writes.sql):
 * the creation inserts one pending invite, the withdrawal deletes it.
 */
let createdInviteCount = 0;
world.rpc = ({ name, args }) => {
  if (name === 'consume_rate_limit') return { data: true, error: null };
  if (name === 'create_organization_invite') {
    createdInviteCount += 1;
    const inviteId = `00000000-0000-4000-8000-0000000001${String(createdInviteCount).padStart(2, '0')}`;
    tableRows(world, 'organization_invites').push({
      id: inviteId,
      organization_id: args.p_organization_id,
      email: args.p_email,
      invite_code: args.p_invite_code,
      invited_role: args.p_invited_role,
      status: 'pending',
    });
    return { data: [{ invite_id: inviteId, replaced_invite_id: null }], error: null };
  }
  if (name === 'discard_unsent_organization_invite') {
    const invites = tableRows(world, 'organization_invites');
    const index = invites.findIndex(
      (invite) => invite.id === args.p_invite_id && invite.organization_id === args.p_organization_id,
    );
    if (index >= 0) invites.splice(index, 1);
    return { data: index >= 0, error: null };
  }
  if (args.p_email === 'lookup-down@example.test')
    return { data: null, error: { message: 'lookup unavailable' } };
  const userId = knownAccounts[String(args.p_email)];
  return { data: [{ user_exists: userId !== undefined, user_id: userId ?? null }], error: null };
};

// A malformed address or the admin role is refused before the caller is identified.
world.callerId = null;
assert.deepEqual(await sendOrgInvite('not-an-address'), { success: false, error: 'invalid_email' });
// The admin role is outside the parameter type; a Server Action still receives whatever the client sends.
assert.deepEqual(await sendOrgInvite('new@example.test', 'admin' as 'buero'), {
  success: false,
  error: 'invalid_role',
});

// Signed-out callers, callers without an active organization, non-members and field workers are denied.
const denied = async (expectedSendError: string, expectedManageError: string): Promise<void> => {
  assert.deepEqual(await sendOrgInvite('new@example.test'), { success: false, error: expectedSendError });
  assert.deepEqual(await cancelInvite('00000000-0000-4000-8000-0000000000c1'), {
    success: false,
    error: expectedManageError,
  });
  assert.deepEqual(await deleteInvite('00000000-0000-4000-8000-0000000000c2'), {
    success: false,
    error: expectedManageError,
  });
};
await denied('not_authenticated', 'not_authenticated');
signInAs(world, null);
await denied('no_active_org', 'no_active_org');
signInAs(world, 'employee');
await denied('not_authorized', 'not_authorized');
// Sending trusts only the cookie's organization: a cookie naming a foreign organization is not a membership.
world.activeOrganizationCookie = ORGANIZATION_B;
assert.deepEqual(await sendOrgInvite('new@example.test'), { success: false, error: 'not_a_member' });
assert.equal(world.adminClientRequests, 0);

// A manager cannot cancel or delete another organization's invite, and each status has its own answer.
signInAs(world, 'buero');
assert.deepEqual(await cancelInvite('00000000-0000-4000-8000-0000000000c5'), {
  success: false,
  error: 'invite_not_found',
});
assert.deepEqual(await deleteInvite('00000000-0000-4000-8000-0000000000c6'), {
  success: false,
  error: 'invite_not_found',
});
assert.deepEqual(await cancelInvite('00000000-0000-4000-8000-0000000000c7'), {
  success: false,
  error: 'invite_not_found',
});
assert.deepEqual(await cancelInvite('00000000-0000-4000-8000-0000000000c2'), {
  success: false,
  error: 'already_cancelled',
});
assert.deepEqual(await cancelInvite('00000000-0000-4000-8000-0000000000c3'), {
  success: false,
  error: 'already_accepted',
});
assert.deepEqual(await cancelInvite('00000000-0000-4000-8000-0000000000c4'), {
  success: false,
  error: 'already_expired',
});
assert.deepEqual(await deleteInvite('00000000-0000-4000-8000-0000000000c1'), {
  success: false,
  error: 'must_cancel_first',
});

// An existing member and an address with a pending invite are not invited again.
assert.deepEqual(await sendOrgInvite('member@example.test'), { success: false, error: 'already_member' });
assert.deepEqual(await sendOrgInvite('  PENDING@example.test '), {
  success: false,
  error: 'invite_already_pending',
});
// An account lookup that fails refuses before any write or mail, instead of
// sending the sign-up variant to an address that may already have an account.
assert.deepEqual(await sendOrgInvite('lookup-down@example.test'), { success: false, error: 'load_failed' });
assert.equal(world.functionCalls.length, 0);
assert.equal(databaseSnapshot(), initialDatabase, 'no denied or rejected call may write');

// A new address gets a pending invite in the active organization and a signup link carrying its code.
const sent = await sendOrgInvite('  New.Person@Example.test ', 'buero');
assert.ok(sent.success);
const [newInvite] = invitesFor('new.person@example.test');
assert.ok(newInvite);
assert.deepEqual(
  [newInvite.id, newInvite.organization_id, newInvite.invited_role, newInvite.status],
  [sent.inviteId, ORGANIZATION_A, 'buero', 'pending'],
);
const [signupMail] = world.functionCalls;
assert.ok(signupMail);
assert.equal(signupMail.name, 'send-invite-email');
assert.deepEqual(signupMail.body, {
  to: 'new.person@example.test',
  inviterName: 'Carla Caller',
  organizationName: 'Muster Haustechnik',
  inviteUrl: `https://app.example.test/signup?email=${encodeURIComponent('new.person@example.test')}&invite_code=${String(newInvite.invite_code)}`,
  isExistingUser: false,
});

// An existing account defaults to the field-worker role and gets a link that redeems the invite directly.
assert.ok((await sendOrgInvite('known@example.test')).success);
const [knownInvite] = invitesFor('known@example.test');
assert.ok(knownInvite);
assert.equal(knownInvite.invited_role, 'employee');
const knownMail = world.functionCalls[1];
assert.ok(knownMail);
assert.deepEqual(
  [knownMail.body.inviteUrl, knownMail.body.isExistingUser],
  [`https://app.example.test/auth/callback?invite_code=${String(knownInvite.invite_code)}`, true],
);

// When the mail cannot be sent, the invite is taken back so the address can be invited again.
world.invokeFunction = () => ({ error: { message: 'mail provider unavailable' } });
assert.deepEqual(await sendOrgInvite('unreachable@example.test'), {
  success: false,
  error: 'email_send_failed',
});
assert.deepEqual(invitesFor('unreachable@example.test'), []);

// Cancelling and deleting change exactly the named invite of the active organization.
assert.deepEqual(await cancelInvite('00000000-0000-4000-8000-0000000000c1'), { success: true });
assert.equal(inviteStatus('00000000-0000-4000-8000-0000000000c1'), 'cancelled');
assert.deepEqual(await deleteInvite('00000000-0000-4000-8000-0000000000c1'), { success: true });
assert.equal(inviteStatus('00000000-0000-4000-8000-0000000000c1'), undefined);
assert.deepEqual(
  [
    inviteStatus('00000000-0000-4000-8000-0000000000c5'),
    inviteStatus('00000000-0000-4000-8000-0000000000c6'),
    inviteStatus('00000000-0000-4000-8000-0000000000c3'),
  ],
  ['pending', 'cancelled', 'accepted'],
);

// A personnel record invite reaches only a record of the active organization,
// names the record in its one database call, and writes the history row only
// once the mail went out.
const ownRecordId = '00000000-0000-4000-8000-0000000000d1';
const foreignRecordId = '00000000-0000-4000-8000-0000000000d2';
world.tables.employee_records = [
  { id: ownRecordId, organization_id: ORGANIZATION_A, user_id: null, invite_id: null },
  { id: foreignRecordId, organization_id: ORGANIZATION_B, user_id: null, invite_id: null },
];
world.tables.employee_record_events = [];
const { sendPersonnelInvite } = await import('@/lib/personnel/actions');
const writingCalls = (): string[] =>
  world.rpcCalls
    .map((call) => call.name)
    .filter((name) => name !== 'check_user_exists_by_email' && name !== 'consume_rate_limit');

world.rpcCalls.length = 0;
assert.deepEqual(await sendPersonnelInvite(foreignRecordId, 'fritz@example.test', 'employee'), {
  success: false,
  error: 'record_not_found',
});
assert.deepEqual(writingCalls(), []);

// A failed mail withdraws the invite and records no history.
assert.deepEqual(await sendPersonnelInvite(ownRecordId, 'rita@example.test', 'employee'), {
  success: false,
  error: 'email_send_failed',
});
assert.deepEqual(writingCalls(), ['create_organization_invite', 'discard_unsent_organization_invite']);
assert.deepEqual(invitesFor('rita@example.test'), []);
assert.deepEqual(tableRows(world, 'employee_record_events'), []);

world.invokeFunction = () => ({ error: null });
world.rpcCalls.length = 0;
assert.deepEqual(await sendPersonnelInvite(ownRecordId, ' Rita@Example.test ', 'buero'), { success: true });
const creation = world.rpcCalls.find((call) => call.name === 'create_organization_invite');
assert.ok(creation);
assert.deepEqual(
  [
    creation.args.p_organization_id,
    creation.args.p_employee_record_id,
    creation.args.p_email,
    creation.args.p_invited_role,
  ],
  [ORGANIZATION_A, ownRecordId, 'rita@example.test', 'buero'],
);
const [connected] = tableRows(world, 'employee_record_events');
assert.ok(connected);
assert.deepEqual(
  [connected.organization_id, connected.employee_record_id, connected.event_type, connected.created_by],
  [ORGANIZATION_A, ownRecordId, 'invite_connected', CALLER_ID],
);

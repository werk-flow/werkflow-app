// The Auth users that the local test server's support allowlist names
// (scripts/test-server.ts sets SUPPORT_USER_IDS to their ids): two, so a test
// can watch one support person's change reach the other's open page.
// Synthetic: they exist only on a test backend, belong to no organization,
// and have no password; a test signs one in through a one-time link the Auth
// admin API issues (tests/golden/support/support-session.ts). No deployed
// environment reads this file: DEV and PROD take their allowlist from the
// server setting.
export type TestSupportUser = { id: string; email: string; firstName: string; lastName: string };

export const TEST_SUPPORT_USER = {
  id: '5a000000-0000-4000-8000-000000000335',
  email: 'support-team@werkflow-golden.test',
  firstName: 'Sina',
  lastName: 'Sommer',
} as const satisfies TestSupportUser;

export const TEST_SUPPORT_COLLEAGUE = {
  id: '5a000000-0000-4000-8000-000000000336',
  email: 'support-colleague@werkflow-golden.test',
  firstName: 'Timo',
  lastName: 'Winter',
} as const satisfies TestSupportUser;

/** The value of SUPPORT_USER_IDS on the local test server. */
export const TEST_SUPPORT_USER_IDS = [TEST_SUPPORT_USER.id, TEST_SUPPORT_COLLEAGUE.id].join(',');

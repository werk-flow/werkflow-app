import { randomBytes } from 'node:crypto';

// The demo seeder (scripts/seed-demo-data.ts) creates confirmed accounts with
// predictable addresses, so their password never comes from the repository.
// Each run generates one that nobody learns. For a manual look on DEV the owner
// may choose one through this variable; PROD refuses a chosen password.
export const DEMO_MEMBER_PASSWORD_ENV = 'DEMO_MEMBER_PASSWORD';

/** The password of the demo members one seeder run creates. */
export function resolveDemoMemberPassword(
  target: 'local' | 'dev' | 'prod',
  chosen: string | undefined,
): string {
  if (!chosen) return randomBytes(24).toString('base64url');
  if (target === 'prod') {
    throw new Error(`PROD demo members get a generated password; unset ${DEMO_MEMBER_PASSWORD_ENV}`);
  }
  return chosen;
}

import { z } from '@/lib/zod';

// A person's own address reaches the next sign-in step in an httpOnly cookie
// scoped to that step's page, never in its URL: request logs, the browser
// history and Referer headers keep every query string
// (lib/security/email-in-url.test.ts). The invite link needs no cookie: the
// signup page reads the invited address from the invite row by its code.

const ADDRESS_COOKIE_BASE = {
  httpOnly: true,
  sameSite: 'lax',
  secure: process.env.NODE_ENV === 'production',
} as const;

/** The address the code step (`/verify`) verifies, set by `POST /auth/verify-address`. */
export const VERIFY_ADDRESS_COOKIE = 'verify_address';

/** As long as the code the address receives stays valid. */
export const VERIFY_ADDRESS_COOKIE_OPTIONS = {
  ...ADDRESS_COOKIE_BASE,
  path: '/verify',
  maxAge: 60 * 60,
} as const;

/** The signed-in address the reset form prefills after the settings flow has signed out. */
export const RESET_ADDRESS_COOKIE = 'reset_address';

export const RESET_ADDRESS_COOKIE_OPTIONS = {
  ...ADDRESS_COOKIE_BASE,
  path: '/forgot-password',
  maxAge: 10 * 60,
} as const;

export const addressSchema = z.string().trim().max(320).email();

/** The cookie's address when it is one, otherwise null: a forged or stale value prefills nothing. */
export function readAddressCookie(value: string | undefined): string | null {
  const parsed = addressSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

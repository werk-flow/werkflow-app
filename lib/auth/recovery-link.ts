import { z } from '@/lib/zod';

// The hosted reset email links its token hash to GET /auth/callback. Any site
// can open that link in this browser, so the GET redeems nothing: it keeps the
// hash in this httpOnly cookie and shows the confirmation step. The person's
// click redeems it through the same-origin POST. The cookie keeps the hash out
// of the page URL and the browser history.

export const RECOVERY_LINK_COOKIE = 'recovery_link';

/** Readable only by the POST, and as long as the emailed link stays valid. */
export const RECOVERY_LINK_COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: 'lax',
  secure: process.env.NODE_ENV === 'production',
  path: '/auth/callback',
  maxAge: 60 * 60,
} as const;

/** The `redeem` value of the POST body that redeems the kept link. */
export const RECOVERY_LINK_REDEMPTION = 'recovery_link';

/** The confirmation step the GET leads to. */
export const RECOVERY_CONFIRMATION_PATH = '/reset-password?step=confirm';

export const recoveryTokenHashSchema = z.string().regex(/^[\w-]{1,256}$/);

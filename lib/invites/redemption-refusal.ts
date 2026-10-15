// The stable refusals of `redeem_organization_invite_for_user`, shared by the
// two redemption handlers (app/auth/callback, app/api/redeem-invite). The RPC
// names a refusal inside its error message; only the code leaves the server.
// The message itself, and the invited address that `email_mismatch` appends
// to it, never reach a response or a URL.

const INVITE_REFUSALS = [
  'email_mismatch',
  'admin_mismatch',
  'invalid_invite',
  'invite_expired',
  'invite_cancelled',
  'invite_already_used',
] as const;

export type InviteRefusal = (typeof INVITE_REFUSALS)[number];

/** The refusal the RPC error names, or null for any other failure. */
export function readInviteRefusal(error: { message: string }): InviteRefusal | null {
  return INVITE_REFUSALS.find((refusal) => error.message.includes(refusal)) ?? null;
}

/**
 * After an `email_mismatch` the invite error page offers signing out and
 * signing in again with the invite. The code reaches that page in this
 * httpOnly cookie, scoped to the page and short-lived, instead of in its URL.
 */
export const INVITE_MISMATCH_COOKIE = 'invite_mismatch';

export const INVITE_MISMATCH_COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: 'lax',
  secure: process.env.NODE_ENV === 'production',
  path: '/invite-error',
  maxAge: 10 * 60,
} as const;

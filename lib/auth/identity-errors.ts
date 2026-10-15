// The one classification of an Auth failure, shared by the proxy's session
// refresh and the server's identity check (docs/technical/security.md#trust-boundaries,
// "Page routing"). No `server-only`: proxy.ts imports it, and it holds no
// secret and no I/O.
import { isAuthSessionMissingError, type AuthError } from '@supabase/supabase-js';

/**
 * Thrown when the identity check could not be completed. Callers must let it
 * fail the request or render: it is not a signed-out user, and it must never
 * become one.
 */
export class AuthUnavailableError extends Error {
  constructor() {
    super('Authentication is temporarily unavailable.');
    this.name = 'AuthUnavailableError';
  }
}

// Codes with which Supabase Auth rejects the presented token or session
// itself (auth-js `error-codes.ts`). Every other error, including a 401/403
// without one of these codes (gateway or API-key failures answer that way
// too), a 429 or a 5xx, is an availability failure.
export const REJECTED_IDENTITY_CODES: ReadonlySet<string> = new Set([
  'bad_jwt',
  'user_not_found',
  'session_not_found',
  'session_expired',
  'refresh_token_not_found',
  'refresh_token_already_used',
  'user_banned',
]);

/** True when Auth rejected the identity: the caller is signed out. Any other error means Auth is unavailable. */
export function isRejectedIdentity(error: AuthError): boolean {
  if (isAuthSessionMissingError(error)) return true;
  return error.code !== undefined && REJECTED_IDENTITY_CODES.has(error.code);
}

// Codes with which Auth refuses an emailed sign-in link itself: the code or
// token is used, expired, malformed, or was requested in another browser
// (the PKCE verifier is missing).
const REJECTED_LINK_CODES: ReadonlySet<string> = new Set([
  'flow_state_not_found',
  'flow_state_expired',
  'bad_code_verifier',
  'otp_expired',
  'validation_failed',
]);

/** True when Auth refused the link of an auth callback. Any other error means Auth is unavailable. */
export function isRejectedSignInLink(error: AuthError): boolean {
  if (isRejectedIdentity(error)) return true;
  return error.code !== undefined && REJECTED_LINK_CODES.has(error.code);
}

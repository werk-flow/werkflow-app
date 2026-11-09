import 'server-only';

import type { ActionResult } from '@/lib/action-result';
import { AuthUnavailableError, isRejectedIdentity } from '@/lib/auth/identity-errors';
import { getAuthenticatedUser } from '@/lib/data/cached';
import { verifySameOriginJsonRequest } from '@/lib/security/same-origin';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';

// The caller of a field sync request (decision record 0010): the Supabase
// session cookie of the web app or an `Authorization: Bearer` access token of
// a native client. Both resolve to the same verified user id; the request
// then establishes the active organization and role from that user's current
// memberships (`resolveActiveContextForUser`). Nothing a device stored counts
// as proof.

export type FieldSyncIdentity = ActionResult<{ userId: string }, 'unauthenticated' | 'forbidden_origin'>;

const BEARER_PATTERN = /^Bearer ([^\s]+)$/;

/**
 * The verified user of a request. A request with an `Authorization` header is
 * judged by that header alone; a cookie request must be a same-origin JSON
 * request first. Throws `AuthUnavailableError` when Auth cannot answer: that
 * is a retry, never a sign-out and never access.
 */
export async function identifyFieldSyncCaller(request: Request): Promise<FieldSyncIdentity> {
  const authorization = request.headers.get('authorization');
  if (authorization !== null) {
    const token = BEARER_PATTERN.exec(authorization)?.[1];
    if (token === undefined) return { success: false, error: 'unauthenticated' };
    const { data, error } = await createSupabaseAdminClient().auth.getUser(token);
    if (error) {
      if (isRejectedIdentity(error)) return { success: false, error: 'unauthenticated' };
      throw new AuthUnavailableError();
    }
    return { success: true, userId: data.user.id };
  }
  if (!verifySameOriginJsonRequest(request).allowed) return { success: false, error: 'forbidden_origin' };
  const user = await getAuthenticatedUser();
  return user ? { success: true, userId: user.id } : { success: false, error: 'unauthenticated' };
}

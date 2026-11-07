import type { User } from '@supabase/supabase-js';

import { logError } from '@/lib/logging';
import { loadDocument } from '@/lib/navigation/document-load';
import type { createSupabaseBrowserClient } from '@/lib/supabase/client';
import { jsonRecordOrEmpty } from '@/lib/supabase/json';

type SupabaseBrowserClient = ReturnType<typeof createSupabaseBrowserClient>;

/** Refusals the invite error page explains with their own sentence. */
const EXPLAINED_REFUSALS = new Set([
  'email_mismatch',
  'admin_mismatch',
  'invite_expired',
  'invite_cancelled',
  'invite_already_used',
  'invalid_invite',
  'too_many_attempts',
]);

/** The invite error page for a refusal; an unknown or failed redemption gets the generic sentence. */
function inviteErrorPath(error: unknown): string {
  if (error === 'invalid_invite_code') return '/invite-error?error=invalid_invite';
  if (typeof error === 'string' && EXPLAINED_REFUSALS.has(error)) return `/invite-error?error=${error}`;
  return '/invite-error?error=redeem_failed';
}

/**
 * Redeems the invite of a freshly signed-in user through the API route, which
 * sets the organization cookie. Every exit is a full document load
 * (`loadDocument`): the session began a moment ago and the organization
 * cookie just changed, so the next page starts from fresh cookies and an
 * empty client state. A refused or failed redemption opens the invite error
 * page, never the dashboard as if nothing happened. Returns true when it
 * started a load, so the caller must not navigate again. The code may be
 * unknown: the route is what validates it, so a stored value that is no code
 * ends on the invite error page like any other refusal.
 */
export async function redeemOtpInvite(
  supabase: SupabaseBrowserClient,
  effectiveInviteCode: unknown,
): Promise<boolean> {
  try {
    const response = await fetch('/api/redeem-invite', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ inviteCode: effectiveInviteCode }),
    });

    // The route answers a JSON object; each key stays unknown, as the redirects only test and print it.
    const result = jsonRecordOrEmpty(await response.json());

    if (!response.ok) {
      logError('redeemOtpInvite: redemption refused', { code: result.error, status: response.status });
      // For email_mismatch the handler keeps the invite code in a cookie for the error page.
      loadDocument(inviteErrorPath(result.error));
      return true;
    }
    if (result.success && result.organizationId) {
      // The API already set the organization cookie; the pending code is used up.
      try {
        const { error: metadataError } = await supabase.auth.updateUser({
          data: { pending_invite_code: null },
        });
        if (metadataError) {
          logError('redeemOtpInvite: clearing the pending invite code failed', {
            code: metadataError.code,
            status: metadataError.status,
          });
        }
      } catch (error) {
        // best-effort: the code is consumed on the server, and the stale hint in the user metadata is ignored on the next redemption.
        logError('redeemOtpInvite: clearing the pending invite code failed', error);
      }
      if (result.alreadyMember) {
        loadDocument(`/dashboard?already_member=${result.organizationId}`);
      } else {
        loadDocument(`/dashboard?joined=${result.organizationId}`);
      }
      return true;
    }
    logError('redeemOtpInvite: redemption answered without an organization');
    return openRedeemFailedPage();
  } catch (error) {
    logError('redeemOtpInvite: redemption failed', error);
    return openRedeemFailedPage();
  }
}

/**
 * Redeems the invite a sign-in carries: the code of the invite link, otherwise
 * the `pending_invite_code` of a user who signed up through an invite and
 * signed in elsewhere. Returns false when there is none. The metadata value
 * stays unknown: the route validates it, and a value it refuses must open the
 * invite error page. Narrowing it here would send that user to `/`.
 */
export async function redeemSignInInvite(
  supabase: SupabaseBrowserClient,
  inviteCode: string | undefined,
  userMetadata: User['user_metadata'],
): Promise<boolean> {
  const pendingInviteCode: unknown = userMetadata?.pending_invite_code;
  const effectiveInviteCode = inviteCode || pendingInviteCode;
  return effectiveInviteCode ? redeemOtpInvite(supabase, effectiveInviteCode) : false;
}

/** A redemption that failed without a known refusal opens the generic invite error page. */
function openRedeemFailedPage(): true {
  loadDocument(inviteErrorPath('redeem_failed'));
  return true;
}

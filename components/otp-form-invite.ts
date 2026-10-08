import { logError } from '@/lib/logging';
import { loadDocument } from '@/lib/navigation/document-load';
import type { createSupabaseBrowserClient } from '@/lib/supabase/client';

type SupabaseBrowserClient = ReturnType<typeof createSupabaseBrowserClient>;

/** Refusals the invite error page explains with their own sentence. */
const EXPLAINED_REFUSALS = new Set([
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
 * started a load, so the caller must not navigate again.
 */
export async function redeemOtpInvite(
  supabase: SupabaseBrowserClient,
  effectiveInviteCode: string,
): Promise<boolean> {
  try {
    const response = await fetch('/api/redeem-invite', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ inviteCode: effectiveInviteCode }),
    });

    const result = await response.json();

    if (!response.ok) {
      logError('redeemOtpInvite: redemption refused', { code: result.error, status: response.status });
      if (result.error === 'email_mismatch') {
        const invitedEmail = result.invitedEmail || '';
        loadDocument(
          `/invite-error?error=email_mismatch&email=${encodeURIComponent(
            invitedEmail,
          )}&invite_code=${effectiveInviteCode}`,
        );
        return true;
      }
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

/** A redemption that failed without a known refusal opens the generic invite error page. */
function openRedeemFailedPage(): true {
  loadDocument(inviteErrorPath('redeem_failed'));
  return true;
}

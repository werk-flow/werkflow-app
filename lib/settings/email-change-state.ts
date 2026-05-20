import 'server-only';

import { getCachedUser } from '@/lib/data/cached';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { reportAuthUsersStringColumnHealth } from '@/lib/supabase/auth-health';
import {
  type EmailChangeWizardState,
  CURRENT_EMAIL_OTP_RESEND_COOLDOWN_SECONDS,
} from '@/lib/settings/email-change.types';

type EmailChangeChallengeRow = {
  user_id: string;
  current_email: string;
  status: 'pending_current' | 'current_verified' | 'pending_new';
  current_email_code_expires_at: string | null;
  current_email_last_sent_at: string | null;
  current_email_verified_expires_at: string | null;
  new_email: string | null;
  new_email_code_expires_at: string | null;
  new_email_last_sent_at: string | null;
  new_email_requested_at: string | null;
};

function toIsoOrNull(value: Date | null) {
  return value ? value.toISOString() : null;
}

function addSeconds(value: string | null, seconds: number) {
  if (!value) {
    return null;
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  date.setSeconds(date.getSeconds() + seconds);
  return date;
}

function buildIdleState(currentEmail: string | null): EmailChangeWizardState {
  return {
    step: 'idle',
    currentEmail,
    newEmail: null,
    currentOtpExpiresAt: null,
    currentOtpResendAvailableAt: null,
    currentEmailVerifiedExpiresAt: null,
    newEmailOtpExpiresAt: null,
    newEmailResendAvailableAt: null,
  };
}

async function getChallengeRow(userId: string) {
  const admin = createSupabaseAdminClient();
  const { data } = await admin
    .from('email_change_challenges')
    .select(
      'user_id, current_email, status, current_email_code_expires_at, current_email_last_sent_at, current_email_verified_expires_at, new_email, new_email_code_expires_at, new_email_last_sent_at, new_email_requested_at'
    )
    .eq('user_id', userId)
    .maybeSingle();

  return (data as EmailChangeChallengeRow | null) ?? null;
}

export async function getInitialEmailChangeWizardState(): Promise<EmailChangeWizardState> {
  await reportAuthUsersStringColumnHealth('getInitialEmailChangeWizardState');

  const {
    data: { user },
  } = await getCachedUser();

  if (!user?.email) {
    return buildIdleState(null);
  }

  const currentEmail = user.email;
  // The custom email-change wizard intentionally persists all intermediate state
  // in public.email_change_challenges and does not depend on auth.users
  // pending email-change columns.
  const challenge = await getChallengeRow(user.id);
  const now = Date.now();

  if (!challenge || challenge.current_email !== currentEmail) {
    return buildIdleState(currentEmail);
  }

  if (
    challenge.status === 'pending_current' &&
    challenge.current_email_code_expires_at &&
    new Date(challenge.current_email_code_expires_at).getTime() > now
  ) {
    return {
      step: 'verify_current',
      currentEmail,
      newEmail: null,
      currentOtpExpiresAt: challenge.current_email_code_expires_at,
      currentOtpResendAvailableAt: toIsoOrNull(
        addSeconds(
          challenge.current_email_last_sent_at,
          CURRENT_EMAIL_OTP_RESEND_COOLDOWN_SECONDS
        )
      ),
      currentEmailVerifiedExpiresAt: null,
      newEmailOtpExpiresAt: null,
      newEmailResendAvailableAt: null,
    };
  }

  if (
    challenge.status === 'current_verified' &&
    challenge.current_email_verified_expires_at &&
    new Date(challenge.current_email_verified_expires_at).getTime() > now
  ) {
    return {
      step: 'enter_new',
      currentEmail,
      newEmail: null,
      currentOtpExpiresAt: null,
      currentOtpResendAvailableAt: null,
      currentEmailVerifiedExpiresAt:
        challenge.current_email_verified_expires_at,
      newEmailOtpExpiresAt: null,
      newEmailResendAvailableAt: null,
    };
  }

  if (
    challenge.status === 'pending_new' &&
    challenge.new_email &&
    challenge.new_email_code_expires_at &&
    new Date(challenge.new_email_code_expires_at).getTime() > now
  ) {
    return {
      step: 'verify_new',
      currentEmail,
      newEmail: challenge.new_email,
      currentOtpExpiresAt: null,
      currentOtpResendAvailableAt: null,
      currentEmailVerifiedExpiresAt:
        challenge.current_email_verified_expires_at,
      newEmailOtpExpiresAt: challenge.new_email_code_expires_at,
      newEmailResendAvailableAt: toIsoOrNull(
        addSeconds(
          challenge.new_email_last_sent_at ?? challenge.new_email_requested_at,
          CURRENT_EMAIL_OTP_RESEND_COOLDOWN_SECONDS
        )
      ),
    };
  }

  return buildIdleState(currentEmail);
}

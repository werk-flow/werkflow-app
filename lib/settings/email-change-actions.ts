'use server';

import { createHash, randomInt } from 'crypto';
import { z } from 'zod';
import { updateTag } from 'next/cache';
import type { User } from '@supabase/supabase-js';

import { CACHE_TAGS, getAuthenticatedUser } from '@/lib/data/cached';
import { getSupabaseSecretKey } from '@/lib/env/server';
import { getInitialEmailChangeWizardState } from '@/lib/settings/email-change-state';
import { reportAuthUsersStringColumnHealth } from '@/lib/supabase/auth-health';
import {
  CURRENT_EMAIL_MAX_ATTEMPTS,
  CURRENT_EMAIL_OTP_EXPIRY_MINUTES,
  CURRENT_EMAIL_OTP_LENGTH,
  CURRENT_EMAIL_OTP_RESEND_COOLDOWN_SECONDS,
  CURRENT_EMAIL_VERIFICATION_WINDOW_MINUTES,
  type EmailChangeActionResult,
} from '@/lib/settings/email-change.types';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';

type EmailChangeChallengeRow = {
  user_id: string;
  current_email: string;
  status: 'pending_current' | 'current_verified' | 'pending_new';
  current_email_code_hash: string | null;
  current_email_code_expires_at: string | null;
  current_email_last_sent_at: string | null;
  current_email_attempt_count: number;
  current_email_verified_at: string | null;
  current_email_verified_expires_at: string | null;
  new_email: string | null;
  new_email_code_hash: string | null;
  new_email_code_expires_at: string | null;
  new_email_last_sent_at: string | null;
  new_email_attempt_count: number;
  new_email_requested_at: string | null;
};

const otpCodeSchema = z
  .string()
  .trim()
  .regex(/^\d{6}$/, 'Bitte gib einen gültigen sechsstelligen Code ein.');
const newEmailSchema = z
  .string()
  .trim()
  .email('Bitte gib eine gültige E-Mail-Adresse ein.');

function hashOtpCode(code: string) {
  return createHash('sha256').update(code).digest('hex');
}

function generateOtpCode() {
  return String(randomInt(0, 10 ** CURRENT_EMAIL_OTP_LENGTH)).padStart(
    CURRENT_EMAIL_OTP_LENGTH,
    '0'
  );
}

function addMinutes(date: Date, minutes: number) {
  return new Date(date.getTime() + minutes * 60_000);
}

function addSeconds(date: Date, seconds: number) {
  return new Date(date.getTime() + seconds * 1_000);
}

function mergeUserMetadataEmail(user: User, email: string) {
  const metadata =
    user.user_metadata && typeof user.user_metadata === 'object'
      ? { ...user.user_metadata }
      : {};

  return {
    ...metadata,
    email,
    email_verified: true,
  };
}

async function getChallengeRow(userId: string) {
  const admin = createSupabaseAdminClient();
  const { data } = await admin
    .from('email_change_challenges')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle();

  return (data as EmailChangeChallengeRow | null) ?? null;
}

async function buildResult(
  success: boolean,
  error?: EmailChangeActionResult['error']
): Promise<EmailChangeActionResult> {
  return {
    success,
    error,
    state: await getInitialEmailChangeWizardState(),
  };
}

async function getProfileFirstName(userId: string) {
  const admin = createSupabaseAdminClient();
  const { data: profile } = await admin
    .from('profiles')
    .select('first_name')
    .eq('id', userId)
    .maybeSingle();

  return typeof profile?.first_name === 'string' ? profile.first_name : null;
}

async function sendEmailChangeOtpEmail(params: {
  email: string;
  firstName?: string | null;
  code: string;
  kind: 'current' | 'new';
}) {
  const admin = createSupabaseAdminClient();
  const secretKey = getSupabaseSecretKey();

  const { error } = await admin.functions.invoke('send-email-change-current-otp', {
    headers: {
      apikey: secretKey,
      Authorization: `Bearer ${secretKey}`,
    },
    body: {
      to: params.email,
      firstName: params.firstName ?? null,
      code: params.code,
      expiresInMinutes: CURRENT_EMAIL_OTP_EXPIRY_MINUTES,
      kind: params.kind,
    },
  });

  return error;
}

export async function requestCurrentEmailChangeOtp(): Promise<EmailChangeActionResult> {
  await reportAuthUsersStringColumnHealth('requestCurrentEmailChangeOtp');

  const user = await getAuthenticatedUser();
  if (!user) {
    return buildResult(false, 'not_authenticated');
  }

  if (!user.email) {
    return buildResult(false, 'no_active_email');
  }

  const admin = createSupabaseAdminClient();
  const now = new Date();
  const currentEmail = user.email.trim().toLowerCase();
  const existingChallenge = await getChallengeRow(user.id);

  if (
    existingChallenge?.current_email_last_sent_at &&
    addSeconds(
      new Date(existingChallenge.current_email_last_sent_at),
      CURRENT_EMAIL_OTP_RESEND_COOLDOWN_SECONDS
    ).getTime() > now.getTime()
  ) {
    return buildResult(false, 'cooldown');
  }

  const code = generateOtpCode();
  const firstName = await getProfileFirstName(user.id);

  const { error: upsertError } = await admin.from('email_change_challenges').upsert(
    {
      user_id: user.id,
      current_email: currentEmail,
      status: 'pending_current',
      current_email_code_hash: hashOtpCode(code),
      current_email_code_expires_at: addMinutes(
        now,
        CURRENT_EMAIL_OTP_EXPIRY_MINUTES
      ).toISOString(),
      current_email_last_sent_at: now.toISOString(),
      current_email_attempt_count: 0,
      current_email_verified_at: null,
      current_email_verified_expires_at: null,
      new_email: null,
      new_email_code_hash: null,
      new_email_code_expires_at: null,
      new_email_last_sent_at: null,
      new_email_attempt_count: 0,
      new_email_requested_at: null,
      updated_at: now.toISOString(),
    },
    { onConflict: 'user_id' }
  );

  if (upsertError) {
    console.error('Failed to store email change challenge:', upsertError);
    return buildResult(false, 'unexpected_error');
  }

  const emailError = await sendEmailChangeOtpEmail({
    email: currentEmail,
    firstName,
    code,
    kind: 'current',
  });

  if (emailError) {
    console.error('Failed to send current email OTP:', emailError);
    return buildResult(false, 'email_send_failed');
  }

  return buildResult(true);
}

export async function verifyCurrentEmailChangeOtp(
  code: string
): Promise<EmailChangeActionResult> {
  const user = await getAuthenticatedUser();
  if (!user) {
    return buildResult(false, 'not_authenticated');
  }

  const parsed = otpCodeSchema.safeParse(code);
  if (!parsed.success) {
    return buildResult(false, 'invalid_code');
  }

  const admin = createSupabaseAdminClient();
  const challenge = await getChallengeRow(user.id);
  const now = new Date();

  if (!challenge || challenge.status !== 'pending_current') {
    return buildResult(false, 'challenge_not_found');
  }

  if (
    !challenge.current_email_code_hash ||
    !challenge.current_email_code_expires_at ||
    new Date(challenge.current_email_code_expires_at).getTime() <= now.getTime()
  ) {
    await admin.from('email_change_challenges').delete().eq('user_id', user.id);
    return buildResult(false, 'challenge_expired');
  }

  if (challenge.current_email !== user.email?.trim().toLowerCase()) {
    await admin.from('email_change_challenges').delete().eq('user_id', user.id);
    return buildResult(false, 'challenge_expired');
  }

  if (challenge.current_email_code_hash !== hashOtpCode(parsed.data)) {
    const nextAttemptCount = challenge.current_email_attempt_count + 1;
    const tooManyAttempts = nextAttemptCount >= CURRENT_EMAIL_MAX_ATTEMPTS;

    await admin
      .from('email_change_challenges')
      .update({
        current_email_attempt_count: nextAttemptCount,
        current_email_code_expires_at: tooManyAttempts
          ? now.toISOString()
          : challenge.current_email_code_expires_at,
        updated_at: now.toISOString(),
      })
      .eq('user_id', user.id);

    return buildResult(false, tooManyAttempts ? 'too_many_attempts' : 'invalid_code');
  }

  const { error } = await admin
    .from('email_change_challenges')
    .update({
      status: 'current_verified',
      current_email_code_hash: null,
      current_email_code_expires_at: null,
      current_email_attempt_count: 0,
      current_email_verified_at: now.toISOString(),
      current_email_verified_expires_at: addMinutes(
        now,
        CURRENT_EMAIL_VERIFICATION_WINDOW_MINUTES
      ).toISOString(),
      updated_at: now.toISOString(),
    })
    .eq('user_id', user.id);

  if (error) {
    console.error('Failed to verify current email change OTP:', error);
    return buildResult(false, 'unexpected_error');
  }

  return buildResult(true);
}

export async function savePendingNewEmailVerification(
  newEmail: string
): Promise<EmailChangeActionResult> {
  const user = await getAuthenticatedUser();
  if (!user) {
    return buildResult(false, 'not_authenticated');
  }

  const parsed = newEmailSchema.safeParse(newEmail);
  if (!parsed.success) {
    return buildResult(false, 'invalid_email');
  }

  const normalizedEmail = parsed.data.toLowerCase();
  if (normalizedEmail === user.email?.trim().toLowerCase()) {
    return buildResult(false, 'invalid_email');
  }

  const admin = createSupabaseAdminClient();
  const challenge = await getChallengeRow(user.id);
  const now = new Date();
  const code = generateOtpCode();

  if (
    !challenge ||
    challenge.status !== 'current_verified' ||
    !challenge.current_email_verified_expires_at
  ) {
    return buildResult(false, 'current_email_not_verified');
  }

  if (
    new Date(challenge.current_email_verified_expires_at).getTime() <= now.getTime()
  ) {
    await admin.from('email_change_challenges').delete().eq('user_id', user.id);
    return buildResult(false, 'verification_window_expired');
  }

  const { error } = await admin
    .from('email_change_challenges')
    .update({
      status: 'pending_new',
      new_email: normalizedEmail,
      new_email_code_hash: hashOtpCode(code),
      new_email_code_expires_at: addMinutes(
        now,
        CURRENT_EMAIL_OTP_EXPIRY_MINUTES
      ).toISOString(),
      new_email_last_sent_at: now.toISOString(),
      new_email_attempt_count: 0,
      new_email_requested_at: now.toISOString(),
      updated_at: now.toISOString(),
    })
    .eq('user_id', user.id);

  if (error) {
    console.error('Failed to persist pending new email verification:', error);
    return buildResult(false, 'unexpected_error');
  }

  const firstName = await getProfileFirstName(user.id);
  const emailError = await sendEmailChangeOtpEmail({
    email: normalizedEmail,
    firstName,
    code,
    kind: 'new',
  });

  if (emailError) {
    console.error('Failed to send new email OTP:', emailError);
    return buildResult(false, 'email_send_failed');
  }

  return buildResult(true);
}

export async function touchPendingNewEmailVerification(
  newEmail: string
): Promise<EmailChangeActionResult> {
  const user = await getAuthenticatedUser();
  if (!user) {
    return buildResult(false, 'not_authenticated');
  }

  const parsed = newEmailSchema.safeParse(newEmail);
  if (!parsed.success) {
    return buildResult(false, 'invalid_email');
  }

  const admin = createSupabaseAdminClient();
  const challenge = await getChallengeRow(user.id);
  const now = new Date();
  const code = generateOtpCode();

  if (
    challenge?.new_email_last_sent_at &&
    addSeconds(
      new Date(challenge.new_email_last_sent_at),
      CURRENT_EMAIL_OTP_RESEND_COOLDOWN_SECONDS
    ).getTime() > now.getTime()
  ) {
    return buildResult(false, 'cooldown');
  }

  if (!challenge) {
    const { error } = await admin.from('email_change_challenges').upsert(
      {
        user_id: user.id,
        current_email: user.email?.trim().toLowerCase() ?? '',
        status: 'pending_new',
        new_email: parsed.data.toLowerCase(),
        new_email_code_hash: hashOtpCode(code),
        new_email_code_expires_at: addMinutes(
          now,
          CURRENT_EMAIL_OTP_EXPIRY_MINUTES
        ).toISOString(),
        new_email_last_sent_at: now.toISOString(),
        new_email_attempt_count: 0,
        new_email_requested_at: now.toISOString(),
        updated_at: now.toISOString(),
      },
      { onConflict: 'user_id' }
    );

    if (error) {
      console.error('Failed to recreate pending new email verification row:', error);
      return buildResult(false, 'unexpected_error');
    }

    const firstName = await getProfileFirstName(user.id);
    const emailError = await sendEmailChangeOtpEmail({
      email: parsed.data.toLowerCase(),
      firstName,
      code,
      kind: 'new',
    });

    if (emailError) {
      console.error('Failed to resend new email OTP:', emailError);
      return buildResult(false, 'email_send_failed');
    }

    return buildResult(true);
  }

  if (challenge.status !== 'pending_new') {
    return buildResult(false, 'challenge_not_found');
  }

  const { error } = await admin
    .from('email_change_challenges')
    .update({
      new_email: parsed.data.toLowerCase(),
      new_email_code_hash: hashOtpCode(code),
      new_email_code_expires_at: addMinutes(
        now,
        CURRENT_EMAIL_OTP_EXPIRY_MINUTES
      ).toISOString(),
      new_email_last_sent_at: now.toISOString(),
      new_email_attempt_count: 0,
      new_email_requested_at: now.toISOString(),
      updated_at: now.toISOString(),
    })
    .eq('user_id', user.id);

  if (error) {
    console.error('Failed to update pending new email verification timestamp:', error);
    return buildResult(false, 'unexpected_error');
  }

  const firstName = await getProfileFirstName(user.id);
  const emailError = await sendEmailChangeOtpEmail({
    email: parsed.data.toLowerCase(),
    firstName,
    code,
    kind: 'new',
  });

  if (emailError) {
    console.error('Failed to resend new email OTP:', emailError);
    return buildResult(false, 'email_send_failed');
  }

  return buildResult(true);
}

export async function verifyNewEmailChangeOtp(
  code: string
): Promise<EmailChangeActionResult> {
  await reportAuthUsersStringColumnHealth('verifyNewEmailChangeOtp');

  const user = await getAuthenticatedUser();
  if (!user) {
    return buildResult(false, 'not_authenticated');
  }

  const parsed = otpCodeSchema.safeParse(code);
  if (!parsed.success) {
    return buildResult(false, 'new_email_invalid_code');
  }

  const admin = createSupabaseAdminClient();
  const challenge = await getChallengeRow(user.id);
  const now = new Date();

  if (
    !challenge ||
    challenge.status !== 'pending_new' ||
    !challenge.new_email ||
    !challenge.new_email_code_hash ||
    !challenge.new_email_code_expires_at
  ) {
    return buildResult(false, 'challenge_not_found');
  }

  if (
    new Date(challenge.new_email_code_expires_at).getTime() <= now.getTime()
  ) {
    await admin.from('email_change_challenges').delete().eq('user_id', user.id);
    return buildResult(false, 'new_email_code_expired');
  }

  if (challenge.new_email_code_hash !== hashOtpCode(parsed.data)) {
    const nextAttemptCount = challenge.new_email_attempt_count + 1;
    const tooManyAttempts = nextAttemptCount >= CURRENT_EMAIL_MAX_ATTEMPTS;

    await admin
      .from('email_change_challenges')
      .update({
        new_email_attempt_count: nextAttemptCount,
        new_email_code_expires_at: tooManyAttempts
          ? now.toISOString()
          : challenge.new_email_code_expires_at,
        updated_at: now.toISOString(),
      })
      .eq('user_id', user.id);

    return buildResult(
      false,
      tooManyAttempts ? 'new_email_too_many_attempts' : 'new_email_invalid_code'
    );
  }

  const { error: updateUserError } = await admin.auth.admin.updateUserById(user.id, {
    email: challenge.new_email,
    email_confirm: true,
    user_metadata: mergeUserMetadataEmail(user, challenge.new_email),
  });

  if (updateUserError) {
    console.error('Failed to update auth email after custom OTP flow:', updateUserError);
    return buildResult(false, 'unexpected_error');
  }

  await admin.from('email_change_challenges').delete().eq('user_id', user.id);

  updateTag(CACHE_TAGS.profile(user.id));
  return {
    success: true,
    state: {
      step: 'idle',
      currentEmail: challenge.new_email,
      newEmail: null,
      currentOtpExpiresAt: null,
      currentOtpResendAvailableAt: null,
      currentEmailVerifiedExpiresAt: null,
      newEmailOtpExpiresAt: null,
      newEmailResendAvailableAt: null,
    },
  };
}

export async function resetEmailChangeWizard(): Promise<EmailChangeActionResult> {
  const user = await getAuthenticatedUser();
  if (!user) {
    return buildResult(false, 'not_authenticated');
  }

  const admin = createSupabaseAdminClient();
  // Our custom wizard state lives only in public.email_change_challenges.
  // Resetting the flow must never mutate native auth.users email-change fields.
  const { error } = await admin
    .from('email_change_challenges')
    .delete()
    .eq('user_id', user.id);

  if (error) {
    console.error('Failed to reset email change challenge.', {
      code: error.code ?? 'unknown',
    });
    return buildResult(false, 'unexpected_error');
  }

  return buildResult(true);
}

export async function clearEmailChangeChallengeBeforeSignOut(): Promise<{
  success: boolean;
}> {
  const user = await getAuthenticatedUser();
  if (!user) {
    return { success: true };
  }

  const admin = createSupabaseAdminClient();
  const { error } = await admin
    .from('email_change_challenges')
    .delete()
    .eq('user_id', user.id);

  if (error) {
    console.error('Failed to clear email change challenge before sign out.', {
      code: error.code ?? 'unknown',
    });
    return { success: false };
  }

  return { success: true };
}

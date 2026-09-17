'use server';

import { randomInt } from 'crypto';
import { z } from 'zod';
import { updateTag } from 'next/cache';
import type { User } from '@supabase/supabase-js';
import { CACHE_TAGS, getAuthenticatedUser } from '@/lib/data/cached';
import { getEmailOtpHashSecret, getSupabaseSecretKey } from '@/lib/env/server';
import { getInitialEmailChangeWizardState } from '@/lib/settings/email-change-state';
import { isDefiniteEmailUpdateRejection } from '@/lib/settings/email-change-rules';
import { hashEmailChangeOtp } from '@/lib/settings/otp-hash';
import { transitionEmailChange } from '@/lib/settings/email-change-transition';
import {
  CURRENT_EMAIL_OTP_EXPIRY_MINUTES, CURRENT_EMAIL_OTP_LENGTH,
  type EmailChangeActionResult,
} from '@/lib/settings/email-change.types';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';

const otpCodeSchema = z.string().trim().regex(/^\d{6}$/);
const newEmailSchema = z.string().trim().email().max(320);

function hashOtpCode(user: User, code: string): string {
  return hashEmailChangeOtp({ secret: getEmailOtpHashSecret(), userId: user.id, code });
}

function generateOtpCode(): string {
  return String(randomInt(0, 10 ** CURRENT_EMAIL_OTP_LENGTH)).padStart(CURRENT_EMAIL_OTP_LENGTH, '0');
}

async function buildResult(
  success: boolean,
  error?: EmailChangeActionResult['error'],
): Promise<EmailChangeActionResult> {
  return { success, error, state: await getInitialEmailChangeWizardState() };
}

async function sendEmailChangeOtpEmail(params: {
  userId: string; email: string; code: string; kind: 'current' | 'new';
}): Promise<EmailChangeActionResult> {
  const admin = createSupabaseAdminClient();
  const { data: profile } = await admin.from('profiles').select('first_name').eq('id', params.userId).maybeSingle();
  const secretKey = getSupabaseSecretKey();
  const { error } = await admin.functions.invoke('send-email-change-current-otp', {
    headers: { apikey: secretKey, Authorization: `Bearer ${secretKey}` },
    body: {
      to: params.email,
      firstName: typeof profile?.first_name === 'string' ? profile.first_name : null,
      code: params.code, expiresInMinutes: CURRENT_EMAIL_OTP_EXPIRY_MINUTES, kind: params.kind,
    },
  });
  return buildResult(!error, error ? 'email_send_failed' : undefined);
}

export async function requestCurrentEmailChangeOtp(): Promise<EmailChangeActionResult> {
  const user = await getAuthenticatedUser();
  if (!user) return buildResult(false, 'not_authenticated');
  if (!user.email) return buildResult(false, 'no_active_email');
  const code = generateOtpCode();
  const result = await transitionEmailChange(user, 'request_current', { codeHash: hashOtpCode(user, code) });
  if ('error' in result) return buildResult(false, result.error);
  return sendEmailChangeOtpEmail({ userId: user.id, email: user.email.trim().toLowerCase(), code, kind: 'current' });
}

export async function verifyCurrentEmailChangeOtp(code: string): Promise<EmailChangeActionResult> {
  const user = await getAuthenticatedUser();
  if (!user) return buildResult(false, 'not_authenticated');
  const parsed = otpCodeSchema.safeParse(code);
  if (!parsed.success) return buildResult(false, 'invalid_code');
  const result = await transitionEmailChange(user, 'verify_current', { codeHash: hashOtpCode(user, parsed.data) });
  return 'error' in result ? buildResult(false, result.error) : buildResult(true);
}

async function sendNewEmailCode(
  user: User, newEmail: string, operation: 'save_new' | 'resend_new',
): Promise<EmailChangeActionResult> {
  const parsed = newEmailSchema.safeParse(newEmail);
  if (!parsed.success) return buildResult(false, 'invalid_email');
  const email = parsed.data.toLowerCase();
  if (email === user.email?.trim().toLowerCase()) return buildResult(false, 'invalid_email');
  const code = generateOtpCode();
  const result = await transitionEmailChange(user, operation, { codeHash: hashOtpCode(user, code), newEmail: email });
  if ('error' in result) return buildResult(false, result.error);
  return sendEmailChangeOtpEmail({ userId: user.id, email, code, kind: 'new' });
}

export async function savePendingNewEmailVerification(newEmail: string): Promise<EmailChangeActionResult> {
  const user = await getAuthenticatedUser();
  if (!user) return buildResult(false, 'not_authenticated');
  return sendNewEmailCode(user, newEmail, 'save_new');
}

export async function touchPendingNewEmailVerification(newEmail: string): Promise<EmailChangeActionResult> {
  const user = await getAuthenticatedUser();
  if (!user) return buildResult(false, 'not_authenticated');
  return sendNewEmailCode(user, newEmail, 'resend_new');
}

export async function verifyNewEmailChangeOtp(code: string): Promise<EmailChangeActionResult> {
  const user = await getAuthenticatedUser();
  if (!user) return buildResult(false, 'not_authenticated');
  const parsed = otpCodeSchema.safeParse(code);
  if (!parsed.success) return buildResult(false, 'new_email_invalid_code');
  const claim = await transitionEmailChange(user, 'verify_new', { codeHash: hashOtpCode(user, parsed.data) });
  if ('error' in claim) return buildResult(false, claim.error);
  if (claim.status !== 'claimed' && claim.status !== 'completion_pending') {
    return buildResult(false, 'unexpected_error');
  }
  const completionInput = { challengeId: claim.challengeId, completionToken: claim.token };
  if (claim.status === 'claimed') {
    const admin = createSupabaseAdminClient();
    try {
      const { error } = await admin.auth.admin.updateUserById(user.id, {
        email: claim.email, email_confirm: true,
        user_metadata: { ...user.user_metadata, email: claim.email, email_verified: true },
      });
      if (error) {
        // A rejected request cannot still execute. A timeout or 5xx can, so its
        // claim stays locked until the changed account can be reconciled.
        if (isDefiniteEmailUpdateRejection(error.status)) {
          await transitionEmailChange(user, 'abandon_rejected_completion', completionInput);
          return buildResult(false, 'unexpected_error');
        }
        return buildResult(false, 'completion_pending');
      }
    } catch {
      return buildResult(false, 'completion_pending');
    }
  }
  // Repeated calls only reconcile. They never issue another Auth update or
  // replace the destination while the first request might still be running.
  const completed = await transitionEmailChange(user, 'complete', completionInput);
  if ('error' in completed) return buildResult(false, completed.error);
  if (completed.status !== 'completed') return buildResult(false, 'unexpected_error');
  updateTag(CACHE_TAGS.profile(user.id));
  return {
    success: true,
    state: {
      step: 'idle', currentEmail: completed.email, newEmail: null,
      currentOtpExpiresAt: null, currentOtpResendAvailableAt: null,
      currentEmailVerifiedExpiresAt: null, newEmailOtpExpiresAt: null,
      newEmailResendAvailableAt: null,
    },
  };
}

export async function resetEmailChangeWizard(): Promise<EmailChangeActionResult> {
  const user = await getAuthenticatedUser();
  if (!user) return buildResult(false, 'not_authenticated');
  const result = await transitionEmailChange(user, 'reset');
  return 'error' in result ? buildResult(false, result.error) : buildResult(true);
}

export async function clearEmailChangeChallengeBeforeSignOut(): Promise<{ success: boolean }> {
  const user = await getAuthenticatedUser();
  if (!user) return { success: true };
  const result = await transitionEmailChange(user, 'reset');
  return { success: !('error' in result) };
}

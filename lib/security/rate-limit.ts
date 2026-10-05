import 'server-only';

import { createHmac } from 'node:crypto';
import { isIP } from 'node:net';
import { getEmailOtpHashSecret } from '@/lib/env/server';
import { logError } from '@/lib/logging';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';

const HOUR_SECONDS = 60 * 60;
const DAY_SECONDS = 24 * HOUR_SECONDS;

type RateLimit = { maxAttempts: number; windowSeconds: number };

/**
 * The closed registry of limits. Each budget sits far above what a real
 * business uses, so only automation reaches it:
 * - invites: a company onboarding its whole team sends tens per hour, and one
 *   address is invited again a few times at most;
 * - invite redemption: a person opens one link a few times; one office network
 *   carries a whole team joining at once;
 * - email change: one change sends two codes plus a few resends (the 60-second
 *   send window per account stays in force beside this budget);
 * - the simulated payment runs once per account.
 */
const RATE_LIMITS = {
  invite_send_per_organization: { maxAttempts: 100, windowSeconds: HOUR_SECONDS },
  invite_send_per_recipient: { maxAttempts: 10, windowSeconds: DAY_SECONDS },
  invite_redeem_per_user: { maxAttempts: 30, windowSeconds: HOUR_SECONDS },
  invite_redeem_per_ip: { maxAttempts: 300, windowSeconds: HOUR_SECONDS },
  email_change_code_per_user: { maxAttempts: 10, windowSeconds: HOUR_SECONDS },
  email_change_code_per_recipient: { maxAttempts: 10, windowSeconds: HOUR_SECONDS },
  subscription_activation_per_user: { maxAttempts: 10, windowSeconds: HOUR_SECONDS },
} as const satisfies Record<string, RateLimit>;

type RateLimitAction = keyof typeof RATE_LIMITS;

/** One attempt to count: the subject is a user id, organization id, normalized email or IP address. */
type RateLimitCheck = { action: RateLimitAction; subject: string };

/**
 * `unavailable` means the limiter could not decide. Every caller refuses the
 * operation with its retryable failure: the guarded operations send mail,
 * redeem a capability or activate a subscription, and an outage of the limit
 * store must not turn into unbounded sends. The cost is that these operations
 * stop while the database is unreachable, which they need anyway.
 */
type RateLimitVerdict = 'allowed' | 'limited' | 'unavailable';

// The subject reaches the database only as a keyed hash: a leaked table names
// no email or IP address, and the action separates the domains of one subject.
// The key is the server's email-OTP hash secret, under its own prefix.
function hashSubject(check: RateLimitCheck): string {
  return createHmac('sha256', getEmailOtpHashSecret())
    .update(`rate-limit:v1:${check.action}:${check.subject}`)
    .digest('hex');
}

async function consumeOne(check: RateLimitCheck): Promise<RateLimitVerdict> {
  const limit = RATE_LIMITS[check.action];
  try {
    const { data, error } = await createSupabaseAdminClient().rpc('consume_rate_limit', {
      p_action: check.action,
      p_subject_hash: hashSubject(check),
      p_max_attempts: limit.maxAttempts,
      p_window_seconds: limit.windowSeconds,
    });
    if (error) {
      logError('consumeRateLimit: consume_rate_limit failed', error);
      return 'unavailable';
    }
    if (typeof data !== 'boolean') {
      logError('consumeRateLimit: unexpected consume_rate_limit result', 'invalid_result');
      return 'unavailable';
    }
    return data ? 'allowed' : 'limited';
  } catch (error) {
    logError('consumeRateLimit: limiter unavailable', error);
    return 'unavailable';
  }
}

/**
 * Counts one attempt against each named limit, in order, and stops at the
 * first that does not allow it. An allowed check stays counted even when a
 * later one refuses, which only makes the limit stricter.
 */
export async function consumeRateLimit(...checks: readonly RateLimitCheck[]): Promise<RateLimitVerdict> {
  for (const check of checks) {
    const verdict = await consumeOne(check);
    if (verdict !== 'allowed') return verdict;
  }
  return 'allowed';
}

/**
 * The client address the hosting proxy reports, or null when the request
 * carries none. Vercel sets `x-forwarded-for` itself; its first entry is the
 * client. A missing or malformed value skips the per-IP limit; the per-user
 * limit still applies.
 */
function readClientIp(headers: Headers): string | null {
  const forwarded = headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? '';
  const candidate = forwarded || headers.get('x-real-ip')?.trim() || '';
  return isIP(candidate) === 0 ? null : candidate.toLowerCase();
}

/** The limits of one invite redemption: per signed-in account and per client address. */
export function inviteRedemptionChecks(userId: string, headers: Headers): RateLimitCheck[] {
  const checks: RateLimitCheck[] = [{ action: 'invite_redeem_per_user', subject: userId }];
  const clientIp = readClientIp(headers);
  if (clientIp !== null) checks.push({ action: 'invite_redeem_per_ip', subject: clientIp });
  return checks;
}

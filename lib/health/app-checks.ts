import 'server-only';

import { getSupabasePublishableKey, getSupabaseUrl } from '@/lib/env/public';
import { getEmailOtpHashSecret } from '@/lib/env/server';
import { logError } from '@/lib/logging';
import { headStorageBucket } from '@/lib/storage/r2';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';

// The deployed app's own credentials, each checked where it lives with a
// harmless authenticated read (docs/technical/environments.md#credentials).
// A check names the credential, never its value, and a failure is logged
// through logError, which keeps only the name, code and status.

type CheckState = 'ok' | 'failed';

export type HealthReport = { ok: boolean; checks: Record<string, CheckState> };

const CHECK_TIMEOUT_MS = 5_000;

/** A provider that answered and refused: logged with its status only. */
class HealthCheckRefusal extends Error {
  override readonly name = 'HealthCheckRefusal';

  constructor(readonly status: number) {
    super('health_check_refused');
  }
}

// The Auth settings read is public data behind the API gateway, which refuses a rotated key.
async function checkPublishableKey(): Promise<void> {
  const response = await fetch(`${getSupabaseUrl()}/auth/v1/settings`, {
    headers: { apikey: getSupabasePublishableKey() },
    signal: AbortSignal.timeout(CHECK_TIMEOUT_MS),
    cache: 'no-store',
  });
  await response.body?.cancel();
  if (!response.ok) throw new HealthCheckRefusal(response.status);
}

// A head read of the limiter's table, which carries no organization data and returns no row.
async function checkSecretKey(): Promise<void> {
  const { error } = await createSupabaseAdminClient()
    .from('rate_limit_attempts')
    .select('id', { head: true })
    .limit(1)
    .abortSignal(AbortSignal.timeout(CHECK_TIMEOUT_MS));
  if (error) throw error;
}

async function checkStorage(): Promise<void> {
  await headStorageBucket(CHECK_TIMEOUT_MS);
}

// A local secret with no provider to ask: presence is all a check can prove.
async function checkOtpHashSecret(): Promise<void> {
  getEmailOtpHashSecret();
}

const APP_CHECKS = {
  supabase_publishable_key: checkPublishableKey,
  supabase_secret_key: checkSecretKey,
  r2_storage: checkStorage,
  email_otp_hash_secret: checkOtpHashSecret,
} as const satisfies Record<string, () => Promise<void>>;

async function runCheck(name: string, check: () => Promise<void>): Promise<CheckState> {
  try {
    await check();
    return 'ok';
  } catch (error) {
    logError(`health: ${name} failed`, error);
    return 'failed';
  }
}

/** Runs every check side by side; one slow provider costs at most its timeout. */
export async function runAppHealthChecks(): Promise<HealthReport> {
  const entries = await Promise.all(
    Object.entries(APP_CHECKS).map(async ([name, check]) => [name, await runCheck(name, check)] as const),
  );
  return {
    ok: entries.every(([, state]) => state === 'ok'),
    checks: Object.fromEntries(entries),
  };
}

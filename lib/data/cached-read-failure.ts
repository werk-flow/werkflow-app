import { logError } from '@/lib/logging';

type CachedReadErrorCode =
  | 'subscription_read_failed'
  | 'member_count_read_failed'
  | 'organization_settings_read_failed'
  | 'organization_calendar_read_failed'
  | 'organization_user_preferences_read_failed'
  | 'profile_read_failed'
  | 'work_templates_read_failed';

/**
 * A cross-request cached read that could not complete. It is thrown inside the
 * `unstable_cache` function, so the cache stores nothing and the next call
 * reads again: a failure is never served as a value for the revalidation
 * window. The message is the stable code only; the cause was logged by code.
 */
export class CachedReadError extends Error {
  readonly code: CachedReadErrorCode;
  constructor(code: CachedReadErrorCode) {
    super(code);
    this.name = 'CachedReadError';
    this.code = code;
  }
}

/** Logs the cause by code and throws `CachedReadError`, so the cache stores nothing. */
export function failCachedRead(code: CachedReadErrorCode, cause: unknown): never {
  logError(`Cached read failed: ${code}`, cause);
  throw new CachedReadError(code);
}

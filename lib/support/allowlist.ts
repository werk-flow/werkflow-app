import 'server-only';

import type { ActionFailure } from '@/lib/action-result';
import { logError } from '@/lib/logging';
import { isUuid } from '@/lib/validation/uuid';

// WerkFlow support: the persons the data processing agreement names, listed
// per environment by their Auth user ids in the server setting
// SUPPORT_USER_IDS, comma-separated (docs/technical/environments.md). Support
// is no organization role: it reaches problem reports across organizations
// and nothing else. A setting that is missing, empty or holds anything but
// user ids cannot be resolved, and every support operation refuses
// (docs/features/problem-reports.md).

/** The allowlisted user ids in lower case, or null when the setting cannot be resolved. */
export function supportUserIds(): ReadonlySet<string> | null {
  const entries = (process.env.SUPPORT_USER_IDS ?? '').split(',').map((entry) => entry.trim());
  if (entries.some((entry) => !isUuid(entry))) return null;
  return new Set(entries.map((entry) => entry.toLowerCase()));
}

export type SupportCallerResult =
  | { success: true; userId: string }
  | ActionFailure<'not_authorized' | 'support_unavailable'>;

/**
 * Admits a verified user id as WerkFlow support. A user outside the allowlist
 * is `not_authorized`; an allowlist that cannot be resolved is
 * `support_unavailable` for everyone.
 */
export function supportCallerOf(userId: string): SupportCallerResult {
  const userIds = supportUserIds();
  if (!userIds) {
    logError('supportCallerOf: the support allowlist cannot be resolved');
    return { success: false, error: 'support_unavailable' };
  }
  if (!userIds.has(userId.toLowerCase())) return { success: false, error: 'not_authorized' };
  return { success: true, userId };
}

/**
 * The other support persons of the allowlist, whom a support write signals
 * live (docs/features/problem-reports.md, "Support"). The acting person's own
 * page reads again after its write, so it is left out. Empty while the
 * allowlist cannot be resolved; a support action refuses before that.
 */
export function otherSupportUserIds(actorId: string): string[] {
  const actor = actorId.toLowerCase();
  return [...(supportUserIds() ?? [])].filter((userId) => userId !== actor);
}

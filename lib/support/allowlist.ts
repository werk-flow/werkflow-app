import 'server-only';

import { isUuid } from '@/lib/validation/uuid';

// WerkFlow support: the persons of the data processing agreement's § 5(2),
// named per environment by their Auth user ids in the server setting
// SUPPORT_USER_IDS, comma-separated (owner's answer on
// werk-flow/werkflow-planning#21). Support is no organization role: it reaches
// problem reports across organizations and nothing else. A setting that is
// missing, empty or holds anything but user ids cannot be resolved, and every
// support operation refuses (docs/features/problem-reports.md).

/** Whether a user is WerkFlow support, or `unresolved` when the allowlist cannot be read. */
export type SupportAccess = 'support' | 'not_support' | 'unresolved';

function allowlistedUserIds(setting: string | undefined): ReadonlySet<string> | null {
  const entries = (setting ?? '').split(',').map((entry) => entry.trim());
  if (entries.some((entry) => !isUuid(entry))) return null;
  return new Set(entries.map((entry) => entry.toLowerCase()));
}

/** The support access of a verified user id, read from this environment's allowlist. */
export function supportAccessOf(userId: string): SupportAccess {
  const userIds = allowlistedUserIds(process.env.SUPPORT_USER_IDS);
  if (!userIds) return 'unresolved';
  return userIds.has(userId.toLowerCase()) ? 'support' : 'not_support';
}

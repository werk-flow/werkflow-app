import 'server-only';

import { isUuid } from '@/lib/validation/uuid';

/**
 * Whether WerkFlow has released WerkFlow KI to this organization: its id is in
 * `AI_ORGANIZATION_IDS`, a comma-separated list the owner sets in Vercel.
 * Empty by default, so no organization sees it. A released organization's
 * admin then switches it on or off (`ai_organization_settings`).
 */
export function isAiReleasedFor(organizationId: string): boolean {
  const entries = (process.env.AI_ORGANIZATION_IDS ?? '').split(',').map((entry) => entry.trim().toLowerCase());
  return entries.filter(isUuid).includes(organizationId.toLowerCase());
}

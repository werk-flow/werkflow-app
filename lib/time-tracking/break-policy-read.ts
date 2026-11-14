import 'server-only';

import type { ActionResult } from '@/lib/action-result';
import { resolveActionContextFor } from '@/lib/org/action-context';
import { uuidSchema } from '@/lib/validation/uuid';
import { readOrganizationSettings } from './organization-settings-read';
import { breakPolicyOf, type BreakPolicy } from './settings';

/**
 * The organization's break rule with its versions, for any current member:
 * an open week view reads it again when the rule is saved, so a day after the
 * page's render resolves against the version that applied to it. Every role
 * sees the rule (Büro reads it in the settings, everyone's week deducts it).
 */
export async function getBreakPolicy(
  organizationId: string,
): Promise<ActionResult<{ breakPolicy: BreakPolicy }>> {
  const parsed = uuidSchema.safeParse(organizationId);
  if (!parsed.success) return { success: false, error: 'invalid_input' };
  const caller = await resolveActionContextFor(parsed.data);
  if (!caller.success) return caller;
  const settings = await readOrganizationSettings(parsed.data);
  if (!settings) return { success: false, error: 'load_failed' };
  return { success: true, breakPolicy: breakPolicyOf(settings) };
}

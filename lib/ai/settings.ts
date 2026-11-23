import 'server-only';

import { isAiReleasedFor } from '@/lib/ai/release-gate';
import { logError } from '@/lib/logging';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';

/** What the admin's WerkFlow KI card shows. */
export type AiOrganizationSwitch =
  | { released: false }
  /** `updatedAt` is the last write's stamp, null before the first: a save settles when it changes. */
  | { released: true; enabled: boolean; updatedAt: string | null };

/**
 * The organization's WerkFlow KI switch: off until WerkFlow released the
 * organization and its admin switched it on. A failed read is a failure,
 * never "off".
 */
export async function readAiOrganizationSwitch(
  organizationId: string,
): Promise<AiOrganizationSwitch | 'load_failed'> {
  if (!isAiReleasedFor(organizationId)) return { released: false };
  const { data, error } = await createSupabaseAdminClient()
    .from('ai_organization_settings')
    .select('enabled, updated_at')
    .eq('organization_id', organizationId)
    .maybeSingle();
  if (error) {
    logError('readAiOrganizationSwitch: settings read failed', error);
    return 'load_failed';
  }
  return { released: true, enabled: data?.enabled ?? false, updatedAt: data?.updated_at ?? null };
}

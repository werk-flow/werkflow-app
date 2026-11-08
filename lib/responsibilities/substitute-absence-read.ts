import 'server-only';

import type { ActionResult } from '@/lib/action-result';
import { logReadErrors } from '@/lib/data/read-request-cache';
import { getBusinessTodayIso } from '@/lib/date-time/berlin';
import { authenticateAndAuthorize } from '@/lib/jobs/auth';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import type { SubstituteAbsenceSpan } from './substitute-absence';
import { loadSubstituteAbsenceSpans } from './substitute-absence-server';

/**
 * The organization's full-day absences from today on, for the owner's
 * substitute picker, read when the delegation dialog opens so the settings
 * page itself reads no absence. Only the owner names substitutes; anyone
 * else gets not_authorized. The spans carry no absence type and are never
 * logged.
 */
export async function getSubstituteAbsences(): Promise<ActionResult<{ absences: SubstituteAbsenceSpan[] }>> {
  const auth = await authenticateAndAuthorize();
  if (!auth.success) return auth;
  const { orgId, userId } = auth.context;
  const admin = createSupabaseAdminClient();
  const organization = await admin.from('organizations').select('admin_id').eq('id', orgId).single();
  if (organization.error || !organization.data) {
    logReadErrors('getSubstituteAbsences: organization read failed', organization.error);
    return { success: false, error: 'load_failed' };
  }
  if (organization.data.admin_id !== userId) return { success: false, error: 'not_authorized' };
  const absences = await loadSubstituteAbsenceSpans(admin, {
    organizationId: orgId,
    from: getBusinessTodayIso(),
    until: null,
  });
  return absences ? { success: true, absences } : { success: false, error: 'load_failed' };
}

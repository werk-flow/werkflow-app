import 'server-only';

import type { ActionResult } from '@/lib/action-result';
import { logReadFailure } from '@/lib/data/read-request-cache';
import { authenticateAndAuthorize } from '@/lib/jobs/auth';
import { logError } from '@/lib/logging';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { workBillingPartiesSchema, type BillingWorkKind, type WorkBillingParties } from './types';

/**
 * The Auftraggeber and Rechnungsempfänger of one work with their history,
 * its Einsatzort and the Objekt's access contacts. Managers only: a field
 * worker never receives the recipient. Work outside the caller's
 * organization is work_not_found.
 */
export async function getWorkBillingParties(work: {
  kind: BillingWorkKind;
  id: string;
}): Promise<ActionResult<{ parties: WorkBillingParties }>> {
  try {
    const auth = await authenticateAndAuthorize();
    if (!auth.success) return auth;
    if (!auth.context.isManagerOrAbove) return { success: false, error: 'not_authorized' };

    const { data, error } = await createSupabaseAdminClient().rpc('get_work_billing_parties', {
      p_organization_id: auth.context.orgId,
      p_kind: work.kind,
      p_work_id: work.id,
    });
    if (error) {
      logReadFailure('getWorkBillingParties: read failed', error);
      return { success: false, error: 'load_failed' };
    }
    if (data === null) return { success: false, error: 'work_not_found' };
    const parties = workBillingPartiesSchema.safeParse(data);
    if (!parties.success) {
      logError('getWorkBillingParties: read malformed', parties.error);
      return { success: false, error: 'load_failed' };
    }
    return { success: true, parties: parties.data };
  } catch (error) {
    logError('Unexpected error in getWorkBillingParties:', error);
    return { success: false, error: 'unexpected_error' };
  }
}

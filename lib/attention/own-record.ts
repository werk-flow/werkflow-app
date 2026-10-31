import 'server-only';

import type { PostgrestSingleResponse } from '@supabase/supabase-js';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import type { ActionContext } from '@/lib/org/action-context';

// The viewer's own employee record. The dispatch, decision and sickness
// derivations each need it, so one derivation starts the read once and hands
// the same promise to all three.
export async function readOwnEmployeeRecord(
  context: ActionContext,
): Promise<PostgrestSingleResponse<{ id: string } | null>> {
  return await createSupabaseAdminClient()
    .from('employee_records')
    .select('id')
    .eq('organization_id', context.orgId)
    .eq('user_id', context.userId)
    .maybeSingle();
}

export type OwnEmployeeRecordRead = ReturnType<typeof readOwnEmployeeRecord>;

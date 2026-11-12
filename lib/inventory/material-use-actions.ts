'use server';

import { revalidatePath } from 'next/cache';

import type { ActionResult } from '@/lib/action-result';
import { loggedRead } from '@/lib/data/read-request-cache';
import { authenticateAndAuthorize } from '@/lib/jobs/auth';
import { logError } from '@/lib/logging';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { rpcArgs } from '@/lib/supabase/rpc-args';
import type { RecordJobMaterialUseInput } from './action-inputs';
import { recordJobMaterialUseSchema } from './action-schemas';
import { getJobContext, getProjectContext } from './job-project-access';
import { toNumber } from './types';
import { cleanText, invalidateInventory, normalizeQuantity } from './write-support';

// The material use action beside the take and return actions in `./actions`.

/**
 * Records that taken material of a line was used (`verbraucht`). It moves no
 * stock: the material left the Lager at the take. The use event snapshots the
 * article's purchase cost, which this action never returns to the caller.
 */
export async function recordJobMaterialUse(
  rawInput: RecordJobMaterialUseInput,
): Promise<ActionResult<{ usedQuantity: number }>> {
  const parsedInput = recordJobMaterialUseSchema.safeParse(rawInput);
  if (!parsedInput.success) return { success: false, error: 'invalid_input' };
  const input = parsedInput.data;
  const auth = await authenticateAndAuthorize();
  if (!auth.success) return { success: false, error: auth.error };

  const quantity = normalizeQuantity(input.quantity);
  if (quantity <= 0) return { success: false, error: 'quantity_required' };

  const admin = createSupabaseAdminClient();
  const { data: line, error: lineError } = await loggedRead(
    'recordJobMaterialUse: job_material_lines read failed',
    admin
      .from('job_material_lines')
      .select('id, job_id, project_id, status')
      .eq('id', input.lineId)
      .eq('organization_id', auth.context.orgId)
      .maybeSingle(),
  );
  if (lineError) return { success: false, error: 'load_failed' };
  if (!line || line.status === 'cancelled') return { success: false, error: 'line_not_found' };

  // A job line needs the job's assignment; a project's own line stays with the office.
  const access = line.job_id
    ? await getJobContext(auth.context, line.job_id)
    : line.project_id
      ? await getProjectContext(admin, auth.context, line.project_id)
      : null;
  if (!access) return { success: false, error: 'line_not_found' };
  if (!access.success) return access;

  const { data, error } = await admin.rpc(
    'record_job_material_use',
    rpcArgs('record_job_material_use', {
      p_organization_id: auth.context.orgId,
      p_actor_id: auth.context.userId,
      p_job_material_line_id: line.id,
      p_quantity: quantity,
      p_note: cleanText(input.note),
    }),
  );
  if (error) {
    if (error.message === 'use_exceeds_taken') return { success: false, error: 'use_exceeds_taken' };
    if (error.message === 'material_line_not_found') return { success: false, error: 'line_not_found' };
    logError('recordJobMaterialUse: record_job_material_use failed', { code: error.code ?? 'unknown' });
    return { success: false, error: 'use_failed' };
  }
  invalidateInventory();
  revalidatePath('/auftraege', 'layout');
  return { success: true, usedQuantity: toNumber(data) };
}

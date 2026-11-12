import 'server-only';

// The pending office sets of a manager's attention derivation, read in one
// call (read_manager_attention_sets, migration
// 20261130100003_propose_site_access_corrections.sql): the open requests and
// the field workers' open access proposals. `./actions` starts the read once
// per derivation and hands the promise to both derivations, so the access
// proposal task adds no backend request (lab.office.cold-start).

import { logError } from '@/lib/logging';
import type { ActionContext } from '@/lib/org/action-context';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { Constants } from '@/lib/supabase/database.types';
import { LIST_ROW_CAP } from '@/lib/supabase/query-batches';
import { uuidSchema } from '@/lib/validation/uuid';
import { z } from '@/lib/zod';

// Every column is non-null but the number, the owner and the callback.
const openRequestRowSchema = z.object({
  id: uuidSchema,
  request_number: z.string().nullable(),
  summary: z.string(),
  status: z.enum(Constants.public.Enums.request_status),
  urgency: z.enum(Constants.public.Enums.request_urgency),
  assigned_to: uuidSchema.nullable(),
  received_at: z.string(),
  callback_due_at: z.string().nullable(),
  callback_overdue: z.boolean(),
  owner_is_manager: z.boolean(),
});

const openProposalRowSchema = z.object({
  id: uuidSchema,
  job_id: uuidSchema,
  site_id: uuidSchema,
  proposed_by: uuidSchema.nullable(),
  proposed_at: z.string(),
});

// Each set holds at most LIST_ROW_CAP + 1 rows; one more than the cap is an overflow.
const setsSchema = z.object({
  requests: z.array(openRequestRowSchema).max(LIST_ROW_CAP),
  access_proposals: z.array(openProposalRowSchema).max(LIST_ROW_CAP),
});

type OpenRequestRow = z.infer<typeof openRequestRowSchema>;
export type OpenProposalRow = z.infer<typeof openProposalRowSchema>;

/** The sets, none for a viewer who is no manager, or `failed` for a read, shape or overflow failure. */
export type ManagerAttentionSetsRead = Promise<
  { failed: false; requests: OpenRequestRow[]; accessProposals: OpenProposalRow[] } | { failed: true }
>;

export async function readManagerAttentionSets(context: ActionContext): ManagerAttentionSetsRead {
  if (context.role !== 'admin' && context.role !== 'buero') {
    return { failed: false, requests: [], accessProposals: [] };
  }
  const { data, error } = await createSupabaseAdminClient().rpc('read_manager_attention_sets', {
    p_organization_id: context.orgId,
    p_limit: LIST_ROW_CAP,
  });
  const parsed = setsSchema.safeParse(data);
  if (error || !parsed.success) {
    logError('Failed to load the pending office sets', error ?? parsed.error);
    return { failed: true };
  }
  return { failed: false, requests: parsed.data.requests, accessProposals: parsed.data.access_proposals };
}

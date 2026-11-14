import { randomUUID } from 'node:crypto';

import { createAdminClient } from './shared';

// Seeds Bereitschaft through the same guarded function as the office's plan
// action (lib/on-call/actions.ts).

/** A shift of one member that started an hour ago and runs until tomorrow; returns its id. */
export async function seedRunningOnCallShift(input: {
  orgId: string;
  actorId: string;
  memberUserId: string;
  label: string;
  handoverNote: string;
}): Promise<string> {
  const admin = createAdminClient();
  const { data: record, error: recordError } = await admin
    .from('employee_records')
    .select('id')
    .eq('organization_id', input.orgId)
    .eq('user_id', input.memberUserId)
    .single();
  if (recordError) throw new Error(`The on-call member has no personnel record: ${recordError.message}`);
  const shiftId = randomUUID();
  const now = Date.now();
  const { error } = await admin.rpc('plan_on_call_shift', {
    p_actor_id: input.actorId,
    p_organization_id: input.orgId,
    p_shift_id: shiftId,
    p_starts_at: new Date(now - 60 * 60 * 1000).toISOString(),
    p_ends_at: new Date(now + 24 * 60 * 60 * 1000).toISOString(),
    p_label: input.label,
    p_handover_note: input.handoverNote,
    p_member_ids: [record.id],
    p_confirm_overlap: true,
  });
  if (error) throw new Error(`Seeding the on-call shift failed: ${error.message}`);
  return shiftId;
}

'use server';

import { revalidatePath } from 'next/cache';
import type { ActionResult } from '@/lib/action-result';
import { loggedRead, logReadFailure } from '@/lib/data/read-request-cache';
import { authenticateAndAuthorize } from '@/lib/jobs/auth';
import { logError } from '@/lib/logging';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { LIST_ROW_CAP, readCompleteRows, readInBatches } from '@/lib/supabase/query-batches';
import { rpcArgs } from '@/lib/supabase/rpc-args';
import {
  nameWorkLeadSchema,
  workLeadTargetSchema,
  type WorkLeadHolding,
  type WorkLeadPanel,
  type WorkLeadTarget,
} from './work-lead-types';

const WORK_LEAD_REFUSALS = ['work_lead_member_not_eligible', 'work_lead_target_not_found'] as const;
type WorkLeadRefusal = (typeof WORK_LEAD_REFUSALS)[number];

function writeFailure(error: { message?: string } | null): WorkLeadRefusal | 'not_authorized' | 'save_failed' {
  const refusal = WORK_LEAD_REFUSALS.find((code) => code === error?.message);
  if (refusal) return refusal;
  if (error?.message === 'work_lead_not_authorized') return 'not_authorized';
  logError('work lead write failed', error);
  return 'save_failed';
}

/** The holdings of the work and, for a job of a project, the project's open holding. */
async function readHoldingRows(orgId: string, target: WorkLeadTarget) {
  const admin = createSupabaseAdminClient();
  const own = await readCompleteRows(
    (from, to) =>
      admin
        .from('work_leads')
        .select('*')
        .eq('organization_id', orgId)
        .eq(target.targetType === 'job' ? 'job_id' : 'project_id', target.targetId)
        .order('started_at', { ascending: false })
        .order('id')
        .range(from, to),
    LIST_ROW_CAP,
  );
  if (own.error) {
    logReadFailure('getWorkLead: work_leads read failed', own.error);
    return null;
  }
  if (target.targetType === 'project') return { own: own.data, inherited: null };
  const job = await loggedRead(
    'getWorkLead: jobs read failed',
    admin.from('jobs').select('project_id').eq('organization_id', orgId).eq('id', target.targetId).maybeSingle(),
  );
  if (job.error || !job.data) return null;
  if (!job.data.project_id) return { own: own.data, inherited: null };
  const inherited = await loggedRead(
    'getWorkLead: project work_leads read failed',
    admin
      .from('work_leads')
      .select('*')
      .eq('organization_id', orgId)
      .eq('project_id', job.data.project_id)
      .is('ended_at', null)
      .maybeSingle(),
  );
  if (inherited.error) return null;
  return { own: own.data, inherited: inherited.data };
}

/** The names of the leads and of the people who named or ended them. */
async function readNames(orgId: string, employeeRecordIds: string[], userIds: string[]) {
  const admin = createSupabaseAdminClient();
  const [records, profiles] = await Promise.all([
    readInBatches(employeeRecordIds, (batch) =>
      admin
        .from('employee_records')
        .select('id, user_id, first_name, last_name')
        .eq('organization_id', orgId)
        .in('id', [...batch]),
    ),
    readInBatches(userIds, (batch) =>
      admin
        .from('profiles')
        .select('id, first_name, last_name, email')
        .in('id', [...batch]),
    ),
  ]);
  if (records.error || profiles.error) return null;
  const profileName = new Map(
    profiles.data.map((profile) => [
      profile.id,
      [profile.first_name, profile.last_name].filter(Boolean).join(' ') || profile.email || null,
    ]),
  );
  const recordById = new Map(
    records.data.map((record) => [
      record.id,
      {
        userId: record.user_id,
        name:
          (record.user_id ? profileName.get(record.user_id) : null) ??
          ([record.first_name, record.last_name].filter(Boolean).join(' ') || 'Unbekannte Person'),
      },
    ]),
  );
  return { recordById, profileName };
}

/** The lead of a project or job with its history, for Admin and Büro. */
export async function getWorkLead(
  rawTarget: WorkLeadTarget,
): Promise<ActionResult<{ panel: WorkLeadPanel }>> {
  const parsed = workLeadTargetSchema.safeParse(rawTarget);
  if (!parsed.success) return { success: false, error: 'invalid_input' };
  const auth = await authenticateAndAuthorize();
  if (!auth.success) return auth;
  if (!auth.context.isManagerOrAbove) return { success: false, error: 'not_authorized' };
  const { orgId } = auth.context;

  const rows = await readHoldingRows(orgId, parsed.data);
  if (!rows) return { success: false, error: 'load_failed' };
  const all = rows.inherited ? [...rows.own, rows.inherited] : rows.own;
  const names = await readNames(
    orgId,
    [...new Set(all.map((row) => row.employee_record_id))],
    [...new Set(all.flatMap((row) => [row.started_by, row.ended_by].filter((id) => id !== null)))],
  );
  if (!names) return { success: false, error: 'load_failed' };

  const toHolding = (row: (typeof all)[number]): WorkLeadHolding => {
    const person = names.recordById.get(row.employee_record_id);
    return {
      id: row.id,
      userId: person?.userId ?? null,
      name: person?.name ?? 'Unbekannte Person',
      startedAt: row.started_at,
      startedByName: row.started_by ? (names.profileName.get(row.started_by) ?? null) : null,
      endedAt: row.ended_at,
      endedByName: row.ended_by ? (names.profileName.get(row.ended_by) ?? null) : null,
    };
  };
  const history = rows.own.map(toHolding);
  return {
    success: true,
    panel: {
      current: history.find((holding) => holding.endedAt === null) ?? null,
      inherited: rows.inherited ? toHolding(rows.inherited) : null,
      history,
    },
  };
}

/** Names a member of the organization as the lead of a project or job; ends the previous one in the same call. */
export async function nameWorkLead(rawInput: {
  targetType: 'project' | 'job';
  targetId: string;
  userId: string;
}): Promise<ActionResult<object, WorkLeadRefusal | 'not_authorized' | 'save_failed' | string>> {
  const parsed = nameWorkLeadSchema.safeParse(rawInput);
  if (!parsed.success) return { success: false, error: 'invalid_input' };
  const auth = await authenticateAndAuthorize();
  if (!auth.success) return auth;
  if (!auth.context.isManagerOrAbove) return { success: false, error: 'not_authorized' };
  const { orgId, userId } = auth.context;
  const admin = createSupabaseAdminClient();

  // The member's personnel record in the caller's organization; the database checks access again.
  const record = await loggedRead(
    'nameWorkLead: employee_records read failed',
    admin
      .from('employee_records')
      .select('id')
      .eq('organization_id', orgId)
      .eq('user_id', parsed.data.userId)
      .maybeSingle(),
  );
  if (record.error) return { success: false, error: 'load_failed' };
  if (!record.data) return { success: false, error: 'work_lead_member_not_eligible' };

  const { error } = await admin.rpc(
    'name_work_lead',
    rpcArgs('name_work_lead', {
    p_organization_id: orgId,
    p_actor_id: userId,
    p_project_id: parsed.data.targetType === 'project' ? parsed.data.targetId : null,
    p_job_id: parsed.data.targetType === 'job' ? parsed.data.targetId : null,
      p_employee_record_id: record.data.id,
    }),
  );
  if (error) return { success: false, error: writeFailure(error) };
  revalidatePath('/auftraege', 'layout');
  return { success: true };
}

/** Ends the lead of a project or job; a second end changes nothing. */
export async function endWorkLead(
  rawTarget: WorkLeadTarget,
): Promise<ActionResult<object, WorkLeadRefusal | 'not_authorized' | 'save_failed' | string>> {
  const parsed = workLeadTargetSchema.safeParse(rawTarget);
  if (!parsed.success) return { success: false, error: 'invalid_input' };
  const auth = await authenticateAndAuthorize();
  if (!auth.success) return auth;
  if (!auth.context.isManagerOrAbove) return { success: false, error: 'not_authorized' };
  const { error } = await createSupabaseAdminClient().rpc(
    'end_work_lead',
    rpcArgs('end_work_lead', {
    p_organization_id: auth.context.orgId,
    p_actor_id: auth.context.userId,
    p_project_id: parsed.data.targetType === 'project' ? parsed.data.targetId : null,
      p_job_id: parsed.data.targetType === 'job' ? parsed.data.targetId : null,
    }),
  );
  if (error) return { success: false, error: writeFailure(error) };
  revalidatePath('/auftraege', 'layout');
  return { success: true };
}

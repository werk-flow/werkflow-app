import 'server-only';

import { z } from '@/lib/zod';
import { uuidSchema } from '@/lib/validation/uuid';
import { logReadFailure } from '@/lib/data/read-request-cache';
import { createSupabaseAdminClient, type AdminClient } from '@/lib/supabase/admin';
import { LIST_ROW_CAP, readCompleteRows, readInBatches } from '@/lib/supabase/query-batches';

import { WORK_DECLARED_KIND_LABELS, type WorkLifecycleSnapshot } from './types';

// The owner and predecessor options of the lifecycle snapshot. The actions in
// actions.ts authenticate the caller and pass the organization and user.

type EntityOptions = Pick<WorkLifecycleSnapshot, 'ownOwnerId' | 'ownerOptions' | 'predecessorOptions'>;
type EmployeeOwner = { id: string; user_id: string | null };
type ProfileName = { id: string; first_name: string | null; last_name: string | null };

export const predecessorOptionsSchema = z
  .array(z.object({ id: uuidSchema, number: z.string().nullable(), title: z.string() }))
  .max(50);

export function toPredecessorOption(record: { id: string; number: string | null; title: string }): {
  value: string;
  label: string;
} {
  return { value: record.id, label: record.number ? `${record.number} · ${record.title}` : record.title };
}

function readEntityOptionRows(admin: AdminClient, organizationId: string) {
  return Promise.all([
    // Every employee with an account is a possible owner; a cap here
    // dropped owners, and the actor's own record, above 200 employees.
    readCompleteRows(
      (from, to) =>
        admin
          .from('employee_records')
          .select('id, user_id')
          .eq('organization_id', organizationId)
          .not('user_id', 'is', null)
          .order('id')
          .range(from, to),
      LIST_ROW_CAP,
    ),
    // The first records in natural number order, selected in the database.
    admin.rpc('search_work_predecessor_options', {
      p_organization_id: organizationId,
      p_kind: 'job',
      p_limit: 25,
    }),
    admin.rpc('search_work_predecessor_options', {
      p_organization_id: organizationId,
      p_kind: 'project',
      p_limit: 25,
    }),
    admin
      .from('job_instruction_items')
      .select('id, content, job_id, project_id')
      .eq('organization_id', organizationId)
      .order('created_at')
      .limit(25),
  ]);
}

async function readOwnerProfiles(admin: AdminClient, employees: EmployeeOwner[]): Promise<ProfileName[]> {
  const userIds = employees.flatMap((employee) => (employee.user_id ? [employee.user_id] : []));
  const profilesResult = await readInBatches(userIds, (batch) =>
    admin
      .from('profiles')
      .select('id, first_name, last_name')
      .in('id', [...batch]),
  );
  if (profilesResult.error) {
    logReadFailure('loadEntityOptions: profile read failed', {
      code: profilesResult.error.code,
      message: profilesResult.error.message,
    });
    throw new Error('work_options_load_failed');
  }
  return profilesResult.data;
}

function toOwnerOptions(
  employees: EmployeeOwner[],
  profileRows: ProfileName[],
): EntityOptions['ownerOptions'] {
  const profiles = new Map(profileRows.map((profile) => [profile.id, profile]));
  return employees.map((employee) => {
    const profile = employee.user_id ? profiles.get(employee.user_id) : undefined;
    const name = [profile?.first_name, profile?.last_name].filter(Boolean).join(' ');
    return {
      value: employee.id,
      label: name || 'Unbenannte Person',
    };
  });
}

export async function loadEntityOptions(organizationId: string, userId: string): Promise<EntityOptions> {
  const admin = createSupabaseAdminClient();
  const [employeesResult, jobsResult, projectsResult, instructionsResult] = await readEntityOptionRows(
    admin,
    organizationId,
  );
  const jobOptions = predecessorOptionsSchema.safeParse(jobsResult.data);
  const projectOptions = predecessorOptionsSchema.safeParse(projectsResult.data);
  const optionsError =
    employeesResult.error ??
    jobsResult.error ??
    projectsResult.error ??
    instructionsResult.error ??
    (jobOptions.success && projectOptions.success ? null : { code: 'malformed_options', message: '' });
  if (optionsError || !jobOptions.success || !projectOptions.success) {
    logReadFailure('loadEntityOptions: option read failed', {
      code: optionsError?.code ?? 'malformed_options',
      message: optionsError?.message ?? '',
    });
    throw new Error('work_options_load_failed');
  }
  const profiles = await readOwnerProfiles(admin, employeesResult.data);
  return {
    ownOwnerId: employeesResult.data.find((employee) => employee.user_id === userId)?.id ?? null,
    ownerOptions: toOwnerOptions(employeesResult.data, profiles),
    predecessorOptions: {
      job: jobOptions.data.map(toPredecessorOption),
      project: projectOptions.data.map(toPredecessorOption),
      instruction: (instructionsResult.data ?? []).map((instruction) => ({
        value: instruction.id,
        label: instruction.content,
        description: instruction.job_id ? 'Auftragseintrag' : 'Projekteintrag',
      })),
      declared: Object.entries(WORK_DECLARED_KIND_LABELS).map(([value, label]) => ({ value, label })),
    },
  };
}

export async function loadOwnOwnerOption(organizationId: string, userId: string): Promise<EntityOptions> {
  const admin = createSupabaseAdminClient();
  const { data, error } = await admin
    .from('employee_records')
    .select('id')
    .eq('organization_id', organizationId)
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw new Error('work_options_load_failed');
  return {
    ownOwnerId: data?.id ?? null,
    ownerOptions: data ? [{ value: data.id, label: 'Ich' }] : [],
    predecessorOptions: { job: [], project: [], instruction: [], declared: [] },
  };
}

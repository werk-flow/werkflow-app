import 'server-only';

import { createHash } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import type { ActionFailure } from '@/lib/action-result';
import { loggedRead } from '@/lib/data/read-request-cache';
import { authenticateAndAuthorize } from '@/lib/jobs/auth';
import { logError } from '@/lib/logging';
import { resolveSelfServiceContext } from '@/lib/org/self-service-context';
import { isManagerRole } from '@/lib/roles';
import { createSupabaseAdminClient, type AdminClient } from '@/lib/supabase/admin';

// The shared steps of the personnel lifecycle Server Actions
// (lifecycle-actions, onboarding-actions, document-actions): the manager and
// self-service guards, the request hash, the failure codes and the
// revalidated paths.

// A lifecycle success nests its payload under `data`; a rejected transition may return the blocking inventory there.
export type LifecycleResult<T = undefined> =
  | ({ success: true } & (T extends undefined ? object : { data: T }))
  | (ActionFailure & { data?: T });

export function hashRequest(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

export function lifecycleFailureCode(error: { code?: string; message?: string } | null): string {
  const message = error?.message ?? 'mutation_failed';
  const known = [
    'forbidden',
    'stale_version',
    'operation_id_conflict',
    'last_admin_protected',
    'organization_owner_protected',
    'last_responsibility_holder',
    'membership_required',
    'future_effective_at_required',
    'immediate_effective_at_required',
    'future_effective_date_required',
    'no_scheduled_transition',
    'access_requirements_incomplete',
    'document_not_released',
    'document_version_not_found',
    'personnel_document_not_found',
    'requirement_not_found',
    'requirement_not_open',
    'employee_record_not_found',
    'template_version_not_found',
    'template_not_found',
    'plan_not_found',
    'owner_not_found',
    'release_not_active',
    'active_access_required',
    'invalid_transition',
    'invalid_template_item',
    'invalid_template',
    'invalid_requirement',
    'invalid_document_type',
    'invalid_document',
    'invalid_reference',
    'invalid_acknowledgement',
    'invalid_plan',
    'reason_required',
    'statement_required',
  ].find((code) => message.includes(code));
  if (known) return known;
  logError('Unexpected personnel lifecycle database error', error);
  return 'mutation_failed';
}

export function revalidatePersonnel(): void {
  revalidatePath('/mitarbeiter');
  revalidatePath('/aufgaben');
  revalidatePath('/onboarding/meine-aufgaben');
}

export async function requireManagerRecord(employeeRecordId: string): Promise<
  | {
      success: true;
      admin: AdminClient;
      organizationId: string;
      actorId: string;
      userId: string | null;
      role: 'admin' | 'buero';
    }
  | ActionFailure
> {
  const auth = await authenticateAndAuthorize();
  if (!auth.success) return auth;
  const role = isManagerRole(auth.context.role) ? auth.context.role : null;
  if (!auth.context.isManagerOrAbove || !role) {
    return { success: false, error: 'not_authorized' };
  }
  const admin = createSupabaseAdminClient();
  const { data: employee, error: employeeError } = await loggedRead(
    'requireManagerRecord: employee_records read failed',
    admin
      .from('employee_records')
      .select('id, user_id')
      .eq('id', employeeRecordId)
      .eq('organization_id', auth.context.orgId)
      .maybeSingle(),
  );
  if (employeeError) return { success: false, error: 'load_failed' };
  if (!employee) return { success: false, error: 'record_not_found' };
  return {
    success: true,
    admin,
    organizationId: auth.context.orgId,
    actorId: auth.context.userId,
    userId: employee.user_id,
    role,
  };
}

export async function getSelfContext(): Promise<
  | {
      success: true;
      admin: AdminClient;
      organizationId: string;
      actorId: string;
      employeeRecordId: string;
      prestart: boolean;
    }
  | ActionFailure
> {
  const caller = await resolveSelfServiceContext();
  if (!caller.success) return caller;
  const { orgId, userId, prestart } = caller.context;
  const admin = createSupabaseAdminClient();
  const { data: employee, error: employeeError } = await loggedRead(
    'getSelfContext: employee_records read failed',
    admin
      .from('employee_records')
      .select('id')
      .eq('organization_id', orgId)
      .eq('user_id', userId)
      .maybeSingle(),
  );
  if (employeeError) return { success: false, error: 'load_failed' };
  if (!employee) return { success: false, error: 'record_not_found' };
  return {
    success: true,
    admin,
    organizationId: orgId,
    actorId: userId,
    employeeRecordId: employee.id,
    prestart,
  };
}

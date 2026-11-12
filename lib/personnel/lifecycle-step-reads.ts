import 'server-only';

import type { ActionFailure } from '@/lib/action-result';
import { loggedRead } from '@/lib/data/read-request-cache';
import { getBusinessTodayIso } from '@/lib/date-time/berlin';
import type { AdminClient } from '@/lib/supabase/admin';
import type { Database } from '@/lib/supabase/database.types';

import type { PersonnelAccessTransitionKind, PersonnelEmploymentTransitionKind } from './lifecycle';
import { allowedAccessSteps, allowedEmploymentSteps, OPEN_REQUIREMENT_STATES } from './lifecycle-steps';

// The reads behind the lifecycle steps: the view offers the steps that fit,
// and the transition actions refuse any other step before the database call.

type Tables = Database['public']['Tables'];
type AccessLifecycleRow = Tables['personnel_access_lifecycles']['Row'];
type EmploymentLifecycleRow = Tables['personnel_employment_lifecycles']['Row'];

type ReadResult<Row> = { data: Row | null; error: { code?: string } | null };

export type PersonnelLifecycleSteps = {
  access: PersonnelAccessTransitionKind[];
  employment: PersonnelEmploymentTransitionKind[];
};

/** The person's record as the steps read it: the login and the entry and exit dates. */
type StepRecord = {
  admin: AdminClient;
  organizationId: string;
  userId: string | null;
  entryDate: string | null;
  exitDate: string | null;
};

export async function readAccessLifecycle(
  admin: AdminClient,
  organizationId: string,
  employeeRecordId: string,
): Promise<ReadResult<AccessLifecycleRow>> {
  return admin
    .from('personnel_access_lifecycles')
    .select('*')
    .eq('employee_record_id', employeeRecordId)
    .eq('organization_id', organizationId)
    .maybeSingle();
}

export async function readEmploymentLifecycle(
  admin: AdminClient,
  organizationId: string,
  employeeRecordId: string,
): Promise<ReadResult<EmploymentLifecycleRow>> {
  return admin
    .from('personnel_employment_lifecycles')
    .select('*')
    .eq('employee_record_id', employeeRecordId)
    .eq('organization_id', organizationId)
    .maybeSingle();
}

/** The person's membership in the organization; a record without a login has none. */
export async function readMembership(
  admin: AdminClient,
  organizationId: string,
  userId: string | null,
): Promise<ReadResult<{ user_id: string }>> {
  if (!userId) return { data: null, error: null };
  return admin
    .from('organization_members')
    .select('user_id')
    .eq('organization_id', organizationId)
    .eq('user_id', userId)
    .maybeSingle();
}

const toScheduled = <State extends string>(
  row: { state: State; scheduled_state: State | null; scheduled_for: string | null } | null,
) =>
  row ? { state: row.state, scheduledState: row.scheduled_state, scheduledFor: row.scheduled_for } : null;

/** The access and employment steps that fit the person's lifecycle rows now. */
export function lifecycleSteps(input: {
  access: AccessLifecycleRow | null;
  employment: EmploymentLifecycleRow | null;
  isMember: boolean;
  hasAccessBlocker: boolean;
  entryDate: string | null;
  exitDate: string | null;
}): PersonnelLifecycleSteps {
  return {
    access: allowedAccessSteps({
      lifecycle: toScheduled(input.access),
      isMember: input.isMember,
      hasAccessBlocker: input.hasAccessBlocker,
      now: Date.now(),
    }),
    employment: allowedEmploymentSteps({
      lifecycle: toScheduled(input.employment),
      entryDate: input.entryDate,
      exitDate: input.exitDate,
      today: getBusinessTodayIso(),
    }),
  };
}

/**
 * Whether the organization already recorded this operation. A retry of a
 * recorded transition goes straight to the database function, which answers
 * with the stored result or refuses a changed request (`operation_id_conflict`);
 * the state has moved on since, so the step checks would wrongly refuse it.
 */
async function readRecordedOperation(
  admin: AdminClient,
  organizationId: string,
  operationId: string,
): Promise<ReadResult<{ operation_id: string }>> {
  return admin
    .from('personnel_lifecycle_operations')
    .select('operation_id')
    .eq('organization_id', organizationId)
    .eq('operation_id', operationId)
    .maybeSingle();
}

const loadFailed: ActionFailure = { success: false, error: 'load_failed' };
const staleVersion: ActionFailure = { success: false, error: 'stale_version' };
const notAllowed: ActionFailure = { success: false, error: 'transition_not_allowed' };

/**
 * Refuses a new access step that does not fit the person's access at the
 * version the caller saw. The database function locks the lifecycle and
 * checks that version again, so the state read here is the one it changes.
 * A recorded operation passes to the function's replay check.
 */
export async function refuseUnfitAccessStep(
  record: StepRecord,
  request: {
    employeeRecordId: string;
    expectedVersion: number;
    transitionKind: PersonnelAccessTransitionKind;
    operationId: string;
  },
): Promise<ActionFailure | null> {
  const { admin, organizationId } = record;
  const [recorded, lifecycle, membership, blocker] = await Promise.all([
    loggedRead(
      'refuseUnfitAccessStep: operation read failed',
      readRecordedOperation(admin, organizationId, request.operationId),
    ),
    loggedRead(
      'refuseUnfitAccessStep: access lifecycle read failed',
      readAccessLifecycle(admin, organizationId, request.employeeRecordId),
    ),
    loggedRead(
      'refuseUnfitAccessStep: membership read failed',
      readMembership(admin, organizationId, record.userId),
    ),
    loggedRead(
      'refuseUnfitAccessStep: access blocker read failed',
      admin
        .from('personnel_onboarding_requirements')
        .select('id')
        .eq('organization_id', organizationId)
        .eq('employee_record_id', request.employeeRecordId)
        .eq('blocks_access', true)
        .in('state', OPEN_REQUIREMENT_STATES)
        .limit(1),
    ),
  ]);
  if (recorded.error || lifecycle.error || membership.error || blocker.error) return loadFailed;
  if (recorded.data) return null;
  if ((lifecycle.data?.version ?? 0) !== request.expectedVersion) return staleVersion;
  const steps = allowedAccessSteps({
    lifecycle: toScheduled(lifecycle.data),
    isMember: membership.data !== null,
    hasAccessBlocker: (blocker.data ?? []).length > 0,
    now: Date.now(),
  });
  return steps.includes(request.transitionKind) ? null : notAllowed;
}

/**
 * Refuses a new employment step that does not fit the person's employment at
 * the version the caller saw. A recorded operation passes to the function's
 * replay check.
 */
export async function refuseUnfitEmploymentStep(
  record: StepRecord,
  request: {
    employeeRecordId: string;
    expectedVersion: number;
    transitionKind: PersonnelEmploymentTransitionKind;
    operationId: string;
  },
): Promise<ActionFailure | null> {
  const [recorded, lifecycle] = await Promise.all([
    loggedRead(
      'refuseUnfitEmploymentStep: operation read failed',
      readRecordedOperation(record.admin, record.organizationId, request.operationId),
    ),
    loggedRead(
      'refuseUnfitEmploymentStep: employment lifecycle read failed',
      readEmploymentLifecycle(record.admin, record.organizationId, request.employeeRecordId),
    ),
  ]);
  if (recorded.error || lifecycle.error) return loadFailed;
  if (recorded.data) return null;
  if ((lifecycle.data?.version ?? 0) !== request.expectedVersion) return staleVersion;
  const steps = allowedEmploymentSteps({
    lifecycle: toScheduled(lifecycle.data),
    entryDate: record.entryDate,
    exitDate: record.exitDate,
    today: getBusinessTodayIso(),
  });
  return steps.includes(request.transitionKind) ? null : notAllowed;
}

'use server';

import type { ActionFailure } from '@/lib/action-result';
import { authenticateAndAuthorize } from '@/lib/jobs/auth';
import { createSupabaseAdminClient } from '@/lib/supabase/admin';
import { getBusinessTodayIso } from '@/lib/date-time/berlin';
import type { PersonnelQualificationSummary, QualificationWorkspace } from './types';
import {
  loadQualificationWorkspace,
  readCurrentQualificationRows,
  readQualificationReferences,
  resolveSummaryEmployeeRecord,
} from './qualification-reads';
import { toCapabilityDefinition, toEmployeeCapability } from './server';
import { logError } from '@/lib/logging';
import { uuidSchema } from '@/lib/validation/uuid';

// The office's qualification reads: the workspace and one employee's summary.

export async function getQualificationWorkspace(): Promise<
  { success: true; data: QualificationWorkspace } | ActionFailure
> {
  try {
    const auth = await authenticateAndAuthorize();
    if (!auth.success) return auth;
    if (!auth.context.isManagerOrAbove) {
      return { success: false, error: 'not_authorized' };
    }
    const { orgId, role } = auth.context;
    const admin = createSupabaseAdminClient();
    const workspace = await loadQualificationWorkspace(admin, orgId, role === 'admin');
    if (!workspace) return { success: false, error: 'load_failed' };

    return { success: true, data: workspace };
  } catch (error) {
    logError('Unexpected error in getQualificationWorkspace:', error);
    return { success: false, error: 'unexpected_error' };
  }
}

export async function getPersonnelQualificationSummary(
  employeeRecordIdOrUserIdInput: string,
): Promise<{ success: true; data: PersonnelQualificationSummary | null } | ActionFailure> {
  const parsedEmployeeRecordIdOrUserId = uuidSchema.safeParse(employeeRecordIdOrUserIdInput);
  if (!parsedEmployeeRecordIdOrUserId.success) return { success: false, error: 'invalid_input' };
  const employeeRecordIdOrUserId = parsedEmployeeRecordIdOrUserId.data;
  try {
    const auth = await authenticateAndAuthorize();
    if (!auth.success) return auth;
    if (!auth.context.isManagerOrAbove) {
      return { success: false, error: 'not_authorized' };
    }

    const { orgId } = auth.context;
    const admin = createSupabaseAdminClient();
    const resolved = await resolveSummaryEmployeeRecord(admin, orgId, employeeRecordIdOrUserId);
    if (!resolved.success) return resolved;
    const employeeRecord = resolved.record;
    if (!employeeRecord) return { success: true, data: null };

    const today = getBusinessTodayIso();
    const [membershipsResult, capabilityRowsResult] = await readCurrentQualificationRows(
      admin,
      orgId,
      employeeRecord.id,
      today,
    );
    if (membershipsResult.error || capabilityRowsResult.error) {
      logError(
        'Failed to load personnel qualification summary:',
        membershipsResult.error ?? capabilityRowsResult.error,
      );
      return { success: false, error: 'load_failed' };
    }
    if ((membershipsResult.data?.length ?? 0) > 500 || (capabilityRowsResult.data?.length ?? 0) > 500) {
      logError('Personnel qualification summary size limit exceeded.');
      return { success: false, error: 'load_failed' };
    }

    const teamIds = [...new Set((membershipsResult.data ?? []).map((row) => row.team_id))];
    const capabilityIds = [...new Set((capabilityRowsResult.data ?? []).map((row) => row.capability_id))];
    const [teamsResult, definitionsResult] = await readQualificationReferences(
      admin,
      orgId,
      teamIds,
      capabilityIds,
    );
    if (teamsResult.error || definitionsResult.error) {
      logError(
        'Failed to load personnel qualification references:',
        teamsResult.error ?? definitionsResult.error,
      );
      return { success: false, error: 'load_failed' };
    }

    const definitionById = new Map(
      definitionsResult.data.map((row) => [row.id, toCapabilityDefinition(row)]),
    );
    return {
      success: true,
      data: {
        teamNames: teamsResult.data
          .map((team) => team.name)
          .sort((left, right) => left.localeCompare(right, 'de-DE')),
        entries: (capabilityRowsResult.data ?? []).flatMap((row) => {
          const definition = definitionById.get(row.capability_id);
          return definition ? [{ definition, record: toEmployeeCapability(row) }] : [];
        }),
      },
    };
  } catch (error) {
    logError('Unexpected error in getPersonnelQualificationSummary:', error);
    return { success: false, error: 'unexpected_error' };
  }
}

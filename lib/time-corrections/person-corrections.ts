import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/supabase/database.types';
import { loadApprovedCorrectionProjection } from './approved-projection';
import type { TimeCorrectionApplicationProjection } from './types';

/**
 * The applications with only the facts of each person's effective employee
 * record, the one `recordByUser` names for them now. Each application keeps
 * every source it replaces. A fact that names a person on a record they no
 * longer hold is retained data of a removed employee
 * (docs/technical/security.md, "Calendar correction input boundary"); a
 * person without a record keeps no fact.
 */
export function keepEffectiveFacts(
  applications: readonly TimeCorrectionApplicationProjection[],
  recordByUser: ReadonlyMap<string, string>,
): TimeCorrectionApplicationProjection[] {
  return applications.map((application) => ({
    ...application,
    snapshot: {
      ...application.snapshot,
      facts: application.snapshot.facts.filter(
        (fact) => recordByUser.get(fact.userId) === fact.employeeRecordId,
      ),
    },
  }));
}

/**
 * One person's approved corrections of a window, with only the facts of their
 * effective employee record (`keepEffectiveFacts`). The caller authorized the
 * person and resolves the record; its read runs beside the correction read.
 */
export async function loadPersonCorrections(
  admin: SupabaseClient<Database>,
  input: {
    organizationId: string;
    userId: string;
    employeeRecordId: Promise<string | null>;
    from: string;
    to: string;
  },
): Promise<TimeCorrectionApplicationProjection[]> {
  const [employeeRecordId, applications] = await Promise.all([
    input.employeeRecordId,
    loadApprovedCorrectionProjection(admin, {
      organizationId: input.organizationId,
      userIds: [input.userId],
      from: input.from,
      to: input.to,
    }),
  ]);
  return keepEffectiveFacts(
    applications,
    new Map(employeeRecordId === null ? [] : [[input.userId, employeeRecordId]]),
  );
}

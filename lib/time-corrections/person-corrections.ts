import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/supabase/database.types';
import { loadApprovedCorrectionProjection } from './approved-projection';
import type { TimeCorrectionApplicationProjection } from './types';

/**
 * One person's approved corrections of a window, as the views of their time
 * count them. Each application keeps every source it replaces, and only the
 * facts of the person's effective employee record: a fact that names their
 * user on a record they no longer hold is retained data of a removed employee
 * (docs/technical/security.md, "Calendar correction input boundary"). Without
 * an effective record no fact counts. The caller authorized the person and
 * resolves the record; its read runs beside the correction read.
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
  return applications.map((application) => ({
    ...application,
    snapshot: {
      ...application.snapshot,
      facts: application.snapshot.facts.filter(
        (fact) =>
          employeeRecordId !== null &&
          fact.employeeRecordId === employeeRecordId &&
          fact.userId === input.userId,
      ),
    },
  }));
}

import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/supabase/database.types';
import { readInBatches } from '@/lib/supabase/query-batches';
import { loadApprovedCorrectionProjection } from './approved-projection';
import type { TimeCorrectionApplicationProjection, TimeCorrectionFact } from './types';

/**
 * Whether a fact names the employee record its person holds now, the one
 * `recordByUser` names for them. A fact that names a person on a record they
 * no longer hold is retained data of a removed employee
 * (docs/technical/security.md, "Calendar correction input boundary"); a
 * person without a record keeps no fact.
 */
export function isEffectiveFact(
  fact: Pick<TimeCorrectionFact, 'userId' | 'employeeRecordId'>,
  recordByUser: ReadonlyMap<string, string>,
): boolean {
  return recordByUser.get(fact.userId) === fact.employeeRecordId;
}

/** The employee record each of the people holds in the organization now. */
export async function readRecordByUser(
  admin: SupabaseClient<Database>,
  organizationId: string,
  userIds: readonly string[],
): Promise<ReadonlyMap<string, string>> {
  const { data, error } = await readInBatches(userIds, (batch) =>
    admin
      .from('employee_records')
      .select('id, user_id')
      .eq('organization_id', organizationId)
      .in('user_id', [...batch]),
  );
  if (error) throw new Error('The employee records of the corrections could not be read.');
  return new Map(data.flatMap((row) => (row.user_id === null ? [] : [[row.user_id, row.id] as const])));
}

/**
 * The applications with only their effective facts (`isEffectiveFact`). Each
 * application keeps every source it replaces.
 */
export function keepEffectiveFacts(
  applications: readonly TimeCorrectionApplicationProjection[],
  recordByUser: ReadonlyMap<string, string>,
): TimeCorrectionApplicationProjection[] {
  return applications.map((application) => ({
    ...application,
    snapshot: {
      ...application.snapshot,
      facts: application.snapshot.facts.filter((fact) => isEffectiveFact(fact, recordByUser)),
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

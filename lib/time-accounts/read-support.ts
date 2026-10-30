import 'server-only';

import type { PostgrestSingleResponse } from '@supabase/supabase-js';

import type { ActionResult } from '@/lib/action-result';
import { logReadFailure } from '@/lib/data/read-request-cache';
import type { AdminClient } from '@/lib/supabase/admin';
import { readInBatches } from '@/lib/supabase/query-batches';
import { requirePeriodRows } from './period-sources';

// Steps the time-account page readers in queries.ts share: the region's
// failure shape and the employee names every list shows.

/** The trusted caller of a reader: `requireAuth` resolved it. */
export type ReaderContext = { orgId: string; userId: string };

/** A page region's read: its data, or the stable code of a failed read. */
export type TimeAccountRead<Data> = ActionResult<{ data: Data }>;

// A failed read throws inside a reader and becomes `read_failed` here, so a
// page shows a retry instead of an empty account, list or period.
export async function readRegion<Data>(
  label: string,
  read: () => Promise<Data>,
): Promise<TimeAccountRead<Data>> {
  try {
    return { success: true, data: await read() };
  } catch (error) {
    logReadFailure(label, error);
    return { success: false, error: 'read_failed' };
  }
}

export function requireRead<Data>(result: PostgrestSingleResponse<Data>): Data {
  if (result.error) throw result.error;
  return result.data;
}

export type NamedEmployee = {
  id: string;
  user_id: string | null;
  first_name: string | null;
  last_name: string | null;
};
export type NamedProfile = { id: string; first_name: string | null; last_name: string | null };

// The profile name wins over the personnel record, as everywhere in Zeiterfassung.
export function mapEmployeeNames(
  employees: readonly NamedEmployee[],
  profiles: readonly NamedProfile[],
): Map<string, string> {
  const profileById = new Map(profiles.map((profile) => [profile.id, profile]));
  return new Map(
    employees.map((employee) => {
      const profile = employee.user_id ? profileById.get(employee.user_id) : undefined;
      const name =
        [profile?.first_name ?? employee.first_name, profile?.last_name ?? employee.last_name]
          .filter(Boolean)
          .join(' ') || 'Unbekannt';
      return [employee.id, name];
    }),
  );
}

/** Rows ordered by their employee's name, so every settings list reads alike in every organization. */
export function byEmployeeName<Row>(
  rows: readonly Row[],
  employeeIdOf: (row: Row) => string,
  nameOf: (employeeRecordId: string) => string,
): Row[] {
  return [...rows].sort((left, right) =>
    nameOf(employeeIdOf(left)).localeCompare(nameOf(employeeIdOf(right)), 'de'),
  );
}

export async function readProfiles(
  admin: AdminClient,
  employees: readonly NamedEmployee[],
): Promise<NamedProfile[]> {
  const userIds = employees.flatMap((employee) => (employee.user_id ? [employee.user_id] : []));
  const { data: profiles } = requirePeriodRows(
    await readInBatches(userIds, (batch) =>
      admin
        .from('profiles')
        .select('id, first_name, last_name')
        .in('id', [...batch]),
    ),
  );
  return profiles;
}

export async function readEmployeeNames(
  admin: AdminClient,
  organizationId: string,
  employeeIds: readonly string[],
): Promise<Map<string, string>> {
  const { data: employees } = requirePeriodRows(
    await readInBatches([...new Set(employeeIds)], (batch) =>
      admin
        .from('employee_records')
        .select('id, user_id, first_name, last_name')
        .eq('organization_id', organizationId)
        .in('id', [...batch]),
    ),
  );
  return mapEmployeeNames(employees, await readProfiles(admin, employees));
}

import { createAdminClient } from './shared';

// Berufsschule days (werk-flow/werkflow-planning#165): setup for the audit
// and acceptance worlds. The product writes them through
// lib/personnel/school-day-actions.ts.

/** Stores one school rule of a record: a weekly weekday (0 = Montag) or a block. Returns its id. */
export async function seedSchoolDay(input: {
  organizationId: string;
  employeeRecordId: string;
  actorUserId: string;
  rule:
    | { kind: 'weekday'; weekday: number; startDate: string }
    | { kind: 'block'; startDate: string; endDate: string };
}): Promise<string> {
  const { rule } = input;
  const { data, error } = await createAdminClient()
    .from('school_days')
    .insert({
      organization_id: input.organizationId,
      employee_record_id: input.employeeRecordId,
      created_by: input.actorUserId,
      kind: rule.kind,
      weekday: rule.kind === 'weekday' ? rule.weekday : null,
      start_date: rule.startDate,
      end_date: rule.kind === 'block' ? rule.endDate : null,
    })
    .select('id')
    .single();
  if (error) throw new Error(`School day setup failed: ${error.message}`);
  return data.id;
}

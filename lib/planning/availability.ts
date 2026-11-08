// Whether a person can be planned on a date at all: employed, and with app
// access. The planning assessment warns on these facts, and the assignment
// picker marks the people they exclude, so both read one rule.

import { formatBerlinLocalDate } from '@/lib/date-time/berlin';
import type { Tables } from '@/lib/supabase/database.types';
import { formatGermanDate } from '@/lib/utils';

type AccessLifecycleFacts = Pick<
  Tables<'personnel_access_lifecycles'>,
  'state' | 'state_effective_at' | 'scheduled_state' | 'scheduled_for'
>;

/** A personnel record with the employment dates and access lifecycle the rule reads. */
export type AvailabilityRecord = Pick<Tables<'employee_records'>, 'id' | 'entry_date' | 'exit_date'> & {
  personnel_access_lifecycles: AccessLifecycleFacts[];
};

/**
 * The Berlin date from which a person's app access has ended, by an ended
 * state or an end already scheduled; undefined while access goes on.
 */
function accessEndDateOf(lifecycle: AccessLifecycleFacts | undefined): string | undefined {
  if (!lifecycle) return undefined;
  if (lifecycle.state === 'ended') return formatBerlinLocalDate(lifecycle.state_effective_at);
  if (lifecycle.scheduled_state === 'ended' && lifecycle.scheduled_for) {
    return formatBerlinLocalDate(lifecycle.scheduled_for);
  }
  return undefined;
}

/** The Berlin date from which each record's app access has ended, for the records whose access ends. */
export function accessEndDatesByRecord(
  records: ReadonlyArray<Pick<AvailabilityRecord, 'id' | 'personnel_access_lifecycles'>>,
): Map<string, string> {
  return new Map(
    records.flatMap((record) => {
      const endDate = accessEndDateOf(record.personnel_access_lifecycles[0]);
      return endDate ? [[record.id, endDate] as const] : [];
    }),
  );
}

/**
 * Why the person cannot be planned on the Berlin date, as the picker marks
 * it; null when nothing excludes them.
 */
export function availabilityNote(record: AvailabilityRecord, localDate: string): string | null {
  if (record.exit_date && localDate > record.exit_date) {
    return `Ausgetreten am ${formatGermanDate(record.exit_date)}`;
  }
  if (record.entry_date && localDate < record.entry_date) {
    return `Eintritt am ${formatGermanDate(record.entry_date)}`;
  }
  const accessEndDate = accessEndDateOf(record.personnel_access_lifecycles[0]);
  if (accessEndDate && accessEndDate <= localDate) {
    return `App-Zugang beendet am ${formatGermanDate(accessEndDate)}`;
  }
  return null;
}

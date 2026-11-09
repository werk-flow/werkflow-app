// Whether a person can be planned on a date at all: employed, and with app
// access. The planning assessment warns on these facts, the assignment
// picker marks the people they exclude, and the calendar shows their visits
// as missing a person, so all of them read one rule.

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

/** The facts that decide whether a person can be planned on a Berlin date. */
export type PlanningAvailabilityFacts = {
  entryDate: string | null;
  exitDate: string | null;
  /** The Berlin date from which app access has ended; null while it goes on. */
  accessEndDate: string | null;
};

/** Why a person cannot be planned on a date: after their exit, before their entry, or with app access ended. */
export type Unavailability = 'after_exit' | 'before_entry' | 'access_ended';

/**
 * The one rule of who can be planned on a Berlin date. The picker marks it,
 * and the calendar treats an assignment it refuses like a missing one.
 */
export function unavailabilityOn(facts: PlanningAvailabilityFacts, localDate: string): Unavailability | null {
  if (facts.exitDate && localDate > facts.exitDate) return 'after_exit';
  if (facts.entryDate && localDate < facts.entryDate) return 'before_entry';
  if (facts.accessEndDate && facts.accessEndDate <= localDate) return 'access_ended';
  return null;
}

/**
 * Why the person cannot be planned on the Berlin date, as the picker marks
 * it; null when nothing excludes them.
 */
export function availabilityNote(record: AvailabilityRecord, localDate: string): string | null {
  const accessEndDate = accessEndDateOf(record.personnel_access_lifecycles[0]) ?? null;
  const facts = { entryDate: record.entry_date, exitDate: record.exit_date, accessEndDate };
  switch (unavailabilityOn(facts, localDate)) {
    case 'after_exit':
      return `Ausgetreten am ${formatGermanDate(record.exit_date ?? localDate)}`;
    case 'before_entry':
      return `Eintritt am ${formatGermanDate(record.entry_date ?? localDate)}`;
    case 'access_ended':
      return `App-Zugang beendet am ${formatGermanDate(accessEndDate ?? localDate)}`;
    case null:
      return null;
  }
}

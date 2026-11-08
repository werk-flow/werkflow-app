// Isolated stand-in for the affected-visits read and the office's sickness
// save (`@/lib/sickness/actions` of the record form). The spec sets what the
// read answers before it acts.
import type { AbsenceAffectedVisits, AbsenceAffectedVisitsInput } from '@/lib/calendar/absence-visits-types';
import type { CreateSicknessReportResult } from '@/lib/sickness/actions';

export const ABSENT_RECORD_ID = '00000000-0000-4000-8000-000000000021';
export const PRESENT_RECORD_ID = '00000000-0000-4000-8000-000000000022';

declare global {
  interface Window {
    uiContractAbsence: {
      /** What the affected-visits read answers next; null fails it. */
      affected: AbsenceAffectedVisits | null;
      reads: AbsenceAffectedVisitsInput[];
      closed: boolean | null;
    };
  }
}

window.uiContractAbsence = {
  affected: {
    through: '2026-11-12',
    visits: [
      {
        occurrenceId: 'contract-visit-1',
        date: '2026-10-30',
        time: '08:00',
        title: 'Heizungswartung Familie Berger',
        jobNumber: 'AUF-2026-145',
        dispatchState: 'ausstehend',
      },
      {
        occurrenceId: 'contract-visit-2',
        date: '2026-11-02',
        time: null,
        title: 'Badsanierung Projekt Lindenstraße',
        jobNumber: 'AUF-2026-150',
        dispatchState: 'nicht_gesendet',
      },
    ],
  },
  reads: [],
  closed: null,
};

export async function readAffectedVisitsContract(
  input: AbsenceAffectedVisitsInput,
): Promise<({ success: true } & AbsenceAffectedVisits) | { success: false; error: string }> {
  const state = window.uiContractAbsence;
  state.reads.push(input);
  return state.affected
    ? { success: true, ...structuredClone(state.affected) }
    : { success: false, error: 'load_failed' };
}

/** The office's save: accepted at once, open-ended from the chosen start. */
export async function recordSicknessForMember(input: {
  employeeRecordId: string;
  startDate: string;
  endDate: string | null;
}): Promise<CreateSicknessReportResult> {
  return {
    success: true,
    vacationOverlap: false,
    report: {
      id: 'contract-sickness',
      organizationId: 'contract-organization',
      employeeRecordId: input.employeeRecordId,
      absenceType: 'krankheit',
      startDate: input.startDate,
      endDate: input.endDate,
      dayPortion: 'full',
      status: 'reported',
      evidenceRequired: false,
      evidenceStatus: 'not_required',
      reportedBy: 'contract-user',
      cancelledBy: null,
      cancelledAt: null,
      cancellationReason: null,
      createdAt: '2026-10-30T05:45:00.000Z',
      updatedAt: '2026-10-30T05:45:00.000Z',
    },
  };
}

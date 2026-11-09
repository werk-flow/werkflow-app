// The absence surfaces under contract: the office's sickness dialog with its
// affected visits, and the person pickers inside the calendar's window of
// capacity days. Their reads and the save answer from absence-service-boundaries.ts.
import { useState } from 'react';
import { BoardAbsencesContext } from '@/components/kalender/board-absences-context';
import { PlanningEntryAssignmentFields } from '@/components/kalender/planning-entry-fields';
import { ScheduleParkedDialog } from '@/components/kalender/schedule-parked-dialog';
import { RecordSicknessDialog } from '@/components/mitarbeiter/sickness-report-record-dialog';
import { BannerProvider } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import { usePlanningOptions } from '@/hooks/use-planning-options';
import { indexBoardAbsences } from '@/lib/calendar/absence-marks';
import type { CalendarBoardDay, CalendarBoardRow } from '@/lib/calendar/board';
import { ABSENT_RECORD_ID, PRESENT_RECORD_ID } from './absence-service-boundaries';
import { CalendarOrganizationContext, contractJob } from './calendar-service-boundaries';

/** The member page's opener and the office's record dialog. */
export function SicknessRecordContractFixture(): React.JSX.Element {
  const [open, setOpen] = useState(false);
  return (
    <BannerProvider>
      <main>
        <h1>Komponentenverträge</h1>
        <Button type="button" onClick={() => setOpen(true)}>
          Krankmeldung öffnen
        </Button>
        {open && (
          <RecordSicknessDialog
            recordId={ABSENT_RECORD_ID}
            onClose={(saved) => {
              window.uiContractAbsence.closed = saved;
              setOpen(false);
            }}
          />
        )}
      </main>
    </BannerProvider>
  );
}

function boardDay(employeeRecordId: string, date: string, sick: boolean): CalendarBoardDay {
  return {
    employeeRecordId,
    date,
    targetMinutes: sick ? 0 : 480,
    baseTargetMinutes: 480,
    reason: 'working',
    label: null,
    absence: sick ? { type: 'sickness', portion: 'full' } : null,
    pendingVacation: false,
  };
}

function boardRow(employeeRecordId: string, displayName: string): CalendarBoardRow {
  return {
    employeeRecordId,
    userId: null,
    displayName,
    role: 'employee',
    hasLogin: false,
    teamId: null,
    teamName: null,
    entryDate: null,
    exitDate: null,
  };
}

const WINDOW_ROWS = [boardRow(ABSENT_RECORD_ID, 'Daniel Krüger'), boardRow(PRESENT_RECORD_ID, 'Lena Brandt')];

/** The window holds 30.10.2026 only: Daniel is sick there, Lena works. */
const WINDOW_ABSENCES = indexBoardAbsences(
  [boardDay(ABSENT_RECORD_ID, '2026-10-30', true), boardDay(PRESENT_RECORD_ID, '2026-10-30', false)],
  WINDOW_ROWS,
);

function AbsencePicker(): React.JSX.Element {
  const [date, setDate] = useState('2026-10-30');
  const [employeeRecordIds, setEmployeeRecordIds] = useState<string[]>([]);
  const [teamIds, setTeamIds] = useState<string[]>([]);
  const employees = usePlanningOptions('employees', employeeRecordIds);
  const teams = usePlanningOptions('teams', teamIds);
  return (
    <>
      <Button type="button" variant="outline" onClick={() => setDate('2026-11-20')}>
        Anderen Tag wählen
      </Button>
      <PlanningEntryAssignmentFields
        date={date}
        employeeSelect={employees.select}
        employeeRecordIds={employees.selectedIds}
        onEmployeeRecordIdsChange={setEmployeeRecordIds}
        teamSelect={teams.select}
        teamIds={teamIds}
        onTeamIdsChange={setTeamIds}
        onConflictsChange={() => undefined}
      />
    </>
  );
}

export function AbsencePickerContractFixture(): React.JSX.Element {
  return (
    <CalendarOrganizationContext.Provider value="00000000-0000-4000-8000-000000000001">
      <BoardAbsencesContext value={WINDOW_ABSENCES}>
        <main className="max-w-md p-4">
          <h1>Komponentenverträge</h1>
          <AbsencePicker />
        </main>
      </BoardAbsencesContext>
    </CalendarOrganizationContext.Provider>
  );
}

/** „Einplanen am …“ for a parked job, inside the same window. */
export function ScheduleParkedPickerContractFixture(): React.JSX.Element {
  const [open, setOpen] = useState(false);
  return (
    <BoardAbsencesContext value={WINDOW_ABSENCES}>
      <main>
        <h1>Komponentenverträge</h1>
        <Button type="button" onClick={() => setOpen(true)}>
          Einplanen am …
        </Button>
        {open && (
          <ScheduleParkedDialog
            job={contractJob('Heizungswartung Familie Berger')}
            rows={WINDOW_ROWS}
            onClose={() => setOpen(false)}
            onSchedule={() => setOpen(false)}
          />
        )}
      </main>
    </BoardAbsencesContext>
  );
}

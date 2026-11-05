'use client';

import dynamic from 'next/dynamic';
import type { useBanner } from '@/components/ui/banner';
import type { CalendarBoardRow } from '@/lib/calendar/board';
import type { CalendarJob } from '@/lib/jobs/types';
import { isOrgRole, type OrgRole } from '@/lib/roles';
import type { InteractiveCalendarSession, TimeEntry } from '@/lib/time-tracking/types';
import { ShortcutsHelp } from './board/shortcuts-help';
import { CalendarEntryDialog } from './calendar-entry-dialog';
import { DispatchIssueDialog } from './dispatch-issue-dialog';
import { DispatchPanel } from './dispatch-panel';
import { JobEventPopover } from './job-event-popover';
import type { CalendarMember } from './members';
import type { CalendarMutations } from './mutations/use-calendar-mutations';
import { ParkingContextDialog } from './parking-context-dialog';
import { ScheduleParkedDialog } from './schedule-parked-dialog';
import type { CalendarData } from './use-calendar-data';
import type { CalendarAddEntry, CalendarOverlays } from './use-calendar-overlays';
import type { CalendarViewScope } from './use-calendar-view-scope';
import type { ParkFlowState } from './use-park-flow';

const EntryDetailsDialog = dynamic(
  () => import('./entry-details-dialog').then((mod) => mod.EntryDetailsDialog),
  { ssr: false },
);

type ShowBanner = ReturnType<typeof useBanner>['showBanner'];

/** The Parkplatz context of `job`; it settles the park flow a drag or a card command started. */
function ParkingContextOverlay({
  job,
  parkFlow,
  data,
  showBanner,
}: {
  job: CalendarJob;
  parkFlow: ParkFlowState;
  data: CalendarData;
  showBanner: ShowBanner;
}): React.JSX.Element {
  const { parkFlowRef, setParkingContextJob } = parkFlow;
  return (
    <ParkingContextDialog
      jobId={job.jobId ?? job.id}
      jobTitle={job.title}
      expectedExecutionVersion={job.executionVersion ?? 0}
      isAlreadyParked={!parkFlow.hasPendingPark()}
      existingContext={data.parkingContexts?.get(job.jobId ?? job.id) ?? null}
      onClose={() => {
        parkFlowRef.current?.cancelled();
        parkFlowRef.current = null;
        setParkingContextJob(null);
      }}
      onSaveStart={() => (parkFlowRef.current ? () => undefined : data.handleOperationStart())}
      onSaveFailed={() => {
        parkFlowRef.current?.failed();
        parkFlowRef.current = null;
      }}
      onSaved={async () => {
        const flow = parkFlowRef.current;
        parkFlowRef.current = null;
        // The contexts map is current before the dialog closes: a Parkplatz card dragged right after the
        // save reads it at the pointer, and a stale map would refuse the drop as „ohne Kontext“.
        await data.fetchParkingContexts();
        setParkingContextJob(null);
        if (flow) {
          flow.saved(() => parkFlow.undoPark(job));
          return;
        }
        showBanner({ variant: 'success', message: 'Parkplatz-Kontext wurde gespeichert.' });
      }}
    />
  );
}

/** The details of the selected session, with the names the calendar already holds. */
function EntryDetailsOverlay({
  session,
  members,
  data,
  currentUserId,
  currentUserRole,
  onClose,
}: {
  session: InteractiveCalendarSession;
  members: CalendarMember[];
  data: CalendarData;
  currentUserId: string;
  currentUserRole: OrgRole;
  onClose: () => void;
}): React.JSX.Element {
  const entryUserRole = members.find(
    (member) => member.user_id === (session.clockIn?.userId || session.clockOut?.userId),
  )?.role;
  return (
    <EntryDetailsDialog
      open
      onOpenChange={(open) => !open && onClose()}
      session={session}
      currentUserRole={currentUserRole}
      currentUserId={currentUserId}
      onRefresh={data.handleSilentRefresh}
      jobName={
        session.jobId ? (data.range.jobs.find((job) => job.id === session.jobId)?.title ?? null) : null
      }
      entryUserRole={entryUserRole !== undefined && isOrgRole(entryUserRole) ? entryUserRole : undefined}
    />
  );
}

/** The dispatch of a parked job, offered to the people the job names. */
function ParkedDispatchOverlay({
  job,
  onClose,
  onIssued,
}: {
  job: CalendarJob;
  onClose: () => void;
  onIssued: () => void;
}): React.JSX.Element {
  return (
    <DispatchIssueDialog
      target={{ jobId: job.jobId ?? job.id }}
      defaultRecipientUserIds={job.assignedUserIds}
      onClose={onClose}
      onIssued={onIssued}
    />
  );
}

/** The entry dialog a surface gesture opened, with the day, time and person of that gesture. */
function AddEntryOverlay({
  addEntry,
  onClose,
  onManualEntrySuccess,
  onJobSuccess,
}: {
  addEntry: CalendarAddEntry;
  onClose: () => void;
  onManualEntrySuccess: (entries: TimeEntry[]) => void;
  onJobSuccess: () => void;
}): React.JSX.Element {
  return (
    <CalendarEntryDialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      preselectedDate={new Date(`${addEntry.date}T12:00:00`)}
      preselectedUserId={addEntry.userId}
      preselectedClockInTime={addEntry.time}
      preselectedClockOutTime={addEntry.endTime}
      onManualEntrySuccess={onManualEntrySuccess}
      onJobSuccess={onJobSuccess}
    />
  );
}

type CalendarDialogsProps = {
  overlays: CalendarOverlays;
  parkFlow: ParkFlowState;
  data: CalendarData;
  viewScope: CalendarViewScope;
  mutations: CalendarMutations;
  members: CalendarMember[];
  boardRows: CalendarBoardRow[];
  isAdminOrManager: boolean;
  currentUserId: string;
  currentUserRole: OrgRole;
  calendarHeaderHeight: number;
  showBanner: ShowBanner;
  announce: (message: string) => void;
  onManualEntrySuccess: (entries: TimeEntry[]) => void;
};

/**
 * The calendar's panels, dialogs and popover. Each one opens from the
 * overlay state; the Parkplatz context dialog settles the park flow that a
 * drag or a card command started.
 */
export function CalendarDialogs(props: CalendarDialogsProps): React.JSX.Element {
  const { overlays, parkFlow, data, viewScope, mutations, members, boardRows, isAdminOrManager } = props;
  const { currentUserId, currentUserRole, calendarHeaderHeight, showBanner, onManualEntrySuccess } = props;
  const { announce } = props;
  const { addEntry, setAddEntry, parkedDispatchJob, setParkedDispatchJob } = overlays;
  const { selectedSession, setSelectedSession } = overlays;
  const { parkingContextJob, scheduleParkedJob, setScheduleParkedJob } = parkFlow;
  const { handleSilentRefresh } = data;
  const boardRowsForForms = isAdminOrManager ? boardRows : [];
  return (
    <>
      {isAdminOrManager && overlays.dispatchPanelOpen && (
        <DispatchPanel
          onClose={() => overlays.setDispatchPanelOpen(false)}
          onChanged={handleSilentRefresh}
          primaryHeaderHeight={calendarHeaderHeight}
        />
      )}

      {isAdminOrManager && parkingContextJob && (
        <ParkingContextOverlay
          job={parkingContextJob}
          parkFlow={parkFlow}
          data={data}
          showBanner={showBanner}
        />
      )}

      {isAdminOrManager && parkedDispatchJob && (
        <ParkedDispatchOverlay
          job={parkedDispatchJob}
          onClose={() => setParkedDispatchJob(null)}
          onIssued={() => {
            setParkedDispatchJob(null);
            handleSilentRefresh();
          }}
        />
      )}

      {isAdminOrManager && scheduleParkedJob && (
        <ScheduleParkedDialog
          job={scheduleParkedJob}
          rows={boardRowsForForms}
          onClose={() => setScheduleParkedJob(null)}
          onSchedule={(input) => parkFlow.handleScheduleParked(scheduleParkedJob, input)}
        />
      )}

      {isAdminOrManager && addEntry && (
        <AddEntryOverlay
          addEntry={addEntry}
          onClose={() => setAddEntry(null)}
          onManualEntrySuccess={onManualEntrySuccess}
          onJobSuccess={() => {
            setAddEntry(null);
            announce('Eintrag wurde angelegt.');
            handleSilentRefresh();
          }}
        />
      )}

      <JobEventPopover
        card={overlays.openCard}
        onClose={() => overlays.setOpenCard(null)}
        memberNames={viewScope.memberNameMap}
        canEditPlanning={isAdminOrManager}
        rows={boardRowsForForms}
        mutations={isAdminOrManager ? mutations : null}
        onPark={isAdminOrManager ? parkFlow.handlePark : null}
      />

      {selectedSession && (
        <EntryDetailsOverlay
          session={selectedSession}
          members={members}
          data={data}
          currentUserId={currentUserId}
          currentUserRole={currentUserRole}
          onClose={() => setSelectedSession(null)}
        />
      )}
      <ShortcutsHelp open={overlays.helpOpen} onOpenChange={overlays.setHelpOpen} />
    </>
  );
}

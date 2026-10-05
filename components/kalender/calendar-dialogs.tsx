'use client';

import dynamic from 'next/dynamic';
import type { useBanner } from '@/components/ui/banner';
import type { CalendarBoardRow } from '@/lib/calendar/board';
import type { OrgRole } from '@/lib/members/actions';
import type { TimeEntry } from '@/lib/time-tracking/types';
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
import type { CalendarOverlays } from './use-calendar-overlays';
import type { CalendarViewScope } from './use-calendar-view-scope';
import type { ParkFlowState } from './use-park-flow';

const EntryDetailsDialog = dynamic(
  () => import('./entry-details-dialog').then((mod) => mod.EntryDetailsDialog),
  { ssr: false },
);

/**
 * The calendar's panels, dialogs and popover. Each one opens from the
 * overlay state; the Parkplatz context dialog settles the park flow that a
 * drag or a card command started.
 */
export function CalendarDialogs({
  overlays,
  parkFlow,
  data,
  viewScope,
  mutations,
  members,
  boardRows,
  isAdminOrManager,
  currentUserId,
  currentUserRole,
  calendarHeaderHeight,
  showBanner,
  announce,
  onManualEntrySuccess,
}: {
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
  showBanner: ReturnType<typeof useBanner>['showBanner'];
  announce: (message: string) => void;
  onManualEntrySuccess: (entries: TimeEntry[]) => void;
}): React.JSX.Element {
  const {
    addEntry,
    setAddEntry,
    parkedDispatchJob,
    setParkedDispatchJob,
    selectedSession,
    setSelectedSession,
  } = overlays;
  const { parkFlowRef, parkingContextJob, setParkingContextJob, scheduleParkedJob, setScheduleParkedJob } =
    parkFlow;
  const { handleSilentRefresh, parkingContexts } = data;
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
        <ParkingContextDialog
          jobId={parkingContextJob.jobId ?? parkingContextJob.id}
          jobTitle={parkingContextJob.title}
          expectedExecutionVersion={parkingContextJob.executionVersion ?? 0}
          isAlreadyParked={!parkFlow.hasPendingPark()}
          existingContext={parkingContexts?.get(parkingContextJob.jobId ?? parkingContextJob.id) ?? null}
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
            const job = parkingContextJob;
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
      )}

      {isAdminOrManager && parkedDispatchJob && (
        <DispatchIssueDialog
          target={{ jobId: parkedDispatchJob.jobId ?? parkedDispatchJob.id }}
          defaultRecipientUserIds={parkedDispatchJob.assignedUserIds}
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
        <CalendarEntryDialog
          open
          onOpenChange={(open) => {
            if (!open) setAddEntry(null);
          }}
          preselectedDate={new Date(`${addEntry.date}T12:00:00`)}
          preselectedUserId={addEntry.userId}
          preselectedClockInTime={addEntry.time}
          preselectedClockOutTime={addEntry.endTime}
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
        <EntryDetailsDialog
          open
          onOpenChange={(open) => !open && setSelectedSession(null)}
          session={selectedSession}
          currentUserRole={currentUserRole}
          currentUserId={currentUserId}
          onRefresh={handleSilentRefresh}
          jobName={
            selectedSession.jobId
              ? (data.range.jobs.find((job) => job.id === selectedSession.jobId)?.title ?? null)
              : null
          }
          entryUserRole={
            members.find(
              (member) =>
                member.user_id === (selectedSession.clockIn?.userId || selectedSession.clockOut?.userId),
            )?.role as OrgRole | undefined
          }
        />
      )}
      <ShortcutsHelp open={overlays.helpOpen} onOpenChange={overlays.setHelpOpen} />
    </>
  );
}

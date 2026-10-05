'use client';

import type { TimeEntry } from '@/lib/time-tracking/types';
import { CalendarHeader } from './calendar-header';
import { CalendarViewTabs } from './calendar-view-tabs';
import { BoardToolbar } from './board/board-toolbar';
import type { CalendarMember } from './members';
import type { CalendarOverlays } from './use-calendar-overlays';
import type { CalendarViewScope } from './use-calendar-view-scope';
import type { CalendarViewState } from './use-calendar-view-state';

/** The calendar's header and view tabs with the member scope and, on the desktop board, the board toolbar. */
export function CalendarToolbar({
  viewState,
  viewScope,
  overlays,
  members,
  isAdminOrManager,
  phone,
  todayIso,
  calendarHeaderRef,
  parkplatzButtonRef,
  onRefresh,
  onManualEntrySuccess,
  onSilentRefresh,
}: {
  viewState: CalendarViewState;
  viewScope: CalendarViewScope;
  overlays: CalendarOverlays;
  members: CalendarMember[];
  isAdminOrManager: boolean;
  phone: boolean;
  todayIso: string;
  calendarHeaderRef: React.RefObject<HTMLDivElement | null>;
  parkplatzButtonRef: React.RefObject<HTMLButtonElement | null>;
  onRefresh: () => Promise<void>;
  onManualEntrySuccess: (entries: TimeEntry[]) => void;
  onSilentRefresh: () => void;
}): React.JSX.Element {
  const { currentDate, view, setView, preferences, updatePreferences } = viewState;
  const { setParkplatzOpen, setDispatchPanelOpen, setHelpOpen } = overlays;
  return (
    <>
      <div ref={calendarHeaderRef}>
        <CalendarHeader
          currentDate={currentDate}
          view={view}
          todayIso={todayIso}
          horizonWeeks={preferences.horizonWeeks}
          onPrevious={viewState.handlePrevious}
          onNext={viewState.handleNext}
          onToday={viewState.handleToday}
          onRefresh={onRefresh}
          onManualEntrySuccess={onManualEntrySuccess}
          isAdminOrManager={isAdminOrManager}
          onJobSuccess={onSilentRefresh}
          parkedJobCount={viewScope.filteredParkedJobs.length}
          parkplatzOpen={overlays.parkplatzOpen}
          onParkplatzToggle={() => {
            setParkplatzOpen((open) => !open);
            setDispatchPanelOpen(false);
          }}
          parkplatzButtonRef={parkplatzButtonRef}
          dispatchPanelOpen={overlays.dispatchPanelOpen}
          onDispatchPanelToggle={() => {
            setDispatchPanelOpen((open) => !open);
            setParkplatzOpen(false);
          }}
        />
      </div>

      <div className="border-b px-4 py-2 sm:px-6">
        <CalendarViewTabs
          view={view}
          onViewChange={setView}
          members={members}
          selectedMemberIds={viewScope.selectedMemberIds}
          onSelectedMemberIdsChange={(memberUserIds) => updatePreferences({ memberUserIds })}
          isAdminOrManager={isAdminOrManager}
          showWorkingHours={viewState.showWorkingHours}
          onShowWorkingHoursChange={viewState.setShowWorkingHours}
          showJobs={preferences.showJobs}
          onShowJobsChange={(showJobs) => updatePreferences({ showJobs })}
        >
          {view === 'week' && !phone && isAdminOrManager && (
            <BoardToolbar
              preferences={preferences}
              onChange={updatePreferences}
              teams={viewScope.boardTeams}
              showActualTime={viewScope.showActualTime}
              onHelp={() => setHelpOpen(true)}
            />
          )}
        </CalendarViewTabs>
      </div>
    </>
  );
}

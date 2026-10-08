'use client';

import { KalenderContentSkeleton } from '@/components/loading-states/kalender-content-skeleton';
import { PageBody } from '@/components/shared/page-shell';
import { SectionError } from '@/components/ui/section-error';
import type { OrgRole } from '@/lib/members/actions';
import type { OrganizationTimeTrackingSettings } from '@/lib/time-tracking/settings';
import type { WorkSession } from '@/lib/time-tracking/types';
import { unconfirmedMarker } from '@/lib/ui/unconfirmed';
import { cn, toLocalDateString } from '@/lib/utils';
import { Plantafel } from './board/plantafel';
import type { CalendarSurfaceActions } from './board/types';
import { DayView } from './day-view/day-view';
import { MonthView } from './month-view/month-view';
import type { CalendarMutations } from './mutations/use-calendar-mutations';
import { ParkplatzPanel } from './parkplatz-panel';
import type { CalendarData } from './use-calendar-data';
import type { CalendarOverlays } from './use-calendar-overlays';
import type { CalendarViewScope } from './use-calendar-view-scope';
import type { CalendarViewState } from './use-calendar-view-state';
import type { ParkFlowState } from './use-park-flow';

type CalendarSurfaceProps = {
  viewState: CalendarViewState;
  viewScope: CalendarViewScope;
  data: CalendarData;
  mutations: CalendarMutations;
  surfaceActions: CalendarSurfaceActions;
  parkFlow: ParkFlowState;
  phone: boolean;
  organizationSettings: OrganizationTimeTrackingSettings;
  currentUserId: string;
  currentUserRole: OrgRole;
  isAdminOrManager: boolean;
  onSessionClick: (session: WorkSession) => void;
  verticalScroller: () => HTMLElement | null;
  /** The local calendar date the surfaces mark as today. */
  todayIso: string;
};

/**
 * The calendar's own scroller with the active view and, on a desktop, the
 * Parkplatz beside it. The scroller carries the readiness marker and goes
 * busy and inert while an uncovered window loads or the data is stale. The
 * pair carries the unconfirmed marker from an optimistic move until the
 * settlement read lands: the range owner knows that window, not which card
 * moved, so every card in it counts as unconfirmed (lib/ui/unconfirmed.ts).
 */
export function CalendarBody({
  overlays,
  scrollContainerRef,
  isLoading,
  isReloading,
  calendarStale,
  showUnavailable,
  ...surface
}: CalendarSurfaceProps & {
  overlays: CalendarOverlays;
  scrollContainerRef: React.RefObject<HTMLDivElement | null>;
  isLoading: boolean;
  isReloading: boolean;
  calendarStale: boolean;
  showUnavailable: boolean;
}): React.JSX.Element {
  const { parkFlowRef, setParkingContextJob, setScheduleParkedJob } = surface.parkFlow;
  const unconfirmed = surface.data.range.isUnconfirmed || surface.data.parkedJobsUnconfirmed;
  return (
    <>
      {/* The calendar keeps its own scroller (the day grid and the wide board
          scroll sideways inside it, a named canon exception), so PageBody only
          supplies the column slot: padding and clock clearance switched off. */}
      {/* The Parkplatz sits beside the calendar on a desktop, so the board keeps every column reachable. */}
      <div className="flex min-h-0 flex-1" {...unconfirmedMarker(unconfirmed)}>
        <PageBody className="flex min-w-0 flex-col overflow-hidden p-0 pb-0 sm:p-0 sm:pb-0">
          <div
            className={cn(
              'flex-1 overflow-auto overscroll-none transition-opacity',
              isReloading && 'opacity-60',
            )}
            data-calendar-scroll-container=""
            aria-busy={isReloading || undefined}
            inert={isReloading || calendarStale || undefined}
            ref={scrollContainerRef}
          >
            {showUnavailable ? (
              <div className="p-4 sm:p-6">
                <SectionError
                  title="Kalender konnte nicht geladen werden"
                  onRetry={() => void surface.data.handleManualRefresh()}
                >
                  Die Termine und Arbeitszeiten für diesen Zeitraum konnten nicht geladen werden. Die
                  Navigation bleibt möglich.
                </SectionError>
              </div>
            ) : isLoading ? (
              <KalenderContentSkeleton withTabs={false} view={surface.viewState.view} />
            ) : (
              <CalendarSurface {...surface} />
            )}
          </div>
        </PageBody>
        {surface.isAdminOrManager && overlays.parkplatzOpen && (
          <ParkplatzPanel
            jobs={surface.viewScope.filteredParkedJobs}
            onClose={() => overlays.setParkplatzOpen(false)}
            memberNames={surface.viewScope.memberNameMap}
            parkingContexts={surface.data.parkingContexts}
            onEditContext={(job) => {
              parkFlowRef.current = null;
              setParkingContextJob(job);
            }}
            onDispatchJob={(job) => overlays.setParkedDispatchJob(job)}
            onScheduleJob={(job) => setScheduleParkedJob(job)}
          />
        )}
      </div>
    </>
  );
}

/** The week board, the day view or the month, fed by the one range owner and the one optimistic owner. */
function CalendarSurface({
  viewState,
  viewScope,
  data,
  mutations,
  surfaceActions,
  parkFlow,
  phone,
  organizationSettings,
  currentUserId,
  currentUserRole,
  isAdminOrManager,
  onSessionClick,
  verticalScroller,
  todayIso,
}: CalendarSurfaceProps): React.JSX.Element {
  const { currentDate, view, preferences } = viewState;
  const { board, entries, vacation, sickness, holidays, changeRequestMap } = data.range;
  if (view === 'week')
    return (
      <Plantafel
        anchorIso={toLocalDateString(currentDate)}
        todayIso={todayIso}
        preferences={preferences}
        showActualTime={viewScope.showActualTime}
        board={board}
        jobs={viewScope.filteredJobs}
        entries={entries}
        vacation={vacation}
        sickness={sickness}
        holidays={holidays}
        mutations={mutations}
        parkingContexts={data.parkingContexts}
        onParkedContextMissing={parkFlow.handleParkedContextMissing}
        actions={surfaceActions}
        verticalScroller={verticalScroller}
        onIsolateRow={(employeeRecordId) => {
          const row = board.rows.find((entry) => entry.employeeRecordId === employeeRecordId);
          const selectedMemberIds = viewScope.selectedMemberIds;
          if (row?.userId)
            viewState.updatePreferences({
              memberUserIds:
                selectedMemberIds?.length === 1 && selectedMemberIds[0] === row.userId ? null : [row.userId],
            });
        }}
        phone={phone}
      />
    );
  if (view === 'day')
    return (
      <DayView
        phone={phone}
        date={currentDate}
        todayIso={todayIso}
        zoom={viewState.dayZoom}
        onZoomChange={viewState.setDayZoom}
        entries={viewScope.filteredEntries}
        jobs={viewScope.filteredJobs}
        members={viewScope.filteredMembers}
        board={board}
        holidays={holidays}
        organizationSettings={organizationSettings}
        currentUserId={currentUserId}
        currentUserRole={currentUserRole}
        changeRequestMap={changeRequestMap}
        mutations={mutations}
        actions={surfaceActions}
        parkingContexts={data.parkingContexts}
        onParkedContextMissing={parkFlow.handleParkedContextMissing}
        onSessionClick={onSessionClick}
        highlightMemberId={viewState.highlightMemberId}
        verticalScroller={verticalScroller}
      />
    );
  return (
    <MonthView
      date={currentDate}
      todayIso={todayIso}
      jobs={viewScope.filteredJobs}
      entries={viewScope.filteredEntries}
      members={viewScope.filteredMembers}
      vacation={vacation}
      sickness={sickness}
      holidays={holidays}
      organizationSettings={organizationSettings}
      currentUserId={currentUserId}
      isAdminOrManager={isAdminOrManager}
      mutations={mutations}
      actions={surfaceActions}
      parkingContexts={data.parkingContexts}
      onParkedContextMissing={parkFlow.handleParkedContextMissing}
      onOpenDay={(date) => viewState.handleOpenDay(date, null)}
      onSessionClick={onSessionClick}
      verticalScroller={verticalScroller}
    />
  );
}

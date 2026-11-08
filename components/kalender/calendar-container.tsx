'use client';

import { useCallback, useEffect, useMemo, useRef } from 'react';
import { Undo2 } from 'lucide-react';
import { CalendarDragProvider } from './drag-engine/drag-engine';
import { CalendarLiveRegion, useCalendarAnnounce } from './surface/live-region';
import { useCalendarMutations, type CalendarMutations } from './mutations/use-calendar-mutations';
import { useQualificationWarningConfirmation } from '@/components/auftraege/shared/qualification-warning-dialog';
import { CalendarTimeCorrectionDialog } from './calendar-time-correction-dialog';
import { useBanner } from '@/components/ui/banner';
import { PageShell } from '@/components/shared/page-shell';
import { usePlanningWarningConfirmation } from './planning-warning-dialog';
import type { CalendarInitialData } from './use-calendar-range-data';
import type { OrgRole } from '@/lib/roles';
import type { OrganizationTimeTrackingSettings } from '@/lib/time-tracking/settings';
import type { OrganizationHolidayCalendar } from '@/lib/personnel/targets';
import type { CalendarPreferences } from '@/lib/calendar/preferences';
import { isCalendarShortcutKey } from '@/lib/calendar/shortcut-guard';
import { getBusinessTodayIso } from '@/lib/date-time/berlin';
import { toLocalDateString } from '@/lib/utils';
import { CalendarBody } from './calendar-body';
import { CalendarDialogs } from './calendar-dialogs';
import { CalendarToolbar } from './calendar-toolbar';
import type { CalendarMember } from './members';
import { useCalendarData } from './use-calendar-data';
import { useCalendarStateMarker, useObservedHeight, usePhoneQuery } from './use-calendar-layout';
import {
  useCalendarOverlays,
  useCalendarSurfaceActions,
  type CalendarOverlays,
} from './use-calendar-overlays';
import { useCalendarViewScope } from './use-calendar-view-scope';
import { useCalendarViewState, type CalendarViewState } from './use-calendar-view-state';
import { useManualEntryBridge } from './use-manual-entry-bridge';
import { useParkFlow } from './use-park-flow';
import { useScopeActive } from './use-scope-active';
import { BoardAbsencesContext, useIndexedBoardAbsences } from './board-absences-context';

export type CalendarView = 'day' | 'week' | 'month';

interface CalendarContainerProps {
  organizationId: string;
  currentUserId: string;
  currentUserRole: OrgRole;
  isAdminOrManager: boolean;
  members: CalendarMember[];
  organizationSettings: OrganizationTimeTrackingSettings;
  holidayCalendar?: OrganizationHolidayCalendar;
  /** Server-rendered window with the exact range it was read for (PF-17). */
  initialData?: CalendarInitialData | undefined;
  initialDate?: string;
  /** The caller's saved preferences (P1-24a, criterion 20). */
  initialPreferences: CalendarPreferences;
  /** The landing view the page resolved from the preferences and the role (D1). */
  initialView: CalendarView;
}

// Every calendar read keeps its last-known data on failure and says so through
// one persistent error banner; a later failure replaces it, so the fan-out of a
// manual refresh never stacks alerts.
const CALENDAR_READ_FAILED_MESSAGE =
  'Der Kalender konnte nicht aktualisiert werden. Angezeigt wird der letzte bekannte Stand.';

export function CalendarContainer(props: CalendarContainerProps): React.JSX.Element {
  return (
    <CalendarLiveRegion>
      <CalendarDragProvider>
        <ScopedCalendarContainer
          key={`${props.organizationId}:${props.currentUserId}:${props.currentUserRole}:${props.initialDate ?? ''}`}
          {...props}
        />
      </CalendarDragProvider>
    </CalendarLiveRegion>
  );
}

/**
 * The first half of the scoped calendar's hooks, up to the reads: scope, the
 * two warning confirmations, view state, overlays and the read owner.
 */
function useScopedCalendarReads({
  organizationId,
  currentUserId,
  currentUserRole,
  isAdminOrManager,
  holidayCalendar,
  initialData,
  initialDate,
  initialPreferences,
  initialView,
}: CalendarContainerProps) {
  const { scopeActive, isScopeActive } = useScopeActive();
  const { showBanner } = useBanner();
  const announce = useCalendarAnnounce();
  const { requestApproval, warningDialog } = useQualificationWarningConfirmation();
  const { requestApproval: requestPlanningApproval, warningDialog: planningWarningDialog } =
    usePlanningWarningConfirmation();
  const phone = usePhoneQuery();
  // The calendar's one clock read for "today": the Berlin business date, the
  // same day the server window and the day-change re-render follow. Every view,
  // the header and "Heute" take it from here.
  const todayIso = getBusinessTodayIso();
  const viewState = useCalendarViewState({
    organizationId,
    initialPreferences,
    initialView,
    initialDate,
    todayIso,
  });
  const overlays = useCalendarOverlays();

  const parkplatzButtonRef = useRef<HTMLButtonElement>(null);
  const calendarHeaderRef = useRef<HTMLDivElement>(null);
  const calendarHeaderHeight = useObservedHeight(calendarHeaderRef, 76);

  const reportReadFailure = useCallback(
    () => showBanner({ variant: 'error', message: CALENDAR_READ_FAILED_MESSAGE }),
    [showBanner],
  );
  const data = useCalendarData({
    organizationId,
    identityKey: `${currentUserId}:${currentUserRole}`,
    needed: viewState.needed,
    initialData,
    holidayCalendar,
    isAdminOrManager,
    isScopeActive,
    reportReadFailure,
  });
  return {
    scopeActive,
    isScopeActive,
    showBanner,
    announce,
    requestApproval,
    warningDialog,
    requestPlanningApproval,
    planningWarningDialog,
    phone,
    todayIso,
    viewState,
    overlays,
    parkplatzButtonRef,
    calendarHeaderRef,
    calendarHeaderHeight,
    data,
  };
}

type ScopedCalendarReads = ReturnType<typeof useScopedCalendarReads>;

/** The optimistic owner, its banners bound to the calendar's scope: a closed scope shows none. */
function useScopedCalendarMutations({
  scopeActive,
  isScopeActive,
  showBanner,
  requestApproval,
  requestPlanningApproval,
  data,
}: ScopedCalendarReads): CalendarMutations {
  return useCalendarMutations({
    beginMutation: data.handleOperationStart,
    updateJobs: data.range.updateJobs,
    updateParkedJobs: data.updateParkedJobs,
    jobsRef: data.calendarJobsRef,
    showBanner: (banner) => {
      if (!scopeActive.current) return () => {};
      return showBanner({
        ...banner,
        ...(banner.actionLabel ? { actionIcon: <Undo2 className="size-3.5" /> } : {}),
      });
    },
    isScopeActive,
    requestApproval,
    requestPlanningApproval,
    silentRefresh: data.handleSilentRefresh,
  });
}

/** A highlighted member fades after 1.5 s, counted from the moment the grid shows. */
function useHighlightFade(
  highlightMemberId: string | null,
  isLoading: boolean,
  setHighlightMemberId: (memberId: string | null) => void,
): void {
  useEffect(() => {
    if (!highlightMemberId || isLoading) return;
    const timer = window.setTimeout(() => setHighlightMemberId(null), 1500);
    return () => window.clearTimeout(timer);
  }, [highlightMemberId, isLoading, setHighlightMemberId]);
}

/** The keyboard commands of the scoped calendar; `c` creates only for a caller who may. */
function useCalendarCommandKeys(
  viewState: CalendarViewState,
  overlays: CalendarOverlays,
  mutations: CalendarMutations,
  isAdminOrManager: boolean,
): void {
  const { currentDate, view, setView } = viewState;
  const { setAddEntry, setHelpOpen } = overlays;
  const handleCreateShortcut = useMemo(
    () => (isAdminOrManager ? () => setAddEntry({ date: toLocalDateString(currentDate) }) : null),
    [isAdminOrManager, currentDate, setAddEntry],
  );
  const handleHelpShortcut = useCallback(() => setHelpOpen(true), [setHelpOpen]);
  useCalendarShortcuts({
    view,
    setView,
    onToday: viewState.handleToday,
    onNext: viewState.handleNext,
    onPrevious: viewState.handlePrevious,
    onCreate: handleCreateShortcut,
    onUndo: mutations.undoLast,
    onHelp: handleHelpShortcut,
    setDayZoom: viewState.setDayZoom,
  });
}

/**
 * The second half of the scoped calendar's hooks, built on the reads: the
 * optimistic owner, the manual-entry bridge, the highlight, the shortcuts, the
 * view scope, the park flow, the surface actions and the readiness marker.
 */
function useScopedCalendarFlows(
  { organizationId, currentUserId, isAdminOrManager, members }: CalendarContainerProps,
  reads: ScopedCalendarReads,
) {
  const { showBanner, viewState, overlays, data } = reads;
  const { preferences, view, needed, highlightMemberId, setHighlightMemberId } = viewState;
  const { range, handleOperationStart } = data;
  const { readiness } = range;
  // The skeleton replaces the grid only while no data exists at all (first
  // open, organization switch). Navigating to an uncovered window keeps the
  // grid mounted and marks it busy.
  const isLoading = readiness.kind === 'loading' && !readiness.hasData;
  const isReloading = readiness.kind === 'loading' && readiness.hasData;

  const mutations = useScopedCalendarMutations(reads);

  const handleManualEntrySuccess = useManualEntryBridge({
    userId: currentUserId,
    organizationId,
    needed,
    beginOperation: handleOperationStart,
    setEntries: range.updateEntries,
  });

  useHighlightFade(highlightMemberId, isLoading, setHighlightMemberId);
  useCalendarCommandKeys(viewState, overlays, mutations, isAdminOrManager);

  const viewScope = useCalendarViewScope({
    preferences,
    showWorkingHours: viewState.showWorkingHours,
    entries: range.entries,
    calendarJobs: range.jobs,
    parkedJobs: data.parkedJobs,
    members,
    boardRows: range.board.rows,
    isAdminOrManager,
    currentUserId,
  });

  const parkFlow = useParkFlow({
    mutations,
    showBanner,
    parkingContextsRef: data.parkingContextsRef,
    fetchParkingContexts: data.fetchParkingContexts,
    fetchParkedJobs: data.fetchParkedJobs,
  });

  const { surfaceActions, handleSessionClick } = useCalendarSurfaceActions({
    overlays,
    isAdminOrManager,
    onPark: parkFlow.handlePark,
    members,
  });

  const showUnavailable = !isLoading && readiness.kind === 'unavailable';
  const calendarStale = readiness.kind === 'ready' && readiness.isStale;
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const verticalScroller = useCallback(() => scrollContainerRef.current, []);
  useCalendarStateMarker(scrollContainerRef, {
    readinessKind: readiness.kind,
    calendarStale,
    view,
    neededStartIso: needed.start.toISOString(),
    horizonWeeks: preferences.horizonWeeks,
  });

  return {
    isLoading,
    isReloading,
    mutations,
    handleManualEntrySuccess,
    viewScope,
    parkFlow,
    surfaceActions,
    handleSessionClick,
    showUnavailable,
    calendarStale,
    scrollContainerRef,
    verticalScroller,
  };
}

/**
 * One organization, user and role's calendar. The hooks run in a fixed order
 * that the effects depend on: scope, view state, the range owner and the
 * Parkplatz reads, the optimistic owner, then the manual-entry bridge, the
 * highlight, the shortcuts and the readiness marker.
 */
function ScopedCalendarContainer(props: CalendarContainerProps) {
  const { organizationId, currentUserId, currentUserRole, isAdminOrManager, members } = props;
  const reads = useScopedCalendarReads(props);
  const { phone, todayIso, viewState, overlays, data, showBanner, announce } = reads;
  const flows = useScopedCalendarFlows(props, reads);
  const { mutations, parkFlow, viewScope, handleManualEntrySuccess } = flows;
  const { handleSilentRefresh } = data;
  const boardRows = data.range.board.rows;
  // The board, its card popovers, the header's create dialog and the overlay
  // dialogs all mark absent people from the days this range loaded.
  const absences = useIndexedBoardAbsences(data.range.board.days, boardRows);

  return (
    <BoardAbsencesContext value={absences}>
      <PageShell>
        {mutations.timeCorrectionDraft && (
          <CalendarTimeCorrectionDialog
            organizationId={organizationId}
            draft={mutations.timeCorrectionDraft}
            rows={boardRows}
            onClose={mutations.closeTimeCorrection}
            onSubmitted={handleSilentRefresh}
          />
        )}
        <CalendarToolbar
          viewState={viewState}
          viewScope={viewScope}
          overlays={overlays}
          members={members}
          isAdminOrManager={isAdminOrManager}
          phone={phone}
          todayIso={todayIso}
          calendarHeaderRef={reads.calendarHeaderRef}
          parkplatzButtonRef={reads.parkplatzButtonRef}
          onRefresh={data.handleManualRefresh}
          onManualEntrySuccess={handleManualEntrySuccess}
          onSilentRefresh={handleSilentRefresh}
        />
        <CalendarBody
          overlays={overlays}
          scrollContainerRef={flows.scrollContainerRef}
          isLoading={flows.isLoading}
          isReloading={flows.isReloading}
          calendarStale={flows.calendarStale}
          showUnavailable={flows.showUnavailable}
          viewState={viewState}
          viewScope={viewScope}
          data={data}
          mutations={mutations}
          surfaceActions={flows.surfaceActions}
          parkFlow={parkFlow}
          phone={phone}
          organizationSettings={props.organizationSettings}
          currentUserId={currentUserId}
          currentUserRole={currentUserRole}
          isAdminOrManager={isAdminOrManager}
          onSessionClick={flows.handleSessionClick}
          verticalScroller={flows.verticalScroller}
          todayIso={todayIso}
        />
        <CalendarDialogs
          overlays={overlays}
          parkFlow={parkFlow}
          data={data}
          viewScope={viewScope}
          mutations={mutations}
          members={members}
          boardRows={boardRows}
          isAdminOrManager={isAdminOrManager}
          currentUserId={currentUserId}
          currentUserRole={currentUserRole}
          calendarHeaderHeight={reads.calendarHeaderHeight}
          showBanner={showBanner}
          announce={announce}
          onManualEntrySuccess={handleManualEntrySuccess}
        />
        {reads.warningDialog}
        {reads.planningWarningDialog}
      </PageShell>
    </BoardAbsencesContext>
  );
}

// The `?` overlay lists exactly these keys (lib/calendar/shortcuts.test.ts reads this file).
/** Keyboard shortcuts (P1-24a, criterion 18) outside fields and dialogs. */
function useCalendarShortcuts({
  view,
  setView,
  onToday,
  onNext,
  onPrevious,
  onCreate,
  onUndo,
  onHelp,
  setDayZoom,
}: {
  view: CalendarView;
  setView: (view: CalendarView) => void;
  onToday: () => void;
  onNext: () => void;
  onPrevious: () => void;
  /** Null for a caller who may not create entries. */
  onCreate: (() => void) | null;
  /** True when an operation was undone. */
  onUndo: () => boolean;
  onHelp: () => void;
  setDayZoom: React.Dispatch<React.SetStateAction<number>>;
}): void {
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const { defaultPrevented, metaKey, ctrlKey, altKey } = event;
      const target = event.target instanceof Element ? event.target : null;
      if (!isCalendarShortcutKey({ defaultPrevented, metaKey, ctrlKey, altKey, target })) return;
      switch (event.key) {
        case 't':
          onToday();
          break;
        case 'j':
          onNext();
          break;
        case 'k':
          onPrevious();
          break;
        case 'd':
          setView('day');
          break;
        case 'w':
          setView('week');
          break;
        case 'm':
          setView('month');
          break;
        case 'c':
          if (onCreate) onCreate();
          break;
        case 'z':
          if (onUndo()) event.preventDefault();
          break;
        case '?':
          onHelp();
          break;
        case '+':
          if (view === 'day') setDayZoom((zoom) => Math.min(3, zoom * 1.25));
          break;
        case '-':
          if (view === 'day') setDayZoom((zoom) => Math.max(0.5, zoom / 1.25));
          break;
        default:
          return;
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [view, setView, onToday, onNext, onPrevious, onCreate, onUndo, onHelp, setDayZoom]);
}

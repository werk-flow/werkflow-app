'use client';

import { useCallback, useEffect, useMemo, useRef } from 'react';
import { Undo2 } from 'lucide-react';
import { CalendarDragProvider } from './drag-engine/drag-engine';
import { CalendarLiveRegion, useCalendarAnnounce } from './surface/live-region';
import { useCalendarMutations } from './mutations/use-calendar-mutations';
import { useQualificationWarningConfirmation } from '@/components/auftraege/shared/qualification-warning-dialog';
import { CalendarTimeCorrectionDialog } from './calendar-time-correction-dialog';
import { useBanner } from '@/components/ui/banner';
import { PageShell } from '@/components/shared/page-shell';
import { usePlanningWarningConfirmation } from './planning-warning-dialog';
import type { CalendarInitialData } from './use-calendar-range-data';
import type { OrgRole } from '@/lib/members/actions';
import type { OrganizationTimeTrackingSettings } from '@/lib/time-tracking/settings';
import type { OrganizationHolidayCalendar } from '@/lib/personnel/targets';
import type { CalendarPreferences } from '@/lib/calendar/preferences';
import { isCalendarShortcutKey } from '@/lib/calendar/shortcut-guard';
import { getBusinessTodayIso } from '@/lib/personnel/types';
import { toLocalDateString } from '@/lib/utils';
import { CalendarBody } from './calendar-body';
import { CalendarDialogs } from './calendar-dialogs';
import { CalendarToolbar } from './calendar-toolbar';
import type { CalendarMember } from './members';
import { useCalendarData } from './use-calendar-data';
import { useCalendarStateMarker, useObservedHeight, usePhoneQuery } from './use-calendar-layout';
import { useCalendarOverlays, useCalendarSurfaceActions } from './use-calendar-overlays';
import { useCalendarViewScope } from './use-calendar-view-scope';
import { useCalendarViewState } from './use-calendar-view-state';
import { useManualEntryBridge } from './use-manual-entry-bridge';
import { useParkFlow } from './use-park-flow';
import { useScopeActive } from './use-scope-active';

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
 * One organization, user and role's calendar. The hooks run in a fixed order
 * that the effects depend on: scope, view state, the range owner and the
 * Parkplatz reads, the optimistic owner, then the manual-entry bridge, the
 * highlight, the shortcuts and the readiness marker.
 */
function ScopedCalendarContainer({
  organizationId,
  currentUserId,
  currentUserRole,
  isAdminOrManager,
  members,
  organizationSettings,
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
  const { preferences, currentDate, view, setView, needed, highlightMemberId, setHighlightMemberId } =
    viewState;
  const overlays = useCalendarOverlays();
  const { setAddEntry, setHelpOpen } = overlays;

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
    needed,
    initialData,
    holidayCalendar,
    isAdminOrManager,
    isScopeActive,
    reportReadFailure,
  });
  const { range, handleOperationStart, handleSilentRefresh } = data;
  const { readiness } = range;
  // The skeleton replaces the grid only while no data exists at all (first
  // open, organization switch). Navigating to an uncovered window keeps the
  // grid mounted and marks it busy.
  const isLoading = readiness.kind === 'loading' && !readiness.hasData;
  const isReloading = readiness.kind === 'loading' && readiness.hasData;

  const mutations = useCalendarMutations({
    beginMutation: handleOperationStart,
    updateJobs: range.updateJobs,
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
    silentRefresh: handleSilentRefresh,
  });

  const handleManualEntrySuccess = useManualEntryBridge({
    organizationId,
    needed,
    beginOperation: handleOperationStart,
    setEntries: range.updateEntries,
  });

  useEffect(() => {
    if (!highlightMemberId || isLoading) return;
    const timer = window.setTimeout(() => setHighlightMemberId(null), 1500);
    return () => window.clearTimeout(timer);
  }, [highlightMemberId, isLoading, setHighlightMemberId]);

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

  return (
    <PageShell>
      {mutations.timeCorrectionDraft && (
        <CalendarTimeCorrectionDialog
          organizationId={organizationId}
          draft={mutations.timeCorrectionDraft}
          rows={range.board.rows}
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
        calendarHeaderRef={calendarHeaderRef}
        parkplatzButtonRef={parkplatzButtonRef}
        onRefresh={data.handleManualRefresh}
        onManualEntrySuccess={handleManualEntrySuccess}
        onSilentRefresh={handleSilentRefresh}
      />
      <CalendarBody
        overlays={overlays}
        scrollContainerRef={scrollContainerRef}
        isLoading={isLoading}
        isReloading={isReloading}
        calendarStale={calendarStale}
        showUnavailable={showUnavailable}
        viewState={viewState}
        viewScope={viewScope}
        data={data}
        mutations={mutations}
        surfaceActions={surfaceActions}
        parkFlow={parkFlow}
        phone={phone}
        organizationSettings={organizationSettings}
        currentUserId={currentUserId}
        currentUserRole={currentUserRole}
        isAdminOrManager={isAdminOrManager}
        onSessionClick={handleSessionClick}
        verticalScroller={verticalScroller}
        todayIso={todayIso}
      />
      <CalendarDialogs
        overlays={overlays}
        parkFlow={parkFlow}
        data={data}
        viewScope={viewScope}
        mutations={mutations}
        members={members}
        boardRows={range.board.rows}
        isAdminOrManager={isAdminOrManager}
        currentUserId={currentUserId}
        currentUserRole={currentUserRole}
        calendarHeaderHeight={calendarHeaderHeight}
        showBanner={showBanner}
        announce={announce}
        onManualEntrySuccess={handleManualEntrySuccess}
      />
      {warningDialog}
      {planningWarningDialog}
    </PageShell>
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

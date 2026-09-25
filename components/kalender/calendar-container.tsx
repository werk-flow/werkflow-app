'use client';

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import dynamic from 'next/dynamic';
import { usePathname } from 'next/navigation';
import { Undo2 } from 'lucide-react';
import { CalendarHeader } from './calendar-header';
import { CalendarViewTabs } from './calendar-view-tabs';
import { DayView } from './day-view/day-view';
import { MonthView } from './month-view/month-view';
import { Plantafel } from './board/plantafel';
import { BoardToolbar } from './board/board-toolbar';
import { ShortcutsHelp } from './board/shortcuts-help';
import type { CalendarSurfaceActions } from './board/types';
import { CalendarDragProvider } from './drag-engine/drag-engine';
import { CalendarLiveRegion, useCalendarAnnounce } from './surface/live-region';
import { useCalendarMutations } from './mutations/use-calendar-mutations';
import { getParkedJobs } from '@/lib/jobs/actions';
import { useQualificationWarningConfirmation } from '@/components/auftraege/qualification-warning-dialog';
import { useLiveView } from '@/hooks/use-live-view';
import { useRealtimeRouterRefresh } from '@/hooks/use-realtime-router-refresh';
import type { CalendarJob } from '@/lib/jobs/types';
import { ParkplatzPanel } from './parkplatz-panel';
import { DispatchPanel } from './dispatch-panel';
import { DispatchIssueDialog } from './dispatch-issue-dialog';
import { ParkingContextDialog } from './parking-context-dialog';
import { ScheduleParkedDialog } from './schedule-parked-dialog';
import { JobEventPopover, type OpenCard } from './job-event-popover';
import { CalendarEntryDialog } from './calendar-entry-dialog';
import { getJobParkingContexts } from '@/lib/parking/actions';
import type { JobParkingContext } from '@/lib/parking/types';
import { useBanner } from '@/components/ui/banner';
import { SectionError } from '@/components/ui/section-error';
import { cn, toLocalDateString } from '@/lib/utils';
import { PageBody, PageShell } from '@/components/shared/page-shell';
import { KalenderContentSkeleton } from '@/components/loading-states/kalender-content-skeleton';
import { usePlanningWarningConfirmation } from './planning-warning-dialog';
import { useCalendarRangeData, type CalendarDataset, type CalendarInitialData } from './use-calendar-range-data';
import type { InteractiveCalendarSession, TimeEntry, WorkSession } from '@/lib/time-tracking/types';
import type { OrgRole } from '@/lib/members/actions';
import { consumeManualEntryBridge, MANUAL_ENTRY_CREATED_EVENT } from '@/lib/time-tracking/manual-entry-bridge';
import type { OrganizationTimeTrackingSettings } from '@/lib/time-tracking/settings';
import type { OrganizationHolidayCalendar } from '@/lib/personnel/targets';
import { getCalendarFetchRange, shiftCalendarDate } from '@/lib/calendar/navigation';
import { calendarRefusalMessage, formatRefusalDate } from '@/lib/calendar/messages';
import { type CalendarPreferences, resolveShowActualTime } from '@/lib/calendar/preferences';
import { saveCalendarPreferences } from '@/lib/calendar/preferences-actions';
import type { CalendarBoardRow } from '@/lib/calendar/board';
import { memberDisplayName, type CalendarMember } from './members';

const EntryDetailsDialog = dynamic(() => import('./entry-details-dialog').then((mod) => mod.EntryDetailsDialog), { ssr: false });

export type CalendarView = 'day' | 'week' | 'month';

// Every view draws every dataset (absences, schedules and dispatch states
// reach the day view and the board as well as the month), and one GET pair
// carries them all, so one uncovered dataset gates every view alike.
const ALL_CALENDAR_DATASETS: readonly CalendarDataset[] = ['entries', 'jobs', 'vacation', 'sickness', 'holidays', 'board'];

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
const CALENDAR_READ_FAILED_MESSAGE = 'Der Kalender konnte nicht aktualisiert werden. Angezeigt wird der letzte bekannte Stand.';
const PREFERENCE_SAVE_DELAY_MS = 600;
const PHONE_QUERY = '(max-width: 639px)';

function sortEntriesByTimestamp(entries: TimeEntry[]): TimeEntry[] {
  return [...entries].sort((a, b) => {
    const timestampDiff = new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime();
    if (timestampDiff !== 0) return timestampDiff;
    return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
  });
}

function subscribeToPhoneQuery(onChange: () => void): () => void {
  const query = window.matchMedia(PHONE_QUERY);
  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
}

/** True when a key press belongs to a field or an open dialog, never to the calendar. */
function keyBelongsToText(event: KeyboardEvent): boolean {
  const target = event.target as HTMLElement | null;
  if (!target) return false;
  if (target.closest('input, textarea, select, [contenteditable="true"], [role="dialog"], [role="listbox"], [data-job-popover]')) return true;
  return event.metaKey || event.ctrlKey || event.altKey;
}

export function CalendarContainer(props: CalendarContainerProps): React.JSX.Element {
  return (
    <CalendarLiveRegion>
      <CalendarDragProvider>
        <ScopedCalendarContainer key={`${props.organizationId}:${props.currentUserId}:${props.currentUserRole}:${props.initialDate ?? ''}`} {...props} />
      </CalendarDragProvider>
    </CalendarLiveRegion>
  );
}

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
  const scopeActive = useRef(true);
  useEffect(() => { scopeActive.current = true; return () => { scopeActive.current = false; }; }, []);
  const isScopeActive = useCallback(() => scopeActive.current, []);
  const pathname = usePathname();
  const { showBanner } = useBanner();
  const announce = useCalendarAnnounce();
  const { requestApproval, warningDialog } = useQualificationWarningConfirmation();
  const { requestApproval: requestPlanningApproval, warningDialog: planningWarningDialog } = usePlanningWarningConfirmation();
  const phone = useSyncExternalStore(subscribeToPhoneQuery, () => window.matchMedia(PHONE_QUERY).matches, () => false);

  // Preferences: local state first; every change saves at once except the search text, which saves after the burst.
  const [preferences, setPreferences] = useState<CalendarPreferences>(initialPreferences);
  const preferencesRef = useRef(initialPreferences);
  const saveTimerRef = useRef<number | null>(null);
  const pendingPreferencesRef = useRef<CalendarPreferences | null>(null);
  const flushPreferences = useCallback(() => {
    if (saveTimerRef.current !== null) window.clearTimeout(saveTimerRef.current);
    saveTimerRef.current = null;
    const pending = pendingPreferencesRef.current;
    pendingPreferencesRef.current = null;
    // A failed save costs nothing but the persistence; the view keeps the value.
    if (pending) void saveCalendarPreferences(pending).catch(() => undefined);
  }, []);
  const updatePreferences = useCallback((update: Partial<CalendarPreferences>) => {
    const next = { ...preferencesRef.current, ...update };
    preferencesRef.current = next;
    setPreferences(next);
    pendingPreferencesRef.current = next;
    if (saveTimerRef.current !== null) window.clearTimeout(saveTimerRef.current);
    // A click on a toggle, a filter or the horizon saves at once; the search text is the one burst.
    if (Object.keys(update).every((key) => key === 'search')) {
      saveTimerRef.current = window.setTimeout(flushPreferences, PREFERENCE_SAVE_DELAY_MS);
      return;
    }
    flushPreferences();
  }, [flushPreferences]);
  useEffect(() => flushPreferences, [flushPreferences]);

  const [currentDate, setCurrentDate] = useState(() => (initialDate ? new Date(`${initialDate}T12:00:00`) : new Date()));
  const [view, setViewState] = useState<CalendarView>(initialView);
  const setView = useCallback((next: CalendarView) => {
    setViewState(next);
    updatePreferences({ view: next });
  }, [updatePreferences]);
  const [showWorkingHours, setShowWorkingHours] = useState(false);
  const [dayZoom, setDayZoom] = useState(1);
  const [helpOpen, setHelpOpen] = useState(false);
  const [selectedSession, setSelectedSession] = useState<InteractiveCalendarSession | null>(null);
  const [openCard, setOpenCard] = useState<OpenCard | null>(null);
  const [addEntry, setAddEntry] = useState<{ date: string; time?: string | undefined; endTime?: string | undefined; userId?: string | undefined } | null>(null);
  const [parkedJobs, setParkedJobs] = useState<CalendarJob[]>([]);
  const [parkplatzOpen, setParkplatzOpen] = useState(false);
  const [dispatchPanelOpen, setDispatchPanelOpen] = useState(false);
  // null until the first successful load so the panel can distinguish
  // "still loading" from "loaded, no context recorded".
  const [parkingContexts, setParkingContexts] = useState<Map<string, JobParkingContext> | null>(null);
  const parkingContextsRef = useRef<Map<string, JobParkingContext> | null>(null);
  const [parkingContextJob, setParkingContextJob] = useState<CalendarJob | null>(null);
  const [parkedDispatchJob, setParkedDispatchJob] = useState<CalendarJob | null>(null);
  const [scheduleParkedJob, setScheduleParkedJob] = useState<CalendarJob | null>(null);
  const [highlightMemberId, setHighlightMemberId] = useState<string | null>(null);

  const parkplatzButtonRef = useRef<HTMLButtonElement>(null);
  const calendarHeaderRef = useRef<HTMLDivElement>(null);
  const [calendarHeaderHeight, setCalendarHeaderHeight] = useState(76);
  useEffect(() => {
    const headerEl = calendarHeaderRef.current;
    if (!headerEl) return;
    const updateHeights = () => setCalendarHeaderHeight(headerEl.getBoundingClientRect().height);
    updateHeights();
    const observer = new ResizeObserver(updateHeights);
    observer.observe(headerEl);
    return () => observer.disconnect();
  }, []);

  // The read window follows the selected date, view and horizon (PF-01).
  const needed = useMemo(() => getCalendarFetchRange(currentDate, view, preferences.horizonWeeks), [currentDate, view, preferences.horizonWeeks]);
  const reportReadFailure = useCallback(() => showBanner({ variant: 'error', message: CALENDAR_READ_FAILED_MESSAGE }), [showBanner]);

  const calendarJobsRef = useRef<CalendarJob[]>([]);
  const parkedJobsRequestIdRef = useRef(0);
  const parkedJobsLoadedRef = useRef(false);

  // Parked jobs are not range-scoped; they ride the planning invalidation
  // set through `readPlanningExtras` and keep their own generation guard.
  const fetchParkedJobs = useCallback(async (): Promise<boolean> => {
    if (!scopeActive.current || !isAdminOrManager) return false;
    const requestId = ++parkedJobsRequestIdRef.current;
    const result = await getParkedJobs().catch(() => ({ success: false as const }));
    if (!scopeActive.current || parkedJobsRequestIdRef.current !== requestId) return false;
    if (!result.success) { reportReadFailure(); return false; }
    setParkedJobs(result.jobs);
    parkedJobsLoadedRef.current = true;
    return true;
  }, [reportReadFailure, isAdminOrManager]);
  const readPlanningExtras = useCallback(async () => (isAdminOrManager ? fetchParkedJobs() : true), [isAdminOrManager, fetchParkedJobs]);

  const {
    entries,
    jobs: calendarJobs,
    vacation: vacationEntries,
    sickness: sicknessEntries,
    holidays: liveHolidayCalendar,
    board,
    changeRequestMap,
    readiness,
    updateEntries: setEntries,
    updateJobs: setCalendarJobs,
    beginMutation,
    refreshAll,
  } = useCalendarRangeData({
    organizationId,
    identityKey: `${currentUserId}:${currentUserRole}`,
    needed,
    requiredDatasets: ALL_CALENDAR_DATASETS,
    initial: initialData ? { ...initialData, holidays: holidayCalendar } : undefined,
    onReadFailed: reportReadFailure,
    readPlanningExtras,
  });
  // The skeleton replaces the grid only while no data exists at all (first
  // open, organization switch). Navigating to an uncovered window keeps the
  // grid mounted and marks it busy.
  const isLoading = readiness.kind === 'loading' && !readiness.hasData;
  const isReloading = readiness.kind === 'loading' && readiness.hasData;
  useEffect(() => { calendarJobsRef.current = calendarJobs; }, [calendarJobs]);

  useEffect(() => {
    if (isAdminOrManager && !parkedJobsLoadedRef.current) void fetchParkedJobs();
  }, [isAdminOrManager, fetchParkedJobs]);

  // P1-12: Parkplatz context (reason/responsible/next review) for managers.
  const parkingContextsRequestIdRef = useRef(0);
  const fetchParkingContexts = useCallback(async (): Promise<boolean> => {
    const requestId = ++parkingContextsRequestIdRef.current;
    if (!scopeActive.current || !isAdminOrManager) return false;
    const result = await getJobParkingContexts().catch(() => ({ success: false as const }));
    if (!scopeActive.current || parkingContextsRequestIdRef.current !== requestId) return false;
    if (!result.success) { reportReadFailure(); return false; }
    const next = new Map(result.contexts.map((context) => [context.jobId, context]));
    parkingContextsRef.current = next;
    setParkingContexts(next);
    return true;
  }, [isAdminOrManager, reportReadFailure]);
  useEffect(() => { void fetchParkingContexts(); }, [fetchParkingContexts, organizationId]);

  useRealtimeRouterRefresh({ tables: ['organization_members', 'profiles', 'organization_settings'] });
  useLiveView<null>({
    tables: ['work_blockers'],
    read: async () => ((await fetchParkingContexts()) ? { ok: true, data: null } : { ok: false }),
    initialData: null,
    enabled: isAdminOrManager,
    eventFilter: (event) => { const kind = (event.new ?? event.old)?.kind; return kind == null || kind === 'parking'; },
  });

  const handleManualRefresh = useCallback(async () => { await Promise.all([refreshAll(), fetchParkingContexts()]); }, [refreshAll, fetchParkingContexts]);
  const handleSilentRefresh = useCallback(() => { void refreshAll(); }, [refreshAll]);
  const handleOperationStart = useCallback(() => { parkedJobsRequestIdRef.current += 1; return beginMutation(); }, [beginMutation]);

  const mutations = useCalendarMutations({
    beginMutation: handleOperationStart,
    updateJobs: setCalendarJobs,
    updateEntries: setEntries,
    updateParkedJobs: setParkedJobs,
    jobsRef: calendarJobsRef,
    showBanner: (banner) => {
      if (!scopeActive.current) return;
      showBanner({ ...banner, ...(banner.actionLabel ? { actionIcon: <Undo2 className="size-3.5" /> } : {}) });
    },
    isScopeActive,
    requestApproval,
    requestPlanningApproval,
    silentRefresh: handleSilentRefresh,
  });

  const handleManualEntrySuccess = useCallback((newEntries: TimeEntry[]) => {
    const releaseOperation = handleOperationStart();
    try {
      const visible = newEntries.filter((entry) => { const timestamp = new Date(entry.timestamp).getTime(); return timestamp >= needed.start.getTime() && timestamp <= needed.end.getTime(); });
      if (visible.length > 0) {
        setEntries((prev) => {
          const merged = new Map(prev.map((entry) => [entry.id, entry]));
          for (const entry of visible) merged.set(entry.id, entry);
          return sortEntriesByTimestamp([...merged.values()]);
        });
      }
    } finally {
      releaseOperation();
    }
  }, [needed, handleOperationStart, setEntries]);

  useEffect(() => {
    const handleExternalManualEntry = (event: Event) => {
      const newEntries = (event as CustomEvent<{ entries?: TimeEntry[] }>).detail?.entries;
      if (!newEntries?.length || newEntries.every((entry) => entry.organizationId !== organizationId)) return;
      handleManualEntrySuccess(newEntries);
    };
    window.addEventListener(MANUAL_ENTRY_CREATED_EVENT, handleExternalManualEntry);
    return () => window.removeEventListener(MANUAL_ENTRY_CREATED_EVENT, handleExternalManualEntry);
  }, [handleManualEntrySuccess, organizationId]);

  useEffect(() => {
    if (pathname !== '/kalender') return;
    const queued = consumeManualEntryBridge(organizationId);
    if (queued.length > 0) handleManualEntrySuccess(queued);
  }, [handleManualEntrySuccess, organizationId, pathname]);

  // Navigation.
  const handlePrevious = useCallback(() => setCurrentDate((previous) => shiftCalendarDate(previous, view, -1, preferences.horizonWeeks)), [view, preferences.horizonWeeks]);
  const handleNext = useCallback(() => setCurrentDate((previous) => shiftCalendarDate(previous, view, 1, preferences.horizonWeeks)), [view, preferences.horizonWeeks]);
  const handleToday = useCallback(() => setCurrentDate(new Date()), []);
  const handleOpenDay = useCallback((date: Date, memberId: string | null) => {
    setCurrentDate(date);
    setHighlightMemberId(memberId);
    setView('day');
  }, [setView]);
  useEffect(() => {
    if (!highlightMemberId || isLoading) return;
    const timer = window.setTimeout(() => setHighlightMemberId(null), 1500);
    return () => window.clearTimeout(timer);
  }, [highlightMemberId, isLoading]);

  // Keyboard shortcuts (P1-24a, criterion 18) outside fields and dialogs.
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (keyBelongsToText(event)) return;
      switch (event.key) {
        case 't': handleToday(); break;
        case 'j': handleNext(); break;
        case 'k': handlePrevious(); break;
        case 'd': setView('day'); break;
        case 'w': setView('week'); break;
        case 'm': setView('month'); break;
        case 'c': if (isAdminOrManager) setAddEntry({ date: toLocalDateString(currentDate) }); break;
        case 'z': if (mutations.undoLast()) event.preventDefault(); break;
        case '?': setHelpOpen(true); break;
        case '+': if (view === 'day') setDayZoom((zoom) => Math.min(3, zoom * 1.25)); break;
        case '-': if (view === 'day') setDayZoom((zoom) => Math.max(0.5, zoom / 1.25)); break;
        default: return;
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [currentDate, handleNext, handlePrevious, handleToday, isAdminOrManager, mutations, setView, view]);

  // Member scope: null in the preferences means everyone.
  const selectedMemberIds = preferences.memberUserIds;
  const filteredEntries = useMemo(() => {
    if (!showWorkingHours) return [];
    if (!isAdminOrManager) return entries.filter((entry) => entry.userId === currentUserId);
    return selectedMemberIds ? entries.filter((entry) => selectedMemberIds.includes(entry.userId)) : entries;
  }, [entries, selectedMemberIds, isAdminOrManager, currentUserId, showWorkingHours]);
  const filteredMembers = useMemo(() => {
    if (!isAdminOrManager) return members.filter((member) => member.user_id === currentUserId);
    return selectedMemberIds ? members.filter((member) => selectedMemberIds.includes(member.user_id)) : members;
  }, [members, selectedMemberIds, isAdminOrManager, currentUserId]);
  const filteredJobs = useMemo(() => {
    if (!preferences.showJobs) return [];
    if (!isAdminOrManager) return calendarJobs.filter((job) => job.assignedUserIds.includes(currentUserId));
    return selectedMemberIds ? calendarJobs.filter((job) => job.assignedUserIds.length === 0 || job.assignedUserIds.some((userId) => selectedMemberIds.includes(userId))) : calendarJobs;
  }, [calendarJobs, preferences.showJobs, selectedMemberIds, isAdminOrManager, currentUserId]);
  const filteredParkedJobs = useMemo(() => {
    if (!isAdminOrManager) return [];
    return selectedMemberIds ? parkedJobs.filter((job) => job.assignedUserIds.length === 0 || job.assignedUserIds.some((userId) => selectedMemberIds.includes(userId))) : parkedJobs;
  }, [parkedJobs, selectedMemberIds, isAdminOrManager]);
  const memberNameMap = useMemo(() => Object.fromEntries(members.map((member) => [member.user_id, memberDisplayName(member)])), [members]);
  const boardTeams = useMemo(() => {
    const teams = new Map<string, string>();
    for (const row of board.rows) if (row.teamId && row.teamName) teams.set(row.teamId, row.teamName);
    return [...teams].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name, 'de'));
  }, [board.rows]);
  const showActualTime = resolveShowActualTime(preferences);

  const handleParkedContextMissing = useCallback(() => {
    showBanner({ variant: 'error', message: calendarRefusalMessage('parkplatz_changed') ?? '' });
    void fetchParkingContexts();
    void fetchParkedJobs();
  }, [fetchParkedJobs, fetchParkingContexts, showBanner]);

  // Park: the card leaves the grid now; the context dialog owns the write.
  const parkFlowRef = useRef<ReturnType<typeof mutations.beginPark> | null>(null);
  const handlePark = useCallback((job: CalendarJob) => {
    const authoritativeJobId = job.jobId ?? (job.occurrenceId ? null : job.id);
    if (!authoritativeJobId) {
      showBanner({ variant: 'error', message: calendarRefusalMessage('internal_not_parkable') ?? '' });
      return;
    }
    parkFlowRef.current = mutations.beginPark(job);
    setParkingContextJob({ ...job, id: authoritativeJobId, occurrenceId: undefined, jobId: authoritativeJobId });
  }, [mutations, showBanner]);

  const undoPark = useCallback(async (job: CalendarJob) => {
    const jobId = job.jobId ?? job.id;
    if (!job.plannedDate) return;
    await fetchParkingContexts();
    const context = parkingContextsRef.current?.get(jobId);
    if (!context) { handleParkedContextMissing(); return; }
    await mutations.unparkJob({
      job: { ...job, id: jobId, jobId, occurrenceId: undefined, status: 'geparkt' },
      parkingContext: context,
      plannedDate: job.plannedDate,
      plannedTime: job.plannedTime ?? undefined,
      successMessage: 'Auftrag wurde wieder eingeplant.',
    });
  }, [fetchParkingContexts, handleParkedContextMissing, mutations]);

  const handleScheduleParked = useCallback((job: CalendarJob, input: { date: string; time: string | undefined; row: CalendarBoardRow | null }) => {
    const context = parkingContextsRef.current?.get(job.jobId ?? job.id);
    setScheduleParkedJob(null);
    if (!context) { handleParkedContextMissing(); return; }
    const targetName = input.row?.displayName ?? null;
    const dateLabel = formatRefusalDate(input.date);
    void mutations.unparkJob({
      job,
      parkingContext: context,
      plannedDate: input.date,
      plannedTime: input.time,
      assignToUserId: input.row?.userId ?? undefined,
      successMessage: targetName ? `Auftrag wurde bei ${targetName} am ${dateLabel} eingeplant.` : `Auftrag wurde am ${dateLabel} eingeplant.`,
      context: { ...(targetName ? { name: targetName } : {}), date: dateLabel },
    });
  }, [handleParkedContextMissing, mutations]);

  const surfaceActions = useMemo<CalendarSurfaceActions>(() => ({
    isManager: isAdminOrManager,
    onOpenCard: (job, element, row) => setOpenCard({ job, anchor: element, row }),
    onAddEntry: (input) => setAddEntry(input),
    onPark: handlePark,
  }), [handlePark, isAdminOrManager]);

  const handleSessionClick = useCallback((session: WorkSession) => {
    const sessionUserId = session.clockIn?.userId || session.clockOut?.userId;
    const sessionMember = members.find((member) => member.user_id === sessionUserId);
    setSelectedSession({
      ...(session as InteractiveCalendarSession),
      employeeName: sessionMember ? memberDisplayName(sessionMember) : null,
      ...(sessionMember ? { employeeRole: sessionMember.role as OrgRole } : {}),
    });
  }, [members]);

  const showUnavailable = !isLoading && readiness.kind === 'unavailable';
  const calendarStale = readiness.kind === 'ready' && readiness.isStale;
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const verticalScroller = useCallback(() => scrollContainerRef.current, []);
  const neededStartIso = needed.start.toISOString();
  // Readiness marker for measured navigation (PF-22): set from an effect,
  // so it exists only after hydration and after the data owner reports
  // coverage of the rendered window. Tests read the same state users see.
  useEffect(() => {
    const element = scrollContainerRef.current;
    if (!element) return;
    element.dataset.calendarState = readiness.kind;
    element.dataset.calendarView = view;
    element.dataset.calendarRangeStart = neededStartIso;
    element.dataset.calendarStale = calendarStale ? 'true' : 'false';
    element.dataset.calendarHorizon = String(preferences.horizonWeeks);
  }, [readiness.kind, calendarStale, view, neededStartIso, preferences.horizonWeeks]);

  const todayIso = toLocalDateString(new Date());
  const anchorIso = toLocalDateString(currentDate);
  const boardRowsForForms = isAdminOrManager ? board.rows : [];

  return (
    <PageShell>
      <div ref={calendarHeaderRef}>
        <CalendarHeader
          currentDate={currentDate}
          view={view}
          horizonWeeks={preferences.horizonWeeks}
          onPrevious={handlePrevious}
          onNext={handleNext}
          onToday={handleToday}
          onRefresh={handleManualRefresh}
          onManualEntrySuccess={handleManualEntrySuccess}
          isAdminOrManager={isAdminOrManager}
          onJobSuccess={handleSilentRefresh}
          parkedJobCount={filteredParkedJobs.length}
          parkplatzOpen={parkplatzOpen}
          onParkplatzToggle={() => { setParkplatzOpen((open) => !open); setDispatchPanelOpen(false); }}
          parkplatzButtonRef={parkplatzButtonRef}
          dispatchPanelOpen={dispatchPanelOpen}
          onDispatchPanelToggle={() => { setDispatchPanelOpen((open) => !open); setParkplatzOpen(false); }}
        />
      </div>

      <div className="border-b px-4 py-2 sm:px-6">
        <CalendarViewTabs
          view={view}
          onViewChange={setView}
          members={members}
          selectedMemberIds={selectedMemberIds}
          onSelectedMemberIdsChange={(memberUserIds) => updatePreferences({ memberUserIds })}
          isAdminOrManager={isAdminOrManager}
          showWorkingHours={showWorkingHours}
          onShowWorkingHoursChange={setShowWorkingHours}
          showJobs={preferences.showJobs}
          onShowJobsChange={(showJobs) => updatePreferences({ showJobs })}
        >
          {view === 'week' && !phone && isAdminOrManager && (
            <BoardToolbar preferences={preferences} onChange={updatePreferences} teams={boardTeams} showActualTime={showActualTime} onHelp={() => setHelpOpen(true)} />
          )}
        </CalendarViewTabs>
      </div>

      {/* The calendar keeps its own scroller (the day grid and the wide board
          scroll sideways inside it, a named canon exception), so PageBody only
          supplies the column slot: padding and clock clearance switched off. */}
      {/* The Parkplatz sits beside the calendar on a desktop, so the board keeps every column reachable. */}
      <div className="flex min-h-0 flex-1">
      <PageBody className="flex min-w-0 flex-col overflow-hidden p-0 pb-0 sm:p-0 sm:pb-0">
        <div
          className={cn('flex-1 overflow-auto overscroll-none transition-opacity', isReloading && 'opacity-60')}
          data-calendar-scroll-container=""
          aria-busy={isReloading || undefined}
          inert={isReloading || calendarStale || undefined}
          ref={scrollContainerRef}
        >
          {showUnavailable ? (
            <div className="p-4 sm:p-6">
              <SectionError title="Kalender konnte nicht geladen werden" onRetry={() => void handleManualRefresh()}>
                Die Termine und Arbeitszeiten für diesen Zeitraum konnten nicht geladen werden. Die Navigation bleibt möglich.
              </SectionError>
            </div>
          ) : isLoading ? (
            <KalenderContentSkeleton withTabs={false} />
          ) : view === 'week' ? (
            <Plantafel
              anchorIso={anchorIso}
              todayIso={todayIso}
              preferences={preferences}
              showActualTime={showActualTime}
              board={board}
              jobs={filteredJobs}
              entries={entries}
              vacation={vacationEntries}
              sickness={sicknessEntries}
              holidays={liveHolidayCalendar}
              mutations={mutations}
              parkingContexts={parkingContexts}
              onParkedContextMissing={handleParkedContextMissing}
              actions={surfaceActions}
              verticalScroller={verticalScroller}
              onIsolateRow={(employeeRecordId) => {
                const row = board.rows.find((entry) => entry.employeeRecordId === employeeRecordId);
                if (row?.userId) updatePreferences({ memberUserIds: selectedMemberIds?.length === 1 && selectedMemberIds[0] === row.userId ? null : [row.userId] });
              }}
              phone={phone}
            />
          ) : view === 'day' ? (
            <DayView
              date={currentDate}
              todayIso={todayIso}
              zoom={dayZoom}
              onZoomChange={setDayZoom}
              entries={filteredEntries}
              jobs={filteredJobs}
              members={filteredMembers}
              board={board}
              holidays={liveHolidayCalendar}
              organizationSettings={organizationSettings}
              currentUserId={currentUserId}
              currentUserRole={currentUserRole}
              changeRequestMap={changeRequestMap}
              mutations={mutations}
              actions={surfaceActions}
              parkingContexts={parkingContexts}
              onParkedContextMissing={handleParkedContextMissing}
              onSessionClick={handleSessionClick}
              highlightMemberId={highlightMemberId}
              verticalScroller={verticalScroller}
            />
          ) : (
            <MonthView
              date={currentDate}
              todayIso={todayIso}
              jobs={filteredJobs}
              entries={filteredEntries}
              members={filteredMembers}
              vacation={vacationEntries}
              sickness={sicknessEntries}
              holidays={liveHolidayCalendar}
              organizationSettings={organizationSettings}
              currentUserId={currentUserId}
              isAdminOrManager={isAdminOrManager}
              mutations={mutations}
              actions={surfaceActions}
              parkingContexts={parkingContexts}
              onParkedContextMissing={handleParkedContextMissing}
              onOpenDay={(date) => handleOpenDay(date, null)}
              onSessionClick={handleSessionClick}
              verticalScroller={verticalScroller}
            />
          )}
        </div>
      </PageBody>
      {isAdminOrManager && parkplatzOpen && (
        <ParkplatzPanel
          jobs={filteredParkedJobs}
          onClose={() => setParkplatzOpen(false)}
          memberNames={memberNameMap}
          parkingContexts={parkingContexts}
          onEditContext={(job) => { parkFlowRef.current = null; setParkingContextJob(job); }}
          onDispatchJob={(job) => setParkedDispatchJob(job)}
          onScheduleJob={(job) => setScheduleParkedJob(job)}
        />
      )}
      </div>

      {isAdminOrManager && dispatchPanelOpen && (
        <DispatchPanel onClose={() => setDispatchPanelOpen(false)} onChanged={handleSilentRefresh} primaryHeaderHeight={calendarHeaderHeight} />
      )}

      {isAdminOrManager && parkingContextJob && (
        <ParkingContextDialog
          jobId={parkingContextJob.jobId ?? parkingContextJob.id}
          jobTitle={parkingContextJob.title}
          expectedExecutionVersion={parkingContextJob.executionVersion ?? 0}
          isAlreadyParked={parkFlowRef.current === null}
          existingContext={parkingContexts?.get(parkingContextJob.jobId ?? parkingContextJob.id) ?? null}
          onClose={() => {
            parkFlowRef.current?.cancelled();
            parkFlowRef.current = null;
            setParkingContextJob(null);
          }}
          onSaveStart={() => (parkFlowRef.current ? () => undefined : handleOperationStart())}
          onSaveFailed={() => { parkFlowRef.current?.failed(); parkFlowRef.current = null; }}
          onSaved={async () => {
            const job = parkingContextJob;
            const flow = parkFlowRef.current;
            parkFlowRef.current = null;
            // The contexts map is current before the dialog closes: a Parkplatz card dragged right after the
            // save reads it at the pointer, and a stale map would refuse the drop as „ohne Kontext“.
            await fetchParkingContexts();
            setParkingContextJob(null);
            if (flow) { flow.saved(() => undoPark(job)); return; }
            showBanner({ variant: 'success', message: 'Parkplatz-Kontext wurde gespeichert.' });
          }}
        />
      )}

      {isAdminOrManager && parkedDispatchJob && (
        <DispatchIssueDialog
          target={{ jobId: parkedDispatchJob.jobId ?? parkedDispatchJob.id }}
          defaultRecipientUserIds={parkedDispatchJob.assignedUserIds}
          onClose={() => setParkedDispatchJob(null)}
          onIssued={() => { setParkedDispatchJob(null); handleSilentRefresh(); }}
        />
      )}

      {isAdminOrManager && scheduleParkedJob && (
        <ScheduleParkedDialog job={scheduleParkedJob} rows={boardRowsForForms} onClose={() => setScheduleParkedJob(null)} onSchedule={(input) => handleScheduleParked(scheduleParkedJob, input)} />
      )}

      {isAdminOrManager && addEntry && (
        <CalendarEntryDialog
          open
          onOpenChange={(open) => { if (!open) setAddEntry(null); }}
          preselectedDate={new Date(`${addEntry.date}T12:00:00`)}
          preselectedUserId={addEntry.userId}
          preselectedClockInTime={addEntry.time}
          preselectedClockOutTime={addEntry.endTime}
          onManualEntrySuccess={handleManualEntrySuccess}
          onJobSuccess={() => { setAddEntry(null); announce('Eintrag wurde angelegt.'); handleSilentRefresh(); }}
        />
      )}

      <JobEventPopover
        card={openCard}
        onClose={() => setOpenCard(null)}
        memberNames={memberNameMap}
        canEditPlanning={isAdminOrManager}
        rows={boardRowsForForms}
        mutations={isAdminOrManager ? mutations : null}
        onPark={isAdminOrManager ? handlePark : null}
      />

      {selectedSession && (
        <EntryDetailsDialog
          open
          onOpenChange={(open) => !open && setSelectedSession(null)}
          session={selectedSession}
          currentUserRole={currentUserRole}
          currentUserId={currentUserId}
          onRefresh={handleSilentRefresh}
          jobName={selectedSession.jobId ? (calendarJobs.find((job) => job.id === selectedSession.jobId)?.title ?? null) : null}
          entryUserRole={(members.find((member) => member.user_id === (selectedSession.clockIn?.userId || selectedSession.clockOut?.userId))?.role as OrgRole | undefined)}
        />
      )}
      <ShortcutsHelp open={helpOpen} onOpenChange={setHelpOpen} />
      {warningDialog}
      {planningWarningDialog}
    </PageShell>
  );
}

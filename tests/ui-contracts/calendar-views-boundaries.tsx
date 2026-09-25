import { Profiler, useCallback, useLayoutEffect, useRef, useState } from 'react';
import { Plantafel } from '@/components/kalender/board/plantafel';
import type { CalendarSurfaceActions } from '@/components/kalender/board/types';
import { DayView } from '@/components/kalender/day-view/day-view';
import { MonthView } from '@/components/kalender/month-view/month-view';
import { CalendarDragProvider } from '@/components/kalender/drag-engine/drag-engine';
import { useCalendarMutations } from '@/components/kalender/mutations/use-calendar-mutations';
import { CalendarLiveRegion } from '@/components/kalender/surface/live-region';
import { CalendarClockContext } from '@/components/kalender/surface/use-now-tick';
import { useCalendarRangeData } from '@/components/kalender/use-calendar-range-data';
import { RealtimeProvider } from '@/components/realtime/realtime-provider';
import { BannerProvider, useBanner } from '@/components/ui/banner';
import type { CalendarBoardContext, CalendarBoardRow } from '@/lib/calendar/board';
import { getCalendarFetchRange } from '@/lib/calendar/navigation';
import { DEFAULT_CALENDAR_PREFERENCES } from '@/lib/calendar/preferences';
import type { CalendarJob } from '@/lib/jobs/types';
import { getDefaultTimeTrackingSettings } from '@/lib/time-tracking/settings';
import { contractJob, CalendarOrganizationContext } from './calendar-service-boundaries';

/**
 * The three calendar views against the real range owner, the real drag
 * engine and the real optimistic owner; only the writes are held (see
 * calendar-views-service-boundaries.tsx). Each fixture renders one view the
 * way the container does, under a fixed clock (2026-09-08 08:00 Berlin) and with a commit counter.
 */
declare global {
  interface Window { calendarViewContract: { commits: number; opened: string[] }; }
}
window.calendarViewContract = { commits: 0, opened: [] };

const holidays = { holidayRegion: null, holidayRegionHistory: [], closureDays: [] };
const settings = getDefaultTimeTrackingSettings('org-a');
const members = [
  { user_id: 'worker', first_name: 'Alex', last_name: 'Test', email: 'worker@example.invalid', role: 'employee' },
  { user_id: 'worker-2', first_name: 'Bea', last_name: 'Zwei', email: 'bea@example.invalid', role: 'employee' },
];
const rows: CalendarBoardRow[] = [
  { employeeRecordId: 'r1', userId: 'worker', displayName: 'Alex Test', role: 'employee', hasLogin: true, teamId: null, teamName: null, entryDate: null, exitDate: null },
  { employeeRecordId: 'r2', userId: 'worker-2', displayName: 'Bea Zwei', role: 'employee', hasLogin: true, teamId: null, teamName: null, entryDate: null, exitDate: null },
];
function boardFor(dates: string[]): CalendarBoardContext {
  return {
    rows,
    days: rows.flatMap((row) => dates.map((date) => ({ employeeRecordId: row.employeeRecordId, date, targetMinutes: 480, baseTargetMinutes: 480, reason: 'working' as const, label: null, absence: null, pendingVacation: false }))),
    dispatch: [],
    materialDemandJobIds: [],
  };
}
function visit(title: string, id: string, plannedDate: string, plannedTime: string | null, recordIds: string[], userIds: string[]): CalendarJob {
  return { ...contractJob(title), id, occurrenceId: id, jobId: `job-${id}`, plannedDate, plannedTime, estimatedDurationMinutes: plannedTime ? 60 : null, assignedEmployeeRecordIds: recordIds, assignedUserIds: userIds, entryKind: 'job_visit', timeKind: plannedTime ? 'timed' : 'all_day' };
}

function ViewHarness({ children, jobs, board, needed }: { children: (input: { jobs: CalendarJob[]; board: CalendarBoardContext; mutations: ReturnType<typeof useCalendarMutations>; actions: CalendarSurfaceActions; scroller: () => HTMLElement | null }) => React.JSX.Element; jobs: CalendarJob[]; board: CalendarBoardContext; needed: { start: Date; end: Date } }): React.JSX.Element {
  const owner = useCalendarRangeData({ organizationId: 'org-a', identityKey: 'manager:admin', needed, requiredDatasets: ['jobs', 'board'], initial: { range: needed, jobs, board, entries: [], vacation: [], sickness: [], holidays }, onReadFailed: () => {} });
  const { showBanner } = useBanner();
  const jobsRef = useRef(owner.jobs);
  useLayoutEffect(() => { jobsRef.current = owner.jobs; });
  const [parked, setParked] = useState<CalendarJob[]>([]);
  const mutations = useCalendarMutations({
    beginMutation: owner.beginMutation,
    updateJobs: owner.updateJobs,
    updateEntries: owner.updateEntries,
    updateParkedJobs: setParked,
    jobsRef,
    showBanner,
    isScopeActive: () => true,
    requestApproval: async () => null,
    requestPlanningApproval: async () => null,
    silentRefresh: () => { void owner.refreshAll(); },
  });
  const scrollerRef = useRef<HTMLDivElement>(null);
  const scroller = useCallback(() => scrollerRef.current, []);
  const actions: CalendarSurfaceActions = {
    isManager: true,
    onOpenCard: (job) => { window.calendarViewContract.opened.push(job.title); },
    onAddEntry: () => {},
    onPark: (job) => { const flow = mutations.beginPark(job); flow.saved(async () => {}); },
  };
  return <section aria-label="Kalenderansicht">
    <output aria-label="Laufende Speicherung">{owner.isMutating ? 'aktiv' : 'frei'}</output>
    <output aria-label="Geparkt">{parked.length}</output>
    <div ref={scrollerRef} data-calendar-scroll-container="" style={{ height: 600, width: 1100, overflow: 'auto', position: 'relative' }}>
      <Profiler id="view" onRender={() => { window.calendarViewContract.commits += 1; }}>
        {children({ jobs: owner.jobs, board: owner.board, mutations, actions, scroller })}
      </Profiler>
    </div>
  </section>;
}

function Providers({ children }: { children: React.ReactNode }): React.JSX.Element {
  return <CalendarClockContext.Provider value={FIXED_NOW}><CalendarOrganizationContext.Provider value="org-a"><RealtimeProvider><BannerProvider><CalendarLiveRegion><CalendarDragProvider>{children}</CalendarDragProvider></CalendarLiveRegion></BannerProvider></RealtimeProvider></CalendarOrganizationContext.Provider></CalendarClockContext.Provider>;
}

/** 2026-09-08 08:00 in Berlin: the fixture's cards at 09:00 are still ahead, the 07:00 one has started. */
const FIXED_NOW = Date.parse('2026-09-08T06:00:00.000Z');
const weekAnchor = new Date(2026, 8, 8, 12);
const weekDates = ['2026-09-07', '2026-09-08', '2026-09-09', '2026-09-10', '2026-09-11', '2026-09-12', '2026-09-13'];
const boardJobs = [visit('Prüfauftrag ziehen', 'o1', '2026-09-08', '09:00', ['r1'], ['worker']), visit('Begonnener Termin', 'o0', '2026-09-08', '07:00', ['r2'], ['worker-2'])];

export function CalendarBoardContractFixture(): React.JSX.Element {
  return <Providers>
    <ViewHarness jobs={boardJobs} board={boardFor(weekDates)} needed={getCalendarFetchRange(weekAnchor, 'week')}>
      {({ jobs, board, mutations, actions, scroller }) => (
        <Plantafel anchorIso="2026-09-08" todayIso="2026-09-08" preferences={DEFAULT_CALENDAR_PREFERENCES} showActualTime={false} board={board} jobs={jobs} entries={[]} vacation={[]} sickness={[]} holidays={holidays} mutations={mutations} parkingContexts={new Map()} onParkedContextMissing={() => {}} actions={actions} verticalScroller={scroller} onIsolateRow={() => {}} phone={false} />
      )}
    </ViewHarness>
  </Providers>;
}

export function CalendarDayContractFixture(): React.JSX.Element {
  return <Providers>
    <ViewHarness jobs={boardJobs} board={boardFor(['2026-09-08'])} needed={getCalendarFetchRange(weekAnchor, 'day')}>
      {({ jobs, board, mutations, actions, scroller }) => (
        <DayView date={weekAnchor} todayIso="2026-09-08" zoom={1} onZoomChange={() => {}} entries={[]} jobs={jobs} members={members} board={board} holidays={holidays} organizationSettings={settings} currentUserId="manager" currentUserRole="admin" changeRequestMap={{}} mutations={mutations} actions={actions} parkingContexts={new Map()} onParkedContextMissing={() => {}} onSessionClick={() => {}} highlightMemberId={null} verticalScroller={scroller} />
      )}
    </ViewHarness>
  </Providers>;
}

const monthAnchor = new Date(2026, 5, 15, 12);
const monthJobs = [
  visit('Monatsauftrag', 'm1', '2026-06-15', '09:00', ['r1'], ['worker']),
  ...['Erster', 'Zweiter', 'Dritter', 'Vierter'].map((name, index) => visit(`${name} Termin`, `m-${index}`, '2026-06-17', `${String(8 + index).padStart(2, '0')}:00`, ['r1'], ['worker'])),
];

export function CalendarMonthContractFixture(): React.JSX.Element {
  return <Providers>
    <ViewHarness jobs={monthJobs} board={boardFor([])} needed={getCalendarFetchRange(monthAnchor, 'month')}>
      {({ jobs, mutations, actions, scroller }) => (
        <MonthView date={monthAnchor} todayIso="2026-06-15" jobs={jobs} entries={[]} members={members} vacation={[]} sickness={[]} holidays={holidays} organizationSettings={settings} currentUserId="manager" isAdminOrManager mutations={mutations} actions={actions} parkingContexts={new Map()} onParkedContextMissing={() => {}} onOpenDay={() => {}} onSessionClick={() => {}} verticalScroller={scroller} />
      )}
    </ViewHarness>
  </Providers>;
}

import { Profiler, useCallback, useLayoutEffect, useRef, useState } from 'react';
import { Plantafel } from '@/components/kalender/board/plantafel';
import type { CalendarSurfaceActions } from '@/components/kalender/board/types';
import { DayView } from '@/components/kalender/day-view/day-view';
import { MonthView } from '@/components/kalender/month-view/month-view';
import { CalendarDragProvider } from '@/components/kalender/drag-engine/drag-engine';
import { useCalendarMutations } from '@/components/kalender/mutations/use-calendar-mutations';
import { CalendarTimeCorrectionDialog } from '@/components/kalender/calendar-time-correction-dialog';
import { CalendarLiveRegion } from '@/components/kalender/surface/live-region';
import { CalendarClockContext } from '@/components/kalender/surface/use-now-tick';
import { useCalendarRangeData } from '@/components/kalender/use-calendar-range-data';
import { RealtimeProvider } from '@/components/realtime/realtime-provider';
import { BannerProvider, useBanner } from '@/components/ui/banner';
import type { CalendarBoardContext, CalendarBoardRow } from '@/lib/calendar/board';
import { getCalendarFetchRange } from '@/lib/calendar/navigation';
import { DEFAULT_CALENDAR_PREFERENCES } from '@/lib/calendar/preferences';
import type { CalendarJob } from '@/lib/jobs/types';
import type { TimeEntry } from '@/lib/time-tracking/types';
import { getDefaultTimeTrackingSettings } from '@/lib/time-tracking/settings';
import { contractJob, CalendarOrganizationContext } from './calendar-service-boundaries';

/**
 * The three calendar views against the real range owner, the real drag
 * engine and the real optimistic owner; only the writes are held (see
 * calendar-views-service-boundaries.tsx). Each fixture renders one view the
 * way the container does, under a fixed clock (2026-09-08 08:00 Berlin) and with a commit counter.
 */
declare global {
  interface Window {
    calendarViewContract: { commits: number; opened: string[] };
  }
}
window.calendarViewContract = { commits: 0, opened: [] };

const holidays = { holidayRegion: null, holidayRegionHistory: [], closureDays: [] };
const settings = getDefaultTimeTrackingSettings('org-a');
const members = [
  {
    user_id: 'worker',
    first_name: 'Alex',
    last_name: 'Test',
    email: 'worker@example.invalid',
    role: 'employee',
  },
  {
    user_id: 'worker-2',
    first_name: 'Bea',
    last_name: 'Zwei',
    email: 'bea@example.invalid',
    role: 'employee',
  },
];
const rows: CalendarBoardRow[] = [
  {
    employeeRecordId: 'r1',
    userId: 'worker',
    displayName: 'Alex Test',
    role: 'employee',
    hasLogin: true,
    teamId: null,
    teamName: null,
    entryDate: null,
    exitDate: null,
  },
  {
    employeeRecordId: 'r2',
    userId: 'worker-2',
    displayName: 'Bea Zwei',
    role: 'employee',
    hasLogin: true,
    teamId: null,
    teamName: null,
    entryDate: null,
    exitDate: null,
  },
];
function boardFor(dates: string[]): CalendarBoardContext {
  return {
    rows,
    days: rows.flatMap((row) =>
      dates.map((date) => ({
        employeeRecordId: row.employeeRecordId,
        date,
        targetMinutes: 480,
        baseTargetMinutes: 480,
        reason: 'working' as const,
        label: null,
        absence: null,
        pendingVacation: false,
      })),
    ),
    dispatch: [],
    materialDemandJobIds: [],
  };
}
function visit(
  title: string,
  id: string,
  plannedDate: string,
  plannedTime: string | null,
  recordIds: string[],
  userIds: string[],
): CalendarJob {
  return {
    ...contractJob(title),
    clientName: 'Musterkunde',
    location: 'Musterstraße 12',
    id,
    occurrenceId: id,
    jobId: `job-${id}`,
    plannedDate,
    plannedTime,
    estimatedDurationMinutes: plannedTime ? 60 : null,
    assignedEmployeeRecordIds: recordIds,
    assignedUserIds: userIds,
    entryKind: 'job_visit',
    timeKind: plannedTime ? 'timed' : 'all_day',
  };
}

function ViewHarness({
  children,
  jobs,
  board,
  needed,
  entries = [],
}: {
  children: (input: {
    jobs: CalendarJob[];
    entries: TimeEntry[];
    board: CalendarBoardContext;
    mutations: ReturnType<typeof useCalendarMutations>;
    actions: CalendarSurfaceActions;
    scroller: () => HTMLElement | null;
  }) => React.JSX.Element;
  jobs: CalendarJob[];
  entries?: TimeEntry[];
  board: CalendarBoardContext;
  needed: { start: Date; end: Date };
}): React.JSX.Element {
  const owner = useCalendarRangeData({
    organizationId: 'org-a',
    identityKey: 'manager:admin',
    needed,
    requiredDatasets: ['jobs', 'board'],
    initial: { range: needed, jobs, board, entries, vacation: [], sickness: [], holidays },
    onReadFailed: () => {},
  });
  const { showBanner } = useBanner();
  const jobsRef = useRef(owner.jobs);
  useLayoutEffect(() => {
    jobsRef.current = owner.jobs;
  });
  const [parked, setParked] = useState<CalendarJob[]>([]);
  const pendingPark = useRef<ReturnType<ReturnType<typeof useCalendarMutations>['beginPark']> | null>(null);
  const mutations = useCalendarMutations({
    beginMutation: owner.beginMutation,
    updateJobs: owner.updateJobs,
    updateParkedJobs: setParked,
    jobsRef,
    showBanner,
    isScopeActive: () => true,
    requestApproval: async () => null,
    requestPlanningApproval: async () => null,
    silentRefresh: () => {
      void owner.refreshAll();
    },
  });
  const scrollerRef = useRef<HTMLDivElement>(null);
  const scroller = useCallback(() => scrollerRef.current, []);
  const actions: CalendarSurfaceActions = {
    isManager: true,
    onOpenCard: (job) => {
      window.calendarViewContract.opened.push(job.title);
    },
    onAddEntry: () => {},
    onPark: (job) => {
      const flow = mutations.beginPark(job);
      flow.saved(async () => {});
    },
  };
  return (
    <section aria-label="Kalenderansicht">
      {mutations.timeCorrectionDraft && (
        <CalendarTimeCorrectionDialog
          organizationId="org-a"
          draft={mutations.timeCorrectionDraft}
          rows={owner.board.rows}
          onClose={mutations.closeTimeCorrection}
          onSubmitted={() => {}}
        />
      )}
      <button
        type="button"
        onClick={() => {
          const job = owner.jobs[0];
          if (job) pendingPark.current = mutations.beginPark(job);
        }}
      >
        Parken beginnen
      </button>
      <button
        type="button"
        onClick={() => {
          pendingPark.current?.cancelled();
          pendingPark.current = null;
        }}
      >
        Parken abbrechen
      </button>
      <output aria-label="Laufende Speicherung">{owner.isMutating ? 'aktiv' : 'frei'}</output>
      <output aria-label="Geparkt">{parked.length}</output>
      <div
        ref={scrollerRef}
        data-calendar-scroll-container=""
        style={{ height: 600, width: 1100, maxWidth: '100%', overflow: 'auto', position: 'relative' }}
      >
        <Profiler
          id="view"
          onRender={() => {
            window.calendarViewContract.commits += 1;
          }}
        >
          {children({
            jobs: owner.jobs,
            entries: owner.entries,
            board: owner.board,
            mutations,
            actions,
            scroller,
          })}
        </Profiler>
      </div>
    </section>
  );
}

function CalendarFixtureNavigation({ children }: { children: React.ReactNode }): React.JSX.Element {
  const [visible, setVisible] = useState(true);
  const { showBanner } = useBanner();
  return (
    <>
      <button type="button" onClick={() => setVisible(false)}>
        Kalender verlassen
      </button>
      <button
        type="button"
        onClick={() => {
          showBanner({ variant: 'info', message: 'Neuer Bereich', autoDismissMs: null });
          setVisible(false);
        }}
      >
        Mit neuem Hinweis wechseln
      </button>
      {visible ? children : <p>Anderer Bereich</p>}
    </>
  );
}

function Providers({
  children,
  now = FIXED_NOW,
}: {
  children: React.ReactNode;
  now?: number;
}): React.JSX.Element {
  return (
    <CalendarClockContext.Provider value={now}>
      <CalendarOrganizationContext.Provider value="org-a">
        <RealtimeProvider>
          <BannerProvider>
            <CalendarLiveRegion>
              <CalendarDragProvider>
                <CalendarFixtureNavigation>{children}</CalendarFixtureNavigation>
              </CalendarDragProvider>
            </CalendarLiveRegion>
          </BannerProvider>
        </RealtimeProvider>
      </CalendarOrganizationContext.Provider>
    </CalendarClockContext.Provider>
  );
}

/** 2026-09-08 08:00 in Berlin: the fixture's cards at 09:00 are still ahead, the 07:00 one has started. */
const FIXED_NOW = Date.parse('2026-09-08T06:00:00.000Z');
const weekAnchor = new Date(2026, 8, 8, 12);
const weekDates = [
  '2026-09-07',
  '2026-09-08',
  '2026-09-09',
  '2026-09-10',
  '2026-09-11',
  '2026-09-12',
  '2026-09-13',
];
const boardJobs = [
  visit('Prüfauftrag ziehen', 'o1', '2026-09-08', '09:00', ['r1'], ['worker']),
  visit('Begonnener Termin', 'o0', '2026-09-08', '07:00', ['r2'], ['worker-2']),
  { ...visit('Zweiter Besuch', 'o2', '2026-09-10', '09:00', ['r1'], ['worker']), jobId: 'job-o1' },
];

export function CalendarBoardContractFixture(): React.JSX.Element {
  const [compact, setCompact] = useState(false);
  const [populated, setPopulated] = useState(false);
  const entries: TimeEntry[] = [0, 1].map((index) => {
    const timestamp = `2026-09-08T0${5 + index}:00:00.000Z`;
    return {
      id: `board-time-${index}`,
      userId: 'worker',
      organizationId: 'org-a',
      entryType: index === 0 ? 'clock_in' : 'clock_out',
      timestamp,
      isManual: false,
      jobId: null,
      status: 'approved',
      reviewedBy: null,
      reviewedAt: null,
      createdAt: timestamp,
      updatedAt: timestamp,
      activityKind: 'work',
    };
  });
  return (
    <Providers>
      <button type="button" onClick={() => setCompact(!compact)}>
        Kompakte Zeilen
      </button>
      <button type="button" onClick={() => setPopulated(true)}>
        Volle Zeile
      </button>
      <ViewHarness
        jobs={boardJobs}
        board={boardFor(weekDates)}
        needed={getCalendarFetchRange(weekAnchor, 'week')}
      >
        {({ jobs, board, mutations, actions, scroller }) => (
          <Plantafel
            anchorIso="2026-09-08"
            todayIso="2026-09-08"
            preferences={{ ...DEFAULT_CALENDAR_PREFERENCES, density: compact ? 'compact' : 'comfortable' }}
            showActualTime={populated}
            board={board}
            jobs={
              populated
                ? [
                    ...jobs,
                    {
                      ...visit('Zweiter Auftrag', 'full-day', '2026-09-08', '10:00', ['r1'], ['worker']),
                      estimatedDurationMinutes: 480,
                    },
                  ]
                : jobs
            }
            entries={entries}
            vacation={[]}
            sickness={[]}
            holidays={holidays}
            mutations={mutations}
            parkingContexts={new Map()}
            onParkedContextMissing={() => {}}
            actions={actions}
            verticalScroller={scroller}
            onIsolateRow={() => {}}
            phone={false}
          />
        )}
      </ViewHarness>
    </Providers>
  );
}

export function CalendarDayContractFixture(): React.JSX.Element {
  const [phone, setPhone] = useState(false);
  const shortEntries: TimeEntry[] = [0, 2].map((minute, index) => {
    const timestamp = `2026-09-08T05:0${minute}:00.000Z`;
    return {
      id: `short-time-${index}`,
      userId: 'worker-2',
      organizationId: 'org-a',
      entryType: index === 0 ? 'clock_in' : 'clock_out',
      timestamp,
      isManual: false,
      jobId: null,
      status: 'approved',
      reviewedBy: null,
      reviewedAt: null,
      createdAt: timestamp,
      updatedAt: timestamp,
      activityKind: 'travel',
      sourceKind: 'legacy_entry',
      sourceVersion: timestamp,
    };
  });
  const dayJobs = [
    ...boardJobs,
    {
      ...visit('Kurzer Termin', 'short-visit', '2026-09-08', '12:00', ['r2'], ['worker-2']),
      estimatedDurationMinutes: 2,
    },
    visit('Ganztägige Baustelle', 'all-day-visit', '2026-09-08', null, ['r2'], ['worker-2']),
  ];
  return (
    <Providers>
      <button type="button" onClick={() => setPhone(!phone)}>
        Telefonansicht
      </button>
      <ViewHarness
        jobs={dayJobs}
        entries={[
          ...shortEntries,
          ...shortEntries.map((entry) => ({
            ...entry,
            id: 'pending-' + entry.id,
            timestamp: entry.timestamp.replace('T05:', 'T08:'),
            status: 'pending' as const,
          })),
        ]}
        board={boardFor(['2026-09-08'])}
        needed={getCalendarFetchRange(weekAnchor, 'day')}
      >
        {({ jobs, entries, board, mutations, actions, scroller }) => (
          <DayView
            phone={phone}
            date={weekAnchor}
            todayIso="2026-09-08"
            zoom={1}
            onZoomChange={() => {}}
            entries={entries}
            jobs={jobs}
            members={members}
            board={board}
            holidays={holidays}
            organizationSettings={settings}
            currentUserId="manager"
            currentUserRole="admin"
            changeRequestMap={{}}
            mutations={mutations}
            actions={actions}
            parkingContexts={new Map()}
            onParkedContextMissing={() => {}}
            onSessionClick={() => {
              window.calendarViewContract.opened.push('Arbeitszeit');
            }}
            highlightMemberId={null}
            verticalScroller={scroller}
          />
        )}
      </ViewHarness>
    </Providers>
  );
}

const monthAnchor = new Date(2026, 5, 15, 12);
const monthJobs = [
  visit('Monatsauftrag', 'm1', '2026-06-15', '09:00', ['r1'], ['worker']),
  ...['Erster', 'Zweiter', 'Dritter', 'Vierter'].map((name, index) =>
    visit(
      `${name} Termin`,
      `m-${index}`,
      '2026-06-17',
      `${String(8 + index).padStart(2, '0')}:00`,
      ['r1'],
      ['worker'],
    ),
  ),
];

export function CalendarMonthContractFixture(): React.JSX.Element {
  return (
    <Providers now={Date.parse('2026-06-15T06:00:00.000Z')}>
      <ViewHarness jobs={monthJobs} board={boardFor([])} needed={getCalendarFetchRange(monthAnchor, 'month')}>
        {({ jobs, mutations, actions, scroller }) => (
          <MonthView
            date={monthAnchor}
            todayIso="2026-06-15"
            jobs={jobs}
            entries={[]}
            members={members}
            vacation={[]}
            sickness={[]}
            holidays={holidays}
            organizationSettings={settings}
            currentUserId="manager"
            isAdminOrManager
            mutations={mutations}
            actions={actions}
            parkingContexts={new Map()}
            onParkedContextMissing={() => {}}
            onOpenDay={() => {}}
            onSessionClick={() => {}}
            verticalScroller={scroller}
          />
        )}
      </ViewHarness>
    </Providers>
  );
}

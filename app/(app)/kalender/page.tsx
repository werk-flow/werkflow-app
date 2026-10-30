import { Suspense } from 'react';

import { resolvePageMembership } from '@/lib/org/page-context';
import { getCachedOrganizationCalendar, getCachedOrganizationSettings } from '@/lib/data/cached';
import { getTimeEntries } from '@/lib/time-tracking/entry-read-actions';
import { getChangeRequestsForEntries } from '@/lib/time-tracking/review-actions';
import { completeCalendarEntryRead } from '@/lib/calendar/entry-read';
import { calendarDateFromQuery } from '@/lib/calendar/date-range';
import { getPlanningEntries } from '@/lib/planning/actions';
import { getCalendarBoardContext } from '@/lib/calendar/board-actions';
import { getSicknessCalendarEntries } from '@/lib/sickness/actions';
import { getVacationCalendarEntries } from '@/lib/vacation/calendar-actions';
import { toCalendarJob } from '@/lib/planning/view-model';
import { CalendarContainer } from '@/components/kalender/calendar-container';
import type { CalendarInitialData } from '@/components/kalender/use-calendar-range-data';
import { KalenderPageSkeleton } from '@/components/loading-states/kalender-page-skeleton';
import { PageHeader } from '@/components/shared/page-header';
import { RegionLoadError } from '@/components/shared/region-load-error';
import { PageBody, PageShell } from '@/components/shared/page-shell';
import {
  getBerlinDayFetchRange,
  getBerlinWeekFetchRange,
  getBerlinMonthFetchRange,
} from '@/lib/calendar/business-range';
import { getCalendarPreferencesForPage } from '@/lib/calendar/preferences-server';
import type { CalendarPreferences } from '@/lib/calendar/preferences';
import { logError } from '@/lib/logging';
import { isManagerRole, type OrgRole } from '@/lib/roles';
import { getOrgMembersForUser } from '@/lib/members/queries';
import type { MemberListEntry } from '@/lib/members/profile-name';
import { addLocalDays, getBusinessTodayIso } from '@/lib/date-time/berlin';

async function KalenderData({
  activeOrgId,
  userId,
  currentUserRole,
  isAdminOrManager,
  searchParams,
}: {
  activeOrgId: string;
  userId: string;
  currentUserRole: OrgRole;
  isAdminOrManager: boolean;
  searchParams: Promise<{ date?: string | string[] }>;
}) {
  // The prefetched window is the Berlin business day plus the previous day,
  // computed from Berlin wall time rather than the server process timezone
  // (PF-17). The client compares this range with the window it renders and
  // reads again only when its own local day differs.
  const businessDate = calendarDateFromQuery((await searchParams).date, getBusinessTodayIso());
  // The landing view is the user's saved view, else the Plantafel for managers
  // and the day for employees (P1-24a, D1); the prefetch covers its window.
  let preferences: CalendarPreferences;
  try {
    preferences = await getCalendarPreferencesForPage(activeOrgId, userId);
  } catch (error) {
    logError('kalender.page.preferences_read_failed', error);
    return (
      <PageShell>
        <PageHeader title="Kalender" />
        <PageBody>
          <RegionLoadError>
            Deine Kalenderansicht konnte nicht geladen werden. Bitte versuche es erneut.
          </RegionLoadError>
        </PageBody>
      </PageShell>
    );
  }
  const landingView = preferences.view ?? (isAdminOrManager ? 'week' : 'day');
  const window =
    landingView === 'week'
      ? getBerlinWeekFetchRange(businessDate, preferences.horizonWeeks)
      : landingView === 'month'
        ? getBerlinMonthFetchRange(businessDate)
        : {
            ...getBerlinDayFetchRange(businessDate),
            fromIso: addLocalDays(businessDate, -1),
            toIso: businessDate,
          };
  const range = { start: window.start, end: window.end };
  const fromIso = window.fromIso;
  const toIso = window.toIso;

  async function fetchMembers(): Promise<MemberListEntry[] | null> {
    const membersRead = await getOrgMembersForUser(activeOrgId, userId);
    if (!membersRead.success) return null;
    if (isAdminOrManager) {
      return membersRead.members;
    }
    return membersRead.members.filter((member) => member.user_id === userId);
  }

  const dates = { from: fromIso, to: toIso };
  const [
    entriesResult,
    members,
    jobsResult,
    organizationSettings,
    holidayCalendar,
    vacationResult,
    sicknessResult,
    boardResult,
  ] = await Promise.all([
    completeCalendarEntryRead(
      getTimeEntries({
        organizationId: activeOrgId,
        from: range.start.toISOString(),
        to: range.end.toISOString(),
      }),
      getChangeRequestsForEntries,
    ),
    fetchMembers(),
    getPlanningEntries(fromIso, toIso),
    getCachedOrganizationSettings(activeOrgId),
    getCachedOrganizationCalendar(activeOrgId),
    getVacationCalendarEntries(dates),
    getSicknessCalendarEntries(dates),
    getCalendarBoardContext({ organizationId: activeOrgId, fromDate: fromIso, toDate: toIso }),
  ]);

  if (!members) {
    return (
      <RegionLoadError title="Der Kalender konnte nicht geladen werden">
        Die Mitarbeiterliste ist gerade nicht erreichbar. Versuche es in einem Moment erneut.
      </RegionLoadError>
    );
  }

  // Initial data carries the same official plus provisional projection and
  // the same pending-correction badges as every later client read (PF-06).
  const initialData: CalendarInitialData = {
    range,
    ...(entriesResult.success
      ? { entries: entriesResult.entries, changeRequestMap: entriesResult.changeRequestMap }
      : {}),
    ...(jobsResult.success ? { jobs: jobsResult.entries.map(toCalendarJob) } : {}),
    ...(vacationResult.success ? { vacation: vacationResult.entries } : {}),
    ...(sicknessResult.success ? { sickness: sicknessResult.entries } : {}),
    ...(boardResult.success
      ? {
          board: {
            rows: boardResult.rows,
            days: boardResult.days,
            dispatch: boardResult.dispatch,
            materialDemandJobIds: boardResult.materialDemandJobIds,
          },
        }
      : {}),
  };

  return (
    <CalendarContainer
      organizationId={activeOrgId}
      currentUserId={userId}
      currentUserRole={currentUserRole}
      isAdminOrManager={isAdminOrManager}
      members={members}
      organizationSettings={organizationSettings}
      holidayCalendar={holidayCalendar}
      initialData={initialData}
      initialDate={businessDate}
      initialPreferences={preferences}
      initialView={landingView}
    />
  );
}

export default async function KalenderPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string | string[] }>;
}) {
  const { user, membership } = await resolvePageMembership();

  if (!membership) {
    return (
      <PageShell>
        <PageHeader title="Kalender" />
        <PageBody>
          <p className="text-muted-foreground">Bitte wähle zuerst eine Organisation aus.</p>
        </PageBody>
      </PageShell>
    );
  }

  const activeOrgId = membership.orgId;
  const currentUserRole = membership.role;
  const isAdminOrManager = isManagerRole(currentUserRole);

  // CalendarContainer renders the page shell itself: its header carries the
  // date navigation and the create action, which are bound to client state.
  return (
    <Suspense fallback={<KalenderPageSkeleton />}>
      <KalenderData
        searchParams={searchParams}
        activeOrgId={activeOrgId}
        userId={user.id}
        currentUserRole={currentUserRole}
        isAdminOrManager={isAdminOrManager}
      />
    </Suspense>
  );
}

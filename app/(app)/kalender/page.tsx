import { Suspense } from 'react';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

import { resolveActiveOrgId } from '@/lib/org/cookies';
import {
  getCachedMemberships,
  getCachedOrganizationCalendar,
  getCachedOrganizationSettings,
  getCachedUser,
} from '@/lib/data/cached';
import { getChangeRequestsForEntries, getTimeEntries } from '@/lib/time-tracking/actions';
import { completeCalendarEntryRead } from '@/lib/calendar/entry-read';
import { calendarDateFromQuery } from '@/lib/calendar/date-range';
import { getPlanningEntries } from '@/lib/planning/actions';
import { toCalendarJob } from '@/lib/planning/view-model';
import { CalendarContainer } from '@/components/kalender/calendar-container';
import type { CalendarInitialData } from '@/components/kalender/use-calendar-range-data';
import { KalenderPageSkeleton } from '@/components/loading-states/kalender-page-skeleton';
import { PageHeader } from '@/components/shared/page-header';
import { PageBody, PageShell } from '@/components/shared/page-shell';
import { getBerlinDayFetchRange } from '@/lib/calendar/business-range';
import { type OrgRole } from '@/lib/members/actions';
import { getOrgMembersForUser } from '@/lib/members/queries';
import { getBusinessTodayIso, shiftIsoDateByDays } from '@/lib/personnel/types';

type MemberRow = {
  user_id: string;
  first_name: string | null;
  last_name: string | null;
  email: string;
  role: string;
};

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
  const range = getBerlinDayFetchRange(businessDate);
  const fromIso = shiftIsoDateByDays(businessDate, -1);

  async function fetchMembers(): Promise<MemberRow[]> {
    const data = await getOrgMembersForUser(activeOrgId, userId);
    if (isAdminOrManager) {
      return data;
    }
    return data.filter((member) => member.user_id === userId);
  }

  const [entriesResult, members, jobsResult, organizationSettings, holidayCalendar] =
    await Promise.all([
      completeCalendarEntryRead(getTimeEntries({
        organizationId: activeOrgId,
        from: range.start.toISOString(),
        to: range.end.toISOString()
      }), getChangeRequestsForEntries),
      fetchMembers(),
      getPlanningEntries(fromIso, businessDate),
      getCachedOrganizationSettings(activeOrgId),
      getCachedOrganizationCalendar(activeOrgId),
    ]);

  // Initial data carries the same official plus provisional projection and
  // the same pending-correction badges as every later client read (PF-06).
  const initialData: CalendarInitialData = {
    range,
    ...(entriesResult.success
      ? { entries: entriesResult.entries, changeRequestMap: entriesResult.changeRequestMap }
      : {}),
    ...(jobsResult.success ? { jobs: jobsResult.entries.map(toCalendarJob) } : {}),
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
    />
  );
}

export default async function KalenderPage({ searchParams }: {
  searchParams: Promise<{ date?: string | string[] }>;
}) {
  const [{ data: { user } }, cookieStore] = await Promise.all([
    getCachedUser(),
    cookies()
  ]);

  if (!user) {
    redirect('/login');
  }

  const [activeOrgId, memberships] = await Promise.all([
    resolveActiveOrgId(cookieStore, user.id),
    getCachedMemberships(user.id)
  ]);

  if (!activeOrgId) {
    return (
      <PageShell>
        <PageHeader title="Kalender" />
        <PageBody>
          <p className="text-muted-foreground">
            Bitte wähle zuerst eine Organisation aus.
          </p>
        </PageBody>
      </PageShell>
    );
  }

  const currentMembership = memberships.find((m) => m.orgId === activeOrgId);

  if (!currentMembership) {
    redirect('/dashboard');
  }

  const currentUserRole = currentMembership.role as OrgRole;
  const isAdminOrManager =
    currentUserRole === 'admin' || currentUserRole === 'buero';

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

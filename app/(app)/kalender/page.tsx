import { Suspense } from 'react';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

import { resolveActiveOrgId } from '@/lib/org/cookies';
import {
  getCachedMemberships,
  getCachedOrganizationSettings,
  getCachedUser,
} from '@/lib/data/cached';
import { getTimeEntries } from '@/lib/time-tracking/actions';
import { getJobsForCalendar } from '@/lib/jobs/actions';
import { CalendarContainer } from '@/components/kalender/calendar-container';
import { KalenderContentSkeleton } from '@/components/loading-states/kalender-content-skeleton';
import { getOrgMembersForUser, type OrgRole } from '@/lib/members/actions';
import { toLocalDateString } from '@/lib/utils';

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
  isAdminOrManager
}: {
  activeOrgId: string;
  userId: string;
  currentUserRole: OrgRole;
  isAdminOrManager: boolean;
}) {
  const now = new Date();
  const dayStart = new Date(now);
  dayStart.setDate(dayStart.getDate() - 1);
  dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(now);
  dayEnd.setHours(23, 59, 59, 999);

  async function fetchMembers(): Promise<MemberRow[]> {
    const data = await getOrgMembersForUser(activeOrgId, userId);
    if (isAdminOrManager) {
      return data;
    }
    return data.filter((member) => member.user_id === userId);
  }

  const fromIso = toLocalDateString(dayStart);
  const toIso = toLocalDateString(dayEnd);

  const [entriesResult, members, jobsResult, organizationSettings] = await Promise.all([
    getTimeEntries({
      organizationId: activeOrgId,
      from: dayStart.toISOString(),
      to: dayEnd.toISOString()
    }),
    fetchMembers(),
    getJobsForCalendar(fromIso, toIso),
    getCachedOrganizationSettings(activeOrgId),
  ]);

  return (
    <CalendarContainer
      organizationId={activeOrgId}
      currentUserId={userId}
      currentUserRole={currentUserRole}
      isAdminOrManager={isAdminOrManager}
      members={members}
      organizationSettings={organizationSettings}
      initialEntries={entriesResult.success ? entriesResult.entries : undefined}
      initialJobs={jobsResult.success ? jobsResult.jobs : undefined}
    />
  );
}

export default async function KalenderPage() {
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
      <div className="flex h-full flex-col p-6">
        <h1 className="text-2xl font-bold">Kalender</h1>
        <p className="mt-4 text-muted-foreground">
          Bitte wähle zuerst eine Organisation aus.
        </p>
      </div>
    );
  }

  const currentMembership = memberships.find((m) => m.orgId === activeOrgId);

  if (!currentMembership) {
    redirect('/dashboard');
  }

  const currentUserRole = currentMembership.role as OrgRole;
  const isAdminOrManager =
    currentUserRole === 'admin' || currentUserRole === 'buero';

  return (
    <Suspense fallback={<KalenderContentSkeleton />}>
      <KalenderData
        activeOrgId={activeOrgId}
        userId={user.id}
        currentUserRole={currentUserRole}
        isAdminOrManager={isAdminOrManager}
      />
    </Suspense>
  );
}

import { Suspense } from 'react';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

import { resolveActiveOrgId } from '@/lib/org/cookies';
import { getCachedUser, getCachedMemberships } from '@/lib/data/cached';
import { getCachedOrganizationSettings } from '@/lib/data/cached';
import { ZeiterfassungHeader } from '@/components/zeiterfassung/zeiterfassung-header';
import { ZeiterfassungContent } from '@/components/zeiterfassung/zeiterfassung-content';
import { ZeiterfassungContentSkeleton } from '@/components/loading-states/zeiterfassung-content-skeleton';
import {
  getCurrentClockState,
  getTimeEntries,
} from '@/lib/time-tracking/actions';
import { getOrgMembersForUser, type OrgRole } from '@/lib/members/actions';
import type { LiveClockState, ZeiterfassungOverview } from '@/lib/time-tracking/types';
import {
  buildWeeklyTimeData,
  computeWeekLabel,
  getTodayIndex,
  getWeekBounds,
} from '@/lib/time-tracking/weekly';

function createDefaultClockState(
  activeOrgId: string,
  organizationSettings: Awaited<ReturnType<typeof getCachedOrganizationSettings>>
): LiveClockState {
  return {
    organizationId: activeOrgId,
    breakMode: organizationSettings.breakMode,
    autoBreakThresholdMinutes: organizationSettings.autoBreakThresholdMinutes,
    autoBreakDurationMinutes: organizationSettings.autoBreakDurationMinutes,
    status: 'clocked_out',
    isClockedIn: false,
    isOnBreak: false,
    clockInTime: null,
    statusStartedAt: null,
    breakStartTime: null,
    todayMinutes: 0,
    workMinutes: 0,
    breakMinutes: 0,
    timelineSegments: [],
    activeJobId: null,
    activeJobInfo: null,
    fetchedAt: new Date().toISOString(),
  };
}

async function getInitialOverview(
  activeOrgId: string,
  userId: string
): Promise<ZeiterfassungOverview> {
  const { monday, sunday } = getWeekBounds();
  const weekLabel = computeWeekLabel(monday);
  const todayIndex = getTodayIndex();

  const [clockStateResult, weekEntriesResult, organizationSettings] = await Promise.all([
    getCurrentClockState(activeOrgId),
    getTimeEntries({
      organizationId: activeOrgId,
      from: monday.toISOString(),
      to: sunday.toISOString(),
      userId,
    }),
    getCachedOrganizationSettings(activeOrgId),
  ]);

  return {
    clockState: clockStateResult.success
      ? clockStateResult.state
      : createDefaultClockState(activeOrgId, organizationSettings),
    weekData:
      weekEntriesResult.success && weekEntriesResult.entries
        ? buildWeeklyTimeData(weekEntriesResult.entries, monday, organizationSettings)
        : [],
    todayIndex,
    weekLabel,
  };
}

async function ZeiterfassungData({
  activeOrgId,
  userId,
  isAdminOrManager,
  isAdmin,
  currentUserRole,
  tab
}: {
  activeOrgId: string;
  userId: string;
  isAdminOrManager: boolean;
  isAdmin: boolean;
  currentUserRole: OrgRole;
  tab: string | undefined;
}) {
  async function fetchMembers(): Promise<Array<{
    user_id: string;
    first_name: string | null;
    last_name: string | null;
    email: string;
    role: string;
  }>> {
    if (!isAdminOrManager) return [];

    return getOrgMembersForUser(activeOrgId, userId);
  }

  const [initialOverview, members] = await Promise.all([
    getInitialOverview(activeOrgId, userId),
    fetchMembers(),
  ]);

  return (
    <ZeiterfassungContent
      organizationId={activeOrgId}
      userId={userId}
      isAdminOrManager={isAdminOrManager}
      isAdmin={isAdmin}
      currentUserRole={currentUserRole}
      initialTab={tab === 'approvals' ? 'approvals' : 'overview'}
      members={members}
      initialOverview={initialOverview}
    />
  );
}

interface ZeiterfassungPageProps {
  searchParams: Promise<{ tab?: string }>;
}

export default async function ZeiterfassungPage({
  searchParams
}: ZeiterfassungPageProps) {
  const [{ tab }, { data: { user } }, cookieStore] = await Promise.all([
    searchParams,
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
        <h1 className="text-2xl font-bold">Zeiterfassung</h1>
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
  const isAdmin = currentUserRole === 'admin';

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <ZeiterfassungHeader />

      <div className="flex-1 overflow-auto p-4 sm:p-6">
        <Suspense fallback={<ZeiterfassungContentSkeleton />}>
          <ZeiterfassungData
            activeOrgId={activeOrgId}
            userId={user.id}
            isAdminOrManager={isAdminOrManager}
            isAdmin={isAdmin}
            currentUserRole={currentUserRole}
            tab={tab}
          />
        </Suspense>
      </div>
    </div>
  );
}

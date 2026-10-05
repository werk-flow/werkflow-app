import { Suspense } from 'react';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

import { resolveActiveOrgId } from '@/lib/org/cookies';
import { getCachedUser, getCachedMemberships } from '@/lib/data/cached';
import { getCachedOrganizationSettings } from '@/lib/data/cached';
import { ManualEntryButton } from '@/components/zeiterfassung/manual-entry-button';
import { PageHeaderActions } from '@/components/shared/page-action';
import { ZeiterfassungContent } from '@/components/zeiterfassung/zeiterfassung-content';
import { ZeiterfassungContentSkeleton } from '@/components/loading-states/zeiterfassung-content-skeleton';
import { getCurrentClockState, getTimeEntries } from '@/lib/time-tracking/actions';
import { getWeeklyTargets } from '@/lib/personnel/target-actions';
import { type OrgRole } from '@/lib/members/actions';
import { getOrgMembersForUser } from '@/lib/members/queries';
import type { ZeiterfassungOverview } from '@/lib/time-tracking/types';
import {
  buildWeeklyTimeData,
  computeWeekLabel,
  getTodayIndex,
  getWeekBounds,
} from '@/lib/time-tracking/weekly';
import {
  getEffectiveResponsibilityHolderForActor,
  loadResponsibilityRuntimeState,
} from '@/lib/responsibilities/server';
import { RegionLoadError } from '@/components/shared/region-load-error';

/**
 * The overview's server data, or null when one of its reads failed: a failed
 * clock read is unknown state, never a clocked-out day, and a failed week read
 * is never an empty week. The overview tab then shows the failure with retry.
 */
async function getInitialOverview(
  activeOrgId: string,
  userId: string,
): Promise<ZeiterfassungOverview | null> {
  const { monday, sunday } = getWeekBounds();

  const [clockStateResult, weekEntriesResult, organizationSettings, targetsResult] = await Promise.all([
    getCurrentClockState(activeOrgId),
    getTimeEntries({
      organizationId: activeOrgId,
      from: monday.toISOString(),
      to: sunday.toISOString(),
      userId,
    }),
    getCachedOrganizationSettings(activeOrgId),
    getWeeklyTargets({ userId }),
  ]);
  if (!clockStateResult.success || !weekEntriesResult.success || !targetsResult.success) return null;

  return {
    clockState: clockStateResult.state,
    weekData: buildWeeklyTimeData(
      weekEntriesResult.entries,
      monday,
      organizationSettings,
      targetsResult.targets,
    ),
    todayIndex: getTodayIndex(),
    weekLabel: computeWeekLabel(monday),
    weekTargets: targetsResult.targets,
  };
}

async function ZeiterfassungData({
  activeOrgId,
  userId,
  isAdminOrManager,
  isAdmin,
  currentUserRole,
  tab,
}: {
  activeOrgId: string;
  userId: string;
  isAdminOrManager: boolean;
  isAdmin: boolean;
  currentUserRole: OrgRole;
  tab: string | undefined;
}) {
  const [initialOverview, membersRead, responsibilityState] = await Promise.all([
    getInitialOverview(activeOrgId, userId),
    isAdminOrManager ? getOrgMembersForUser(activeOrgId, userId) : { success: true as const, members: [] },
    loadResponsibilityRuntimeState(activeOrgId),
  ]);
  if (!membersRead.success) {
    return (
      <RegionLoadError title="Die Zeiterfassung konnte nicht geladen werden">
        Die Mitarbeiterliste ist gerade nicht erreichbar. Versuche es in einem Moment erneut.
      </RegionLoadError>
    );
  }
  // The holder lookups below return null both for "not responsible" and for a
  // failed read; the render-cached state tells the two apart, so a failed
  // read never hides the approval tab as if the caller had no approvals.
  if (!responsibilityState) {
    return (
      <RegionLoadError title="Die Zeiterfassung konnte nicht geladen werden">
        Deine Freigabeberechtigungen sind gerade nicht abrufbar. Versuche es in einem Moment erneut.
      </RegionLoadError>
    );
  }
  const [timeApprovalHolder, leaveApprovalHolder] = await Promise.all([
    getEffectiveResponsibilityHolderForActor({
      organizationId: activeOrgId,
      responsibility: 'time_approval',
      actorUserId: userId,
    }),
    getEffectiveResponsibilityHolderForActor({
      organizationId: activeOrgId,
      responsibility: 'leave_approval',
      actorUserId: userId,
    }),
  ]);

  return (
    <ZeiterfassungContent
      organizationId={activeOrgId}
      userId={userId}
      canApproveTime={Boolean(timeApprovalHolder)}
      canApproveLeave={Boolean(leaveApprovalHolder)}
      isAdmin={isAdmin}
      currentUserRole={currentUserRole}
      initialTab={tab === 'approvals' || tab === 'history' ? tab : 'overview'}
      members={membersRead.members}
      initialOverview={initialOverview}
    />
  );
}

interface ZeiterfassungPageProps {
  searchParams: Promise<{ tab?: string }>;
}

export default async function ZeiterfassungPage({ searchParams }: ZeiterfassungPageProps) {
  const [
    { tab },
    {
      data: { user },
    },
    cookieStore,
  ] = await Promise.all([searchParams, getCachedUser(), cookies()]);

  if (!user) {
    redirect('/login');
  }

  const [activeOrgId, memberships] = await Promise.all([
    resolveActiveOrgId(cookieStore, user.id),
    getCachedMemberships(user.id),
  ]);

  if (!activeOrgId) {
    return <p className="text-muted-foreground">Bitte wähle zuerst eine Organisation aus.</p>;
  }

  const currentMembership = memberships.find((m) => m.orgId === activeOrgId);

  if (!currentMembership) {
    redirect('/dashboard');
  }

  const currentUserRole = currentMembership.role as OrgRole;
  const isAdminOrManager = currentUserRole === 'admin' || currentUserRole === 'buero';
  const isAdmin = currentUserRole === 'admin';
  return (
    <>
      {/* Outside the Suspense boundary: the action stays usable while the tabs load. */}
      <PageHeaderActions>
        <ManualEntryButton />
      </PageHeaderActions>
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
    </>
  );
}

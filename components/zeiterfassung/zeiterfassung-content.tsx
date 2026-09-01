'use client';

import dynamic from 'next/dynamic';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Skeleton } from '@/components/ui/skeleton';
import { ZeiterfassungDashboard } from './zeiterfassung-dashboard';
import { TimeCorrectionRequests } from './time-correction-requests';
import { ProvisionalTimeSummary } from './provisional-time-summary';

const VacationApprovals = dynamic(
  () => import('./vacation-approvals').then((mod) => mod.VacationApprovals),
  {
    loading: () => (
      <div className="space-y-3">
        <Skeleton className="h-24 w-full" />
      </div>
    )
  }
);
import { useAttentionCounts } from '@/components/realtime/attention-count-provider';
import type { OrgRole } from '@/lib/members/actions';
import type { ZeiterfassungOverview } from '@/lib/time-tracking/types';

const PendingApprovals = dynamic(
  () => import('./pending-approvals').then((mod) => mod.PendingApprovals),
  {
    loading: () => (
      <div className="space-y-4">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-32 w-full" />
      </div>
    )
  }
);

const EntryHistory = dynamic(
  () => import('./entry-history').then((mod) => mod.EntryHistory),
  {
    loading: () => (
      <div className="space-y-4">
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    )
  }
);

interface MemberInfo {
  user_id: string;
  first_name: string | null;
  last_name: string | null;
  email: string;
  role: string;
}

interface ZeiterfassungContentProps {
  organizationId: string;
  userId: string;
  canApproveTime: boolean;
  canApproveLeave: boolean;
  isAdmin: boolean;
  currentUserRole: OrgRole;
  initialTab?: 'overview' | 'approvals' | 'history';
  /** Members for the history filter (admin/manager only) */
  members?: MemberInfo[];
  initialOverview: ZeiterfassungOverview;
}

export function ZeiterfassungContent({
  organizationId,
  userId,
  canApproveTime,
  canApproveLeave,
  isAdmin,
  currentUserRole,
  initialTab = 'overview',
  members = [],
  initialOverview
}: ZeiterfassungContentProps) {
  // Approvals only: the tab shows time and vacation approvals, so its badge
  // counts exactly those (P1-06's documented undercount is resolved here).
  const { approvalsCount } = useAttentionCounts();

  const hasApprovalSurface = canApproveTime || canApproveLeave;
  const activeInitialTab = initialTab === 'approvals' && !hasApprovalSurface
    ? 'overview'
    : initialTab;

  return (
    <Tabs defaultValue={activeInitialTab} className="w-full">
      <TabsList className="gap-1">
        <TabsTrigger value="overview">Übersicht</TabsTrigger>
        {hasApprovalSurface ? <TabsTrigger value="approvals" className="group">
          Anträge
          {approvalsCount > 0 && (
            <>
              <span
                aria-hidden="true"
                className="ml-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-primary/15 px-1.5 text-[10px] font-semibold text-primary group-data-[state=active]:bg-primary group-data-[state=active]:text-primary-foreground"
              >
                {approvalsCount}
              </span>
              <span className="sr-only">{`${approvalsCount} ausstehende Freigaben`}</span>
            </>
          )}
        </TabsTrigger> : null}
        <TabsTrigger value="history">Verlauf</TabsTrigger>
      </TabsList>

      <TabsContent value="overview" className="mt-4">
        <ProvisionalTimeSummary organizationId={organizationId} userId={userId} />
        <ZeiterfassungDashboard
          organizationId={organizationId}
          userId={userId}
          initialOverview={initialOverview}
        />
      </TabsContent>

      {hasApprovalSurface ? <TabsContent value="approvals" className="mt-4 space-y-6">
        {canApproveLeave ? <VacationApprovals /> : null}
        {canApproveTime ? (
          <TimeCorrectionRequests organizationId={organizationId} mode="approvals" />
        ) : null}
        {canApproveTime ? (
        <PendingApprovals
          organizationId={organizationId}
          isAdmin={isAdmin}
          currentUserRole={currentUserRole}
          currentUserId={userId}
        />
        ) : null}
      </TabsContent> : null}

      <TabsContent value="history" className="mt-4 space-y-8">
          <TimeCorrectionRequests organizationId={organizationId} mode="history" />
          <EntryHistory organizationId={organizationId} members={members} />
      </TabsContent>
    </Tabs>
  );
}

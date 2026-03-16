'use client';

import { useState, useCallback } from 'react';
import dynamic from 'next/dynamic';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Skeleton } from '@/components/ui/skeleton';
import { ZeiterfassungDashboard } from './zeiterfassung-dashboard';
import {
  getPendingApprovalCount
} from '@/lib/time-tracking/actions';
import { useRealtimeEvent } from '@/components/realtime/realtime-provider';
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
  isAdminOrManager: boolean;
  isAdmin: boolean;
  currentUserRole: OrgRole;
  initialTab?: 'overview' | 'approvals' | 'history';
  /** Initial pending count fetched on the server for immediate display */
  initialPendingCount?: number;
  /** Members for the history filter (admin/manager only) */
  members?: MemberInfo[];
  initialOverview: ZeiterfassungOverview;
}

export function ZeiterfassungContent({
  organizationId,
  userId,
  isAdminOrManager,
  isAdmin,
  currentUserRole,
  initialTab = 'overview',
  initialPendingCount = 0,
  members = [],
  initialOverview
}: ZeiterfassungContentProps) {
  const [pendingCount, setPendingCount] = useState(initialPendingCount);

  const handleCountChange = useCallback((count: number) => {
    setPendingCount(count);
  }, []);

  // Fetch pending count directly so the tab badge updates even when
  // PendingApprovals is unmounted (Radix TabsContent unmounts inactive tabs).
  const fetchPendingCount = useCallback(async () => {
    try {
      const count = await getPendingApprovalCount(organizationId, isAdmin);
      setPendingCount(count);
    } catch {
      // keep current count on error
    }
  }, [organizationId, isAdmin]);

  useRealtimeEvent('time_entries', fetchPendingCount);
  useRealtimeEvent('entry_change_requests', fetchPendingCount);

  // For regular employees, just show the dashboard
  if (!isAdminOrManager) {
    return (
      <ZeiterfassungDashboard
        organizationId={organizationId}
        userId={userId}
        initialOverview={initialOverview}
      />
    );
  }

  // For admin/manager, show tabs with dashboard + approvals + history
  return (
    <Tabs defaultValue={initialTab} className="w-full">
      <TabsList className="gap-1">
        <TabsTrigger value="overview">Übersicht</TabsTrigger>
        <TabsTrigger value="approvals" className="group">
          Anträge
          {pendingCount > 0 && (
            <span className="ml-1 flex h-5 w-5 items-center justify-center rounded-full bg-primary/15 text-[10px] font-semibold text-primary group-data-[state=active]:bg-primary group-data-[state=active]:text-primary-foreground">
              {pendingCount}
            </span>
          )}
        </TabsTrigger>
        <TabsTrigger value="history">Verlauf</TabsTrigger>
      </TabsList>

      <TabsContent value="overview" className="mt-4">
        <ZeiterfassungDashboard
          organizationId={organizationId}
          userId={userId}
          initialOverview={initialOverview}
        />
      </TabsContent>

      <TabsContent value="approvals" className="mt-4">
        <PendingApprovals
          organizationId={organizationId}
          isAdmin={isAdmin}
          currentUserRole={currentUserRole}
          currentUserId={userId}
          onCountChange={handleCountChange}
        />
      </TabsContent>

      <TabsContent value="history" className="mt-4">
        <EntryHistory organizationId={organizationId} members={members} />
      </TabsContent>
    </Tabs>
  );
}

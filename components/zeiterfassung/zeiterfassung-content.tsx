'use client';

import { useState, useCallback } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ZeiterfassungDashboard } from './zeiterfassung-dashboard';
import { PendingApprovals } from './pending-approvals';
import { EntryHistory } from './entry-history';
import type { OrgRole } from '@/lib/members/actions';

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
}

export function ZeiterfassungContent({
  organizationId,
  userId,
  isAdminOrManager,
  isAdmin,
  currentUserRole,
  initialTab = 'overview',
  initialPendingCount = 0,
  members = []
}: ZeiterfassungContentProps) {
  // Use the server-fetched initial count for immediate display
  const [pendingCount, setPendingCount] = useState(initialPendingCount);

  // Stable callback to prevent unnecessary re-renders
  const handleCountChange = useCallback((count: number) => {
    setPendingCount(count);
  }, []);

  // For regular employees, just show the dashboard
  if (!isAdminOrManager) {
    return (
      <ZeiterfassungDashboard organizationId={organizationId} userId={userId} />
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

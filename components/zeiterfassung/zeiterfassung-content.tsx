'use client';

import { useState, useEffect, useCallback } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ZeiterfassungDashboard } from './zeiterfassung-dashboard';
import { PendingApprovals } from './pending-approvals';
import { EntryHistory } from './entry-history';
import { getPendingSessions } from '@/lib/time-tracking/actions';

interface ZeiterfassungContentProps {
  organizationId: string;
  userId: string;
  isAdminOrManager: boolean;
}

export function ZeiterfassungContent({
  organizationId,
  userId,
  isAdminOrManager
}: ZeiterfassungContentProps) {
  const [pendingCount, setPendingCount] = useState(0);

  // Fetch initial pending count
  const fetchPendingCount = useCallback(async () => {
    if (!isAdminOrManager) return;
    try {
      const result = await getPendingSessions(organizationId);
      if (result.success) {
        setPendingCount(result.sessions.length);
      }
    } catch (err) {
      console.error('Error fetching pending count:', err);
    }
  }, [organizationId, isAdminOrManager]);

  useEffect(() => {
    fetchPendingCount();
  }, [fetchPendingCount]);

  // For regular employees, just show the dashboard
  if (!isAdminOrManager) {
    return (
      <ZeiterfassungDashboard organizationId={organizationId} userId={userId} />
    );
  }

  // For admin/manager, show tabs with dashboard + approvals + history
  return (
    <Tabs defaultValue="overview" className="w-full">
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
          onCountChange={setPendingCount}
        />
      </TabsContent>

      <TabsContent value="history" className="mt-4">
        <EntryHistory organizationId={organizationId} />
      </TabsContent>
    </Tabs>
  );
}

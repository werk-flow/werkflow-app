'use client';

import { Check } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/empty-state';
import { SectionError } from '@/components/ui/section-error';
import { Skeleton } from '@/components/ui/skeleton';
import type { PendingSession, ChangeRequestWithDetails } from '@/lib/time-tracking/types';
import type { OrgRole } from '@/lib/members/actions';
import { ChangeRequestCard, SessionRequestCard } from './pending-approvals-cards';

// Union type for all request types
export type PendingApprovalItem =
  | { type: 'session'; data: PendingSession }
  | { type: 'edit'; data: ChangeRequestWithDetails }
  | { type: 'delete'; data: ChangeRequestWithDetails };

// Combine and sort all items by creation date
export function combinePendingApprovalItems(
  sessions: PendingSession[],
  changeRequests: ChangeRequestWithDetails[],
): PendingApprovalItem[] {
  const allItems: PendingApprovalItem[] = [
    ...sessions.map((s) => ({ type: 'session' as const, data: s })),
    ...changeRequests.map((r) => ({
      type: r.changeType as 'edit' | 'delete',
      data: r,
    })),
  ].sort((a, b) => {
    const dateA =
      a.type === 'session'
        ? new Date(a.data.clockIn?.createdAt || a.data.clockOut?.createdAt || 0)
        : new Date(a.data.createdAt);
    const dateB =
      b.type === 'session'
        ? new Date(b.data.clockIn?.createdAt || b.data.clockOut?.createdAt || 0)
        : new Date(b.data.createdAt);
    return dateB.getTime() - dateA.getTime();
  });
  return allItems;
}

type PendingApprovalsListProps = {
  isInitialLoading: boolean;
  error: string | null;
  allItems: PendingApprovalItem[];
  onRetry: () => void;
  onRefresh: () => void;
  reviewPendingSession: (session: PendingSession, decision: 'approved' | 'rejected') => Promise<void>;
  reviewPendingChangeRequest: (
    request: ChangeRequestWithDetails,
    decision: 'approve' | 'reject',
  ) => Promise<void>;
  currentUserRole: OrgRole;
  currentUserId: string;
};

// Render content based on state
export function PendingApprovalsList({
  isInitialLoading,
  error,
  allItems,
  onRetry,
  onRefresh,
  reviewPendingSession,
  reviewPendingChangeRequest,
  currentUserRole,
  currentUserId,
}: PendingApprovalsListProps) {
  if (isInitialLoading) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <Card key={i} className="py-0">
            <CardContent className="flex items-center justify-between p-4">
              <div className="space-y-2">
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-3 w-48" />
              </div>
              <div className="flex gap-2">
                <Skeleton className="h-8 w-8" />
                <Skeleton className="h-8 w-8" />
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  // Show error only if we have no items (initial load failed)
  // If we have items, show inline error message below the header
  if (error && allItems.length === 0) {
    return <SectionError onRetry={onRetry}>{error}</SectionError>;
  }

  if (allItems.length === 0) {
    return (
      <EmptyState
        icon={Check}
        title="Keine ausstehenden Anträge"
        description="Alle Anträge wurden bearbeitet."
      />
    );
  }

  // Info banner explaining the new behavior
  const infoBanner = (
    <div className="rounded-lg border border-warning/40 bg-warning-soft px-3 py-2 text-xs text-warning-soft-foreground mb-3">
      <p>
        <strong>Hinweis:</strong> Anträge sind bereits in den Kalendern und Arbeitszeiten der Mitarbeiter
        sichtbar (als „ausstehend“ markiert).
      </p>
      <p className="mt-1">
        <span className="text-success-text">✓ Genehmigen</span> = Eintrag wird bestätigt und bleibt erhalten.
        <span className="ml-3 text-destructive">✗ Ablehnen</span> = Eintrag wird entfernt und rückgängig
        gemacht.
      </p>
    </div>
  );

  return (
    <div className="space-y-3">
      {infoBanner}
      {allItems.map((item) => {
        if (item.type === 'session') {
          return (
            <SessionRequestCard
              key={`session-${item.data.id}`}
              session={item.data}
              onApprove={() => void reviewPendingSession(item.data, 'approved')}
              onReject={() => void reviewPendingSession(item.data, 'rejected')}
              onRefresh={onRefresh}
              currentUserRole={currentUserRole}
              currentUserId={currentUserId}
            />
          );
        }

        return (
          <ChangeRequestCard
            key={`change-${item.data.id}`}
            request={item.data}
            type={item.type}
            onApprove={() => void reviewPendingChangeRequest(item.data, 'approve')}
            onReject={() => void reviewPendingChangeRequest(item.data, 'reject')}
          />
        );
      })}
    </div>
  );
}

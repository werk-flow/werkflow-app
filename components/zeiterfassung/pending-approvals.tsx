'use client';

import { useState, useEffect, useCallback } from 'react';
import dynamic from 'next/dynamic';
import {
  Check,
  X,
  Loader2,
  Clock,
  RefreshCw,
  Plus,
  Pencil,
  Trash2
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import {
  getPendingSessions,
  reviewSession,
  getPendingChangeRequests,
  reviewChangeRequest
} from '@/lib/time-tracking/actions';
import type {
  PendingSession,
  ChangeRequestWithDetails,
  WorkSession
} from '@/lib/time-tracking/types';
import type { OrgRole } from '@/lib/members/actions';
import { useRealtimeEvent } from '@/components/realtime/realtime-provider';

const EntryDetailsDialog = dynamic(
  () =>
    import('@/components/kalender/entry-details-dialog').then(
      (mod) => mod.EntryDetailsDialog
    ),
  { ssr: false }
);

interface PendingApprovalsProps {
  organizationId: string;
  isAdmin: boolean;
  currentUserRole: OrgRole;
  currentUserId: string;
  onCountChange?: (count: number) => void;
}

// Union type for all request types
type RequestItem =
  | { type: 'session'; data: PendingSession }
  | { type: 'edit'; data: ChangeRequestWithDetails }
  | { type: 'delete'; data: ChangeRequestWithDetails };

function formatTime(timestamp: string): string {
  return new Date(timestamp).toLocaleTimeString('de-DE', {
    hour: '2-digit',
    minute: '2-digit'
  });
}

function formatDate(dateStr: string): string {
  return new Date(dateStr + 'T00:00:00').toLocaleDateString('de-DE', {
    weekday: 'long',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric'
  });
}

function formatDateTime(timestamp: string): string {
  return new Date(timestamp).toLocaleString('de-DE', {
    weekday: 'long',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

function formatDuration(clockIn: string, clockOut: string): string {
  const start = new Date(clockIn);
  const end = new Date(clockOut);
  const diffMs = end.getTime() - start.getTime();
  const hours = Math.floor(diffMs / (1000 * 60 * 60));
  const minutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));

  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  return `${minutes}m`;
}

// Badge component for request type
function RequestTypeBadge({ type }: { type: 'session' | 'edit' | 'delete' }) {
  if (type === 'session') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-medium text-amber-700 dark:text-amber-400">
        <Plus className="h-3 w-3" />
        Neuer Eintrag
      </span>
    );
  }

  if (type === 'edit') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-blue-500/15 px-2 py-0.5 text-[10px] font-medium text-blue-700 dark:text-blue-400">
        <Pencil className="h-3 w-3" />
        Änderung
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-red-500/15 px-2 py-0.5 text-[10px] font-medium text-red-700 dark:text-red-400">
      <Trash2 className="h-3 w-3" />
      Löschung
    </span>
  );
}

// Icon component for request type (left side) - same neutral color for all types
function RequestTypeIcon() {
  return <Clock className="h-4 w-4 text-muted-foreground shrink-0" />;
}

export function PendingApprovals({
  organizationId,
  isAdmin,
  currentUserRole,
  currentUserId,
  onCountChange
}: PendingApprovalsProps) {
  // Use separate states for initial load vs refresh to preserve UI during refresh
  const [isInitialLoading, setIsInitialLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [sessions, setSessions] = useState<PendingSession[]>([]);
  const [changeRequests, setChangeRequests] = useState<
    ChangeRequestWithDetails[]
  >([]);
  const [error, setError] = useState<string | null>(null);
  const [processingAction, setProcessingAction] = useState<{
    id: string;
    action: 'approve' | 'reject';
  } | null>(null);

  const fetchPendingItems = useCallback(
    async (isRefresh = false) => {
      if (isRefresh) {
        setIsRefreshing(true);
      }
      setError(null);

      try {
        // Fetch pending sessions (for all admin/manager)
        const sessionsResult = await getPendingSessions(organizationId);
        if (!sessionsResult.success) {
          setError(sessionsResult.error);
          return;
        }

        const newSessions = sessionsResult.sessions;
        setSessions(newSessions);

        // Fetch change requests (admin only)
        let newChangeRequests: ChangeRequestWithDetails[] = [];
        if (isAdmin) {
          const changeRequestsResult = await getPendingChangeRequests(
            organizationId
          );
          if (changeRequestsResult.success) {
            newChangeRequests = changeRequestsResult.requests;
            setChangeRequests(newChangeRequests);
          }
        } else {
          setChangeRequests([]);
        }

        // Update total count using the freshly fetched data
        const totalCount = newSessions.length + newChangeRequests.length;
        onCountChange?.(totalCount);
      } catch (err) {
        console.error('Error fetching pending items:', err);
        setError('Fehler beim Laden');
      } finally {
        setIsInitialLoading(false);
        setIsRefreshing(false);
      }
    },
    [organizationId, isAdmin, onCountChange]
  );

  useEffect(() => {
    fetchPendingItems(false);
  }, [fetchPendingItems]);

  // Realtime: refetch when time entries or change requests change
  useRealtimeEvent('time_entries', () => fetchPendingItems(true));
  useRealtimeEvent('entry_change_requests', () => fetchPendingItems(true));

  // Keep the count in sync when sessions or changeRequests change (after approve/reject)
  useEffect(() => {
    // Only update if we're not in initial loading (to preserve the badge during load)
    if (!isInitialLoading) {
      const totalCount = sessions.length + changeRequests.length;
      onCountChange?.(totalCount);
    }
  }, [sessions.length, changeRequests.length, onCountChange, isInitialLoading]);

  const handleRefresh = () => {
    fetchPendingItems(true);
  };

  const handleApproveSession = async (session: PendingSession) => {
    setProcessingAction({ id: session.id, action: 'approve' });
    try {
      const pairedEntryId =
        session.clockIn && session.clockOut ? session.clockOut.id : undefined;

      const result = await reviewSession(session.id, 'approved', pairedEntryId);
      if (result.success) {
        // Remove from list immediately
        setSessions((prev) => prev.filter((s) => s.id !== session.id));
      } else {
        console.error('Failed to approve session:', result.error);
        setError(`Fehler: ${result.error}`);
      }
    } catch (err) {
      console.error('Error approving session:', err);
      setError('Ein Fehler ist aufgetreten.');
    } finally {
      setProcessingAction(null);
    }
  };

  const handleRejectSession = async (session: PendingSession) => {
    setProcessingAction({ id: session.id, action: 'reject' });
    try {
      const pairedEntryId =
        session.clockIn && session.clockOut ? session.clockOut.id : undefined;

      const result = await reviewSession(session.id, 'rejected', pairedEntryId);
      if (result.success) {
        // Remove from list immediately
        setSessions((prev) => prev.filter((s) => s.id !== session.id));
      } else {
        console.error('Failed to reject session:', result.error);
        setError(`Fehler: ${result.error}`);
      }
    } catch (err) {
      console.error('Error rejecting session:', err);
      setError('Ein Fehler ist aufgetreten.');
    } finally {
      setProcessingAction(null);
    }
  };

  const handleApproveChangeRequest = async (
    request: ChangeRequestWithDetails
  ) => {
    setProcessingAction({ id: request.id, action: 'approve' });
    try {
      const result = await reviewChangeRequest(request.id, 'approve');
      if (result.success) {
        // Remove from list immediately
        setChangeRequests((prev) => prev.filter((r) => r.id !== request.id));
      } else {
        console.error('Failed to approve change request:', result.error);
        setError(`Fehler: ${result.error}`);
      }
    } catch (err) {
      console.error('Error approving change request:', err);
      setError('Ein Fehler ist aufgetreten.');
    } finally {
      setProcessingAction(null);
    }
  };

  const handleRejectChangeRequest = async (
    request: ChangeRequestWithDetails
  ) => {
    setProcessingAction({ id: request.id, action: 'reject' });
    try {
      const result = await reviewChangeRequest(request.id, 'reject');
      if (result.success) {
        // Remove from list immediately
        setChangeRequests((prev) => prev.filter((r) => r.id !== request.id));
      } else {
        console.error('Failed to reject change request:', result.error);
        setError(`Fehler: ${result.error}`);
      }
    } catch (err) {
      console.error('Error rejecting change request:', err);
      setError('Ein Fehler ist aufgetreten.');
    } finally {
      setProcessingAction(null);
    }
  };

  // Combine and sort all items by creation date
  const allItems: RequestItem[] = [
    ...sessions.map((s) => ({ type: 'session' as const, data: s })),
    ...changeRequests.map((r) => ({
      type: r.changeType as 'edit' | 'delete',
      data: r
    }))
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

  // Render content based on state
  const renderContent = () => {
    if (isInitialLoading) {
      return (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Card key={i}>
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
      return (
        <div className="flex flex-col items-center justify-center py-8 text-center">
          <p className="text-sm text-destructive">{error}</p>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setError(null);
              fetchPendingItems(false);
            }}
            className="mt-4"
          >
            <RefreshCw className="mr-2 h-4 w-4" />
            Erneut versuchen
          </Button>
        </div>
      );
    }

    if (allItems.length === 0) {
      return (
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-muted">
            <Check className="h-6 w-6 text-muted-foreground" />
          </div>
          <h3 className="text-lg font-semibold">Keine ausstehenden Anträge</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            Alle Anträge wurden bearbeitet.
          </p>
        </div>
      );
    }

    // Info banner explaining the new behavior
    const infoBanner = (
      <div className="rounded-lg border border-amber-200 bg-amber-50 dark:border-amber-900/50 dark:bg-amber-950/30 px-3 py-2 text-xs text-amber-800 dark:text-amber-200 mb-3">
        <p>
          <strong>Hinweis:</strong> Anträge sind bereits in den Kalendern und
          Arbeitszeiten der Mitarbeiter sichtbar (als &quot;ausstehend&quot;
          markiert).
        </p>
        <p className="mt-1">
          <span className="text-green-700 dark:text-green-400">
            ✓ Genehmigen
          </span>{' '}
          = Eintrag wird bestätigt und bleibt erhalten.
          <span className="ml-3 text-red-700 dark:text-red-400">
            ✗ Ablehnen
          </span>{' '}
          = Eintrag wird entfernt und rückgängig gemacht.
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
                isProcessing={processingAction?.id === item.data.id}
                processingAction={
                  processingAction?.id === item.data.id
                    ? processingAction.action
                    : null
                }
                onApprove={() => handleApproveSession(item.data)}
                onReject={() => handleRejectSession(item.data)}
                onRefresh={() => fetchPendingItems(true)}
                currentUserRole={currentUserRole}
                currentUserId={currentUserId}
                disabled={processingAction !== null}
              />
            );
          }

          return (
            <ChangeRequestCard
              key={`change-${item.data.id}`}
              request={item.data}
              type={item.type}
              isProcessing={processingAction?.id === item.data.id}
              processingAction={
                processingAction?.id === item.data.id
                  ? processingAction.action
                  : null
              }
              onApprove={() => handleApproveChangeRequest(item.data)}
              onReject={() => handleRejectChangeRequest(item.data)}
              disabled={processingAction !== null}
            />
          );
        })}
      </div>
    );
  };

  return (
    <div className="space-y-3">
      {/* Header with refresh button - always visible */}
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {isInitialLoading ? (
            <Skeleton className="h-4 w-32 inline-block" />
          ) : allItems.length > 0 ? (
            `${allItems.length} ${
              allItems.length === 1 ? 'Antrag' : 'Anträge'
            } zur Genehmigung`
          ) : (
            'Keine ausstehenden Anträge'
          )}
        </p>
        <Button
          variant="ghost"
          size="sm"
          onClick={handleRefresh}
          disabled={
            isRefreshing || isInitialLoading || processingAction !== null
          }
        >
          <RefreshCw
            className={`mr-2 h-4 w-4 ${isRefreshing ? 'animate-spin' : ''}`}
          />
          Aktualisieren
        </Button>
      </div>

      {/* Inline error message for operation failures (when items exist) */}
      {error && allItems.length > 0 && (
        <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive flex items-center justify-between">
          <span>{error}</span>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setError(null)}
            className="h-auto p-1 text-destructive hover:text-destructive"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      )}

      {renderContent()}
    </div>
  );
}

// Helper to convert PendingSession to WorkSession for the dialog
function pendingSessionToWorkSession(session: PendingSession): WorkSession {
  let durationMinutes: number | null = null;
  if (session.clockIn && session.clockOut) {
    const start = new Date(session.clockIn.timestamp);
    const end = new Date(session.clockOut.timestamp);
    durationMinutes = Math.round((end.getTime() - start.getTime()) / 60000);
  }

  return {
    clockIn: session.clockIn,
    clockOut: session.clockOut,
    durationMinutes,
    isOrphan: false,
    pendingState:
      session.clockIn?.status === 'pending' ||
      session.clockOut?.status === 'pending'
        ? 'full'
        : 'none'
  };
}

// Card for session requests (new entry)
function SessionRequestCard({
  session,
  isProcessing,
  processingAction,
  onApprove,
  onReject,
  onRefresh,
  currentUserRole,
  currentUserId,
  disabled
}: {
  session: PendingSession;
  isProcessing: boolean;
  processingAction: 'approve' | 'reject' | null;
  onApprove: () => void;
  onReject: () => void;
  onRefresh: () => void;
  currentUserRole: OrgRole;
  currentUserId: string;
  disabled: boolean;
}) {
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);

  const isApproving = isProcessing && processingAction === 'approve';
  const isRejecting = isProcessing && processingAction === 'reject';
  const isPair = session.clockIn && session.clockOut;

  const displayName =
    session.firstName || session.lastName
      ? `${session.firstName || ''} ${session.lastName || ''}`.trim()
      : 'Unbekannt';

  // Convert to WorkSession for the dialog
  const workSession = pendingSessionToWorkSession(session);

  const handleDialogRefresh = () => {
    setIsEditDialogOpen(false);
    onRefresh();
  };

  return (
    <>
      <Card>
        <CardContent className="flex items-center justify-between p-4">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <RequestTypeIcon />
              <span className="font-medium">{displayName}</span>
              <RequestTypeBadge type="session" />
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              {formatDate(session.date)}
            </p>
            {isPair ? (
              <p className="text-xs text-muted-foreground">
                {formatTime(session.clockIn!.timestamp)} –{' '}
                {formatTime(session.clockOut!.timestamp)}
                <span className="ml-2 text-foreground/70">
                  (
                  {formatDuration(
                    session.clockIn!.timestamp,
                    session.clockOut!.timestamp
                  )}
                  )
                </span>
              </p>
            ) : (
              <p className="text-xs text-muted-foreground">
                {session.clockIn
                  ? `Einstempeln: ${formatTime(session.clockIn.timestamp)}`
                  : `Ausstempeln: ${formatTime(session.clockOut!.timestamp)}`}
              </p>
            )}
          </div>

          <div className="flex gap-2 shrink-0 ml-4">
            <Button
              variant="outline"
              size="icon"
              onClick={() => setIsEditDialogOpen(true)}
              disabled={disabled}
              title="Bearbeiten"
              className="h-8 w-8 text-muted-foreground hover:text-foreground"
            >
              <Pencil className="h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              size="icon"
              onClick={onApprove}
              disabled={disabled}
              title="Genehmigen - Eintrag bleibt erhalten"
              className="h-8 w-8 text-green-600 hover:text-green-700 hover:bg-green-50"
            >
              {isApproving ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Check className="h-4 w-4" />
              )}
            </Button>
            <Button
              variant="outline"
              size="icon"
              onClick={onReject}
              disabled={disabled}
              title="Ablehnen - Eintrag wird entfernt"
              className="h-8 w-8 text-destructive hover:text-destructive hover:bg-destructive/10"
            >
              {isRejecting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <X className="h-4 w-4" />
              )}
            </Button>
          </div>
        </CardContent>
      </Card>

      {isEditDialogOpen && (
        <EntryDetailsDialog
          open={isEditDialogOpen}
          onOpenChange={setIsEditDialogOpen}
          session={workSession}
          currentUserRole={currentUserRole}
          currentUserId={currentUserId}
          onRefresh={handleDialogRefresh}
          startInEditMode={true}
        />
      )}
    </>
  );
}

// Card for change requests (edit/delete)
function ChangeRequestCard({
  request,
  type,
  isProcessing,
  processingAction,
  onApprove,
  onReject,
  disabled
}: {
  request: ChangeRequestWithDetails;
  type: 'edit' | 'delete';
  isProcessing: boolean;
  processingAction: 'approve' | 'reject' | null;
  onApprove: () => void;
  onReject: () => void;
  disabled: boolean;
}) {
  const isApproving = isProcessing && processingAction === 'approve';
  const isRejecting = isProcessing && processingAction === 'reject';

  const displayName =
    request.requesterFirstName || request.requesterLastName
      ? `${request.requesterFirstName || ''} ${
          request.requesterLastName || ''
        }`.trim()
      : 'Unbekannt';

  const entryTypeLabel =
    request.entry.entryType === 'clock_in' ? 'Einstempeln' : 'Ausstempeln';

  // Check if this is a paired delete request (has both clock_in and clock_out)
  const isPairedDelete = type === 'delete' && request.pairedEntry !== null;

  // For paired deletes, determine which is clock_in and which is clock_out
  const clockInEntry =
    request.entry.entryType === 'clock_in'
      ? request.entry
      : request.pairedEntry;
  const clockOutEntry =
    request.entry.entryType === 'clock_out'
      ? request.entry
      : request.pairedEntry;

  // Extract date from clock_in timestamp for paired deletes
  const dateStr =
    isPairedDelete && clockInEntry
      ? new Date(clockInEntry.timestamp).toISOString().split('T')[0]
      : '';

  return (
    <Card>
      <CardContent className="flex items-center justify-between p-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <RequestTypeIcon />
            <span className="font-medium">{displayName}</span>
            <RequestTypeBadge type={type} />
          </div>

          {type === 'edit' ? (
            <>
              <p className="mt-1 text-sm text-muted-foreground">
                {entryTypeLabel} ändern
              </p>
              <div className="text-xs text-muted-foreground space-y-0.5 mt-1">
                <p>
                  <span className="text-foreground/70">Aktuell:</span>{' '}
                  {formatDateTime(request.entry.timestamp)}
                </p>
                {request.proposedTimestamp && (
                  <p>
                    <span className="text-blue-600 dark:text-blue-400">
                      Neu:
                    </span>{' '}
                    {formatDateTime(request.proposedTimestamp)}
                  </p>
                )}
              </div>
            </>
          ) : isPairedDelete && clockInEntry && clockOutEntry ? (
            // Paired delete request - show like session requests
            <>
              <p className="mt-1 text-sm text-muted-foreground">
                {formatDate(dateStr)}
              </p>
              <p className="text-xs text-muted-foreground">
                {formatTime(clockInEntry.timestamp)} –{' '}
                {formatTime(clockOutEntry.timestamp)}
                <span className="ml-2 text-foreground/70">
                  (
                  {formatDuration(
                    clockInEntry.timestamp,
                    clockOutEntry.timestamp
                  )}
                  )
                </span>
              </p>
            </>
          ) : (
            // Single entry delete request
            <>
              <p className="mt-1 text-sm text-muted-foreground">
                {entryTypeLabel} löschen
              </p>
              <p className="text-xs text-muted-foreground">
                {formatDateTime(request.entry.timestamp)}
              </p>
            </>
          )}
        </div>

        <div className="flex gap-2 shrink-0 ml-4">
          <Button
            variant="outline"
            size="icon"
            onClick={onApprove}
            disabled={disabled}
            title={
              type === 'edit'
                ? 'Genehmigen - Änderung wird bestätigt'
                : type === 'delete'
                ? 'Genehmigen - Löschung wird bestätigt'
                : 'Genehmigen'
            }
            className="h-8 w-8 text-green-600 hover:text-green-700 hover:bg-green-50"
          >
            {isApproving ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Check className="h-4 w-4" />
            )}
          </Button>
          <Button
            variant="outline"
            size="icon"
            onClick={onReject}
            disabled={disabled}
            title={
              type === 'edit'
                ? 'Ablehnen - Änderung wird rückgängig gemacht'
                : type === 'delete'
                ? 'Ablehnen - Eintrag bleibt erhalten'
                : 'Ablehnen'
            }
            className="h-8 w-8 text-destructive hover:text-destructive hover:bg-destructive/10"
          >
            {isRejecting ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <X className="h-4 w-4" />
            )}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

'use client';

import { useState, useEffect, useCallback } from 'react';
import { Check, X, Loader2, Clock, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { getPendingSessions, reviewSession } from '@/lib/time-tracking/actions';
import type { PendingSession } from '@/lib/time-tracking/types';
import { dispatchClockStatusRefresh } from '@/components/clock-fab';

interface PendingApprovalsProps {
  organizationId: string;
  onCountChange?: (count: number) => void;
}

function formatTime(timestamp: string): string {
  return new Date(timestamp).toLocaleTimeString('de-DE', {
    hour: '2-digit',
    minute: '2-digit'
  });
}

function formatDate(dateStr: string): string {
  return new Date(dateStr + 'T00:00:00').toLocaleDateString('de-DE', {
    weekday: 'short',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric'
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

export function PendingApprovals({
  organizationId,
  onCountChange
}: PendingApprovalsProps) {
  const [isLoading, setIsLoading] = useState(true);
  const [sessions, setSessions] = useState<PendingSession[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [processingAction, setProcessingAction] = useState<{
    sessionId: string;
    action: 'approve' | 'reject';
  } | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const fetchPendingSessions = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const result = await getPendingSessions(organizationId);
      if (result.success) {
        setSessions(result.sessions);
        onCountChange?.(result.sessions.length);
      } else {
        setError(result.error);
      }
    } catch (err) {
      console.error('Error fetching pending sessions:', err);
      setError('Fehler beim Laden');
    } finally {
      setIsLoading(false);
    }
  }, [organizationId, onCountChange]);

  useEffect(() => {
    fetchPendingSessions();
  }, [fetchPendingSessions]);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    await fetchPendingSessions();
    setIsRefreshing(false);
  };

  const handleApprove = async (session: PendingSession) => {
    setProcessingAction({ sessionId: session.id, action: 'approve' });
    try {
      const pairedEntryId =
        session.clockIn && session.clockOut ? session.clockOut.id : undefined;

      const result = await reviewSession(session.id, 'approved', pairedEntryId);
      if (result.success) {
        setSessions((prev) => prev.filter((s) => s.id !== session.id));
        onCountChange?.(sessions.length - 1);
        // Refresh FAB clock status in case this approval affects "currently working" state
        dispatchClockStatusRefresh();
      }
    } catch (err) {
      console.error('Error approving session:', err);
    } finally {
      setProcessingAction(null);
    }
  };

  const handleReject = async (session: PendingSession) => {
    setProcessingAction({ sessionId: session.id, action: 'reject' });
    try {
      const pairedEntryId =
        session.clockIn && session.clockOut ? session.clockOut.id : undefined;

      const result = await reviewSession(session.id, 'rejected', pairedEntryId);
      if (result.success) {
        setSessions((prev) => prev.filter((s) => s.id !== session.id));
        onCountChange?.(sessions.length - 1);
      }
    } catch (err) {
      console.error('Error rejecting session:', err);
    } finally {
      setProcessingAction(null);
    }
  };

  if (isLoading) {
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

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center py-8 text-center">
        <p className="text-sm text-destructive">{error}</p>
        <Button
          variant="outline"
          size="sm"
          onClick={fetchPendingSessions}
          className="mt-4"
        >
          <RefreshCw className="mr-2 h-4 w-4" />
          Erneut versuchen
        </Button>
      </div>
    );
  }

  if (sessions.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-center">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-muted">
          <Check className="h-6 w-6 text-muted-foreground" />
        </div>
        <h3 className="text-lg font-semibold">Keine ausstehenden Einträge</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          Alle Zeiteinträge wurden genehmigt.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {sessions.length} {sessions.length === 1 ? 'Antrag' : 'Anträge'} zur
          Genehmigung
        </p>
        <Button
          variant="ghost"
          size="sm"
          onClick={handleRefresh}
          disabled={isRefreshing || processingAction !== null}
        >
          <RefreshCw
            className={`mr-2 h-4 w-4 ${isRefreshing ? 'animate-spin' : ''}`}
          />
          Aktualisieren
        </Button>
      </div>

      {sessions.map((session) => {
        const isProcessing = processingAction?.sessionId === session.id;
        const isApproving =
          isProcessing && processingAction?.action === 'approve';
        const isRejecting =
          isProcessing && processingAction?.action === 'reject';
        const isPair = session.clockIn && session.clockOut;

        const displayName =
          session.firstName || session.lastName
            ? `${session.firstName || ''} ${session.lastName || ''}`.trim()
            : 'Unbekannt';

        return (
          <Card key={session.id}>
            <CardContent className="flex items-center justify-between p-4">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <Clock className="h-4 w-4 text-muted-foreground shrink-0" />
                  <span className="font-medium">{displayName}</span>
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
                      : `Ausstempeln: ${formatTime(
                          session.clockOut!.timestamp
                        )}`}
                  </p>
                )}
              </div>

              <div className="flex gap-2 shrink-0 ml-4">
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() => handleApprove(session)}
                  disabled={processingAction !== null}
                  title="Genehmigen"
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
                  onClick={() => handleReject(session)}
                  disabled={processingAction !== null}
                  title="Ablehnen"
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
      })}
    </div>
  );
}

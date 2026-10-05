'use client';

import { useState } from 'react';
import dynamic from 'next/dynamic';
import { Check, X, Clock, Plus, Pencil, Trash2, Briefcase } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import type { PendingSession, ChangeRequestWithDetails, WorkSession } from '@/lib/time-tracking/types';
import type { OrgRole } from '@/lib/members/actions';
import { toLocalDateString } from '@/lib/utils';

const EntryDetailsDialog = dynamic(
  () => import('@/components/kalender/entry-details-dialog').then((mod) => mod.EntryDetailsDialog),
  { ssr: false },
);

function formatTime(timestamp: string): string {
  return new Date(timestamp).toLocaleTimeString('de-DE', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatWeekdayDate(dateStr: string): string {
  return new Date(dateStr + 'T00:00:00').toLocaleDateString('de-DE', {
    weekday: 'long',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

function formatWeekdayDateTime(timestamp: string): string {
  return new Date(timestamp).toLocaleString('de-DE', {
    weekday: 'long',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
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
      <span className="inline-flex items-center gap-1 rounded-full bg-warning-soft px-2 py-0.5 text-[10px] font-medium text-warning-soft-foreground">
        <Plus className="h-3 w-3" />
        Neuer Eintrag
      </span>
    );
  }

  if (type === 'edit') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-info-soft px-2 py-0.5 text-[10px] font-medium text-info-soft-foreground">
        <Pencil className="h-3 w-3" />
        Änderung
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-destructive-soft px-2 py-0.5 text-[10px] font-medium text-destructive-soft-foreground">
      <Trash2 className="h-3 w-3" />
      Löschung
    </span>
  );
}

// Icon component for request type (left side) - same neutral color for all types
function RequestTypeIcon() {
  return <Clock className="h-4 w-4 text-muted-foreground shrink-0" />;
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
    jobId: session.clockIn?.jobId ?? session.clockOut?.jobId ?? null,
    isOrphan: !session.clockIn || !session.clockOut,
    pendingState:
      session.clockIn?.status === 'pending' || session.clockOut?.status === 'pending' ? 'full' : 'none',
  };
}

// Card for session requests (new entry)
export function SessionRequestCard({
  session,
  onApprove,
  onReject,
  onRefresh,
  currentUserRole,
  currentUserId,
}: {
  session: PendingSession;
  onApprove: () => void;
  onReject: () => void;
  onRefresh: () => void;
  currentUserRole: OrgRole;
  currentUserId: string;
}) {
  const [isEditDialogOpen, setIsEditDialogOpen] = useState(false);

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
      <Card className="py-0" data-testid={`pending-session-${session.id}`} data-user-id={session.userId}>
        <CardContent className="flex items-center justify-between p-4">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 flex-wrap">
              <RequestTypeIcon />
              <span className="font-medium">{displayName}</span>
              <RequestTypeBadge type="session" />
            </div>
            <p className="mt-1 text-sm text-muted-foreground">{formatWeekdayDate(session.date)}</p>
            {session.clockIn && session.clockOut ? (
              <p className="text-xs text-muted-foreground">
                {formatTime(session.clockIn.timestamp)} – {formatTime(session.clockOut.timestamp)}
                <span className="ml-2 text-foreground/70">
                  ({formatDuration(session.clockIn.timestamp, session.clockOut.timestamp)})
                </span>
              </p>
            ) : (
              <p className="text-xs text-muted-foreground">
                {session.clockIn
                  ? `Einstempeln: ${formatTime(session.clockIn.timestamp)}`
                  : session.clockOut && `Ausstempeln: ${formatTime(session.clockOut.timestamp)}`}
              </p>
            )}
            {session.jobTitle && (
              <p className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
                <Briefcase className="h-3 w-3 shrink-0" />
                <span className="truncate" title={session.jobTitle}>
                  {session.jobTitle}
                </span>
              </p>
            )}
          </div>

          <div className="flex gap-2 shrink-0 ml-4">
            <Button
              variant="outline"
              size="icon"
              onClick={() => setIsEditDialogOpen(true)}
              title="Bearbeiten"
              aria-label="Bearbeiten"
              className="h-8 w-8 text-muted-foreground hover:text-foreground"
            >
              <Pencil className="h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              size="icon"
              onClick={onApprove}
              title="Genehmigen - Eintrag bleibt erhalten"
              aria-label="Genehmigen"
              className="h-8 w-8 text-success-text hover:bg-success-soft"
            >
              <Check className="h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              size="icon"
              onClick={onReject}
              title="Ablehnen - Eintrag wird entfernt"
              aria-label="Ablehnen"
              className="h-8 w-8 text-destructive hover:text-destructive hover:bg-destructive/10"
            >
              <X className="h-4 w-4" />
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
export function ChangeRequestCard({
  request,
  type,
  onApprove,
  onReject,
}: {
  request: ChangeRequestWithDetails;
  type: 'edit' | 'delete';
  onApprove: () => void;
  onReject: () => void;
}) {
  const displayName =
    request.requesterFirstName || request.requesterLastName
      ? `${request.requesterFirstName || ''} ${request.requesterLastName || ''}`.trim()
      : 'Unbekannt';

  const entryTypeLabel = request.entry.entryType === 'clock_in' ? 'Einstempeln' : 'Ausstempeln';

  // Check if this is a paired delete request (has both clock_in and clock_out)
  const isPairedDelete = type === 'delete' && request.pairedEntry !== null;

  // For paired deletes, determine which is clock_in and which is clock_out
  const clockInEntry = request.entry.entryType === 'clock_in' ? request.entry : request.pairedEntry;
  const clockOutEntry = request.entry.entryType === 'clock_out' ? request.entry : request.pairedEntry;

  // Extract date from clock_in timestamp for paired deletes
  const dateStr = isPairedDelete && clockInEntry ? toLocalDateString(new Date(clockInEntry.timestamp)) : '';

  return (
    <Card className="py-0">
      <CardContent className="flex items-center justify-between p-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <RequestTypeIcon />
            <span className="font-medium">{displayName}</span>
            <RequestTypeBadge type={type} />
          </div>

          {type === 'edit' ? (
            <>
              <p className="mt-1 text-sm text-muted-foreground">{entryTypeLabel} ändern</p>
              <div className="text-xs text-muted-foreground space-y-0.5 mt-1">
                <p>
                  <span className="text-foreground/70">Aktuell:</span>{' '}
                  {formatWeekdayDateTime(request.entry.timestamp)}
                </p>
                {request.proposedTimestamp && (
                  <p>
                    <span className="text-info-text">Neu:</span>{' '}
                    {formatWeekdayDateTime(request.proposedTimestamp)}
                  </p>
                )}
              </div>
            </>
          ) : isPairedDelete && clockInEntry && clockOutEntry ? (
            // Paired delete request - show like session requests
            <>
              <p className="mt-1 text-sm text-muted-foreground">{formatWeekdayDate(dateStr)}</p>
              <p className="text-xs text-muted-foreground">
                {formatTime(clockInEntry.timestamp)} – {formatTime(clockOutEntry.timestamp)}
                <span className="ml-2 text-foreground/70">
                  ({formatDuration(clockInEntry.timestamp, clockOutEntry.timestamp)})
                </span>
              </p>
            </>
          ) : (
            // Single entry delete request
            <>
              <p className="mt-1 text-sm text-muted-foreground">{entryTypeLabel} löschen</p>
              <p className="text-xs text-muted-foreground">
                {formatWeekdayDateTime(request.entry.timestamp)}
              </p>
            </>
          )}
        </div>

        <div className="flex gap-2 shrink-0 ml-4">
          <Button
            variant="outline"
            size="icon"
            onClick={onApprove}
            aria-label="Genehmigen"
            title={
              type === 'edit'
                ? 'Genehmigen - Änderung wird bestätigt'
                : type === 'delete'
                  ? 'Genehmigen - Löschung wird bestätigt'
                  : 'Genehmigen'
            }
            className="h-8 w-8 text-success-text hover:bg-success-soft"
          >
            <Check className="h-4 w-4" />
          </Button>
          <Button
            variant="outline"
            size="icon"
            onClick={onReject}
            aria-label="Ablehnen"
            title={
              type === 'edit'
                ? 'Ablehnen - Änderung wird rückgängig gemacht'
                : type === 'delete'
                  ? 'Ablehnen - Eintrag bleibt erhalten'
                  : 'Ablehnen'
            }
            className="h-8 w-8 text-destructive hover:text-destructive hover:bg-destructive/10"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

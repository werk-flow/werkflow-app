'use client';

import { useState } from 'react';
import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ErrorText } from '@/components/ui/error-text';
import { reviewEntries, reviewChangeRequest } from '@/lib/time-tracking/actions';
import { readInBackground } from '@/lib/data/background-read-client';
import type { PendingSession, ChangeRequestWithDetails } from '@/lib/time-tracking/types';
import type { OrgRole } from '@/lib/members/actions';
import { useBanner } from '@/components/ui/banner';
import type { ActionResult } from '@/lib/action-result';
import { describeBatchRefusal, describeFailure } from '@/lib/action-messages';
import { useOptimisticList } from '@/hooks/use-optimistic-list';
import { useLiveView, type LiveViewResult } from '@/hooks/use-live-view';
import { PendingApprovalsHeader } from './pending-approvals-header';
import { combinePendingApprovalItems, PendingApprovalsList } from './pending-approvals-list';

interface PendingApprovalsProps {
  organizationId: string;
  isAdmin: boolean;
  currentUserRole: OrgRole;
  currentUserId: string;
}

type PendingApprovalData = {
  sessions: PendingSession[];
  changeRequests: ChangeRequestWithDetails[];
};

// The area's own sentences; describeFailure adds the shared ones
// (invalid_input, period_closed, ...) from lib/action-messages.ts.
const APPROVAL_ERROR_MESSAGES: Readonly<Partial<Record<string, string>>> = {
  self_approval_not_allowed: 'Eigene Arbeitszeiten können nicht selbst freigegeben werden.',
  not_responsible: 'Du bist für diese Freigabe nicht mehr verantwortlich. Die Ansicht wurde aktualisiert.',
  fetch_failed: 'Die ausstehenden Anträge konnten nicht geladen werden.',
  not_authenticated: 'Bitte melde dich erneut an.',
  not_a_member: 'Du gehörst dieser Organisation nicht mehr an.',
  not_authorized: 'Du darfst diesen Antrag nicht bearbeiten.',
  request_not_found: 'Der Antrag wurde nicht gefunden.',
  request_already_reviewed: 'Der Antrag wurde bereits bearbeitet.',
  entry_not_pending: 'Ein Eintrag wurde bereits bearbeitet. Die Ansicht wurde aktualisiert.',
  unexpected_error: 'Die Freigabe konnte nicht gespeichert werden.',
};

const EMPTY_SESSIONS: PendingSession[] = [];
const EMPTY_CHANGE_REQUESTS: ChangeRequestWithDetails[] = [];
const getPendingItemId = (item: { id: string }) => item.id;

function getApprovalErrorMessage(error: string): string {
  return describeFailure(error, APPROVAL_ERROR_MESSAGES, 'Die Freigabe konnte nicht gespeichert werden.');
}

// The server reviews every entry of a selection or none of them.
function getEntryReviewErrorMessage(error: string): string {
  return describeBatchRefusal(error, getApprovalErrorMessage(error));
}

// A failed read says that the list could not load, never that a decision was not saved.
const READ_FAILURE = 'Die ausstehenden Anträge konnten nicht geladen werden.';
function getApprovalReadErrorMessage(error: string): string {
  return describeFailure(error, APPROVAL_ERROR_MESSAGES, READ_FAILURE);
}

async function readPendingApprovalData(
  organizationId: string,
  isAdmin: boolean,
  signal: AbortSignal,
): Promise<LiveViewResult<PendingApprovalData>> {
  try {
    // Fetch pending sessions (for all admin/manager)
    const sessionsResult = await readInBackground('pending-sessions', { organizationId }, signal);
    if (!sessionsResult.success) {
      return {
        ok: false,
        error: getApprovalReadErrorMessage(sessionsResult.error),
      };
    }

    // Fetch change requests (admin only)
    let changeRequests: ChangeRequestWithDetails[] = [];
    if (isAdmin) {
      const changeRequestsResult = await readInBackground(
        'pending-change-requests',
        { organizationId },
        signal,
      );
      if (!changeRequestsResult.success) {
        return {
          ok: false,
          error: getApprovalReadErrorMessage(changeRequestsResult.error),
        };
      }
      changeRequests = changeRequestsResult.requests;
    }

    return {
      ok: true,
      data: { sessions: sessionsResult.sessions, changeRequests },
    };
  } catch {
    // A transport failure; the server logs its own failures.
    return { ok: false, error: READ_FAILURE };
  }
}

export function PendingApprovals({
  organizationId,
  isAdmin,
  currentUserRole,
  currentUserId,
}: PendingApprovalsProps) {
  // Errors from approve/reject actions; read errors come from view.error.
  const [actionError, setActionError] = useState<string | null>(null);
  const { showBanner } = useBanner();

  const view = useLiveView<PendingApprovalData>({
    tables: ['time_entries', 'entry_change_requests'],
    read: ({ signal }) => readPendingApprovalData(organizationId, isAdmin, signal),
    resetKey: `${organizationId}:${isAdmin ? 'admin' : 'manager'}`,
  });

  // A reviewed card leaves the list in the first frame. The overlay expires
  // when the authoritative read no longer carries the item and rolls back when
  // the server refuses, so the card returns together with the reason.
  const sessionList = useOptimisticList({
    items: view.data?.sessions ?? EMPTY_SESSIONS,
    getId: getPendingItemId,
  });
  const changeRequestList = useOptimisticList({
    items: view.data?.changeRequests ?? EMPTY_CHANGE_REQUESTS,
    getId: getPendingItemId,
  });
  const sessions = sessionList.items.map((row) => row.item);
  const changeRequests = changeRequestList.items.map((row) => row.item);
  const isInitialLoading = view.isLoading;
  const error = actionError ?? view.error;

  // Confirmation appears only after the server accepted the review.
  const review = async (
    list: { remove: (id: string) => void; rollback: (id: string) => void },
    ids: string[],
    write: () => Promise<ActionResult>,
    confirmation: string,
    describeRefusal: (error: string) => string,
  ) => {
    setActionError(null);
    view.invalidate();
    for (const id of ids) list.remove(id);
    const result = await write().catch(() => ({ success: false as const, error: 'unexpected_error' }));
    if (result.success) {
      showBanner({ variant: 'success', message: confirmation });
    } else {
      for (const id of ids) list.rollback(id);
      setActionError(describeRefusal(result.error));
    }
    // Read again: another session may have decided items meanwhile.
    await view.refresh();
  };

  const reviewPendingSession = (session: PendingSession, decision: 'approved' | 'rejected') =>
    review(
      sessionList,
      [session.id],
      () => reviewEntries(session.entryIds, decision),
      decision === 'approved' ? 'Der Zeiteintrag wurde genehmigt.' : 'Der Zeiteintrag wurde abgelehnt.',
      getEntryReviewErrorMessage,
    );

  // One round trip for the whole backlog; the server re-checks every entry.
  const approveAllSessions = () =>
    review(
      sessionList,
      sessions.map((session) => session.id),
      () =>
        reviewEntries(
          sessions.flatMap((session) => session.entryIds),
          'approved',
        ),
      `${sessions.length} Zeiteinträge wurden genehmigt.`,
      getEntryReviewErrorMessage,
    );

  const reviewPendingChangeRequest = (request: ChangeRequestWithDetails, decision: 'approve' | 'reject') =>
    review(
      changeRequestList,
      [request.id],
      () => reviewChangeRequest(request.id, decision),
      decision === 'approve'
        ? 'Der Änderungsantrag wurde genehmigt.'
        : 'Der Änderungsantrag wurde abgelehnt.',
      getApprovalErrorMessage,
    );

  const allItems = combinePendingApprovalItems(sessions, changeRequests);

  return (
    <div
      className="space-y-3"
      data-testid="pending-approvals-panel"
      data-loaded={isInitialLoading ? 'false' : 'true'}
    >
      <PendingApprovalsHeader
        isInitialLoading={isInitialLoading}
        loadFailed={Boolean(error) && allItems.length === 0}
        itemCount={allItems.length}
        sessionCount={sessions.length}
        approveAllSessions={approveAllSessions}
        onRefresh={view.refresh}
      />

      {/* Inline error message for operation failures (when items exist) */}
      {error && allItems.length > 0 && (
        <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive flex items-center justify-between">
          <ErrorText>{error}</ErrorText>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setActionError(null)}
            aria-label="Fehlermeldung ausblenden"
            className="h-auto p-1 text-destructive hover:text-destructive"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      )}

      <PendingApprovalsList
        isInitialLoading={isInitialLoading}
        error={error}
        allItems={allItems}
        onRetry={() => {
          setActionError(null);
          void view.refresh();
        }}
        onRefresh={() => void view.refresh()}
        reviewPendingSession={reviewPendingSession}
        reviewPendingChangeRequest={reviewPendingChangeRequest}
        currentUserRole={currentUserRole}
        currentUserId={currentUserId}
      />
    </div>
  );
}

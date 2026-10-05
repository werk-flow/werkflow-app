// Isolated server state of the time approval cards and the entry details
// dialog: the reads return the current lists, and every decision waits in the
// write gate until the spec answers it. An accepted decision leaves the list,
// so the follow-up read agrees with the server.
import type {
  ChangeRequest,
  ChangeRequestWithDetails,
  PendingSession,
  TimeEntry,
} from '@/lib/time-tracking/types';
import type { TimeCorrectionRequest, TimeCorrectionResult } from '@/lib/time-corrections/types';
import { holdWrite } from './held-write-boundary';

const organizationId = 'contract-organization';
const createdAt = '2026-10-01T16:00:00.000Z';

function contractEntry(
  id: string,
  entryType: TimeEntry['entryType'],
  timestamp: string,
  status: TimeEntry['status'],
): TimeEntry {
  return {
    id,
    userId: 'contract-worker',
    organizationId,
    entryType,
    timestamp,
    isManual: true,
    jobId: null,
    status,
    reviewedBy: null,
    reviewedAt: null,
    createdAt,
    updatedAt: createdAt,
  };
}

const sessionClockIn = contractEntry(
  'contract-session-in',
  'clock_in',
  '2026-10-01T06:00:00.000Z',
  'pending',
);
const sessionClockOut = contractEntry(
  'contract-session-out',
  'clock_out',
  '2026-10-01T14:00:00.000Z',
  'pending',
);

const pendingSession: PendingSession = {
  id: sessionClockIn.id,
  userId: 'contract-worker',
  firstName: 'Svenja',
  lastName: 'Sommer',
  clockIn: sessionClockIn,
  clockOut: sessionClockOut,
  entryIds: [sessionClockIn.id, sessionClockOut.id],
  date: '2026-10-01',
  createdAt,
  jobTitle: null,
};

const changeRequest: ChangeRequestWithDetails = {
  id: 'contract-change-request',
  entryId: 'contract-change-entry',
  pairedEntryId: null,
  organizationId,
  requestedBy: 'contract-worker',
  changeType: 'edit',
  proposedTimestamp: '2026-10-01T05:30:00.000Z',
  originalTimestamp: '2026-10-01T06:30:00.000Z',
  status: 'pending',
  reviewedBy: null,
  reviewedAt: null,
  createdAt,
  updatedAt: createdAt,
  entry: contractEntry('contract-change-entry', 'clock_in', '2026-10-01T06:30:00.000Z', 'approved'),
  pairedEntry: null,
  requesterFirstName: 'Clemens',
  requesterLastName: 'Clausen',
};

const correctionRequest: TimeCorrectionRequest = {
  id: 'contract-correction',
  organizationId,
  subjectEmployeeRecordId: 'contract-worker-record',
  subjectUserId: 'contract-worker',
  requestedBy: 'contract-worker',
  kind: 'edit',
  status: 'submitted',
  currentRevision: 1,
  reviewedBy: null,
  reviewedAt: null,
  decisionComment: null,
  createdAt,
  updatedAt: createdAt,
  revision: {
    revision: 1,
    reason: 'Baustelle früher verlassen',
    beforeSnapshot: { schemaVersion: 1, facts: [] },
    proposedSnapshot: { schemaVersion: 1, facts: [] },
    createdBy: 'contract-worker',
    createdAt,
  },
  requesterName: 'Karla Kaiser',
  subjectName: 'Karla Kaiser',
  canReview: true,
  canWithdraw: false,
};

declare global {
  interface Window {
    uiContractTimeApprovals: {
      sessions: PendingSession[];
      changeRequests: ChangeRequestWithDetails[];
      corrections: TimeCorrectionRequest[];
    };
  }
}

window.uiContractTimeApprovals = {
  sessions: [pendingSession],
  changeRequests: [changeRequest],
  corrections: [correctionRequest],
};

export function readTimeApprovalContract(
  kind: 'pending-sessions' | 'pending-change-requests' | 'time-correction-requests',
):
  | { success: true; sessions: PendingSession[] }
  | { success: true; requests: ChangeRequestWithDetails[] }
  | { success: true; requests: TimeCorrectionRequest[] } {
  const state = window.uiContractTimeApprovals;
  if (kind === 'pending-sessions') return { success: true, sessions: structuredClone(state.sessions) };
  if (kind === 'pending-change-requests')
    return { success: true, requests: structuredClone(state.changeRequests) };
  return { success: true, requests: structuredClone(state.corrections) };
}

export async function reviewEntriesContract(
  entryIds: string[],
  decision: 'approved' | 'rejected',
): Promise<{ success: true; reviewed: number } | { success: false; error: string }> {
  const refusal = await holdWrite('review-entries', { entryIds, decision });
  if (refusal) return { success: false, error: refusal };
  const state = window.uiContractTimeApprovals;
  state.sessions = state.sessions.filter((session) => !session.entryIds.some((id) => entryIds.includes(id)));
  return { success: true, reviewed: entryIds.length };
}

export async function reviewChangeRequestContract(
  requestId: string,
  action: 'approve' | 'reject',
): Promise<{ success: true; request: ChangeRequest } | { success: false; error: string }> {
  const refusal = await holdWrite('review-change-request', { requestId, action });
  if (refusal) return { success: false, error: refusal };
  const state = window.uiContractTimeApprovals;
  state.changeRequests = state.changeRequests.filter((request) => request.id !== requestId);
  return {
    success: true,
    request: { ...changeRequest, status: action === 'approve' ? 'approved' : 'rejected' },
  };
}

export async function reviewTimeCorrectionContract(input: {
  requestId: string;
  decision: 'approve' | 'reject' | 'clarify';
}): Promise<TimeCorrectionResult> {
  const refusal = await holdWrite('review-time-correction', input);
  if (refusal) return { success: false, error: refusal };
  const state = window.uiContractTimeApprovals;
  state.corrections = state.corrections.filter((request) => request.id !== input.requestId);
  return {
    success: true,
    requestId: input.requestId,
    status:
      input.decision === 'approve'
        ? 'approved'
        : input.decision === 'reject'
          ? 'rejected'
          : 'clarification_required',
    replayed: false,
  };
}

/** A deletion the server turns into a change request for the office to approve. */
export async function deleteEntryContract(
  entryId: string,
): Promise<{ success: true; request: ChangeRequest } | { success: false; error: string }> {
  const refusal = await holdWrite('delete-entry', { entryId });
  if (refusal) return { success: false, error: refusal };
  return {
    success: true,
    request: {
      ...changeRequest,
      id: 'contract-delete-request',
      entryId,
      changeType: 'delete',
      proposedTimestamp: null,
    },
  };
}

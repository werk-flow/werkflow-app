// Isolated stand-in for `@/lib/vacation/actions`: the approval card's two reads
// and its decision write. A decision stays open until the spec answers it, so
// the contract can observe the surface between the click and the server.
import type { VacationRequest } from '@/lib/vacation/types';

type VacationActions = typeof import('@/lib/vacation/actions');
type ApproverVacationRequest = import('@/lib/vacation/actions').ApproverVacationRequest;
type Transition = Awaited<ReturnType<VacationActions['decideVacationRequest']>>;

declare global {
  interface Window {
    uiContractApprovals: {
      pending: ApproverVacationRequest[];
      /** Writes the server accepted. */
      decisions: number;
      /** Answers the open decision: accepted, or refused with this error code. */
      answer: ((refusal: string | null) => void) | null;
    };
  }
}

const request: VacationRequest = {
  id: 'contract-vacation',
  organizationId: 'contract-organization',
  employeeRecordId: 'contract-employee',
  requestedBy: 'contract-user',
  startDate: '2026-11-02',
  endDate: '2026-11-06',
  dayPortion: 'full',
  status: 'pending',
  comment: null,
  decidedBy: null,
  decidedAt: null,
  decisionComment: null,
  cancelledBy: null,
  cancelledAt: null,
  cancellationReason: null,
  approvedDaysByYear: null,
  createdAt: '2026-10-01T08:00:00.000Z',
  updatedAt: '2026-10-01T08:00:00.000Z',
};

window.uiContractApprovals = {
  pending: [
    {
      request,
      personName: 'Bruno Beispiel',
      totalDays: 5,
      balance: null,
      hasAbsenceOverlap: false,
      assignedJobsInRange: [],
      hasEntitlement: true,
    },
  ],
  decisions: 0,
  answer: null,
};

export function readApprovalContract(kind: 'pending-vacation-for-approver' | 'decidable-approved-vacation'): {
  success: true;
  requests: ApproverVacationRequest[];
} {
  return {
    success: true,
    requests:
      kind === 'pending-vacation-for-approver' ? structuredClone(window.uiContractApprovals.pending) : [],
  };
}

export async function decideVacationRequest(
  input: Parameters<VacationActions['decideVacationRequest']>[0],
): Promise<Transition> {
  const state = window.uiContractApprovals;
  const refusal = await new Promise<string | null>((resolve) => {
    state.answer = resolve;
  });
  state.answer = null;
  if (refusal) return { success: false, error: refusal };
  state.decisions += 1;
  state.pending = state.pending.filter((item) => item.request.id !== input.requestId);
  return {
    success: true,
    request: { ...request, status: input.decision === 'approve' ? 'approved' : 'rejected' },
  };
}

export async function cancelApprovedVacationRequest(): Promise<never> {
  throw new Error('Unexpected vacation cancellation in isolated UI contracts.');
}

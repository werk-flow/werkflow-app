// Isolated stand-in for `@/lib/org/join-request-actions`: a decision stays
// open until the spec answers it, so the contract can observe the
// Mitarbeiter section between the click and the server.
import type { ActionResult } from '@/lib/action-result';
import type { RequestOrganizationJoinResult } from '@/lib/org/join-request-actions';

declare global {
  interface Window {
    uiContractJoinRequests: {
      /** Decisions the server accepted, as "approve:<id>" or "decline:<id>". */
      decisions: string[];
      /** Answers the open decision: accepted, or refused with this error code. */
      answer: ((refusal: string | null) => void) | null;
    };
  }
}

window.uiContractJoinRequests = { decisions: [], answer: null };

async function heldDecision(kind: 'approve' | 'decline', requestId: string): Promise<ActionResult> {
  const state = window.uiContractJoinRequests;
  const refusal = await new Promise<string | null>((resolve) => {
    state.answer = resolve;
  });
  state.answer = null;
  if (refusal) return { success: false, error: refusal };
  state.decisions.push(`${kind}:${requestId}`);
  return { success: true };
}

export function approveOrganizationJoinRequest(requestId: string): Promise<ActionResult> {
  return heldDecision('approve', requestId);
}

export function declineOrganizationJoinRequest(requestId: string): Promise<ActionResult> {
  return heldDecision('decline', requestId);
}

export async function requestOrganizationJoin(): Promise<RequestOrganizationJoinResult> {
  return { success: false, error: 'unexpected_error' };
}

export async function withdrawOrganizationJoinRequest(): Promise<ActionResult> {
  return { success: false, error: 'unexpected_error' };
}

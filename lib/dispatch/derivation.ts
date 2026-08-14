// Pure dispatch derivation rules: recipient acknowledgement state, pending
// actions, and travel-gap facts. No IO — unit-tested directly.

import type {
  DispatchAcknowledgementState,
  DispatchRecipientDerivedState,
  TravelNote,
} from './types';

export type AcknowledgementFact = {
  id: string;
  employeeRecordId: string;
  state: DispatchAcknowledgementState;
  reason: string | null;
  challengeResolvedAt: string | null;
  createdAt: string;
};

/**
 * Latest-row-wins per recipient on ONE revision. Rows are append-only; the
 * returned map keys every recipient that has at least one row.
 */
export function latestAcknowledgementByRecipient(
  acknowledgements: AcknowledgementFact[]
): Map<string, AcknowledgementFact> {
  const latest = new Map<string, AcknowledgementFact>();
  for (const row of acknowledgements) {
    const current = latest.get(row.employeeRecordId);
    if (!current) {
      latest.set(row.employeeRecordId, row);
      continue;
    }
    // Parsed instants, not string order: timestamps can carry mixed
    // fractional-second precision. Row id breaks exact ties.
    const rowMs = Date.parse(row.createdAt);
    const currentMs = Date.parse(current.createdAt);
    if (rowMs > currentMs || (rowMs === currentMs && row.id > current.id)) {
      latest.set(row.employeeRecordId, row);
    }
  }
  return latest;
}

/**
 * The derived state for one recipient of the CURRENT revision. A recipient
 * without an active login can never acknowledge — that is a labeled fact,
 * not an implicit approval.
 */
export function deriveRecipientState(input: {
  hasLogin: boolean;
  latest: AcknowledgementFact | null;
}): DispatchRecipientDerivedState {
  if (!input.hasLogin) return 'nicht_moeglich';
  if (!input.latest) return 'ausstehend';
  if (input.latest.state === 'acknowledged') return 'bestaetigt';
  if (input.latest.state === 'carried_forward') return 'uebernommen';
  if (input.latest.challengeResolvedAt === null) return 'rueckfrage';
  // A resolved ("kept") challenge returns the recipient to the pending state:
  // the instruction stands and still needs their confirmation.
  return 'ausstehend';
}

/** Whether the recipient currently has an acknowledgement action to perform. */
export function isAcknowledgementPending(
  state: DispatchRecipientDerivedState
): boolean {
  return state === 'ausstehend';
}

// ============================================
// Travel-gap facts (explicit knowledge only)
// ============================================

export type TravelVisitFact = {
  occurrenceId: string;
  title: string;
  employeeRecordId: string;
  employeeName: string;
  localDate: string;
  startMinutes: number;
  endMinutes: number;
  siteId: string | null;
};

/**
 * Compares consecutive TIMED visits per employee per Berlin day. Same-site
 * pairs raise nothing. Different/unknown-site pairs with zero or negative gap
 * warn; positive gaps stay honest "nicht bewertet" — travel time is never
 * inferred from addresses (provider selection belongs to P1-50).
 */
export function deriveTravelNotes(visits: TravelVisitFact[]): TravelNote[] {
  const byEmployeeDay = new Map<string, TravelVisitFact[]>();
  for (const visit of visits) {
    const key = `${visit.employeeRecordId}:${visit.localDate}`;
    const list = byEmployeeDay.get(key) ?? [];
    list.push(visit);
    byEmployeeDay.set(key, list);
  }

  const notes: TravelNote[] = [];
  for (const list of byEmployeeDay.values()) {
    list.sort(
      (left, right) =>
        left.startMinutes - right.startMinutes ||
        left.occurrenceId.localeCompare(right.occurrenceId)
    );
    for (let index = 1; index < list.length; index++) {
      const previous = list[index - 1];
      const next = list[index];
      const sameKnownSite =
        previous.siteId !== null && previous.siteId === next.siteId;
      if (sameKnownSite) continue;
      const gapMinutes = next.startMinutes - previous.endMinutes;
      notes.push({
        employeeRecordId: next.employeeRecordId,
        employeeName: next.employeeName,
        localDate: next.localDate,
        kind: gapMinutes <= 0 ? 'no_gap_different_sites' : 'gap_unassessed',
        gapMinutes,
        previousTitle: previous.title,
        nextTitle: next.title,
      });
    }
  }
  return notes;
}

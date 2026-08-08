// P1-07: pure attention-pattern logic — deduplication, notification identity,
// read/unread versioning, and due-state age. No IO; the server actions in
// ./actions.ts feed this from the owning domains. Unit-tested in
// resolution.test.ts; browser specs assert the surface, not these rules.

import type { VacationRequest } from '@/lib/vacation/types';
import {
  attentionItemKey,
  type AttentionItemIdentity,
  type AttentionNotification,
} from './types';

/**
 * One attention item per source record, regardless of how many derivation or
 * authorization paths produced it (e.g. a substitute who is also role-eligible
 * must never see a request twice). First occurrence wins; order is preserved.
 */
export function dedupeAttentionItems<T extends AttentionItemIdentity>(
  items: T[]
): T[] {
  const seen = new Set<string>();
  const result: T[] = [];
  for (const item of items) {
    const key = attentionItemKey(item);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(item);
  }
  return result;
}

export type VacationDecisionFacts = {
  status: 'approved' | 'rejected' | 'cancelled';
  /**
   * Opaque item-state version. Changes exactly when the decision state of the
   * request changes (approve → cancel), which makes the single notification
   * unread again instead of creating a second one.
   */
  stateVersion: string;
  /** When the latest decision fact happened (cancellation wins over decision). */
  occurredAt: string;
};

/**
 * The decision fact of one vacation request, or null while there is nothing
 * to notify about (pending/withdrawn — the person acted themselves).
 */
export function resolveVacationDecisionFacts(
  request: Pick<
    VacationRequest,
    'status' | 'decidedAt' | 'cancelledAt'
  >
): VacationDecisionFacts | null {
  if (request.status === 'approved' || request.status === 'rejected') {
    if (!request.decidedAt) return null;
    return {
      status: request.status,
      stateVersion: `${request.status}:${request.decidedAt}`,
      occurredAt: request.decidedAt,
    };
  }
  if (request.status === 'cancelled') {
    if (!request.cancelledAt) return null;
    return {
      status: 'cancelled',
      stateVersion: `cancelled:${request.cancelledAt}`,
      occurredAt: request.cancelledAt,
    };
  }
  return null;
}

export type SicknessReportFacts = {
  status: 'reported' | 'cancelled';
  /**
   * Opaque item-state version built from the availability-relevant facts
   * (status, dates, portion). A correction changes the version and makes the
   * SAME notification unread again; evidence bookkeeping deliberately does
   * not — it is office-internal and no news to either audience.
   */
  stateVersion: string;
  /** When the latest material fact happened (cancellation wins). */
  occurredAt: string;
};

/** The notification facts of one sickness report (P1-08). */
export function resolveSicknessReportFacts(report: {
  status: 'reported' | 'cancelled';
  startDate: string;
  endDate: string | null;
  dayPortion: 'full' | 'half_day';
  updatedAt: string;
  cancelledAt: string | null;
}): SicknessReportFacts {
  return {
    status: report.status,
    stateVersion: `${report.status}:${report.startDate}:${report.endDate ?? 'open'}:${report.dayPortion}`,
    occurredAt:
      report.status === 'cancelled'
        ? (report.cancelledAt ?? report.updatedAt)
        : report.updatedAt,
  };
}

/**
 * A notification is unread until the user has seen exactly the current state
 * version; any later domain state change makes it unread again.
 */
export function isNotificationUnread(
  currentStateVersion: string,
  readStateVersion: string | null
): boolean {
  return readStateVersion !== currentStateVersion;
}

/** Notifications older than this window are no longer surfaced. */
export const NOTIFICATION_WINDOW_DAYS = 60;

/**
 * Inclusive lower bound of the notification window as an ISO timestamp. UTC
 * midnight of the business date, matching computeOpenSinceDays — a fixed
 * Berlin offset would shift the boundary by an hour across DST changes.
 */
export function notificationWindowStartIso(
  businessTodayIso: string,
  windowDays: number = NOTIFICATION_WINDOW_DAYS
): string {
  return new Date(
    Date.parse(`${businessTodayIso}T00:00:00Z`) -
      windowDays * 24 * 60 * 60 * 1000
  ).toISOString();
}

/**
 * Whether a decision timestamp still falls into the surfaced window relative
 * to the Europe/Berlin business date (inclusive boundary).
 */
export function isWithinNotificationWindow(
  occurredAtIso: string,
  businessTodayIso: string,
  windowDays: number = NOTIFICATION_WINDOW_DAYS
): boolean {
  const occurredMs = Date.parse(occurredAtIso);
  if (Number.isNaN(occurredMs)) return false;
  return (
    occurredMs >= Date.parse(notificationWindowStartIso(businessTodayIso, windowDays))
  );
}

/**
 * Whole calendar days a request has been open, measured between two ISO
 * business dates (Europe/Berlin). Same day → 0.
 */
export function computeOpenSinceDays(
  openedBusinessDateIso: string,
  businessTodayIso: string
): number {
  const opened = Date.parse(`${openedBusinessDateIso}T00:00:00Z`);
  const today = Date.parse(`${businessTodayIso}T00:00:00Z`);
  if (Number.isNaN(opened) || Number.isNaN(today)) return 0;
  const diff = Math.floor((today - opened) / (24 * 60 * 60 * 1000));
  return Math.max(0, diff);
}

/**
 * Sort notifications newest-first; unread items keep their position (no
 * pinning — the list stays chronologically explainable).
 */
export function sortNotificationsNewestFirst(
  notifications: AttentionNotification[]
): AttentionNotification[] {
  return notifications.toSorted(
    (left, right) => Date.parse(right.occurredAt) - Date.parse(left.occurredAt)
  );
}

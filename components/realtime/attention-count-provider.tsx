'use client';

// P1-07: the one counting pipeline behind every attention badge. Replaces the
// former time-only PendingApprovalCountProvider; counts come from the same
// server-side derivation as the /aufgaben surface, so a badge can never count
// an item its viewer cannot act on.

import { createContext, useContext, useMemo, type ReactNode } from 'react';

import { useOrganization } from '@/components/organization/organization-context';
import { getAttentionCounts } from '@/lib/attention/actions';
import type { AttentionCounts } from '@/lib/attention/types';
import { useBusinessDayRefresh } from '@/hooks/use-business-day-refresh';
import { useLiveView, type LiveViewResult } from '@/hooks/use-live-view';

const ZERO_COUNTS: AttentionCounts = {
  actionableCount: 0,
  approvalsCount: 0,
  unreadNotificationCount: 0,
};

type AttentionCountContextValue = AttentionCounts & {
  refreshAttentionCounts: () => Promise<void>;
};

const AttentionCountContext =
  createContext<AttentionCountContextValue | null>(null);

export function AttentionCountProvider({
  children,
  initialCounts,
  initialOrganizationId,
}: {
  children: ReactNode;
  initialCounts?: AttentionCounts;
  initialOrganizationId?: string | null;
}) {
  const { activeOrgId } = useOrganization();

  const view = useLiveView<AttentionCounts>({
    tables: [
      'time_entries',
      'entry_change_requests',
      'vacation_requests',
      'sickness_reports',
      'employee_capabilities',
      'organization_capabilities',
      'client_requests',
      'client_follow_ups',
      'planning_dispatches',
      'planning_dispatch_acknowledgements',
      'work_blockers',
      'work_artifacts',
      'jobs',
      'projects',
      'work_handover_packages',
      'attention_read_states',
      'organization_responsibility_configurations',
      'organization_responsibility_assignments',
      'organization_responsibility_delegations',
    ],
    read: async (): Promise<LiveViewResult<AttentionCounts>> => {
      if (!activeOrgId) return { ok: true, data: ZERO_COUNTS };
      const result = await getAttentionCounts();
      // Keep the last-known counts on transient failures (documented rule
      // since P1-04/P1-05): a badge briefly showing stale numbers is better
      // than one that silently claims "nothing to do".
      return result.success
        ? { ok: true, data: result.counts }
        : { ok: false };
    },
    initialData:
      activeOrgId && activeOrgId === initialOrganizationId
        ? initialCounts
        : undefined,
    // Switching organizations resets to zero immediately: the previous
    // organization's numbers are wrong for the new one, and an honest zero
    // beats a stale claim while the fetch is in flight. Keep-last-known
    // stays reserved for transient failures within the SAME organization.
    resetKey: activeOrgId,
  });

  useBusinessDayRefresh(view.refresh);

  const value = useMemo<AttentionCountContextValue>(
    () => ({
      ...(view.data ?? ZERO_COUNTS),
      refreshAttentionCounts: view.refresh,
    }),
    [view.data, view.refresh]
  );

  return (
    <AttentionCountContext.Provider value={value}>
      {children}
    </AttentionCountContext.Provider>
  );
}

export function useAttentionCounts() {
  const context = useContext(AttentionCountContext);
  if (!context) {
    throw new Error(
      'useAttentionCounts must be used within AttentionCountProvider'
    );
  }

  return context;
}

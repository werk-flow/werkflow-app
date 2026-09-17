'use client';

// P1-07: the one counting pipeline behind every attention badge. Replaces the
// former time-only PendingApprovalCountProvider; counts come from the same
// server-side derivation as the /aufgaben surface, so a badge can never count
// an item its viewer cannot act on.

import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { z } from 'zod';

import { useOrganization } from '@/components/organization/organization-context';
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

// Boundary parse of our own route handler's JSON (app/api/attention-counts).
const attentionCountsResponseSchema = z.union([
  z.object({
    success: z.literal(true),
    counts: z.object({
      actionableCount: z.number().int().nonnegative(),
      approvalsCount: z.number().int().nonnegative(),
      unreadNotificationCount: z.number().int().nonnegative(),
    }),
  }),
  z.object({ success: z.literal(false), error: z.string() }),
]);

/**
 * Reads the counts through a route handler, not a Server Action: one
 * client's Server Actions and router refreshes run one after another, and
 * this derivation occupied that queue on every mount and channel join,
 * delaying the reads behind it that carry user-visible content (Step 2,
 * PF-29). Authorization lives in getAttentionCounts on the server.
 */
async function readAttentionCounts(signal: AbortSignal): Promise<LiveViewResult<AttentionCounts>> {
  const response = await fetch('/api/attention-counts', {
    cache: 'no-store',
    credentials: 'same-origin',
    signal,
  });
  if (!response.ok) return { ok: false };
  const parsed = attentionCountsResponseSchema.safeParse(await response.json());
  if (!parsed.success || !parsed.data.success) return { ok: false };
  return { ok: true, data: parsed.data.counts };
}

export function AttentionCountProvider({
  children,
  initialCounts,
  initialOrganizationId,
}: {
  children: ReactNode;
  initialCounts?: AttentionCounts | undefined;
  initialOrganizationId?: string | null | undefined;
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
    read: async ({ signal }): Promise<LiveViewResult<AttentionCounts>> => {
      if (!activeOrgId) return { ok: true, data: ZERO_COUNTS };
      // Keep the last-known counts on transient failures (documented rule
      // since P1-04/P1-05): a badge briefly showing stale numbers is better
      // than one that silently claims "nothing to do".
      return readAttentionCounts(signal);
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

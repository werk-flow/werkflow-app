'use client';

// P1-07: the one counting pipeline behind every attention badge. Replaces the
// former time-only PendingApprovalCountProvider; counts come from the same
// server-side derivation as the /aufgaben surface, so a badge can never count
// an item its viewer cannot act on.

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { z } from '@/lib/zod';

import { useOrganization } from '@/components/organization/organization-context';
import { countAttentionItems } from '@/lib/attention/resolution';
import type { AttentionCounts, AttentionOverview } from '@/lib/attention/types';
import { useBusinessDayRefresh } from '@/hooks/use-business-day-refresh';
import { useLiveView, type LiveViewResult } from '@/hooks/use-live-view';

const ZERO_COUNTS: AttentionCounts = {
  actionableCount: 0,
  approvalsCount: 0,
  unreadNotificationCount: 0,
};

/**
 * Counts adopted from a mounted Aufgaben overview: `undefined` while none is
 * mounted, `null` while it is mounted without data yet.
 */
type AdoptedCounts = AttentionCounts | null | undefined;

const AttentionCountContext = createContext<AttentionCounts | null>(null);
const AdoptCountsContext = createContext<((counts: AdoptedCounts) => void) | null>(null);

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
  const [adopted, setAdopted] = useState<AdoptedCounts>(undefined);

  const view = useLiveView<AttentionCounts>({
    tables: [
      'time_entries',
      'entry_change_requests',
      'vacation_requests',
      'sickness_reports',
      'employee_capabilities',
      'organization_capabilities',
      'organization_join_requests',
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
    initialData: activeOrgId && activeOrgId === initialOrganizationId ? initialCounts : undefined,
    // Switching organizations resets to zero immediately: the previous
    // organization's numbers are wrong for the new one, and an honest zero
    // beats a stale claim while the fetch is in flight. Keep-last-known
    // stays reserved for transient failures within the SAME organization.
    resetKey: activeOrgId,
    // The mounted Aufgaben overview already runs the same derivation on the
    // same events; a second one per event would double the load. Events queue
    // meanwhile, and one catch-up read runs when the overview unmounts. An
    // overview that has no counts yet (loading, or its read failed) leaves
    // the provider's own reads running, so the badges never freeze.
    suspend: adopted != null,
  });

  useBusinessDayRefresh(view.refresh);

  const counts = adopted ?? view.data ?? ZERO_COUNTS;
  return (
    <AdoptCountsContext.Provider value={setAdopted}>
      <AttentionCountContext.Provider value={counts}>{children}</AttentionCountContext.Provider>
    </AdoptCountsContext.Provider>
  );
}

export function useAttentionCounts(): AttentionCounts {
  const context = useContext(AttentionCountContext);
  if (!context) {
    throw new Error('useAttentionCounts must be used within AttentionCountProvider');
  }

  return context;
}

/**
 * Makes the badges count the given overview while the calling surface is
 * mounted, so its optimistic echo moves the badges in the same frame and the
 * provider skips its own derivation. Pass `null` while the overview has no
 * data; the badges then keep their last-known counts.
 */
export function useAttentionCountsFromOverview(overview: AttentionOverview | null): void {
  const adopt = useContext(AdoptCountsContext);
  if (!adopt) {
    throw new Error('useAttentionCountsFromOverview must be used within AttentionCountProvider');
  }
  const counts = useMemo(() => (overview ? countAttentionItems(overview) : null), [overview]);
  // Synchronizes the provider, an external owner of the badges; the
  // cleanup hands the counts back to the provider's own reads.
  useEffect(() => {
    adopt(counts);
  }, [adopt, counts]);
  useEffect(() => () => adopt(undefined), [adopt]);
}

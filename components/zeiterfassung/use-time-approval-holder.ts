'use client';

import { useLiveView } from '@/hooks/use-live-view';
import { readInBackground } from '@/lib/data/background-read-client';
import type { EffectiveResponsibilityHolder } from '@/lib/responsibilities/resolution';

/**
 * The caller's own `time_approval` holder in the organization of the recorded
 * time a surface shows, kept live while the surface is open: an assignment or
 * delegation change re-reads it, as the server decides on the current holder.
 * Until the read lands, or when it fails, the holder is null and the surface
 * offers no approval and no correction of another person's time: the approval
 * lists under Zeiterfassung and Aufgaben stay the way to review, and the
 * server refuses what it does not allow either way, so a failed read needs no
 * surface of its own.
 */
export function useTimeApprovalHolder(
  organizationId: string | null,
  enabled: boolean,
): EffectiveResponsibilityHolder | null {
  const view = useLiveView<EffectiveResponsibilityHolder | null>({
    tables: [
      'organization_responsibility_configurations',
      'organization_responsibility_assignments',
      'organization_responsibility_delegations',
    ],
    enabled: enabled && organizationId !== null,
    resetKey: organizationId,
    read: async ({ signal }) => {
      if (!organizationId) return { ok: false };
      const result = await readInBackground('time-approval-holder', { organizationId }, signal);
      return result.success ? { ok: true, data: result.holder } : { ok: false };
    },
  });
  // A refresh that failed keeps no holder: the last known one may no longer hold.
  return view.isStale ? null : (view.data ?? null);
}

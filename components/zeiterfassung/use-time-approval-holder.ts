'use client';

import { useClientRead } from '@/hooks/use-client-read';
import { readInBackground } from '@/lib/data/background-read-client';
import type { EffectiveResponsibilityHolder } from '@/lib/responsibilities/resolution';

/**
 * The caller's own `time_approval` holder in the organization of the recorded
 * time a surface shows, read when the surface opens. Until the read lands, or
 * when it fails, the holder is null and the surface offers no approval: the
 * approval lists under Zeiterfassung and Aufgaben stay the way to review, and
 * the server refuses an approval it does not allow either way.
 */
export function useTimeApprovalHolder(
  organizationId: string | null,
  enabled: boolean,
): EffectiveResponsibilityHolder | null {
  const read = useClientRead({
    read: (signal) =>
      organizationId === null
        ? Promise.resolve({ success: false as const, error: 'no_active_org' })
        : readInBackground('time-approval-holder', { organizationId }, signal),
    deps: [organizationId],
    enabled: enabled && organizationId !== null,
    failureMessage: 'Die Freigabeberechtigung konnte nicht geladen werden.',
  });
  return read.data?.holder ?? null;
}

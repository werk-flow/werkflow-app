'use client';

import { useOrganization } from '@/components/organization/organization-context';
import { useClientRead, type ReadFailure } from '@/hooks/use-client-read';
import { readInBackground } from '@/lib/data/background-read-client';
import type { EquipmentSourceOption } from '@/lib/installed-equipment/types';

const NO_OPTIONS: EquipmentSourceOption[] = [];

/**
 * The exact sources of one equipment: with a chosen job or project, its
 * Arbeitsnachweis revisions and handover releases; without one, the
 * equipment's own documents. The read runs over the background-read route
 * when `enabled` turns on or the work changes, so it never queues behind a
 * save, and a change cancels the old read.
 */
export function useEquipmentSourceOptions(
  equipmentId: string,
  work: { type: 'job' | 'project'; id: string } | null,
  enabled: boolean,
): {
  options: EquipmentSourceOption[];
  loading: boolean;
  /** The failed read with its retry; the picker offers „Erneut laden“. */
  loadFailure: ReadFailure | null;
} {
  const { activeOrgId } = useOrganization();
  const workType = work?.type ?? null;
  const workId = work?.id ?? null;
  const sources = useClientRead({
    read: (signal) =>
      readInBackground(
        'equipment-sources',
        {
          organizationId: activeOrgId ?? '',
          equipmentId,
          work: workType && workId ? { type: workType, id: workId } : null,
        },
        signal,
      ),
    deps: [activeOrgId, equipmentId, workType, workId],
    enabled: enabled && Boolean(activeOrgId),
    failureMessage: 'Die Nachweise konnten nicht geladen werden.',
  });
  return {
    options: sources.data?.options ?? NO_OPTIONS,
    loading: sources.loading,
    loadFailure: sources.failure,
  };
}

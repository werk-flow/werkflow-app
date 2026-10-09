'use client';

import { useCallback, useEffect, useState } from 'react';

import { useOrganization } from '@/components/organization/organization-context';
import { readInBackground } from '@/lib/data/background-read-client';
import type { EquipmentSourceOption } from '@/lib/installed-equipment/types';

type Loaded = { key: string; options: EquipmentSourceOption[] | null };

const LOAD_ERROR = 'Die Nachweise konnten nicht geladen werden.';
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
  /** Set when the read failed; the picker offers „Erneut laden“ through `retry`. */
  error: string | undefined;
  retry: () => void;
} {
  const { activeOrgId } = useOrganization();
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const workType = work?.type ?? null;
  const workId = work?.id ?? null;
  const key = `${activeOrgId}:${equipmentId}:${workType}:${workId}`;
  const needsRead = enabled && loaded?.key !== key;

  useEffect(() => {
    if (!needsRead || !activeOrgId) return;
    const controller = new AbortController();
    void readInBackground(
      'equipment-sources',
      {
        organizationId: activeOrgId,
        equipmentId,
        work: workType && workId ? { type: workType, id: workId } : null,
      },
      controller.signal,
    ).then((result) => {
      if (controller.signal.aborted) return;
      setLoaded({ key, options: result.success ? result.options : null });
    });
    return () => controller.abort();
  }, [activeOrgId, equipmentId, key, needsRead, workId, workType]);

  const retry = useCallback(() => setLoaded(null), []);
  const current = enabled && loaded?.key === key ? loaded : null;
  return {
    options: current?.options ?? NO_OPTIONS,
    loading: needsRead,
    error: current && current.options === null ? LOAD_ERROR : undefined,
    retry,
  };
}

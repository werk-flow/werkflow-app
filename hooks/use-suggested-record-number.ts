'use client';

import { useEffect, useRef } from 'react';

import { useOrganization } from '@/components/organization/organization-context';
import { readInBackground, type BackgroundReadFailure } from '@/lib/data/background-read-client';
import type { BackgroundReadResult } from '@/lib/data/background-reads';
import { logError } from '@/lib/logging';

type RecordNumberKind =
  | 'next-job-number'
  | 'next-project-number'
  | 'next-request-number'
  | 'next-personnel-number';

function suggestionOf(result: BackgroundReadResult<RecordNumberKind> | BackgroundReadFailure): string | null {
  if (!result.success) return null;
  if ('jobNumber' in result) return result.jobNumber;
  if ('projectNumber' in result) return result.projectNumber;
  if ('requestNumber' in result) return result.requestNumber;
  return result.number;
}

/**
 * The next free number a create dialog suggests while `enabled`. The read
 * runs over the background-read route, so it never queues ahead of a save,
 * and a new kind, a switch of organization or a disabled dialog cancels it.
 * `apply` receives the suggestion and decides whether a number the user typed
 * stays. A failed read leaves the field empty for manual entry.
 */
export function useSuggestedRecordNumber(
  kind: RecordNumberKind,
  enabled: boolean,
  apply: (suggestion: string) => void,
): void {
  const { activeOrgId } = useOrganization();
  // The latest callback applies the answer; callers need not memoize it.
  const applyRef = useRef(apply);
  useEffect(() => {
    applyRef.current = apply;
  });

  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    void readInBackground(kind, { organizationId: activeOrgId ?? '' }, controller.signal).then((result) => {
      if (controller.signal.aborted) return;
      const suggestion = suggestionOf(result);
      if (suggestion !== null) applyRef.current(suggestion);
      else if (!result.success && result.error === 'background_read_failed')
        logError('records.next_number_failed', { kind });
    });
    return () => controller.abort();
  }, [activeOrgId, enabled, kind]);
}

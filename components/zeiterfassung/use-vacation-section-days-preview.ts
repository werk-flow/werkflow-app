'use client';

import { useEffect, useRef, useState } from 'react';

import { useOrganization } from '@/components/organization/organization-context';
import { readInBackground } from '@/lib/data/background-read-client';
import type { VacationDayPortion } from '@/lib/vacation/types';

type VacationDaysPreviewInput = {
  startDate: string;
  endDate: string;
  dayPortion: VacationDayPortion;
};

type VacationDaysPreview = {
  previewDays: number | null;
  isPreviewing: boolean;
  previewError: string | null;
  invalidatePreview: () => void;
  retryPreview: () => void;
};

// Debounced server preview of the vacation days a date range costs. A newer
// input or an explicit invalidation supersedes every in-flight preview.
export function useVacationDaysPreview({
  startDate,
  endDate,
  dayPortion,
}: VacationDaysPreviewInput): VacationDaysPreview {
  const { activeOrgId } = useOrganization();
  const [previewDays, setPreviewDays] = useState<number | null>(null);
  const [isPreviewing, setIsPreviewing] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewRefreshKey, setPreviewRefreshKey] = useState(0);
  const previewGenerationRef = useRef(0);

  const invalidatePreview = () => {
    previewGenerationRef.current += 1;
    setPreviewDays(null);
    setIsPreviewing(false);
    setPreviewError(null);
  };

  useEffect(() => {
    if (!startDate || !endDate || endDate < startDate) return;
    const generation = ++previewGenerationRef.current;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      setIsPreviewing(true);
      setPreviewError(null);
      const input = { organizationId: activeOrgId ?? '', startDate, endDate, dayPortion };
      // The background read never rejects; its transport failure keeps the retry of an unexpected error.
      void readInBackground('vacation-days-preview', input, controller.signal).then((result) => {
        if (generation !== previewGenerationRef.current) return;
        setIsPreviewing(false);
        // A read cancelled by a range change that started no new preview shows nothing.
        if (controller.signal.aborted) return;
        if (result.success) setPreviewDays(result.totalDays);
        else setPreviewError(result.error === 'background_read_failed' ? 'unexpected_error' : result.error);
      });
    }, 150);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [activeOrgId, dayPortion, endDate, previewRefreshKey, startDate]);

  const retryPreview = () => setPreviewRefreshKey((value) => value + 1);

  return {
    previewDays,
    isPreviewing,
    previewError,
    invalidatePreview,
    retryPreview,
  };
}

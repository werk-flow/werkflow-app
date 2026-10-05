'use client';

import { useEffect, useRef, useState } from 'react';

import { previewVacationRequest } from '@/lib/vacation/actions';
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
    const timer = setTimeout(() => {
      setIsPreviewing(true);
      setPreviewError(null);
      void previewVacationRequest({ startDate, endDate, dayPortion })
        .then((result) => {
          if (generation !== previewGenerationRef.current) return;
          if (result.success) {
            setPreviewDays(result.totalDays);
          } else {
            setPreviewError(result.error);
          }
        })
        .catch(() => {
          if (generation === previewGenerationRef.current) {
            setPreviewError('unexpected_error');
          }
        })
        .finally(() => {
          if (generation === previewGenerationRef.current) {
            setIsPreviewing(false);
          }
        });
    }, 150);
    return () => clearTimeout(timer);
  }, [dayPortion, endDate, previewRefreshKey, startDate]);

  const retryPreview = () => setPreviewRefreshKey((value) => value + 1);

  return {
    previewDays,
    isPreviewing,
    previewError,
    invalidatePreview,
    retryPreview,
  };
}

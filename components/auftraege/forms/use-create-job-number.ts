'use client';

import { useEffect, useRef, useState } from 'react';

import { getNextJobNumber } from '@/lib/jobs/actions';

type CreateJobNumberOptions = {
  initialJobNumber: string | null | undefined;
  /** Whether the form is visible; the next free number is only fetched then. */
  isActive: boolean;
};

/** The job number field: follows a changing suggestion until the user types their own. */
export function useCreateJobNumber({ initialJobNumber, isActive }: CreateJobNumberOptions) {
  const previousInitialJobNumberRef = useRef(initialJobNumber ?? '');
  const [jobNumber, setJobNumber] = useState(initialJobNumber ?? '');

  useEffect(() => {
    const previousInitialJobNumber = previousInitialJobNumberRef.current;
    const nextInitialJobNumber = initialJobNumber ?? '';

    if (nextInitialJobNumber) {
      setJobNumber((currentJobNumber) =>
        !currentJobNumber || currentJobNumber === previousInitialJobNumber
          ? nextInitialJobNumber
          : currentJobNumber,
      );
    }

    previousInitialJobNumberRef.current = nextInitialJobNumber || previousInitialJobNumber;
  }, [initialJobNumber]);

  useEffect(() => {
    if (!isActive || initialJobNumber || jobNumber) return;
    let isCurrent = true;

    getNextJobNumber().then((result) => {
      if (!isCurrent || !result.success) return;

      setJobNumber((currentJobNumber) => currentJobNumber || result.jobNumber);
    });

    return () => {
      isCurrent = false;
    };
  }, [initialJobNumber, isActive, jobNumber]);

  return { jobNumber, setJobNumber };
}

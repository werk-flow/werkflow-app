'use client';

import { useEffect, useRef, useState } from 'react';

import { useSuggestedRecordNumber } from '@/hooks/use-suggested-record-number';

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

  // An emptied field asks for a fresh suggestion; one the user typed stays.
  useSuggestedRecordNumber('next-job-number', isActive && !initialJobNumber && !jobNumber, (suggestion) =>
    setJobNumber((currentJobNumber) => currentJobNumber || suggestion),
  );

  return { jobNumber, setJobNumber };
}

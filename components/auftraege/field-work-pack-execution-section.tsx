'use client';

import { useCallback, useEffect, useState, type ReactElement } from 'react';

import { FieldWorkPackSource } from '@/components/auftraege/field-work-pack-source';
import { JobDispatchSection } from '@/components/auftraege/job-dispatch-section';
import { WorkLifecycleCard } from '@/components/auftraege/work-lifecycle-card';
import {
  blocksFieldLifecycleActions,
  type FieldDispatchState,
} from '@/lib/dispatch/field-state';
import type { EmployeeDispatchCard } from '@/lib/dispatch/types';
import type { WorkLifecycleSnapshot } from '@/lib/work-lifecycle/types';

function initialFieldDispatchState(
  cards: EmployeeDispatchCard[] | undefined,
  error: string | null
): FieldDispatchState {
  if (cards) {
    return {
      status: 'ready',
      hasPending: cards.some((card) => card.myState === 'ausstehend'),
    };
  }
  return { status: error ? 'error' : 'loading', hasPending: false };
}

export function FieldWorkPackExecutionSection({
  jobId,
  jobTitle,
  initialDispatchCards,
  initialDispatchError,
  lifecycleSnapshot,
  readOnly,
}: {
  jobId: string;
  jobTitle: string;
  initialDispatchCards?: EmployeeDispatchCard[];
  initialDispatchError: string | null;
  lifecycleSnapshot: WorkLifecycleSnapshot | null;
  readOnly: boolean;
}): ReactElement {
  const [dispatchState, setDispatchState] = useState<FieldDispatchState>(() =>
    initialFieldDispatchState(initialDispatchCards, initialDispatchError)
  );

  useEffect(() => {
    setDispatchState(initialFieldDispatchState(initialDispatchCards, initialDispatchError));
  }, [initialDispatchCards, initialDispatchError]);

  const handleDispatchStateChange = useCallback((state: FieldDispatchState) => {
    setDispatchState(state);
  }, []);
  const blockLifecycleActions = blocksFieldLifecycleActions(dispatchState);
  const dispatch = (
    <JobDispatchSection
      key={jobId}
      jobId={jobId}
      initialCards={initialDispatchCards}
      initialError={initialDispatchError}
      readOnly={readOnly}
      onStateChange={handleDispatchStateChange}
    />
  );
  const lifecycle = (
    <FieldWorkPackSource
      sourceId={`${jobId}:lifecycle`}
      success={lifecycleSnapshot !== null}
      title="Arbeitsstand nicht verfügbar"
      description="Der Arbeitsstand und die Einsatzbereitschaft konnten nicht geladen werden. Es wird nichts als erfüllt angenommen."
    >
      {lifecycleSnapshot ? (
        <WorkLifecycleCard
          initialSnapshot={lifecycleSnapshot}
          targetLabel={jobTitle}
          isManager={false}
          fieldMode
          hasPendingDispatch={blockLifecycleActions}
          readOnly={readOnly}
        />
      ) : null}
    </FieldWorkPackSource>
  );

  return blockLifecycleActions ? <>{dispatch}{lifecycle}</> : <>{lifecycle}{dispatch}</>;
}

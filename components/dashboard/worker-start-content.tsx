'use client';

import { memo, type ReactElement } from 'react';

import { useClockState } from '@/components/clock-state-provider';
import { useAttentionCounts } from '@/components/realtime/attention-count-provider';
import { workerStartClockView } from './worker-start-clock';
import { useOnline, useWorkerStartDay } from './worker-start-day';
import {
  clockLines,
  taskCount,
  WorkerStartClock,
  WorkerStartEinsaetze,
  WorkerStartTasks,
} from './worker-start-sections';

/** The only component that follows the clock: each clock action changes its state several times. */
function ClockLines(): ReactElement {
  return clockLines(workerStartClockView(useClockState()));
}

/** The only component that follows the attention counts. */
function TaskCount(): ReactElement | null {
  return taskCount(useAttentionCounts().actionableCount);
}

/**
 * A field worker's start page: today's Einsätze from the phone's snapshot, the clock and today's
 * working time, and the own open Aufgaben. Everything comes from what the app already holds;
 * the only reads are the phone's own storage. Memoized without props: a route refresh after a
 * clock action renders the page again and leaves this part as it is.
 */
export const WorkerStartContent = memo(function WorkerStartContent(): ReactElement {
  const day = useWorkerStartDay();
  const online = useOnline();

  return (
    <div className="mx-auto max-w-3xl space-y-6" data-testid="worker-start">
      <WorkerStartEinsaetze
        stored={day.stored}
        settled={day.settled}
        ended={day.ended}
        failure={day.failure}
        online={online}
      />
      <WorkerStartClock>
        <ClockLines />
      </WorkerStartClock>
      <WorkerStartTasks>
        <TaskCount />
      </WorkerStartTasks>
    </div>
  );
});

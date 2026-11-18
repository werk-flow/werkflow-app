'use client';

import { memo, useCallback, useState, type ReactElement } from 'react';

import { useClockState } from '@/components/clock-state-provider';
import { useAttentionCounts } from '@/components/realtime/attention-count-provider';
import { useBusinessDayRefresh } from '@/hooks/use-business-day-refresh';
import { getBusinessTodayIso } from '@/lib/date-time/berlin';
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
  // Berlin midnight renews „today“: a clock state of the day before then shows no hours as today's.
  const [today, setToday] = useState(getBusinessTodayIso);
  useBusinessDayRefresh(useCallback(() => setToday(getBusinessTodayIso()), []));
  return clockLines(workerStartClockView(useClockState(), today));
}

/** The only component that follows the attention counts. */
function TaskCount(): ReactElement | null {
  return taskCount(useAttentionCounts().actionableCount);
}

/**
 * The only component that follows the device day and the organization and profile contexts, which
 * a clock action's route refresh renders again; the sections below it compare their props.
 */
function EinsaetzePart(): ReactElement {
  const day = useWorkerStartDay();
  const online = useOnline();
  return (
    <WorkerStartEinsaetze
      stored={day.stored}
      settled={day.settled}
      ended={day.ended}
      failure={day.failure}
      online={online}
    />
  );
}

/**
 * A field worker's start page: today's Einsätze from the phone's snapshot, the clock and today's
 * working time, and the own open Aufgaben. Everything comes from what the app already holds;
 * the only reads are the phone's own storage. Memoized without props and reading no context: a
 * route refresh after a clock action renders the page again and leaves this part as it is.
 */
export const WorkerStartContent = memo(function WorkerStartContent(): ReactElement {
  return (
    <div className="mx-auto max-w-3xl space-y-6" data-testid="worker-start">
      <EinsaetzePart />
      <WorkerStartClock>
        <ClockLines />
      </WorkerStartClock>
      <WorkerStartTasks>
        <TaskCount />
      </WorkerStartTasks>
    </div>
  );
});

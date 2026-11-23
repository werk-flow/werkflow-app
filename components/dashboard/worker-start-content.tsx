'use client';

import { memo, useCallback, useState, type ReactElement } from 'react';

import { useBusinessDayRefresh } from '@/hooks/use-business-day-refresh';
import { getBusinessTodayIso } from '@/lib/date-time/berlin';
import { useOnline } from '@/lib/field-sync/device/shown-clock';
import { workerStartClockView } from './worker-start-clock';
import { useWorkerStartDay } from './worker-start-day';
import {
  clockLines,
  taskCount,
  WorkerStartClock,
  WorkerStartEinsaetze,
  WorkerStartTasks,
} from './worker-start-sections';

/**
 * The shell state the start page follows, read through hooks the page part hands in
 * (worker-start.tsx). This lazily loaded part imports no shell context module: a lazy chunk that
 * does makes Turbopack split the (app) layout's start-up code into one more script, which every
 * field cold start loads (werk-flow/werkflow-planning#489).
 */
export type WorkerStartSources = {
  useClock: () => Parameters<typeof workerStartClockView>[0];
  useActionableCount: () => number;
  useUserId: () => string | null;
  /** The active organization while the person works in it as `employee`, else null. */
  useEmployeeOrgId: () => string | null;
};

type SourcesProps = { sources: WorkerStartSources };

/** The only component that follows the clock: each clock action changes its state several times. */
function ClockLines({ sources }: SourcesProps): ReactElement {
  // Berlin midnight renews „today“: a clock state of the day before then shows no hours as today's.
  const [today, setToday] = useState(getBusinessTodayIso);
  useBusinessDayRefresh(useCallback(() => setToday(getBusinessTodayIso()), []));
  return clockLines(workerStartClockView(sources.useClock(), today));
}

/** The only component that follows the attention counts. */
function TaskCount({ sources }: SourcesProps): ReactElement | null {
  return taskCount(sources.useActionableCount());
}

/**
 * The only component that follows the device day and the organization and profile contexts, which
 * a clock action's route refresh renders again; the sections below it compare their props.
 */
function EinsaetzePart({ sources }: SourcesProps): ReactElement {
  const day = useWorkerStartDay(sources.useUserId(), sources.useEmployeeOrgId());
  const online = useOnline();
  return (
    <WorkerStartEinsaetze
      stored={day.stored}
      settled={day.settled}
      ended={day.ended}
      waited={day.waited}
      failure={day.failure}
      online={online}
    />
  );
}

/**
 * A field worker's start page: today's Einsätze from the phone's snapshot, the clock and today's
 * working time, and the own open Aufgaben. Everything comes from what the app already holds;
 * the only reads are the phone's own storage. Memoized on the page part's fixed sources and reading
 * no context itself: a route refresh after a clock action renders the page again and leaves this
 * part as it is.
 */
export const WorkerStartContent = memo(function WorkerStartContent({ sources }: SourcesProps): ReactElement {
  return (
    <div className="mx-auto max-w-3xl space-y-6" data-testid="worker-start">
      <EinsaetzePart sources={sources} />
      <WorkerStartClock>
        <ClockLines sources={sources} />
      </WorkerStartClock>
      <WorkerStartTasks>
        <TaskCount sources={sources} />
      </WorkerStartTasks>
    </div>
  );
});

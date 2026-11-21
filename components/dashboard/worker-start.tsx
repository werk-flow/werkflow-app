'use client';

import { lazy, Suspense, type ComponentType, type ReactElement } from 'react';

import { TodayRefreshOnStart } from '@/components/auftraege/work-pack/today-refresh-on-start';
import { SectionError } from '@/components/ui/section-error';
import { logError } from '@/lib/logging';
import { WorkerStartSkeleton } from './worker-start-skeleton';

/** A start page whose code cannot load (a chunk a deployment removed, a dropped connection). */
function WorkerStartLoadError(): ReactElement {
  return (
    <div className="mx-auto max-w-3xl">
      <SectionError onRetry={() => window.location.reload()}>
        Deine Startseite konnte nicht geladen werden. Bitte lade die Seite neu.
      </SectionError>
    </div>
  );
}

// Loads after the page is usable: the server render carries only this reference, and every
// clock action renders the page again. The job page never loads this code.
async function loadWorkerStartContent(): Promise<{ default: ComponentType }> {
  try {
    const { WorkerStartContent } = await import('./worker-start-content');
    return { default: WorkerStartContent };
  } catch (error) {
    logError('WorkerStart: start page code failed to load', error);
    return { default: WorkerStartLoadError };
  }
}

const WorkerStartContent = lazy(loadWorkerStartContent);

/**
 * The start page of a field worker (`employee`): today, the clock and the own Aufgaben. It also
 * mounts E7's refresh of the day the phone keeps, so the page references one client module for
 * the role: the phone header's link prefetches this page's code on every cold start.
 */
export function WorkerStart(): ReactElement {
  return (
    <>
      <TodayRefreshOnStart />
      <Suspense fallback={<WorkerStartSkeleton />}>
        <WorkerStartContent />
      </Suspense>
    </>
  );
}

'use client';

import { useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { SectionError } from '@/components/ui/section-error';

import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { StaleRegion } from '@/components/shared/stale-region';
import { UsableContent } from '@/components/shared/usable-content';
import { PersonnelOwnActionsSection } from '@/components/mitarbeiter/personnel-own-actions-section';
import { AufgabenNotificationsSection } from './aufgaben-notifications-section';
import { AufgabenOwnRequestsSection } from './aufgaben-own-requests-section';
import { AufgabenTaskSection } from './aufgaben-task-section';
import { useAufgabenOverview } from './use-aufgaben-overview';
import { OfficeStart } from '@/components/dashboard/office-start';
import { OFFICE_START_HOST_ID } from '@/components/dashboard/office-start-host-id';

// The dashboard's page arrives in parts, so its host can appear after the
// shell mounted: the portal looks for it again whenever the document changes.
// The shell renders the portal only on the dashboard of Admin and Büro.
function subscribeToHost(onChange: () => void): () => void {
  const observer = new MutationObserver(onChange);
  observer.observe(document.body, { childList: true, subtree: true });
  return () => observer.disconnect();
}
const findHost = () => document.getElementById(OFFICE_START_HOST_ID);
const noHostOnServer = () => null;

/**
 * Renders the office start into the dashboard's host (components/dashboard/office-start-host.tsx).
 * The app shell renders this, and it lives in this module, because the shell
 * already carries the Aufgaben code through its Aufgaben skeleton: a page or a
 * lazy chunk that imported the office start itself made the bundler regroup
 * the shell's chunks, one to three more scripts on every cold start
 * (audit:lab:office, audit:lab:field), and moving the Aufgaben code out of the
 * shell cost opening Aufgaben a script (lab.admin.tasks-open).
 */
export function OfficeStartPortal() {
  const host = useSyncExternalStore(subscribeToHost, findHost, noHostOnServer);
  return host ? createPortal(<OfficeStart />, host) : null;
}

export function AufgabenContent() {
  const { view, overview, busy, isMarkingAllRead, handleMarkRead, handleMarkAllRead } = useAufgabenOverview();

  if (view.isLoading) {
    return (
      <div className="mx-auto max-w-3xl space-y-8">
        <PersonnelOwnActionsSection />
        <AufgabenListSkeleton />
      </div>
    );
  }

  // Settled without any data: the first load failed.
  if (!overview) {
    return (
      <div className="mx-auto max-w-3xl space-y-8">
        <PersonnelOwnActionsSection />
        <SectionError onRetry={() => void view.refresh()} retryPending={view.isRefreshing}>
          Die Aufgaben konnten nicht geladen werden. Bitte versuche es erneut.
        </SectionError>
      </div>
    );
  }

  return (
    <UsableContent name="aufgaben" count={overview.tasks.length}>
      <div className="mx-auto max-w-3xl space-y-8" data-testid="aufgaben-content" data-loaded="true">
        <PersonnelOwnActionsSection />
        <StaleRegion stale={view.isStale} onRetry={view.refresh} className="space-y-8">
          <AufgabenTaskSection tasks={overview.tasks} />

          <AufgabenNotificationsSection
            notifications={overview.notifications}
            busy={busy}
            isMarkingAllRead={isMarkingAllRead}
            handleMarkRead={handleMarkRead}
            handleMarkAllRead={handleMarkAllRead}
          />

          <AufgabenOwnRequestsSection ownRequests={overview.ownRequests} />
        </StaleRegion>
      </div>
    </UsableContent>
  );
}

const SKELETON_ROW_KEYS = [0, 1, 2] as const;

/**
 * Mirrors the loaded page: the task heading, one task group (icon + title,
 * divided card of title/meta rows) and the notification card (unread dot,
 * text, "Gelesen" button slot). Cards are not clickable as a whole, so
 * nothing here hovers.
 */
export function AufgabenListSkeleton() {
  return (
    <div className="space-y-8" aria-hidden="true">
      <section className="space-y-4">
        <Skeleton className="h-5 w-32" />
        <div className="space-y-2">
          <div className="flex items-center gap-1.5 px-1">
            <Skeleton className="size-4" />
            <Skeleton className="h-4 w-28" />
          </div>
          <Card className="gap-0 divide-y py-0">
            {SKELETON_ROW_KEYS.map((key) => (
              <div key={key} className="space-y-1.5 px-4 py-3">
                <Skeleton className="h-4 w-40" />
                <Skeleton className="h-3 w-56 max-w-full" />
              </div>
            ))}
          </Card>
        </div>
      </section>
      <section className="space-y-4">
        <div className="flex items-center justify-between gap-2">
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-8 w-48" />
        </div>
        <Card className="gap-0 divide-y py-0">
          {SKELETON_ROW_KEYS.map((key) => (
            <div key={key} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
              <div className="flex min-w-0 items-center gap-2">
                <Skeleton className="size-2 shrink-0 rounded-full" />
                <Skeleton className="h-4 w-64 max-w-full" />
              </div>
              <Skeleton className="h-8 w-24" />
            </div>
          ))}
        </Card>
      </section>
    </div>
  );
}

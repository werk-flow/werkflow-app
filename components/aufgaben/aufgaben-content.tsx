'use client';
import { SectionError } from '@/components/ui/section-error';

import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { UsableContent } from '@/components/shared/usable-content';
import { PersonnelOwnActionsSection } from '@/components/mitarbeiter/personnel-own-actions-section';
import { AufgabenNotificationsSection } from './aufgaben-notifications-section';
import { AufgabenOwnRequestsSection } from './aufgaben-own-requests-section';
import { AufgabenTaskSection } from './aufgaben-task-section';
import { useAufgabenOverview } from './use-aufgaben-overview';

export function AufgabenContent() {
  const { view, overview, busy, isMarkingAllRead, handleMarkRead, handleMarkAllRead } = useAufgabenOverview();

  if (view.isLoading) {
    return (
      <div className="mx-auto max-w-3xl space-y-4">
        <PersonnelOwnActionsSection />
        <AufgabenListSkeleton />
      </div>
    );
  }

  // Settled without any data: the first load failed.
  if (!overview) {
    return (
      <div className="mx-auto max-w-3xl space-y-4">
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
        <AufgabenTaskSection tasks={overview.tasks} />

        <AufgabenNotificationsSection
          notifications={overview.notifications}
          busy={busy}
          isMarkingAllRead={isMarkingAllRead}
          handleMarkRead={handleMarkRead}
          handleMarkAllRead={handleMarkAllRead}
        />

        <AufgabenOwnRequestsSection ownRequests={overview.ownRequests} />
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

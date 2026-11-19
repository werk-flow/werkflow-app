'use client';
import { SectionError } from '@/components/ui/section-error';

import { AufgabenListSkeleton } from '@/components/loading-states/aufgaben-page-skeleton';
import { StaleRegion } from '@/components/shared/stale-region';
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
